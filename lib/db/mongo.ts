/**
 * lib/db/mongo.ts — the ONE place the native `mongodb` driver is allowed
 * (CLAUDE.md invariant). Prisma has no `watch()`, so `GET /api/events`
 * (realtime, architecture §10) needs a raw driver `Db` handle to open change
 * streams on Order/InstallJob/Asset; everything else in the app goes through
 * Prisma.
 */
import { MongoClient, type Db } from 'mongodb';

const g = globalThis as unknown as { mongoClient?: MongoClient };

/**
 * Returns the shared native-driver `Db`, connecting (and caching the client
 * on `globalThis`, same pattern as `lib/db/prisma.ts`) on first call. A
 * second client alongside Prisma's own connection is the trade-off for
 * change streams; `maxPoolSize: 10` bounds it because one SSE connection
 * holds one connection open for the life of the stream, so the pool caps how
 * many `/api/events` streams an instance can serve at once.
 *
 * @throws {Error} if `DATABASE_URL` is not set.
 */
export async function getMongoDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!g.mongoClient) g.mongoClient = new MongoClient(url, { maxPoolSize: 10 });
  await g.mongoClient.connect();
  return g.mongoClient.db(); // db name comes from the connection string
}
