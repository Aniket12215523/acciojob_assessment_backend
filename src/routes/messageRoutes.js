import express from 'express';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import Session from '../models/sessionModel.js';

const router = express.Router();

const getChatFallbackModels = (primaryModel) => {
  // Optimize for chat (faster models first)
  const chatFallbackMap = {
    'llama-3.1-8b-instant': ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
    'llama-3.3-70b-versatile': ['llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    'openai/gpt-oss-120b': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    'openai/gpt-oss-20b': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    
    // Legacy mappings
    'llama3-8b-8192': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    'mixtral-8x7b-32768': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']
  };
  
  return [primaryModel, ...(chatFallbackMap[primaryModel] || ['llama-3.1-8b-instant'])];
};

async function callChatAPI(messages, models, modelIndex = 0) {
  if (modelIndex >= models.length) {
    throw new Error('All chat models exhausted');
  }

  const model = models[modelIndex];
  
  try {
    console.log(`Attempting chat API call with model: ${model}`);
    
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
      console.error(`HTTP ${response.status}:`, errorData);
      
      // Try fallback for certain errors
      if (response.status === 429 || response.status === 503 || response.status === 400) {
        console.log(`Attempting chat fallback to next model...`);
        return await callChatAPI(messages, models, modelIndex + 1);
      }
      
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

    if (modelIndex < models.length - 1) {
      console.log(`Attempting chat fallback to next model...`);
      return await callChatAPI(messages, models, modelIndex + 1);
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

    const userModel = session.model || 'llama-3.1-8b-instant';
    const fallbackModels = getChatFallbackModels(userModel);
    
    console.log(`Chat using model: ${userModel}, Fallback chain: ${fallbackModels.join(', ')}`);

    // Build conversation context
    const recentHistory = session.chatHistory.slice(-10);
    const messages = [
      { role: 'system', content: 'You are a helpful AI assistant. Provide concise, accurate, and friendly responses.' },
      ...recentHistory.map(msg => ({ 
        role: msg.role === 'ai' ? 'assistant' : msg.role, 
        content: msg.content 
      })),
      { role: 'user', content: message }
    ];

    const result = await callChatAPI(messages, fallbackModels);
    
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
      modelUsed: result.modelUsed,
      requestedModel: userModel
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
