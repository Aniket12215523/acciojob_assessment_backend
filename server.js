import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './src/utils/db.js';


import aiRoutes from './src/routes/aiRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import sessionRoutes from "./src/routes/sessionRoutes.js";
import messageRoutes from './src/routes/messageRoutes.js';
import voiceRoutes from './src/routes/voiceRoutes.js';
import codeRoutes from './src/routes/codeRoutes.js';
import chatRoutes from './src/routes/chatRoutes.js';
import uploadRoutes from './src/routes/uploadRoutes.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
app.use(cors({
  origin: [
    'https://acciojob-assessment-frontend.vercel.app',
    'http://localhost:5173'
  ],
  credentials: true, 
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use('/video-frames', express.static(path.join(__dirname, 'uploads/video_captioning/frames')));


// DB connection
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api', aiRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/code', codeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/', (req, res) => {
  res.send('🔥 Backend is live');
});

const PORT = process.env.PORT || 18000;
app.listen(PORT, () => {
  console.log(` Server running on http://localhost:${PORT}`);
});


