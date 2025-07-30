import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import Session from '../models/sessionModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

const upload = multer({
  dest: path.join(__dirname, '../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Helper: Initialize Gemini AI client inside handler whenever needed
function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// POST /api/voice/sessions/:sessionId/voice-upload?model=gemini (or groq)
router.post('/sessions/:sessionId/voice-upload', upload.single('audio'), async (req, res) => {
  const { sessionId } = req.params;
  const filePath = req.file?.path;
  const selectedModel = req.query.model || 'groq'; 

  console.log('Voice upload started:');
  console.log('SessionId:', sessionId);
  console.log('File Path:', filePath);
  console.log('Selected Model:', selectedModel);

  if (!filePath) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  try {
    // Step 1: Send audio file to local Whisper transcription server
    const whisperForm = new FormData();
    whisperForm.append('audio', fs.createReadStream(filePath));

    console.log('Sending audio to local whisper server for transcription...');
    const whisperRes = await axios.post('http://localhost:5001/transcribe', whisperForm, {
      headers: whisperForm.getHeaders(),
      timeout: 60000, // 60s timeout
    });

    const transcript = whisperRes.data.transcript;
    if (!transcript || transcript.trim() === '') {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'No speech detected in audio' });
    }
    console.log('Transcription:', transcript);

    // Step 2: Fetch session from DB
    const session = await Session.findById(sessionId);
    if (!session) {
      fs.unlinkSync(filePath);
      return res.status(404).json({ error: 'Session not found' });
    }

    // Step 3: Send transcript to selected LLM API
    let aiReply = '';
    if (selectedModel.toLowerCase() === 'gemini') {
      console.log('Using Gemini API for AI response...');
      const genAI = getGeminiClient();
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash', 
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      });

      const result = await model.generateContent([
        {
          text: `You are a helpful AI assistant. The user sent this voice message:

User's message: "${transcript}"

Respond as if you are having a natural conversation.`,
        },
      ]);
      aiReply = result.response.text() || 'Sorry, I could not generate a response.';
    } else if (selectedModel.toLowerCase() === 'groq') {
      console.log('Using Groq API for AI response...');
      const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI assistant. Respond naturally to the user message.',
            },
            { role: 'user', content: transcript },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`Groq API error: ${aiRes.status} - ${errText}`);
      }
      const aiData = await aiRes.json();
      aiReply = aiData.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Unknown model selected' });
    }

    // Step 4: Save transcript and AI reply to chatHistory
    session.chatHistory.push(
      {
        id: uuidv4(),
        role: 'user',
        content: transcript,
        timestamp: new Date(),
        messageType: 'voice',
      },
      {
        id: uuidv4(),
        role: 'bot',
        content: aiReply,
        timestamp: new Date(),
        messageType: 'text',
      }
    );
    session.lastEditedAt = new Date();
    await session.save();

    // Step 5: Clean up uploaded audio file
    fs.unlinkSync(filePath);

    console.log('Voice processing completed successfully');

    return res.json({
      transcription: transcript,
      reply: aiReply,
      success: true,
      modelUsed: selectedModel,
    });
  } catch (error) {
    console.error('Voice processing error:', error.message);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(500).json({
      error: 'Voice processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;
