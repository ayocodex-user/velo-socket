import { ObjectId } from 'mongodb';
import { io } from './socket.js';
import { getMongoDb } from './mongodb.js';
import Redis from 'ioredis';

export function timeFormatter(){
  const time = new Date().toLocaleString()
  const [datePart, _] = time.split(', ');
  let [month, day, year] = datePart.split('/')
  const formattedDate = year + '/' + month + '/' + day;
  return formattedDate;
}

export function secretKeyy(){
  const secretKey = new ObjectId();
  return secretKey;
}

export async function updateUserOnlineStatus(userId: string, isOnline: boolean, redis: Redis, USER_TIMEOUT: number) {
  const currentStatus = await redis.get(`user:${userId}:online`);
  let status;

  if (isOnline) {
    if (currentStatus !== 'true') await redis.set(`user:${userId}:online`, 'true', 'EX', USER_TIMEOUT);
    status = 'online';
  } else {
    if (currentStatus !== null) await redis.del(`user:${userId}:online`);
    status = 'offline';
    const lastActive = await redis.get(`user:${userId}:lastActive`);
    io.emit('lastActive', { userId, lastActive });
  }
  io.emit('userStatus', { userId, status });
}

export async function updateLastActive(userId: string, redis: Redis) {
  await redis.set(`user:${userId}:lastActive`, new Date().toISOString());
}export const fetchUserGroups = async (userId: string): Promise<any[]> => {
  return await (await getMongoDb()).collection('chats').find({
    'participants.id': userId,
    // 'chatType': 'Groups'
  }).toArray();
};

