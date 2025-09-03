# Velo Socket Server

A real-time communication server with calling functionality built with Socket.IO, Express, and TypeScript.

## Features

- Real-time messaging
- Audio and video calling
- WebRTC signaling
- User presence management
- Group chat support
- Call history and statistics

## Getting Started

### Prerequisites

- Node.js 16+
- Redis server
- MongoDB

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the server:
```bash
npm run dev
```

## API Endpoints

### Health Check
- `GET /health` - Server health status

### Calls API
- `GET /api/calls/:callId` - Get call information
- `GET /api/calls/user/:userId/active` - Get user's active calls
- `GET /api/calls/admin/active` - Get all active calls (admin)
- `GET /api/calls/stats/overview` - Get call statistics

## Socket Events

### Call Events
- `call:invite` - Initiate a call
- `call:answer` - Answer or decline a call
- `call:end` - End an active call
- `call:hangup` - Hang up a call (legacy)

### WebRTC Events
- `webrtc:offer` - Send WebRTC offer
- `webrtc:answer` - Send WebRTC answer
- `webrtc:candidate` - Send ICE candidate

### Response Events
- `call:initiated` - Call invitation sent
- `call:answered` - Call was answered
- `call:declined` - Call was declined
- `call:connected` - Call participants connected
- `call:ended` - Call ended

## Call Flow

1. **Call Initiation**: User sends `call:invite` with room ID and call type
2. **Call Invitation**: Target users receive `call:invite` event
3. **Call Answer**: Target user responds with `call:answer` (accepted/declined)
4. **WebRTC Setup**: If accepted, participants exchange WebRTC offers/answers/candidates
5. **Call Connected**: All participants receive `call:connected` event
6. **Call End**: Any participant can end the call with `call:end`

## Configuration

The server uses the following environment variables:

- `REDIS_URL` - Redis connection string
- `ALLOWED_URL` - CORS allowed origin
- `ALLOWED_URL_1` - Additional CORS allowed origin

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Architecture

- **Socket.IO**: Real-time communication
- **Express**: HTTP API and middleware
- **Redis**: User presence and session management
- **MongoDB**: Data persistence
- **TypeScript**: Type safety and development experience
