## Why

When evaluating an answer, no single model is reliably best — comparing several side by side reveals which response is actually most useful for a given question. Paid aggregator APIs cost money and the user has none of the providers' API keys; they only have access to the free web versions of DeepSeek, Doubao, Kimi, and ChatGPT. This change builds a single-user, locally-run tool that drives those four free web UIs through browser automation and shows all four streaming answers in one comparison view, so one typed question fans out to four models with no API key and no cost.

## What Changes

- Add a local web UI: one window, four columns (DeepSeek / Doubao / Kimi / ChatGPT) streaming their answers side by side, with a single shared input box and a "new conversation" control.
- Add a local backend that drives four persistent, logged-in browser contexts (Playwright `userDataDir` profiles) as headless-capable "robot hands" — typing the question, sending it, and scraping each provider's streaming response.
- Fan out one question concurrently to all four providers and stream each model's incremental output back to the UI (SSE/WebSocket).
- Map one tool-side conversation to one chat per provider: starting a new conversation opens a fresh chat in all four and clears context; continuing sends follow-ups into the same four chats so each model keeps its own multi-turn context.
- Detect answer completion robustly (text stops growing for ~1–2s, plus send/stop-button and streaming-cursor signals) so streaming panes know when each model is done.
- Make `headless` a **per-service** config flag with launch config decoupled from scraping logic; default to headful (moved off-screen/minimized) with stealth hardening, so the strictest sites (ChatGPT, Doubao) keep working and A→B switching is config-only.
- Recover from dropped logins: detect a logged-out state, surface a headful window, semi-automatically fill credentials where possible, and hand SMS/scan/captcha steps to the user.
- Detect free-quota/rate-limit prompts and mark only that one pane "unavailable" without breaking the others.

## Capabilities

### New Capabilities
- `compare-chat-ui`: Single-window four-pane comparison interface — shared input box, per-pane streaming answer display, new-conversation control, and per-pane status (idle/streaming/done/unavailable/logged-out).
- `model-orchestration`: Backend that fans one question out to four provider adapters concurrently, maps a tool conversation to one chat per provider (new vs. continue), and streams aggregated incremental output to the UI over SSE/WebSocket.
- `browser-adapters`: Per-service Playwright adapter layer (one adapter per provider) encapsulating selectors and interaction flow — login-state check, type/send, streaming scrape, completion detection, quota-exhaustion detection — with per-service headless config and stealth hardening behind a shared adapter interface.
- `login-recovery`: Logged-out detection plus a semi-automatic login flow (auto-fill where possible, manual fallback for SMS/scan/captcha) driven through a headful window.

### Modified Capabilities
<!-- None — this is a greenfield project with no existing specs. -->

## Impact

- **New project** (greenfield; repo not yet initialized): Node + Playwright backend, browser-automation adapter layer, streaming transport, and a web front-end.
- **Dependencies**: Playwright (+ a stealth approach such as patchright / playwright-stealth / puppeteer-extra-plugin-stealth), a small HTTP/WebSocket server, and persistent on-disk browser profiles (`userDataDir`) per provider.
- **Runtime/operational**: Requires a local machine with four browser contexts running; ongoing maintenance tax as providers redesign their web UIs (selectors break) and as logins periodically expire.
- **Scope guardrails**: Single-user, local-only, personal daily use — no multi-user session management, no hosting, no public deployment. Credential storage is local and minimal; captcha/2FA always require the human.
