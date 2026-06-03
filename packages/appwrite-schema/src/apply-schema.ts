// Idempotent apply of the declared schema to a target Appwrite instance.
// Creates/syncs database, collections, attributes, indexes, and storage buckets.
// Refuses destructive attribute type changes.
import { Databases, Storage, IndexType } from "node-appwrite";
import { databases, storage, loadDotEnv } from "./client.js";
import {
  DATABASE_ID,
  DATABASE_NAME,
  COLLECTIONS,
  BUCKETS,
  type AttrDef,
  type CollectionDef,
} from "./schema.js";

// Appwrite reports enum attrs as type "string"; map declared -> reported type.
function reportedType(t: AttrDef["type"]): string {
  return t === "enum" ? "string" : t;
}

async function ignoreExists<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e: any) {
    if (e?.code === 409) return undefined; // already exists
    throw e;
  }
}

async function ensureDatabase(db: Databases): Promise<void> {
  try {
    await db.get(DATABASE_ID);
  } catch {
    await ignoreExists(db.create(DATABASE_ID, DATABASE_NAME));
  }
}

async function listAttrKeys(
  db: Databases,
  collId: string,
): Promise<Map<string, string>> {
  try {
    const res: any = await db.listAttributes(DATABASE_ID, collId);
    return new Map(res.attributes.map((a: any) => [a.key, a.type]));
  } catch {
    return new Map();
  }
}

function collectConflicts(
  coll: CollectionDef,
  existing: Map<string, string>,
): string[] {
  const conflicts: string[] = [];
  for (const attr of coll.attributes) {
    const cur = existing.get(attr.key);
    if (cur && cur !== reportedType(attr.type)) {
      conflicts.push(`${coll.id}.${attr.key}: ${cur} -> ${reportedType(attr.type)}`);
    }
  }
  return conflicts;
}

async function createAttribute(db: Databases, collId: string, a: AttrDef): Promise<void> {
  const def = a.required ? undefined : (a.default ?? undefined);
  switch (a.type) {
    case "string":
      await db.createStringAttribute(DATABASE_ID, collId, a.key, a.size ?? 255, a.required, def as string | undefined, a.array);
      break;
    case "integer":
      await db.createIntegerAttribute(DATABASE_ID, collId, a.key, a.required, undefined, undefined, def as number | undefined, a.array);
      break;
    case "double":
      await db.createFloatAttribute(DATABASE_ID, collId, a.key, a.required, undefined, undefined, def as number | undefined, a.array);
      break;
    case "boolean":
      await db.createBooleanAttribute(DATABASE_ID, collId, a.key, a.required, def as boolean | undefined, a.array);
      break;
    case "datetime":
      await db.createDatetimeAttribute(DATABASE_ID, collId, a.key, a.required, def as string | undefined, a.array);
      break;
    case "enum":
      await db.createEnumAttribute(DATABASE_ID, collId, a.key, a.elements ?? [], a.required, def as string | undefined, a.array);
      break;
  }
}

async function waitAttributesAvailable(db: Databases, collId: string, keys: string[]): Promise<void> {
  for (let i = 0; i < 30 && keys.length; i++) {
    const res: any = await db.listAttributes(DATABASE_ID, collId);
    const avail = new Set(res.attributes.filter((a: any) => a.status === "available").map((a: any) => a.key));
    keys = keys.filter((k) => !avail.has(k));
    if (!keys.length) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function ensureBuckets(st: Storage): Promise<void> {
  for (const b of BUCKETS) {
    try {
      await st.getBucket(b.id);
    } catch {
      await ignoreExists(st.createBucket(b.id, b.name, b.permissions, b.fileSecurity));
      console.log(`+ bucket ${b.id}`);
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const db = databases();
  const st = storage();
  await ensureDatabase(db);

  // 1) Pre-scan for destructive type changes before mutating anything.
  const existingByColl = new Map<string, Map<string, string>>();
  const allConflicts: string[] = [];
  for (const coll of COLLECTIONS) {
    await ignoreExists(db.createCollection(DATABASE_ID, coll.id, coll.name, coll.permissions, coll.documentSecurity));
    const existing = await listAttrKeys(db, coll.id);
    existingByColl.set(coll.id, existing);
    allConflicts.push(...collectConflicts(coll, existing));
  }
  if (allConflicts.length) {
    console.error("ERROR: destructive attribute type changes detected; aborting:");
    for (const c of allConflicts) console.error("  - " + c);
    process.exit(1);
  }

  // 2) Create missing attributes, then indexes.
  for (const coll of COLLECTIONS) {
    const existing = existingByColl.get(coll.id)!;
    const created: string[] = [];
    for (const a of coll.attributes) {
      if (!existing.has(a.key)) {
        await createAttribute(db, coll.id, a);
        created.push(a.key);
        console.log(`+ ${coll.id}.${a.key}`);
      }
    }
    if (created.length) await waitAttributesAvailable(db, coll.id, created);

    const idx: any = await ignoreExists(db.listIndexes(DATABASE_ID, coll.id));
    const idxKeys = new Set((idx?.indexes ?? []).map((i: any) => i.key));
    for (const index of coll.indexes) {
      if (!idxKeys.has(index.key)) {
        await ignoreExists(db.createIndex(DATABASE_ID, coll.id, index.key, index.type as IndexType, index.attributes));
        console.log(`+ index ${coll.id}.${index.key}`);
      }
    }
  }

  await ensureBuckets(st);
  console.log("schema:apply OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
