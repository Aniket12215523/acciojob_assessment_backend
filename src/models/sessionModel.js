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
    'gpt-3.5-turbo',
    'gpt-4',
    'gpt-4o',             
    'mistral',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'gemma-7b-it',
    'mixtral-8x7b-32768',
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
        role: { type: String, enum: ['user', 'ai', 'bot'], required: true },
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

