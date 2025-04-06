import { config } from 'dotenv';
config()
import { MongoClient, ServerApiVersion } from 'mongodb';

const uri = process.env.MONGOLINK || '';

if (!uri) {
  throw new Error('Please add your MongoDB URI to .env');
}

let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient>;

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 60000,
  socketTimeoutMS: 60000,
  maxPoolSize: 50,
  minPoolSize: 5,
  maxIdleTimeMS: 60000,
  waitQueueTimeoutMS: 30000,
};

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>
  }

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export async function getMongoClient() {
  if (!client || !client.connect) {
    client = await clientPromise;
  }
  return client;
}

export async function getMongoDb(dbName: string = 'mydb') {
  const client = await getMongoClient();
  return client.db(dbName);
}

// For testing purposes
export async function closeMongoConnection() {
  if (client) {
    await client.close();
    client = null;
  }
}

export default clientPromise;
