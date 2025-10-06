// app/api/chat/route.ts
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { GoogleGenAI } from "@google/genai";
import { MessageAttributes } from '../types.js';
import { offlineMessageManager } from '../offline-messages.js';
import { ChatMessage } from '../lib/ChatMessage.js';

const router = Router();

// Access your API key from environment variables
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const chatHandler: RequestHandler = async (req, res) => {
  try {
    const messages = req.body.messages as MessageAttributes[];

    const chat = genAI.chats.create({
        model: "gemini-2.5-pro",
        history: messages.slice(0, -1).map(msg => ({
            role: msg.sender.id === 'user' ? 'user' : 'model',
            parts: [
                { 
                    text: msg.content, 
                    fileData: { 
                        displayName: msg.attachments[0].name, 
                        fileUri: msg.attachments[0].url, 
                        mimeType: msg.attachments[0].type 
                    } 
                }
            ],
        })),
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
    const result = await chat.sendMessage({
        message: { 
            text: lastUserMessage.content, 
            fileData: { 
                displayName: lastUserMessage.attachments[0].name, 
                fileUri: lastUserMessage.attachments[0].url, 
                mimeType: lastUserMessage.attachments[0].type 
            } 
        }
    });

    const botResponse = await ChatMessage.fromGeminiResponse(
      result, 
      lastUserMessage.chatId, 
      lastUserMessage.sender.id, 
      lastUserMessage.receiverId, 
      lastUserMessage.messageType, 
      lastUserMessage.chatType
    );
    
    if (!botResponse) {
      console.error("Failed to create bot response.");
      res.status(500).json({ error: "Failed to create bot response." });
      return;
    }

    await offlineMessageManager.broadcastMessage({
        type: 'newMessage',
        data: botResponse.toMessageAttributes()
    }, undefined, [lastUserMessage.sender.id]);
    res.json({ result: botResponse.toMessageAttributes(), reply: botResponse.content });
    return;
  } catch (error) {
    console.error("Error communicating with Gemini API:", error);
    res.status(500).json(
      { error: "Failed to get a response from the chatbot." },
    );
    return;
  }
}

router.post('/', chatHandler);

export default router;