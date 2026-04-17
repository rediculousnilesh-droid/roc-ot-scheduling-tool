import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import authRouter from './routes/auth.js';
import fillratesRouter from './routes/fillrates.js';
import { createHeatmapRouter } from './routes/heatmap.js';
import { createRosterRouter } from './routes/roster.js';
import { createGenerateRouter } from './routes/generate.js';
import { createSlotsRouter } from './routes/slots.js';
import { createSessionRouter } from './routes/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/heatmap', createHeatmapRouter(io));
app.use('/api/roster', createRosterRouter(io));
app.use('/api/generate', createGenerateRouter(io));
app.use('/api/slots', createSlotsRouter(io));
app.use('/api/session', createSessionRouter(io));
app.use('/api/fillrates', fillratesRouter);

// System user endpoint — returns the OS username for auto-login
app.get('/api/system-user', (_req, res) => {
  const username = os.userInfo().username || '';
  // Strip domain prefix if present (e.g., "DOMAIN\user" -> "user")
  const clean = username.includes('\\') ? username.split('\\').pop()! : username;
  res.json({ username: clean.toLowerCase() });
});

// Serve client static files in production
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

export { app, httpServer, io };
