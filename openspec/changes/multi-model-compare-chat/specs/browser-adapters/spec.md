## ADDED Requirements

### Requirement: Shared adapter interface
Each provider SHALL be implemented as a separate adapter conforming to one shared interface, so providers can be added, repaired, or replaced independently.

#### Scenario: Uniform contract
- **WHEN** the orchestrator drives any provider
- **THEN** it interacts only through the shared interface (e.g., check-login, ensure-chat, send-question, stream-answer) regardless of which provider it is

#### Scenario: Per-provider selector isolation
- **WHEN** one provider redesigns its web UI and its selectors break
- **THEN** only that provider's adapter needs editing and the other adapters and the orchestrator are unaffected

### Requirement: Persistent logged-in browser context
Each adapter SHALL drive a persistent browser context (Playwright `userDataDir`) so the provider login persists across runs.

#### Scenario: Reuse existing session
- **WHEN** an adapter starts and its persisted profile is still logged in
- **THEN** it reuses the session without requiring a fresh login

#### Scenario: Profiles are isolated per provider
- **WHEN** adapters run concurrently
- **THEN** each uses its own `userDataDir` so cookies and sessions never collide between providers

### Requirement: Drive the provider web UI
Each adapter SHALL type the question into the provider's input, submit it, and read the streaming response from the page.

#### Scenario: Send and capture
- **WHEN** the adapter receives a question for an active chat
- **THEN** it enters the text, triggers send, and begins reading the response region as it streams

### Requirement: Answer-completion detection
Each adapter SHALL detect when a response is complete using a robust strategy: primarily that the response text stops growing for a stability window (~1–2s), corroborated where available by send/stop-button state and streaming-cursor signals.

#### Scenario: Stable text ends streaming
- **WHEN** the response text has not grown for the stability window
- **THEN** the adapter marks the answer complete and stops scraping that turn

#### Scenario: Button/cursor corroboration
- **WHEN** a provider exposes a stop-to-send button transition or a streaming cursor that disappears
- **THEN** the adapter uses that signal to confirm completion alongside text stability

#### Scenario: Mid-answer stall is not premature completion
- **WHEN** the provider pauses briefly mid-generation
- **THEN** the adapter does not declare completion until the full stability window elapses with no growth and no active streaming signal

### Requirement: Quota / rate-limit detection
Each adapter SHALL recognize the provider's free-quota or rate-limit prompt and report the pane unavailable rather than emitting a garbage answer.

#### Scenario: Limit prompt encountered
- **WHEN** the provider shows a usage-limit or quota-exhausted message instead of an answer
- **THEN** the adapter reports an "unavailable" status for that pane and does not block the other adapters

### Requirement: Per-service headless configuration
Headless mode SHALL be a per-service configuration flag, with launch configuration decoupled from scraping logic, defaulting to headful (off-screen/minimized) with stealth hardening.

#### Scenario: Mixed headless/headful
- **WHEN** the configuration sets some providers headless and others headful
- **THEN** each adapter launches in its configured mode while all share identical scraping logic

#### Scenario: Switch mode without touching scraping code
- **WHEN** a provider's headless flag is changed
- **THEN** only the launch configuration changes and the adapter's interaction/scraping code is untouched

#### Scenario: Stealth hardening applied
- **WHEN** an adapter launches a context for a detection-strict provider (e.g., ChatGPT, Doubao)
- **THEN** stealth hardening is applied to reduce automation fingerprinting
