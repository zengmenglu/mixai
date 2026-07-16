# Provider Adapter 维护手册

> 由 gen-docs skill 基于 `backend/adapters/*.js` 源码生成。
> 当新增 provider 或网站改版时，运行 `/gen-docs adapter` 更新本文档。

## 通用说明

每个 adapter 文件继承自 [BaseAdapter](file://backend/adapters/base.js)，文件顶部 `const S = { ... }` 包含所有 DOM 选择器。
当 AI 网站改版导致抓取失效时，一般只需修改对应 adapter 的 `S` 选择器表，**不需改动逻辑代码**。

### 选择器命名约定

| 选择器名 | 用途 | 类型 |
|----------|------|------|
| `input` | 聊天输入框 | string[] |
| `sendButton` | 发送按钮 | string[] |
| `newChat` | 新建对话按钮 | string[] |
| `answer` | 回答容器（候选列表，配合 lastVisible 取最新一条） | string[] |
| `stopButton` | 停止生成按钮（生成中信号 + 终止时点击） | string[] |
| `loginWall` | 登录墙/人机验证（存在=未登录） | string[] |
| `quota` | 限流/配额耗尽提示文案 | RegExp |

### 共享机制（BaseAdapter，所有 provider 通用）

- **`launch()` 自愈**：用 `isClosed()` + 一次带超时的探活检测页面存亡；监听 `page/context` 的 `close` 事件主动清空引用。用户关窗口或浏览器崩溃后，下一轮自动重建浏览器，不抛 `Target page closed`。
- **`waitLoggedIn(ms)`**：轮询 `ensureLoggedIn()`，超时返回 false；带日志。
- **`ask(question, mode, signal)`**：未登录时 reload 一次重试；流式前捕获 `baseline`（上一轮回答文本）传给 `streamAnswer`，避免把旧答案当新答案流式输出；`done` 事件携带当前 `page.url()` 供会话恢复使用。`signal`（AbortSignal）用于终止。
- **`stopGenerating()`**：点击 provider 自己的停止按钮，释放输入框供下一轮使用（终止按钮触发）。各 adapter 覆盖此方法。
- **完成判定**：由 [scrape.js](file://backend/browser/scrape.js) 的 `streamAnswer` 实现——文本稳定窗口 + `isStreaming` 佐证；续问时用 baseline 跳过旧答案；DOM echo（回答被渲染两份）自动拦截。

### 配置关联

每个 adapter 的运行时参数（headless、stealthLevel、stabilityWindowMs、proxy、loginSettleMs）在 [config/providers.js](file://config/providers.js) 中配置，**不在 adapter 中硬编码**。

---

## DeepSeek (`deepseek.js`)

- **URL**: `https://chat.deepseek.com/`
- **配置**: `stealthLevel: 'standard'`, `stabilityWindowMs: 800`

### 选择器表

| 选择器 | 当前值 |
|--------|--------|
| loginWall | `text=登录`, `text=Log in`, `input[type="password"]`, `button:has-text("登录")` |
| input | `textarea#chat-input`, `textarea[placeholder*="给 DeepSeek"]`, `textarea[placeholder*="message"]`, `div[contenteditable="true"]`, `textarea` |
| sendButton | `div[role="button"][aria-disabled="false"]:near(textarea)`, `button[type="submit"]`, `button:has-text("发送")` |
| newChat | `text=新建对话`, `text=New chat`, `a:has-text("新对话")`, `button:has-text("新对话")` |
| answer | `.ds-markdown`, `div[class*="markdown"]`, `div[class*="message"][class*="assistant"]` |
| stopButton | `div[role="button"]:has-text("停止")`, `button:has-text("Stop")`, `[aria-label*="stop" i]` |
| quota | `/(达到上限\|额度已用完\|rate limit\|too many requests\|稍后再试)/i` |

### 特殊处理
- 登录态检测：输入框可见 + 无密码输入框 -> 已登录
- 回答读取：使用 `lastVisible`（`.last()`）取最新一条 assistant 消息（多轮对话取最新，**不要用 `:last-of-type`**——它按标签而非 class 匹配，多轮时取不到最新）
- 生成中检测：stopButton 可见 -> 仍在生成
- 终止：`stopGenerating()` 点击 stopButton

---

## Kimi (`kimi.js`)

- **URL**: `https://www.kimi.com/`
- **配置**: `stealthLevel: 'standard'`, `stabilityWindowMs: 800`

### 选择器表

| 选择器 | 当前值 |
|--------|--------|
| input | `div.chat-input-editor[contenteditable="true"]`, `div[role="textbox"][contenteditable="true"]`, `div[contenteditable="true"]`, `textarea` |
| sendButton | `button:has-text("发送")`, `[aria-label*="send" i]`, `button[type="submit"]` |
| newChat | `text=新建会话`, `text=新对话`, `text=New chat`, `button:has-text("新会话")` |
| answer | `.segment-assistant .markdown`, `.chat-content-item-assistant .markdown`, `.segment-assistant`, `.chat-content-item-assistant` |
| stopButton | `button:has-text("停止")`, `[aria-label*="stop" i]`, `.stop-button` |
| loginWall | `text=登录以同步`, `input[type="password"]` |
| quota | `/(达到上限\|额度\|rate limit\|too many requests\|稍后再试\|今日.*次数)/i` |

### 特殊处理
- 登录态检测：「登录以同步历史会话」提示出现 -> 未登录
- 回答读取：使用 `lastVisible` 取最后一条 assistant segment
- 输入框是 `contenteditable="true"` 的 div，非 textarea
- 终止：`stopGenerating()` 点击 stopButton

---

## Doubao (`doubao.js`)

- **URL**: `https://www.doubao.com/chat/`
- **配置**: `stealthLevel: 'high'`, `stabilityWindowMs: 1100`

### 选择器表

| 选择器 | 当前值 |
|--------|--------|
| input | `textarea.semi-input-textarea`, `textarea[placeholder*="发消息"]`, `textarea[placeholder*="输入"]`, `textarea` |
| sendButton | `button:has-text("发送")`, `[aria-label*="发送"]`, `button[type="submit"]` |
| newChat | `text=新对话`, `text=新建对话`, `button:has-text("新对话")` |
| answer | `div[data-message-id]:not(.justify-end)`, `div[data-target-id="message-box-target-id"]` |
| stopButton | `button:has-text("停止")`, `[aria-label*="停止"]`, `[aria-label*="stop" i]` |
| loginWall | `text=登录以解锁`, `text=请输入手机号`, `input[type="password"]` |
| quota | `/(达到上限\|额度\|rate limit\|too many requests\|稍后再试\|今日.*次数)/i` |

### 特殊处理
- 反检测等级 `high`：在 contextFactory 中注入 WebGL/plugins/permissions 伪装
- 回答读取：使用 `page.evaluate()` 直接从 DOM 遍历 `data-message-id` 元素，过滤掉右对齐的用户气泡（`.justify-end`），取最后一个有文本的 assistant 气泡
- 稳定性窗口更长（1100ms），Doubao 生成速度较慢
- 终止：`stopGenerating()` 点击 stopButton

---

## ChatGPT (`chatgpt.js`)

- **URL**: `https://chatgpt.com/`
- **配置**: `engine: 'patchright'`, `channel: 'chrome'`, `stealthLevel: 'none'`, `stabilityWindowMs: 1500`, `loginSettleMs: 30000`, `proxy: http://127.0.0.1:7890`

### 选择器表

| 选择器 | 当前值 |
|--------|--------|
| input | `div#prompt-textarea[contenteditable="true"]`, `div[contenteditable="true"]`, `textarea[data-id]`, `textarea` |
| sendButton | `button[data-testid="send-button"]`, `button[aria-label*="Send" i]`, `button:has-text("Send")` |
| newChat | `a[data-testid="create-new-chat-button"]`, `button:has-text("New chat")`, `a:has-text("New chat")` |
| answer | `div[data-message-author-role="assistant"] .markdown`, `div[data-message-author-role="assistant"]`, `div[class*="markdown"]` |
| stopButton | `button[data-testid="stop-button"]`, `button[aria-label*="Stop" i]` |
| loginWall | `text=Verify you are human`, `text=请验证您是真人`, `iframe[src*="challenges.cloudflare.com"]`, `input[name="username"]` |
| quota | `/(You.?ve reached your\|rate limit\|too many requests\|usage limit\|try again later)/i` |

### 特殊处理（重要）

1. **引擎差异**：使用 `patchright`（非标准 Playwright），在 [contextFactory.js](file://backend/browser/contextFactory.js) 中懒加载
2. **真实 Chrome**：`channel: 'chrome'` 使用系统安装的 Google Chrome，绕过 Cloudflare Turnstile
3. **不注入 stealth initScript**：`stealthLevel: 'none'`，patchright 自带反检测，额外 initScript 反而可能触发检测
4. **不设置 viewport lock**：保持 Chrome 真实窗口尺寸，避免指纹异常
5. **不修改 UA**：使用真实 Chrome 的 UA 字符串
6. **独立代理**：`proxy: http://127.0.0.1:7890`，仅 ChatGPT 走代理，其他三家直连。可通过 `CHATGPT_PROXY` 环境变量覆盖
7. **更长登录等待**：`loginSettleMs: 30000`，因为真 Chrome + 代理 + Cloudflare 加载慢
8. **登录墙判断特殊**：仅检测 Cloudflare Turnstile / 人机验证 / 用户名输入页，不把普通「Log in」按钮当作登录墙（ChatGPT 支持匿名聊天）。未登录时 `ensureLoggedIn` 会 warn 输出 `{wall, input, url}` 便于诊断
9. **回答读取**：使用 `lastVisible` 取最新 assistant 消息（去掉 `:last-of-type`）
10. **已知不稳定**：短时间内反复自动化启动后，ChatGPT 偶尔仍会被判定为机器人，需手动过验证

---

## 修复指南

### 某一家突然不工作了

1. 打开 `npm run login <provider>` 弹出的窗口，用开发者工具检查新 DOM
2. 在对应 adapter 的 `S` 对象中，往对应选择器项**添加新的选择器字符串**（放在数组前面优先匹配）
3. 一般不需要修改任何逻辑代码

### 多轮续问返回了上一轮的答案

说明「取最新回答」失败。检查该 adapter 的 `readLatestAnswerText`：
- 应使用 `lastVisible`（`.last()`），而非 `firstVisible`（`.first()`）
- `answer` 选择器**不要用 `:last-of-type`**（它按标签名匹配，不按 class，多轮时取不到最新）
- 续问跳过旧答案的逻辑由 `streamAnswer` 的 `baseline` 参数处理（base.js 在流式前捕获），一般不用改

### 回答总是提前结束或迟迟不结束

调 `config/providers.js` 中该 provider 的 `stabilityWindowMs`：慢的模型调大，快的调小。

### 回答被打印了两遍

`streamAnswer` 已内置 DOM-echo 拦截（`current === last + last` 时跳过）。若仍重复，看日志 `delta` 行的 `lastLen/curLen` 定位是哪家，再修该家的 `answer` 选择器（可能是容器把内容渲染了两份）。
