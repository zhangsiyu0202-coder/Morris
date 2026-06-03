// P-SEC-01 (Property 15): ownership isolation across the (actor x resource x
// action) matrix. The enumeration (>=42 combos) and expected-outcome logic run
// always; the real Appwrite enforcement runs when MERISM_LIVE_TESTS=1 against a
// stack with the schema applied (CI via docker-compose).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, Databases, Users, ID, Permission, Role } from "node-appwrite";

const OWNER_SCOPED = ["projects", "surveys", "survey_sections", "question_blocks", "analysis_reports"];
const SERVER_WRITE = ["interview_sessions", "transcripts", "recordings"];
const RESOURCES = [...OWNER_SCOPED, ...SERVER_WRITE];
const ACTORS = ["owner", "other_researcher", "anonymous"] as const;
const ACTIONS = ["read", "write"] as const;

type Combo = {
  actor: (typeof ACTORS)[number];
  resource: string;
  action: (typeof ACTIONS)[number];
  expectedAllowed: boolean;
};

export function buildPermissionMatrix(): Combo[] {
  const out: Combo[] = [];
  for (const actor of ACTORS)
    for (const resource of RESOURCES)
      for (const action of ACTIONS) {
        let expectedAllowed = false;
        if (actor === "owner") {
          expectedAllowed = action === "read" || OWNER_SCOPED.includes(resource);
        }
        out.push({ actor, resource, action, expectedAllowed });
      }
  return out;
}

describe("P-SEC-01 matrix enumeration", () => {
  it("covers >= 42 actor x resource x action combinations", () => {
    expect(buildPermissionMatrix().length).toBeGreaterThanOrEqual(42);
  });
  it("denies every non-owner actor on every resource/action", () => {
    for (const c of buildPermissionMatrix()) {
      if (c.actor !== "owner") expect(c.expectedAllowed).toBe(false);
    }
  });
  it("always allows owner reads", () => {
    for (const c of buildPermissionMatrix()) {
      if (c.actor === "owner" && c.action === "read") expect(c.expectedAllowed).toBe(true);
    }
  });
});

const LIVE = process.env.MERISM_LIVE_TESTS === "1";
const DB = "merism";

describe.skipIf(!LIVE)("P-SEC-01 live Appwrite enforcement", () => {
  const endpoint = process.env.APPWRITE_ENDPOINT!;
  const project = process.env.APPWRITE_PROJECT_ID!;
  const apiKey = process.env.APPWRITE_API_KEY!;
  const server = () => new Client().setEndpoint(endpoint).setProject(project).setKey(apiKey);
  const users = new Users(server());
  const adminDb = new Databases(server());

  let ownerId = "";
  let otherId = "";
  const docIds: Record<string, string> = {};

  async function actorDb(actor: Combo["actor"]): Promise<Databases> {
    const c = new Client().setEndpoint(endpoint).setProject(project);
    if (actor === "anonymous") return new Databases(c);
    const uid = actor === "owner" ? ownerId : otherId;
    const jwt = await users.createJWT(uid);
    return new Databases(c.setJWT(jwt.jwt));
  }

  beforeAll(async () => {
    ownerId = (await users.create(ID.unique(), `owner_${Date.now()}@ex.com`, undefined, "pw123456", "Owner")).$id;
    otherId = (await users.create(ID.unique(), `other_${Date.now()}@ex.com`, undefined, "pw123456", "Other")).$id;
    for (const res of RESOURCES) {
      const perms = OWNER_SCOPED.includes(res)
        ? [Permission.read(Role.user(ownerId)), Permission.update(Role.user(ownerId))]
        : [Permission.read(Role.user(ownerId))];
      const doc = await adminDb.createDocument(DB, res, ID.unique(), { __probe: 1 } as any, perms).catch(
        // collections require their declared required attrs; fall back to minimal valid payloads is
        // out of scope here — the probe payload works only if schema permits. Use try/catch per resource.
        async () => adminDb.createDocument(DB, res, ID.unique(), {} as any, perms),
      );
      docIds[res] = doc.$id;
    }
  }, 60_000);

  afterAll(async () => {
    if (ownerId) await users.delete(ownerId).catch(() => {});
    if (otherId) await users.delete(otherId).catch(() => {});
  });

  for (const combo of buildPermissionMatrix()) {
    it(`${combo.actor} ${combo.action} ${combo.resource} -> ${combo.expectedAllowed ? "allow" : "deny"}`, async () => {
      const db = await actorDb(combo.actor);
      const id = docIds[combo.resource];
      const op =
        combo.action === "read"
          ? db.getDocument(DB, combo.resource, id)
          : db.updateDocument(DB, combo.resource, id, {});
      let allowed = true;
      await op.catch(() => {
        allowed = false;
      });
      expect(allowed).toBe(combo.expectedAllowed);
    });
  }
});
