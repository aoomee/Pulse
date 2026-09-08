package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type telegramTransport func(*http.Request) (*http.Response, error)

// Optional local compatibility check. Never logs or commits the supplied
// template, and removes its embedded credentials before a network-free preview.
func TestTelegramExternalTemplatePreview(t *testing.T) {
	path := os.Getenv("PULSE_TEST_TELEGRAM_TEMPLATE")
	if path == "" {
		t.Skip("optional local template")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("cannot read local template")
	}
	credentials := regexp.MustCompile(`(?m)^\s*(?:var|let|const)\s+(?:BOT_TOKEN|CHAT_ID)\s*=.*$`)
	c := telegramFixtureConfig()
	c.Script = credentials.ReplaceAllString(string(data), "")
	var calls atomic.Int32
	for _, kind := range []string{"Offline", "Online", "Test"} {
		event := telegramEvent(kind, SystemMetric{ID: "fixture", Name: "测试服务器", Location: "US"}, time.Now(), time.Now().Add(-time.Minute))
		result, err := runTelegramScript(context.Background(), c, event, true, telegramFakeClient(&calls))
		if err != nil {
			t.Fatalf("%s compatibility: %v", kind, err)
		}
		if len(result.Messages) == 0 {
			t.Fatalf("%s has no preview", kind)
		}
		text := strings.Join(result.Messages, "\n")
		if kind == "Offline" && !strings.Contains(text, "离线") {
			t.Fatal("Offline template lost event meaning")
		}
		if kind == "Online" && !strings.Contains(text, "上线") && !strings.Contains(text, "恢复") {
			t.Fatal("Online template lost event meaning")
		}
		if strings.Contains(text, c.BotToken) {
			t.Fatal("template exposes its token in message")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("preview performed network request")
	}
}

func (f telegramTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func telegramFixtureConfig() TelegramConfig {
	c := defaultTelegramConfig()
	c.Enabled = true
	c.BotToken = "123:fixture"
	c.ChatID = "-456"
	return c
}
func telegramFakeClient(count *atomic.Int32) *http.Client {
	return &http.Client{Transport: telegramTransport(func(r *http.Request) (*http.Response, error) {
		count.Add(1)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ok":true}`)), Header: make(http.Header)}, nil
	})}
}

func TestTelegramScripts(t *testing.T) {
	var calls atomic.Int32
	client := telegramFakeClient(&calls)
	cfg := telegramFixtureConfig()
	event := telegramEvent("Offline", SystemMetric{ID: "1", Name: "<host>"}, time.Now(), time.Now().Add(-time.Minute))
	result, err := runTelegramScript(context.Background(), cfg, event, true, client)
	if err != nil || len(result.Messages) != 1 || !strings.Contains(result.Messages[0], "&lt;host&gt;") {
		t.Fatalf("preview: %v %v", result, err)
	}
	if calls.Load() != 0 {
		t.Fatal("preview contacted Telegram")
	}
	if _, err = runTelegramScript(context.Background(), cfg, event, false, client); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("send missing")
	}
	// Promise timers and sendMessage fallback, as used by Komari templates.
	cfg.Script = strings.Split(defaultTelegramScript, "async function sendEvent")[0] + `const send=sendMessage; sendMessage=async function(m,t){await new Promise(resolve=>setTimeout(resolve,1));return await send(m,t);}`
	if _, err = runTelegramScript(context.Background(), cfg, event, true, client); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		`async function sendEvent(){await fetch('http://127.0.0.1',{method:'POST',body:'{}'});return true;}`,
		`function sendEvent(){return true;}`,
		`function sendEvent(){throw new Error(BOT_TOKEN);}`,
		`function sendEvent(){return require('fs');}`,
		`async function sendEvent(){return fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage',{method:'POST',body:JSON.stringify({chat_id:'different',text:'hello'})});}`,
		`function sendEvent(){fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage',{method:'POST',body:JSON.stringify({chat_id:CHAT_ID,text:'hello'})});return true;}`,
	} {
		cfg.Script = source
		_, err = runTelegramScript(context.Background(), cfg, event, false, client)
		if err == nil {
			t.Errorf("unsafe/invalid script accepted: %s", source)
		} else if strings.Contains(err.Error(), cfg.BotToken) {
			t.Fatal("token leaked")
		}
	}
	for _, source := range []string{`while(true){}`, `function sendEvent(){while(true){}}`, `function sendEvent(){return new Promise(()=>{});}`} {
		cfg.Script = source
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		start := time.Now()
		_, err = runTelegramScript(ctx, cfg, event, true, client)
		cancel()
		if err == nil || time.Since(start) > time.Second {
			t.Fatalf("timeout not enforced: %v", err)
		}
	}
}

func TestTelegramRetryTemplate(t *testing.T) {
	var calls atomic.Int32
	client := &http.Client{Transport: telegramTransport(func(r *http.Request) (*http.Response, error) {
		status, body := 200, `{"ok":true}`
		if calls.Add(1) == 1 {
			status, body = 429, `{"ok":false,"parameters":{"retry_after":0}}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	c := telegramFixtureConfig()
	c.Script = strings.Split(defaultTelegramScript, "async function sendEvent")[0] + `async function sendEvent(e){if(await sendMessage('same','retry'))return true;return await sendMessage('same','retry');}`
	if _, err := runTelegramScript(context.Background(), c, TelegramEvent{}, false, client); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatal("retry not executed")
	}
}

func TestTelegramLargeGroupIDAndFailure(t *testing.T) {
	c := telegramFixtureConfig()
	c.ChatID = "-1001234567890"
	c.Script = strings.ReplaceAll(defaultTelegramScript, "chat_id: CHAT_ID", "chat_id: Number(CHAT_ID)")
	if _, err := runTelegramScript(context.Background(), c, TelegramEvent{}, true, nil); err != nil {
		t.Fatal(err)
	}
	store := newTestStore(t)
	m, _ := NewTelegramManager(store, nil)
	m.cfg = telegramFixtureConfig()
	now := time.Now()
	m.startedAt = now.Add(-time.Hour)
	_ = store.Upsert(SystemMetric{ID: "host", UpdatedAt: now})
	m.tick(now)
	var calls atomic.Int32
	m.client = &http.Client{Transport: telegramTransport(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(`{"ok":false}`)), Header: make(http.Header)}, nil
	})}
	for i := 0; i < 5; i++ {
		m.tick(now.Add(time.Duration(61+i*31) * time.Second))
		if len(m.jobs) > 0 {
			m.deliver(context.Background(), <-m.jobs)
		}
	}
	if calls.Load() != 3 || m.states["host"].Notified || m.lastError == "" {
		t.Fatal("failed sends not bounded or treated as success")
	}
	_ = store.Upsert(SystemMetric{ID: "host", UpdatedAt: now.Add(300 * time.Second)})
	m.tick(now.Add(300 * time.Second))
	if len(m.jobs) != 0 {
		t.Fatal("recovery sent without delivered offline alert")
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.Start(ctx)
	cancel()
	done := make(chan struct{})
	go func() { m.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("notification workers did not stop")
	}
}

func TestTelegramDelayAndRecovery(t *testing.T) {
	for _, delay := range []int{15, 60, 300} {
		t.Run((time.Duration(delay) * time.Second).String(), func(t *testing.T) {
			store := newTestStore(t)
			m, err := NewTelegramManager(store, NewClientRegistry())
			if err != nil {
				t.Fatal(err)
			}
			m.cfg = telegramFixtureConfig()
			m.cfg.OfflineSeconds = delay
			now := time.Now()
			m.startedAt = now.Add(-time.Hour)
			item := SystemMetric{ID: "host", Name: "Host", UpdatedAt: now}
			if err = store.Upsert(item); err != nil {
				t.Fatal(err)
			}
			m.tick(now)
			m.tick(now.Add(time.Duration(delay-1) * time.Second))
			if len(m.jobs) != 0 {
				t.Fatal("early alert")
			}
			m.tick(now.Add(time.Duration(delay)*time.Second + time.Millisecond))
			if len(m.jobs) != 1 {
				t.Fatal("configured delay not honored")
			}
			var calls atomic.Int32
			m.client = telegramFakeClient(&calls)
			m.deliver(context.Background(), <-m.jobs)
			m.tick(now.Add(time.Duration(delay+5) * time.Second))
			if len(m.jobs) != 0 {
				t.Fatal("duplicate offline alert")
			}
			recovered := now.Add(time.Duration(delay+10) * time.Second)
			item.UpdatedAt = recovered
			_ = store.Upsert(item)
			m.tick(recovered)
			if len(m.jobs) != 1 {
				t.Fatal("missing recovery")
			}
			job := <-m.jobs
			if job.event.Event != "Online" {
				t.Fatal("wrong recovery event")
			}
			m.deliver(context.Background(), job)
			m.tick(recovered)
			if calls.Load() != 2 || len(m.jobs) != 0 {
				t.Fatal("repeated recovery")
			}
		})
	}
}

func TestTelegramDeletedHostCancelsQueuedNotification(t *testing.T) {
	store := newTestStore(t)
	m, _ := NewTelegramManager(store, nil)
	m.cfg = telegramFixtureConfig()
	now := time.Now()
	m.startedAt = now.Add(-time.Hour)
	_ = store.Upsert(SystemMetric{ID: "deleted", UpdatedAt: now})
	m.tick(now)
	m.tick(now.Add(61 * time.Second))
	if len(m.jobs) != 1 {
		t.Fatal("missing queued fixture")
	}
	job := <-m.jobs
	_ = store.Delete("deleted")
	var calls atomic.Int32
	m.client = telegramFakeClient(&calls)
	m.deliver(context.Background(), job)
	if calls.Load() != 0 {
		t.Fatal("deleted host generated an alert")
	}
}

func TestTelegramStartupCancelExclusionAndRestart(t *testing.T) {
	store := newTestStore(t)
	m, _ := NewTelegramManager(store, NewClientRegistry())
	m.cfg = telegramFixtureConfig()
	now := time.Now()
	m.startedAt = now
	_ = store.Upsert(SystemMetric{ID: "old", UpdatedAt: now.Add(-time.Hour), Alert: true})
	_ = store.Upsert(SystemMetric{ID: "live", UpdatedAt: now})
	m.tick(now)
	if !m.states["live"].Armed || m.states["old"].Armed {
		t.Fatal("startup arming wrong")
	}
	m.tick(now.Add(61 * time.Second))
	if len(m.jobs) != 1 {
		t.Fatal("online host missed during startup")
	}
	queued := <-m.jobs
	_ = store.Upsert(SystemMetric{ID: "live", UpdatedAt: now.Add(62 * time.Second)})
	m.tick(now.Add(62 * time.Second))
	var calls atomic.Int32
	m.client = telegramFakeClient(&calls)
	m.deliver(context.Background(), queued)
	if calls.Load() != 0 {
		t.Fatal("stale queued alert sent")
	}
	m.cfg.ExcludedIDs = []string{"live"}
	m.tick(now.Add(130 * time.Second))
	if len(m.jobs) != 0 {
		t.Fatal("excluded host notified")
	}
	m.cfg.ExcludedIDs = nil
	m.states["live"] = &telegramState{Armed: true, Notified: true, DownSince: now}
	_ = store.telegramSave("telegram_states", m.states)
	_ = store.telegramSave("telegram", m.cfg)
	restarted, _ := NewTelegramManager(store, NewClientRegistry())
	restarted.startedAt = now.Add(-time.Hour)
	restarted.tick(now.Add(130 * time.Second))
	if len(restarted.jobs) != 0 {
		t.Fatal("offline notification replayed after restart")
	}
	_ = store.Upsert(SystemMetric{ID: "live", UpdatedAt: now.Add(131 * time.Second)})
	restarted.tick(now.Add(131 * time.Second))
	if len(restarted.jobs) != 1 || (<-restarted.jobs).event.Event != "Online" {
		t.Fatal("persisted recovery missing")
	}
}

func TestTelegramSettingsAuthPersistence(t *testing.T) {
	store := newTestStore(t)
	m, _ := NewTelegramManager(store, NewClientRegistry())
	m.cfg = telegramFixtureConfig()
	rr := httptest.NewRecorder()
	m.Handler(rr, httptest.NewRequest("GET", "/api/telegram/config", nil))
	if rr.Code != 401 {
		t.Fatal("unprotected token settings")
	}
	authTokensMu.Lock()
	authTokens["test-admin-token"] = time.Now().Add(time.Hour)
	authTokensMu.Unlock()
	t.Cleanup(func() { authTokensMu.Lock(); delete(authTokens, "test-admin-token"); authTokensMu.Unlock() })
	rr = httptest.NewRecorder()
	m.Handler(rr, adminRequest(t, "GET", "/api/telegram/config", nil))
	if rr.Code != 200 || strings.Contains(rr.Body.String(), m.cfg.BotToken) {
		t.Fatal("token exposed")
	}
	cfg := m.cfg
	cfg.BotToken = ""
	cfg.OfflineSeconds = 300
	rr = httptest.NewRecorder()
	m.Handler(rr, adminRequest(t, "POST", "/api/telegram/config", cfg))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	reloaded, _ := NewTelegramManager(store, nil)
	if reloaded.cfg.BotToken != "123:fixture" || reloaded.cfg.OfflineSeconds != 300 {
		t.Fatal("configuration not retained")
	}
	for _, n := range []int{0, 14, 86401} {
		cfg.OfflineSeconds = n
		rr = httptest.NewRecorder()
		m.Handler(rr, adminRequest(t, "POST", "/api/telegram/config", cfg))
		if rr.Code != 400 {
			t.Fatal("invalid delay accepted")
		}
	}
	cfg.OfflineSeconds = 60
	rr = httptest.NewRecorder()
	m.Handler(rr, adminRequest(t, "POST", "/api/telegram/preview", cfg))
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var result telegramScriptResult
	if json.Unmarshal(rr.Body.Bytes(), &result) != nil || len(result.Messages) != 1 {
		t.Fatal("preview invalid")
	}
}
