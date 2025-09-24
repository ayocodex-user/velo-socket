# Offline Message Delivery System

## Overview

This system solves the problem of missed real-time updates when users go offline. When a user goes offline (network disconnection, app backgrounded, etc.), they miss important updates like post likes, new posts, comments, etc. This system ensures these messages are delivered when they come back online.

## How It Works

### 1. Message Queuing
- When a real-time event occurs (like, comment, new post, etc.), the system checks if users are online
- For online users: Messages are sent immediately via WebSocket
- For offline users: Messages are stored in Redis with a TTL (Time To Live)

### 2. Message Storage
- Messages are stored in Redis using the pattern: `offline_messages:{userId}`
- Each message has a TTL of 24 hours (configurable)
- Maximum 1000 messages per user to prevent memory bloat
- Messages are automatically cleaned up after delivery

### 3. Message Delivery
- When a user comes back online and registers, the system:
  1. Retrieves all pending messages for that user
  2. Sends them in chronological order
  3. Clears the messages from Redis

## Message Types

The system handles these message types:

1. **`post_update`** - Post likes, shares, comment counts, etc.
2. **`new_post`** - New posts, reposts, quotes
3. **`new_comment`** - New comments on posts
4. **`delete_post`** - Post deletions

## Implementation Details

### Server Side (`offline-messages.ts`)

```typescript
class OfflineMessageManager {
  // Store message for offline users
  async storeMessage(message: OfflineMessage): Promise<void>
  
  // Get pending messages for a user
  async getMessagesForUser(userId: string): Promise<OfflineMessage[]>
  
  // Broadcast to online users, store for offline users
  async broadcastMessage(message, excludeUserId?, targetUserIds?): Promise<void>
  
  // Handle user coming back online
  async handleUserOnline(userId: string): Promise<void>
}
```

### Client Side (`SocketProvider.tsx`)

The client listens for these events:
- `post_update` - Handle post updates
- `new_post` - Handle new posts
- `new_comment` - Handle new comments
- `delete_post` - Handle post deletions

## Configuration

### Redis Keys
- `offline_messages:{userId}` - List of pending messages for a user
- `online_users` - Set of currently online users

### TTL Settings
- Message TTL: 24 hours (configurable)
- Max messages per user: 1000 (configurable)

## Usage Example

### Before (Direct Broadcasting)
```typescript
// Old way - only reaches online users
io.emit("updatePost", { 
    excludeUser: userId,
    postId: post.PostID,  
    update: { NoOfLikes: newCount }
});
```

### After (Offline Message System)
```typescript
// New way - reaches both online and offline users
await offlineMessageManager.broadcastMessage({
    type: 'post_update',
    data: { 
        postId: post.PostID,  
        update: { NoOfLikes: newCount }
    }
}, userId);
```

## Benefits

1. **No Missed Updates**: Users get all updates when they come back online
2. **Efficient Storage**: Redis provides fast access and automatic cleanup
3. **Scalable**: Works with thousands of users and messages
4. **Configurable**: TTL and limits can be adjusted based on needs
5. **Chronological Order**: Messages are delivered in the order they occurred

## Monitoring

The system logs when offline messages are delivered:
```
Delivered 5 offline messages to user 12345
```

## Future Enhancements

1. **Message Prioritization**: Important messages could be delivered first
2. **Batch Processing**: Group similar messages together
3. **User Preferences**: Allow users to configure which updates they want
4. **Analytics**: Track offline message delivery rates
5. **Push Notifications**: Integrate with mobile push notifications for critical updates

## Testing

To test the offline message system:

1. Open the app in two browser windows (different users)
2. Go offline in one window (disconnect network or close tab)
3. Perform actions in the other window (like posts, create posts, etc.)
4. Come back online in the first window
5. Verify that all missed updates are received

## Troubleshooting

### Messages Not Delivered
- Check Redis connection
- Verify user is properly registered
- Check message TTL hasn't expired

### Performance Issues
- Monitor Redis memory usage
- Adjust max messages per user
- Consider message batching for high-volume scenarios
