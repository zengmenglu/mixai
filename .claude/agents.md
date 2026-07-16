# mixai - 项目架构文档

## 项目简介

mixai 是一个本地运行的四模型并排对比聊天工具。输入一个问题，同时通过 DeepSeek、Doubao、Kimi、ChatGPT 的免费网页版获取四个模型的回答并排展示。**不使用任何 API key**，完全靠浏览器自动化（Playwright/Patchright）在后台驱动各家网页。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  web/  (前端 UI)                                         │
│  index.html + app.js + styles.css + vendor/marked.min.js │
│  侧边栏(历史会话) + 四栏并排 + markdown 渲染              │
│  SSE 实时接收流式回答                                     │
└──────────────────────┬───────────────────────────────────┘
                       │ POST /api/ask    GET /events (SSE)
                       ▼
┌──────────────────────────────────────────────────────────┐
│  backend/server.js  (Express 服务，仅监听 127.0.0.1)      │
│  - 静态文件托管 (web/)                                    │
│  - SSE 事件流 (/events)                                   │
│  - 控制接口 (/api/ask, /api/new-conversation,            │
│              /api/login/:id, /api/stop/:id, /api/providers)│
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────┐
│ orchestrator│ │transport │ │ login.js     │
│  并发分发    │ │ SSE 总线 │ │ 登录/恢复     │
│  故障隔离    │ │ 按栏推送 │ │ 手动登录      │
│ stop/会话恢复│ │          │ │              │
└──────┬──────┘ └──────────┘ └──────────────┘
       │ fan-out 4 adapters concurrently (AbortController per turn)
       ▼
┌──────────────────────────────────────────────────────────┐
│  backend/adapters/                                       │
│  ┌──────────┬──────────┬──────────┬──────────┐          │
│  │deepseek  │ doubao   │  kimi    │ chatgpt  │          │
│  │.js       │ .js      │  .js     │ .js      │          │
│  └──────────┴──────────┴──────────┴──────────┘          │
│  base.js (共享接口)    index.js (注册表)    util.js      │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│contextFactory│ │  scrape.js   │ │ config/providers │
│ 启动持久化    │ │  流式抓取    │ │  每 provider 配置 │
│ stealth 注入 │ │  完成判定    │ │  headless/stealth │
│ 自愈重连      │ │  baseline   │ │                  │
└──────────────┘ └──────────────┘ └──────────────────┘

  backend/log.js            结构化日志（级别 + provider 标签 + 可选 LOG_FILE）
  web/vendor/marked.min.js  回答 markdown 渲染（表格/代码/列表）
```

### 核心设计原则

- **故障隔离**：每个 provider 独立 try/catch，一家崩溃不影响其他三家
- **启动/抓取解耦**：contextFactory 管浏览器启动，scrape.js 管流式抓取，adapter 只管页面交互
- **Per-pane 串行**：同一 provider 内问题按序执行，不同 provider 间并发
- **SSE 单向推送**：服务端 -> 客户端用 SSE，控制指令用 HTTP POST
- **仅本地监听**：Express 绑定 `127.0.0.1`，不暴露到局域网

### 生命周期与数据流

**浏览器生命周期**：
- 服务启动（`npm start`）时**立即并行打开** 4 个 provider 浏览器窗口
- `Orchestrator.launchAll()` 在服务启动时被调用，并发启动所有浏览器；失败仅记录日志并向前端推 `error`，不崩溃
- `launch()` 用 `isClosed()` + 一次带超时的探活检测页面存亡；`#watchClose` 监听 `page/context` 的 `close` 事件主动清空引用。窗口被关或浏览器崩溃后，下一轮自动重建，不抛 `Target page closed`
- 浏览器窗口通过 `launchPersistentContext` + `userDataDir` 保持登录态
- 浏览器关闭发生在进程退出、显式 `close()`、或用户关窗口（随后自愈重建）时

> **设计意图**：服务启动即预热所有窗口，确保用户首次提问时无需等待浏览器冷启动。

**单次问答流程**：

```
用户输入问题
  -> POST /api/ask { question, providers?, resumeUrls? }
    -> Orchestrator.ask() 并发 fan-out（每 pane 一个 AbortController，支持终止）
      -> #runPane: 若有 resumeUrl 且当前 URL 不同，先 page.goto(resumeUrl) 恢复原对话
      -> Adapter.ask(question, mode, signal) 内部流程:
        1. launch() 复用存活浏览器，或自愈重建
        2. waitLoggedIn() 检查登录态；失败则 reload 一次重试
        3. ensureChat(mode) 新建/复用对话
        4. send(question) 输入并发送
        5. 捕获 baseline（上一轮回答文本）-> streamAnswer() 流式抓取
           （跳过 baseline 旧文本；text-stability + isStreaming 完成判定）
        6. done 事件携带 full + 当前 page.url()（供会话恢复）
      -> delta/status 通过 hub 推送 SSE；前端 markdown 渲染并持久化到会话
```

### 日志体系

`backend/log.js` 提供结构化日志（`log` 全局 + `plog(tag)` 按标签）。级别由 `LOG_LEVEL` 控制（debug/info/warn/error，默认 info），`LOG_FILE` 可同时写文件（`*.log` 已 gitignore）。全链路埋点：浏览器启动、登录检测、发送、每个 delta、完成、终止、错误。排障第一件事看日志。

### 会话历史与真正续接

- 前端左侧栏列出 localStorage 中的历史会话，点击加载往期 Q&A。
- 每轮回答完成时捕获该模型对话 URL（`done` 事件的 `url`），存入会话 `chatUrls`。
- 在历史会话上继续追问时，`/api/ask` 带上 `resumeUrls`；后端 `#runPane` 仅在当前 `page.url()` 与目标不同时才 `goto`（同会话续问零开销，切历史会话才导航），AI 真正记得原上下文。

### 每栏终止（stop）

每栏底部「✕ 终止回答」按钮 -> `POST /api/stop/:id` -> `Orchestrator.stop(id)` 调 `controller.abort()` 中断该 pane 的 `streamAnswer`，并调 `adapter.stopGenerating()` 点击该网站停止按钮释放输入框。被终止 pane 状态变 `stopped`，不阻塞其他 pane 下一轮。

### Markdown 渲染

`web/vendor/marked.min.js`（marked v12，GFM）把回答渲染为 HTML（表格/代码/列表/引用）。`renderAnswer` 在每个 delta 重渲染，`sanitizeHtml` 剔除 `script/iframe/on*/javascript:` 防 XSS。完成时的「全文回填」只在干净超集时覆盖，避免重复。

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `context-factory.js`, `deepseek.js` |
| 函数/方法 | camelCase | `ensureLoggedIn()`, `readLatestAnswerText()` |
| 变量 | camelCase | `stabilityWindowMs`, `userDataDir` |
| 类名 | PascalCase | `BaseAdapter`, `Orchestrator`, `DeepSeekAdapter` |
| 常量 | UPPER_SNAKE | `PROFILES_DIR`, `PROVIDER_IDS`, `WEB_DIR` |
| 私有方法 | `#` 前缀 | `#runPane()`, `#watchClose()` |
| 布尔变量 | `is`/`has`/`should` 前缀 | `isStreaming`, `hasChat` |
| 状态枚举 | kebab-case 字符串 | `'streaming'`, `'done'`, `'stopped'`, `'logged-out'` |

## 异常处理

### 原则
- **外层兜底**：Orchestrator 的 `#runPane()` 用 try/catch 包裹整个 adapter 调用，catch 后通过 `hub.status(id, 'error')` 通知前端
- **内层抛出**：Adapter 方法遇到不可恢复错误直接 throw，由外层统一处理
- **永不崩溃**：SSE 连接断开时 `res.write()` 抛错，hub 内部 try/catch swallow 并自动 detach

### 典型模式
```javascript
// Orchestrator 层：隔离 per-pane 故障
try {
  for await (const ev of adapter.ask(question, mode, signal)) { /* ... */ }
} catch (err) {
  hub.status(adapter.id, 'error', { message: String(err.message) });
}

// Adapter 层：可恢复错误静默处理
await this.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
await this.context.close().catch(() => {});
```

### 错误分级
- **ERROR**：adapter 抛错 -> 该 pane 显示 error 状态
- **WARN**：登录态失效 -> 该 pane 显示 logged-out
- **INFO**：配额耗尽 -> 该 pane 显示 unavailable

## 可用能力

| 命令 | 说明 |
|------|------|
| `npm start` | 启动后端服务，监听 127.0.0.1:5173 |
| `npm run login` | 打开四家登录窗口（headful），手动登录保存会话 |
| `npm run login <provider>` | 只登录指定 provider，如 `npm run login kimi` |
| `node scripts/diagnose.js` | 诊断脚本：检查依赖、浏览器内核、profiles 状态 |
| `node scripts/diagnose.js <provider>` | 只诊断某一家，截图到 /tmp/mixai-shots |
| `LOG_LEVEL=debug npm start` | 详细日志；`LOG_FILE=x.log` 同时写文件 |

> 完整使用手册见 [USAGE.md](file://USAGE.md)（安装/登录/运行/排障）。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 获取 provider 列表 [{id, label}] |
| GET | `/events` | SSE 流，接收 per-pane delta/status 事件 |
| POST | `/api/ask` | 提交问题 `{question, providers?, resumeUrls?}`，火后不理 |
| POST | `/api/new-conversation` | 重置所有 provider 对话（pane.started=false） |
| POST | `/api/login/:id` | 为指定 provider 打开登录窗口（先 closeProvider 释放 profile 锁） |
| POST | `/api/stop/:id` | 终止指定 provider 当前回答（不影响其他 pane） |

## 关键约束

1. **单用户本地运行**：无多用户、无托管、无公网部署；Express 仅监听 `127.0.0.1`
2. **无 API key**：不接入任何付费 API，只用免费网页版
3. **无数据外泄**：应用代码只联系 4 家 AI 网站 + 本地代理 + localhost；`profiles/`（登录会话）从不被读取或外传，仅作为 Playwright userDataDir
4. **headless flag 仅在 `config/providers.js` 中修改**：adapter 文件中绝不硬编码 headless 配置
5. **adapter 与 launch 逻辑严格解耦**：adapter 只接收已启动的 page，不关心浏览器如何启动
6. **不绕过人机验证**：验证码/SMS/扫码始终由用户手动完成
7. **选择器维护是长期成本**：各 AI 网站改版时只需修改对应 adapter 顶部的 `S` 选择器表
8. **`profiles/` 绝不提交**：已在 .gitignore 中排除，profiles 目录包含浏览器持久化会话
9. **ChatGPT 专属处理**：使用 patchright + 真实 Chrome + 独立代理，不走标准 Playwright Chromium
