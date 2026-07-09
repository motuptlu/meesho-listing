const express = require('express');
const multer = require('multer');
const path = require('path');
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

const prompt = `You are a product listing expert for Meesho Indian e-commerce platform.
Analyze the product image carefully and extract all product details.
You MUST respond with ONLY a valid JSON object. No markdown formatting, no code blocks, no explanation text. Just the raw JSON.

Return exactly this JSON structure with all fields filled:
{
  "productName": "write descriptive product name with key features between 60 to 80 characters in English",
  "category": "write one of these exact values: Women Ethnic or Women Western or Men or Kids or Home and Kitchen or Beauty or Electronics or Sports or Bags or Footwear or Jewellery or Accessories",
  "subCategory": "write specific product type like Kurti or Saree or T-Shirt or Jeans or Watch etc",
  "description": "write 150 to 200 word compelling product description mentioning material features occasions and care instructions in English",
  "mrp": 599,
  "sellingPrice": 399,
  "color": "write primary color name",
  "size": "write available sizes like S M L XL or Free Size or product dimensions",
  "material": "write fabric or material type",
  "weight": 300,
  "brand": "write brand name if visible in image or write Generic",
  "keywords": "write 10 comma separated search keywords",
  "occasion": "write one of: Casual or Formal or Party or Wedding or Festival or Daily Use or Sports",
  "pattern": "write one of: Solid or Printed or Embroidered or Striped or Checked or Floral or Plain",
  "gender": "write one of: Women or Men or Unisex or Boys or Girls or Kids"
}

Important rules:
mrp must be a realistic Indian market price as a plain number with no currency symbol
sellingPrice must be 20 to 35 percent less than mrp as a plain number
weight must be approximate weight in grams as a plain number
All other values must be strings
Never return null or undefined for any field
Always make a reasonable guess if unsure
Respond with raw JSON only, absolutely no other text`;

router.post('/analyze', upload.array('images', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No images uploaded' });
        }

        const imageParts = req.files.map(file => ({
            inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: file.mimetype
            }
        }));

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        let text = response.text();

        // Clean JSON response
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let results;
        try {
            results = JSON.parse(text);
        } catch (parseError) {
            // Fallback: Try to find JSON using regex
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                results = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('AI returned invalid format');
            }
        }

        // Field Validation and Defaults
        if (!results.productName || results.productName.length < 2) results.productName = "Product";
        
        results.mrp = Number(results.mrp) || 499;
        results.sellingPrice = Number(results.sellingPrice) || 349;
        results.weight = Number(results.weight) || 300;

        if (results.sellingPrice >= results.mrp) {
            results.sellingPrice = Math.round(results.mrp * 0.7);
        }

        const stringFields = ['category', 'subCategory', 'description', 'color', 'size', 'material', 'brand', 'keywords', 'occasion', 'pattern', 'gender'];
        stringFields.forEach(field => {
            if (!results[field]) results[field] = '';
        });

        res.json({ success: true, results });

    } catch (error) {
        console.error('Gemini Analysis Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

module.exports = router;
