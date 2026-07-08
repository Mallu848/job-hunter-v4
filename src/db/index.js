import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;
let driver;

if (process.env.DATABASE_URL) {
  // --- Postgres path (node-postgres) ---
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
  driver = 'postgres';
} else {
  // --- PGlite path (persisted locally) ---
  const { drizzle } = await import('drizzle-orm/pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = path.resolve(__dirname, '../../data/pglite');
  // PGlite's node FS does a non-recursive mkdir, so a fresh checkout (no
  // ./data at all) would crash on boot without this.
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);

  // Auto-create tables for the PGlite path (idempotent). See README for why
  // this differs from the Postgres path, which uses `npm run db:push`.
  const bootstrapSql = fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8');
  await client.exec(bootstrapSql);

  db = drizzle(client, { schema });
  driver = 'pglite';
}

export { db, driver };
