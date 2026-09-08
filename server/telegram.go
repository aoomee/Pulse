package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
	bolt "go.etcd.io/bbolt"
)

type TelegramConfig struct {
	Enabled        bool     `json:"enabled"`
	BotToken       string   `json:"bot_token"`
	ChatID         string   `json:"chat_id"`
	OfflineSeconds int      `json:"offline_seconds"`
	Script         string   `json:"script"`
	ExcludedIDs    []string `json:"excluded_ids"`
}
type TelegramEvent struct {
	Event           string              `json:"event"`
	Message         string              `json:"message"`
	Time            string              `json:"time"`
	Emoji           string              `json:"emoji"`
	Clients         []map[string]string `json:"clients"`
	DurationSeconds int64               `json:"duration_seconds"`
}
type telegramState struct {
	Armed       bool      `json:"armed"`
	Notified    bool      `json:"notified"`
	DownSince   time.Time `json:"down_since"`
	lastContact time.Time
	job         *telegramJob
	attempts    int
	retryAt     time.Time
}
type telegramJob struct {
	id      string
	contact time.Time
	event   TelegramEvent
	cfg     TelegramConfig
	started bool
}
type TelegramManager struct {
	mu        sync.Mutex
	store     *Store
	registry  *ClientRegistry
	cfg       TelegramConfig
	states    map[string]*telegramState
	jobs      chan *telegramJob
	startedAt time.Time
	status    string
	lastSent  string
	lastError string
	busy      chan struct{}
	client    *http.Client
	wg        sync.WaitGroup
}

func defaultTelegramConfig() TelegramConfig {
	return TelegramConfig{OfflineSeconds: 60, Script: defaultTelegramScript, ExcludedIDs: []string{}}
}
func (s *Store) telegramLoad(key string, value any) error {
	return s.db.View(func(tx *bolt.Tx) error {
		data := tx.Bucket([]byte(configBucket)).Get([]byte(key))
		if data == nil {
			return nil
		}
		return json.Unmarshal(data, value)
	})
}
func (s *Store) telegramSave(key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.db.Update(func(tx *bolt.Tx) error { return tx.Bucket([]byte(configBucket)).Put([]byte(key), data) })
}
func NewTelegramManager(store *Store, registry *ClientRegistry) (*TelegramManager, error) {
	m := &TelegramManager{store: store, registry: registry, cfg: defaultTelegramConfig(), states: map[string]*telegramState{}, jobs: make(chan *telegramJob, 64), busy: make(chan struct{}, 1), startedAt: time.Now(), status: "idle"}
	m.client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if err := store.telegramLoad("telegram", &m.cfg); err != nil {
		return nil, err
	}
	if err := validateTelegramConfig(m.cfg); err != nil {
		return nil, err
	}
	if err := store.telegramLoad("telegram_states", &m.states); err != nil {
		return nil, err
	}
	if m.states == nil {
		m.states = map[string]*telegramState{}
	}
	for id, state := range m.states {
		if state == nil {
			delete(m.states, id)
		}
	}
	return m, nil
}
func (m *TelegramManager) Start(ctx context.Context) {
	m.wg.Add(2)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				m.tick(now)
			}
		}
	}()
	go func() {
		defer m.wg.Done()
		for {
			select {
			case <-ctx.Done():
				return
			case job := <-m.jobs:
				m.deliver(ctx, job)
			}
		}
	}()
}
func (m *TelegramManager) Wait() { m.wg.Wait() }

func telegramEvent(kind string, item SystemMetric, now, downSince time.Time) TelegramEvent {
	duration := int64(0)
	if !downSince.IsZero() {
		duration = int64(now.Sub(downSince).Seconds())
		if duration < 0 {
			duration = 0
		}
	}
	message, emoji := "通知渠道连接正常。", "🔔"
	if kind == "Offline" {
		message = fmt.Sprintf("持续失联 %d 秒，请检查服务器或网络。", duration)
		emoji = "🔴"
	}
	if kind == "Online" {
		message = fmt.Sprintf("服务器已恢复连接，本次失联约 %d 秒。", duration)
		emoji = "🟢"
	}
	clients := []map[string]string{}
	if item.ID != "" {
		clients = append(clients, map[string]string{"uuid": item.ID, "name": item.Name, "region": item.Location})
	}
	return TelegramEvent{Event: kind, Message: message, Time: now.In(time.FixedZone("CST", 8*3600)).Format(time.RFC3339), Emoji: emoji, Clients: clients, DurationSeconds: duration}
}

// Uses last successful contact, not the display-only Alert bit. The user's
// delay is measured from that contact; sampling adds at most one tick normally.
func (m *TelegramManager) tick(now time.Time) {
	m.mu.Lock()
	enabled := m.cfg.Enabled
	m.mu.Unlock()
	if !enabled {
		return
	}
	items, err := m.store.List()
	if err != nil {
		return
	}
	contacts := map[string]time.Time{}
	if m.registry != nil {
		for _, c := range m.registry.GetAll() {
			if c.PushMode {
				contacts[c.ID] = c.LastPushAt
			}
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.cfg.Enabled {
		return
	}
	// Let agents reconnect after a server restart, without replaying old alerts.
	starting := now.Sub(m.startedAt) < 30*time.Second
	excluded := map[string]bool{}
	for _, id := range m.cfg.ExcludedIDs {
		excluded[id] = true
	}
	present := map[string]bool{}
	changed := false
	for _, item := range items {
		id := item.ID
		present[id] = true
		if excluded[id] {
			if _, ok := m.states[id]; ok {
				delete(m.states, id)
				changed = true
			}
			continue
		}
		last := item.UpdatedAt
		if push := contacts[id]; push.After(last) {
			last = push
		}
		s := m.states[id]
		if s == nil {
			s = &telegramState{}
			m.states[id] = s
		}
		// The legacy offline marker can rewrite UpdatedAt. Keep our last
		// observed healthy contact rather than treating that write as a heartbeat.
		if !item.Alert && last.After(s.lastContact) {
			s.lastContact = last
		}
		if !s.lastContact.IsZero() {
			last = s.lastContact
		}
		fresh := !item.Alert && !last.IsZero() && now.Sub(last) <= 15*time.Second
		// Never alert on a newly added host that has never been observed online.
		if !s.Armed {
			if fresh {
				s.Armed = true
				changed = true
			}
			continue
		}
		if starting {
			continue
		}
		recovered := fresh
		if s.job != nil {
			// A queued alert is cancellable until the HTTP worker starts it.
			if !s.job.started && ((s.job.event.Event == "Offline" && recovered) || (s.job.event.Event == "Online" && !recovered)) {
				s.job = nil
				s.attempts = 0
			} else {
				continue
			}
		}
		if recovered && !s.Notified {
			s.attempts = 0
			s.retryAt = time.Time{}
			s.DownSince = time.Time{}
			continue
		}
		if !recovered && s.Notified {
			continue
		}
		if now.Before(s.retryAt) || s.attempts >= 3 {
			continue
		}
		kind := ""
		if recovered && s.Notified {
			kind = "Online"
		} else if !last.IsZero() && now.Sub(last) >= time.Duration(m.cfg.OfflineSeconds)*time.Second {
			kind = "Offline"
			s.DownSince = last
		}
		if kind == "" {
			continue
		}
		job := &telegramJob{id: id, contact: last, cfg: m.cfg, event: telegramEvent(kind, item, now, s.DownSince)}
		select {
		case m.jobs <- job:
			s.job = job
		default:
			m.status = "queue_full"
		}
	}
	for id := range m.states {
		if !present[id] {
			delete(m.states, id)
			changed = true
		}
	}
	if changed {
		if err := m.store.telegramSave("telegram_states", m.states); err != nil {
			m.lastError = "无法保存通知状态"
		}
	}
}
func (m *TelegramManager) deliver(ctx context.Context, job *telegramJob) {
	// Recheck a queued offline alert against contacts arriving after the scan.
	latest, lookupErr := m.store.Get(job.id)
	returned := latest != nil && !latest.Alert && latest.UpdatedAt.After(job.contact)
	if m.registry != nil {
		for _, c := range m.registry.GetAll() {
			if c.ID == job.id && c.PushMode && c.LastPushAt.After(job.contact) {
				returned = true
				break
			}
		}
	}
	m.mu.Lock()
	s := m.states[job.id]
	if !m.cfg.Enabled || s == nil || s.job != job {
		m.mu.Unlock()
		return
	}
	if lookupErr != nil || latest == nil {
		s.job = nil
		if latest == nil && lookupErr == nil {
			delete(m.states, job.id)
		}
		m.mu.Unlock()
		return
	}
	if job.event.Event == "Offline" && returned {
		s.job = nil
		s.attempts = 0
		s.DownSince = time.Time{}
		m.mu.Unlock()
		return
	}
	job.started = true
	m.status = "sending"
	m.mu.Unlock()
	_, err := runTelegramScript(ctx, job.cfg, job.event, false, m.client)
	m.mu.Lock()
	defer m.mu.Unlock()
	s = m.states[job.id]
	if s == nil || s.job != job {
		return
	}
	s.job = nil
	if err != nil {
		s.attempts++
		s.retryAt = time.Now().Add(30 * time.Second)
		m.lastError = err.Error()
		m.status = "failed"
		return
	}
	s.attempts = 0
	s.retryAt = time.Time{}
	s.Notified = job.event.Event == "Offline"
	if !s.Notified {
		s.DownSince = time.Time{}
	}
	m.lastSent = time.Now().Format(time.RFC3339)
	m.lastError = ""
	m.status = "sent"
	if err := m.store.telegramSave("telegram_states", m.states); err != nil {
		m.lastError = "通知已发送，但状态保存失败"
	}
}

var telegramTokenPattern = regexp.MustCompile(`^[0-9]+:[A-Za-z0-9_-]+$`)
var telegramChatPattern = regexp.MustCompile(`^(?:-?[0-9]+|@[A-Za-z0-9_]+)$`)

func validateTelegramConfig(c TelegramConfig) error {
	if c.OfflineSeconds < 15 || c.OfflineSeconds > 86400 {
		return errors.New("离线等待时间须为 15 秒至 24 小时")
	}
	if len(c.Script) > 128<<10 {
		return errors.New("模板最大为 128 KiB")
	}
	if strings.TrimSpace(c.Script) == "" {
		return errors.New("模板不能为空")
	}
	if _, err := goja.Compile("notification.js", c.Script, false); err != nil {
		return errors.New("JavaScript 模板存在语法错误")
	}
	if c.BotToken != "" && (!telegramTokenPattern.MatchString(c.BotToken) || len(c.BotToken) > 256) {
		return errors.New("Bot Token 格式无效")
	}
	if c.ChatID != "" && (!telegramChatPattern.MatchString(c.ChatID) || len(c.ChatID) > 128) {
		return errors.New("Chat ID 格式无效")
	}
	if c.Enabled && (c.BotToken == "" || c.ChatID == "") {
		return errors.New("启用通知前请填写 Bot Token 和 Chat ID")
	}
	if len(c.ExcludedIDs) > 10000 {
		return errors.New("排除列表过长")
	}
	return nil
}
func (m *TelegramManager) Handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	// Secrets and executable templates are admin-only, never share-token APIs.
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	authTokensMu.Lock()
	expiry, authenticated := authTokens[token]
	authTokensMu.Unlock()
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || !authenticated || !time.Now().Before(expiry) {
		http.Error(w, "unauthorized", 401)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet && r.URL.Path == "/api/telegram/config" {
		m.mu.Lock()
		defer m.mu.Unlock()
		c := m.cfg
		c.BotToken = ""
		_ = json.NewEncoder(w).Encode(map[string]any{"config": c, "has_token": m.cfg.BotToken != "", "default_script": defaultTelegramScript, "status": m.status, "last_sent": m.lastSent, "last_error": m.lastError})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	select {
	case m.busy <- struct{}{}:
		defer func() { <-m.busy }()
	default:
		http.Error(w, "通知操作正在进行，请稍后再试", 429)
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, 160<<10)
	var request struct {
		TelegramConfig
		ClearToken bool   `json:"clear_token"`
		Event      string `json:"event"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		http.Error(w, "配置 JSON 无效", 400)
		return
	}
	m.mu.Lock()
	c := request.TelegramConfig
	if c.BotToken == "" && !request.ClearToken {
		c.BotToken = m.cfg.BotToken
	}
	m.mu.Unlock()
	c.BotToken = strings.TrimSpace(c.BotToken)
	c.ChatID = strings.TrimSpace(c.ChatID)
	if err := validateTelegramConfig(c); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if r.URL.Path == "/api/telegram/config" {
		m.mu.Lock()
		defer m.mu.Unlock()
		if err := m.store.telegramSave("telegram", c); err != nil {
			http.Error(w, "保存通知配置失败", 500)
			return
		}
		// Invalidate queued jobs made under old settings. In-flight requests
		// cannot be unsent, and complete before a following recovery message.
		for _, s := range m.states {
			if s.job != nil && !s.job.started {
				s.job = nil
			}
			s.attempts = 0
			s.retryAt = time.Time{}
		}
		m.cfg = c
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	if r.URL.Path != "/api/telegram/preview" && r.URL.Path != "/api/telegram/test" {
		http.NotFound(w, r)
		return
	}
	preview := r.URL.Path == "/api/telegram/preview"
	if !preview && (c.BotToken == "" || c.ChatID == "") {
		http.Error(w, "请先填写 Bot Token 和 Chat ID", 400)
		return
	}
	if preview {
		if c.BotToken == "" {
			c.BotToken = "123:preview"
		}
		if c.ChatID == "" {
			c.ChatID = "123"
		}
	}
	kind := request.Event
	if kind != "Offline" && kind != "Online" {
		kind = "Test"
	}
	now := time.Now()
	event := telegramEvent(kind, SystemMetric{ID: "preview", Name: "示例服务器", Location: "US"}, now, now.Add(-time.Duration(c.OfflineSeconds)*time.Second))
	if !preview {
		event = telegramEvent("Test", SystemMetric{}, now, time.Time{})
	}
	result, err := runTelegramScript(r.Context(), c, event, preview, m.client)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	// Preview is escaped as text in the UI. Never echo a token even if a
	// user accidentally includes BOT_TOKEN in a custom message.
	for i := range result.Messages {
		result.Messages[i] = strings.ReplaceAll(result.Messages[i], c.BotToken, "[REDACTED]")
	}
	_ = json.NewEncoder(w).Encode(result)
}
