import express from 'express';
import axios from 'axios';
import Session from '../models/sessionModel.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router();

// Model fallback hierarchy
const getFallbackModels = (primaryModel) => {
  const fallbackMap = {
    'llama-3.3-70b-versatile': ['llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    'openai/gpt-oss-120b': ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    'llama-3.1-8b-instant': ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
    'openai/gpt-oss-20b': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    
    // Legacy model mappings
    'llama3-8b-8192': ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    'mixtral-8x7b-32768': ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    'gemma-7b-it': ['llama-3.1-8b-instant', 'openai/gpt-oss-20b']
  };
  
  return [primaryModel, ...(fallbackMap[primaryModel] || ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'])];
};

async function callGroqAPI(messages, models, modelIndex = 0) {
  if (modelIndex >= models.length) {
    throw new Error('All models exhausted');
  }

  const model = models[modelIndex];
  
  try {
    console.log(`Attempting API call with model: ${model}`);
    
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: model,
        messages: messages,
        max_tokens: model.includes('70b') || model.includes('120b') ? 8192 : 4096,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      data: response.data,
      modelUsed: model
    };

  } catch (error) {
    console.error(`Model ${model} failed:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    // Retry with next model for specific errors
    if (error.response?.status === 429 || 
        error.response?.status === 503 || 
        error.response?.status === 502 ||
        error.response?.status === 400 || // Bad request (model might not exist)
        error.code === 'ECONNABORTED') {
      
      console.log(`Attempting fallback to next model...`);
      return await callGroqAPI(messages, models, modelIndex + 1);
    }

    throw error;
  }
}

router.post('/prompt', verifyToken, async (req, res) => {
  const { prompt, sessionId } = req.body;

  if (!prompt || !sessionId) {
    return res.status(400).json({ msg: 'Prompt and sessionId are required' });
  }

  try {
    // Get session to retrieve user's selected model
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ msg: 'Session not found' });

    const userModel = session.model || 'llama-3.1-8b-instant';
    const fallbackModels = getFallbackModels(userModel);
    
    console.log(`User selected model: ${userModel}, Fallback chain: ${fallbackModels.join(', ')}`);

    const messages = [
      { 
        role: 'system', 
        content: 'You are an expert React component generator. Return only clean, functional JSX and CSS. Ensure components are modern, accessible, and follow best practices.' 
      },
      { role: 'user', content: prompt }
    ];

    const result = await callGroqAPI(messages, fallbackModels);
    
    if (!result.success) {
      throw new Error('All AI models failed');
    }

    const aiResponse = result.data.choices?.[0]?.message?.content || '';
    
    // Enhanced parsing logic
    const jsxStart = aiResponse.indexOf('<');
    const cssStart = aiResponse.indexOf('```');
    const cssEnd = aiResponse.indexOf('```', cssStart + 6);

    let jsx = '';
    let css = '';

    if (jsxStart !== -1) {
      jsx = aiResponse.slice(jsxStart, cssStart !== -1 ? cssStart : aiResponse.length).trim();
    }

    if (cssStart !== -1 && cssEnd !== -1) {
      css = aiResponse.slice(cssStart + 6, cssEnd).trim();
    }

    session.chatHistory.push({ role: 'user', content: prompt });
    session.chatHistory.push({ role: 'ai', content: aiResponse });
    session.generatedCode = { jsx, css };
    session.lastEditedAt = new Date();

    await session.save();

    res.json({ 
      jsx, 
      css, 
      fullResponse: aiResponse,
      modelUsed: result.modelUsed,
      requestedModel: userModel
    });

  } catch (err) {
    console.error('AI Prompt Error:', err.message);
    
    if (err.response?.status === 401) {
      return res.status(401).json({ msg: 'Invalid API key. Please check your Groq API configuration.' });
    } else if (err.response?.status === 429) {
      return res.status(429).json({ msg: 'Rate limit exceeded. Please try again in a few minutes.' });
    } else if (err.message === 'All models exhausted') {
      return res.status(503).json({ msg: 'AI services are temporarily unavailable. Please try again later.' });
    }
    
    res.status(500).json({ msg: 'Something went wrong with AI generation' });
  }
});

export default router;
