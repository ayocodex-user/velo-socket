import { ObjectId } from 'mongodb';
import { io } from './socket.js';
import { getMongoDb, MongoDBClient } from './mongodb.js';
import Redis from 'ioredis';

export const ONLINE_USERS_KEY = 'online_users';
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const USER_TIMEOUT = 60; // 60 seconds

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
  const currentStatus = await redis.sismember(ONLINE_USERS_KEY, userId);
  let status;

  if (isOnline) {
    if (currentStatus === 0) await redis.sadd(ONLINE_USERS_KEY, userId);
    status = 'online';
  } else {
    if (currentStatus === 1) await redis.srem(ONLINE_USERS_KEY, userId);
    status = 'offline';
    const lastActive = await redis.get(`user:${userId}:lastActive`);
    io.emit('lastActive', { userId, lastActive });
  }
  io.emit('userStatus', { userId, status });
}

export async function updateLastActive(userId: string, redis: Redis) {
  await redis.set(`user:${userId}:lastActive`, new Date().toISOString());
}

export const fetchUserGroup = async (userId: string) => {
  const db = await new MongoDBClient().init();
  const participantList = await db.chatParticipants().find({ userId: userId, chatType: 'Group' }).toArray();
  const chatIds = participantList.map(chat => chat.chatId);
  
  return db.chats().find({ _id: { $in: chatIds.map(id => new ObjectId(id)) } }).toArray();
};

export async function updateReadReceipts(userId: string, redis: Redis) {
  await redis.set(`user:${userId}:readReceipts`, new Date().toISOString());
}

