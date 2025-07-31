import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import mammoth from 'mammoth';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

const pdfParse = require('pdf-parse');
const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});
const upload = multer({ storage });

// --- NEW: Helper function for OCR microservice ---
import axios from 'axios';
import FormData from 'form-data';

async function getOcrTextFromMicroservice(imagePath) {
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));
  const res = await axios.post('http://localhost:5003/ocr', form, { headers: form.getHeaders() });
  return res.data.text;
}

// Existing helper for video audio transcription
async function transcribeAudioFromVideo(videoPath) {
  return new Promise((resolve, reject) => {
    const pyPath = path.join(process.cwd(), 'uploads/video_captioning/caption_video.py'); // adjust path if needed
    const py = spawn('python', [pyPath, videoPath]);
    let data = '';
    let error = '';
    py.stdout.on('data', (chunk) => { data += chunk.toString(); });
    py.stderr.on('data', (chunk) => { error += chunk.toString(); });
    py.on('close', (code) => {
      if (code === 0) resolve(data.trim());
      else reject(new Error(error || 'Python captioning failed.'));
    });
  });
}

// Existing AI helper
async function getAIResponse(text, selectedModel) {
  if (selectedModel.toLowerCase().startsWith('gemini')) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: selectedModel || 'gemini-1.5-flash' });
    const response = await model.generateContent([
      { text: `You are a helpful assistant. Given the following extracted text, help the user understand or summarize it:\n\n"${text}"` },
    ]);
    return response.response.text() || 'Sorry, no reply generated.';
  } else if (selectedModel.toLowerCase().startsWith('groq')) {
    const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel || 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are a helpful assistant analyzing extracted document text.' },
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Groq API error: ${aiRes.status} - ${errText}`);
    }
    const aiData = await aiRes.json();
    return aiData.choices?.[0]?.message?.content || 'Sorry, no reply generated.';
  }
  // Default no AI response
  return null;
}

// --- THE ACTUAL UPLOAD ROUTE ---
router.post('/', upload.array('files'), async (req, res) => {
  // Optionally get selected model from query, default groq
  const selectedModel = (req.query.model || 'groq').toLowerCase();

  try {
    const fileInfos = await Promise.all(
      req.files.map(async (file) => {
        const ext = path.extname(file.originalname).toLowerCase();
        let parsedText = null;
        let aiReply = null;

        // PDF Parsing
        if (file.mimetype === 'application/pdf') {
          const dataBuffer = fs.readFileSync(file.path);
          const parsed = await pdfParse(dataBuffer);
          parsedText = parsed.text;
        }
        // Word Document Parsing
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const result = await mammoth.extractRawText({ path: file.path });
          parsedText = result.value;
        }
        // Plain Text Parsing
        else if (file.mimetype === 'text/plain') {
          parsedText = fs.readFileSync(file.path, 'utf-8');
        }
        // --------- IMAGE OCR PARSING (UPDATED) ---------
        else if (file.mimetype.startsWith('image/')) {
          try {
            parsedText = await getOcrTextFromMicroservice(file.path);
          } catch (error) {
            console.error('OCR microservice failed:', error);
            parsedText = '⚠️ OCR microservice failed.';
          }
        }
        // Video Audio Transcription using Whisper (LEAVE THIS)
        else if (file.mimetype.startsWith('video/')) {
          try {
            const transcript = await transcribeAudioFromVideo(file.path);
            parsedText = transcript;
          } catch (err) {
            console.error('Video audio transcription failed:', err.message);
            parsedText = '⚠️ Video transcription failed.';
          }
        }

        // Pass parsed text to AI (if text extracted)
        if (parsedText && parsedText.length > 10) {
          try {
            aiReply = await getAIResponse(parsedText, selectedModel);
          } catch (err) {
            console.error('AI processing failed:', err);
            aiReply = '⚠️ AI processing failed.';
          }
        }

        return {
          filename: file.filename,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: `/uploads/${file.filename}`,
          content: parsedText,
          ai_response: aiReply,
        };
      })
    );

    res.status(200).json({
      message: 'Files uploaded, parsed, and processed successfully',
      files: fileInfos,
    });
  } catch (error) {
    console.error('Upload & processing error:', error);
    res.status(500).json({ message: 'Upload failed', error });
  }
});

export default router;
