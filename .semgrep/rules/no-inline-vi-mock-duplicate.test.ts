import { vi } from "vitest";

// ruleid: no-inline-vi-mock-duplicate
vi.mock("@/lib/queries", () => ({ listStudies: vi.fn() }));

// ruleid: no-inline-vi-mock-duplicate
vi.mock("node-appwrite", async () => ({ Client: class {} }));

async function installMocks(): Promise<void> {
  // ok: no-inline-vi-mock-duplicate
  vi.mock("@/lib/queries", async () => (await import("./fixtures/install-mocks")).fakeQueriesModule());

  // ok: no-inline-vi-mock-duplicate
  vi.mock("node-appwrite", async () => (await import("./fixtures/install-mocks")).fakeNodeAppwriteModule());
}

void installMocks();
