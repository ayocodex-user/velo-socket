import { ObjectId } from "mongodb";
import { deleteFileFromS3, uploadFileToS3 } from "../s3.js";
import { ConvoType1, GroupMessageAttributes, MessageAttributes, msgStatus, NewChat_, Participant } from "../types.js";
import { getMongoDb } from "../mongodb.js";
import { io, UserSocket } from '../socket.js';

io.on('connection', async (socket: UserSocket) => {
  // console.log('Connected to the socket ctrl');
  const userId = socket.handshake.query.userId as string;

  const db = await getMongoDb()

  socket.on('leaveChat', (chatId: string) => {
    socket.leave(chatId);
  });

  socket.on('addChat', async (data: NewChat_) => {
    // console.log(data.chat.participants)
    const uniqueParticipants = Array.from(new Set(data.chat.participants.map(participant => `user:${participant.id}`)));
    // console.log(uniqueParticipants)
    io.to(uniqueParticipants).emit('newChat', data);
  });

  socket.on('updateConversation', async (data: {id: string, updates: Partial<ConvoType1>}) => {
    const { id, updates } = data;
    // console.log(data,userId)
    const chatId = new ObjectId(id);

    if (data.updates.deleted){
      (db.collection('chatMessages').
      findOne({ $or: [{ _id: chatId }, { Oid: chatId }] }) as unknown as MessageAttributes)
      .attachments.map(a => a.name).map(async (name) => {
        await deleteFileFromS3('files-for-chat', name);
      });
      if (data.updates.convo){
         db.collection('chats').deleteOne({ _id: chatId })
         db.collection('chatMessages').deleteMany({ chatId: chatId })
        // console.log(`Deleted ${result.deletedCount + result1.deletedCount} message(s)`); // Log the result of the deletion
        return;
      }
      db.collection('chatMessages').deleteOne({ $or: [{ _id: chatId }, { Oid: chatId}] })
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

    const result = db.collection('chats').updateOne({ _id: chatId }, update, options);
    // console.log(`Changed prop is ${result}`)
    io.to(`user:${updates.userId}`).emit('conversationUpdated', { id: chatId.toString(), updates });
  });

  socket.on('chatMessage', async (data: MessageAttributes | GroupMessageAttributes) => {
    // console.log('Message')
    // console.log(data)
    const chats = await db.collection('chats').findOne({ _id: new ObjectId(data.chatId as string) });
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
    db.collection('chats').bulkWrite(updateParticipants);
    db.collection('chatMessages').insertOne({
      ...message,
    });
    if (data.messageType === 'Groups') {
      io.to(`group:${data.receiverId}`).emit('newMessage', message);
      // console.log('messageType & Groups')
    } else {
      if ('senderId' in data) {
        io.to(`user:${data.senderId}`).emit('newMessage', message);
        io.to(`user:${data.receiverId}`).emit('newMessage', message);
      }
    }
  });

  socket.on('typing', (data: { userId: string, to: string }) => {
    io.to(data.to).emit('userTyping', data);
  });

  socket.on('stopTyping', (data: { userId: string, to: string }) => {
    io.to(data.to).emit('userStopTyping', data);
  });

  socket.on('joinChat', (data: { chatId: string }) => {
    const { chatId } = data;
    socket.join(`group:${chatId}`);
    io.to(`group:${chatId}`).emit('groupAnnouncement', { chatId, userId: userId });
  });
});