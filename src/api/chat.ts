import { Router } from 'express';
import type { RequestHandler } from 'express';
import { GoogleGenAI } from "@google/genai";
import { MessageAttributes, UserSchema } from '../types.js';
import { offlineMessageManager } from '../offline-messages.js';
import { ChatMessage } from '../lib/ChatMessage.js';
import { chatSocketHandler } from '../lib/chatSocketHandler.js';
import { MongoDBClient } from '../mongodb.js';
import { io } from '../socket.js';
import { ObjectId } from 'mongodb';
import { SocialMediaUser } from '../lib/User.js';

const router = Router();

// Access your API key from environment variables
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const chatHandler: RequestHandler = async (req, res) => {
  let bot: SocialMediaUser | null = null;
  try {
    if (!req.body.messages[req.body.messages.length - 1].receiverId) {
      console.error("Receiver ID is missing in the last message.");
      res.status(400).json({ error: "Receiver ID is missing in the last message." });
      return;
    }

    const db = await new MongoDBClient().init();

    bot = new SocialMediaUser(
      await db.users().findOne({ _id: new ObjectId(req.body.messages[req.body.messages.length - 1].receiverId) }) as UserSchema
    );

    if (bot.isUserNull()) {
      console.error("Bot user not found.");
      res.status(400).json({ error: "Bot user not found." });
      return;
    }

    io.to(bot._id.toString()).emit('userTyping', { data: bot?.getClientSafeData(), to: bot?._id.toString() });
    const messages = req.body.messages as MessageAttributes[];

    const chat = genAI.chats.create({
        model: process.env.Gemini_Model || '',
        history: messages.slice(0, -1).map(msg => {
            const hasAttachment = Array.isArray(msg.attachments) && msg.attachments.length > 0;
            const parts = [
                { text: msg.content },
                ...(hasAttachment
                    ? [{
                        fileData: {
                            displayName: msg.attachments[0].name,
                            fileUri: msg.attachments[0].url,
                            mimeType: msg.attachments[0].type
                        }
                    }]
                    : [])
            ];

            return {
                role: msg.sender.id === 'user' ? 'user' : 'model',
                parts,
            };
        }),
        config: {
          maxOutputTokens: 5000,
          stopSequences: [
            "porn",
            "Pornography",
            "NSFW",
            "OnlyFans",
            "explicit"
          ],
        },
    });

    const lastUserMessage = messages[messages.length - 1];
    const lastHasAttachment = Array.isArray(lastUserMessage.attachments) && lastUserMessage.attachments.length > 0;
    const messagePayload: any = lastHasAttachment
      ? {
          text: lastUserMessage.content,
          fileData: {
            displayName: lastUserMessage.attachments[0].name,
            fileUri: lastUserMessage.attachments[0].url,
            mimeType: lastUserMessage.attachments[0].type,
          },
        }
      : {
          text: lastUserMessage.content,
        };

    const result = await chat.sendMessage({
        message: messagePayload
    });

    const botResponse = await ChatMessage.fromGeminiResponse(
      result, 
      lastUserMessage.chatId, 
      lastUserMessage.sender.id, 
      lastUserMessage.receiverId, 
      "Markdown", 
      lastUserMessage.chatType
    );
    
    if (!botResponse) {
      console.error("Failed to create bot response.");
      res.status(500).json({ error: "Failed to create bot response." });
      return;
    }

    io.to(lastUserMessage.receiverId).emit('userStopTyping', { data: bot?.getClientSafeData(), to: bot?._id.toString() });

    await chatSocketHandler(lastUserMessage, db);
    await chatSocketHandler(botResponse.toMessageAttributes(), db);
    res.json({ result: botResponse.toMessageAttributes(), reply: botResponse.content });
    return;
  } catch (error) {
    console.error("Error communicating with Gemini API:", error);
    io.to(req.body.messages[req.body.messages.length - 1].receiverId).emit('userStopTyping', { data: bot?.getClientSafeData(), to: bot?._id.toString() || "" });
    res.status(500).json(
      { error: "Failed to get a response from the chatbot." },
    );
    return;
  }
}

router.post('/', chatHandler);

export default router;