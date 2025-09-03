import { config } from 'dotenv';
config()
import cors from "cors";
import Redis from "ioredis";
import { join } from 'path';
import { updateUserOnlineStatus, updateLastActive, fetchUserGroups, updateReadReceipts } from './utils.js';
import { getMongoDb } from './mongodb.js';
import './socket/chats.js'
import './socket/blog.js'
import './socket/follow.js'
import './socket/calls.js'
import { io, UserSocket } from './socket.js';
import { app, corsOptions, server } from './server.js';
import callsRouter from './routes/calls.js';

app.use(cors(corsOptions));

// API routes
app.use('/api/calls', callsRouter);

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

  socket.on('updateSettings', async (data: {
    twoFactorAuth: boolean;
    loginAlerts: boolean;
    showOnlineStatus: boolean;
    showLastSeen: boolean;
    showReadReceipts: boolean;
    showTypingStatus: boolean;
}) => {
    console.log('updateSettings: ' + data);
    if (data.showOnlineStatus) {
      await updateUserOnlineStatus(userId as string, true, redis, USER_TIMEOUT);
    } else {
      await updateUserOnlineStatus(userId as string, false, redis, USER_TIMEOUT);
    }
    if (data.showLastSeen) {
      await updateLastActive(userId as string, redis);
    }
    if (data.showReadReceipts) {
      await updateReadReceipts(userId as string, redis);
    }
  });

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

  // Legacy events kept for compatibility
  socket.on('offer', (data) => {
    const { room, offer } = data;
    io.to(`group:${room}`).emit('offer', {offer, room});
  // console.log('offer: ' + data)
  });

  socket.on('callOffer', (data) => {
    const { room, offer } = data;
    io.to(`group:${room}`).emit('offer', {offer, room});
  // console.log('callOffer: ' + data)
  });

  socket.on('join-room', async (roomId) => {
    // Add type checking and logging
    console.log('join-room called with:', roomId, 'type:', typeof roomId);
    
    if (typeof roomId !== 'string') {
      console.error('Invalid roomId type:', typeof roomId, 'value:', roomId);
      return;
    }
    
    socket.join(roomId);
    
    // Check if this is a call room (starts with 'call_')
    if (roomId.startsWith('call_')) {
      // Call room - just join, no Redis storage needed
      console.log(`User ${userId} joined call room: ${roomId}`);
    } else {
      // Regular chat room - store in Redis
      await redis.sadd(`room:${roomId}`, userId);
      const roomMembers = await redis.smembers(`room:${roomId}`);
      if (roomMembers.length >= 2) {
        io.to(roomId).emit('user-joined');
      }
    }

    // console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('hangup', (room) => {
    io.to(`group:${room}`).emit('remote-hangup', room)
  })

  socket.on('user-joined', (payload) => {
    const room = typeof payload === 'string' ? payload : (payload && payload.room);
    if (!room) return;
    io.to(`group:${room}`).emit('user-joined', room)
  })

  socket.on('answer', (data) => {
    const { room, answer } = data;
    io.to(`group:${room}`).emit('answer', answer);
  // console.log('answer: ' + data)
  });

  socket.on('candidate', (data) => {
    const { room, candidate } = data;
    io.to(`group:${room}`).emit('candidate', candidate);
  // console.log('candidate: ' + data)
  });

  // New: call hangup broadcast
  socket.on('call:hangup', (data: { room: string }) => {
    const { room } = data || ({} as any);
    if (!room) return;
    io.to(`group:${room}`).emit('call:hangup', { room });
  });

  // Call invitation handling (new API)
  socket.on('call:invite', async (data: {
    roomId: string;
    targetUserId?: string;
    callType: 'audio' | 'video';
    chatType: 'DMs' | 'Groups';
  }) => {
    const { handleCallInvite } = await import('./socket/calls.js');
    handleCallInvite(socket, data);
  });

  // Call answer handling
  socket.on('call:answer', async (data: {
    callId: string;
    accepted: boolean;
  }) => {
    const { handleCallAnswer } = await import('./socket/calls.js');
    handleCallAnswer(socket, data);
  });

  // Call end handling
  socket.on('call:end', async (data: {
    callId: string;
  }) => {
    const { handleCallEnd } = await import('./socket/calls.js');
    handleCallEnd(socket, data);
  });

  // WebRTC signaling for calls
  socket.on('webrtc:offer', async (data: {
    callId: string;
    offer: any;
  }) => {
    const { handleWebRTCOffer } = await import('./socket/calls.js');
    handleWebRTCOffer(socket, data);
  });

  socket.on('webrtc:answer', async (data: {
    callId: string;
    answer: any;
  }) => {
    const { handleWebRTCAnswer } = await import('./socket/calls.js');
    handleWebRTCAnswer(socket, data);
  });

  socket.on('webrtc:candidate', async (data: {
    callId: string;
    candidate: any;
  }) => {
    const { handleWebRTCCandidate } = await import('./socket/calls.js');
    handleWebRTCCandidate(socket, data);
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
app.get("/", (_, res) => {
  console.log('Hi');
  res.status(200).json("Hello World!");
});

app.get("/socket", (_, res) => {
  res.status(202).json({ message: 'Success' });
});

app.get("/health", (_, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.get("*", (_, res) => {
  res.status(404).sendFile(join(__dirname.replace('src', 'public'), '/404.html'));
})

// Start the server
server.listen(port, () => {
  console.log(`Listening on port ${port}...`);
}).on('error', (error) => {
  console.error('Server error:', error);
});