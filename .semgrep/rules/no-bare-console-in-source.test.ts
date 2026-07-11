// Semgrep test fixture for `no-bare-console-in-source`.

function badAll() {
  // ruleid: no-bare-console-in-source
  console.log("hi");
  // ruleid: no-bare-console-in-source
  console.info("hi");
  // ruleid: no-bare-console-in-source
  console.debug("hi");
  // ruleid: no-bare-console-in-source
  console.warn("hi");
  // ruleid: no-bare-console-in-source
  console.error("hi");
}

// Allowed via the standard semgrep inline disable.
function goodNosemgrep() {
  // ok: no-bare-console-in-source
  // nosemgrep: no-bare-console-in-source (intentional debug print)
  console.log("debug-only");
}

// Allowed: using the logger primitive.
import { createLogger } from "@merism/observability";
function goodLogger() {
  // ok: no-bare-console-in-source
  const log = createLogger("test");
  log.info("structured");
}
