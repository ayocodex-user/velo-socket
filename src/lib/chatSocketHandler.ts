import { ObjectId } from "mongodb";
import { offlineMessageManager } from "../offline-messages.js";
import { io } from "../socket.js";
import { MessageAttributes, ChatParticipant, AttachmentSchema, msgStatus, MessageType } from "../types.js";
import { ChatMessage } from "./ChatMessage.js";
import * as S3 from "../s3.js";
import { MongoDBClient } from "../mongodb.js";

export const chatSocketHandler = async (data: MessageAttributes & { participants?: ChatParticipant[] }, db: MongoDBClient) => {
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
}