## ADDED Requirements

### Requirement: Concurrent fan-out
The backend SHALL dispatch a submitted question to all four provider adapters concurrently rather than sequentially.

#### Scenario: One question to four providers
- **WHEN** the backend receives a submitted question
- **THEN** it invokes all four adapters in parallel and begins streaming each one's output as soon as it is available

#### Scenario: One adapter fails without blocking others
- **WHEN** one adapter throws, times out, or reports its provider unavailable
- **THEN** the failure is isolated to that pane's stream and the other three continue uninterrupted

### Requirement: Conversation-to-chat mapping
The backend SHALL map one tool-side conversation to exactly one provider chat per provider, preserving each provider's own multi-turn context.

#### Scenario: New conversation opens fresh chats
- **WHEN** the backend is told to start a new conversation
- **THEN** each adapter opens a fresh chat in its provider, discarding prior context for all four

#### Scenario: Continuing keeps context
- **WHEN** the user submits a follow-up within the same tool conversation
- **THEN** each adapter sends the follow-up into the same provider chat it used previously, so each model retains its prior turns

### Requirement: Streaming transport to UI
The backend SHALL stream each provider's incremental output and status changes to the UI over a streaming channel (SSE or WebSocket), keyed per pane.

#### Scenario: Incremental delivery
- **WHEN** an adapter yields new partial text for its provider
- **THEN** the backend forwards that delta to the UI tagged with the pane identifier, without waiting for the full answer

#### Scenario: Status events
- **WHEN** an adapter transitions a pane to done, unavailable, or logged-out
- **THEN** the backend emits a corresponding status event on the same channel for that pane

#### Scenario: Client disconnect
- **WHEN** the UI disconnects mid-stream
- **THEN** the backend stops forwarding to the closed channel and does not crash the orchestration of other panes
