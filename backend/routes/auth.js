import express from 'express';
import { db, admin } from '../server.js';

const router = express.Router();

// Sync user profile from Firebase Auth token
router.post('/sync', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { uid, email, name, picture } = decodedToken;

        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        const userData = {
            uid,
            email,
            displayName: name || '',
            photoURL: picture || '',
            lastLogin: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (!userDoc.exists) {
            userData.createdAt = new Date().toISOString();
            userData.quota = 100; // Default listing quota
            await userRef.set(userData);
        } else {
            await userRef.update({
                displayName: userData.displayName,
                photoURL: userData.photoURL,
                lastLogin: userData.lastLogin,
                updatedAt: userData.updatedAt
            });
        }

        res.json({ success: true, user: userData });
    } catch (error) {
        console.error('Auth Sync Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
