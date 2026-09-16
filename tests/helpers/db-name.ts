/**
 * The safety catch for the destructive integration suite: `resetDb()` deletes
 * every document in whatever `DATABASE_URL` points at, so it must never run
 * against the demo/dev database. Pure string work, unit-tested under
 * `tests/unit/helpers/db-name.test.ts`; nothing here reads `process.env`
 * except `assertTestDatabase`.
 */

/**
 * The database name in a Mongo connection string: the path segment after the
 * authority and before the query string. `null` when the url names no database
 * (`mongodb://host:27017`, `.../?replicaSet=rs0`) or is missing entirely.
 */
export function databaseNameFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const afterScheme = url.replace(/^[a-z+]+:\/\//i, '');
  const slash = afterScheme.indexOf('/'); // the authority (userinfo + host list) cannot contain one
  if (slash === -1) return null;
  const name = afterScheme.slice(slash + 1).split('?')[0] ?? '';
  return name === '' ? null : name;
}

/**
 * The refusal message for a destructive run against `url`, or `null` when the
 * run is allowed: the database name must end with `_test`, unless
 * `ALLOW_DESTRUCTIVE_TESTS` is exactly `'1'`.
 */
export function destructiveDbError(
  url: string | undefined | null,
  allowDestructive: string | undefined
): string | null {
  if (allowDestructive === '1') return null;
  const name = databaseNameFromUrl(url);
  if (name?.endsWith('_test')) return null;
  return `Refusing to wipe "${name ?? '(no database in DATABASE_URL)'}" — point DATABASE_URL at a *_test database (see README › Tests)`;
}

/** Throws unless the current `DATABASE_URL` is safe to wipe. */
export function assertTestDatabase(): void {
  const message = destructiveDbError(process.env.DATABASE_URL, process.env.ALLOW_DESTRUCTIVE_TESTS);
  if (message) throw new Error(message);
}
