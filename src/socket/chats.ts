import { ObjectId } from "mongodb";
import * as S3 from "../s3.js";
import { AttachmentSchema, ChatParticipant, ConvoType1, MessageAttributes, MessageType, msgStatus, NewChat_, Reaction, UserSchema } from "../types.js";
import { MongoDBClient } from "../mongodb.js";
import { io, UserSocket } from '../socket.js';
import { offlineMessageManager } from '../offline-messages.js';
import { ChatMessage } from "../lib/ChatMessage.js";

io.on('connection', async (socket: UserSocket) => {
  try {
    // console.log('Connected to the socket ctrl');
    const userId = socket.handshake.query.userId as string;

    if (!userId) {
      console.error('No userId provided in socket connection');
      socket.disconnect();
      return;
    }

    let db;
    try {
      db = await new MongoDBClient().init();
    } catch (error) {
      console.error('Failed to initialize database connection:', error);
      io.to(`user:${userId}`).emit('chatError', { error: 'Database connection failed' });
      socket.disconnect();
      return;
    }

    socket.on('leaveChat', (chatId: string) => {
      socket.leave(chatId);
    });

    socket.on('addChat', async (data: NewChat_) => {
      // console.log(data.chat.participants)
      if (data.chat && data.chat.participants && data.chat.participants.length > 0) {
        const participantUserIds = Array.from(new Set(data.chat.participants.map(participant => participant.userId)));
        
        await offlineMessageManager.broadcastMessage({
          type: 'newChat',
          data
        }, userId, participantUserIds);
      } else {
        console.warn('addChat: No participants found in chat data');
      }
    });

    socket.on('addReaction', async (data: Reaction) => {
      try {
        const message = await db.chatMessages().findOne({ _id: new ObjectId(data.messageId) });
        if (!message) {
          io.to(`user:${data.userId}`).emit('chatError', { error: 'Message not found' });
          return;
        }
        console.log(message);
        // Check if user already reacted
        const existingReaction = await db.chatReactions().findOne({
          messageId: message._id.toString(),
          userId: data.userId
        });

        if (existingReaction) {
          // If same reaction, remove it
          const participants = (await db.chatParticipants().find({ chatId: message.chatId }).toArray()).map(p => p.userId);
          if (existingReaction.reaction === data.reaction) {
            await db.chatReactions().deleteOne({
              messageId: message._id.toString(),
              userId: data.userId
            });
            if (message.chatType === 'Group') {
              await offlineMessageManager.broadcastMessage({ type: 'reactionRemoved', data }, undefined, participants);
            } else {
              const targets = Array.from(new Set([message.sender.id, message.receiverId]));
              await offlineMessageManager.broadcastMessage({ type: 'reactionRemoved', data }, undefined, targets);
            }
          } else {
            // If different reaction, update it
            await db.chatReactions().updateOne(
              {
                messageId: message._id.toString(),
                userId: data.userId
              },
              { $set: { reaction: data.reaction } }
            );
            if (message.chatType === 'Group') {
              await offlineMessageManager.broadcastMessage({ type: 'reactionUpdated', data }, undefined, participants);
            } else {
              const targets = Array.from(new Set([message.sender.id, message.receiverId]));
              await offlineMessageManager.broadcastMessage({ type: 'reactionUpdated', data }, undefined, targets);
            }
          }
        } else {
          // No existing reaction, insert new one
          await db.chatReactions().insertOne({
            ...data,
            messageId: message._id.toString()
          });
          if (message.chatType === 'Group') {
            const participants = (await db.chatParticipants().find({ chatId: message.chatId }).toArray()).map(p => p.userId);
            await offlineMessageManager.broadcastMessage({ type: 'reactionAdded', data }, undefined, participants);
          } else {
            const targets = Array.from(new Set([message.sender.id, message.receiverId]));
            await offlineMessageManager.broadcastMessage({ type: 'reactionAdded', data }, undefined, targets);
          }
        }
      } catch (error) {
        console.error('Error in addReaction:', error);
        io.to(`user:${data.userId}`).emit('chatError', { error: 'Failed to process reaction' });
      }
    });

    socket.on('updateConversation', async (data: {id: string, updates: Partial<ConvoType1>}) => {
      try {
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
            
            // Delete attachments from S3 if they exist
            if (messages && messages.length > 0) {
              for (const message of messages) {
                if (message.attachments && message.attachments.length > 0) {
                  try {
                    await S3.deleteFileFromS3('files-for-chat', message.attachments);
                  } catch (error) {
                    console.error('Error deleting attachment from S3:', error);
                  }
                }
              }
            }
            
            const result2 = await db.chatParticipants().deleteMany({ chatId: chatId.toString() })
            // console.log(result2)
            const result3 = await db.readReceipts().deleteMany({ chatId: chatId.toString() })
            // console.log(result3)
            // console.log(`Deleted ${result.deletedCount + result1.deletedCount} message(s)`); // Log the result of the deletion
            return;
          } else {
            const messageId = new ObjectId(id);
            const message = await db.chatMessages().findOne({ _id: messageId });
            if (message && message.attachments && message.attachments.length > 0) {
              try {
                await S3.deleteFileFromS3('files-for-chat', message.attachments);
              } catch (error) {
                console.error('Error deleting attachment from S3:', error);
              }
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
      } catch (error) {
        console.error('Error in updateConversation:', error);
        socket.emit('chatError', { error: 'Failed to update conversation' });
      }
    });

    socket.on('chatMessage', async (data: MessageAttributes & { participants?: ChatParticipant[] }) => {
      const senderId = data.sender?.id;
      try {
        // console.log('Message')
        // console.log(data)
        console.log(`Processing chat message from ${senderId} to ${data.receiverId} in chat ${data.chatId}`);

        // Validate required data
        if (!data.chatId || !senderId || !data.receiverId) {
          console.error('chatMessage: Missing required fields', { chatId: data.chatId, senderId: senderId, receiverId: data.receiverId });
          io.to(`user:${senderId}`).emit('chatError', { error: 'Missing required fields' });
          return;
        }

        // Handle multiple file uploads (if attachments exist)
        let attachmentsWithUrls: AttachmentSchema[] = [];
        if (data.attachments && data.attachments.length > 0) {
          // Upload each file to S3 and store the URLs
          for (const file of data.attachments) {
            try {
              const fileBuffer = Buffer.from(file.data || ''); // Assuming file.data is the file content as a Buffer
              const fileUrl = await S3.uploadFileToS3('files-for-chat',fileBuffer, file.key, file.type);
              attachmentsWithUrls.push({
                _id: new ObjectId(),
                name: file.name,
                key: file.key,
                type: file.type,
                url: fileUrl, // Add the S3 URL to the attachment
                size: Buffer.byteLength(fileBuffer),
                uploadedAt: new Date().toISOString()
              });
            } catch (error) {
              console.error('Error uploading file to S3:', error);
              attachmentsWithUrls.push({
                _id: new ObjectId(),
                name: file.name,
                key: file.key,
                type: file.type,
                url: "", // Mark the file as failed to upload
                size: file.size || 0,
                uploadedAt: new Date().toISOString()
              });
            }
          }
        }

        // Messages Collection

        const message = new ChatMessage({
          _id: data._id,
          chatId: data.chatId, // Reference to the chat in DM collection
          sender: data.sender,
          receiverId: data.receiverId,
          content: data.content,
          timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
          chatType: data.chatType,
          reactions: data.reactions || [],
          attachments: attachmentsWithUrls || [],
          quotedMessageId: data.quotedMessageId,
          status: 'sent' as msgStatus,
          messageType: data.messageType as MessageType
        });
        
        // Assuming `message` is defined and contains the necessary properties
        const chatsParticipants = data.participants || await db.chatParticipants().find({ chatId: message.chatId }).toArray();
        
        // Validate participants data structure
        if (chatsParticipants && chatsParticipants.length > 0) {
          // Filter out invalid participants
          const validParticipants = chatsParticipants.filter(participant => 
            participant && 
            participant.userId && 
            typeof participant.userId === 'string' && 
            participant.userId.trim() !== ''
          );
          
          if (validParticipants.length === 0) {
            console.warn('No valid participants found for chat message');
            chatsParticipants.length = 0; // Reset to empty array
          } else if (validParticipants.length !== chatsParticipants.length) {
            console.warn(`Filtered out ${chatsParticipants.length - validParticipants.length} invalid participants`);
            chatsParticipants.splice(0, chatsParticipants.length, ...validParticipants);
          }
        }
        
        // Only proceed if we have valid participants
        if (chatsParticipants && chatsParticipants.length > 0) {
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

          // Only perform bulk write if we have valid updates
          if (participantUpdates.length > 0) {
            // Validate the operations array structure
            const validOperations = participantUpdates.filter(op => 
              op && 
              op.updateOne && 
              op.updateOne.filter && 
              op.updateOne.update &&
              op.updateOne.filter.chatId && 
              op.updateOne.filter.userId &&
              op.updateOne.update.$set && 
              op.updateOne.update.$inc
            );
            
            if (validOperations.length === 0) {
              console.error('No valid operations found for bulkWrite');
              // Fallback to individual updates
              for (const participant of chatsParticipants) {
                try {
                  await db.chatParticipants().updateOne(
                    { chatId: message.chatId.toString(), userId: participant.userId },
                    {
                      $set: {
                        lastMessageId: message?._id?.toString() || '',
                        lastUpdated: new Date().toISOString()
                      },
                      $inc: {
                        unreadCount: 1
                      }
                    }
                  );
                } catch (updateError) {
                  console.error(`Error updating participant ${participant.userId}:`, updateError);
                }
              }
            } else {
              try {
                await db.chatParticipants().bulkWrite(validOperations);
              } catch (error) {
                console.error('Error in bulkWrite operation:', error);
                // Fallback to individual updates if bulkWrite fails
                for (const participant of chatsParticipants) {
                  try {
                    await db.chatParticipants().updateOne(
                      { chatId: message.chatId.toString(), userId: participant.userId },
                      {
                        $set: {
                          lastMessageId: message?._id?.toString() || '',
                          lastUpdated: new Date().toISOString()
                        },
                        $inc: {
                          unreadCount: 1
                        }
                      }
                    );
                  } catch (updateError) {
                    console.error(`Error updating participant ${participant.userId}:`, updateError);
                  }
                }
              }
            }
          }
        }

        // Update chat with last message info
        try {
          let chatObjectId: ObjectId;
          try {
            chatObjectId = new ObjectId(message.chatId);
          } catch (error) {
            console.error('Invalid chat ID format:', message.chatId);
            return;
          }
          
          await db.chats().updateOne(
            { _id: chatObjectId }, 
            { 
              $set: { 
                lastMessageId: message?._id?.toString() || '', 
                lastUpdated: new Date().toISOString() 
              } 
            }
          );
        } catch (error) {
          console.error('Error updating chat:', error);
        }

        try {
          await db.chatMessages().insertOne(message);
        } catch (error) {
          console.error('Error inserting chat message:', error);
          io.to(`user:${senderId}`).emit('chatError', { error: 'Failed to save message' });
          return;
        }

        // Files Collection
        try {
          if (attachmentsWithUrls.length > 0) {
            await db.files().insertMany(attachmentsWithUrls);
          }
        } catch (error) {
          console.error('Error inserting files:', error);
          io.to(`user:${senderId}`).emit('chatError', { error: 'Failed to save files' });
          return;
        }

        // Read receipts
        if (chatsParticipants && chatsParticipants.length > 0) {
          message.isRead = chatsParticipants.reduce((acc, participant) => {
            acc[participant.userId] = false;
            return acc;
          }, {} as { [key: string]: boolean });
          message.isRead[senderId] = true;

          // Only insert read receipts if we have participants
          try {
            await db.readReceipts().insertMany(
              chatsParticipants.map((participant) => ({
                _id: new ObjectId(),
                messageId: message?._id?.toString() || '',
                userId: participant.userId,
                chatId: message.chatId.toString(),
                readAt: new Date().toISOString()
              }))
            );
          } catch (error) {
            console.error('Error inserting read receipts:', error);
            // Continue processing even if read receipts fail
          }
        } else {
          // Initialize isRead with just the sender if no participants
          message.isRead = { [senderId]: true };
        }

        if (data.chatType === 'Group') {
          try {
            // Live emit to group members in room and Queue for offline group members: fetch participants
            const participants = await db.chatParticipants().find({ chatId: data.chatId }).toArray();
            const userIds = participants.map(p => p.userId).filter(Boolean);
            await offlineMessageManager.broadcastMessage({
              type: 'newMessage',
              data: message.toMessageAttributes(attachmentsWithUrls)
            }, undefined, userIds);
          } catch (error) {
            console.error('Error queuing group message for offline users:', error);
          }
        } else {
          try {
            // Live emit to sender and receiver
            // Queue for offline sender/receiver
            const targets = Array.from(new Set([senderId, data.receiverId]));
            await offlineMessageManager.broadcastMessage({
              type: 'newMessage',
              data: message.toMessageAttributes(attachmentsWithUrls)
            }, undefined, targets);
          } catch (error) {
            console.error('Error queuing direct message for offline users:', error);
          }
        }
      } catch (error) {
        console.error('Error in chatMessage handler:', error);
        io.to(`user:${senderId}`).emit('chatError', { error: 'Failed to process chat message' });
      }
    });

    socket.on('typing', (data: { user: Partial<UserSchema>, to: string }) => {
      try {
        io.to(data.to).emit('userTyping', data);
      } catch (error) {
        console.error('Error in typing event:', error);
      }
    });

    socket.on('stopTyping', (data: { user: Partial<UserSchema>, to: string }) => {
      try {
        io.to(data.to).emit('userStopTyping', data);
      } catch (error) {
        console.error('Error in stopTyping event:', error);
      }
    });

    socket.on('joinChat', (data: { chatId: string }) => {
      try {
        const { chatId } = data;
        if (chatId) {
          socket.join(`group:${chatId}`);
          io.to(`group:${chatId}`).emit('groupAnnouncement', { chatId, userId: userId });
        }
      } catch (error) {
        console.error('Error in joinChat event:', error);
      }
    });
  } catch (error) {
    console.error('Unexpected error in socket connection handler:', error);
    socket.emit('chatError', { error: 'An unexpected error occurred' });
    socket.disconnect();
  }
});