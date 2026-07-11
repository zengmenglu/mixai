---
name: gen-commit
description: 根据 git diff 自动生成符合 Conventional Commits 规范的 commit 信息，供用户审核后提交。
---

# Gen-Commit — Commit 信息生成 Skill

## 概述

读取当前 git diff（staged + unstaged），分析变更内容，自动生成符合 Conventional Commits 规范的 commit 信息。**不自动提交**，由用户审核确认后手动执行 `git commit`。

## 触发方式

- 用户输入 `/gen-commit` 或 `/commit`
- 用户请求「生成 commit」「写提交信息」

## 生成流程

### 第一步：收集变更信息

运行以下命令收集变更概况：

```bash
git diff --stat            # 变更文件列表 + 行数
git diff --cached --stat   # 已暂存的变更
git diff                   # 详细变更内容（截取关键部分）
```

### 第二步：分析变更类型与范围

根据变更文件路径和内容，自动推断 `type` 和 `scope`：

| 变更特征 | type | scope 推断规则 |
|----------|------|---------------|
| 新增文件/功能代码 | `feat` | 根据文件路径：`adapter`、`browser`、`server`、`web` 等 |
| 修复已有代码 | `fix` | 同上 |
| 仅 `.md` 文件 | `docs` | `docs` 或 `harness` |
| 移动/重命名/提取函数 | `refactor` | 根据文件路径 |
| `package.json`、配置 | `chore` | `deps` 或 `config` |
| 格式化/缩进调整 | `style` | 根据文件路径 |
| 测试文件 | `test` | `test` 或 `e2e` |

**混合变更处理**：如果 diff 涉及多种类型，拆分为多个 commit 建议，每个只做一件事。

### 第三步：生成 commit 信息

按 R7 规范生成 message，格式：

```
<type>(<scope>): <中文描述>
```

### 第四步：输出并等待确认

```
# 建议的 commit 信息

## Commit 1（推荐）
feat(adapter): 新增 Grok provider 适配器

## Commit 2（推荐）
docs(adapters): 更新适配器维护手册

---
以上信息由 gen-commit 自动生成，请审核后手动执行：
  git add <files>
  git commit -m "feat(adapter): 新增 Grok provider 适配器"
```

## 约束

1. **不自动提交**：只生成建议信息，由用户手动执行 `git commit`
2. **不自动暂存**：不执行 `git add`，由用户决定提交哪些文件
3. **拆分明细**：混合变更自动拆分为多个 commit 建议
4. **遵循 R7**：生成的信息严格遵循 `.claude/rules/general-basics.md` 的 R7 规范
