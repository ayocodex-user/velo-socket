import { config } from 'dotenv';
config()
import cors from "cors";
import Redis from "ioredis";
import { join } from 'path';
import { updateUserOnlineStatus, updateLastActive, fetchUserGroups } from './utils.js';
import { getMongoDb } from './mongodb.js';
import './socket/chats.js'
import './socket/blog.js'
import { io, UserSocket } from './socket.js';
import { app, corsOptions, server } from './server.js';

app.use(cors(corsOptions));

const port = 8080;

export const redis = new Redis(process.env.REDIS_URL || '');

export const ONLINE_USERS_KEY = 'online_users';
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
export const USER_TIMEOUT = 60; // 60 seconds

// Socket connection handling
io.on('connection', async (socket: UserSocket) => {
  // console.log('Connected to the socket ctrl');
  const userId = socket.handshake.query.userId as string;
  const BATCH_INTERVAL = 5000; // 5 seconds
  const statusUpdates = new Map();

  setInterval(() => {
    if (statusUpdates.size > 0) {
      io.emit('batchUserStatus', Array.from(statusUpdates));
      statusUpdates.clear();
    }
  }, BATCH_INTERVAL);

  const db = await getMongoDb()

  socket.on('register', async () => {
    // console.log('Connected to the socket ctrl:', userId);
    if (userId) {
      const isAlreadyConnected = await redis.sismember(ONLINE_USERS_KEY, userId);
      const groups: string[] = (await fetchUserGroups(userId)).map(group =>`group:${group._id.toString()}`);
      if (!isAlreadyConnected) {
        await redis.sadd(ONLINE_USERS_KEY, userId);
        await updateUserOnlineStatus(userId, true, redis, USER_TIMEOUT);
      }
      socket.join(`user:${userId}`);
      socket.join(groups);
      // console.log(`User ${userId} joined group:${groups}`);
    }
  });

  updateUserOnlineStatus(userId as string, true, redis, USER_TIMEOUT)

  socket.on('activity', () => {
    updateLastActive(userId as string, redis);
  });

  const heartbeat = setInterval(async () => {
    if (userId) {
      await updateUserOnlineStatus(userId, true, redis, USER_TIMEOUT);
    }
  }, HEARTBEAT_INTERVAL);

  socket.on('disconnect', async () => {
    clearInterval(heartbeat);
    if (userId) {
      await redis.srem(ONLINE_USERS_KEY, userId);
      await updateUserOnlineStatus(userId, false, redis, USER_TIMEOUT);
    }
    socket.removeAllListeners();
  });

  socket.on('offer', (data) => {
    const { room, offer } = data;
    socket.to(`group:${room}`).emit('offer', {offer, room});
    console.log('offer: ' + data)
  });

  socket.on('callOffer', (data) => {
    const { room, offer } = data;
    socket.to(`group:${room}`).emit('offer', {offer, room});
    console.log('callOffer: ' + data)
  });

  socket.on('join-room', async (roomId) => {
    socket.join(roomId);
    await redis.sadd(`room:${roomId}`, userId);

    const roomMembers = await redis.smembers(`room:${roomId}`);
    if (roomMembers.length === 2) {
      socket.to(roomId).emit('user-joined');
    }

    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('hangup', (room) => {
    socket.to(`group:${room}`).emit('remote-hangup', room)
  })

  socket.on('user-joined', (room) => {
    socket.to(`group:${room}`).emit('user-joined', room)
  })

  socket.on('answer', (data) => {
    const { room, answer } = data;
    socket.to(`group:${room}`).emit('answer', answer);
    console.log('answer: ' + data)
  });

  socket.on('candidate', (data) => {
    const { room, candidate } = data;
    socket.to(`group:${room}`).emit('candidate', candidate);
    console.log('candidate: ' + data)
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  socket.on('subscribeToUser', async (userId: string) => {
    socket.join(`user:${userId}`);
    const isOnline = await redis.get(`user:${userId}:online`);
    io.emit('userStatus', { userId, status: isOnline ? 'online' : 'offline' });
  });

  socket.on('getRoomMembers', (chatId: string) => {
    const room = io.sockets.adapter.rooms.get(chatId);
    const members = room ? Array.from(room) : [];
    io.emit('roomMembers', { chatId, members });
  });
});

// Handle connection errors
io.engine.on("connection_error", (err) => {
  // console.error('Connection error:', err);
  console.log('Error details:', JSON.stringify(err, null, 2)); // Log detailed error
});

// Basic routes
app.get("/", (req, res) => {
  console.log('Hi');
  res.status(200).json("Hello World!");
});

app.get("/socket", (req, res) => {
  res.status(202).json({ message: 'Success' });
});

app.get("*", (req, res) => {
  res.sendFile(join(__dirname, '/404.html'))
})

// Start the server
server.listen(port, () => {
  console.log(`Listening on port ${port}...`);
}).on('error', (error) => {
  console.error('Server error:', error);
});