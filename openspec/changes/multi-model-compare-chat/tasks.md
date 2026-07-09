## 1. Project setup

- [x] 1.1 Initialize the repo (git init) and a Node project with the chosen package manager
- [x] 1.2 Add Playwright and a stealth approach (patchright / playwright-stealth / puppeteer-extra style), and install browsers
- [x] 1.3 Scaffold directory structure: `backend/` (server, orchestrator, transport), `backend/adapters/` (one file per provider), `config/` (per-service launch + headless config), `web/` (UI), `profiles/` (gitignored `userDataDir` per provider)
- [x] 1.4 Add `.gitignore` for `profiles/`, credentials, and `node_modules`
- [x] 1.5 Create a central per-service config (provider -> { headless, launchOptions, stealthLevel, stabilityWindowMs }) decoupled from adapter logic

## 2. Adapter framework

- [x] 2.1 Define the shared adapter interface: `ensureLoggedIn()`, `ensureChat(mode)`, `send(question)`, `streamAnswer()` async iterator, and a status enum (idle/streaming/done/unavailable/logged-out)
- [x] 2.2 Implement a context factory: `launchPersistentContext` per provider using config (per-service headless, userDataDir, stealth), with launch fully separated from scraping
- [x] 2.3 Implement a generic completion detector: text-stability window plus optional button/cursor corroboration signals, tunable per provider
- [x] 2.4 Implement a generic streaming scraper that yields incremental deltas from a provider-specified response container
- [x] 2.5 Implement generic logged-out detection and quota/rate-limit detection hooks the adapters can specialize

## 3. Provider adapters (start with the friendliest)

- [x] 3.1 DeepSeek adapter: selectors for input/send/response, login check, new/continue chat, streaming scrape (spike first — friendliest)
- [x] 3.2 Kimi adapter: same surface as DeepSeek
- [x] 3.3 Doubao adapter: same surface, with stronger stealth and tuned stability window
- [x] 3.4 ChatGPT adapter: same surface, strongest stealth, headful default; spike anti-bot (Turnstile/fingerprint) behavior and document captcha-handoff points
- [x] 3.5 Tune per-provider stability windows and verify completion detection survives mid-generation stalls

## 4. Orchestration

- [x] 4.1 Implement concurrent fan-out: dispatch one question to all four adapters in parallel
- [x] 4.2 Isolate per-pane failures so one adapter throwing/timing-out/unavailable does not block the others
- [x] 4.3 Implement conversation model: tool conversation holds per-provider chat handles; "new" opens fresh chats, "continue" reuses handles
- [x] 4.4 Serialize turns per pane so two questions never interleave in one pane

## 5. Streaming transport + control API

- [x] 5.1 Implement SSE endpoint that multiplexes per-pane deltas and status events
- [x] 5.2 Implement HTTP control endpoints: submit question, start new conversation
- [x] 5.3 Handle client disconnect: stop forwarding to closed channel without crashing other panes

## 6. Web UI

- [x] 6.1 Build the four-pane side-by-side layout with provider labels and a responsive reflow for narrow viewports
- [x] 6.2 Build the shared input box with submit (Enter/button) dispatching to all four
- [x] 6.3 Wire SSE client: append per-pane deltas live and update per-pane status (idle/streaming/done/unavailable/logged-out)
- [x] 6.4 Add the new-conversation control that clears all panes and resets backend conversations
- [x] 6.5 Block/queue follow-up submissions while any pane is mid-answer

## 7. Login recovery

- [x] 7.1 Surface a headful recovery window for a logged-out provider on user request
- [x] 7.2 Implement semi-automatic credential fill only where a password form exists; store credentials locally and minimally (or rely on persisted sessions)
- [x] 7.3 Hand SMS/QR/captcha steps to the user; never attempt to bypass verification
- [x] 7.4 Detect successful login, persist refreshed session to userDataDir, and return the pane to operable state

## 8. Integration, hardening, docs

- [x] 8.1 End-to-end test: one question streams four answers concurrently into the comparison UI
- [x] 8.2 Verify graceful degradation: force one pane to unavailable/logged-out/failed and confirm the other three are unaffected
- [x] 8.3 Verify A→B switch: flip a provider's headless flag and confirm scraping code is untouched and still works
- [x] 8.4 Write a maintenance README: where each provider's selectors live, how to repair after a redesign, how to recover logins, how to toggle headless
