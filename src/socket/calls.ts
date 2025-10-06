import { io, UserSocket } from '../socket.js';
import { redis } from '../app.js';

// Store active calls and their participants
const activeCalls = new Map<string, {
  callId: string;
  roomId: string;
  callerId: string;
  participants: string[];
  callType: 'audio' | 'video';
  status: 'ringing' | 'connected' | 'ended' | 'declined';
  startTime: number;
  endTime?: number;
}>();

// Handle call invitations
export const handleCallInvite = (socket: UserSocket, data: {
  roomId: string;
  targetUserId?: string;
  callType: 'audio' | 'video';
  chatType: 'DM' | 'Group';
}) => {
  const { roomId, targetUserId, callType, chatType } = data;
  const callerId = socket.handshake.query.userId as string;
  
  if (!callerId || !roomId) return;
  
  const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Create call record
  activeCalls.set(callId, {
    callId,
    roomId,
    callerId,
    participants: [callerId],
    callType,
    status: 'ringing',
    startTime: Date.now()
  });
  
  console.log(`Call invitation: ${callerId} -> ${roomId} (${callType})`);
  
  if (chatType === 'Group') {
    // Group call - notify all group members
    io.to(`group:${roomId}`).emit('call:invite', {
      callId,
      roomId,
      callerId,
      callType,
      chatType
    });
  } else {
    // Direct call - notify specific user
    if (targetUserId) {
      io.to(`user:${targetUserId}`).emit('call:invite', {
        callId,
        roomId,
        callerId,
        callType,
        chatType
      });
    }
  }
  
  // Confirm call initiated to caller
  socket.emit('call:initiated', { callId, roomId });
};

// Handle call answers
export const handleCallAnswer = (socket: UserSocket, data: {
  callId: string;
  accepted: boolean;
}) => {
  const { callId, accepted } = data;
  const userId = socket.handshake.query.userId as string;
  const call = activeCalls.get(callId);
  
  if (!call || !userId) return;
  
  if (accepted) {
    call.status = 'connected';
    call.participants.push(userId);
    
    // Join the receiver to the call room for WebRTC signaling
    socket.join(`call:${callId}`);
    
    // Notify caller that call was answered
    io.to(`user:${call.callerId}`).emit('call:answered', { callId });
    
    // Notify all participants in the call room
    io.to(`call:${callId}`).emit('call:connected', { callId, participants: call.participants });
    
    // Also notify the caller directly to ensure they receive the connected event
    io.to(`user:${call.callerId}`).emit('call:connected', { callId, participants: call.participants });
    
    console.log(`Call ${callId} connected with participants:`, call.participants);
  } else {
    call.status = 'declined';
    call.endTime = Date.now();
    
    // Notify caller that call was declined
    io.to(`user:${call.callerId}`).emit('call:declined', { callId });
    
    // Clean up
    activeCalls.delete(callId);
    console.log(`Call ${callId} declined`);
  }
};

// Handle WebRTC signaling
export const handleWebRTCOffer = (socket: UserSocket, data: {
  callId: string;
  offer: any;
}) => {
  const { callId, offer } = data;
  io.to(`call:${callId}`).emit('webrtc:offer', { callId, offer });
};

export const handleWebRTCAnswer = (socket: UserSocket, data: {
  callId: string;
  answer: any;
}) => {
  const { callId, answer } = data;
  io.to(`call:${callId}`).emit('webrtc:answer', { callId, answer });
};

export const handleWebRTCCandidate = (socket: UserSocket, data: {
  callId: string;
  candidate: any;
}) => {
  const { callId, candidate } = data;
  io.to(`call:${callId}`).emit('webrtc:candidate', { callId, candidate });
};

// Handle call end
export const handleCallEnd = (socket: UserSocket, data: {
  callId: string;
}) => {
  const { callId } = data;
  const userId = socket.handshake.query.userId as string;
  const call = activeCalls.get(callId);
  
  if (!call || !userId) return;
  
  call.status = 'ended';
  call.endTime = Date.now();
  
  // Notify all participants
  io.to(`call:${callId}`).emit('call:ended', { callId });
  
  // Clean up
  activeCalls.delete(callId);
  console.log(`Call ${callId} ended by ${userId}`);
};

// Handle call hangup (legacy compatibility)
export const handleCallHangup = (socket: UserSocket, data: {
  roomId: string;
}) => {
  const { roomId } = data;
  const userId = socket.handshake.query.userId as string;
  
  // Find and end any active calls for this room
  for (const [callId, call] of activeCalls.entries()) {
    if (call.roomId === roomId && call.participants.includes(userId)) {
      handleCallEnd(socket, { callId });
      break;
    }
  }
  
  // Legacy event for compatibility
  io.to(`group:${roomId}`).emit('remote-hangup', roomId);
};

// Get call information
export const getCallInfo = (callId: string) => {
  return activeCalls.get(callId);
};

// Get active calls for a user
export const getUserActiveCalls = (userId: string) => {
  return Array.from(activeCalls.values()).filter(call => 
    call.participants.includes(userId) && call.status !== 'ended'
  );
};

// Get all active calls (for admin/monitoring)
export const getAllActiveCalls = () => {
  return Array.from(activeCalls.values());
};
