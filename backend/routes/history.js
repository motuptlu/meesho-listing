import express from 'express';
import { db } from '../server.js';

const router = express.Router();

// Get history for current user
router.get('/', async (req, res) => {
    try {
        const { user } = req;
        const snapshot = await db.collection('history')
            .where('userId', '==', user.uid)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();

        const history = [];
        snapshot.forEach(doc => {
            history.push({ id: doc.id, ...doc.data() });
        });

        res.json({ success: true, history });
    } catch (error) {
        console.error('History Fetch Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete history item
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const docRef = db.collection('history').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Not found' });
        }

        if (doc.data().userId !== user.uid) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        await docRef.delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear all history
router.delete('/', async (req, res) => {
    try {
        const { user } = req;
        const snapshot = await db.collection('history')
            .where('userId', '==', user.uid)
            .get();

        const batch = db.batch();
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
