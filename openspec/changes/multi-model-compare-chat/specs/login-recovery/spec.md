## ADDED Requirements

### Requirement: Logged-out detection
The system SHALL detect when a provider's persisted session is no longer logged in, before or during an attempt to send a question.

#### Scenario: Session expired
- **WHEN** an adapter finds a login wall or logged-out state instead of the chat UI
- **THEN** it reports a "logged-out" status for that pane instead of attempting to send the question

### Requirement: Headful recovery window
When a provider is logged out, the system SHALL surface a visible (headful) browser window for that provider so the user can complete login.

#### Scenario: Recovery prompt
- **WHEN** a pane is reported logged-out and the user chooses to recover
- **THEN** a headful window for that provider is brought forward for the user to log in

### Requirement: Semi-automatic credential fill
Where stored credentials and a fillable password form exist, the system SHALL auto-fill them, while always leaving SMS codes, QR-scan, and captcha/human-verification steps to the user.

#### Scenario: Auto-fill where possible
- **WHEN** a provider offers a username/password form and credentials are stored locally
- **THEN** the system fills the credentials and lets the user complete any remaining verification

#### Scenario: Verification handed to user
- **WHEN** login requires an SMS code, QR scan, or captcha/human check
- **THEN** the system pauses and waits for the user to complete it manually, never attempting to bypass the verification

### Requirement: Resume after recovery
After the user completes login, the system SHALL persist the refreshed session and resume normal operation for that pane.

#### Scenario: Session restored
- **WHEN** the user finishes logging in within the recovery window
- **THEN** the adapter detects the logged-in chat UI, persists the session to its `userDataDir`, and the pane returns to an operable state

### Requirement: Local-only minimal credential storage
Any stored credentials SHALL be kept local to the user's machine and limited to what semi-automatic fill requires.

#### Scenario: No remote transmission
- **WHEN** credentials are stored for auto-fill
- **THEN** they remain on the local machine and are never transmitted to any remote service by the tool
