import express from 'express';
import { db, admin } from '../lib/firebase.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route   POST /api/auth/sync
 * @desc    Sync user profile from Firebase Auth token and return user data
 * @access  Private
 */
router.post('/sync', authenticateUser, async (req, res) => {
    try {
        const { user } = req;

        const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.name || user.displayName || '',
            photoURL: user.picture || user.photoURL || '',
            emailVerified: user.email_verified || user.emailVerified || false
        };

        const userRef = db.collection('users').doc(userData.uid);
        const userDoc = await userRef.get();

        const timestamp = new Date().toISOString();
        const finalUserData = {
            ...userData,
            lastLogin: timestamp,
            updatedAt: timestamp
        };

        if (!userDoc.exists) {
            finalUserData.createdAt = timestamp;
            finalUserData.quota = 100; // Default listing quota
            await userRef.set(finalUserData);
        } else {
            // Update existing user but keep original createdAt and quota
            await userRef.update({
                displayName: finalUserData.displayName,
                photoURL: finalUserData.photoURL,
                lastLogin: finalUserData.lastLogin,
                updatedAt: finalUserData.updatedAt,
                emailVerified: finalUserData.emailVerified
            });
            
            const existingData = userDoc.data();
            finalUserData.createdAt = existingData.createdAt;
            finalUserData.quota = existingData.quota || 100;
        }

        res.json({ success: true, user: finalUserData });
    } catch (error) {
        console.error('Auth Sync Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user's profile
 * @access  Private
 */
router.get('/profile', authenticateUser, async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }

        res.json({ success: true, user: userDoc.data() });
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
