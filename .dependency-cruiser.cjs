/**
 * dependency-cruiser config — module-graph boundary enforcement.
 *
 * Companion to `.semgrep/rules/` — cruiser owns "module A may not import
 * module B" (graph shape); semgrep owns "this AST pattern is forbidden in
 * source X" (file content). The same rule MUST NOT appear in both layers.
 *
 * Source: `.kiro/specs/dependency-cruiser-boundaries/{requirements,design}.md`.
 * Mirrors `.kiro/steering/architecture.md` § Module map "MUST NOT" column.
 *
 * Local: `pnpm deps:cruise`
 * CI: `dependency-cruiser` job in `.github/workflows/ci.yml`
 */
module.exports = {
  forbidden: [
    {
      name: "functions-no-web-import",
      severity: "error",
      from: { path: "^apps/functions/" },
      to: { path: "^apps/web/" },
      comment:
        "Functions are server-side; they MUST NOT import web client code. " +
        "See architecture.md § Module map.",
    },
    {
      name: "web-no-function-internals",
      severity: "error",
      from: {
        path: "^apps/web/",
        // dev-issue-token route is the one allowed exception (per docs/dev/deploy-functions.md):
        // it inlines the Function handler as a local-dev fallback when the
        // appwrite-executor container isn't running.
        pathNot: "^apps/web/app/api/dev-issue-token/route\\.ts$",
      },
      to: { path: "^apps/functions/[^/]+/src/" },
      comment:
        "Web should call Functions via HTTP, not import their internals. " +
        "Sole exception: apps/web/app/api/dev-issue-token/ (encoded via pathNot above). " +
        "See architecture.md § Module map.",
    },
    {
      name: "morris-tools-no-sdk-import",
      severity: "error",
      from: { path: "^apps/web/lib/assistant/tools/" },
      to: { path: "^(node-appwrite|appwrite|livekit-server-sdk)$" },
      comment:
        "Morris tools must use @/lib/server/* helpers, not SDK directly. " +
        "Mirrors the architectural rule that handler.ts can't import SDK " +
        "(enforced at file level by semgrep handler-no-sdk-import.yaml). " +
        "See AGENTS.md § Morris 工具集 + architecture.md § Module map.",
    },
    {
      name: "contracts-no-runtime-sdk",
      severity: "error",
      from: { path: "^packages/contracts/" },
      to: { path: "^(node-appwrite|appwrite|livekit-server-sdk|livekit-client)$" },
      comment:
        "packages/contracts is zero-dependency by design; only zod + std. " +
        "See contracts.md § Source-of-truth rule.",
    },
    {
      name: "observability-no-contracts-import",
      severity: "error",
      from: { path: "^packages/observability/" },
      to: { path: "^(@merism/contracts|packages/contracts/)" },
      comment:
        "Observability is more foundational than contracts; importing contracts " +
        "would create a circular dep if contracts ever logs (which it must not). " +
        "Belt-and-suspenders boundary.",
    },
    {
      name: "no-cross-tool-import",
      severity: "error",
      from: { path: "^apps/web/lib/assistant/tools/([^/]+)\\.ts$" },
      to: { path: "^apps/web/lib/assistant/tools/(?!\\1)([^/]+)\\.ts$" },
      // Capture-group trick: tools/A.ts can't import tools/B.ts. Shared
      // helpers belong one level up in lib/assistant/.
      comment:
        "Morris tools are siblings; cross-tool imports indicate a missing shared " +
        "helper. Lift the shared piece to lib/assistant/.",
    },
    // Standard cruiser-suggested guards below — light reuse of well-known
    // recipes; cheap signal, low false-positive risk.
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
      comment:
        "Circular module dependencies make refactoring brittle and confuse the " +
        "static analyzer. Break the cycle by extracting the shared piece.",
    },
    // `no-orphans` rule intentionally omitted: Next.js file-based routing
    // creates many legitimate "orphans" (every page.tsx + route.ts is an
    // entry point cruiser can't see being imported), and barrel re-export
    // patterns produce more. The signal-to-noise ratio doesn't justify the
    // pathNot expansion required. Add it back when there's a leaf-module
    // hygiene story worth enforcing.
  ],
  options: {
    tsConfig: { fileName: "tsconfig.base.json" },
    exclude: {
      path: [
        "node_modules",
        "dist",
        "\\.next",
        "coverage",
        "\\.semgrep",
        "\\.kiro",
        "__mocks__",
        // dependency-cruiser's own output
        "deps-cruise-report\\.json",
        // tests folder cross-boundary imports are allowed by convention
        "(^|/)__tests__/",
        "\\.(test|spec)\\.(ts|tsx|js|jsx)$",
        "^tests/properties/",
        "^tests/evals/",
        // build artifacts under packages
        "^packages/.+/dist/",
      ],
    },
    doNotFollow: { path: "node_modules" },
    moduleSystems: ["amd", "cjs", "es6", "tsd"],
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      // resolve the @/ alias declared in tsconfig.base.json paths
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
