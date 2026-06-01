/**
 * Minimal forward-only migration runner. Applies every *.sql file in
 * ./migrations in lexical order, tracking applied files in a `_migrations`
 * table. Idempotent — re-running only applies new files.
 *
 * Usage: pnpm db:migrate   (reads DATABASE_URL from env)
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSql, closeSql } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function main(): Promise<void> {
  const sql = getSql();

  await sql`
    create table if not exists _migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`select filename from _migrations`).map((r) => r.filename),
  );

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· skip ${file} (already applied)`);
      continue;
    }
    const text = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`▶ applying ${file} …`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into _migrations (filename) values (${file})`;
    });
    count++;
    console.log(`✓ applied ${file}`);
  }

  console.log(count === 0 ? 'Up to date — no migrations applied.' : `Done — applied ${count} migration(s).`);
  await closeSql();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await closeSql();
  process.exit(1);
});
