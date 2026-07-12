# mixai · 四模型并排对比聊天

> 📖 **完整使用手册见 [USAGE.md](USAGE.md)** —— 安装 / 登录 / 运行 / 排障全覆盖，
> 可脱离 AI 独立操作。本 README 仅作快速索引。

本地运行的工具：输入一个问题，**同时**通过 DeepSeek / Doubao / Kimi / ChatGPT 的
**免费网页版**返回四个模型的回答，并排对比。**不使用任何 API key**，靠浏览器自动化
（Playwright）在后台驱动各家网页。仅供个人单机日常使用。

```
你的网页 UI (一个窗口四栏)
      │  POST /api/ask
      ▼
  本地后端 (Express)
      │  并发分发
      ▼
 ┌─────────┬─────────┬─────────┬─────────┐
 │DeepSeek │ Doubao  │  Kimi   │ ChatGPT │  ← 4 个持久化浏览器(各自登录态)
 └─────────┴─────────┴─────────┴─────────┘
      │  逐字流式抓取
      ▼  SSE  /events  →  四栏边答边显示
```

## 快速开始

```bash
npm install
npx playwright install chromium     # 首次需要，下载浏览器内核

# 1) 先登录四家（弹出可见浏览器窗口，你手动登录一次，会话会保存）
npm run login                       # 或只登某几家： node backend/login.js kimi doubao

# 2) 启动
npm start                           # 打开 http://localhost:5173
```

> 登录态保存在 `profiles/<provider>/`（已 gitignore）。掉登录时在对应栏点
> “未登录—打开登录窗口”，或重跑 `npm run login <provider>`。
> 短信验证码 / 扫码 / 人机验证始终由你本人完成，工具不会绕过。

## 目录结构

```
config/providers.js        ← 唯一的"每家配置"：headless、启动参数、stealth 等级、
                              稳定窗口。改 headful↔headless 只动这里。
backend/
  server.js                ← Express：静态页 + SSE /events + 控制接口 + 登录接口
  orchestrator.js          ← 并发分发、会话↔对话映射、按栏串行、故障隔离
  transport.js             ← SSE 事件总线（按栏推 delta / status）
  login.js                 ← 登录/恢复：弹可见窗口、等你登好
  browser/
    contextFactory.js      ← 启动持久化浏览器 + stealth（"怎么启动"只在这里）
    scrape.js              ← 通用流式抓取 + "文本稳定窗口"完成判定
  adapters/
    base.js                ← 共享适配器接口（ensureLoggedIn/ensureChat/send/...）
    deepseek.js kimi.js doubao.js chatgpt.js   ← 每家一个，只装选择器与交互
    util.js index.js
web/                       ← 前端：四栏 UI、统一输入、SSE 客户端
```

## 维护手册（重要：这是会"时不时坏"的工具）

### 某一家突然不工作了 → 多半是它改版、选择器失效

每个适配器顶部都有一个 `S = { ... }` 选择器表，每项是**候选列表**。修复通常只需：
1. 打开 `npm run login <provider>` 弹出的窗口，用开发者工具看新 DOM；
2. 在 `backend/adapters/<provider>.js` 的 `S` 里，往对应项**加一个新的选择器字符串**；
3. 一般不用改任何逻辑。各家互相隔离，改一家不影响其它三家。

需要关注的选择器项：`input`（输入框）、`sendButton`（发送）、`newChat`（新对话）、
`answer`（回答容器）、`stopButton`（生成中信号）、`quota`（限流文案正则）、`loginWall`。

### 回答总是"提前结束"或"迟迟不结束"

调 `config/providers.js` 里该家的 `stabilityWindowMs`（文本停止增长多久算答完）。
慢的模型调大，快的可调小。完成判定还会参考 `stopButton`（停止按钮）作为佐证。

### 掉登录

对应栏会显示 `logged-out`，点栏内按钮打开登录窗口；或 `npm run login <provider>`。
登录成功后会话自动保存回 `profiles/<provider>/`。

### 切 headful ↔ headless（A→B）/ 混合模式

只改 `config/providers.js` 里每家的 `headless: true|false`，**抓取逻辑一行都不用动**。
检测严的 ChatGPT/Doubao 建议保持 `false`（headful）。想彻底隐身又不触发检测，
可后续接入虚拟显示器（xvfb）方案。

### ChatGPT 专属说明（真 Chrome + 代理 + patchright）

ChatGPT 反自动化最严，普通 Playwright Chromium 会卡在 Cloudflare「验证真人」死循环。
本项目对它单独采用：**真实 Google Chrome + patchright（反检测）+ 独立代理**。相关配置都在
`config/providers.js` 的 `chatgpt` 项：

- `engine: 'patchright'` + `channel: 'chrome'` —— 用真 Chrome，绕过 Turnstile。
- `proxy: 'http://127.0.0.1:7890'` —— 国内访问 chatgpt.com 需要。改成你的代理，或设环境变量
  `CHATGPT_PROXY` 覆盖。只有 ChatGPT 走代理，其它三家直连。
- `loginSettleMs: 30000` —— 真 Chrome + 代理 + Cloudflare 加载慢，登录检测给更长的等待窗口。

**已知不稳定**：在短时间内反复自动化启动后，ChatGPT 偶尔仍会被判定为机器人而显示
`logged-out`（其它三家不受影响——这正是“故障隔离”的体现）。遇到时在该栏点重新登录，
或隔一会儿再试。这是浏览器自动化方式对 ChatGPT 的固有代价。

## 边界与已知风险

- 单人、本地、个人使用；无多用户、无托管、无公网部署。
- 各家改版会让选择器失效，需要按上面的手册修——这是本工具的"长期税"。
- ChatGPT 反自动化最严（Cloudflare Turnstile + 指纹），偶尔需要你手动过验证。
- 通过自动化使用网页版可能触及各家服务条款，请自行评估，控制请求频率。
