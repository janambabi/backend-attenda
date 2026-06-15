const express = require('express');
const { db } = require('../firebaseAdmin');
const { verifyToken, requireRole } = require('../middleware/auth');
const ExcelJS = require('exceljs');

const router = express.Router();

// GET /api/reports/dashboard-stats
// Highly optimized endpoint for the Admin Dashboard
router.get('/dashboard-stats', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    // Enforce IST (Asia/Kolkata) timezone strictly
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    // 1. Fetch only required fields to save memory and bandwidth
    const studentsSnap = await db.collection('students').select('block', 'floor').get();
    
    let totalStudents = 0;
    const blockStats = {};
    const blockFloorsSet = {};

    studentsSnap.forEach(doc => {
      const s = doc.data();
      totalStudents++;
      const block = s.block || 'Unknown';
      const floor = s.floor || 'Unknown';

      if (!blockStats[block]) blockStats[block] = { total: 0, present: 0, submitted: false };
      blockStats[block].total++;

      if (!blockFloorsSet[block]) blockFloorsSet[block] = new Set();
      blockFloorsSet[block].add(String(floor));
    });

    // 2. Fetch ONLY today's attendance records
    const attendanceSnap = await db.collection('attendance')
      .where('date', '==', today)
      .get();

    let presentToday = 0;

    attendanceSnap.forEach(doc => {
      const data = doc.data();
      const block = data.block;
      if (!blockStats[block]) blockStats[block] = { total: 0, present: 0, submitted: false };
      
      blockStats[block].submitted = true;
      
      const records = data.records || {};
      for (const [rollNo, status] of Object.entries(records)) {
        if (status === 'present' || status === true) {
          blockStats[block].present++;
          presentToday++;
        }
      }
    });

    const blockFloors = {};
    for (const b in blockFloorsSet) {
      blockFloors[b] = Array.from(blockFloorsSet[b]).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
    }

    return res.status(200).json({
      totalStudents,
      presentToday,
      blocks: blockStats,
      blockFloors
    });
  } catch (error) {
    console.error('Error fetching dashboard stats', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// GET /api/reports/available
// Returns only the blocks, months, and years that have actual attendance marked
router.get('/available', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const snap = await db.collection('attendance').get();
    const monthsSet = new Set();
    const yearsSet = new Set();
    const blocksSet = new Set();

    snap.forEach(doc => {
      const data = doc.data();
      if (data.date) {
        const [year, month] = data.date.split('-');
        yearsSet.add(year);
        monthsSet.add(month);
      }
      if (data.block) blocksSet.add(data.block);
    });

    return res.status(200).json({
      months: Array.from(monthsSet).sort(),
      years: Array.from(yearsSet).sort(),
      blocks: Array.from(blocksSet).sort()
    });
  } catch (err) {
    console.error('Error fetching available criteria', err);
    return res.status(500).json({ error: 'Failed to fetch available criteria' });
  }
});

// GET /api/reports/monthly
router.get('/monthly', verifyToken, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.query; // format: MM, YYYY
  
  if (!month || !year) {
    return res.status(400).json({ error: 'Month and year are required' });
  }

  try {
    // 1. Fetch students
    let studentsQuery = db.collection('students');
    if (req.query.block && req.query.block !== 'all') {
      studentsQuery = studentsQuery.where('block', '==', req.query.block);
    }
    const studentsSnap = await studentsQuery.get();
    const studentsData = {};
    studentsSnap.forEach(doc => {
      const data = doc.data();
      studentsData[data.rollNo] = { ...data, presentDays: 0, totalDays: 0, dailyRecords: {} };
    });

    // 2. Fetch all attendance records for the month
    // We can do a prefix match on date string "YYYY-MM"
    const prefix = `${year}-${month.padStart(2, '0')}`;
    
    // In Firestore, prefix search requires:
    const endPrefix = prefix + '\uf8ff';
    const attendanceSnap = await db.collection('attendance')
      .where('date', '>=', prefix)
      .where('date', '<=', endPrefix)
      .get();

    let totalAttendanceRecords = 0;
    
    attendanceSnap.forEach(doc => {
      const data = doc.data();
      totalAttendanceRecords++;
      
      const records = data.records;
      const dayString = data.date.split('-')[2];
      const dayNum = parseInt(dayString, 10);

      // records: { studentRollNo: 'present' | 'absent' }
      for (const [rollNo, status] of Object.entries(records)) {
        if (studentsData[rollNo]) {
          studentsData[rollNo].totalDays += 1;
          const isPresent = status === 'present' || status === true;
          studentsData[rollNo].dailyRecords[dayNum] = isPresent ? 'P' : 'A';
          if (isPresent) {
            studentsData[rollNo].presentDays += 1;
          }
        }
      }
    });

    // Calculate percentage
    const results = Object.values(studentsData).map(student => {
      const percentage = student.totalDays === 0 ? 0 : ((student.presentDays / student.totalDays) * 100).toFixed(2);
      return {
        ...student,
        percentage
      };
    });

    // Generate block and floor summaries
    const summaries = { blocks: {}, floors: {} };
    
    results.forEach(student => {
      // Block summary
      if (!summaries.blocks[student.block]) {
        summaries.blocks[student.block] = { present: 0, total: 0 };
      }
      summaries.blocks[student.block].present += student.presentDays;
      summaries.blocks[student.block].total += student.totalDays;

      // Floor summary (Format: Block-Floor)
      const floorKey = `${student.block}-${student.floor}`;
      if (!summaries.floors[floorKey]) {
        summaries.floors[floorKey] = { present: 0, total: 0, block: student.block, floor: student.floor };
      }
      summaries.floors[floorKey].present += student.presentDays;
      summaries.floors[floorKey].total += student.totalDays;
    });

    return res.status(200).json({ 
      students: results,
      summaries,
      totalRecords: totalAttendanceRecords
    });

  } catch (error) {
    console.error('Error fetching reports', error);
    return res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reports/export
router.get('/export', verifyToken, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.query; // format: MM, YYYY
  
  if (!month || !year) {
    return res.status(400).json({ error: 'Month and year are required' });
  }

  try {
    let studentsQuery = db.collection('students');
    if (req.query.block && req.query.block !== 'all') {
      studentsQuery = studentsQuery.where('block', '==', req.query.block);
    }
    const studentsSnap = await studentsQuery.get();
    const studentsData = {};
    studentsSnap.forEach(doc => {
      const data = doc.data();
      studentsData[data.rollNo] = { ...data, presentDays: 0, totalDays: 0, dailyRecords: {} };
    });

    const prefix = `${year}-${month.padStart(2, '0')}`;
    const endPrefix = prefix + '\uf8ff';
    const attendanceSnap = await db.collection('attendance')
      .where('date', '>=', prefix)
      .where('date', '<=', endPrefix)
      .get();

    attendanceSnap.forEach(doc => {
      const docData = doc.data();
      const records = docData.records;
      const dayString = docData.date.split('-')[2];
      const dayNum = parseInt(dayString, 10);

      for (const [rollNo, status] of Object.entries(records)) {
        if (studentsData[rollNo]) {
          studentsData[rollNo].totalDays += 1;
          const isPresent = status === 'present' || status === true;
          studentsData[rollNo].dailyRecords[dayNum] = isPresent ? 'P' : 'A';
          if (isPresent) {
            studentsData[rollNo].presentDays += 1;
          }
        }
      }
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Attendance_${month}_${year}`);

    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

    const columns = [
      { header: 'Roll No', key: 'rollNo', width: 20 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Block', key: 'block', width: 10 },
      { header: 'Floor', key: 'floor', width: 10 },
      { header: 'Room No', key: 'roomNo', width: 15 }
    ];

    for (let i = 1; i <= daysInMonth; i++) {
      columns.push({ header: `${i}`, key: `day_${i}`, width: 5 });
    }

    columns.push({ header: 'Total Days', key: 'totalDays', width: 15 });
    columns.push({ header: 'Present Days', key: 'presentDays', width: 15 });
    columns.push({ header: 'Percentage', key: 'percentage', width: 15 });

    worksheet.columns = columns;

    Object.values(studentsData).forEach(student => {
      const percentage = student.totalDays === 0 ? 0 : ((student.presentDays / student.totalDays) * 100).toFixed(2);
      
      const rowData = {
        ...student,
        percentage: `${percentage}%`
      };

      for (let i = 1; i <= daysInMonth; i++) {
        rowData[`day_${i}`] = student.dailyRecords[i] || '';
      }

      const row = worksheet.addRow(rowData);

      // Apply cell formatting for daily columns
      for (let i = 1; i <= daysInMonth; i++) {
        const colIndex = 5 + i; // Offset by the first 5 columns
        const cell = row.getCell(colIndex);
        if (cell.value === 'P') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
          cell.font = { color: { argb: 'FF006100' }, bold: true };
        } else if (cell.value === 'A') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
          cell.font = { color: { argb: 'FF9C0006' }, bold: true };
        }
        cell.alignment = { horizontal: 'center' };
      }
    });

    // Style headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    worksheet.getRow(1).alignment = { horizontal: 'center' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Attendance_Report_${month}_${year}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error generating Excel', error);
    return res.status(500).json({ error: 'Failed to generate Excel report' });
  }
});

module.exports = router;
