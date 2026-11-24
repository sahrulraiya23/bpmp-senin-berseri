const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getProductionBaseUrl } = require('../cert-crypto');

// Dimensi Standar A4 Landscape (Point: 72 dpi)
const PAGE_WIDTH = 841.89; // 297 mm
const PAGE_HEIGHT = 595.28; // 210 mm

// Helper Warna RGB Desain Resmi BPMP & Kemendikdasmen
const COLORS = {
  navy: rgb(0.047, 0.137, 0.235),      // #0c233c
  royalBlue: rgb(0.102, 0.227, 0.361), // #1a3a5c
  gold: rgb(0.812, 0.655, 0.259),      // #cf9742
  lightGold: rgb(0.961, 0.925, 0.843), // #f5ecd7
  emerald: rgb(0.082, 0.506, 0.373),   // #15815f
  emeraldDark: rgb(0.035, 0.329, 0.235), // #09543c
  maroon: rgb(0.490, 0.114, 0.180),    // #7d1d2e
  maroonDark: rgb(0.333, 0.059, 0.110), // #550f1c
  charcoal: rgb(0.133, 0.165, 0.200),  // #222a33
  slate: rgb(0.333, 0.384, 0.443),     // #556271
  grayLight: rgb(0.941, 0.949, 0.961), // #f0f2f5
  white: rgb(1, 1, 1),
  overlayBorder: rgb(0.85, 0.15, 0.15),
  overlayFill: rgb(1, 0.9, 0.9)
};

/**
 * 4 PRESET TEMPLATE SERTIFIKAT TERKUNCI (A, B, C, D)
 * Masing-masing memiliki palet warna, tipografi, dan koordinat zona teks tetap.
 */
const PRESET_TEMPLATES = {
  'A': {
    id: 'preset-a',
    nama: 'Preset A - Kemendikdasmen Classic Blue & Gold',
    theme: 'classic-blue-gold',
    defaultQrPosition: 'kanan',
    primaryColor: COLORS.royalBlue,
    accentColor: COLORS.gold,
    textColor: COLORS.charcoal,
    subTextColor: COLORS.slate,
    defaultPejabat: {
      nama: 'Junaiddin Pagala, S.T., M.T.',
      nip: '197606122002121004',
      jabatan: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      instansi: 'Kementerian Pendidikan Dasar dan Menengah'
    },
    patternIsi: 'Sebagai Peserta dalam Pengembangan Kompetensi ASN "Senin Berseri" dengan tema "{judul}" yang diselenggarakan oleh {lokasi_instansi} pada tanggal {tanggal} dengan bobot pembelajaran setara {jp} Jam Pelajaran (JP).'
  },
  'B': {
    id: 'preset-b',
    nama: 'Preset B - Modern Emerald BPMP Sultra',
    theme: 'modern-emerald',
    defaultQrPosition: 'kiri',
    primaryColor: COLORS.emerald,
    accentColor: COLORS.gold,
    textColor: COLORS.charcoal,
    subTextColor: COLORS.slate,
    defaultPejabat: {
      nama: 'Junaiddin Pagala, S.T., M.T.',
      nip: '197606122002121004',
      jabatan: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      instansi: 'BPMP Provinsi Sulawesi Tenggara'
    },
    patternIsi: 'Telah berhasil menyelesaikan Pengembangan Kompetensi ASN Senin Berseri bertajuk "{judul}" bertempat di {lokasi_instansi} pada tanggal {tanggal} dengan pemenuhan standar kompetensi setara {jp} JP.'
  },
  'C': {
    id: 'preset-c',
    nama: 'Preset C - Minimalist Clean Corporate',
    theme: 'minimal-clean',
    defaultQrPosition: 'kanan',
    primaryColor: COLORS.navy,
    accentColor: COLORS.slate,
    textColor: COLORS.charcoal,
    subTextColor: COLORS.slate,
    defaultPejabat: {
      nama: 'Junaiddin Pagala, S.T., M.T.',
      nip: '197606122002121004',
      jabatan: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      instansi: 'BPMP Provinsi Sulawesi Tenggara'
    },
    patternIsi: 'Atas partisipasi aktif dalam kegiatan Pengembangan Kompetensi ASN Senin Berseri dengan tema "{judul}" di {lokasi_instansi} pada {tanggal} selama {jp} Jam Pelajaran (JP).'
  },
  'D': {
    id: 'preset-d',
    nama: 'Preset D - Elegant Royal Maroon & Bronze',
    theme: 'royal-maroon',
    defaultQrPosition: 'kiri',
    primaryColor: COLORS.maroon,
    accentColor: COLORS.gold,
    textColor: COLORS.charcoal,
    subTextColor: COLORS.slate,
    defaultPejabat: {
      nama: 'Junaiddin Pagala, S.T., M.T.',
      nip: '197606122002121004',
      jabatan: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      instansi: 'BPMP Provinsi Sulawesi Tenggara'
    },
    patternIsi: 'Telah mengikuti dan menyelesaikan seluruh rangkaian Pengembangan Kompetensi ASN Senin Berseri dengan topik "{judul}" bertempat di {lokasi_instansi} tanggal {tanggal} dengan total bobot {jp} JP.'
  }
};

/**
 * Konfigurasi Zona Tata Letak Terkunci (Locked Grid Layout)
 * Satuan dalam Point (A4 Landscape: 841.89 x 595.28)
 */
function getLockedLayoutConfig(qrPosition = 'kanan') {
  const isQrLeft = qrPosition === 'kiri';
  return {
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    qrPosition: isQrLeft ? 'kiri' : 'kanan',
    zones: {
      header: {
        y: 535,
        title: 'SERTIFIKAT PENGEMBANGAN KOMPETENSI',
        subTitle: 'SENIN BERSERI (BERBAGI PRAKTIK BAIK & SPIRIT INTEGRITAS)'
      },
      nomor: {
        x: 100,
        y: 458,
        width: 641.89,
        label: 'NOMOR SERTIFIKAT'
      },
      recipientPrompt: {
        y: 418,
        text: 'Diberikan Kepada:'
      },
      nama: {
        x: 80,
        y: 382,
        width: 681.89,
        maxHeight: 46,
        maxLines: 2,
        baseFontSize: 28,
        minFontSize: 16,
        label: 'ZONA NAMA PEGAWAI & GELAR'
      },
      nipJabatan: {
        x: 80,
        y: 345,
        width: 681.89,
        fontSize: 11,
        label: 'ZONA NIP & JABATAN / UNIT KERJA'
      },
      isiParagraf: {
        x: 100,
        y: 308,
        width: 641.89,
        lineHeight: 18,
        maxLines: 4,
        baseFontSize: 11.5,
        minFontSize: 9.5,
        label: 'ZONA PARAGRAF ISI KEGIATAN'
      },
      // Posisi Bawah Terkunci: QR Code & TTD Pejabat
      // Ukuran QR: 75x75 pt (~26.5 x 26.5 mm, memenuhi syarat min 25x25 mm)
      qr: isQrLeft
        ? { x: 95, y: 80, size: 75, label: 'ZONA QR VERIFIKASI (KIRI)' }
        : { x: 671.89, y: 80, size: 75, label: 'ZONA QR VERIFIKASI (KANAN)' },
      qrText: isQrLeft
        ? { x: 95, y: 68, width: 75, fontSize: 6.5, label: 'Keterangan QR' }
        : { x: 671.89, y: 68, width: 75, fontSize: 6.5, label: 'Keterangan QR' },
      ttd: isQrLeft
        ? { x: 520, y: 78, width: 240, label: 'ZONA TTD & STEMPEL (KANAN)' }
        : { x: 100, y: 78, width: 240, label: 'ZONA TTD & STEMPEL (KIRI)' }
    }
  };
}

/**
 * Format Tanggal Indonesia
 * Contoh: "22 April 2026" atau Rentang "18 - 20 November 2026"
 */
const BULAN_INDO = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function formatTanggalIndonesia(dateInput, endDateInput = null) {
  if (!dateInput) return 'Tahun 2026';
  
  // Jika input sudah berformat string teks seperti "18 - 20 November 2026"
  if (typeof dateInput === 'string' && dateInput.includes('-') && isNaN(Date.parse(dateInput))) {
    return dateInput;
  }

  const d1 = new Date(dateInput);
  if (isNaN(d1.getTime())) return String(dateInput);

  if (endDateInput) {
    const d2 = new Date(endDateInput);
    if (!isNaN(d2.getTime())) {
      if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) {
        if (d1.getDate() === d2.getDate()) {
          return `${d1.getDate()} ${BULAN_INDO[d1.getMonth()]} ${d1.getFullYear()}`;
        }
        return `${d1.getDate()} - ${d2.getDate()} ${BULAN_INDO[d1.getMonth()]} ${d1.getFullYear()}`;
      }
      return `${d1.getDate()} ${BULAN_INDO[d1.getMonth()]} - ${d2.getDate()} ${BULAN_INDO[d2.getMonth()]} ${d2.getFullYear()}`;
    }
  }

  return `${d1.getDate()} ${BULAN_INDO[d1.getMonth()]} ${d1.getFullYear()}`;
}

/**
 * Pemecah baris teks otomatis (Word-Wrap) sesuai batas lebar tertentu
 */
function wrapText(text, maxWidth, font, fontSize) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Kalkulasi ukuran font otomatis (Auto-Scaling) agar teks muat dalam lebar dan baris maksimal
 */
function fitText(text, maxWidth, maxLines, font, baseSize, minSize) {
  let size = baseSize;
  while (size >= minSize) {
    const lines = wrapText(text, maxWidth, font, size);
    if (lines.length <= maxLines) {
      return { size, lines };
    }
    size -= 1;
  }
  // Fallback ke minSize dan potong baris jika masih melebihi
  const finalLines = wrapText(text, maxWidth, font, minSize);
  return { size: minSize, lines: finalLines.slice(0, maxLines) };
}

/**
 * Generator PDF Panduan Zona (Overlay Grid PDF) untuk Desainer
 * Memvisualisasikan kotak-kotak zona yang tidak boleh tertutup oleh ornamen latar.
 */
async function generateZoneOverlayPdf(presetKey = 'A', qrPosition = 'kanan') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const layout = getLockedLayoutConfig(qrPosition);
  const zones = layout.zones;

  // Latar belakang putih dengan grid tipis
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: rgb(0.98, 0.98, 0.99)
  });

  // Border luar halaman A4
  page.drawRectangle({
    x: 20,
    y: 20,
    width: PAGE_WIDTH - 40,
    height: PAGE_HEIGHT - 40,
    borderColor: rgb(0.7, 0.75, 0.8),
    borderWidth: 1
  });

  // Header Panduan Overlay
  const guideTitle = `PANDUAN TEMPLATE E-SERTIFIKAT (ZONA TERKUNCI A4 LANDSCAPE - 297 x 210 mm)`;
  page.drawText(guideTitle, {
    x: 40,
    y: PAGE_HEIGHT - 35,
    size: 11,
    font: fontBold,
    color: COLORS.royalBlue
  });

  page.drawText(`Posisi QR: ${qrPosition.toUpperCase()} | Simpan desain latar Anda tanpa teks dinamis di area kotak bertanda merah di bawah.`, {
    x: 40,
    y: PAGE_HEIGHT - 48,
    size: 8.5,
    font: fontRegular,
    color: COLORS.slate
  });

  // Fungsi helper gambar zona transparan bergaris merah
  const drawGuideZone = (x, y, w, h, label, note = '') => {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(1, 0.92, 0.92),
      opacity: 0.65,
      borderColor: rgb(0.85, 0.2, 0.2),
      borderWidth: 1.2
    });
    page.drawText(label, {
      x: x + 8,
      y: y + h - 14,
      size: 9,
      font: fontBold,
      color: rgb(0.75, 0.1, 0.1)
    });
    if (note) {
      page.drawText(note, {
        x: x + 8,
        y: y + 8,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4)
      });
    }
  };

  // 1. Zona Judul & Kop
  drawGuideZone(80, 485, 681.89, 50, 'ZONA HEADER / KOP SERTIFIKAT', 'Judul: Sertifikat Pengembangan Kompetensi Senin Berseri');

  // 2. Zona Nomor Surat
  drawGuideZone(zones.nomor.x, zones.nomor.y - 12, zones.nomor.width, 28, 'ZONA NOMOR SERTIFIKAT', 'Format: 0031/C6.26/Sertifikat/KP.04.00/2026 (Tengah)');

  // 3. Zona Nama & Gelar Pegawai
  drawGuideZone(zones.nama.x, zones.nama.y - 25, zones.nama.width, zones.nama.maxHeight + 20, 'ZONA NAMA PEGAWAI & GELAR (AUTO-SCALING & WRAP)', 'Maksimal 2 baris, rata tengah. Kosongkan ornamen ramai di area ini.');

  // 4. Zona NIP & Jabatan
  drawGuideZone(zones.nipJabatan.x, zones.nipJabatan.y - 15, zones.nipJabatan.width, 24, 'ZONA NIP & UNIT KERJA / JABATAN', 'NIP: 19850315... | Subbagian Tata Usaha & Kepegawaian');

  // 5. Zona Paragraf Isi
  drawGuideZone(zones.isiParagraf.x, zones.isiParagraf.y - 50, zones.isiParagraf.width, 68, 'ZONA PARAGRAF ISI / DESKRIPSI KEGIATAN', 'Isi otomatis terisi tema, tanggal pelaksanaan, dan JP.');

  // 6. Zona QR Verifikasi (Min 25 x 25 mm = 71 pt)
  drawGuideZone(zones.qr.x, zones.qr.y, zones.qr.size, zones.qr.size, 'QR CODE', 'Min 25x25mm');
  drawGuideZone(zones.qrText.x, zones.qrText.y, zones.qrText.width, 10, 'TEKS QR', 'Verifikasi');

  // 7. Zona TTD & Stempel
  drawGuideZone(zones.ttd.x, zones.ttd.y, zones.ttd.width, 90, 'ZONA TTD, STEMPEL & PEJABAT', 'Stempel PNG transparan digambar di latar belakang teks.');

  return await doc.save();
}

/**
 * Generator Gambar Bingkai Vektor Mewah untuk Template Preset Bawaan
 * Digunakan jika pengguna memilih preset tanpa mengunggah file latar custom.
 */
function drawVectorPresetFrame(page, preset) {
  const primary = preset.primaryColor || COLORS.royalBlue;
  const accent = preset.accentColor || COLORS.gold;

  // Latar Belakang Kartu
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    color: COLORS.white
  });

  // Border Ganda Elegan
  page.drawRectangle({
    x: 18,
    y: 18,
    width: PAGE_WIDTH - 36,
    height: PAGE_HEIGHT - 36,
    borderColor: primary,
    borderWidth: 2
  });

  page.drawRectangle({
    x: 24,
    y: 24,
    width: PAGE_WIDTH - 48,
    height: PAGE_HEIGHT - 48,
    borderColor: accent,
    borderWidth: 1
  });

  // Aksen Sudut Geometris
  const cornerSize = 40;
  const corners = [
    { x: 24, y: PAGE_HEIGHT - 24 - cornerSize }, // Kiri Atas
    { x: PAGE_WIDTH - 24 - cornerSize, y: PAGE_HEIGHT - 24 - cornerSize }, // Kanan Atas
    { x: 24, y: 24 }, // Kiri Bawah
    { x: PAGE_WIDTH - 24 - cornerSize, y: 24 } // Kanan Bawah
  ];

  for (const c of corners) {
    page.drawRectangle({
      x: c.x,
      y: c.y,
      width: cornerSize,
      height: cornerSize,
      borderColor: accent,
      borderWidth: 0.5,
      color: COLORS.lightGold,
      opacity: 0.25
    });
  }

  // Pita Aksen Atas & Bawah
  page.drawRectangle({
    x: 120,
    y: PAGE_HEIGHT - 24,
    width: PAGE_WIDTH - 240,
    height: 4,
    color: primary
  });

  page.drawRectangle({
    x: 120,
    y: 20,
    width: PAGE_WIDTH - 240,
    height: 4,
    color: primary
  });
}

/**
 * Helper: Menyematkan Gambar (PNG / JPG) secara aman ke Dokumen PDF
 */
async function embedImageSafe(doc, imagePathOrBuffer) {
  if (!imagePathOrBuffer) return null;
  try {
    let buf = imagePathOrBuffer;
    if (typeof imagePathOrBuffer === 'string') {
      if (!fs.existsSync(imagePathOrBuffer)) return null;
      buf = fs.readFileSync(imagePathOrBuffer);
    }
    // Coba PNG terlebih dahulu
    try {
      return await doc.embedPng(buf);
    } catch (ePng) {
      return await doc.embedJpg(buf);
    }
  } catch (err) {
    console.warn('[Certificate Service] Gagal menyematkan gambar:', err.message);
    return null;
  }
}

/**
 * GENERATOR UTAMA E-SERTIFIKAT
 * Menerima { template, data, token, baseUrl } dan menghasilkan Buffer PDF.
 */
async function generateCertificatePdf({ template = {}, data = {}, token = '', baseUrl = 'https://bpmp-senin-berseri.vercel.app' }) {
  let doc;
  let page;
  let hasBackgroundCustom = false;

  const presetKey = (template.presetKey || 'A').toUpperCase();
  const presetConfig = PRESET_TEMPLATES[presetKey] || PRESET_TEMPLATES['A'];

  // Posisi QR ditentukan oleh template (default: dari template atau preset)
  const qrPosition = template.qrPosition || presetConfig.defaultQrPosition || 'kanan';
  const layout = getLockedLayoutConfig(qrPosition);
  const zones = layout.zones;

  // 1. Cek apakah ada file latar kustom (PDF atau Gambar)
  let backgroundBytes = null;
  let bgExt = '';

  if (template.file_latar || template.filePath) {
    const rawPath = template.file_latar || template.filePath;
    if (typeof rawPath === 'string') {
      if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
        try {
          const resp = await fetch(rawPath);
          if (resp.ok) {
            backgroundBytes = Buffer.from(await resp.arrayBuffer());
            bgExt = path.extname(rawPath.split('?')[0]).toLowerCase();
          }
        } catch (e) {
          console.warn('[Certificate Service] Gagal unduh latar dari remote URL:', e.message);
        }
      } else if (fs.existsSync(rawPath)) {
        try {
          backgroundBytes = fs.readFileSync(rawPath);
          bgExt = path.extname(rawPath).toLowerCase();
        } catch (e) {
          console.warn('[Certificate Service] Gagal membaca berkas latar lokal:', e.message);
        }
      }
    } else if (Buffer.isBuffer(rawPath)) {
      backgroundBytes = rawPath;
      bgExt = template.fileExt || '.png';
    }
  }

  // Jika latar berupa PDF
  if (backgroundBytes && bgExt === '.pdf') {
    try {
      doc = await PDFDocument.load(backgroundBytes, { ignoreEncryption: true });
      const pages = doc.getPages();
      if (pages.length > 0) {
        page = pages[0];
        hasBackgroundCustom = true;
      }
    } catch (err) {
      console.warn('[Certificate Service] Gagal muat latar PDF, beralih ke vektor preset:', err.message);
    }
  }

  // Jika belum ada doc (latar gambar atau tidak ada latar kustom)
  if (!doc) {
    doc = await PDFDocument.create();
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    if (backgroundBytes && ['.png', '.jpg', '.jpeg', '.webp'].includes(bgExt)) {
      try {
        let bgImg = null;
        try {
          bgImg = await doc.embedPng(backgroundBytes);
        } catch (e) {
          bgImg = await doc.embedJpg(backgroundBytes);
        }
        if (bgImg) {
          page.drawImage(bgImg, {
            x: 0,
            y: 0,
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT
          });
          hasBackgroundCustom = true;
        }
      } catch (eImg) {
        console.warn('[Certificate Service] Gagal embed gambar latar:', eImg.message);
      }
    }

    // Jika tidak menggunakan background custom, gambar bingkai vektor preset
    if (!hasBackgroundCustom) {
      drawVectorPresetFrame(page, presetConfig);
    }
  }

  // 2. Muat Font Standar PDF-Lib (Times / Helvetica)
  const fontTitle = await doc.embedFont(StandardFonts.TimesRomanBold);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const primaryCol = presetConfig.primaryColor || COLORS.royalBlue;
  const accentCol = presetConfig.accentColor || COLORS.gold;
  const textCol = presetConfig.textColor || COLORS.charcoal;
  const subTextCol = presetConfig.subTextColor || COLORS.slate;

  // 3. Render Header (Hanya digambar jika tidak ada background custom, atau jika template memintanya)
  if (!hasBackgroundCustom) {
    const kopText1 = 'KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH';
    const kopText2 = 'BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA';
    const wKop1 = fontBold.widthOfTextAtSize(kopText1, 11);
    const wKop2 = fontRegular.widthOfTextAtSize(kopText2, 9.5);

    page.drawText(kopText1, {
      x: (PAGE_WIDTH - wKop1) / 2,
      y: 540,
      size: 11,
      font: fontBold,
      color: primaryCol
    });
    page.drawText(kopText2, {
      x: (PAGE_WIDTH - wKop2) / 2,
      y: 526,
      size: 9.5,
      font: fontRegular,
      color: subTextCol
    });

    // Garis Pemisah Kop
    page.drawLine({
      start: { x: 180, y: 518 },
      end: { x: PAGE_WIDTH - 180, y: 518 },
      thickness: 1,
      color: accentCol
    });

    const certTitle = zones.header.title;
    const certSubtitle = zones.header.subTitle;
    const wTitle = fontTitle.widthOfTextAtSize(certTitle, 22);
    const wSubtitle = fontBold.widthOfTextAtSize(certSubtitle, 10.5);

    page.drawText(certTitle, {
      x: (PAGE_WIDTH - wTitle) / 2,
      y: 486,
      size: 22,
      font: fontTitle,
      color: primaryCol
    });

    page.drawText(certSubtitle, {
      x: (PAGE_WIDTH - wSubtitle) / 2,
      y: 472,
      size: 10.5,
      font: fontBold,
      color: accentCol
    });
  }

  // 4. Nomor Sertifikat (Rata Tengah Terkunci)
  const certNumber = data.nomor || data.certNumber || '0001/C6.26/Sertifikat/KP.04.00/2026';
  const nomorText = `Nomor: ${certNumber}`;
  const wNomor = fontRegular.widthOfTextAtSize(nomorText, 11);
  page.drawText(nomorText, {
    x: (PAGE_WIDTH - wNomor) / 2,
    y: zones.nomor.y,
    size: 11,
    font: fontRegular,
    color: textCol
  });

  // Teks Pengantar: "Diberikan Kepada:"
  const promptText = zones.recipientPrompt.text;
  const wPrompt = fontRegular.widthOfTextAtSize(promptText, 12);
  page.drawText(promptText, {
    x: (PAGE_WIDTH - wPrompt) / 2,
    y: zones.recipientPrompt.y,
    size: 12,
    font: fontRegular,
    color: subTextCol
  });

  // 5. Nama Pegawai & Gelar (Auto-Scale & Auto-Wrap Terkunci)
  const rawNama = data.nama || data.employeeName || 'Nama Pegawai Lengkap, S.Pd., M.Pd.';
  const namaFit = fitText(
    rawNama,
    zones.nama.width,
    zones.nama.maxLines,
    fontBold,
    zones.nama.baseFontSize,
    zones.nama.minFontSize
  );

  let currentNamaY = zones.nama.y;
  for (let i = 0; i < namaFit.lines.length; i++) {
    const line = namaFit.lines[i];
    const wLine = fontBold.widthOfTextAtSize(line, namaFit.size);
    page.drawText(line, {
      x: (PAGE_WIDTH - wLine) / 2,
      y: currentNamaY,
      size: namaFit.size,
      font: fontBold,
      color: primaryCol
    });

    // Garis Bawah Nama pada baris terakhir
    if (i === namaFit.lines.length - 1) {
      const underlineY = currentNamaY - 4;
      page.drawLine({
        start: { x: (PAGE_WIDTH - wLine) / 2 - 8, y: underlineY },
        end: { x: (PAGE_WIDTH + wLine) / 2 + 8, y: underlineY },
        thickness: 1.2,
        color: accentCol
      });
    }
    currentNamaY -= (namaFit.size + 4);
  }

  // 6. NIP & Jabatan / Unit Kerja
  const nip = data.nip || data.employeeNip || '-';
  const jabatan = data.jabatan || data.employeeJabatan || 'Aparatur Sipil Negara';
  const instansi = data.instansi || data.employeeInstansi || 'BPMP Provinsi Sulawesi Tenggara';
  const nipJabatanText = `NIP. ${nip}  •  ${jabatan}  •  ${instansi}`;
  const wNipJabatan = fontRegular.widthOfTextAtSize(nipJabatanText, zones.nipJabatan.fontSize);
  page.drawText(nipJabatanText, {
    x: (PAGE_WIDTH - wNipJabatan) / 2,
    y: currentNamaY - 8,
    size: zones.nipJabatan.fontSize,
    font: fontRegular,
    color: subTextCol
  });

  // 7. Paragraf Isi Kegiatan (Auto-Wrapping)
  const judul = data.judul || data.eventTitle || 'Transformasi Digital dan Tata Kelola ASN';
  const tanggal = formatTanggalIndonesia(data.tanggal || data.eventSchedule);
  const jp = data.jp || data.eventJp || 4;
  const lokasiInstansi = data.lokasi || data.eventLocation || 'BPMP Provinsi Sulawesi Tenggara';

  const pattern = template.patternIsi || presetConfig.patternIsi;
  const fullParagraph = pattern
    .replace('{judul}', judul)
    .replace('{tanggal}', tanggal)
    .replace('{jp}', jp)
    .replace('{lokasi_instansi}', lokasiInstansi);

  const paraFit = fitText(
    fullParagraph,
    zones.isiParagraf.width,
    zones.isiParagraf.maxLines,
    fontRegular,
    zones.isiParagraf.baseFontSize,
    zones.isiParagraf.minFontSize
  );

  let curParaY = currentNamaY - 34;
  for (const pLine of paraFit.lines) {
    const wP = fontRegular.widthOfTextAtSize(pLine, paraFit.size);
    page.drawText(pLine, {
      x: (PAGE_WIDTH - wP) / 2,
      y: curParaY,
      size: paraFit.size,
      font: fontRegular,
      color: textCol
    });
    curParaY -= zones.isiParagraf.lineHeight;
  }

  // 8. QR Code Verifikasi (Ukuran terkunci 75x75 pt, URL: {BASE_URL}/sertifikat/{id})
  const verificationId = data.certId || data.id || token || data.token || crypto.randomBytes(16).toString('hex');
  const verificationToken = verificationId;
  const targetBaseUrl = (baseUrl && !baseUrl.includes('vercel.app/preview') && !baseUrl.includes('-git-')) ? baseUrl.replace(/\/$/, '') : getProductionBaseUrl();
  const verifyUrl = `${targetBaseUrl}/sertifikat/${verificationId}`;

  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 250,
    color: { dark: '#0c233c', light: '#ffffff' }
  });

  const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  const qrImage = await doc.embedPng(qrImageBytes);

  page.drawImage(qrImage, {
    x: zones.qr.x,
    y: zones.qr.y,
    width: zones.qr.size,
    height: zones.qr.size
  });

  // Teks Keterangan di bawah QR Code
  const qrSub1 = 'Pindai QR Code';
  const qrSub2 = 'Verifikasi Keaslian';
  const wQr1 = fontRegular.widthOfTextAtSize(qrSub1, zones.qrText.fontSize);
  const wQr2 = fontRegular.widthOfTextAtSize(qrSub2, zones.qrText.fontSize);

  page.drawText(qrSub1, {
    x: zones.qr.x + (zones.qr.size - wQr1) / 2,
    y: zones.qrText.y,
    size: zones.qrText.fontSize,
    font: fontRegular,
    color: subTextCol
  });
  page.drawText(qrSub2, {
    x: zones.qr.x + (zones.qr.size - wQr2) / 2,
    y: zones.qrText.y - 7,
    size: zones.qrText.fontSize,
    font: fontRegular,
    color: subTextCol
  });

  // 9. Tanda Tangan & Stempel Resmi Pejabat (Digambar di belakang teks)
  const ttdZone = zones.ttd;
  const ttdX = ttdZone.x;
  const ttdY = ttdZone.y;
  const tanggalTerbit = formatTanggalIndonesia(data.issuedAt || new Date());
  const pejabat = template.pejabat || presetConfig.defaultPejabat;

  // Stempel Digital Transparan (Digambar sebelum teks nama agar teks tetap di depan)
  if (template.stempelPath) {
    const stempelImg = await embedImageSafe(doc, template.stempelPath);
    if (stempelImg) {
      page.drawImage(stempelImg, {
        x: ttdX - 25,
        y: ttdY - 15,
        width: 85,
        height: 85,
        opacity: 0.85
      });
    }
  }

  // Tanda Tangan Digital Transparan (Digambar sebelum teks nama)
  if (template.tandaTanganPath) {
    const ttdImg = await embedImageSafe(doc, template.tandaTanganPath);
    if (ttdImg) {
      page.drawImage(ttdImg, {
        x: ttdX + 20,
        y: ttdY + 8,
        width: 110,
        height: 55,
        opacity: 0.95
      });
    }
  }

  // Teks Pejabat (Selalu berada di layer paling atas / foreground)
  const line1 = `Kendari, ${tanggalTerbit}`;
  const line2 = pejabat.jabatan || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra';
  const lineNamaPejabat = pejabat.nama || 'Junaiddin Pagala, S.T., M.T.';
  const lineNipPejabat = `NIP. ${pejabat.nip || '197606122002121004'}`;

  page.drawText(line1, {
    x: ttdX,
    y: ttdY + 70,
    size: 10,
    font: fontRegular,
    color: textCol
  });

  page.drawText(line2, {
    x: ttdX,
    y: ttdY + 58,
    size: 9.5,
    font: fontBold,
    color: textCol
  });

  page.drawText(lineNamaPejabat, {
    x: ttdX,
    y: ttdY + 10,
    size: 10.5,
    font: fontBold,
    color: primaryCol
  });

  const wPejabat = fontBold.widthOfTextAtSize(lineNamaPejabat, 10.5);
  page.drawLine({
    start: { x: ttdX, y: ttdY + 8 },
    end: { x: ttdX + wPejabat, y: ttdY + 8 },
    thickness: 1,
    color: textCol
  });

  page.drawText(lineNipPejabat, {
    x: ttdX,
    y: ttdY - 4,
    size: 9,
    font: fontRegular,
    color: subTextCol
  });

  const pdfBytes = await doc.save();
  return {
    pdfBuffer: Buffer.from(pdfBytes),
    token: verificationToken,
    verifyUrl: verifyUrl,
    nomor: certNumber
  };
}

module.exports = {
  PRESET_TEMPLATES,
  getLockedLayoutConfig,
  formatTanggalIndonesia,
  wrapText,
  fitText,
  generateZoneOverlayPdf,
  generateCertificatePdf
};
