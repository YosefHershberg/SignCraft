import { MongoClient, type Db } from 'mongodb';

const g = globalThis as unknown as { mongoClient?: MongoClient };

export async function getMongoDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!g.mongoClient) g.mongoClient = new MongoClient(url, { maxPoolSize: 5 });
  await g.mongoClient.connect();
  return g.mongoClient.db(); // db name comes from the connection string
}
