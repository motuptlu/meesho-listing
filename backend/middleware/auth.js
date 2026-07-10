import { admin } from '../lib/firebase.js';

/**
 * Middleware to authenticate user via Firebase ID Token
 */
export const authenticateUser = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        
        try {
            // Try as Firebase ID Token first
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            req.user = decodedToken;
            next();
        } catch (error) {
            // Fallback: Try as Google Access Token (common in Chrome Extensions)
            try {
                const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${idToken}`);
                if (!googleRes.ok) {
                    console.error('Token verification failed (both Firebase and Google)');
                    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
                }
                
                const profile = await googleRes.json();
                req.user = {
                    uid: profile.sub,
                    email: profile.email,
                    name: profile.name,
                    picture: profile.picture,
                    email_verified: profile.email_verified,
                    firebase: false
                };
                next();
            } catch (fallbackError) {
                console.error('Authentication fallback error:', fallbackError);
                return res.status(401).json({ success: false, error: 'Unauthorized: Authentication failed' });
            }
        }
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ success: false, error: 'Internal server error during authentication' });
    }
};
