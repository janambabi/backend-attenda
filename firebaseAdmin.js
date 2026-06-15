const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const path = require('path');

if (getApps().length === 0) {
  try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require('./serviceAccountKey.json');
      initializeApp({
        credential: cert(serviceAccount)
      });
    } else {
      console.warn("⚠️ Warning: serviceAccountKey.json not found!");
      initializeApp();
    }
  } catch (error) {
    console.error('Firebase admin initialization error', error.stack);
  }
}

const db = getFirestore();
const auth = getAuth();

module.exports = { db, auth };
