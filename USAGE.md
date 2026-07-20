# mixai 使用手册

> 本手册的目标：**让你在没有 AI 协助的情况下，也能独立完成安装、登录、运行和排障。**
> 所有命令都在项目根目录 `mixai/` 下执行，终端用 `zsh`/`bash` 均可。

mixai 是一个本地运行的「四模型并排对比」工具。输入一个问题，同时通过
DeepSeek / Doubao / Kimi / ChatGPT 的**免费网页版**获取回答并排展示。不使用任何
API key，完全靠浏览器自动化（Playwright / Patchright）驱动各家网页。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|----|------|------|
| 操作系统 | macOS（本机已验证） | Windows/Linux 理论可行，命令需自行调整 |
| Node.js | ≥ 18 | 用 `node -v` 查看；ES Modules 需要 |
| 网络 | 能访问 deepseek/kimi/doubao | ChatGPT 额外需要代理（见 §4） |
| 磁盘 | ~500MB | 浏览器内核 + profiles 会占空间 |
| Google Chrome | 已安装 | **仅 ChatGPT 需要**（用真实 Chrome 绕过 Cloudflare） |

> 检查 Node：`node -v` 应输出 `v18.x` 或更高。没有就装：https://nodejs.org

---

## 2. 安装

```bash
# 1) 进入项目目录
cd /Users/menglu/Documents/code/mixai

# 2) 安装依赖（express / playwright / patchright）
npm install

# 3) 安装浏览器内核（首次必做）
npx playwright install chromium
#    DeepSeek / Kimi / Doubao 用这个 chromium 即可。
#    ChatGPT 不用 playwright 的 chromium，它用系统已装的真实 Google Chrome。
```

**验证安装成功**：

```bash
node scripts/diagnose.js
# 会依次打开每个 provider 的浏览器（屏幕外），4 秒后输出登录态 + DOM 概览，
# 并把截图存到 /tmp/mixai-shots/<id>.png。退出码 0 即正常。
```

如果 `diagnose.js` 对某个 provider 报错，先看 §8 排障。

---

## 3. 配置（按需）

所有「怎么启动浏览器」的开关都集中在 **`config/providers.js`**，这是唯一需要改的配置文件。
平时不用动，只有要调以下几项时才改：

| 配置项 | 作用 | 何时改 |
|--------|------|--------|
| `headless` | `true`=后台无窗口，`false`=可见窗口 | 调试时设 `false` 看页面；平时可 `true` |
| `stabilityWindowMs` | 回答文本停顿多久算「答完」 | 总是提前结束→调大；迟迟不结束→调小 |
| `loginSettleMs` | 登录检测等待窗口（仅 chatgpt 有） | ChatGPT 加载慢导致误判未登录→调大 |
| `proxy` | ChatGPT 专用代理 | 改成你的代理地址，或用环境变量覆盖 |
| `stealthLevel` | 反检测等级 `none/standard/high` | 一般不动；某家检测变严→调高 |

**改 headful↔headless 是一行配置**，抓取逻辑不用动。检测严的 ChatGPT/Doubao 建议
保持 `headless: false`。

### ChatGPT 代理（重要）

ChatGPT 在国内无法直连，必须走代理。默认配置：

```js
proxy: process.env.CHATGPT_PROXY || 'http://127.0.0.1:7890',
```

- 如果你用 ClashX/Clash Verge，默认端口就是 `7890`，无需改动。
- 如果端口不同，**不要改代码**，用环境变量覆盖：

```bash
CHATGPT_PROXY=http://127.0.0.1:7897 npm start
```

- 验证代理是否通：`curl -x http://127.0.0.1:7890 https://chatgpt.com/ -I`
  返回 `HTTP/2 403` 是正常的（Cloudflare 拦 curl），只要**有响应**就说明代理通；
  返回 `Connection refused` 才是代理没开。

---

## 4. 首次登录（每家登一次，永久保存）

登录态保存在 `profiles/<provider>/`（已 gitignore，不会上传）。登录一次后会话自动保存，
之后启动直接复用。掉登录时再登一次即可。

```bash
# 登录全部四家（会弹出可见浏览器窗口，逐个登录）
npm run login

# 只登某一家（推荐，省事）
node backend/login.js kimi
node backend/login.js doubao
node backend/login.js chatgpt
node backend/login.js deepseek
```

**登录步骤**：

1. 运行上面的命令，会弹出一个可见的浏览器窗口（屏幕中央）。
2. 在窗口里**手动**完成登录（输账号密码 / 手机验证码 / 扫码 / 人机验证）。
   工具**不会**自动绕过任何验证码、短信、扫码——这些必须你本人完成。
3. 登录成功后，**直接关闭那个浏览器窗口**即可，会话会自动保存到 `profiles/`。
4. 窗口有 15 分钟超时，超时会自动关闭（提前 1 分钟会在终端提醒）。

> 也可以不预先登录，直接启动工具（§5）。未登录的栏会显示 `logged-out`，
> 点栏里的「打开登录窗口」按钮即可现场登录（登录前会自动关闭该栏后台浏览器以释放锁）。

---

## 5. 启动与日常使用

### 启动

```bash
npm start
# 终端会输出：mixai -> http://localhost:5173
# 然后浏览器自动打开（如果没有，手动访问 http://localhost:5173）
```

启动时会**立即并行打开 4 个 provider 的浏览器窗口**（屏幕外预热），这样你首次提问
不用等冷启动。如果想看后台浏览器，把对应 provider 的 `headless` 改成 `false`。

### 界面操作

```
┌──────────┬──────────────────────────────────────────────────┐
│ 历史会话  │ mixai  DeepSeek·Doubao·Kimi·ChatGPT  [☑复选框]  ● │
│          ├──────────┬──────────┬──────────┬──────────────────┤
│ ＋新会话  │ DeepSeek │  Doubao  │   Kimi   │     ChatGPT      │
│ ──────── │ [回答区]  │ [回答区]  │ [回答区]  │     [回答区]      │
│ · React  │ markdown │ markdown │ markdown │     markdown     │
│ · 对比…  │ (表格等)  │  渲染     │  渲染     │      渲染         │
│ · 你好   │          │          │          │                  │
│          │ [✕终止]  │ [✕终止]  │ [✕终止]  │     [✕终止]       │
│          ├──────────┴──────────┴──────────┴──────────────────┤
│          │ [      输入问题，回车同时问勾选的模型      ] [发送]  │
└──────────┴──────────────────────────────────────────────────┘
```

| 操作 | 方法 |
|------|------|
| **提问** | 底部输入框打字，`回车` 发送（`Shift+回车` 换行） |
| **勾选要对比的模型** | 顶栏的复选框，取消勾选的栏会隐藏、且不参与提问；选择会记住（localStorage） |
| **停止某个模型** | 该模型当前回答下方的「⏹ 停止」小图标（仅回答中显示）。停止后该栏不再占用，其他模型不受影响 |
| **重新回答某个模型** | 该模型回答下方的「↻ 重新回答」小图标（回答完成后显示）。用同一问题重新生成该模型的回答并替换原回答，其他模型不受影响 |
| **查看/恢复历史会话** | 左侧栏列出过往会话，点击即加载往期 Q&A；在其上继续追问会自动恢复 AI 的原对话上下文（真正续接） |
| **开新会话** | 左侧栏顶部「＋ 新会话」清空当前栏，下轮各开新对话 |
| **重新登录某栏** | 该栏显示 `logged-out` 时，点栏内「打开登录窗口」 |
| **markdown 渲染** | 回答自动渲染表格/代码块/列表/粗体等；流式逐字渲染，表格完成后自动成型 |

### 停止 / 重新回答（每模型独立）

每个模型每轮回答的下方有两个小图标，操作只影响该模型，与其他模型不相干：

- **⏹ 停止**（回答中显示）：立即停止抓取该模型的回答，并点击该网站自己的「停止生成」按钮
  释放输入框。被停止的栏状态变 `stopped`，已显示的部分回答保留；下一轮可正常提问。
- **↻ 重新回答**（回答完成后显示）：用**同一问题**重新生成该模型的回答，新回答**替换**原回答。
  - 实现：把该问题再发一次给该模型（带其原对话 URL，确保续接同一上下文），用新回答替换界面显示。
    四家通用稳健。代价：该模型自己的网页对话里会多一轮重复提问（不影响你的对比查看）。
  - 为什么不用各家自带的「重新生成」按钮：那些按钮是纯图标、无文字、悬停才出现、class 被混淆，
    难以稳定定位，逐个点击候选也未必触发，故弃用。
- 两者都**只作用于当前这一栏**：停 A 不影响 B/C/D；让 A 重新回答也不影响其他模型，且不阻塞它们。

### 历史会话与真正续接

- 每次提问自动存为一个「历史会话」（左侧栏，按时间倒序，最多 50 条），含全部轮次的问答。
- 点击左侧栏某条历史会话，主区加载其 Q&A。
- 在历史会话上继续追问时，工具会带该会话各模型的对话 URL 给后端；后端把浏览器导航
  回原对话再续问，**AI 真正记得原上下文**（不是重新开始）。
- 同一会话内连续追问零开销（浏览器已在原对话上）；切到另一条历史会话才会导航。
- 鼠标悬停历史会话项出现「×」可删除。

---

## 6. 日志（排障关键）

工具内置结构化日志，默认输出到终端。**遇到任何问题，第一件事是看日志。**

### 日志级别

用环境变量 `LOG_LEVEL` 控制：

```bash
LOG_LEVEL=debug npm start   # 最详细：每个 delta、每次 DOM 读取都记录
LOG_LEVEL=info  npm start   # 默认：启动、登录、轮次、完成、错误
LOG_LEVEL=warn  npm start   # 只看警告和错误
LOG_LEVEL=error npm start   # 只看错误
```

日志格式：`时间 级别 [组件] 消息 {结构化字段}`，例如：

```
2026-07-11T23:36:15.757Z INFO  [chatgpt] launching browser {"engine":"patchright","proxy":"http://127.0.0.1:7890"}
2026-07-11T23:36:16.124Z ERROR [chatgpt] browser launch failed {"error":"..."}
2026-07-11T23:38:01.001Z INFO  [deepseek] answer done {"deltaCount":12,"totalChars":340,"fullLen":340}
```

### 日志写文件（便于事后排查）

```bash
LOG_FILE=mixai.log LOG_LEVEL=debug npm start
# 所有日志同时写入项目根目录的 mixai.log（已 gitignore，不会提交）
# 出问题后把 mixai.log 发给我或自己翻看即可。
```

### 关键日志线索

| 现象 | 看哪条日志 | 含义 |
|------|-----------|------|
| 某栏一直 `logged-out` | `[id] not logged in {wall,input,url}` | `wall:true`=被验证码挡；`input:false`=页面没加载或选择器失效；看 `url` 判断页面状态 |
| 某栏没回答 | `[id] answer done {fullLen:0}` | 发送了但读不到回答 → 选择器失效（见 §8） |
| 启动就报错 | `[id] browser launch failed` | 代理不通 / Chrome 没装 / profile 被占用 |
| 回答重复 | `[id] detected DOM echo, skipping duplicate` | 已自动拦截重复；若仍重复，看 `delta` 日志的 `lastLen/curLen` |
| 终止 | `[id] turn stopped` | stop 按钮生效 |

---

## 7. 停止 / 重启

- 停止服务：在运行 `npm start` 的终端按 `Ctrl + C`（会优雅关闭所有浏览器，不留僵尸进程）。
- 改了代码或配置后，需要 `Ctrl+C` 停止再重新 `npm start`。
- **ChatGPT 长时间挂着不工作时**，最直接的修复是重启服务（见 §8 的「ChatGPT 卡住」）。

---

## 8. 常见问题与排障

### 8.1 某一家突然不工作 / 回答变奇怪

**最常见原因：该网站改版，选择器失效。** 修复通常只需加一个选择器字符串：

1. `node backend/login.js <provider>` 打开该家窗口，登录后按 `F12` 看新 DOM。
2. 打开 `backend/adapters/<provider>.js`，顶部有个 `const S = { ... }` 选择器表。
3. 往对应项（`input` / `sendButton` / `answer` 等）**加一个新的候选选择器字符串**。
4. 重启 `npm start`。一般不用改任何逻辑，各家互相隔离。

需要关注的选择器项：`input`、`sendButton`、`newChat`、`answer`、`stopButton`、
`quota`、`loginWall`。详见 `docs/adapters.md`。

### 8.2 ChatGPT 没有返回

ChatGPT 反自动化最严，按顺序排查：

1. **代理是否开启**：`curl -x http://127.0.0.1:7890 https://chatgpt.com/ -I`
   有响应（哪怕 403）= 通；`Connection refused` = 代理没开，先开 ClashX。
2. **服务是否跑了太久**：如果 `npm start` 已经挂了好几天，ChatGPT 的页面会**过期**
   （登录态失效 / Cloudflare 重新验证）。日志会显示
   `[chatgpt] not logged in {url:...}`。**解决：`Ctrl+C` 重启 `npm start`**，
   重启后会重新打开新鲜页面。代码已加「过期自动 reload 重试」，但严重过期仍需重启。
3. **登录按钮点不开**：曾经有个 bug——点登录会报「在现有浏览器会话中打开」，
   因为后台浏览器占着 profile 锁。**已修复**：点登录会先关闭后台实例再开登录窗口。
   若仍遇到，先 `Ctrl+C` 停服务，再 `node backend/login.js chatgpt` 单独登录。
4. **Cloudflare 人机验证**：偶尔会被要求「Verify you are human」。这时该栏会显示
   `logged-out`，点登录窗口**手动**过验证。这是浏览器自动化对 ChatGPT 的固有代价。
5. **真 Chrome 没装**：ChatGPT 用 `channel: 'chrome'`（真实 Google Chrome）。
   确认 `/Applications/Google Chrome.app` 存在。

### 8.3 回答被打印了两遍

已修复，机制有两层：

- **抓取层**：如果某网站的回答容器把内容渲染了两份（DOM echo），抓取会自动识别并跳过
  重复部分（日志：`detected DOM echo, skipping duplicate`）。
- **前端层**：回答完成时的「全文回填」只在全文是已显示内容的干净超集时才覆盖，
  避免把重复全文盖到已正确的流式文本上。

如果仍看到重复：`LOG_FILE=mixai.log LOG_LEVEL=debug npm start`，复现一次，把
`mixai.log` 里该 provider 的 `delta` 行（带 `lastLen/curLen/deltaLen`）发给我，
能定位到具体哪一步。

### 8.4 回答总是提前结束 / 迟迟不结束

调 `config/providers.js` 里该家的 `stabilityWindowMs`：
- 总是提前断 → 调大（如 `800` → `1500`）。
- 迟迟不断 → 调小。

### 8.5 端口 5173 被占用

```bash
lsof -iTCP:5173 -sTCP:LISTEN    # 看是谁占的
# 要么 kill 那个进程，要么换端口：
PORT=5174 npm start
```

### 8.6 浏览器窗口残留 / 僵尸进程

正常 `Ctrl+C` 会自动清理。如果异常退出留下残留：

```bash
pkill -f "Google Chrome.*mixai/profiles"
pkill -f "Chromium.*mixai/profiles"
```

### 8.7 掉登录

该栏显示 `logged-out`：点栏内按钮打开登录窗口，或 `node backend/login.js <provider>`。
登录成功后关闭窗口，会话保存，重启或下一轮即恢复。

---

## 9. 诊断脚本

```bash
# 只诊断某一家（推荐，快）
node scripts/diagnose.js chatgpt

# 诊断全部
node scripts/diagnose.js
```

输出每家的：登录态、页面 URL、title、textarea/contenteditable/password 数量、
body 文本前 160 字，并截图到 `/tmp/mixai-shots/<id>.png`。
**选择器失效时，对比截图和 DOM 概览就能看出该加什么选择器。**

---

## 10. 目录结构速查

```
config/providers.js        ← 唯一配置文件（headless/代理/稳定窗口）
backend/
  server.js                ← Express 入口（仅监听 127.0.0.1）
  orchestrator.js          ← 并发分发 + 故障隔离 + stop/abort + 会话恢复
  transport.js             ← SSE 事件总线
  log.js                   ← 结构化日志模块（LOG_LEVEL/LOG_FILE）
  login.js                 ← 登录/恢复流程
  browser/contextFactory.js ← 浏览器启动 + stealth + 自愈重连
  browser/scrape.js        ← 流式抓取 + 完成判定 + baseline + 重复拦截
  adapters/<provider>.js   ← 每家一个：选择器表 S + 交互
web/
  index.html app.js styles.css ← 前端：侧边栏 + 四栏 + SSE
  vendor/marked.min.js     ← markdown 渲染（表格/代码/列表）
scripts/diagnose.js        ← 诊断脚本
profiles/<provider>/       ← 浏览器持久会话（gitignore，不提交）
```

更详细的架构说明见 `.claude/agents.md`（架构文档）和 `docs/adapters.md`（适配器维护手册）。

---

## 11. 常用命令速查

```bash
npm install                        # 装依赖
npx playwright install chromium    # 装浏览器内核（首次）
npm run login                      # 登录全部
node backend/login.js kimi         # 登录某一家
npm start                          # 启动（http://localhost:5173）
LOG_LEVEL=debug npm start          # 启动 + 详细日志
LOG_FILE=mixai.log npm start       # 启动 + 日志写文件
node scripts/diagnose.js chatgpt   # 诊断某家
PORT=5174 npm start                # 换端口启动
CHATGPT_PROXY=http://127.0.0.1:7897 npm start   # 覆盖 ChatGPT 代理
```

---

## 12. 边界与风险

- 单人、本地、个人使用；无多用户、无托管、无公网部署。
- 各家改版会让选择器失效，需要按 §8.1 维护——这是本工具的「长期税」。
- ChatGPT 反自动化最严，偶尔需手动过验证。
- 通过自动化使用网页版可能触及各家服务条款，请自行评估，控制请求频率。
- `profiles/` 含登录态，**绝不可提交或外传**（已 gitignore）。
