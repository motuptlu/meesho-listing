import express from 'express';
import { db } from '../lib/firebase.js';

const router = express.Router();

// Get history (removed authentication)
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('history')
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

// Delete history item (removed authentication)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const docRef = db.collection('history').doc(id);
        await docRef.delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear all history (removed authentication)
router.delete('/', async (req, res) => {
    try {
        const snapshot = await db.collection('history').get();

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
