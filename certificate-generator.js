const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

/**
 * Menghasilkan file PDF E-Sertifikat dengan menempatkan Nomor Surat & Nama Pegawai
 * secara otomatis di atas template yang diunggah (Foto PNG/JPG atau Dokumen PDF).
 */
async function generateCertificatePdf({
  templatePath,
  certNumber = '800.1.3/SERT-LPTI/2026/001',
  employeeName = 'Nama Pegawai, S.Pd.',
  employeeNip = '',
  employeeJabatan = '',
  employeeInstansi = 'BPMP Provinsi Sulawesi Tenggara',
  eventTitle = 'Pelatihan Kepegawaian',
  eventJp = 32,
  eventSchedule = 'Tahun 2026',
  verifier = 'Junaiddin Pagala, ST, M.T.',
  verifierTitle = 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
  verifierNip = '197606122002121004',
  issuedAt = new Date().toISOString(),
  verifyUrl = '',
  // Pengaturan posisi relatif (0.0 - 1.0 dari bawah halaman)
  nomorYRatio = 0.72,
  namaYRatio = 0.50,
  namaFontSize = 26,
  nomorFontSize = 11,
  showQr = true
}) {
  let doc;
  let page;
  let isCustomTemplate = false;

  const ext = templatePath ? path.extname(templatePath).toLowerCase() : '';

  // KONDISI 1: Template adalah Dokumen PDF
  if (templatePath && fs.existsSync(templatePath) && ext === '.pdf') {
    try {
      const templateBytes = fs.readFileSync(templatePath);
      doc = await PDFDocument.load(templateBytes);
      const pages = doc.getPages();
      if (pages.length > 0) {
        page = pages[0];
        isCustomTemplate = true;
      }
    } catch (err) {
      console.warn('Gagal memuat template PDF, menggunakan template bawaan:', err.message);
    }
  }

  // KONDISI 2: Template adalah Foto / Gambar (PNG / JPG / JPEG)
  else if (templatePath && fs.existsSync(templatePath) && ['.png', '.jpg', '.jpeg'].includes(ext)) {
    try {
      const imageBytes = fs.readFileSync(templatePath);
      doc = await PDFDocument.create();

      let image;
      if (ext === '.png') {
        image = await doc.embedPng(imageBytes);
      } else {
        image = await doc.embedJpg(imageBytes);
      }

      // Ukuran halaman mengikuti proporsi gambar asli (standar minimal A4 Landscape: 842 x 595 pt)
      const imgWidth = image.width;
      const imgHeight = image.height;
      const pageRatio = imgWidth / imgHeight;

      // Buat halaman A4 Landscape yang proporsional
      const pageWidth = 841.89;
      const pageHeight = pageWidth / pageRatio;

      page = doc.addPage([pageWidth, pageHeight]);

      // Gambar foto template sebagai latar belakang penuh (background)
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight
      });

      isCustomTemplate = true;
    } catch (err) {
      console.warn('Gagal memuat template gambar, menggunakan template bawaan:', err.message);
    }
  }

  // KONDISI 3: Belum Ada Template Kustom (Gunakan Template Bawaan Resmi BPMP Sultra)
  if (!doc || !page) {
    doc = await PDFDocument.create();
    page = doc.addPage([841.89, 595.28]); // A4 Landscape (842 x 595 pt)

    const { width, height } = page.getSize();
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

    // Outer border (Emerald Green)
    page.drawRectangle({
      x: 20,
      y: 20,
      width: width - 40,
      height: height - 40,
      borderColor: rgb(0.02, 0.35, 0.25),
      borderWidth: 3.5,
      color: rgb(0.995, 1, 0.995)
    });

    // Inner border (Gold)
    page.drawRectangle({
      x: 27,
      y: 27,
      width: width - 54,
      height: height - 54,
      borderColor: rgb(0.82, 0.68, 0.28),
      borderWidth: 1.5
    });

    // Kop Lembaga
    const kop1 = 'KEMENTERIAN PENDIDIKAN, KEBUDAYAAN, RISET, DAN TEKNOLOGI';
    page.drawText(kop1, {
      x: (width - fontBold.widthOfTextAtSize(kop1, 10)) / 2,
      y: height - 58,
      size: 10,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2)
    });

    const kop2 = 'BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA';
    page.drawText(kop2, {
      x: (width - fontBold.widthOfTextAtSize(kop2, 12)) / 2,
      y: height - 74,
      size: 12,
      font: fontBold,
      color: rgb(0.02, 0.35, 0.25)
    });

    page.drawLine({
      start: { x: (width - 320) / 2, y: height - 84 },
      end: { x: (width + 320) / 2, y: height - 84 },
      thickness: 1.5,
      color: rgb(0.02, 0.35, 0.25)
    });

    const titleCert = 'SERTIFIKAT KEPEGAWAIAN';
    page.drawText(titleCert, {
      x: (width - fontBold.widthOfTextAtSize(titleCert, 24)) / 2,
      y: height - 124,
      size: 24,
      font: fontBold,
      color: rgb(0.04, 0.22, 0.16)
    });

    const pengantar = 'Diberikan secara resmi kepada:';
    page.drawText(pengantar, {
      x: (width - fontRegular.widthOfTextAtSize(pengantar, 11)) / 2,
      y: height - 180,
      size: 11,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3)
    });

    // Keterangan Partisipasi
    const narasi1 = `Atas partisipasi aktif dan penyelesaian Laporan Pasca Pelatihan (LPTI) pada kegiatan:`;
    page.drawText(narasi1, {
      x: (width - fontRegular.widthOfTextAtSize(narasi1, 10)) / 2,
      y: height - 280,
      size: 10,
      font: fontRegular,
      color: rgb(0.25, 0.25, 0.25)
    });

    const safeEventTitle = `"${eventTitle}"`;
    const evTitleSize = safeEventTitle.length > 55 ? 12 : 13.5;
    page.drawText(safeEventTitle, {
      x: (width - fontBold.widthOfTextAtSize(safeEventTitle, evTitleSize)) / 2,
      y: height - 302,
      size: evTitleSize,
      font: fontBold,
      color: rgb(0.02, 0.35, 0.25)
    });

    const detailEvent = `Alokasi Bobot: ${eventJp} Jam Pelajaran (JP)  •  ${eventSchedule}`;
    page.drawText(detailEvent, {
      x: (width - fontRegular.widthOfTextAtSize(detailEvent, 10)) / 2,
      y: height - 322,
      size: 10,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3)
    });
  }

  const { width, height } = page.getSize();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  // ========================================================
  // 1. DYNAMIC FIELD 1: NOMOR SURAT / NOMOR SERTIFIKAT
  // ========================================================
  const noText = `Nomor: ${certNumber}`;
  const noSize = Number(nomorFontSize) || 11;
  const noWidth = fontRegular.widthOfTextAtSize(noText, noSize);
  const noX = (width - noWidth) / 2;
  const noY = height * (Number(nomorYRatio) || 0.72);

  page.drawText(noText, {
    x: noX,
    y: noY,
    size: noSize,
    font: fontRegular,
    color: rgb(0.25, 0.28, 0.32)
  });

  // ========================================================
  // 2. DYNAMIC FIELD 2: NAMA PEGAWAI (BESAR & TEGAS)
  // ========================================================
  const safeName = String(employeeName || '').trim();
  const calculatedNameSize = safeName.length > 34 ? Math.max(18, namaFontSize - 4) : Number(namaFontSize) || 26;
  const nameWidth = fontBold.widthOfTextAtSize(safeName, calculatedNameSize);
  const nameX = (width - nameWidth) / 2;
  const nameY = height * (Number(namaYRatio) || 0.50);

  page.drawText(safeName, {
    x: nameX,
    y: nameY,
    size: calculatedNameSize,
    font: fontBold,
    color: rgb(0.04, 0.12, 0.18)
  });

  // Garis bawah elegan untuk Nama
  page.drawLine({
    start: { x: Math.max(80, nameX - 12), y: nameY - 6 },
    end: { x: Math.min(width - 80, nameX + nameWidth + 12), y: nameY - 6 },
    thickness: 1,
    color: rgb(0.65, 0.65, 0.65)
  });

  // ========================================================
  // 3. OPTIONAL: IDENTITAS NIP & JABATAN
  // ========================================================
  if (employeeNip) {
    const nipLine = `NIP. ${employeeNip} ${employeeJabatan ? ' • ' + employeeJabatan : ''}`;
    const nipWidth = fontRegular.widthOfTextAtSize(nipLine, 9.5);
    page.drawText(nipLine, {
      x: (width - nipWidth) / 2,
      y: nameY - 20,
      size: 9.5,
      font: fontRegular,
      color: rgb(0.35, 0.38, 0.42)
    });
  }

  // ========================================================
  // 4. QR CODE KEABSAHAN (DISCRETELY IN CORNER)
  // ========================================================
  if (showQr) {
    try {
      const qrUrl = verifyUrl || `http://localhost:3000/api/verify-cert/${encodeURIComponent(certNumber)}`;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 140, color: { dark: '#064e3b', light: '#ffffff' } });
      const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const qrImage = await doc.embedPng(qrImageBytes);

      const qrSize = 55;
      const qrX = 40;
      const qrY = 35;

      page.drawImage(qrImage, {
        x: qrX,
        y: qrY,
        width: qrSize,
        height: qrSize
      });

      page.drawText('VERIFIKASI RESMI', {
        x: qrX + qrSize + 6,
        y: qrY + 36,
        size: 6.5,
        font: fontBold,
        color: rgb(0.02, 0.35, 0.25)
      });
      page.drawText('Pindai untuk memeriksa keabsahan', {
        x: qrX + qrSize + 6,
        y: qrY + 26,
        size: 5.5,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4)
      });
      page.drawText('STATUS: RESMI TERDAFTAR', {
        x: qrX + qrSize + 6,
        y: qrY + 16,
        size: 6,
        font: fontBold,
        color: rgb(0.02, 0.35, 0.25)
      });
    } catch (e) {
      console.warn('QR code print error:', e.message);
    }
  }

  return await doc.save();
}

module.exports = { generateCertificatePdf };
