# 浏览器自动化架构规范 (L3)

> 适用本项目及同类浏览器自动化抓取项目。**强制执行，违反即 ERROR。**

---

## R1: Adapter 接口契约

### 规则
每个 provider adapter 必须实现 `BaseAdapter` 定义的以下方法：

| 方法 | 职责 | 返回值 |
|------|------|--------|
| `ensureLoggedIn()` | 检测当前页面是否已登录 | `Promise<boolean>` |
| `ensureChat(mode)` | 确保聊天窗口可用（新建/复用） | `Promise<void>` |
| `send(question)` | 在输入框填入问题并发送 | `Promise<void>` |
| `readLatestAnswerText()` | 读取当前最新回答的完整文本 | `Promise<string>` |
| `isStreaming()` | 检测模型是否仍在生成中（可选） | `Promise<boolean>` |
| `isQuotaExhausted()` | 检测是否触发限流/配额耗尽（可选） | `Promise<boolean>` |

### 检查
- 新增 adapter 必须 `extends BaseAdapter`
- 必须覆盖所有 marked `throw new Error('not implemented')` 的方法
- 可选方法（`isStreaming`/`isQuotaExhausted`）已有默认实现，按需覆盖

---

## R2: 选择器集中管理

### 规则
每个 adapter 文件顶部必须有一个 `const S = { ... }` 选择器表，集中存储所有 DOM 选择器。

### 要求
- 每个选择器项是**字符串数组**（候选列表），按优先级排列
- 选择器变更只修改 `S` 对象，不修改选择逻辑
- 命名清晰：`input`, `sendButton`, `newChat`, `answer`, `stopButton`, `quota`, `loginWall`

### 示例
```javascript
const S = {
  input: [
    'textarea[placeholder*="问题"]',
    '#chat-input',
  ],
  sendButton: [
    'button[data-testid="send"]',
    '.send-btn',
  ],
  answer: [
    '.message-content',
    '.response-text',
  ],
};
```

---

## R3: 启动/抓取严格解耦

### 规则
- **contextFactory.js**：专注浏览器启动（headless、stealth、userDataDir、proxy）
- **scrape.js**：专注流式抓取与完成判定（text-stability window）
- **adapter/**：专注页面交互（选择器、点击、输入、读取）

### 禁止
- adapter 中设置 `headless` 或 launchOptions
- adapter 中引入 stealth 脚本
- scrape.js 中硬编码具体 provider 的选择器

---

## R4: SSE 事件格式规范

### 规则
所有通过 SSE 推送的事件必须遵循统一格式。

### 格式
```javascript
// Delta 事件（流式文本增量）
{ type: 'delta', pane: '<provider-id>', text: '...' }

// Status 事件（状态变更）
{ type: 'status', pane: '<provider-id>', status: '<status>' }

// System 事件（全局通知）
{ type: 'system', message: '...' }
```

### 状态枚举
| 状态 | 含义 |
|------|------|
| `idle` | 空闲等待 |
| `streaming` | 正在接收回答 |
| `done` | 回答完成 |
| `unavailable` | 配额耗尽/限流 |
| `logged-out` | 未登录/登录过期 |
| `stopped` | 用户手动终止（stop 按钮） |
| `error` | 发生错误 |

---

## R5: 故障隔离原则

### 规则
每个 provider 的整个调用链必须在独立的 try/catch 中执行，一个失败不影响其他。

### 实现位置
`orchestrator.js` 的 `#runPane()` 方法是最外层隔离边界。

### 检查
- 不允许 adapter 之间相互调用
- 不允许一个 adapter 的异常传播到其他 adapter
- 异常通过 `hub.status(id, 'error')` 通知前端

---

## R6: 完成判定：text-stability + 辅助信号

### 规则
回答完成判定采用双信号机制：
1. **主信号**：回答文本长度在 `stabilityWindowMs` 内不变 → 判定完成
2. **辅助信号**：发送/停止按钮状态、流式光标消失 → 增加置信度

### 配置
`stabilityWindowMs` 在 `config/providers.js` 中按 provider 配置，不在代码中硬编码。
