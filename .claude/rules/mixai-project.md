# mixai 项目专属规范 (L4)

> 仅适用于 mixai 项目，**强制执行，违反即 ERROR**。

---

## 完整目录结构与职责

以下目录职责已固定，新增文件必须在对应目录，禁止随意创建顶级目录。

```
mixai/
├── README.md                     ← 项目简介 + 快速索引（指向 USAGE.md）
├── USAGE.md                      ← 完整使用手册（安装/登录/运行/排障，可脱离 AI）
├── config/
│   └── providers.js              ← 集中配置：headless、stealthLevel、stabilityWindowMs
├── backend/
│   ├── server.js                 ← Express 入口：路由 + SSE + 静态托管
│   ├── orchestrator.js           ← 并发分发 + per-pane 串行 + 故障隔离 + stop/abort
│   ├── transport.js              ← SSE 事件总线（Hub 单例）
│   ├── log.js                    ← 结构化日志模块（级别 + provider 标签 + 可选文件）
│   ├── login.js                  ← 登录/恢复：弹窗引导用户手动登录
│   ├── adapters/
│   │   ├── base.js               ←   共享适配器接口（必须继承）
│   │   ├── index.js              ←   适配器注册表
│   │   ├── util.js               ←   公共工具函数
│   │   ├── deepseek.js           ←   DeepSeek 选择器与交互
│   │   ├── kimi.js               ←   Kimi 选择器与交互
│   │   ├── doubao.js             ←   Doubao 选择器与交互
│   │   └── chatgpt.js            ←   ChatGPT 选择器与交互
│   └── browser/
│       ├── contextFactory.js     ←   浏览器启动 + stealth 注入
│       └── scrape.js             ←   流式抓取 + text-stability 完成判定
├── web/
│   ├── index.html                ← 前端 UI：四栏对比
│   ├── app.js                    ← SSE 客户端 + 交互逻辑
│   └── styles.css                ← 样式
├── scripts/
│   ├── diagnose.js               ← 诊断：依赖/内核/profiles/端口检查
│   └── e2e.js                    ← 端到端测试
├── profiles/                     ← 浏览器持久化会话（不提交）
│   ├── deepseek/
│   ├── kimi/
│   ├── doubao/
│   └── chatgpt/
├── .claude/                      ← ═════ AI 工程体系（Harness）═════
│   ├── agents.md                 ←   架构感知层：项目全貌文档
│   ├── rules/                    ←   能力提供层：编码规范
│   │   ├── general-basics.md     ←     L1 通用基础
│   │   ├── javascript-node.md    ←     L2 语言框架
│   │   ├── browser-automation.md ←     L3 业务架构
│   │   └── mixai-project.md      ←     L4 项目专属（本文件）
│   ├── skills/                   ←   能力提供层：可复用 skill
│   │   ├── code-review/SKILL.md  ←     代码审查
│   │   ├── build-check/SKILL.md  ←     构建检查
│   │   ├── deploy-run/SKILL.md   ←     部署运行
│   │   ├── gen-commit/SKILL.md   ←     Commit 信息生成
│   │   ├── gen-docs/SKILL.md     ←     文档生成
│   │   └── openspec-*/           ←     OpenSpec 工作流
│   ├── commands/                 ←   能力提供层：快捷命令
│   │   ├── opsx/                 ←     OpenSpec 命令
│   │   └── dev/                  ←     开发命令
│   └── settings.json             ←   Qoder 规则与插件配置
├── openspec/                     ← 需求/设计/任务文档
│   ├── changes/
│   └── specs/
└── docs/                         ← 自动生成文档（由 gen-docs skill 生成）
    └── adapters.md               ←   Provider 适配器维护手册
```

### 目录禁止事项
- 禁止在项目根目录散放 `.js` 文件（脚本放 `scripts/`）
- 禁止在 `backend/` 下创建与现有模块职责重叠的新目录
- 禁止绕过 `.claude/` 结构创建新的 AI 配置目录

---

## R1: 新增 Provider 五步流程（含文档）

### 规则
新增一个 AI provider 必须严格按照以下 5 步操作：

1. **创建 adapter 文件**：`backend/adapters/<provider>.js`
   - 继承 `BaseAdapter`
   - 实现所有必需方法
   - 在文件顶部定义 `const S = { ... }` 选择器表

2. **注册 adapter**：在 `backend/adapters/index.js` 中
   - 导入 adapter class
   - 在 `CLASSES` 映射中添加 `provider: AdapterClass`

3. **添加配置**：在 `config/providers.js` 中
   - 添加 `providers.<provider>` 配置项
   - 设置 `headless`、`stealthLevel`、`stabilityWindowMs` 等参数

4. **更新架构文档**：在 `.claude/agents.md` 中
   - 在架构图 adapter 层添加新 provider
   - 更新「可用能力」中登录命令的 provider 列表
   - 更新本文件的目录树

5. **更新 Adapter 维护文档**（强制）：运行 `/gen-docs adapter`
   - 自动扫描新增 adapter 的 `S` 选择器表
   - 更新 `docs/adapters.md` 维护手册
   - 记录该 provider 的特殊处理逻辑

### 检查
不允许跳过任何一步，第 4/5 步文档更新和第 1-3 步代码变更必须在同一个 PR/commit 中完成。

---

## R2: headless/headful 只在 config 中修改

### 规则
`headless: true|false` 的修改**只能**在 `config/providers.js` 中进行。

### 禁止
- adapter 文件中硬编码 headless 参数
- contextFactory.js 中强制覆盖 headless
- 任何其他文件中出现 `headless:` 配置

### 说明
这是架构的核心解耦点，确保 A→B（headful→headless）切换是一行配置变更。

---

## R3: profiles/ 目录绝不提交

### 规则
`profiles/` 目录包含完整的浏览器持久化会话（含登录态 cookie），已加入 `.gitignore`。

### 强制要求
- 绝不能移除 `profiles/` 的 gitignore 规则
- 不能在 profiles 目录中添加任何需提交的配置文件
- 需要共享的配置应放在 `config/` 目录

---

## R4: ChatGPT 专属处理路径

### 规则
ChatGPT 使用独立的自动化路径，不走标准 Playwright 流程：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `engine` | `'patchright'` | 反检测版 Playwright |
| `channel` | `'chrome'` | 真实 Google Chrome |
| `stealthLevel` | `'none'` | patchright 自带 stealth |
| `proxy` | `http://127.0.0.1:7890` | 独立代理 |
| `loginSettleMs` | `30000` | 更长登录等待 |

### 约束
- ChatGPT adapter 不添加 initScript（与 patchright 冲突）
- ChatGPT adapter 不设置 viewport lock（保持真实指纹）
- ChatGPT adapter 不修改 UA（保持真实 Chrome UA）

### 环境变量
- `CHATGPT_PROXY` 可覆盖代理地址，无需修改代码
