import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import { db } from '../server.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// MULTER SETUP
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// GENAI SETUP
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

router.post('/', upload.array('images', 5), async (req, res) => {
  try {
    const { user } = req;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No images provided' });
    }

    const fieldsInfo = JSON.parse(req.body.formFields || '{"fields":[]}');
    const fields = fieldsInfo.fields;

    const imageParts = req.files.map(file => ({
      inlineData: {
        data: file.buffer.toString('base64'),
        mimeType: file.mimetype
      }
    }));

    const prompt = buildDynamicPrompt(fields);

    // Using the requested model
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }
    });

    const response = result;
    let text = response.text;
    
    // Clean potential markdown code blocks
    text = text.replace(/```json\n?|```/g, '').trim();
    
    const results = JSON.parse(text);
    const cleanedResults = validateResults(results, fields);

    // Auto-save to history
    const historyId = uuidv4();
    const historyData = {
      userId: user.uid,
      results: cleanedResults,
      timestamp: new Date().toISOString(),
      productName: cleanedResults['Product Name'] || cleanedResults['Title'] || 'Untitled Product',
      thumbnail: imageParts[0].inlineData.data // Store small thumbnail
    };

    await db.collection('history').doc(historyId).set(historyData);

    res.json({ 
      success: true, 
      results: cleanedResults,
      historyId
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function buildDynamicPrompt(fields) {
  let prompt = `You are a Senior Meesho Listing Specialist. 
Analyze these product images and extract accurate data for the Meesho Supplier Panel.

INSTRUCTIONS:
1. Exact Option Matching: If a field specifies OPTIONS, you MUST choose the most accurate one from that exact list.
2. SEO Optimization: Generate highly optimized Product Titles (60-80 chars) and Descriptions.
3. Realistic Data: Use realistic Indian market pricing (INR) and standard product specs.
4. Data Types: 
   - Dropdowns/Chips: Must match provided options.
   - Numbers: Return pure numeric values.
   - Textarea: Rich, benefit-driven descriptions.

FIELDS TO ANALYZE:
`;

  fields.forEach(f => {
    if (f.type === 'file_upload') return;
    
    let constraint = "";
    if (f.optionLabels?.length > 0) {
      constraint = `[OPTIONS: ${f.optionLabels.join(', ')}]`;
    } else if (f.type === 'number') {
      constraint = "[TYPE: Numeric]";
    } else if (f.type === 'textarea') {
      constraint = "[TYPE: Long Description]";
    }

    prompt += `- ${f.label}: ${constraint}\n`;
  });

  prompt += `\nReturn ONLY a JSON object where keys are the field labels and values are the extracted data.`;
  return prompt;
}

function validateResults(results, fields) {
  const cleaned = {};
  fields.forEach(f => {
    let val = results[f.label];
    
    if (f.optionLabels?.length > 0) {
      // Fuzzy matching for options if AI didn't return exact string
      if (!f.optionLabels.includes(val)) {
        val = f.optionLabels.find(o => 
          String(val).toLowerCase().includes(o.toLowerCase()) || 
          o.toLowerCase().includes(String(val).toLowerCase())
        ) || f.optionLabels[0];
      }
    } else if (f.type === 'number') {
      val = parseFloat(String(val).replace(/[^0-9.]/g, ''));
      if (isNaN(val)) val = 0;
    }
    
    cleaned[f.label] = val;
  });
  return cleaned;
}

export default router;
