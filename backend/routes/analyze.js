const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const router = express.Router();

// Configure Multer
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/analyze', upload.array('images', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No images uploaded' });
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
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        let text = response.text();

        // Clean JSON response
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let rawResults;
        try {
            rawResults = JSON.parse(text);
        } catch (parseError) {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                rawResults = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('AI returned invalid format');
            }
        }

        // Validate and clean results
        const cleanedResults = validateAndCleanResults(rawResults, fields);

        res.json({ success: true, results: cleanedResults });

    } catch (error) {
        console.error('Gemini Analysis Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function buildDynamicPrompt(fields) {
    let prompt = `You are an expert product listing specialist for Meesho, India's top e-commerce platform.
I am giving you product images to analyze. Based on the images, fill in the product listing form fields below.

CRITICAL RULES:
1. For fields with OPTIONS LIST: You MUST pick ONLY from the given options. Do not invent values.
2. For multi-select fields: Pick ALL applicable options as a JSON array.
3. For price fields: Use realistic Indian market prices in INR (numbers only).
4. For text fields: Write SEO-optimized, compelling content for the Indian market.
5. Respond with ONLY valid JSON. No markdown, no explanation.

FIELDS TO FILL:
`;

    const jsonStructure = {};
    
    fields.forEach(field => {
        if (field.type === 'file') return;
        
        const key = field.label;
        let instructions = '';
        
        if (field.type === 'text_input') {
            if (/name|title/i.test(key)) {
                instructions = 'SEO-optimized product name (60-80 chars). Include material, style, gender.';
            } else if (/brand/i.test(key)) {
                instructions = 'Brand name if visible, else "Generic".';
            } else {
                instructions = 'Appropriate concise value.';
            }
        } else if (field.type === 'number_input') {
            if (/mrp|retail/i.test(key)) instructions = 'Realistic Indian MRP price (number only).';
            else if (/price|selling|sale/i.test(key)) instructions = 'Selling price (number). 20-35% less than MRP.';
            else if (/weight/i.test(key)) instructions = 'Approximate weight in grams (number).';
            else instructions = 'Appropriate numeric value.';
        } else if (field.type === 'textarea') {
            instructions = 'Compelling 150-200 word description including material, features, style, care.';
        } else if (field.type === 'dropdown' && field.options?.length > 0) {
            const opts = field.options.map(o => o.label).join(', ');
            instructions = `MUST be EXACTLY one of: [${opts}].`;
        } else if (field.type === 'multi_chip' && field.options?.length > 0) {
            const opts = field.options.map(o => o.label).join(', ');
            instructions = `Select ALL applicable as JSON array from: [${opts}].`;
        } else if (field.type === 'radio' && field.options?.length > 0) {
            const opts = field.options.map(o => o.label).join(', ');
            instructions = `MUST be EXACTLY one of: [${opts}].`;
        } else {
            instructions = 'Most appropriate value based on image.';
        }

        prompt += `- "${key}": ${instructions}\n`;
        jsonStructure[key] = field.type === 'multi_chip' ? ["example"] : "example";
    });

    prompt += `\nReturn a JSON object with these exact keys:\n${JSON.stringify(jsonStructure, null, 2)}`;
    return prompt;
}

function validateAndCleanResults(results, fields) {
    const cleaned = {};
    fields.forEach(field => {
        if (field.type === 'file') return;
        
        let val = results[field.label];
        
        if (field.type === 'dropdown' || field.type === 'radio') {
            if (field.options?.length > 0) {
                const optLabels = field.options.map(o => o.label);
                if (!optLabels.includes(val)) {
                    // Find closest match
                    val = optLabels.find(l => String(val).toLowerCase().includes(l.toLowerCase()) || l.toLowerCase().includes(String(val).toLowerCase())) || optLabels[0];
                }
            }
        } else if (field.type === 'multi_chip') {
            const optLabels = field.options?.map(o => o.label) || [];
            const vals = Array.isArray(val) ? val : [val];
            val = vals.filter(v => optLabels.includes(v));
            if (val.length === 0 && optLabels.length > 0) val = [optLabels[0]];
        } else if (field.type === 'number_input') {
            val = parseFloat(String(val).replace(/[^0-9.]/g, ''));
            if (isNaN(val)) {
                if (/mrp/i.test(field.label)) val = 499;
                else if (/price|selling/i.test(field.label)) val = 349;
                else val = 0;
            }
        }
        
        cleaned[field.label] = val;
    });
    return cleaned;
}

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

module.exports = router;
