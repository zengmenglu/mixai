# 通用基础规范 (L1)

> 适用所有项目，跨技术栈、跨业务的基础约束。**强制执行，违反即 ERROR。**

---

## R1: 代码必须有注释

### 规则
所有函数、类、关键逻辑分支必须有注释说明意图。

### 要求
- **函数/方法**：必须有 JSDoc 注释，至少包含功能描述
- **类**：必须有类级别 JSDoc，说明职责
- **关键逻辑**：复杂算法、非常规写法、workaround 必须有行内注释

### 示例

```javascript
// BAD
function calc(a, b) { return a * b + a; }

// GOOD
/** Calculate total price with tax. @param {number} price @param {number} taxRate @returns {number} */
function calculateTotal(price, taxRate) {
  return price * taxRate + price;
}
```

---

## R2: 函数不超过 50 行

### 规则
单个函数/方法体（不含注释和空行）不超过 50 行。

### 说明
- 超过 50 行的函数必须拆分，抽取子函数
- 如果确实无法拆分（如 switch-case 映射表），需在函数头部注释说明原因

---

## R3: 禁止硬编码密钥

### 规则
代码中禁止出现明文密钥、token、密码、API key 等敏感信息。

### 检测模式
- 包含 `password`、`secret`、`token`、`api_key`、`apikey`、`credential`、`auth` 的赋值
- 数据库连接字符串包含用户名密码
- 任何形式的硬编码认证凭据

### 正确做法
```javascript
// BAD
const apiKey = 'sk-abc123xyz';

// GOOD
const apiKey = process.env.API_KEY;
```

---

## R4: 命名要有意义

### 规则
变量、函数、类命名必须见名知意，禁止无意义缩写和单字母变量。

### 例外
- 循环索引 `i`, `j`, `k` 允许使用单字母
- 回调参数 `_` 表示有意不使用
- 解构占位 `_` 表示忽略

### 示例
```javascript
// BAD
const d = new Date();
function p(u) { /* ... */ }

// GOOD
const currentDate = new Date();
function parseUserInput(userInput) { /* ... */ }
```

---

## R5: 禁止 console.log 用于生产日志

### 规则
生产代码中禁止使用 `console.log` 输出日志。使用结构化日志方案。

### 说明
- 本项目当前为单用户本地工具，`console.log` 可用于开发调试
- 但如果代码中存在正式日志输出，应使用统一日志模块而非裸 `console.log`

---

## R6: DRY 原则

### 规则
重复代码必须抽取为函数/模块。同一逻辑出现 2 次以上应重构。

### 示例
```javascript
// BAD: 重复的选择器查询逻辑
const btn1 = await page.$('.send-btn');
const btn2 = await page.$('.submit-btn');

// GOOD: 抽取公共方法
async function findFirst(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}
```

---

## R7: Commit 信息格式

### 规则
所有 git commit 必须遵循 Conventional Commits 格式，允许中文描述。

### 格式
```
<type>(<scope>): <简要描述>
```

### type 类型
| type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(adapter): 新增 Grok provider 适配器` |
| `fix` | 修复 bug | `fix(scrape): 修复稳定性窗口提前终止的问题` |
| `docs` | 文档变更 | `docs(adapters): 更新 Doubao 选择器文档` |
| `refactor` | 重构（不改变功能） | `refactor(orchestrator): 抽取 launchAll 方法` |
| `chore` | 构建/工具/依赖 | `chore(deps): 升级 playwright 到 1.46` |
| `style` | 格式（不影响逻辑） | `style(web): 统一缩进为 2 空格` |
| `test` | 测试 | `test(e2e): 新增 Kimi 流式输出验证用例` |

### scope 范围
本项目常用 scope：`adapter`、`browser`、`server`、`orchestrator`、`config`、`web`、`docs`、`harness`、`deps`

### 要求
- 描述用中文，简洁概括本次变更（不超过 72 字符）
- 一个 commit 只做一件事，避免 `feat + fix` 混合提交
- 描述以动词开头，如「新增」「修复」「重构」「移除」
- 禁止空 commit message 或无意义的 `update`、`fix bug`
