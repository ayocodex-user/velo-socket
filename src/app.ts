import { config } from 'dotenv';
config()
import express from "express";
import { Server, Socket } from "socket.io";
import http from "http";
import cors from "cors";
// import { socketCtrl } from "./controller/socket";
import Redis from "ioredis";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import type { ConvoType, ConvoType1, GroupMessageAttributes, MessageAttributes, NewChat_, Participant } from "./types";
import { msgStatus } from './types';
import { deleteFileFromS3, uploadFileToS3 } from './s3.js';


export const app = express();

// Dynamic CORS options
const whitelist = [process.env.ALLOWED_URL, process.env.ALLOWED_URL_1]

const corsOptions = {
  origin: function (origin: any, callback: (arg0: Error | null, arg1: boolean | undefined) => void) {
    console.log('Request Origin:', origin);
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'), false)
    }
  }, // Allow requests from this origin 
  methods: ['GET', 'POST'], // Allowed methods
  credentials: true // Allow credentials
};

// Enable CORS with dynamic options
app.use(cors(corsOptions));

const port = 8080;

type UserSocket = Socket & { userId?: string };

// Create HTTP server
export const server = http.createServer(app);

export const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  path: '/wxyrt',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: corsOptions,
  cookie: true, // Added to access cookies
});



// Set max listeners to avoid memory leak warnings
io.setMaxListeners(20);

const redis = new Redis(process.env.REDIS_URL || '');

const uri = process.env.MONGOLINK ? process.env.MONGOLINK : '';
let client: MongoClient;
const MONGODB_DB = 'mydb';
const ONLINE_USERS_KEY = 'online_users';
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const USER_TIMEOUT = 60; // 60 seconds
const rooms = new Map();

export const fetchUserGroups = async (userId: string): Promise<any[]> => {
  return await client.db(MONGODB_DB).collection('chats').find({ 
      'participants.id': userId,
      // 'chatType': 'Groups'
  }).toArray();
};

async function updateUserOnlineStatus(userId: string, isOnline: boolean) {
  const currentStatus = await redis.get(`user:${userId}:online`);
  let status;
  
  if (isOnline && currentStatus !== 'true') {
    await redis.set(`user:${userId}:online`, 'true', 'EX', USER_TIMEOUT);
    status = 'online'
  } else if (!isOnline && currentStatus !== null) {
    await redis.del(`user:${userId}:online`);
    status = 'offline'
  }
  io.emit('userStatus', { userId, status });
}

async function updateLastActive(userId: string) {
  await redis.set(`user:${userId}:lastActive`, Date.now());
}

// Socket connection handling
io.on('connection', async (socket: UserSocket) => {
  // console.log('Connected to the socket ctrl');
  const userId = socket.handshake.query.userId;
  const BATCH_INTERVAL = 5000; // 5 seconds
  const statusUpdates = new Map();

  setInterval(() => {
    if (statusUpdates.size > 0) {
      io.emit('batchUserStatus', Array.from(statusUpdates));
      statusUpdates.clear();
    }
  }, BATCH_INTERVAL);

  if (!client) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
      },
      connectTimeoutMS: 60000,
      maxPoolSize: 10
    });
    await client.connect();
    console.log("Mongoconnection: You successfully connected to MongoDB!");
  }

  socket.on('register', async (userId: string) => {
    // console.log('Connected to the socket ctrl:', userId);
    if (userId) {
      const isAlreadyConnected = await redis.sismember(ONLINE_USERS_KEY, userId);
      const groups: string[] = (await fetchUserGroups(userId)).map(group =>`group:${group._id.toString()}`);
      if (!isAlreadyConnected) {
        await redis.sadd(ONLINE_USERS_KEY, userId);
        await updateUserOnlineStatus(userId, true);
      }
      socket.userId = userId;
      socket.join(`user:${userId}`);
      socket.join(groups);
      // console.log(`User ${userId} joined group:${groups}`);
    }
  });

  updateUserOnlineStatus(userId as string, true)

  socket.on('activity', () => {
    updateLastActive(userId as string);
  });

  const heartbeat = setInterval(async () => {
    if (socket.userId) {
      await updateUserOnlineStatus(socket.userId, true);
    }
  }, HEARTBEAT_INTERVAL);

  socket.on('disconnect', async () => {
    clearInterval(heartbeat);
    if (socket.userId) {
      await redis.srem(ONLINE_USERS_KEY, socket.userId);
      await updateUserOnlineStatus(socket.userId, false);
    }
    socket.removeAllListeners();
  });

  socket.on('leaveChat', (chatId: string) => {
    socket.leave(chatId);
  });

  socket.on('addChat', async (data: NewChat_) => {
    // console.log(data.chat.participants)
    const uniqueParticipants = Array.from(new Set(data.chat.participants.map(participant => `user:${participant.id}`)));
    console.log(uniqueParticipants)
    io.to(uniqueParticipants).emit('newChat', data);
  });

  socket.on('updateConversation', async (data: {id: string, updates: Partial<ConvoType1>}) => {
    const { id, updates } = data;
    // console.log(data,socket.userId)
    const chatId = new ObjectId(id);

    if (data.updates.deleted){
      (await client.db(MONGODB_DB).collection('chatMessages').
      findOne({ $or: [{ _id: chatId }, { Oid: chatId }] }) as unknown as MessageAttributes)
      .attachments.map(a => a.name).map(async (name) => {
        await deleteFileFromS3('files-for-chat', name);
      });
      if (data.updates.convo){
         await client.db(MONGODB_DB).collection('chats').deleteOne({ _id: chatId })
         await client.db(MONGODB_DB).collection('chatMessages').deleteMany({ chatId: chatId })
        // console.log(`Deleted ${result.deletedCount + result1.deletedCount} message(s)`); // Log the result of the deletion
        return;
      }
      await client.db(MONGODB_DB).collection('chatMessages').deleteOne({ $or: [{ _id: chatId }, { Oid: chatId}] })
      // console.log(`Deleted ${result.deletedCount} message(s)`); // Log the result of the deletion
      return;
    }

    const updateFields = Object.keys(updates).map((key) => {
      return `participants.$[p].${key}`;
    });
    const update = {
      $set: updateFields.reduce((acc, field, index) => {
        acc[field] = updates[Object.keys(updates)[index] as keyof typeof updates];
        return acc;
      }, {} as Record<string, any>),
    };
    
    const options = {
      arrayFilters: [{ "p.id": updates.userId }],
    };

    const result = await client.db(MONGODB_DB).collection('chats').updateOne({ _id: chatId }, update, options);
    // console.log(`Changed prop is ${result}`)
    io.to(`user:${updates.userId}`).emit('conversationUpdated', { id: chatId.toString(), updates });
  });

  socket.on('chatMessage', async (data: MessageAttributes | GroupMessageAttributes) => {
    // console.log('Message')
    // console.log(data)
    const chats = await client.db(MONGODB_DB).collection('chats').findOne({ _id: new ObjectId(data.chatId as string) });
    const senderId = 'sender' in data ? data.sender.id : data.senderId;
    const sender = 'sender' in data ? 'sender' : 'senderId';
    const senderDetails = 'sender' in data ? data.sender : data.senderId;

      // Handle multiple file uploads (if attachments exist)
      let attachmentsWithUrls = [];
      if (data.attachments && data.attachments.length > 0) {
        // Upload each file to S3 and store the URLs
        for (const file of data.attachments) {
          try {
            const fileBuffer = Buffer.from(file.data); // Assuming file.data is the file content as a Buffer
            const fileUrl = await uploadFileToS3('files-for-chat',fileBuffer, file.name, file.type);
            attachmentsWithUrls.push({
              name: file.name,
              type: file.type,
              url: fileUrl, // Add the S3 URL to the attachment
              size: Buffer.byteLength(fileBuffer)
            });
          } catch (error) {
            console.error('Error uploading file to S3:', error);
            attachmentsWithUrls.push({
              name: file.name,
              type: file.type,
              url: null, // Mark the file as failed to upload
            });
          }
        }
      }

    // Messages Collection
    const message = {
      _id: new ObjectId(data._id as string),
      chatId: new ObjectId(data.chatId as string), // Reference to the chat in DMs collection
      [sender]: senderDetails,
      receiverId: data.receiverId,
      content: data.content,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
      messageType: data.messageType,
      isRead: {
        [senderId]: true,
        [data.receiverId]: false,
      }, // Object with participant IDs as keys and their read status as values
      reactions: data.reactions || [],
      attachments: attachmentsWithUrls || [],
      quotedMessage: data.quotedMessage,
      status: 'sent' as msgStatus,
    };
    // Assuming `message` is defined and contains the necessary properties
    const updateParticipants = chats?.participants.map((participant: Participant) => {
        return {
            updateOne: {
                filter: { _id: new ObjectId(message.chatId) }, // Match the chat by its ID
                update: {
                    $set: {
                      [`participants.$[p].lastMessageId`]: message._id, // Set lastMessageId to message._id
                      lastUpdated: new Date().toISOString()
                    },
                    $inc: {
                      [`participants.$[p].unreadCount`]: 1
                    }
                },
                arrayFilters: [{ "p.id": participant.id }] // Filter for the specific participant
            }
        };
    });

    // Perform the bulk update operation
    await client.db(MONGODB_DB).collection('chats').bulkWrite(updateParticipants);
    await client.db(MONGODB_DB).collection('chatMessages').insertOne({
      ...message,
    });
    if ('messageType' in data && data.messageType === 'Groups') {
      io.to(`group:${data.receiverId}`).emit('newMessage', message);
      // console.log('messageType & Groups')
    } else {
      if ('senderId' in data) {
        io.to(`user:${data.senderId}`).emit('newMessage', message);
        // console.log('senderId')
      }
      if ('receiverId' in data && data.receiverId) {
        io.to(`user:${data.receiverId}`).emit('newMessage', message);
        // console.log('receiverId')
      }
    }
  });

  socket.on('typing', (data: { userId: string, to: string }) => {
    io.to(`user:${data.to}`).emit('userTyping', data);
  });

  socket.on('stopTyping', (data: { userId: string, to: string }) => {
    io.to(`user:${data.to}`).emit('userStopTyping', data);
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

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.userId);

    if (rooms.get(roomId).size === 2) {
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
    socket.emit('userStatus', { userId, status: isOnline ? 'online' : 'offline' });
  });

  socket.on('getRoomMembers', (chatId: string) => {
    const room = io.sockets.adapter.rooms.get(chatId);
    const members = room ? Array.from(room) : [];
    socket.emit('roomMembers', { chatId, members });
  });

  socket.on('joinChat', (data: { chatId: string }) => {
    const { chatId } = data;
    socket.join(`group:${chatId}`);
    io.to(`group:${chatId}`).emit('groupAnnouncement', { chatId, userId: socket.userId });
  });
});

// Handle connection errors
io.engine.on("connection_error", (err) => {
  console.error('Connection error:', err);
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

// Start the server
server.listen(port, () => {
  console.log(`Listening on port ${port}...`);
}).on('error', (error) => {
  console.error('Server error:', error);
});