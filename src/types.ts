import { ObjectId } from "mongodb";

export type User = {
  name: string;
  id: number;
}

export type ReadReceipt = {
  _id: ObjectId;
  messageId: string;
  userId: string;
  chatId: string;
  readAt: string;
}

export type Reaction ={
  _id: ObjectId,
  messageId: string,
  userId: string,
  reaction: string,
  timestamp: string
}

export type ChatType = 'Personal' | 'DM' | 'Group' | 'Channels';

export type MessageType =
  | "Text"
  | "Image"
  | "Video"
  | "Audio"
  | "File"
  | "Location"
  | "Contact"
  | "Sticker"
  | "Poll"
  | "PollResponse"
  | "PollEnd"
  | "PollResult"
  | "PollResult"
  | "AnimatedGIF"
  | "Announcement"
  | "Link";

export type UserSchema = {
  _id?: ObjectId | string | undefined,
  bio?: string,
  confirmationToken?: string,
  coverPhoto?: string,
  dob?: string,
  displayPicture?: string,
  email?: string,
  firstname: string,
  followers?: number,
  following?: number,
  isEmailConfirmed?: boolean,
  isFollowing?: boolean,
  isPrivate?: boolean,
  lastLogin?: string,
  lastname?: string,
  lastResetAttempt?: {
    [x: string]: string
  },
  lastSeen?: string,
  lastUpdate?: string[],
  location?: string,
  loginToken?: string,
  name: string,
  noOfUpdates?: number,
  password: string,
  password_reset_time?: string,
  providers: {
    [x: string]: {
      id: string | undefined;
      lastUsed: string;
    };
  },
  resetAttempts?: number,
  resetToken?: string,
  resetTokenExpiry?: number,
  signUpCount?: number,
  theme?: string,
  time: string,
  userId: string,
  username: string,
  verified?: boolean,
  website?: string
};

export type UserSettings = {
  twoFactorAuth: boolean;
  loginAlerts: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  showReadReceipts: boolean;
  showTypingStatus: boolean;
}

export type FollowersSchema = {
  followerId: string,
  followedId: string,
  time: string,
  follow?: true,
}

export type TokensSchema = {
  _id: ObjectId,
  userId: string,
  token: string,
  deviceInfo: object,
  createdAt: string,
  expiresAt: string,
}

export type VideoSchema = {
  _id: ObjectId,
  userId: string,
  video: string,
}

export type PostSchema = {
  _id: string;
  UserId: string;
  DisplayPicture: string;
  NameOfPoster: string;
  Verified: boolean;
  TimeOfPost: string;
  Visibility: 'everyone' | 'friends' | 'none';
  Caption: string;
  Image: string[];
  IsFollowing: boolean;
  NoOfLikes: number;
  Liked: boolean;
  NoOfComment: number;
  NoOfShares: number;
  NoOfBookmarks: number;
  Bookmarked: boolean;
  Username: string;
  PostID: string;
  Code: string;
  WhoCanComment: 'everyone' | 'friends' | 'none';
  Shared: boolean;
  Type: "post" | "comment" | "repost" | "quote";
  ParentId: string;
  OriginalPostId?: string;
}

export type ChatParticipant = {
  _id: ObjectId;
  chatId: string;
  lastMessageId: string;
  unreadCount: number;
  favorite: boolean;
  pinned: boolean;
  deleted: boolean;
  archived: boolean;
  chatSettings: ChatSettings;
  displayPicture: string;
  userId: string;
  chatType: ChatType;
}

export type ChatSettings = {
  // General settings
  isMuted: boolean;
  isPinned: boolean;
  isArchived: boolean;
  notificationSound?: string; // Path to a sound file
  notificationVolume?: number; // Volume level (0-100)
  wallpaper?: string; // Path to an image file
  theme: 'light' | 'dark';

  // Specific to group chats
  isPrivate?: boolean;
  inviteLink?: string;
  members?: string[]; // List of user IDs
  adminIds?: string[]; // List of admin user IDs

  // Specific to direct messages
  isBlocked: boolean;
  lastSeen: string; // Timestamp of the last time the user was online
}

export type ChatAttributes = {
  _id?: ObjectId; // Or string depending on your chat ID format
  name: string;
  lastMessage: string;
  timestamp: string; // Consider using a specific date/time type library
  unread: boolean;
  chatId?: string; // Optional chat ID
  chatType: ChatType;
  participants?: User[]; // Separate type for participants
  chatSettings?: ChatSettings; // Separate type for settings
  messageId?: string;
  senderId?: number; // Or string depending on your user ID format
  messageContent?: string;
  messageType: MessageType;
  isRead?: boolean;
  reactions?: any[]; // Consider a specific type if needed
  attachments?: any[]; // Consider a specific type if needed
  favorite?: boolean;
  pinned: boolean;
  deleted: boolean;
  archived: boolean;
  lastUpdated: string; // Consider using a specific date/time type library
}

export type NewChatResponse = {
  _id?: string | ObjectId | undefined; // Assuming ObjectId is converted to string
  name: string;
  lastMessageId: string;
  timestamp: string;
  unreadCounts: { [participantId: string]: number };
  chatType: ChatType;
  participants: string[];
  chatSettings: ChatSettings
  lastUpdated: Date | string | undefined;
  displayPicture?: string,
}

export type NewChat = {
  _id?: string | ObjectId | undefined; // Assuming ObjectId is converted to string
  id?: string;
  name: { [id: string]: string };
  chatType: ChatType;
  groupDescription: string;
  groupDisplayPicture: string;
  participants: string[]; // Assuming participants are represented by their IDs
  participantsImg?: { [participantId: string]: string };
  lastMessageId: string; // Assuming ObjectId is converted to string
  unreadCounts: { [participantId: string]: number };
  favorite: boolean;
  pinned: boolean;
  deleted: boolean;
  archived: boolean;
  lastUpdated?: Date | undefined;
  timestamp?: Date | undefined;
}

export type NewChatSettings = {
  _id: ObjectId; // Assuming ObjectId is converted to string
  chatId: ObjectId; // Reference to the chat in Chats collection

  // General settings
  isMuted: boolean;
  isPinned: boolean;
  isArchived: boolean;
  notificationSound: string; // Path to a sound file
  notificationVolume: number; // Volume level (0-100)
  wallpaper: string; // Path to an image file
  theme: 'light' | 'dark';

  // Specific to group chats
  members: string[]; // List of user IDs

  // Specific to direct messages
  isBlocked: boolean;
  lastSeen: string; // ISO timestamp of the last time the user was online
}

export type msgStatus = 'sending' | 'sent' | 'delivered' | 'failed';

export type Attachment = {
  key: string;
  name: string; // File name (e.g., "image.png")
  type: string; // MIME type (e.g., "image/png")
  data?: number[]; // File content as an array of bytes (Uint8Array converted to number[])
  url?: string;
  size?: number;
  lastModified?: string;
};

export type AttachmentSchema = {
  _id: ObjectId;
  url: string;
  key: string;
  name: string; // File name (e.g., "image.png")
  type: string; // MIME type (e.g., "image/png")
  size: number;
  uploadedAt: string;
};

export interface Message {
  _id?: ObjectId | string;
  chatId: string;
  sender: {
    id: string;
    name: string;
    displayPicture: string;
    username: string;
    verified: boolean;
  };
  receiverId: string;
  content: string;
  timestamp: string;
  isRead?: { [participantId: string]: boolean }; // Object with participant IDs as keys and their read status as values
  chatType: ChatType;
  messageType: MessageType;
  reactions: Reaction[];
  quotedMessageId: string;
  status: msgStatus;
}

export interface MessageAttributes extends Message {
  _id: string;
  attachments: Attachment[];
}

export interface MessageSchema extends Message {
  _id: ObjectId;
  attachments: string[];
}

export interface MessageAttributesClient extends MessageAttributes {
  isRead: { [participantId: string]: boolean }; // Object with participant IDs as keys and their read status as values
}

export interface Err {
  [x: string]: string
}

export type Schema = {
  _id?: ObjectId,
  time?: string,
  userId?: string,
  firstname?: string,
  lastname?: string,
  email?: string,
  username?: string,
  password?: string,
  displayPicture?: string,
  isEmailConfirmed?: true,
  confirmationToken?: null,
  signUpCount?: 1,
  lastLogin?: string,
  loginToken?: string,
  lastResetAttempt?: {
    [x: string]: string
  },
  resetAttempts?: 6,
  password_reset_time?: string,
  theme?: string,
  verified?: true,
  followers?: [],
  following?: [],
  bio?: string,
  coverPhoto?: string,
  dob?: string,
  lastUpdate?: string[],
  location?: string,
  noOfUpdates?: 9,
  website?: string,
  resetToken?: string,
  resetTokenExpiry?: number,
  name?: string
}

export type AllChats = {
  chats: ChatData[],
  chatSettings: {
    [key: string]: NewChatSettings;
  };
  messages?: (MessageAttributesClient)[],
  requestId: string
}

export type Participant = {
  _id: ObjectId;
  lastMessageId: string;
  unreadCount: number;
  favorite: boolean;
  pinned: boolean;
  deleted: boolean;
  archived: boolean;
  chatSettings: NewChatSettings;
  displayPicture: string;
  userId: string;
  chatId: string;
  chatType: ChatType;
}

export type NewChat_ = {
  chat: ChatData;
  requestId: string;
}

export type ChatData = {
  _id: ObjectId;
  name: {
      [id: string]: string
  };
  chatType: ChatType;
  participants: Participant[];
  groupDescription: string;
  groupDisplayPicture: string;
  verified: boolean;
  adminIds: string[];
  inviteLink: string;
  isPrivate: boolean;
  lastMessageId: string;
  timestamp: string;
  lastUpdated: string;
}

export type ConvoType = {
  id: string;
  type: string;
  name: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  displayPicture: string;
  description: string;
  verified: boolean;
  favorite: boolean,
  pinned: boolean,
  deleted: boolean,
  archived: boolean,
  lastUpdated: string,
  participants: string[],
  online: boolean,
  isTyping: {
    [x: string]: boolean
  }
}

export enum Visibility {
  Everyone = 'everyone',
  Friends = 'friends',
  None = 'none',
}

export enum CommentPermission {
  Everyone = 'everyone',
  Friends = 'friends',
  None = 'none',
}

export type BlogPost = {
  _id: ObjectId;
  UserId: string;
  DisplayPicture: string;
  NameOfPoster: string;
  Verified: boolean;
  TimeOfPost: string;
  Visibility: Visibility;
  Caption: string;
  Image: string[];
  NoOfLikes: number;
  Liked: boolean;
  NoOfComment: number;
  NoOfShares: number;
  NoOfBookmarks: number;
  Bookmarked: boolean;
  Username: string;
  PostID: string;
  Code: string;
  WhoCanComment: CommentPermission;
  Shared: boolean;
  Type: "post" | "comment" | "repost" | "quote";
  ParentId: string;
  IsFollowing: boolean;
}

export interface SharedBlogPost extends BlogPost {
  OriginalPostId: string; // Reference to the original post
}

export interface Post {
  post: BlogPost;
  message: string;
}

export interface Comment {
  comment: BlogPost;
  message: string;
}
export interface ConvoType1 extends ConvoType {
  userId: string,
  convo: boolean
}
export type hook<P = any, Q = boolean, R = boolean> = {
  payload: P,
  suspense: Q,
  exit: R
}
// export const ConvoType: Partial<hook<Partial<ConvoType>>> = {
//   payload: {},
//   suspense: false
// };
export type ReactionType = {
  type: 'like' | 'bookmark' | 'unlike' | 'unbookmark';
  key: 'NoOfLikes' | 'NoOfBookmarks';
  value: 'inc' | 'dec',
  postId: string;
};
