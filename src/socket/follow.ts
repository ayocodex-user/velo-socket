import { io } from '../socket.js';
import { redis } from '../app.js';

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId as string;

    // Handle follow event
    socket.on('follow', async (data: { followedDetails: any, followerDetails: any, time: string }) => {
        try {
            const { followedDetails, followerDetails, time } = data;
            
            // Notify the followed user
            // io.to(`user:${followedId}`).emit('followNotification', {
            io.emit('followNotification', {
                followedDetails,
                followerDetails,
                timestamp: time
            });

            // Update online users list if needed
            const isOnline = await redis.get(`user:${followerDetails._id}:online`);
            if (isOnline) {
                io.emit('userStatus', { userId: followerDetails._id?.toString(), status: 'online' });
            }
        } catch (error) {
            console.error('Error handling follow event:', error);
        }
    });

    // Handle unfollow event
    socket.on('unfollow', async (data: { followedDetails: any, followerDetails: any, time: string }) => {
        try {
            const { followedDetails, followerDetails, time } = data;
            
            // Notify the unfollowed user
            // io.to(`user:${followedId}`).emit('followNotification', {
            io.emit('followNotification', {
                followedDetails,
                followerDetails,
                timestamp: time
            });
        } catch (error) {
            console.error('Error handling unfollow event:', error);
        }
    });
}); 