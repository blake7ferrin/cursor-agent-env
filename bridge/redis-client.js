import { createClient } from 'redis';

let clientPromise = null;

export function hasRedisConfig() {
  return !!process.env.REDIS_URL;
}

export async function getRedisClient() {
  if (!hasRedisConfig()) return null;
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => {
      console.error(`Redis error: ${err.message}`);
    });
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}
