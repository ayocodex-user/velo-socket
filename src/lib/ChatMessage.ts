import { ObjectId } from "mongodb";

import { MongoDBClient } from "../mongodb";
import { Attachment, ChatType, MessageAttributes, MessageSchema, MessageType, msgStatus, Reaction } from "../types";

/**
 * Represents a simplified chat message object in the application's database.
 */
export class ChatMessage implements MessageSchema {
    public _id: ObjectId;
    public chatId: string;
    public receiverId: string;
    public content: string; // This is the field we want to populate
    public timestamp: string;
    public messageType: MessageType;
    public isRead: Record<string, boolean>;
    public chatType: ChatType;
    public sender: { id: string; name: string; displayPicture: string; username: string; verified: boolean; };
    public reactions: Reaction[];
    public attachments: string[];
    public quotedMessageId: string;
    public status: msgStatus;
  
    // constructor to force use of factory methods
    constructor(data: MessageAttributes) {
      // Generate a placeholder MongoDB ID
      this._id = new ObjectId(data._id || "");
      this.chatId = data.chatId;
      this.receiverId = data.receiverId;
      this.content = data.content;
      this.timestamp = data.timestamp || new Date().toISOString(); // Current time
      this.messageType = data.messageType;
      this.isRead = data.isRead || {};
      this.sender = data.sender;
      this.reactions = data.reactions;
      this.attachments = data.attachments.map(attachment => attachment.key);
      this.quotedMessageId = data.quotedMessageId;
      this.status = data.status;
      this.chatType = data.chatType;
    }

    public toMessageAttributes(attachments: Attachment[] = []): MessageAttributes {
        return {
            _id: this._id.toString(),
            chatId: this.chatId,
            receiverId: this.receiverId,
            content: this.content,
            timestamp: this.timestamp,
            messageType: this.messageType,
            isRead: this.isRead,
            sender: this.sender,
            reactions: this.reactions,
            attachments,
            quotedMessageId: this.quotedMessageId,
            status: this.status,
            chatType: this.chatType,
        };
    }
  
    /**
     * Factory method to create a ChatMessage instance from a raw Gemini API response.
     * This method only takes the Gemini response and the essential IDs for the chat context.
     * @access For Backend Only
     * @param apiResponse The full JSON response from the Gemini API.
     * @param chatId The ID of the conversation thread.
     * @param humanUserId The ID of the human user (the original sender, now the receiver).
     * @param botUserId The ID of the bot/system account (the new sender).
     * @param messageType The type of message (e.g., 'DM').
     * @param chatType The type of chat (e.g., 'DM').
     * @returns A ChatMessage instance.
     */
    public static async fromGeminiResponse(
        apiResponse: any,
        chatId: string,
        humanUserId: string,
        botUserId: string,
        messageType: MessageType,
        chatType: ChatType
    ): Promise<ChatMessage | null> {
        
        // 1. Extract the content string from the response
        const firstCandidate = apiResponse.candidates?.[0];
        const responseText = firstCandidate?.content.parts[0].text;
        
        if (!responseText) {
            console.error("Gemini response is empty or invalid.");
            return null;
        }

        const db = await new MongoDBClient().init();
        const users = db.users();
        const botUser = await users.findOne({ _id: new ObjectId(botUserId) });
        
        if (!botUser) {
            console.error("Bot user not found.");
            return null;
        }

        // 2. Prepare data for the new ChatMessage object
        const botResponseData = {
            _id: "",
            chatId,
            // The human user is the receiver of the bot's message
            receiverId: humanUserId, 
            content: responseText,
            messageType,
            isRead: {
                [humanUserId]: false, // Human user hasn't read it
                [botUserId]: true,    // Bot considers its own message handled/read
            },
            sender: { 
                id: botUser.userId, 
                name: botUser.name, 
                displayPicture: botUser.displayPicture || "", 
                username: botUser.username, 
                verified: botUser.verified || false 
            },
            reactions: [],
            attachments: [],
            quotedMessageId: "",
            status: "sent" as msgStatus,
            chatType,
            timestamp: new Date().toISOString(),
        };

        // 3. Create and return the final application message object
        return new ChatMessage(botResponseData);
    }
}