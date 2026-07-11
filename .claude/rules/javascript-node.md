# JavaScript/Node.js 语言框架规范 (L2)

> 适用本项目及同类 Node.js + Express + Playwright 技术栈的项目。**强制执行，违反即 ERROR。**

---

## R1: 使用 ES Modules

### 规则
所有代码必须使用 ES Modules（`import`/`export`），禁止 CommonJS（`require`/`module.exports`）。

### 说明
本项目 `package.json` 已设置 `"type": "module"`。

### 示例
```javascript
// BAD
const express = require('express');
module.exports = { foo };

// GOOD
import express from 'express';
export { foo };
```

---

## R2: 异步操作统一 async/await

### 规则
所有异步操作必须使用 `async/await`，禁止回调嵌套和裸 Promise chain。

### 示例
```javascript
// BAD
fs.readFile(path, (err, data) => { /* ... */ });

// GOOD
const data = await fs.promises.readFile(path);
```

### 例外
- EventEmitter 的 `.on()` 回调允许同步写法
- SSE `req.on('close', ...)` 允许回调写法

---

## R3: try/catch 必须捕获具体错误

### 规则
`try/catch` 中捕获的错误必须记录或处理，禁止空 catch 块无声吞咽错误。

### 示例
```javascript
// BAD
try { await riskyOp(); } catch {}

// GOOD
try {
  await riskyOp();
} catch (err) {
  console.error('riskyOp failed:', err.message);
  // 或重新抛出、或返回 fallback
}

// ACCEPTABLE（静默忽略的恢复性操作必须有注释说明）
await this.context.close().catch(() => {}); // close() 在 context 已关闭时会抛错，忽略即可
```

---

## R4: 公共 API 用 JSDoc 标注

### 规则
文件顶部导出的公共函数/类/方法必须有 JSDoc 标注参数和返回值。

### 示例
```javascript
/**
 * Launch (or reopen) the persistent context for a provider.
 * @param {object} cfg one entry from config/providers.js
 * @returns {Promise<{ context: BrowserContext, page: Page }>}
 */
export async function launchProviderContext(cfg) { /* ... */ }
```

---

## R5: Express 路由保持 RESTful

### 规则
Express 路由命名遵循 RESTful 风格：
- 资源名用名词复数
- 操作通过 HTTP 方法区分（GET 读、POST 写、PUT 更新、DELETE 删）
- 路径用 kebab-case

### 示例
```javascript
// GOOD
app.get('/api/providers', ...);          // 列表
app.post('/api/ask', ...);              // 提交问题
app.post('/api/new-conversation', ...); // 新建对话
app.post('/api/login/:id', ...);        // 登录指定 provider
```

---

## R6: 私有类成员使用 # 前缀

### 规则
类的私有方法/字段使用 JavaScript 原生 `#` 语法，而非 `_` 约定。

### 示例
```javascript
// GOOD
class Orchestrator {
  #runPane(pane, question) { /* ... */ }
}

// BAD
class Orchestrator {
  _runPane(pane, question) { /* ... */ }
}
```

---

## R7: const 优先，禁止 var

### 规则
- 不变变量用 `const`，可变变量用 `let`，禁止 `var`
- 默认使用 `const`，仅在确实需要重新赋值时用 `let`

### 示例
```javascript
// BAD
var port = 5173;
let PORT = 5173;  // 不变的常量应用 const

// GOOD
const PORT = 5173;
let currentRetry = 0;  // 需要重新赋值
```

---

## R8: 使用可选链和空值合并

### 规则
- 深层属性访问使用可选链 `?.` 替代多层 `&&` 判断
- 默认值使用空值合并 `??` 替代 `||`（避免 `0`、`''`、`false` 被误判）

### 示例
```javascript
// BAD
const name = user && user.profile && user.profile.name;
const count = value || 10;  // value=0 也会返回 10

// GOOD
const name = user?.profile?.name;
const count = value ?? 10;  // 只有 null/undefined 才用默认值
```

---

## R9: 模板字面量优先

### 规则
字符串拼接使用模板字面量（反引号），禁止 `+` 拼接多段字符串。

### 示例
```javascript
// BAD
const url = 'http://' + host + ':' + port + '/api';

// GOOD
const url = `http://${host}:${port}/api`;
```

---

## R10: 数组方法优先于传统循环

### 规则
数组遍历优先使用 `map`/`filter`/`reduce`/`forEach`/`find`/`some`/`every`，避免 `for (let i=0; ...)`。

### 示例
```javascript
// BAD
const ids = [];
for (let i = 0; i < items.length; i++) {
  ids.push(items[i].id);
}

// GOOD
const ids = items.map(item => item.id);
```

### 例外
- 需要 `break`/`continue` 提前退出时允许 `for...of`
- 性能敏感的热路径在 benchmark 证明后可例外

---

## R11: 使用解构和默认参数

### 规则
- 函数参数超过 2 个时使用对象参数 + 解构
- 参数默认值在解构中直接指定

### 示例
```javascript
// BAD
function launch(headless, stealthLevel, userDataDir, proxy) { /* ... */ }

// GOOD
function launch({ headless = false, stealthLevel = 'standard', userDataDir, proxy } = {}) {
  /* ... */
}
```

---

## R12: Early Return 优先于深层嵌套

### 规则
使用 early return（卫语句）减少嵌套层级，最大嵌套不超过 3 层。

### 示例
```javascript
// BAD
function process(data) {
  if (data) {
    if (data.valid) {
      if (data.items) {
        return handle(data.items);
      }
    }
  }
  return null;
}

// GOOD
function process(data) {
  if (!data?.valid) return null;
  if (!data.items) return null;
  return handle(data.items);
}
```

---

## R13: 禁止魔法数字

### 规则
数字字面量（除 0、1、-1）必须定义为命名常量。

### 示例
```javascript
// BAD
if (status === 429) { /* ... */ }
setTimeout(check, 12000);

// GOOD
const HTTP_TOO_MANY_REQUESTS = 429;
const LOGIN_CHECK_TIMEOUT_MS = 12_000;
if (status === HTTP_TOO_MANY_REQUESTS) { /* ... */ }
setTimeout(check, LOGIN_CHECK_TIMEOUT_MS);
```

### 例外
- 数组索引、循环计数器
- 数学常量（`Math.PI`）
- 已在 JSDoc 中明确说明的数字
