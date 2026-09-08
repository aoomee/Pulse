# Telegram 通知（v1.4.0-vnstat.7）

后台服务列表右上角的铃铛打开通知设置。填写 Bot Token、Chat ID，选择“离线多久提醒”，启用并保存即可。不需要给被监控机器安装额外组件。

## 提醒规则

- 默认等待 **1 分钟**，支持 **15 秒至 24 小时**，可切换秒 / 分钟。
- 等待时间从最近观察到的正常联系算起，不改变首页的在线状态判定。通常检查间隔为 3 秒，排队或 Telegram 网络延迟可能使通知稍晚。
- 持续失联达到设置时间才提醒；短暂断线后恢复不提醒。
- 离线通知成功后，不定时重复轰炸；恢复时再发送一次。
- 从未成功连接的新主机不提醒；服务端启动后留出 30 秒重连缓冲。
- “通知范围”可单独静音某台服务器。新增服务器默认包含。
- 发送失败会有限重试（最多 3 次，间隔至少 30 秒），设置页显示最近的错误；修改并保存设置可重新尝试。
- 状态保存在原有数据库。普通重启不会重发已确认的离线通知；进程在 Telegram 接收消息后、状态落盘前崩溃，或网络超时但 Telegram 实际已接收时，仍可能重复，无法承诺严格恰好一次。

## 模板

默认中文模板开箱即用。“消息模板”支持 JavaScript 编辑、离线 / 恢复 / 测试预览，以及恢复默认。预览只在服务端模拟请求，**不会发 Telegram 消息**；“发送测试”才会真正发送，且使用当前未保存的配置。

参考 Komari 的入口方式：

```javascript
async function sendMessage(message, title) { /* 返回布尔值或 Promise */ }
async function sendEvent(event) { /* 可选；存在时优先使用 */ }
```

当前支持 `Offline`、`Online`、`Test` 三种事件。事件结构：

```json
{
  "event": "Offline",
  "clients": [{"uuid": "1", "name": "示例服务器", "region": "US"}],
  "message": "持续失联 60 秒，请检查服务器或网络。",
  "time": "2026-09-08T12:00:00+08:00",
  "emoji": "🔴",
  "duration_seconds": 60
}
```

内置 `BOT_TOKEN`、`CHAT_ID` 变量，直接使用即可。粘贴其他模板时请删除原模板里写死令牌 / Chat ID 的赋值，并适配上述事件字段。**不是完整 Komari 运行环境**，不支持它的全部事件或任意 Node.js 模块。

支持 `fetch`、Promise、async/await、`setTimeout`、`clearTimeout`，以及不输出内容的 console.log/error/warn。发送必须 await 完成，或返回对应 Promise；最后返回 true 才算成功。

## 安全与限制

- 仅管理员可以读写配置或运行模板。Bot Token 保存后不回传，留空不修改；备份包含此配置，请妥善保存。
- HTTP 请求仅允许 POST JSON 到 `https://api.telegram.org/bot<BOT_TOKEN>/sendMessage`，且 chat_id 必须与设置一致；禁止重定向，不提供文件、Shell、require 或任意网络访问。
- 每次执行最多 20 秒、8 次请求、64 个定时器；HTTP 超时 10 秒，模板上限 128 KiB，单条消息最多 4096 字符。
- JavaScript 使用进程内 Goja 解释器，不是操作系统级内存隔离沙箱。仅运行自己信任的模板；不向普通访客开放代码执行。无需 Node.js 服务或独立通知容器。
- 预览以纯文本呈现，Telegram HTML 格式以实际消息为准。不会输出脚本堆栈或日志，以免泄漏令牌。
- 使用官方 Telegram API，服务器需能够连接该服务；机器人需已被用户启动，或具备向目标群组 / 频道发消息的权限。

设计参考：[Komari](https://github.com/komari-monitor/komari)、[Telegram Bot API](https://core.telegram.org/bots/api#sendmessage)。
