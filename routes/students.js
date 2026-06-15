const express = require('express');
const { db } = require('../firebaseAdmin');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/students/blocks
// Get all unique blocks from the students collection
router.get('/blocks', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const snap = await db.collection('students').get();
    const blocks = new Set();
    snap.forEach(doc => {
      const data = doc.data();
      if (data.block) blocks.add(data.block);
    });
    return res.status(200).json({ blocks: Array.from(blocks).sort() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch blocks' });
  }
});

// GET /api/students/pending-deletions
router.get('/pending-deletions', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const snap = await db.collection('pendingDeletions').get();
    const pending = [];
    snap.forEach(doc => pending.push({ id: doc.id, ...doc.data() }));
    return res.status(200).json({ pending });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch pending deletions' });
  }
});

// POST /api/students/approve-deletion/:rollNo
router.post('/approve-deletion/:rollNo', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { rollNo } = req.params;
    
    // Delete from students
    await db.collection('students').doc(rollNo).delete();
    // Delete from pendingDeletions
    await db.collection('pendingDeletions').doc(rollNo).delete();

    return res.status(200).json({ message: 'Deletion approved successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to approve deletion' });
  }
});

// POST /api/students/reject-deletion/:rollNo
router.post('/reject-deletion/:rollNo', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { rollNo } = req.params;
    
    // Just remove from pendingDeletions, keep in students
    await db.collection('pendingDeletions').doc(rollNo).delete();

    return res.status(200).json({ message: 'Deletion rejected successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reject deletion' });
  }
});

module.exports = router;
