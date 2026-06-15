const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { db } = require('../firebaseAdmin');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/upload/students
// Only admin can upload students
router.post('/students', verifyToken, requireRole(['admin']), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const students = [];
    
    workbook.worksheets.forEach(worksheet => {
      let headerRow = null;
      worksheet.eachRow((row, rowNumber) => {
        if (!headerRow && row.values.join('').toLowerCase().includes('roll no')) {
          headerRow = row;
        } else if (headerRow) {
          // Parse data
          const getVal = (colName) => {
            for (let i = 1; i <= headerRow.cellCount; i++) {
              const val = headerRow.getCell(i).value;
              if (val && val.toString().toLowerCase().trim().includes(colName.toLowerCase())) {
                const cellVal = row.getCell(i).value;
                return cellVal ? cellVal.toString().trim() : '';
              }
            }
            return '';
          };

          const sno = getVal('sno');
          const roomNo = getVal('room no');
          const rollNo = getVal('roll no');
          const name = getVal('name of the student') || getVal('name');
          const block = getVal('block');
          
          let floor = '1';
          if (roomNo) {
            // Extract the numeric part of the room (e.g. E-117 -> 117)
            const matches = roomNo.match(/(\d+)/);
            if (matches && matches[1] && matches[1].length >= 3) {
              const numStr = matches[1];
              floor = numStr.substring(0, numStr.length - 2); // 117 -> 1
            }
          }

          if (rollNo && name) {
            students.push({
              sno,
              roomNo,
              rollNo,
              name,
              block,
              floor
            });
          }
        }
      });
    });

    if (students.length === 0) {
      return res.status(400).json({ error: 'No valid student data found in the Excel file' });
    }

    const batch = db.batch();
    const studentsRef = db.collection('students');
    const pendingDeletionsRef = db.collection('pendingDeletions');

    // Fetch existing students to find missing ones
    const existingSnap = await studentsRef.get();
    const existingStudents = {};
    existingSnap.forEach(doc => {
      existingStudents[doc.id] = doc.data();
    });

    const uploadedRollNos = new Set();
    students.forEach(student => {
      uploadedRollNos.add(student.rollNo);
      batch.set(studentsRef.doc(student.rollNo), student, { merge: true });
    });

    let missingCount = 0;
    // Find missing students
    Object.keys(existingStudents).forEach(rollNo => {
      if (!uploadedRollNos.has(rollNo)) {
        batch.set(pendingDeletionsRef.doc(rollNo), existingStudents[rollNo]);
        missingCount++;
      }
    });

    await batch.commit();

    return res.status(200).json({ 
      message: `Successfully uploaded ${students.length} students`,
      count: students.length
    });

  } catch (error) {
    console.error('Error uploading students', error);
    return res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

module.exports = router;
