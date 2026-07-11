---
name: "Dev: Start"
description: 启动 mixai 开发服务器
category: Dev
tags: [dev, start, server]
---

启动 mixai 本地开发服务器。

执行：
```bash
npm start
```

服务启动后：
- 访问 http://localhost:5173 打开四栏对比 UI
- SSE 流 `/events` 接收各 provider 的实时回答
- 提交问题 POST `/api/ask`
