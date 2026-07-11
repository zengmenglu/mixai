---
name: deploy-run
description: 部署运行 skill。检查端口可用性、profiles 登录态，启动服务并验证可访问性。
---

# Deploy Run — 部署运行 Skill

你是 mixai 项目的部署和运行专家。负责检查运行环境并启动服务。

## 触发方式

- 用户输入 `/deploy-run` 或 `/deploy` 或 `/run`
- 用户请求「部署」「运行」「启动服务」

## 部署流程

### 第一步：端口检查

检查目标端口是否被占用：

```bash
lsof -i :5173 2>/dev/null || echo "PORT_FREE"
```

- 如果端口被占用，检查是否是已存在的 mixai 进程
- 如果是旧进程 → 询问是否 kill 后重启
- 如果是其他进程 → 提示端口冲突

### 第二步：Profiles 状态检查

检查各 provider 的登录态：

```bash
# 检查每个 provider 的 profiles 目录是否存在且有内容
for provider in deepseek kimi doubao chatgpt; do
  if [ -d "profiles/$provider/Default" ]; then
    echo "$provider: HAS_PROFILE"
  else
    echo "$provider: NO_PROFILE"
  fi
done
```

### 第三步：启动服务

运行：
```bash
npm start
```

以 background 模式启动，等待 2 秒验证启动是否成功。

### 第四步：验证可访问性

验证服务是否正常响应：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
curl -s http://localhost:5173/api/providers
```

### 第五步：输出部署报告

```
# Deploy Report

## 端口
- 5173: ✅ 可用 / ⚠️ 被占用（PID: xxx）

## Profiles 登录态
| Provider | 状态 |
|----------|------|
| deepseek | ✅ 已登录 / ⚠️ 未登录 |
| kimi     | ✅ 已登录 / ⚠️ 未登录 |
| doubao   | ✅ 已登录 / ⚠️ 未登录 |
| chatgpt  | ✅ 已登录 / ⚠️ 未登录 |

## 服务状态
- URL: http://localhost:5173
- HTTP Status: 200 ✅ / ❌

## 可用端点
- GET  /api/providers → 返回 N 个 provider
- POST /api/ask
- POST /api/new-conversation
- GET  /events (SSE)

## 操作建议
- 未登录的 provider：运行 `/dev:login <provider>` 登录
- 打开 UI：http://localhost:5173
```

## 约束

1. **只读检查**：启动前只检查不修改
2. **用户确认**：kill 进程等破坏性操作需要用户确认
3. **安全启动**：先在后台启动，验证成功后才报告
