const express = require('express');
const { db } = require('../firebaseAdmin');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// Helper to check if current time is within window (12:00 AM - 11:59 PM)
const isWithinMarkingWindow = () => {
  // 12:00 AM to 11:59 PM means it is ALWAYS true for any valid time.
  return true;
};

// GET /api/attendance/window
// Check if attendance marking is currently allowed
router.get('/window', (req, res) => {
  res.json({ isOpen: isWithinMarkingWindow() });
});

// POST /api/attendance/mark
// Mark attendance for a specific block, floor, and room
router.post('/mark', verifyToken, requireRole(['admin', 'block', 'floor']), async (req, res) => {
  if (!isWithinMarkingWindow()) {
    // During dev, we might want to bypass this.
    // Uncomment next line to enforce strictly:
    // return res.status(403).json({ error: 'Attendance can only be marked between 8:00 PM and 11:59 PM.' });
  }

  const { date, block, floor, roomNo, records } = req.body;
  // records: { [studentRollNo]: 'present' | 'absent' }

  if (!date || !block || !floor || !roomNo || !records) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Authorization checks based on user's assignment
  if (req.user.role === 'floor') {
    if (req.user.assignedBlock !== block || req.user.assignedFloor !== floor) {
      return res.status(403).json({ error: 'Unauthorized to mark attendance for this floor' });
    }
  } else if (req.user.role === 'block') {
    if (req.user.assignedBlock !== block) {
      return res.status(403).json({ error: 'Unauthorized to mark attendance for this block' });
    }
  }

  try {
    const docId = `${date}_${block}_${floor}_${roomNo}`;
    const attendanceRef = db.collection('attendance').doc(docId);

    // Use merge: true to allow wardens to re-submit or update attendance for the same room
    await attendanceRef.set({
      date,
      block,
      floor,
      roomNo,
      records,
      markedBy: req.user.uid,
      timestamp: new Date().toISOString()
    }, { merge: true });

    return res.status(200).json({ message: 'Attendance marked successfully' });

  } catch (error) {
    console.error('Error marking attendance', error);
    return res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// GET /api/attendance/daily
// Get daily attendance for dashboards
router.get('/daily', verifyToken, async (req, res) => {
  const { date, block, floor } = req.query;
  
  if (!date) {
    return res.status(400).json({ error: 'Date is required' });
  }

  try {
    let query = db.collection('attendance').where('date', '==', date);
    
    if (block) query = query.where('block', '==', block);
    if (floor) query = query.where('floor', '==', floor);

    // Apply role constraints
    if (req.user.role === 'floor') {
      query = query.where('block', '==', req.user.assignedBlock)
                   .where('floor', '==', req.user.assignedFloor);
    } else if (req.user.role === 'block') {
      query = query.where('block', '==', req.user.assignedBlock);
    }

    const snapshot = await query.get();
    const results = [];
    
    snapshot.forEach(doc => {
      results.push(doc.data());
    });

    return res.status(200).json({ attendance: results });

  } catch (error) {
    console.error('Error fetching daily attendance', error);
    return res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

module.exports = router;
