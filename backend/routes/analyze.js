const express = require('express');
const multer = require('multer');
const { GoogleGenAI } = require('@google/genai');

const router = express.Router();

// MULTER SETUP
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
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

router.post('/analyze', upload.array('images', 5), async (req, res) => {
  try {
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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview",
      contents: {
        parts: [
          ...imageParts,
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    const results = JSON.parse(text);

    // Validate and clean
    const cleanedResults = validateResults(results, fields);

    res.json({ success: true, results: cleanedResults });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function buildDynamicPrompt(fields) {
  let prompt = `You are an expert Meesho product listing assistant. 
Analyze the provided product images and fill out the listing form.

CRITICAL RULES:
1. For fields with OPTIONS, you MUST choose ONLY from the provided list.
2. For multiple select, return an array of strings from the options.
3. For price/weight, return NUMBERS only (realistic Indian market prices in INR).
4. For SEO title (Product Name), use 60-80 chars.
5. Return JSON only.

FIELDS TO FILL:
`;

  const schemaExample = {};

  fields.forEach(f => {
    if (f.type === 'file_upload') return;

    let instructions = "";
    if (f.type === 'dropdown' && f.optionLabels?.length > 0) {
      instructions = `Choose exactly one from: [${f.optionLabels.join(', ')}]`;
    } else if (f.type === 'multi_chip' && f.optionLabels?.length > 0) {
      instructions = `Choose one or more from: [${f.optionLabels.join(', ')}] (as array)`;
    } else if (f.type === 'number_input') {
      instructions = "Number only (realistic for Indian market)";
    } else if (f.type === 'textarea') {
      instructions = "Detailed SEO description (150-200 words)";
    } else {
      instructions = "Appropriate text value";
    }

    prompt += `- ${f.label}: ${instructions}\n`;
    schemaExample[f.label] = f.type === 'multi_chip' ? ["value"] : "value";
  });

  prompt += `\nResponse must be valid JSON matching this keys: ${JSON.stringify(Object.keys(schemaExample))}`;
  return prompt;
}

function validateResults(results, fields) {
  const cleaned = {};
  fields.forEach(f => {
    let val = results[f.label];
    
    if (f.type === 'dropdown' && f.optionLabels?.length > 0) {
      if (!f.optionLabels.includes(val)) {
        // Fallback to closest match or first option
        val = f.optionLabels.find(o => String(val).toLowerCase().includes(o.toLowerCase())) || f.optionLabels[0];
      }
    } else if (f.type === 'multi_chip' && f.optionLabels?.length > 0) {
      const arr = Array.isArray(val) ? val : [val];
      val = arr.filter(v => f.optionLabels.includes(v));
      if (val.length === 0) val = [f.optionLabels[0]];
    } else if (f.type === 'number_input') {
      val = parseFloat(String(val).replace(/[^0-9.]/g, ''));
      if (isNaN(val)) val = 0;
    }
    
    cleaned[f.label] = val;
  });
  return cleaned;
}

router.get('/health', (req, res) => res.json({ status: 'ok' }));

module.exports = router;
