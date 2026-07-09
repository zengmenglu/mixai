## Context

The user wants to compare DeepSeek, Doubao, Kimi, and ChatGPT answers to the same question, side by side, for personal daily use. They have no provider API keys and will not pay; only the free web versions are available. Direct API/aggregator routes were considered in exploration and rejected because the user's firm constraint is "no cost / no keys." The chosen approach is browser automation: a local backend drives four persistent, already-logged-in browser contexts and scrapes their streaming answers, while the user views and compares everything in a single local web UI.

Key constraints established during exploration:
- Single user, single machine, local only — no hosting, no multi-user sessions.
- Streaming output (not wait-for-full), four panes updating independently.
- Multi-turn context preserved per provider; "new conversation" resets all four.
- Anti-bot is the central fragility: ChatGPT (Cloudflare Turnstile + fingerprinting) is strictest, Doubao moderately strict, DeepSeek/Kimi friendlier.
- The tool is "a pet you feed," not "set and forget": provider redesigns break selectors; logins expire periodically.

## Goals / Non-Goals

**Goals:**
- One typed question fans out concurrently to four free web models and streams four answers into one comparison window.
- Per-provider adapter layer that isolates selector/interaction breakage to a single file.
- `headless` as a per-service flag, decoupled from scraping logic, defaulting to headful + stealth, so A→B (headful→headless), mixed mode, or virtual-display setups are config-only changes.
- Robust answer-completion detection that tolerates mid-generation stalls.
- Graceful degradation: a failed/limited/logged-out provider affects only its own pane.
- Semi-automatic login recovery with the human owning captcha/SMS/QR.

**Non-Goals:**
- No official APIs, no paid aggregators, no API keys.
- No multi-user support, authentication of the tool itself, or remote deployment.
- No attempt to defeat captcha/human-verification programmatically.
- No guarantee of long-term stability across provider redesigns — maintainability, not permanence, is the goal.

## Decisions

### Decision: Node + Playwright with persistent contexts
Use Node + Playwright (`launchPersistentContext` with a per-provider `userDataDir`) as the automation core. Rationale: Playwright's persistent context is the cleanest way to keep logins alive across runs, drive multiple isolated browsers, and read streaming DOM. Node keeps backend, transport, and tooling in one language.
- *Alternatives considered*: Puppeteer (viable, but persistent-context ergonomics are weaker); Python + Playwright (fine, but splits stack). Either remains swappable because adapters hide the driver behind the shared interface.

### Decision: Stealth via a hardened launch profile, applied per provider
Apply stealth hardening (e.g., patchright / playwright-stealth / puppeteer-extra-plugin-stealth-style patches) selectively, strongest for ChatGPT and Doubao. Rationale: detection differs sharply by provider; uniform heavy stealth is wasted on DeepSeek/Kimi and may even cause its own breakage. Stealth lives in launch config, not adapter scraping logic.
- *Alternative considered*: vanilla Playwright everywhere — rejected; ChatGPT would flag it immediately in headless and frequently in headful.

### Decision: Per-service headless flag, launch/scrape decoupled
A central config maps each provider to `headless: true|false` plus launch options; adapters consume a launched context handed to them and contain only interaction/scraping code. Rationale: makes A→B, mixed mode, and future xvfb virtual-display the same one-line change with zero risk to scraping logic — directly satisfying the exploration commitment.

### Decision: Completion detection = text-stability window + corroborating signals
Primary signal: the response container's text length is unchanged for a stability window (~1–2s). Corroborate where available with send/stop-button state transitions and disappearance of a streaming cursor. Rationale: stop-button/cursor markup varies and breaks across redesigns, so they can't be the sole signal; pure text-stability alone risks declaring completion during a mid-generation stall. Combining them is the robust middle path. The stability window is configurable per provider.
- *Alternative considered*: network-level (watching SSE/fetch responses) — more precise but far more brittle to reverse-engineer per provider and more likely to trip detection; deferred.

### Decision: Conversation ↔ chat mapping via stored per-provider chat handles
A tool conversation holds, per provider, a reference to that provider's open chat (URL/chat-id/tab). "New conversation" tells each adapter to open a fresh chat; "continue" reuses the stored handle. Rationale: mirrors how each web UI already isolates conversations; keeps each model's native multi-turn memory intact without the tool reconstructing context.

### Decision: SSE for streaming transport (WebSocket as fallback)
Stream deltas and status events to the UI via Server-Sent Events, multiplexed with a per-pane id. Rationale: output is one-directional server→client; SSE is simpler and auto-reconnects. Control actions (submit, new-conversation) go over plain HTTP POST. WebSocket is the fallback if bidirectional needs grow.

### Decision: Adapter interface surface
Shared interface per provider: `ensureLoggedIn()`, `ensureChat(mode: new|continue)`, `send(question)`, `streamAnswer() -> async iterator of deltas`, plus emitted status (`idle|streaming|done|unavailable|logged-out`). Rationale: the orchestrator stays provider-agnostic; all provider-specific selectors and quirks are confined to the adapter.

### Decision: Login recovery is interactive, not autonomous
On `logged-out`, surface a headful window, auto-fill stored credentials only when a password form exists, and block on the human for SMS/QR/captcha. Credentials (if any) stay local and minimal. Rationale: these providers mostly use phone-code/QR login with human verification; full automation is both infeasible and a detection/ban risk.

## Risks / Trade-offs

- **Provider redesign breaks selectors** → Confine each provider to its own adapter behind the shared interface; keep selectors in clearly-marked, easily-editable blocks; expect periodic repair.
- **ChatGPT anti-bot (Turnstile/fingerprint) flags automation** → Default headful + strongest stealth for ChatGPT; accept occasional manual captcha; keep headless off for it until proven stable.
- **Premature completion on mid-generation stall** → Combine text-stability window with button/cursor corroboration; make the window tunable per provider.
- **Logins expire** → Detect logged-out state early; interactive recovery window; persist refreshed session to `userDataDir`.
- **Resource cost of four concurrent browsers** → Acceptable on a single personal machine; allow off-screen/minimized headful and per-provider headless to reduce footprint.
- **Local credential storage risk** → Store locally only, minimal, never transmitted; prefer relying on persisted session cookies over storing passwords where possible.
- **ToS / account risk from automation** → Inherent to the chosen approach and accepted by the user for personal use; mitigate by human-like headful operation, no captcha bypass, and modest request volume.
- **Two questions interleaving in one pane** → Orchestrator serializes per-pane turns; UI blocks/queues follow-ups while a pane streams.

## Open Questions

- Exact stealth library/toolchain to standardize on (patchright vs playwright-stealth vs puppeteer-extra) — decide during the first ChatGPT spike.
- Whether to store any passwords at all, or rely solely on persisted sessions + manual re-login.
- Per-provider default stability-window values — to be tuned empirically during adapter implementation.
- Whether to add a virtual display (xvfb) path now or defer until headless proves insufficient.
