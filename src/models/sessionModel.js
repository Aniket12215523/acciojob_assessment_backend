import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    default: 'Untitled Session',
  },
  model: {
    type: String,
    enum: [
      // Current Groq Models (October 2025)
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile', 
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'qwen/qwen3-32b',
      
      // Legacy support (will be removed)
      'llama3-8b-8192',
      'mixtral-8x7b-32768',
      'gemma-7b-it',
      'gemini-1.5-flash',
      'gemini-2.0-flash'
    ],
    required: true
  },
  memory: {
    type: String,
    default: '',
  },
  chatHistory: [
    {
      role: { type: String, enum: ['user', 'ai', 'assistant', 'bot'], required: true },
      content: { type: String, required: true },
    },
  ],
  generatedCode: {
    jsx: { type: String, default: '' },
    css: { type: String, default: '' },
  },
  lastEditedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
