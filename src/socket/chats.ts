import { ObjectId, WithId } from "mongodb";
import { deleteFileFromS3, uploadFileToS3 } from "../s3.js";
import { ChatParticipant, ChatSettings, ConvoType1, GroupMessageAttributes, MessageAttributes, msgStatus, NewChat_, Participant, Reaction } from "../types.js";
import { MongoDBClient } from "../mongodb.js";
import { io, UserSocket } from '../socket.js';

io.on('connection', async (socket: UserSocket) => {
  // console.log('Connected to the socket ctrl');
  const userId = socket.handshake.query.userId as string;

  const db = await new MongoDBClient().init()

  socket.on('leaveChat', (chatId: string) => {
    socket.leave(chatId);
  });

  socket.on('addChat', async (data: NewChat_) => {
    // console.log(data.chat.participants)
    const uniqueParticipants = Array.from(new Set(data.chat.participants.map(participant => `user:${participant.userId}`)));
    console.log(uniqueParticipants)
    io.to(uniqueParticipants).emit('newChat', data);
  });

  socket.on('addReaction', async (data: Reaction) => {
    // Check if user already reacted
    const existingReaction = await db.chatReactions().findOne({
      messageId: data.messageId,
      userId: data.userId
    });

    if (existingReaction) {
      // If same reaction, remove it
      if (existingReaction.reaction === data.reaction) {
        await db.chatReactions().deleteOne({
          messageId: data.messageId,
          userId: data.userId
        });
        io.to(`user:${data.userId}`).emit('reactionRemoved', data);
      } else {
        // If different reaction, update it
        await db.chatReactions().updateOne(
          {
            messageId: data.messageId,
            userId: data.userId
          },
          { $set: { reaction: data.reaction } }
        );
        io.to(`user:${data.userId}`).emit('reactionUpdated', data);
      }
    } else {
      // No existing reaction, insert new one
      await db.chatReactions().insertOne(data);
      io.to(`user:${data.userId}`).emit('reactionAdded', data);
    }
  });

  socket.on('updateConversation', async (data: {id: string, updates: Partial<ConvoType1>}) => {
    const { id, updates } = data;
    // console.log(data)

    // Delete message
    if (data.updates.deleted) {
      // Delete chat
      if (data.updates.convo) {
        const chatId = new ObjectId(id);
        const chat = await db.chats().findOne({ _id: chatId });
        
        if (!chat) {
          // console.log('Chat not found:', id);
          // Emit an error event to the client
          io.to(`user:${userId}`).emit('chatError', { 
            error: 'Chat not found',
            chatId: id,
            updates: updates
          });
          return;
        }

        // Proceed with deletion only if chat exists
        const result = await db.chats().deleteOne({ _id: chatId });
        const result1 = await db.chatMessages().deleteMany({ chatId: chatId.toString() });
        const messages = await db.chatMessages().find({ chatId: chatId.toString() }).toArray();
        // console.log(result,result1,messages)
        messages.map(message => {
          message.attachments.map(a => a.name).map(async (name) => {
            await deleteFileFromS3('files-for-chat', name);
          })
        });
        const result2 = await db.chatParticipants().deleteMany({ chatId: chatId.toString() })
        // console.log(result2)
        const result3 = await db.readReceipts().deleteMany({ chatId: chatId.toString() })
        // console.log(result3)
        // console.log(`Deleted ${result.deletedCount + result1.deletedCount} message(s)`); // Log the result of the deletion
        return;
      } else {
        const messageId = new ObjectId(id);
        const message = await db.chatMessages().findOne({ _id: messageId });
        if (message) {
          message.attachments.map(a => a.name).map(async (name) => {
            await deleteFileFromS3('files-for-chat', name);
          });
        }
        await db.chatMessages().deleteOne({ _id: messageId })
        await db.readReceipts().deleteMany({ messageId: messageId.toString() })
        // console.log(`Deleted ${result.deletedCount} message(s)`); // Log the result of the deletion
        return;
      }
    }

    const updateFields = Object.keys(updates).map((key) => {
      return key;
    });
    const update = {
      $set: updateFields.reduce((acc, field, index) => {
        acc[field] = updates[Object.keys(updates)[index] as keyof typeof updates];
        return acc;
      }, {} as Record<string, any>),
    };

    const result = await db.chatParticipants().updateOne(
      { chatId: id, userId: updates.userId },
      update
    );
    // console.log(`Changed prop is ${result}`)
    io.to(`user:${updates.userId}`).emit('conversationUpdated', { id: id, updates });
  });

  socket.on('chatMessage', async (data: MessageAttributes & { participants?: ChatParticipant[] }) => {
    // console.log('Message')
    // console.log(data)

      // Handle multiple file uploads (if attachments exist)
      let attachmentsWithUrls = [];
      if (data.attachments && data.attachments.length > 0) {
        // Upload each file to S3 and store the URLs
        for (const file of data.attachments) {
          try {
            const fileBuffer = Buffer.from(file.data || ''); // Assuming file.data is the file content as a Buffer
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
              url: undefined, // Mark the file as failed to upload
            });
          }
        }
      }

    // Messages Collection
    const message: MessageAttributes = {
      _id: new ObjectId(data._id as unknown as string),
      chatId: data.chatId, // Reference to the chat in DMs collection
      senderId: data.senderId,
      receiverId: data.receiverId,
      content: data.content,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
      messageType: data.messageType,
      reactions: data.reactions || [],
      attachments: attachmentsWithUrls || [],
      quotedMessageId: data.quotedMessageId,
      status: 'sent' as msgStatus,
    };
    
    // Assuming `message` is defined and contains the necessary properties
    const chatsParticipants = data.participants || await db.chatParticipants().find({ chatId: message.chatId }).toArray();
    const participantUpdates = chatsParticipants.map((participant) => ({
      updateOne: {
        filter: { chatId: message.chatId.toString(), userId: participant.userId },
        update: {
          $set: {
            lastMessageId: message?._id?.toString() || '',
            lastUpdated: new Date().toISOString()
          },
          $inc: {
            unreadCount: 1
          }
        }
      }
    }));

    // Only perform bulk write if we have updates
    if (participantUpdates.length > 0) {
      await db.chatParticipants().bulkWrite(participantUpdates);
    }

    await db.chats().updateOne({ _id: new ObjectId(message.chatId) }, { $set: { lastMessageId: message?._id?.toString() || '', lastUpdated: new Date().toISOString() } });

    await db.chatMessages().insertOne({
      ...message,
    });

    // Read receipts
    message.isRead = chatsParticipants.reduce((acc, participant) => {
      acc[participant.userId] = false;
      return acc;
    }, {} as { [key: string]: boolean });
    message.isRead[message.senderId] = true;

    // Only insert read receipts if we have participants
    if (chatsParticipants.length > 0) {
      await db.readReceipts().insertMany(
        chatsParticipants.map((participant) => ({
          _id: new ObjectId(),
          messageId: message?._id?.toString() || '',
          userId: participant.userId,
          chatId: message.chatId.toString(),
          readAt: new Date().toISOString()
        }))
      );
    }

    if (data.messageType === 'Groups') {
      io.to(`group:${data.receiverId}`).emit('newMessage', message);
      // console.log('messageType & Groups')
    } else {
      io.to(`user:${data.senderId}`).emit('newMessage', message);
      io.to(`user:${data.receiverId}`).emit('newMessage', message);
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