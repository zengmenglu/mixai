---
name: gen-docs
description: 文档生成 skill。根据代码自动生成 Adapter 维护文档和变更记录。
---

# Gen-Docs — 文档生成 Skill

## 概述

当用户请求生成项目文档时，使用此 skill 自动分析代码并生成结构化文档。

## 触发方式

- 用户输入 `/gen-docs` 或请求「生成文档」
- 用户指定文档类型：`/gen-docs adapter`、`/gen-docs changelog`

## 文档类型

### 1. Adapter 维护文档

**触发**：`/gen-docs adapter` 或「生成 adapter 文档」

**流程**：
1. 扫描 `backend/adapters/` 目录下所有 `<provider>.js` 文件
2. 提取每个 adapter 的 `S` 选择器表
3. 提取每个 adapter 的特殊处理逻辑
4. 生成文档：`docs/adapters.md`

**文档模板**：
```markdown
# Provider Adapter 维护手册

## 通用说明
每个 adapter 文件顶部 `S = { ... }` 包含所有选择器。
当网站改版时，只需要修改对应的选择器字符串即可。

## DeepSeek (`deepseek.js`)

### 选择器表
| 选择器 | 当前值 |
|--------|--------|
| input | ... |
| sendButton | ... |
| ... | ... |

### 特殊处理
- ...

## Kimi (`kimi.js`)
...

## Doubao (`doubao.js`)
...

## ChatGPT (`chatgpt.js`)
### 特殊处理
- 使用 patchright 引擎
- 代理配置：CHATGPT_PROXY 环境变量
- 不注入 stealth initScript
```

### 2. 变更记录 (CHANGELOG)

**触发**：`/gen-docs changelog` 或「生成 CHANGELOG」

**流程**：
1. 运行 `git log --oneline --since="<last-release>"` 获取提交记录
2. 按类型分类：feat（新功能）、fix（修复）、refactor（重构）、docs（文档）
3. 生成文档：`CHANGELOG.md`

## 约束

1. **文档先行**：生成文档后展示给用户审核，确认后再写入文件
2. **不重复现有文档**：检查目标文件是否已存在，存在则更新而非覆盖
3. **代码为准**：所有信息从代码自动提取，不猜测不编造
4. **中文文档**：所有生成的文档使用中文
