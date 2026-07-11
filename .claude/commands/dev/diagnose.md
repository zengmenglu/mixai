---
name: "Dev: Diagnose"
description: 运行 mixai 诊断脚本
category: Dev
tags: [dev, diagnose, troubleshoot]
---

运行项目的诊断脚本，检查依赖、浏览器内核、profiles 状态等。

执行：
```bash
node scripts/diagnose.js
```

诊断内容：
- Node.js 版本检查
- 依赖安装状态（express, playwright, patchright）
- Playwright Chromium 浏览器内核状态
- profiles 目录存在性检查
- 端口 5173 占用检查
