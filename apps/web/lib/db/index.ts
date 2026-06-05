import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __pool?: Pool };

export const pool =
  globalForDb.__pool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (!globalForDb.__pool) globalForDb.__pool = pool;

export const db = drizzle(pool, { schema });
