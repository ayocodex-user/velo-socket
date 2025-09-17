import { Router } from 'express';
import type { RequestHandler } from 'express';
import { getCallInfo, getUserActiveCalls, getAllActiveCalls } from '../socket/calls.js';

const router = Router();

// Get call information by call ID
const getCallInfoHandler: RequestHandler<{ callId: string }> = (req, res) => {
  const { callId } = req.params;
  const callInfo = getCallInfo(callId);
  
  if (!callInfo) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  
  res.json(callInfo);
};

router.get('/:callId', getCallInfoHandler);

// Get active calls for a specific user
const getUserActiveCallsHandler: RequestHandler<{ userId: string }> = (req, res) => {
  const { userId } = req.params;
  const activeCalls = getUserActiveCalls(userId);
  
  res.json({ userId, activeCalls });
};

router.get('/user/:userId/active', getUserActiveCallsHandler);

// Get all active calls (admin endpoint)
const getAllActiveCallsHandler: RequestHandler = (_req, res) => {
  const activeCalls = getAllActiveCalls();
  
  res.json({ activeCalls, count: activeCalls.length });
};

router.get('/admin/active', getAllActiveCallsHandler);

// Get call statistics
const getStatsOverviewHandler: RequestHandler = (_req, res) => {
  const activeCalls = getAllActiveCalls();
  
  const stats = {
    totalActive: activeCalls.length,
    audioCalls: activeCalls.filter(call => call.callType === 'audio').length,
    videoCalls: activeCalls.filter(call => call.callType === 'video').length,
    ringing: activeCalls.filter(call => call.status === 'ringing').length,
    connected: activeCalls.filter(call => call.status === 'connected').length
  };
  
  res.json(stats);
};

router.get('/stats/overview', getStatsOverviewHandler);

export default router;
