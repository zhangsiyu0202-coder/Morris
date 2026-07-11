// Semgrep test fixture for `no-secret-in-source`.

// ruleid: no-secret-in-source
const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

// ruleid: no-secret-in-source
const stripeKey = "<stripe-live-redacted>";

// ruleid: no-secret-in-source
const stripeTestKey = "<stripe-test-redacted>";

// ruleid: no-secret-in-source
const openaiKey = "sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ1234567890";

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
