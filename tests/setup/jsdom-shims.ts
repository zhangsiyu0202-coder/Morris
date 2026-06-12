// Vitest jsdom shims for browser APIs jsdom doesn't implement.
// Auto-loaded for any test file with `// @vitest-environment jsdom` pragma.
import { vi } from "vitest";

if (typeof Element !== "undefined" && !("scrollTo" in Element.prototype)) {
  Element.prototype.scrollTo = vi.fn();
}
if (typeof window !== "undefined" && !("scrollTo" in window)) {
  // @ts-expect-error patched at runtime
  window.scrollTo = vi.fn();
}
