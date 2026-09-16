import { MongoClient, type Db } from 'mongodb';

const g = globalThis as unknown as { mongoClient?: MongoClient };

export async function getMongoDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // One change stream (one checked-out connection) per connected dashboard, so
  // the pool caps how many /api/events streams an instance can hold at once.
  if (!g.mongoClient) g.mongoClient = new MongoClient(url, { maxPoolSize: 10 });
  await g.mongoClient.connect();
  return g.mongoClient.db(); // db name comes from the connection string
}
