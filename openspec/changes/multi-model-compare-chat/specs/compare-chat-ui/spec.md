## ADDED Requirements

### Requirement: Four-pane comparison layout
The UI SHALL present a single window containing four answer panes labeled DeepSeek, Doubao, Kimi, and ChatGPT, arranged side by side, so the user can compare all four models' responses to one question without switching windows.

#### Scenario: Initial load
- **WHEN** the user opens the tool in a browser
- **THEN** four labeled, side-by-side answer panes are visible along with a single shared input box

#### Scenario: Responsive narrow viewport
- **WHEN** the viewport is too narrow to show four panes side by side
- **THEN** the panes reflow (e.g., 2x2 or vertical stack) while keeping each pane's label and content intact

### Requirement: Unified question input
The UI SHALL provide one shared input box that submits the typed question to all four models at once.

#### Scenario: Submit a question
- **WHEN** the user types a question and presses submit (Enter or button)
- **THEN** the same question is dispatched to all four panes and the input is cleared or disabled until dispatch starts

#### Scenario: Submit blocked while a pane is mid-answer
- **WHEN** the user submits a follow-up while one or more panes are still streaming
- **THEN** the UI either queues the follow-up or signals that panes are busy, and never interleaves two questions' tokens in the same pane

### Requirement: Per-pane streaming display
Each pane SHALL render its model's answer incrementally as tokens arrive, not only after completion.

#### Scenario: Tokens stream in
- **WHEN** the backend pushes incremental output for a pane
- **THEN** that pane appends the new text in place while other panes update independently

#### Scenario: Independent pane completion
- **WHEN** one model finishes before the others
- **THEN** its pane shows a completed state while the remaining panes keep streaming

### Requirement: Per-pane status indicator
Each pane SHALL display a distinct status: idle, streaming, done, unavailable (quota/limit), or logged-out.

#### Scenario: Quota-exhausted pane
- **WHEN** the backend reports a pane is rate-limited or quota-exhausted
- **THEN** that pane shows an "unavailable" status and the other three panes continue normally

#### Scenario: Logged-out pane
- **WHEN** the backend reports a pane's provider session is logged out
- **THEN** that pane shows a "logged-out" status with a prompt to recover the login, while other panes are unaffected

### Requirement: New-conversation control
The UI SHALL provide a control that starts a fresh conversation, clearing displayed history in all four panes.

#### Scenario: Start a new conversation
- **WHEN** the user activates the new-conversation control
- **THEN** all four panes clear their displayed history and the backend is told to begin a fresh conversation for every provider
