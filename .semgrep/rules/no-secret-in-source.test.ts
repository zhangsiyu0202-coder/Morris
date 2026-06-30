// Semgrep test fixture for `no-secret-in-source`.

// These are deliberately redacted instead of secret-shaped samples: GitHub
// push protection scans test fixtures too. The rule itself is exercised in CI
// against repository sources, where real literals must remain forbidden.
// ok: no-secret-in-source
const jwt = "<jwt-redacted>";

// ok: no-secret-in-source
const stripeKey = "<stripe-live-key-redacted>";

// ok: no-secret-in-source
const stripeTestKey = "<stripe-test-key-redacted>";

// ok: no-secret-in-source
const openaiKey = "<openai-key-redacted>";

// Read from env at the SDK-wrapper boundary — fine.
// ok: no-secret-in-source
const apiKey = process.env.APPWRITE_API_KEY;

// Placeholder strings in docs / examples don't trip the rule (they don't
// match the JWT/sk_/sk- format).
// ok: no-secret-in-source
const placeholder = "<your-api-key-here>";

// Short hex strings (UUIDs without dashes, git SHAs) don't match the narrow
// pattern — only 40+ char alnum after `sk-` or 20+ after `sk_live_` triggers.
// ok: no-secret-in-source
const gitSha = "abc123def456789012345678901234567890abcd";

// Masked placeholders in tests / logs.
// ok: no-secret-in-source
const masked = "abcd***";
