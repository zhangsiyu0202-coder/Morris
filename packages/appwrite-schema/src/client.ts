import { Client, Databases, Storage } from "node-appwrite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Load repo-root .env into process.env if present (no dotenv dependency). */
export function loadDotEnv(): void {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const text = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env; rely on real environment */
  }
}


export function serverClient(): Client {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID;
  const key = process.env.APPWRITE_API_KEY;
  if (!endpoint || !project || !key) {
    throw new Error(
      "Missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY",
    );
  }
  return new Client().setEndpoint(endpoint).setProject(project).setKey(key);
}

export function databases(): Databases {
  return new Databases(serverClient());
}

export function storage(): Storage {
  return new Storage(serverClient());
}
