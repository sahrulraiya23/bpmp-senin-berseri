const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Path Setup
const DB_PATH = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads', 'lpti');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Pastikan folder uploads/lpti tersedia
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Static File Serving
app.use('/uploads/lpti', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

// Helper: Membaca & Menulis db.json
function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err.message);
    return { event: {}, employees: [], system: { certPrefix: "800.1.3/SERT-LPTI/2026", certCounter: 1 } };
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing db.json:', err.message);
    return false;
  }
}

// Konfigurasi Multer untuk Upload PDF Asli LPTI
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `LPTI-${uniqueSuffix}-${cleanOriginalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024 // Maksimum 15MB
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file berformat PDF (.pdf) yang diperbolehkan!'));
    }
  }
});

// ==========================================
// DYNAMIC QR CODE TOKEN ENGINE (ANTI-TITIP)
// ==========================================
// Token berganti secara otomatis setiap 30 detik di server.
// Token lama hanya ditoleransi dalam grace period 5 detik untuk mengatasi lag transmisi.
const TOKEN_WINDOW_SECONDS = 30;
let currentQrSession = {
  token: '',
  previousToken: '',
  createdAt: Date.now(),
  expiresAt: Date.now() + (TOKEN_WINDOW_SECONDS * 1000)
};

function generateSecureToken() {
  return 'LPTI-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function rotateQrToken() {
  const now = Date.now();
  currentQrSession.previousToken = currentQrSession.token;
  currentQrSession.token = generateSecureToken();
  currentQrSession.createdAt = now;
  currentQrSession.expiresAt = now + (TOKEN_WINDOW_SECONDS * 1000);
}

// Inisialisasi token awal & rotasi setiap 30 detik
rotateQrToken();
setInterval(() => {
  rotateQrToken();
}, TOKEN_WINDOW_SECONDS * 1000);

// Endpoint Mendapatkan Status & Gambar Dynamic QR Code Terkini
app.get('/api/qr/current', async (req, res) => {
  try {
    const now = Date.now();
    const remainingSeconds = Math.max(0, Math.ceil((currentQrSession.expiresAt - now) / 1000));
    const db = readDb();
    const event = db.event || {};

    const qrPayload = JSON.stringify({
      token: currentQrSession.token,
      eventId: event.id || 'EVT-001',
      validUntil: currentQrSession.expiresAt
    });

    // Generate base64 Data URL untuk QR Code
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: '#064e3b', // Deep Emerald Green
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      token: currentQrSession.token,
      duration: TOKEN_WINDOW_SECONDS,
      remainingSeconds: remainingSeconds,
      validUntil: currentQrSession.expiresAt,
      eventTitle: event.title || 'Pelatihan Kepegawaian',
      qrPayload: qrPayload,
      qrImage: qrDataUrl
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghasilkan QR Code: ' + error.message });
  }
});

// Endpoint Verifikasi & Validasi Token Presensi
app.post('/api/presensi/verify-token', (req, res) => {
  const { employeeId, token } = req.body;

  if (!employeeId || !token) {
    return res.status(400).json({ success: false, message: 'ID Pegawai dan Token QR wajib diisi!' });
  }

  const cleanToken = token.trim().toUpperCase();
  const isCurrentValid = (cleanToken === currentQrSession.token);
  // Toleransi 5 detik untuk token yang baru saja berganti
  const isPreviousValid = (cleanToken === currentQrSession.previousToken && (Date.now() - currentQrSession.createdAt) <= 5000);

  if (!isCurrentValid && !isPreviousValid) {
    return res.status(400).json({
      success: false,
      message: 'Token QR tidak valid atau telah kedaluwarsa (>30 detik). Silakan scan langsung dari layar proyektor aula!'
    });
  }

  const db = readDb();
  const employee = db.employees.find(e => e.id === employeeId || e.nip === employeeId);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan dalam sistem!' });
  }

  if (employee.attended) {
    return res.json({
      success: true,
      alreadyAttended: true,
      message: `Pegawai ${employee.name} sudah tercatat HADIR sebelumnya.`,
      employee: employee
    });
  }

  // Tandai hadir
  employee.attended = true;
  employee.attendedAt = new Date().toISOString();
  writeDb(db);

  return res.json({
    success: true,
    message: `Presensi Berhasil! Status kehadiran ${employee.name} kini resmi HADIR.`,
    employee: employee
  });
});

// ==========================================
// EVENT MANAGEMENT API
// ==========================================
app.get('/api/event', (req, res) => {
  const db = readDb();
  res.json({ success: true, event: db.event });
});

app.put('/api/event', (req, res) => {
  const { title, jp, category, schedule, location, organizer } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Judul kegiatan pelatihan wajib diisi!' });
  }

  const parsedJp = parseInt(jp, 10);
  if (isNaN(parsedJp) || parsedJp < 1 || parsedJp > 120) {
    return res.status(400).json({ success: false, message: 'Alokasi Nilai Jam Pelajaran (JP) harus berupa angka antara 1 sampai 120 JP!' });
  }

  const db = readDb();
  db.event = {
    id: db.event?.id || `EVT-${new Date().getFullYear()}-001`,
    title: title.trim(),
    jp: parsedJp,
    category: (category || 'Teknis & Manajerial Kepegawaian').trim(),
    schedule: (schedule || 'Jadwal Ditentukan').trim(),
    location: (location || 'Auditorium BKPSDM & Hybrid').trim(),
    organizer: (organizer || 'Badan Kepegawaian dan Pengembangan Sumber Daya Manusia').trim(),
    updatedAt: new Date().toISOString()
  };

  writeDb(db);

  res.json({
    success: true,
    message: 'Data event pelatihan berhasil disimpan dan disinkronkan ke seluruh sistem!',
    event: db.event
  });
});

// ==========================================
// EMPLOYEES & PORTAL PEGAWAI API
// ==========================================
app.get('/api/employees', (req, res) => {
  const db = readDb();
  res.json({ success: true, employees: db.employees, event: db.event });
});

app.get('/api/employees/:id', (req, res) => {
  const db = readDb();
  const emp = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
  }
  res.json({ success: true, employee: emp, event: db.event });
});

// Tambah / Buat Pegawai Baru (Simulasi mandiri)
app.post('/api/employees', (req, res) => {
  const { nip, name, jabatan, instansi } = req.body;
  if (!nip || !name) {
    return res.status(400).json({ success: false, message: 'NIP dan Nama Pegawai wajib diisi!' });
  }

  const db = readDb();
  const existing = db.employees.find(e => e.nip === nip.trim());
  if (existing) {
    return res.status(400).json({ success: false, message: 'NIP sudah terdaftar dalam sistem!' });
  }

  const newEmp = {
    id: 'EMP-' + String(db.employees.length + 1).padStart(3, '0'),
    nip: nip.trim(),
    name: name.trim(),
    jabatan: (jabatan || 'Aparatur Sipil Negara').trim(),
    instansi: (instansi || 'Pemerintah Daerah').trim(),
    attended: false,
    attendedAt: null,
    accumulatedJp: 0,
    lpti: {
      status: 'none',
      fileName: null,
      fileOriginalName: null,
      filePath: null,
      fileSize: 0,
      uploadedAt: null,
      revisionNote: ''
    },
    certificate: null
  };

  db.employees.push(newEmp);
  writeDb(db);

  res.status(201).json({ success: true, message: 'Pegawai baru berhasil ditambahkan!', employee: newEmp });
});

// ==========================================
// FORM UNGGAH BERKAS LPTI (MULTER PDF)
// ==========================================
app.post('/api/employees/:id/upload-lpti', (req, res) => {
  upload.single('lptiFile')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Ukuran file melebihi batas maksimal 15MB!' });
      }
      return res.status(400).json({ success: false, message: 'Kesalahan unggah: ' + err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Silakan pilih berkas PDF asli LPTI terlebih dahulu!' });
    }

    const db = readDb();
    const employee = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);

    if (!employee) {
      // Hapus file yang baru diunggah jika pegawai tidak ditemukan
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
    }

    if (!employee.attended) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        message: 'Anda belum melakukan Presensi Kehadiran. Silakan scan Dynamic QR Code di layar proyektor terlebih dahulu!'
      });
    }

    // Perbarui data LPTI
    employee.lpti = {
      status: 'pending', // Masuk status Menunggu Persetujuan Kepegawaian (Kuning animasi)
      fileName: req.file.filename,
      fileOriginalName: req.file.originalname,
      filePath: `/uploads/lpti/${req.file.filename}`,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      revisionNote: '' // Reset catatan revisi sebelumnya saat mengunggah ulang
    };

    // Jika sebelumnya ada sertifikat dan file direvisi/reupload, kunci kembali sertifikat
    employee.certificate = null;

    writeDb(db);

    res.json({
      success: true,
      message: 'Berkas LPTI berhasil diunggah! Berkas Anda saat ini berstatus "Menunggu Persetujuan Kepegawaian".',
      employee: employee
    });
  });
});

// ==========================================
// VERIFIKASI MANUAL LPTI OLEH ADMIN
// ==========================================
app.post('/api/employees/:id/verify-lpti', (req, res) => {
  const { action, revisionNote } = req.body;
  // action: 'approve' atau 'revise'

  if (!action || !['approve', 'revise'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Aksi verifikasi harus "approve" atau "revise".' });
  }

  const db = readDb();
  const employee = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
  }

  if (!employee.lpti || !employee.lpti.fileName) {
    return res.status(400).json({ success: false, message: 'Pegawai ini belum mengunggah berkas LPTI.' });
  }

  if (action === 'approve') {
    employee.lpti.status = 'approved';
    employee.lpti.revisionNote = '';

    // Terbitkan Nomor Sertifikat Resmi Otomatis jika belum ada
    if (!employee.certificate) {
      const counter = db.system?.certCounter || 1;
      const certYear = new Date().getFullYear();
      const certNumber = `${db.system?.certPrefix || '800.1.3/SERT-LPTI/' + certYear}/${String(counter).padStart(3, '0')}`;
      
      employee.certificate = {
        number: certNumber,
        issuedAt: new Date().toISOString(),
        verifier: 'Drs. H. Hendrawan, M.Si',
        verifierTitle: 'Kepala Badan Kepegawaian dan Pengembangan SDM'
      };

      // Tambahkan akumulasi JP
      const eventJp = db.event?.jp || 32;
      employee.accumulatedJp = (employee.accumulatedJp || 0) + eventJp;

      // Update counter di database
      if (!db.system) db.system = {};
      db.system.certCounter = counter + 1;
    }

    writeDb(db);

    return res.json({
      success: true,
      message: `Berkas LPTI ${employee.name} berhasil DISETUJUI! E-Sertifikat resmi nomor ${employee.certificate.number} telah diterbitkan dan akses unduh dibuka.`,
      employee: employee
    });
  } else if (action === 'revise') {
    const note = (revisionNote && revisionNote.trim()) 
      ? revisionNote.trim() 
      : 'Berkas LPTI belum memenuhi format standar. Harap lengkapi lembar pengesahan dan rencana tindak lanjut lalu unggah kembali.';

    employee.lpti.status = 'revision';
    employee.lpti.revisionNote = note;
    employee.certificate = null; // Kunci akses sertifikat jika ada revisi

    writeDb(db);

    return res.json({
      success: true,
      message: `Catatan revisi untuk ${employee.name} telah dikirim ke portal pegawai. Akses sertifikat tetap terkunci.`,
      employee: employee
    });
  }
});

// ==========================================
// DATA E-SERTIFIKAT RESMI
// ==========================================
app.get('/api/employees/:id/certificate', async (req, res) => {
  const db = readDb();
  const employee = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
  }

  if (employee.lpti?.status !== 'approved' || !employee.certificate) {
    return res.status(403).json({
      success: false,
      message: 'E-Sertifikat masih terkunci. Berkas LPTI Anda harus disetujui oleh Admin Kepegawaian terlebih dahulu.'
    });
  }

  // Buat QR Code Keabsahan Digital Sertifikat
  const verifyUrl = `${req.protocol}://${req.get('host')}/api/verify-cert/${encodeURIComponent(employee.certificate.number)}`;
  const certQrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 140,
    color: {
      dark: '#064e3b',
      light: '#ffffff'
    }
  });

  res.json({
    success: true,
    certificate: {
      number: employee.certificate.number,
      issuedAt: employee.certificate.issuedAt,
      verifier: employee.certificate.verifier,
      verifierTitle: employee.certificate.verifierTitle || 'Kepala Badan Kepegawaian dan Pengembangan SDM',
      employeeName: employee.name,
      employeeNip: employee.nip,
      employeeJabatan: employee.jabatan,
      employeeInstansi: employee.instansi,
      eventTitle: db.event.title,
      eventJp: db.event.jp,
      eventCategory: db.event.category,
      eventSchedule: db.event.schedule,
      eventLocation: db.event.location,
      qrVerification: certQrDataUrl,
      verifyUrl: verifyUrl
    }
  });
});

// Verifikasi Publik Keabsahan Sertifikat
app.get('/api/verify-cert/:certNumber', (req, res) => {
  const db = readDb();
  const certNumber = decodeURIComponent(req.params.certNumber);
  const employee = db.employees.find(e => e.certificate && e.certificate.number === certNumber);

  if (!employee) {
    return res.status(404).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #dc2626;">SERTIFIKAT TIDAK DITEMUKAN</h1>
        <p>Nomor sertifikat <strong>${certNumber}</strong> tidak terdaftar dalam pangkalan data resmi kepegawaian.</p>
      </div>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <title>Verifikasi Keabsahan E-Sertifikat Kepegawaian</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-emerald-50 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-emerald-200 text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <span class="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full uppercase tracking-wider mb-2">Terverifikasi Sah & Asli</span>
        <h2 class="text-xl font-bold text-gray-900 mb-1">E-Sertifikat Kepegawaian Resmi</h2>
        <p class="text-sm text-gray-500 mb-6 font-mono">${employee.certificate.number}</p>
        
        <div class="text-left bg-gray-50 rounded-xl p-4 space-y-3 text-sm border border-gray-100 mb-6">
          <div><span class="text-gray-500 block text-xs">Nama Pegawai</span><span class="font-semibold text-gray-800">${employee.name}</span></div>
          <div><span class="text-gray-500 block text-xs">NIP</span><span class="font-semibold text-gray-800">${employee.nip}</span></div>
          <div><span class="text-gray-500 block text-xs">Kegiatan Pelatihan</span><span class="font-semibold text-gray-800">${db.event.title}</span></div>
          <div><span class="text-gray-500 block text-xs">Bobot Jam Pelajaran</span><span class="font-semibold text-emerald-700">${db.event.jp} Jam Pelajaran (JP)</span></div>
          <div><span class="text-gray-500 block text-xs">Tanggal Terbit</span><span class="text-gray-700">${new Date(employee.certificate.issuedAt).toLocaleDateString('id-ID', { dateStyle: 'full' })}</span></div>
        </div>

        <a href="/pegawai" class="inline-block w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition text-sm">Buka Portal Pegawai</a>
      </div>
    </body>
    </html>
  `);
});

// Reset Demo Data
app.post('/api/reset-data', (req, res) => {
  const initialData = {
    event: {
      id: "EVT-2026-001",
      title: "Pelatihan Transformasi Digital & Manajemen Kepegawaian Modern",
      jp: 32,
      category: "Teknis & Manajerial Kepegawaian",
      schedule: "18 - 20 November 2026, 08:00 - 16:30 WIB",
      location: "Auditorium Sasana Praja BKPSDM & Hybrid",
      organizer: "Badan Kepegawaian dan Pengembangan Sumber Daya Manusia",
      targetAudience: "Aparatur Sipil Negara (ASN) Pelaksana & Fungsional",
      updatedAt: new Date().toISOString()
    },
    employees: [
      {
        id: "EMP-001",
        nip: "198803152010121002",
        name: "Budi Santoso, S.Kom., M.T.",
        jabatan: "Pranata Komputer Ahli Muda",
        instansi: "Dinas Komunikasi dan Informatika",
        attended: true,
        attendedAt: new Date(Date.now() - 3600000).toISOString(),
        accumulatedJp: 96,
        lpti: {
          status: "approved",
          fileName: "LPTI_Budi_Santoso_EVT001.pdf",
          fileOriginalName: "Laporan_Pasca_Pelatihan_Budi_Santoso.pdf",
          filePath: "/uploads/lpti/LPTI_Budi_Santoso_EVT001.pdf",
          fileSize: 348160,
          uploadedAt: new Date(Date.now() - 1800000).toISOString(),
          revisionNote: ""
        },
        certificate: {
          number: "800.1.3/SERT-LPTI/2026/001",
          issuedAt: new Date(Date.now() - 900000).toISOString(),
          verifier: "Drs. H. Hendrawan, M.Si (Kepala BKPSDM)"
        }
      },
      {
        id: "EMP-002",
        nip: "199207212015032004",
        name: "Siti Nurhaliza, S.E., M.M.",
        jabatan: "Analis Kepegawaian Pertama",
        instansi: "Badan Kepegawaian Daerah",
        attended: true,
        attendedAt: new Date(Date.now() - 3000000).toISOString(),
        accumulatedJp: 64,
        lpti: {
          status: "pending",
          fileName: "LPTI_Siti_Nurhaliza_EVT001.pdf",
          fileOriginalName: "LPTI_Siti_Nurhaliza_Final.pdf",
          filePath: "/uploads/lpti/LPTI_Siti_Nurhaliza_EVT001.pdf",
          fileSize: 284500,
          uploadedAt: new Date(Date.now() - 1200000).toISOString(),
          revisionNote: ""
        },
        certificate: null
      },
      {
        id: "EMP-003",
        nip: "198511042008011003",
        name: "Ahmad Fauzi, S.Sos.",
        jabatan: "Pengelola Pengadaan Barang/Jasa",
        instansi: "Sekretariat Daerah",
        attended: true,
        attendedAt: new Date(Date.now() - 2400000).toISOString(),
        accumulatedJp: 48,
        lpti: {
          status: "revision",
          fileName: "LPTI_Ahmad_Fauzi_EVT001.pdf",
          fileOriginalName: "Laporan_Ahmad_Fauzi.pdf",
          filePath: "/uploads/lpti/LPTI_Ahmad_Fauzi_EVT001.pdf",
          fileSize: 195200,
          uploadedAt: new Date(Date.now() - 600000).toISOString(),
          revisionNote: "Bab 3 Rencana Tindak Lanjut belum dilengkapi tandatangan atasan langsung. Mohon upload ulang dengan lembar pengesahan berstempel basah/TTE."
        },
        certificate: null
      },
      {
        id: "EMP-004",
        nip: "199504122019022007",
        name: "Rina Marlina, S.Tr.Ak.",
        jabatan: "Auditor Pertama",
        instansi: "Inspektorat Daerah",
        attended: false,
        attendedAt: null,
        accumulatedJp: 40,
        lpti: {
          status: "none",
          fileName: null,
          fileOriginalName: null,
          filePath: null,
          fileSize: 0,
          uploadedAt: null,
          revisionNote: ""
        },
        certificate: null
      },
      {
        id: "EMP-005",
        nip: "199010052014021005",
        name: "Dr. Dian Puspitasari, M.Pd.",
        jabatan: "Widyaiswara Ahli Pertama",
        instansi: "BPSDM Provinsi",
        attended: false,
        attendedAt: null,
        accumulatedJp: 112,
        lpti: {
          status: "none",
          fileName: null,
          fileOriginalName: null,
          filePath: null,
          fileSize: 0,
          uploadedAt: null,
          revisionNote: ""
        },
        certificate: null
      }
    ],
    system: {
      certPrefix: "800.1.3/SERT-LPTI/2026",
      certCounter: 2
    }
  };

  writeDb(initialData);
  res.json({ success: true, message: 'Data demonstrasi sistem berhasil di-reset!' });
});

// Route Navigasi Halaman Utama
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/pegawai', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pegawai.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=====================================================`);
  console.log(` SISTEM PRESENSI, VERIFIKASI LPTI & E-SERTIFIKAT`);
  console.log(` Server berjalan aktif pada port http://localhost:${PORT}`);
  console.log(` - Portal Utama:   http://localhost:${PORT}/`);
  console.log(` - Admin Board:    http://localhost:${PORT}/admin`);
  console.log(` - Portal Pegawai: http://localhost:${PORT}/pegawai`);
  console.log(`=====================================================`);
});

