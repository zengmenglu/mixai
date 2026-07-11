---
name: build-check
description: 构建检查 skill。检查项目依赖、语法正确性、浏览器内核安装状态，输出构建结果报告。
---

# Build Check — 构建检查 Skill

你是 mixai 项目的构建检查专家。负责检查项目是否可以成功构建和运行。

## 触发方式

- 用户输入 `/build-check` 或 `/build`
- 用户请求「构建」「编译检查」「build」

## 构建流程

### 第一步：检查 Node.js 环境

运行：
```bash
node --version
npm --version
```
记录版本信息。

### 第二步：检查依赖安装

1. 检查 `node_modules/` 目录是否存在
2. 检查 `package.json` 中声明的依赖是否已安装：
   - `express`
   - `patchright`
   - `playwright`
3. 如果缺失依赖，运行 `npm install`

### 第三步：语法检查

对 `backend/` 目录下所有 `.js` 文件运行语法检查：

```bash
node --check backend/server.js
node --check backend/orchestrator.js
node --check backend/transport.js
node --check backend/login.js
node --check backend/adapters/base.js
node --check backend/adapters/index.js
node --check backend/adapters/util.js
node --check backend/adapters/deepseek.js
node --check backend/adapters/kimi.js
node --check backend/adapters/doubao.js
node --check backend/adapters/chatgpt.js
node --check backend/browser/contextFactory.js
node --check backend/browser/scrape.js
node --check config/providers.js
```

### 第四步：检查浏览器内核

1. 检查 Playwright 浏览器是否已安装：
   ```bash
   npx playwright install --dry-run chromium 2>&1 || echo "NOT_INSTALLED"
   ```
2. 如果需要安装，提示用户运行：
   ```bash
   npx playwright install chromium
   ```

### 第五步：输出构建报告

```
# Build Report

## 环境
- Node.js: v<version>
- npm: v<version>

## 依赖检查
- express: ✅ / ❌
- playwright: ✅ / ❌
- patchright: ✅ / ❌

## 语法检查
- backend/server.js: ✅ PASS / ❌ FAIL (error message)
- ... (每个文件一行)

## 浏览器内核
- Chromium: ✅ INSTALLED / ⚠️ 需要安装 `npx playwright install chromium`

## 结论
✅ 构建通过，可以启动 / ❌ 存在 N 个问题需要修复
```

## 约束

1. **只读模式**：不修改代码，只检查状态
2. **非破坏性**：`npm install` 和 `playwright install` 需要用户确认后执行
3. **完整报告**：列出所有文件的结果，不忽略任何失败
