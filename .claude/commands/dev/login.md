---
name: "Dev: Login"
description: 打开 AI provider 登录窗口
category: Dev
tags: [dev, login, provider]
---

打开浏览器窗口让用户手动登录各 AI provider，登录态保存到 `profiles/`。

执行：
```bash
npm run login
```

登录指定 provider：
```bash
npm run login <provider>
# 例如：npm run login kimi
# 支持：deepseek, kimi, doubao, chatgpt
```

注意事项：
- 登录窗口为 headful 模式（可见浏览器）
- 验证码/SMS/扫码需要用户手动完成
- 登录成功后会话自动保存到 `profiles/<provider>/`
