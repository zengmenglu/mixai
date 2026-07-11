# mixai — 项目架构文档

## 项目简介

mixai 是一个本地运行的四模型并排对比聊天工具。输入一个问题，同时通过 DeepSeek、Doubao、Kimi、ChatGPT 的免费网页版获取四个模型的回答并排展示。**不使用任何 API key**，完全靠浏览器自动化（Playwright/Patchright）在后台驱动各家网页。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  web/  (前端 UI)                                         │
│  index.html + app.js + styles.css                        │
│  四栏并排展示，SSE 实时接收流式回答                        │
└──────────────────────┬───────────────────────────────────┘
                       │ POST /api/ask    GET /events (SSE)
                       ▼
┌──────────────────────────────────────────────────────────┐
│  backend/server.js  (Express 服务)                        │
│  - 静态文件托管 (web/)                                    │
│  - SSE 事件流 (/events)                                   │
│  - 控制接口 (/api/ask, /api/new-conversation,            │
│              /api/login/:id, /api/providers)              │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────┐
│ orchestrator│ │transport │ │ login.js     │
│  并发分发    │ │ SSE 总线 │ │ 登录/恢复     │
│  故障隔离    │ │ 按栏推送 │ │ 半自动填充    │
└──────┬──────┘ └──────────┘ └──────────────┘
       │ fan-out 4 adapters concurrently
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
└──────────────┘ └──────────────┘ └──────────────────┘
```

### 核心设计原则

- **故障隔离**：每个 provider 独立 try/catch，一家崩溃不影响其他三家
- **启动/抓取解耦**：contextFactory 管浏览器启动，scrape.js 管流式抓取，adapter 只管页面交互
- **Per-pane 串行**：同一 provider 内问题按序执行，不同 provider 间并发
- **SSE 单向推送**：服务端 → 客户端用 SSE，控制指令用 HTTP POST

### 生命周期与数据流

**浏览器生命周期**：
- 服务启动（`npm start`）时**立即并行打开** 4 个 provider 浏览器窗口
- `Orchestrator.launchAll()` 在服务启动时被调用，并发启动所有浏览器
- `launch()` 内部有 `if (this.page) return` 守卫，窗口打开后持久复用
- 浏览器窗口通过 `launchPersistentContext` + `userDataDir` 保持登录态
- 浏览器关闭仅发生在进程退出或显式调用 `close()` 时

> **设计意图**：服务启动即预热所有窗口，确保用户首次提问时无需等待浏览器冷启动。启动失败（如未登录）不影响服务运行，仅记录日志。

**单次问答流程**：

```
用户输入问题
  → POST /api/ask { question }
    → Orchestrator.ask() 并发 fan-out 到 4 个 adapter
      → Adapter.ask() 内部流程:
        1. launch() 延迟初始化（首次）或复用已有浏览器
        2. ensureLoggedIn() 检查登录态（轮询 waitLoggedIn）
        3. ensureChat(mode) 打开新对话或复用已有聊天
        4. send(question) 输入问题并点击发送
        5. streamAnswer() 流式抓取回答（text-stability 完成判定）
      → 每次 delta 通过 hub.delta() 推送 SSE
    → 用户 UI 实时收到各栏 delta 更新
```

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `context-factory.js`, `deepseek.js` |
| 函数/方法 | camelCase | `ensureLoggedIn()`, `readLatestAnswerText()` |
| 变量 | camelCase | `stabilityWindowMs`, `userDataDir` |
| 类名 | PascalCase | `BaseAdapter`, `Orchestrator`, `DeepSeekAdapter` |
| 常量 | UPPER_SNAKE | `PROFILES_DIR`, `PROVIDER_IDS`, `WEB_DIR` |
| 私有方法 | `#` 前缀 | `#runPane()` |
| 布尔变量 | `is`/`has`/`should` 前缀 | `isStreaming`, `hasChat` |
| 事件类型 | kebab-case 字符串 | `'logged-out'`, `'new-conversation'` |

## 异常处理

### 原则
- **外层兜底**：Orchestrator 的 `#runPane()` 用 try/catch 包裹整个 adapter 调用，catch 后通过 `hub.status(id, 'error')` 通知前端
- **内层抛出**：Adapter 方法遇到不可恢复错误直接 throw，由外层统一处理
- **永不崩溃**：SSE 连接断开时 `res.write()` 抛错，hub 内部 try/catch swallow 并自动 detach

### 典型模式
```javascript
// Orchestrator 层：隔离 per-pane 故障
try {
  for await (const ev of adapter.ask(question, mode)) { /* ... */ }
} catch (err) {
  hub.status(adapter.id, 'error', { message: String(err.message) });
}

// Adapter 层：可恢复错误静默处理
await this.page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
await this.context.close().catch(() => {});
```

### 错误分级
- **ERROR**：adapter 抛错 → 该 pane 显示 error 状态
- **WARN**：登录态失效 → 该 pane 显示 logged-out
- **INFO**：配额耗尽 → 该 pane 显示 unavailable

## 可用能力

| 命令 | 说明 |
|------|------|
| `npm start` | 启动后端服务，监听 localhost:5173 |
| `npm run login` | 打开四家登录窗口（headful），手动登录保存会话 |
| `npm run login <provider>` | 只登录指定 provider，如 `npm run login kimi` |
| `node scripts/diagnose.js` | 诊断脚本：检查依赖、浏览器内核、profiles 状态 |
| `node scripts/e2e.js` | 端到端测试：验证四家 workflows |

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/providers` | 获取 provider 列表 [{id, label}] |
| GET | `/events` | SSE 流，接收 per-pane delta/status 事件 |
| POST | `/api/ask` | 提交问题 `{question}`，火后不理 |
| POST | `/api/new-conversation` | 重置所有 provider 对话 |
| POST | `/api/login/:id` | 为指定 provider 打开登录窗口 |

## 关键约束

1. **单用户本地运行**：无多用户、无托管、无公网部署
2. **无 API key**：不接入任何付费 API，只用免费网页版
3. **headless flag 仅在 `config/providers.js` 中修改**：adapter 文件中绝不硬编码 headless 配置
4. **adapter 与 launch 逻辑严格解耦**：adapter 只接收已启动的 page，不关心浏览器如何启动
5. **不绕过人机验证**：验证码/SMS/扫码始终由用户手动完成
6. **选择器维护是长期成本**：各 AI 网站改版时只需修改对应 adapter 顶部的 `S` 选择器表
7. **`profiles/` 绝不提交**：已在 .gitignore 中排除，profiles 目录包含浏览器持久化会话
8. **ChatGPT 专属处理**：使用 patchright + 真实 Chrome + 独立代理，不走标准 Playwright Chromium
