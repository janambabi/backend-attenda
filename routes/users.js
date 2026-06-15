const express = require('express');
const { auth, db } = require('../firebaseAdmin');
const { verifyToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// POST /api/users/create
// Admin only: create a new user (warden) and assign role/block/floor
router.post('/create', verifyToken, requireRole(['admin']), async (req, res) => {
  const { email, password, name, role, assignedBlock, assignedFloor } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (role === 'block' && !assignedBlock) {
    return res.status(400).json({ error: 'Block admins require an assignedBlock' });
  }

  if (role === 'floor' && (!assignedBlock || !assignedFloor)) {
    return res.status(400).json({ error: 'Floor admins require both assignedBlock and assignedFloor' });
  }

  try {
    let uid;
    try {
      // Check if user exists by email
      const existingUser = await auth.getUserByEmail(email);
      uid = existingUser.uid;
      
      // Update existing user in Auth
      await auth.updateUser(uid, {
        password,
        displayName: name
      });
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        // Create new user in Auth
        const userRecord = await auth.createUser({
          email,
          password,
          displayName: name,
        });
        uid = userRecord.uid;
      } else {
        throw err;
      }
    }

    // Create or update user document in Firestore
    const userData = {
      email,
      name: name || '',
      role,
    };

    if (assignedBlock) userData.assignedBlock = assignedBlock;
    if (assignedFloor) userData.assignedFloor = assignedFloor;

    await db.collection('users').doc(uid).set(userData, { merge: true });

    return res.status(200).json({ 
      message: `Successfully created/updated ${role} user`,
      user: userData 
    });

  } catch (error) {
    console.error('Error creating/updating user:', error);
    return res.status(500).json({ error: 'Failed to save user' });
  }
});

// DELETE /api/users/:uid
// Admin only: delete user (except admins)
router.delete('/:uid', verifyToken, requireRole(['admin']), async (req, res) => {
  const { uid } = req.params;
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists && userDoc.data().role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin users' });
    }

    // Prevent deleting self just in case
    if (uid === req.user.uid) {
      return res.status(403).json({ error: 'Cannot delete yourself' });
    }

    await auth.deleteUser(uid);
    await db.collection('users').doc(uid).delete();

    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /api/users
// Admin only: list users
router.get('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
      users.push({ id: doc.id, ...doc.data() });
    });
    return res.status(200).json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// DELETE /api/users/:uid
// Admin only: delete a user
router.delete('/:uid', verifyToken, requireRole(['admin']), async (req, res) => {
  const { uid } = req.params;
  
  if (!uid) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Prevent admin from deleting themselves
  if (uid === req.user.uid) {
    return res.status(403).json({ error: 'You cannot delete your own account' });
  }

  try {
    // 1. Delete from Firebase Auth
    await auth.deleteUser(uid);
    // 2. Delete from Firestore
    await db.collection('users').doc(uid).delete();

    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    if (error.code === 'auth/user-not-found') {
      // If not in auth, still try to delete from firestore
      await db.collection('users').doc(uid).delete();
      return res.status(200).json({ message: 'User document deleted' });
    }
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
