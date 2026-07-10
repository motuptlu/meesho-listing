import express from 'express';
import { db, admin } from '../lib/firebase.js';

const router = express.Router();

// Sync user profile from Firebase Auth token
router.post('/sync', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let userData;

        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            userData = {
                uid: decodedToken.uid,
                email: decodedToken.email,
                displayName: decodedToken.name || '',
                photoURL: decodedToken.picture || ''
            };
        } catch (e) {
            // Fallback for Google Access Token
            const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${idToken}`);
            if (!googleRes.ok) throw new Error('Invalid Token');
            const profile = await googleRes.json();
            userData = {
                uid: profile.sub,
                email: profile.email,
                displayName: profile.name || '',
                photoURL: profile.picture || ''
            };
        }

        const userRef = db.collection('users').doc(userData.uid);
        const userDoc = await userRef.get();

        const finalUserData = {
            ...userData,
            lastLogin: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (!userDoc.exists) {
            finalUserData.createdAt = new Date().toISOString();
            finalUserData.quota = 100; // Default listing quota
            await userRef.set(finalUserData);
        } else {
            await userRef.update({
                displayName: finalUserData.displayName,
                photoURL: finalUserData.photoURL,
                lastLogin: finalUserData.lastLogin,
                updatedAt: finalUserData.updatedAt
            });
        }

        res.json({ success: true, user: finalUserData });
    } catch (error) {
        console.error('Auth Sync Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
