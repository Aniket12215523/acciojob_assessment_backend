import express from 'express';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import Session from '../models/sessionModel.js';

const router = express.Router();

// Chat-optimized models (faster for conversations)
const CHAT_MODELS = [
  'llama-3.1-8b-instant',         // Fastest for chat
  'llama-3.3-70b-versatile',      // Better quality fallback
  'openai/gpt-oss-20b'            // Final fallback
];

async function callChatAPI(messages, modelIndex = 0) {
  if (modelIndex >= CHAT_MODELS.length) {
    throw new Error('All chat models exhausted');
  }

  const model = CHAT_MODELS[modelIndex];
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 2048,
        temperature: 0.8
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      error.response = { status: response.status, data: errorData };
      throw error;
    }

    const data = await response.json();
    return {
      success: true,
      data: data,
      modelUsed: model
    };

  } catch (error) {
    console.error(`Chat model ${model} failed:`, error.message);

    // Retry conditions
    if (error.response?.status === 429 || 
        error.response?.status === 503 || 
        error.response?.status === 502 ||
        error.code === 'ECONNABORTED') {
      
      console.log(`Attempting chat fallback to next model...`);
      return await callChatAPI(messages, modelIndex + 1);
    }

    throw error;
  }
}

router.post('/send', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Build conversation context (last 10 messages for context)
    const recentHistory = session.chatHistory.slice(-10);
    const messages = [
      { role: 'system', content: 'You are a helpful AI assistant. Provide concise, accurate, and friendly responses.' },
      ...recentHistory.map(msg => ({ role: msg.role === 'ai' ? 'assistant' : msg.role, content: msg.content })),
      { role: 'user', content: message }
    ];

    const result = await callChatAPI(messages);
    
    if (!result.success) {
      throw new Error('All chat models failed');
    }

    const aiReply = result.data.choices?.[0]?.message?.content || 'I apologize, but I could not generate a response.';

    session.chatHistory.push(
      { id: uuidv4(), role: 'user', content: message },
      { id: uuidv4(), role: 'assistant', content: aiReply }
    );

    session.lastEditedAt = new Date();
    await session.save();

    res.status(200).json({ 
      reply: aiReply, 
      messages: session.chatHistory,
      modelUsed: result.modelUsed
    });

  } catch (err) {
    console.error('Message send error:', err.message);
    
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid API key. Please check your Groq configuration.' });
    } else if (err.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
    } else if (err.message === 'All chat models exhausted') {
      return res.status(503).json({ error: 'Sorry, the assistant is currently unavailable. Please try again later.' });
    }
    
    res.status(500).json({ error: 'Failed to get response from AI' });
  }
});

export default router;
