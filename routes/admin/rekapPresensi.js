/**
 * Router & Controller: Rekap Presensi ASN BPMP Sulawesi Tenggara
 * Menangani tampilan halaman, API paginasi, filter, sorting, dan ekspor Excel & PDF.
 */

const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function createRekapPresensiRouter(db, helpers = {}) {
  const router = express.Router();
  const { getAdminFromToken, PUBLIC_DIR } = helpers;

  // Middleware autentikasi admin/superadmin
  function requireAdmin(req, res, next) {
    if (!getAdminFromToken) return next();
    const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
    const peran = admin ? (admin.role || admin.peran) : '';
    if (!admin || !['superadmin', 'admin', 'kepegawaian'].includes(peran)) {
      return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });
    }
    req.admin = admin;
    next();
  }

  // 1. Tampilan Web Halaman Rekap Presensi
  router.get('/admin/rekap-presensi', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-rekap-presensi.html'));
  });

  // Helper untuk filter, search, sort, dan paginasi data rekap
  async function getFilteredRekapData(query) {
    const filter = (query.filter || 'all').toLowerCase(); // 'all', 'hadir', 'belum'
    const unitKerja = query.unitKerja || 'all';
    const eventId = query.eventId || 'all';
    const search = (query.search || '').trim().toLowerCase();
    const sort = query.sort || 'no'; // 'no', 'name', 'nip', 'jabatan', 'presensi', 'lpti', 'sertifikat'
    const dir = (query.dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const allEmployees = await db.getAllEmployees();
    const activeEvent = await db.getActiveEvent();
    const allEvents = await db.getAllEvents();

    // Tentukan event target
    let targetEvent = activeEvent;
    if (eventId !== 'all') {
      const found = (allEvents || []).find(e => String(e.id) === String(eventId));
      if (found) targetEvent = found;
    }
    const currentEventJp = targetEvent?.jp || 2;

    // Filter data pegawai
    let filtered = allEmployees.map((emp, index) => {
      const attended = Boolean(emp.attended);
      const lpti = emp.lpti || {};
      const lptiStatus = lpti.status || 'none';
      const isApproved = lptiStatus === 'approved';
      const canPrint = attended && isApproved;
      
      let lockedReason = '';
      if (!attended && !isApproved) {
        lockedReason = 'E-Sertifikat terkunci: Pegawai belum hadir di aula dan LPTI belum disetujui.';
      } else if (!attended) {
        lockedReason = 'E-Sertifikat terkunci: Kehadiran fisik di aula belum tervalidasi.';
      } else if (!isApproved) {
        lockedReason = 'E-Sertifikat terkunci: Berkas LPTI belum disetujui oleh Bagian Kepegawaian.';
      }

      return {
        id: emp.id,
        noUrutAsli: index + 1,
        name: emp.name,
        nip: emp.nip,
        jabatan: emp.jabatan || emp.position || 'Aparatur Sipil Negara',
        instansi: emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
        attended: attended,
        attendedAt: emp.attendedAt || (attended ? targetEvent?.schedule || '2026' : null),
        attendancePhotoUrl: emp.attendancePhotoUrl || null,
        jp: attended ? currentEventJp : 0,
        lpti: {
          status: lptiStatus, // 'none', 'pending', 'approved', 'revision'
          fileName: lpti.fileName || lpti.fileOriginalName || null,
          filePath: lpti.filePath || null,
          uploadedAt: lpti.uploadedAt || null,
          revisionNote: lpti.revisionNote || lpti.catatan || '',
          diklaimOleh: lpti.diklaimOleh || null,
          diklaimSampai: lpti.diklaimSampai || null
        },
        certificate: {
          number: emp.certificate?.number || null,
          id: emp.certificate?.certId || emp.certificate?.id || null,
          status: emp.certificate?.status || (canPrint ? 'valid' : 'locked'),
          canPrint: canPrint,
          lockedReason: lockedReason
        }
      };
    });

    // Hitung counts sebelum filter status
    const totalSemua = filtered.length;
    const totalHadir = filtered.filter(e => e.attended).length;
    const totalBelum = totalSemua - totalHadir;

    // Filter Tab Status
    if (filter === 'hadir') {
      filtered = filtered.filter(e => e.attended);
    } else if (filter === 'belum') {
      filtered = filtered.filter(e => !e.attended);
    }

    // Filter Unit Kerja / Jabatan
    if (unitKerja !== 'all') {
      filtered = filtered.filter(e => String(e.jabatan).toLowerCase() === unitKerja.toLowerCase());
    }

    // Filter Pencarian Nama / NIP
    if (search) {
      filtered = filtered.filter(e => 
        String(e.name).toLowerCase().includes(search) ||
        String(e.nip).toLowerCase().includes(search) ||
        String(e.jabatan).toLowerCase().includes(search)
      );
    }

    // Sorting
    filtered.sort((a, b) => {
      let valA, valB;
      switch (sort) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case 'nip':
          valA = a.nip;
          valB = b.nip;
          break;
        case 'jabatan':
          valA = a.jabatan.toLowerCase();
          valB = b.jabatan.toLowerCase();
          break;
        case 'presensi':
          valA = a.attended ? 1 : 0;
          valB = b.attended ? 1 : 0;
          break;
        case 'lpti':
          valA = a.lpti.status;
          valB = b.lpti.status;
          break;
        case 'sertifikat':
          valA = a.certificate.canPrint ? 1 : 0;
          valB = b.certificate.canPrint ? 1 : 0;
          break;
        case 'no':
        default:
          valA = a.noUrutAsli;
          valB = b.noUrutAsli;
          break;
      }
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return {
      allFiltered: filtered,
      counts: {
        all: totalSemua,
        hadir: totalHadir,
        belum: totalBelum
      },
      targetEvent,
      allEvents
    };
  }

  // 2. API JSON Data Rekap Presensi (Server-Side Pagination & Filter)
  router.get('/api/admin/rekap-presensi', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 25));

      const { allFiltered, counts, targetEvent, allEvents } = await getFilteredRekapData(req.query);
      const total = allFiltered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      const paginated = allFiltered.slice(offset, offset + limit);

      // Beri nomor urut dinamis sesuai offset
      const rows = paginated.map((row, idx) => ({
        ...row,
        no: offset + idx + 1
      }));

      // Kumpulkan daftar unit kerja unik untuk dropdown filter
      const allEmployees = await db.getAllEmployees();
      const unitKerjaList = Array.from(new Set(allEmployees.map(e => e.jabatan || e.position || 'Aparatur Sipil Negara'))).filter(Boolean).sort();

      res.json({
        success: true,
        employees: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages
        },
        counts,
        unitKerjaList,
        targetEvent: targetEvent ? {
          id: targetEvent.id,
          title: targetEvent.title,
          schedule: targetEvent.schedule,
          jp: targetEvent.jp || 2,
          location: targetEvent.location
        } : null,
        events: (allEvents || []).map(e => ({ id: e.id, title: e.title, schedule: e.schedule, active: e.active }))
      });
    } catch (err) {
      console.error('[Rekap Presensi API Error]:', err);
      res.status(500).json({ success: false, message: 'Gagal memuat rekap presensi: ' + err.message });
    }
  });

  // 3. API Ekspor Rekap Presensi ke Excel (ExcelJS)
  router.get('/api/admin/rekap-presensi/export-excel', async (req, res) => {
    try {
      const { allFiltered, targetEvent } = await getFilteredRekapData(req.query);

      const eventTitle = targetEvent?.title || 'Pengembangan Kompetensi ASN "Senin Berseri"';
      const eventSchedule = targetEvent?.schedule || 'Tahun 2026';
      const eventJp = targetEvent?.jp || 2;
      const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' }) + ' WITA';

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'BPMP Provinsi Sulawesi Tenggara';
      workbook.lastModifiedBy = 'Admin Kepegawaian';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Rekap Presensi', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
      });

      // KOP LAPORAN RESMI
      worksheet.mergeCells('A1:I1');
      worksheet.getCell('A1').value = 'KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH';
      worksheet.getCell('A1').font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1A3A5C' } };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };

      worksheet.mergeCells('A2:I2');
      worksheet.getCell('A2').value = 'BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA';
      worksheet.getCell('A2').font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF0C233C' } };
      worksheet.getCell('A2').alignment = { horizontal: 'center' };

      worksheet.mergeCells('A3:I3');
      worksheet.getCell('A3').value = 'DAFTAR REKAPITULASI PRESENSI & KELAYAKAN E-SERTIFIKAT ASN';
      worksheet.getCell('A3').font = { name: 'Arial', size: 11, bold: true };
      worksheet.getCell('A3').alignment = { horizontal: 'center' };

      worksheet.mergeCells('A4:I4');
      worksheet.getCell('A4').value = `Kegiatan: ${eventTitle} | Jadwal: ${eventSchedule} | Bobot: ${eventJp} JP | Dicetak: ${nowStr}`;
      worksheet.getCell('A4').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF556271' } };
      worksheet.getCell('A4').alignment = { horizontal: 'center' };

      worksheet.addRow([]); // Blank row at row 5

      // Header Kolom Tabel (Row 6)
      const headerRow = worksheet.addRow([
        'No',
        'Nama Pegawai',
        'NIP',
        'Jabatan / Unit Kerja',
        'Presensi Aula',
        'Bobot (JP)',
        'Status LPTI',
        'Status E-Sertifikat'
      ]);

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1A3A5C' } // Royal Blue BPMP
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'medium' },
          right: { style: 'thin' }
        };
      });

      // Data Rows
      allFiltered.forEach((emp, index) => {
        let lptiText = 'Belum Ada';
        if (emp.lpti.status === 'approved') lptiText = 'Disetujui';
        else if (emp.lpti.status === 'pending') lptiText = 'Perlu Dikurasi';
        else if (emp.lpti.status === 'revision') lptiText = 'Revisi';

        const row = worksheet.addRow([
          index + 1,
          emp.name,
          emp.nip,
          emp.jabatan,
          emp.attended ? 'Hadir' : 'Belum Hadir',
          emp.jp,
          lptiText,
          emp.certificate.canPrint ? 'Siap Cetak / Terbit' : 'Terkunci'
        ]);

        row.eachCell((cell, colNumber) => {
          cell.font = { name: 'Arial', size: 9.5 };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
          if ([1, 3, 5, 6, 7, 8].includes(colNumber)) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });

        // Zebra striping
        if (index % 2 === 1) {
          row.eachCell(cell => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF8FAFC' }
            };
          });
        }
      });

      // Lebar Kolom
      worksheet.getColumn(1).width = 6;   // No
      worksheet.getColumn(2).width = 36;  // Nama
      worksheet.getColumn(3).width = 24;  // NIP
      worksheet.getColumn(4).width = 30;  // Jabatan
      worksheet.getColumn(5).width = 16;  // Presensi
      worksheet.getColumn(6).width = 14;  // JP
      worksheet.getColumn(7).width = 18;  // LPTI
      worksheet.getColumn(8).width = 22;  // Sertifikat

      const filename = `Rekap_Presensi_BPMP_Sultra_${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error('[Export Excel Error]:', err);
      res.status(500).send('Gagal mengekspor data ke Excel: ' + err.message);
    }
  });

  // 4. API Ekspor Rekap Presensi ke Dokumen PDF (PDF-Lib)
  router.get('/api/admin/rekap-presensi/export-pdf', async (req, res) => {
    try {
      const { allFiltered, targetEvent } = await getFilteredRekapData(req.query);

      const eventTitle = targetEvent?.title || 'Pengembangan Kompetensi ASN "Senin Berseri"';
      const eventSchedule = targetEvent?.schedule || 'Tahun 2026';
      const eventJp = targetEvent?.jp || 2;
      const nowStr = new Date().toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      const doc = await PDFDocument.create();
      const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

      const PAGE_WIDTH = 841.89;  // A4 Landscape
      const PAGE_HEIGHT = 595.28;
      const MARGIN = 30;
      const usableWidth = PAGE_WIDTH - (MARGIN * 2);

      let currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      let currentY = PAGE_HEIGHT - 35;

      // Fungsi Menggambar KOP
      const drawKop = (page) => {
        const kop1 = 'KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH';
        const kop2 = 'BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA';
        const kopSub = `REKAPITULASI PRESENSI & STATUS E-SERTIFIKAT KEPEGAWAIAN`;
        const kopMeta = `Kegiatan: ${eventTitle} | Tanggal: ${eventSchedule} | Bobot: ${eventJp} Jam Pelajaran (JP)`;

        const wKop1 = fontBold.widthOfTextAtSize(kop1, 10.5);
        const wKop2 = fontBold.widthOfTextAtSize(kop2, 12);
        const wSub = fontBold.widthOfTextAtSize(kopSub, 9.5);
        const wMeta = fontRegular.widthOfTextAtSize(kopMeta, 8.5);

        page.drawText(kop1, { x: (PAGE_WIDTH - wKop1) / 2, y: currentY, size: 10.5, font: fontBold, color: rgb(0.1, 0.22, 0.36) });
        currentY -= 15;
        page.drawText(kop2, { x: (PAGE_WIDTH - wKop2) / 2, y: currentY, size: 12, font: fontBold, color: rgb(0.05, 0.14, 0.24) });
        currentY -= 14;
        page.drawText(kopSub, { x: (PAGE_WIDTH - wSub) / 2, y: currentY, size: 9.5, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
        currentY -= 12;
        page.drawText(kopMeta, { x: (PAGE_WIDTH - wMeta) / 2, y: currentY, size: 8.5, font: fontRegular, color: rgb(0.35, 0.4, 0.45) });
        currentY -= 8;

        page.drawLine({
          start: { x: MARGIN, y: currentY },
          end: { x: PAGE_WIDTH - MARGIN, y: currentY },
          thickness: 1.5,
          color: rgb(0.1, 0.22, 0.36)
        });
        currentY -= 14;
      };

      // Header Tabel
      const columns = [
        { label: 'No', width: 28, align: 'center' },
        { label: 'Nama Pegawai', width: 195, align: 'left' },
        { label: 'NIP', width: 135, align: 'left' },
        { label: 'Jabatan / Unit Kerja', width: 175, align: 'left' },
        { label: 'Presensi', width: 78, align: 'center' },
        { label: 'JP', width: 40, align: 'center' },
        { label: 'Status LPTI', width: 85, align: 'center' },
        { label: 'E-Sertifikat', width: 70, align: 'center' }
      ];

      const drawTableHeader = (page) => {
        page.drawRectangle({
          x: MARGIN,
          y: currentY - 14,
          width: usableWidth,
          height: 18,
          color: rgb(0.1, 0.22, 0.36)
        });

        let curX = MARGIN;
        for (const col of columns) {
          const wText = fontBold.widthOfTextAtSize(col.label, 8);
          let textX = curX + 4;
          if (col.align === 'center') textX = curX + (col.width - wText) / 2;
          page.drawText(col.label, { x: textX, y: currentY - 10, size: 8, font: fontBold, color: rgb(1, 1, 1) });
          curX += col.width;
        }
        currentY -= 18;
      };

      drawKop(currentPage);
      drawTableHeader(currentPage);

      const ROW_HEIGHT = 16;
      for (let i = 0; i < allFiltered.length; i++) {
        const emp = allFiltered[i];

        // Jika mendekati batas bawah halaman, buat halaman baru
        if (currentY < MARGIN + 40) {
          currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          currentY = PAGE_HEIGHT - 35;
          drawTableHeader(currentPage);
        }

        // Zebra background
        if (i % 2 === 1) {
          currentPage.drawRectangle({
            x: MARGIN,
            y: currentY - 12,
            width: usableWidth,
            height: ROW_HEIGHT,
            color: rgb(0.97, 0.98, 0.99)
          });
        }

        let lptiText = 'Belum';
        if (emp.lpti.status === 'approved') lptiText = 'Disetujui';
        else if (emp.lpti.status === 'pending') lptiText = 'Dikurasi';
        else if (emp.lpti.status === 'revision') lptiText = 'Revisi';

        const rowValues = [
          String(i + 1),
          emp.name.length > 32 ? emp.name.slice(0, 30) + '...' : emp.name,
          emp.nip,
          emp.jabatan.length > 28 ? emp.jabatan.slice(0, 26) + '...' : emp.jabatan,
          emp.attended ? 'Hadir' : 'Belum',
          String(emp.jp),
          lptiText,
          emp.certificate.canPrint ? 'Valid' : 'Kunci'
        ];

        let curX = MARGIN;
        for (let c = 0; c < columns.length; c++) {
          const col = columns[c];
          const val = rowValues[c] || '-';
          const wVal = fontRegular.widthOfTextAtSize(val, 7.5);
          let valX = curX + 4;
          if (col.align === 'center') valX = curX + (col.width - wVal) / 2;

          let textColor = rgb(0.15, 0.15, 0.15);
          if (c === 4) textColor = emp.attended ? rgb(0.05, 0.5, 0.2) : rgb(0.5, 0.5, 0.5);
          if (c === 7 && emp.lpti.status === 'approved') textColor = rgb(0.05, 0.5, 0.2);
          if (c === 7 && emp.lpti.status === 'pending') textColor = rgb(0.7, 0.5, 0.0);
          if (c === 8 && emp.certificate.canPrint) textColor = rgb(0.05, 0.5, 0.2);

          currentPage.drawText(val, { x: valX, y: currentY - 8, size: 7.5, font: fontRegular, color: textColor });
          curX += col.width;
        }

        // Garis pemisah bawah baris
        currentPage.drawLine({
          start: { x: MARGIN, y: currentY - 12 },
          end: { x: MARGIN + usableWidth, y: currentY - 12 },
          thickness: 0.5,
          color: rgb(0.9, 0.92, 0.94)
        });

        currentY -= ROW_HEIGHT;
      }

      // Footer Dokumen Cetak
      if (currentY < MARGIN + 60) {
        currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        currentY = PAGE_HEIGHT - 35;
      }

      currentY -= 15;
      const footerTgl = `Kendari, ${nowStr}`;
      const footerJabatan = 'Bagian Tata Usaha & Kepegawaian';
      const footerInstansi = 'BPMP Provinsi Sulawesi Tenggara';
      const signX = PAGE_WIDTH - MARGIN - 200;

      currentPage.drawText(footerTgl, { x: signX, y: currentY, size: 8.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
      currentY -= 12;
      currentPage.drawText(footerJabatan, { x: signX, y: currentY, size: 9, font: fontBold, color: rgb(0.1, 0.22, 0.36) });
      currentY -= 11;
      currentPage.drawText(footerInstansi, { x: signX, y: currentY, size: 8.5, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });

      const pdfBytes = await doc.save();
      const filename = `Rekap_Presensi_BPMP_Sultra_${Date.now()}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(Buffer.from(pdfBytes));
    } catch (err) {
      console.error('[Export PDF Error]:', err);
      res.status(500).send('Gagal mengekspor data ke PDF: ' + err.message);
    }
  });

  return router;
}

module.exports = createRekapPresensiRouter;
