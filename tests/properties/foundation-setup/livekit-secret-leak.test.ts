// P-SEC-02 (Property 16): the LiveKit API secret never leaks. We verify the two
// surfaces a client can observe: (1) the signed JWT itself, and (2) the function
// response body. The CI secret-leak job additionally greps apps/web/.next.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { AccessToken } from "livekit-server-sdk";
import { issueLivekitToken } from "../../../apps/functions/issueLivekitToken/src/handler.js";
import { makeFake, KNOWN_SECRET } from "./_fakes.js";

describe("P-SEC-02: signed JWT never contains the API secret", () => {
  it("holds for arbitrary room/identity inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        async (room, identity) => {
          const at = new AccessToken("devkey", KNOWN_SECRET, { identity, ttl: 1800 });
          at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
          const jwt = await at.toJwt();
          expect(jwt).not.toContain(KNOWN_SECRET);
        },
      ),
    );
  });
});

describe("P-SEC-02: function response body never contains the API secret", () => {
  it("holds across valid/invalid inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant("valid"), fc.string({ minLength: 1, maxLength: 12 })),
        async (linkToken) => {
          const { deps } = makeFake();
          const r = await issueLivekitToken({ linkToken }, deps);
          expect(JSON.stringify(r.body)).not.toContain(KNOWN_SECRET);
        },
      ),
    );
  });
});
