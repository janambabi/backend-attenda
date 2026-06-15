const { auth, db } = require('../firebaseAdmin');

// Middleware to verify Firebase Auth Token
const verifyToken = async (req, res, next) => {
  let token = req.headers.authorization?.split('Bearer ')[1];
  
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    
    // Fetch custom roles from users collection
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    if (userDoc.exists) {
      req.user.role = userDoc.data().role;
      req.user.assignedBlock = userDoc.data().assignedBlock;
      req.user.assignedFloor = userDoc.data().assignedFloor;
    } else {
      req.user.role = 'unknown';
    }

    next();
  } catch (error) {
    console.error('Error verifying auth token', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Middleware to check if user has required role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden: Missing role information' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Requires one of roles: ${roles.join(', ')}` });
    }
    
    next();
  };
};

module.exports = { verifyToken, requireRole };
