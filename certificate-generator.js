const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { generateCertId } = require('./cert-crypto');

/**
 * Helper untuk normalisasi rasio vertikal Y (0.05 - 0.95 dari bawah halaman).
 * Mencegah error jika user memasukkan persentase (misal 50 atau 72) atau koma.
 */
function parseYRatio(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'string') val = parseFloat(val.replace(',', '.'));
  if (isNaN(val)) return fallback;
  if (val > 1) val = val / 100; // Konversi 50 -> 0.50
  return Math.max(0.05, Math.min(0.95, val));
}

/**
 * Menghasilkan file PDF E-Sertifikat dengan menempatkan Nomor Surat & Nama Pegawai
 * secara otomatis di atas template yang diunggah (Foto PNG/JPG atau Dokumen PDF).
 */
async function generateCertificatePdf({
  templatePath,
  certNumber = '800.1.3/SERT-LPTI/2026/001',
  certId = '',
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
  nomorYRatio = 0.72,
  namaYRatio = 0.50,
  namaFontSize = 26,
  nomorFontSize = 11,
  showUnderline = true,
  showQr = true
}) {
  let doc;
  let page;
  let isCustomTemplate = false;

  let templateBytes = null;
  let ext = '';

  if (templatePath) {
    if (templatePath.startsWith('http://') || templatePath.startsWith('https://')) {
      try {
        const resp = await fetch(templatePath);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          templateBytes = Buffer.from(ab);
          const cleanUrl = templatePath.split('?')[0];
          ext = path.extname(cleanUrl).toLowerCase();
        }
      } catch (fErr) {
        console.warn('Gagal mengunduh template dari Cloud Storage:', fErr.message);
      }
    } else if (fs.existsSync(templatePath)) {
      try {
        templateBytes = fs.readFileSync(templatePath);
        ext = path.extname(templatePath).toLowerCase();
      } catch (rErr) {
        console.warn('Gagal membaca template lokal:', rErr.message);
      }
    }
  }

  // KONDISI 1: Template adalah Dokumen PDF
  if (templateBytes && ext === '.pdf') {
    try {
      doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
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
  else if (templateBytes && ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    try {
      doc = await PDFDocument.create();

      let image = null;
      if (ext === '.png') {
        try {
          image = await doc.embedPng(templateBytes);
        } catch (ePng) {
          image = await doc.embedJpg(templateBytes);
        }
      } else {
        try {
          image = await doc.embedJpg(templateBytes);
        } catch (eJpg) {
          image = await doc.embedPng(templateBytes);
        }
      }

      if (image) {
        // Ukuran halaman mengikuti proporsi gambar asli (standar A4 Landscape: 841.89 pt lebar)
        const imgWidth = image.width;
        const imgHeight = image.height;
        const pageRatio = imgWidth / imgHeight;

        const pageWidth = 841.89;
        const pageHeight = pageWidth / pageRatio;

        page = doc.addPage([pageWidth, pageHeight]);

        page.drawImage(image, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight
        });

        isCustomTemplate = true;
      }
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

  const safeNomorYRatio = parseYRatio(nomorYRatio, 0.72);
  const safeNamaYRatio = parseYRatio(namaYRatio, 0.50);

  // ========================================================
  // 1. DYNAMIC FIELD 1: NOMOR SURAT / NOMOR SERTIFIKAT
  // ========================================================
  const cleanNumber = String(certNumber || '').trim();
  const noText = cleanNumber.toLowerCase().startsWith('nomor') ? cleanNumber : `Nomor: ${cleanNumber}`;
  const noSize = Math.max(8, Math.min(24, Number(nomorFontSize) || 11));
  const noWidth = fontRegular.widthOfTextAtSize(noText, noSize);
  const noX = (width - noWidth) / 2;
  const noY = height * safeNomorYRatio;

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
  const baseSize = Math.max(14, Math.min(48, Number(namaFontSize) || 26));
  const calculatedNameSize = safeName.length > 34 ? Math.max(18, baseSize - 4) : baseSize;
  const nameWidth = fontBold.widthOfTextAtSize(safeName, calculatedNameSize);
  const nameX = (width - nameWidth) / 2;
  const nameY = height * safeNamaYRatio;

  page.drawText(safeName, {
    x: nameX,
    y: nameY,
    size: calculatedNameSize,
    font: fontBold,
    color: rgb(0.04, 0.12, 0.18)
  });

  // Garis bawah elegan untuk Nama Pegawai (bisa diaktifkan/dinonaktifkan)
  if (showUnderline !== false) {
    page.drawLine({
      start: { x: Math.max(80, nameX - 12), y: nameY - 6 },
      end: { x: Math.min(width - 80, nameX + nameWidth + 12), y: nameY - 6 },
      thickness: 1,
      color: rgb(0.65, 0.65, 0.65)
    });
  }

  // ========================================================
  // 3. OPTIONAL: IDENTITAS NIP & JABATAN
  // ========================================================
  if (employeeNip) {
    const nipLine = `NIP. ${employeeNip}${employeeJabatan ? ' • ' + employeeJabatan : ''}`;
    const nipSize = 9.5;
    const nipWidth = fontRegular.widthOfTextAtSize(nipLine, nipSize);
    page.drawText(nipLine, {
      x: (width - nipWidth) / 2,
      y: nameY - 20,
      size: nipSize,
      font: fontRegular,
      color: rgb(0.35, 0.38, 0.42)
    });
  }

  // ========================================================
  // 4. QR CODE KEABSAHAN (DI KANAN BAWAH / BOTTOM RIGHT)
  // Dilengkapi Kredensial Kriptografis ECDSA & ID Unik Instansi
  // ========================================================
  if (showQr) {
    try {
      const displayCertId = certId || generateCertId(cleanNumber, employeeNip);
      const targetVerifyUrl = verifyUrl || `https://bpmp-senin-berseri.vercel.app/sertifikat/${displayCertId}`;

      const qrDataUrl = await QRCode.toDataURL(targetVerifyUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 250,
        color: { dark: '#0c233c', light: '#ffffff' }
      });
      const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
      const qrImage = await doc.embedPng(qrImageBytes);

      // Posisi di Pojok Kanan Bawah
      const qrSize = 65;
      const boxWidth = qrSize + 18;
      const boxHeight = qrSize + 34;
      const qrX = width - qrSize - 40;
      const qrY = 32;

      // Kotak Latar Belakang Putih Berbingkai Elegan (Agar QR selalu terbaca jelas di template apapun)
      page.drawRectangle({
        x: qrX - 9,
        y: qrY - 14,
        width: boxWidth,
        height: boxHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.82, 0.86, 0.90),
        borderWidth: 1
      });

      // Teks Header QR
      const headerTitle = 'VERIFIKASI KEABSAHAN';
      const headerSub = 'Pindai untuk validasi';
      page.drawText(headerTitle, {
        x: qrX - 5,
        y: qrY + qrSize + 8,
        size: 5.5,
        font: fontBold,
        color: rgb(0.10, 0.23, 0.36)
      });
      page.drawText(headerSub, {
        x: qrX - 5,
        y: qrY + qrSize + 1,
        size: 4.8,
        font: fontRegular,
        color: rgb(0.45, 0.50, 0.55)
      });

      // Gambar QR Code
      page.drawImage(qrImage, {
        x: qrX,
        y: qrY - 3,
        width: qrSize,
        height: qrSize
      });

      // Teks Kode ID Kriptografis di bawah QR (Dicoding Style)
      const idText = `ID: ${displayCertId}`;
      const idWidth = fontBold.widthOfTextAtSize(idText, 5.8);
      page.drawText(idText, {
        x: qrX + (qrSize - idWidth) / 2,
        y: qrY - 10,
        size: 5.8,
        font: fontBold,
        color: rgb(0.10, 0.23, 0.36)
      });
    } catch (e) {
      console.warn('QR code print error:', e.message);
    }
  }

  return await doc.save();
}

module.exports = { generateCertificatePdf };
