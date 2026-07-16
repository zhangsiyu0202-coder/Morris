import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearPrestopMarker,
  prepareWorkerHealthServer,
  writePrestopMarker,
} from "./health.js";

describe("prepareWorkerHealthServer", () => {
  const markerPath = join(tmpdir(), `merism-health-test-${process.pid}`);

  afterEach(() => clearPrestopMarker(markerPath));

  it("clears a previous drain marker before a replacement worker starts", () => {
    writePrestopMarker(markerPath);

    prepareWorkerHealthServer(markerPath);

    expect(existsSync(markerPath)).toBe(false);
  });
});
