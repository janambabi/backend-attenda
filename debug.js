const { db } = require('./firebaseAdmin');

async function check() {
  const snap = await db.collection('students').limit(5).get();
  snap.forEach(doc => {
    console.log(doc.id, doc.data());
  });
  
  const uSnap = await db.collection('users').get();
  uSnap.forEach(doc => {
    console.log('USER:', doc.data());
  });
}
check().catch(console.error);
