import { io } from '../socket.js';
import { offlineMessageManager } from '../offline-messages.js';

type StatusCreatePayload = {
  group: unknown;
  targetUserIds?: string[];
};

type StatusDeletePayload = {
  statusId: string;
  ownerId: string;
  targetUserIds?: string[];
};

type StatusViewPayload = {
  statusId: string;
  ownerId: string;
  viewerId: string;
  viewedAt: string;
};

io.on('connection', async (socket) => {
  socket.on('status:create', async (data: StatusCreatePayload, ack?: () => void) => {
    try {
      const targetUserIds = Array.from(new Set((data.targetUserIds ?? []).filter(Boolean)));
      await offlineMessageManager.broadcastMessage(
        {
          type: 'statusCreated',
          data: { group: data.group },
          ttl: 24 * 60 * 60,
        },
        undefined,
        targetUserIds
      );
      ack?.();
    } catch (error) {
      console.error('Error handling status:create event:', error);
      ack?.();
    }
  });

  socket.on('status:delete', async (data: StatusDeletePayload, ack?: () => void) => {
    try {
      const targetUserIds = Array.from(new Set((data.targetUserIds ?? []).filter(Boolean)));
      await offlineMessageManager.broadcastMessage(
        {
          type: 'statusDeleted',
          data: { statusId: data.statusId, ownerId: data.ownerId },
          ttl: 24 * 60 * 60,
        },
        undefined,
        targetUserIds
      );
      ack?.();
    } catch (error) {
      console.error('Error handling status:delete event:', error);
      ack?.();
    }
  });

  socket.on('status:view', async (data: StatusViewPayload, ack?: () => void) => {
    try {
      io.to(`user:${data.ownerId}`).emit('statusViewed', {
        statusId: data.statusId,
        ownerId: data.ownerId,
        viewerId: data.viewerId,
        viewedAt: data.viewedAt,
      });
      ack?.();
    } catch (error) {
      console.error('Error handling status:view event:', error);
      ack?.();
    }
  });
});
