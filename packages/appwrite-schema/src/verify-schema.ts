// Compare declared schema with the deployed Appwrite instance. Prints OK or a
// human-readable diff and exits non-zero when they differ.
import { Databases, Storage } from "node-appwrite";
import { databases, storage, loadDotEnv } from "./client.js";
import { DATABASE_ID, COLLECTIONS, BUCKETS, type AttrDef } from "./schema.js";

function reportedType(t: AttrDef["type"]): string {
  return t === "enum" ? "string" : t;
}

async function diffCollections(db: Databases): Promise<string[]> {
  const diffs: string[] = [];
  for (const coll of COLLECTIONS) {
    let deployed: any;
    try {
      deployed = await db.getCollection(DATABASE_ID, coll.id);
    } catch {
      diffs.push(`missing collection: ${coll.id}`);
      continue;
    }
    const attrs = new Map<string, any>((deployed.attributes ?? []).map((a: any) => [a.key, a]));
    for (const a of coll.attributes) {
      const cur = attrs.get(a.key);
      if (!cur) diffs.push(`missing attribute: ${coll.id}.${a.key}`);
      else if (cur.type !== reportedType(a.type))
        diffs.push(`type mismatch: ${coll.id}.${a.key} deployed=${cur.type} declared=${reportedType(a.type)}`);
      else if (a.type === "enum") {
        const declared = a.elements ?? [];
        const live = (cur.elements ?? []) as string[];
        const mismatch =
          declared.length !== live.length || declared.some((v, i) => v !== live[i]);
        if (mismatch) {
          diffs.push(
            `enum elements mismatch: ${coll.id}.${a.key} deployed=[${live.join(",")}] declared=[${declared.join(",")}]`,
          );
        }
      }
    }
    const idxs = new Set<string>((deployed.indexes ?? []).map((i: any) => i.key));
    for (const i of coll.indexes) {
      if (!idxs.has(i.key)) diffs.push(`missing index: ${coll.id}.${i.key}`);
    }
    if (deployed.documentSecurity !== coll.documentSecurity)
      diffs.push(`documentSecurity mismatch: ${coll.id}`);
  }
  return diffs;
}

async function diffBuckets(st: Storage): Promise<string[]> {
  const diffs: string[] = [];
  for (const b of BUCKETS) {
    try {
      await st.getBucket(b.id);
    } catch {
      diffs.push(`missing bucket: ${b.id}`);
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  loadDotEnv();
  const diffs = [...(await diffCollections(databases())), ...(await diffBuckets(storage()))];
  if (diffs.length) {
    console.error("schema:verify DIFF");
    for (const d of diffs) console.error("  - " + d);
    process.exit(1);
  }
  console.log("schema:verify OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
