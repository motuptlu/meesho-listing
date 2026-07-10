import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { admin, db, storage } from './lib/firebase.js';

// Routes
import analyzeRouter from './routes/analyze.js';
import historyRouter from './routes/history.js';
import authRouter from './routes/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth Middleware
export const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        // Fallback for Google Access Tokens (from chrome.identity)
        try {
            const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${idToken}`);
            if (!googleRes.ok) throw new Error('Invalid Google Token');
            
            const profile = await googleRes.json();
            req.user = {
                uid: profile.sub,
                email: profile.email,
                name: profile.name,
                picture: profile.picture,
                firebase: false
            };
            next();
        } catch (err) {
            console.error('Auth Error:', error);
            res.status(401).json({ success: false, error: 'Invalid token' });
        }
    }
};

// Routes
app.use('/api/analyze', authenticateUser, analyzeRouter);
app.use('/api/history', authenticateUser, historyRouter);
app.use('/api/auth', authRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        // Only serve index.html for non-API routes
        if (!req.path.startsWith('/api/')) {
            res.sendFile(path.join(distPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API route not found' });
        }
    });
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Meesho Auto Lister Backend is running',
        firebase: (admin.apps || []).length > 0
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

export { db, storage, admin };
