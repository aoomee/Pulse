package main

// Telegram-only JavaScript host. No filesystem, require, shell, listeners or
// arbitrary outbound endpoints are exposed. goja is an in-process interpreter,
// not an OS memory sandbox; only trusted administrators may author scripts.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dop251/goja"
)

const defaultTelegramScript = `// BOT_TOKEN、CHAT_ID 由后台配置注入，请勿把真实令牌写进模板。
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function sendMessage(message, title) {
  const response = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: CHAT_ID, text: '<b>' + escapeHtml(title) + '</b>\n\n' + escapeHtml(message), parse_mode: 'HTML', disable_web_page_preview: true})
  });
  const result = await response.json();
  return response.ok && result.ok;
}
async function sendEvent(event) {
  const titles = {Offline: '🔴 服务器离线', Online: '🟢 服务器恢复', Test: '🔔 通知测试'};
  const names = (event.clients || []).map(client => client.name).join('、');
  const message = (names ? names + '\n' : '') + event.message + '\n时间：' + event.time;
  return await sendMessage(message, titles[event.event] || 'Pulse 通知');
}`

type telegramScriptResult struct {
	Messages []string `json:"messages"`
}

// All VM access, including Promise resolution, stays on the caller goroutine.
// HTTP/timer workers only post closures. Both workers and callbacks are bounded.
func runTelegramScript(parent context.Context, cfg TelegramConfig, event TelegramEvent, preview bool, client *http.Client) (result telegramScriptResult, err error) {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	vm := goja.New()
	vm.SetMaxCallStackSize(128)
	stop := context.AfterFunc(ctx, func() { vm.Interrupt("notification execution timed out") })
	defer stop()
	callbacks := make(chan func(), 64)
	post := func(f func()) {
		select {
		case callbacks <- f:
		case <-ctx.Done():
		}
	}
	resolveValue := func(v any) *goja.Promise { p, resolve, _ := vm.NewPromise(); _ = resolve(v); return p }
	_ = vm.Set("BOT_TOKEN", cfg.BotToken)
	_ = vm.Set("CHAT_ID", cfg.ChatID)
	_ = vm.Set("console", map[string]any{"log": func(...goja.Value) {}, "error": func(...goja.Value) {}, "warn": func(...goja.Value) {}})
	timers := make(map[int]context.CancelFunc)
	nextTimer := 0
	_ = vm.Set("setTimeout", func(call goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			panic(vm.NewTypeError("timer callback must be a function"))
		}
		if nextTimer >= 64 {
			panic(vm.NewTypeError("too many timers"))
		}
		nextTimer++
		id := nextTimer
		delay := call.Argument(1).ToInteger()
		if delay < 0 {
			delay = 0
		}
		if delay > 20000 {
			delay = 20000
		}
		timerCtx, timerCancel := context.WithCancel(ctx)
		timers[id] = timerCancel
		go func() {
			timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
				post(func() {
					if timerCtx.Err() == nil {
						if _, e := fn(goja.Undefined()); e != nil {
							vm.Interrupt("timer callback failed")
						}
					}
					delete(timers, id)
				})
			case <-timerCtx.Done():
			}
		}()
		return vm.ToValue(id)
	})
	_ = vm.Set("clearTimeout", func(id int) {
		if c := timers[id]; c != nil {
			c()
			delete(timers, id)
		}
	})
	requests := 0
	pending, succeeded := 0, 0
	failedMessages := map[string]string{}
	lastFailure := ""
	_ = vm.Set("fetch", func(call goja.FunctionCall) goja.Value {
		p, resolve, reject := vm.NewPromise()
		fail := func(message string) goja.Value {
			lastFailure = message
			_ = reject(vm.NewTypeError(message))
			return vm.ToValue(p)
		}
		requests++
		if requests > 8 {
			return fail("最多允许 8 次 Telegram 请求")
		}
		if call.Argument(0).String() != "https://api.telegram.org/bot"+cfg.BotToken+"/sendMessage" {
			return fail("只允许向后台配置的 Telegram 机器人发送消息；请使用 BOT_TOKEN 变量")
		}
		if goja.IsUndefined(call.Argument(1)) || goja.IsNull(call.Argument(1)) {
			return fail("fetch 缺少请求参数")
		}
		opts := call.Argument(1).ToObject(vm)
		if strings.ToUpper(opts.Get("method").String()) != "POST" {
			return fail("Telegram 请求必须使用 POST")
		}
		body := opts.Get("body").String()
		if len(body) > 64<<10 {
			return fail("消息请求过长")
		}
		var payload map[string]any
		decoder := json.NewDecoder(strings.NewReader(body))
		decoder.UseNumber() // Keep large negative Telegram group IDs exact.
		if decoder.Decode(&payload) != nil {
			return fail("Telegram 请求必须是 JSON")
		}
		if fmt.Sprint(payload["chat_id"]) != cfg.ChatID {
			return fail("chat_id 必须与后台配置一致；请使用 CHAT_ID 变量")
		}
		message, _ := payload["text"].(string)
		if message == "" || len([]rune(message)) > 4096 {
			return fail("单条消息须为 1–4096 字符")
		}
		if len(result.Messages) >= 8 {
			return fail("预览消息过多")
		}
		result.Messages = append(result.Messages, message)
		pending++
		finish := func(status int, data []byte, failure string) {
			pending--
			if failure != "" {
				failedMessages[message] = failure
				_ = reject(vm.NewTypeError(failure))
				return
			}
			var parsed map[string]any
			if json.Unmarshal(data, &parsed) != nil {
				failedMessages[message] = "Telegram 返回了无效 JSON"
				_ = reject(vm.NewTypeError(failedMessages[message]))
				return
			}
			if status != 200 || parsed["ok"] != true {
				failedMessages[message] = fmt.Sprintf("Telegram 拒绝发送（HTTP %d），请检查令牌、Chat ID 和机器人权限", status)
			} else {
				delete(failedMessages, message)
				succeeded++
			}
			response := vm.NewObject()
			_ = response.Set("ok", status >= 200 && status < 300)
			_ = response.Set("status", status)
			_ = response.Set("text", func() *goja.Promise { return resolveValue(string(data)) })
			_ = response.Set("json", func() *goja.Promise { return resolveValue(parsed) })
			_ = resolve(response)
		}
		if preview {
			finish(200, []byte(`{"ok":true,"result":{"message_id":1}}`), "")
			return vm.ToValue(p)
		}
		go func() {
			req, e := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+cfg.BotToken+"/sendMessage", strings.NewReader(body))
			if e != nil {
				post(func() { finish(0, nil, "无法创建 Telegram 请求") })
				return
			}
			req.Header.Set("Content-Type", "application/json")
			resp, e := client.Do(req)
			if e != nil {
				post(func() { finish(0, nil, "无法连接 Telegram 或请求超时") })
				return
			}
			defer resp.Body.Close()
			data, e := io.ReadAll(io.LimitReader(resp.Body, (64<<10)+1))
			if e != nil || len(data) > 64<<10 {
				post(func() { finish(0, nil, "Telegram 响应过大或读取失败") })
				return
			}
			post(func() { finish(resp.StatusCode, data, "") })
		}()
		return vm.ToValue(p)
	})
	// Do not return raw script exceptions: source lines and stack traces may
	// contain user-pasted credentials. Console output is intentionally discarded.
	defer func() {
		if recover() != nil {
			err = errors.New("模板执行失败，请检查模板参数")
		}
	}()
	if _, e := vm.RunString(cfg.Script); e != nil {
		return result, errors.New("模板初始化失败或执行超时")
	}
	fn, ok := goja.AssertFunction(vm.Get("sendEvent"))
	var value goja.Value
	if ok {
		data, _ := json.Marshal(event)
		var obj map[string]any
		_ = json.Unmarshal(data, &obj)
		value, err = fn(goja.Undefined(), vm.ToValue(obj))
	} else if fn, ok = goja.AssertFunction(vm.Get("sendMessage")); ok {
		value, err = fn(goja.Undefined(), vm.ToValue(event.Message), vm.ToValue(event.Event))
	} else {
		return result, errors.New("模板需要 sendMessage 或 sendEvent 函数")
	}
	if err != nil {
		return result, errors.New("模板执行失败或超时")
	}
	if promise, ok := value.Export().(*goja.Promise); ok {
		for promise.State() == goja.PromiseStatePending {
			select {
			case f := <-callbacks:
				f()
			case <-ctx.Done():
				return result, errors.New("模板执行超过时间限制")
			}
		}
		if promise.State() == goja.PromiseStateRejected {
			if lastFailure != "" {
				return result, errors.New(lastFailure)
			}
			return result, errors.New("模板 Promise 执行失败")
		}
		value = promise.Result()
	}
	if ctx.Err() != nil {
		return result, errors.New("模板执行超过时间限制")
	}
	if pending != 0 {
		return result, errors.New("请等待发送完成后再返回：使用 await fetch 或返回 Promise")
	}
	for _, failure := range failedMessages {
		return result, errors.New(failure)
	}
	if !value.ToBoolean() || lastFailure != "" {
		if lastFailure != "" {
			return result, errors.New(lastFailure)
		}
		return result, errors.New("模板返回失败，请检查通知内容")
	}
	if succeeded == 0 {
		return result, errors.New("模板未成功发送任何消息")
	}
	return result, nil
}
