import postgres from 'postgres';

let _sql: postgres.Sql | undefined;

/**
 * Lazily-initialised Postgres client. Reads DATABASE_URL (Supabase direct
 * connection string). One pooled instance per process.
 */
export function getSql(): postgres.Sql {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — point it at the Supabase Postgres connection string');
  }
  _sql = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 30,
    // Supabase requires TLS; allow the pooled cert chain.
    ssl: url.includes('localhost') ? false : 'require',
    transform: { undefined: null },
  });
  return _sql;
}

export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
  }
}

export type Sql = postgres.Sql;

/**
 * The `postgres` lib's json() helper has a very strict JSONValue type that
 * rejects our domain interfaces (no index signature) even though they are
 * genuinely JSON-serialisable. This narrows the cast to one audited place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toJson = (value: unknown): any => value;
