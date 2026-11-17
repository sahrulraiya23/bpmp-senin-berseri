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

// ========================================================
// PATH SETUP (KOMPATIBILITAS VERCEL SERVERLESS & LOKAL)
// ========================================================
const IS_VERCEL = Boolean(process.env.VERCEL);
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');

// Pada Vercel Serverless, hanya folder /tmp yang dapat ditulis
const DATA_DIR = IS_VERCEL ? '/tmp' : BASE_DIR;
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'lpti');
const BUNDLED_UPLOAD_DIR = path.join(BASE_DIR, 'uploads', 'lpti');

// Pastikan folder uploads tersedia
if (!fs.existsSync(UPLOAD_DIR)) {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (e) {
    console.warn('Gagal membuat folder upload:', e.message);
  }
}

// Inisialisasi db.json di /tmp jika di Vercel
if (IS_VERCEL && !fs.existsSync(DB_PATH)) {
  try {
    const bundledDbPath = path.join(BASE_DIR, 'db.json');
    if (fs.existsSync(bundledDbPath)) {
      fs.copyFileSync(bundledDbPath, DB_PATH);
    }
  } catch (e) {
    console.warn('Gagal menyalin db.json awal ke /tmp:', e.message);
  }
}

// Helper: Membaca & Menulis db.json
function readDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    }
    const bundledPath = path.join(BASE_DIR, 'db.json');
    if (fs.existsSync(bundledPath)) {
      return JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading db.json:', err.message);
  }
  return {
    event: { active: false },
    employees: [],
    system: { certPrefix: "800.1.3/SERT-LPTI/2026", certCounter: 1 }
  };
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

// Static File Serving
app.use(express.static(PUBLIC_DIR));

// Handler Serving File PDF LPTI (Mendukung upload lokal & Vercel /tmp)
app.use('/uploads/lpti', (req, res, next) => {
  const filePath1 = path.join(UPLOAD_DIR, req.path);
  if (fs.existsSync(filePath1)) {
    return res.sendFile(filePath1);
  }
  const filePath2 = path.join(BUNDLED_UPLOAD_DIR, req.path);
  if (fs.existsSync(filePath2)) {
    return res.sendFile(filePath2);
  }
  next();
});

// Konfigurasi Multer untuk Upload PDF Asli LPTI
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
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
  limits: { fileSize: 15 * 1024 * 1024 }, // Maksimum 15MB
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file berformat PDF (.pdf) yang diperbolehkan!'));
    }
  }
});

// ========================================================
// STATELESS DYNAMIC QR CODE ENGINE (TOTP / SERVERLESS-READY)
// ========================================================
// Algoritma berbasis jendela waktu (Time-Window) 30 detik.
// Bekerja 100% konsisten baik di server lokal maupun di Vercel Serverless
// tanpa membutuhkan background process/interval yang dibekukan di cloud.
const TOKEN_WINDOW_SECONDS = 30;

function getTokenForTimeWindow(windowIndex, eventId = 'EVT-001') {
  const secretKey = 'BKPSDM-LPTI-KEY-' + (eventId || 'EVT-DEFAULT');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(String(windowIndex));
  const hash = hmac.digest('hex').toUpperCase();
  return 'LPTI-' + hash.substring(0, 6);
}

function getCurrentQrState(eventId = 'EVT-001') {
  const now = Date.now();
  const currentWindow = Math.floor(now / (TOKEN_WINDOW_SECONDS * 1000));
  const remainingSeconds = Math.max(0, TOKEN_WINDOW_SECONDS - Math.floor((now % (TOKEN_WINDOW_SECONDS * 1000)) / 1000));
  const validUntil = (currentWindow + 1) * (TOKEN_WINDOW_SECONDS * 1000);

  const token = getTokenForTimeWindow(currentWindow, eventId);
  const previousToken = getTokenForTimeWindow(currentWindow - 1, eventId);

  return {
    token,
    previousToken,
    remainingSeconds,
    validUntil,
    duration: TOKEN_WINDOW_SECONDS
  };
}

// Endpoint Mendapatkan Status & Gambar Dynamic QR Code Terkini
app.get('/api/qr/current', async (req, res) => {
  try {
    const db = readDb();
    const event = db.event || {};

    // SYARAT KHUSUS: QR Code HANYA TERBIT JIKA EVENT SUDAH DI-INPUT & AKTIF
    const isEventActive = Boolean(event.active && event.title && event.title.trim());

    if (!isEventActive) {
      return res.json({
        success: true,
        active: false,
        message: 'Belum ada event aktif. Silakan isi dan simpan Formulir Pembuatan Event terlebih dahulu untuk menerbitkan QR Code Presensi.',
        event: event
      });
    }

    const qrState = getCurrentQrState(event.id || 'EVT-001');

    // Mendapatkan URL Asli Host (agar bisa dipindai langsung dari kamera HP)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    
    // Tautan Langsung Presensi yang Dibuka saat Kamera HP Memindai QR
    const scanUrl = `${protocol}://${host}/pegawai?token=${qrState.token}&event=${event.id || 'EVT-001'}&action=presensi`;

    // Buat QR Code Gambar (Base64)
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 340,
      color: {
        dark: '#064e3b', // Deep Emerald
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      active: true,
      token: qrState.token,
      duration: qrState.duration,
      remainingSeconds: qrState.remainingSeconds,
      validUntil: qrState.validUntil,
      eventTitle: event.title,
      eventJp: event.jp,
      scanUrl: scanUrl,
      qrImage: qrDataUrl
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghasilkan QR Code: ' + error.message });
  }
});

// ========================================================
// AUTHENTICATION API (LOGIN PEGAWAI DENGAN NIP & PASSWORD)
// ========================================================
app.post('/api/auth/login', (req, res) => {
  const { nip, password } = req.body;

  if (!nip || !password) {
    return res.status(400).json({ success: false, message: 'NIP dan Password wajib diisi!' });
  }

  const cleanNip = String(nip).trim();
  const cleanPassword = String(password).trim();
  const db = readDb();

  const employee = (db.employees || []).find(e => e.nip === cleanNip || e.id === cleanNip);

  if (!employee) {
    return res.status(401).json({
      success: false,
      message: `NIP "${cleanNip}" tidak ditemukan dalam pangkalan data BPMP Provinsi Sulawesi Tenggara.`
    });
  }

  const defaultPassword = 'Bpmp2026!';
  const expectedPassword = employee.password || defaultPassword;

  if (cleanPassword !== expectedPassword && cleanPassword !== defaultPassword) {
    return res.status(401).json({
      success: false,
      message: 'Password salah! Pastikan menggunakan password yang benar (Password default: Bpmp2026!).'
    });
  }

  // Return safe employee profile (exclude password)
  const { password: _, ...safeEmployee } = employee;

  return res.json({
    success: true,
    message: `Login berhasil! Selamat datang, ${employee.name}.`,
    employee: safeEmployee,
    event: db.event
  });
});

// Endpoint Verifikasi & Validasi Token Presensi (Dari Web atau Scan HP)
app.post('/api/presensi/verify-token', (req, res) => {
  const { employeeId, token } = req.body;

  if (!employeeId || !token) {
    return res.status(400).json({ success: false, message: 'Identitas Pegawai dan Kode Token QR wajib diisi!' });
  }

  const db = readDb();
  const event = db.event || {};

  // Validasi Event Harus Aktif
  if (!event.active || !event.title) {
    return res.status(400).json({
      success: false,
      message: 'Presensi ditolak: Belum ada event kegiatan pelatihan yang aktif!'
    });
  }

  const qrState = getCurrentQrState(event.id || 'EVT-001');
  const cleanToken = token.trim().toUpperCase();

  // Validasi Token Jendela Saat Ini atau Jendela Sebelumnya (Toleransi network latency)
  const isValid = (cleanToken === qrState.token || cleanToken === qrState.previousToken);

  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: 'Token QR tidak valid atau telah kedaluwarsa (>30 detik). Silakan scan langsung dari layar proyektor aula!'
    });
  }

  const employee = (db.employees || []).find(e => e.id === employeeId || e.nip === employeeId);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan dalam sistem.' });
  }

  if (employee.attended) {
    return res.json({
      success: true,
      alreadyAttended: true,
      message: `Pegawai ${employee.name} sudah tercatat HADIR sebelumnya pada kegiatan ini.`,
      employee: employee
    });
  }

  // Tandai hadir & kaitkan dengan event aktif
  employee.attended = true;
  employee.attendedAt = new Date().toISOString();
  employee.eventId = event.id || 'EVT-2026-001';
  employee.eventTitle = event.title;
  writeDb(db);

  return res.json({
    success: true,
    message: `Presensi Berhasil! Status kehadiran ${employee.name} kini resmi HADIR pada kegiatan "${event.title}".`,
    employee: employee
  });
});

// ========================================================
// EVENT MANAGEMENT API
// ========================================================
app.get('/api/event', (req, res) => {
  const db = readDb();
  res.json({ success: true, event: db.event, events: db.events || [] });
});

app.get('/api/events', (req, res) => {
  const db = readDb();
  const events = db.events || (db.event ? [db.event] : []);
  res.json({ success: true, events: events, currentEvent: db.event });
});

// Simpan & Aktifkan Event (Menerbitkan QR Code) - Mendukung PUT & POST
const handleSaveEvent = (req, res) => {
  const { title, jp, category, schedule, location, organizer } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Judul kegiatan pelatihan wajib diisi!' });
  }

  const parsedJp = parseInt(jp, 10);
  if (isNaN(parsedJp) || parsedJp < 1 || parsedJp > 120) {
    return res.status(400).json({ success: false, message: 'Alokasi Nilai Jam Pelajaran (JP) harus berupa angka antara 1 sampai 120 JP!' });
  }

  const db = readDb();
  const eventId = db.event?.id || `EVT-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`;
  
  db.event = {
    id: eventId,
    title: title.trim(),
    jp: parsedJp,
    category: (category || 'Teknis & Manajerial Kepegawaian').trim(),
    schedule: (schedule || 'Jadwal Ditentukan').trim(),
    location: (location || 'Auditorium Sasana Praja BKPSDM & Hybrid').trim(),
    organizer: (organizer || 'Badan Kepegawaian dan Pengembangan Sumber Daya Manusia').trim(),
    active: true, // EVENT RESMI AKTIF -> QR CODE OTOMATIS TERBIT
    updatedAt: new Date().toISOString()
  };

  // Simpan / Perbarui juga di daftar db.events
  if (!db.events) db.events = [];
  const existingIdx = db.events.findIndex(e => e.id === eventId || e.title.toLowerCase() === title.trim().toLowerCase());
  if (existingIdx >= 0) {
    db.events[existingIdx] = db.event;
  } else {
    db.events.unshift(db.event);
  }

  writeDb(db);

  res.json({
    success: true,
    message: 'Event pelatihan berhasil disimpan & diaktifkan! Dynamic QR Code presensi kini telah terbit.',
    event: db.event,
    events: db.events
  });
};

app.put('/api/event', handleSaveEvent);
app.post('/api/event', handleSaveEvent);

// Toggle Status Event (Buka / Tutup Presensi)
app.post('/api/event/toggle-status', (req, res) => {
  const db = readDb();
  if (!db.event) db.event = {};
  db.event.active = !db.event.active;
  db.event.updatedAt = new Date().toISOString();

  // Sinkronkan ke daftar events
  if (db.events) {
    const ev = db.events.find(e => e.id === db.event.id);
    if (ev) ev.active = db.event.active;
  }

  writeDb(db);

  res.json({
    success: true,
    active: db.event.active,
    message: db.event.active ? 'Sesi presensi event resmi DIBUKA & QR Code diterbitkan!' : 'Sesi presensi event DITUTUP sementara.'
  });
});

// ========================================================
// EMPLOYEES & PORTAL PEGAWAI API
// ========================================================
app.get('/api/employees', (req, res) => {
  const db = readDb();
  res.json({ success: true, employees: db.employees, event: db.event, events: db.events || [] });
});

app.get('/api/employees/:id', (req, res) => {
  const db = readDb();
  const emp = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
  }
  res.json({ success: true, employee: emp, event: db.event });
});

// ========================================================
// UNGGAH BERKAS LPTI (MULTER PDF)
// ========================================================
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
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
    }

    if (!employee.attended) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Anda belum melakukan Presensi Kehadiran. Silakan scan Dynamic QR Code di layar proyektor terlebih dahulu!'
      });
    }

    // Perbarui data LPTI
    employee.lpti = {
      status: 'pending',
      fileName: req.file.filename,
      fileOriginalName: req.file.originalname,
      filePath: `/uploads/lpti/${req.file.filename}`,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      revisionNote: ''
    };

    employee.certificate = null; // Kunci sertifikat jika re-upload
    writeDb(db);

    res.json({
      success: true,
      message: 'Berkas LPTI berhasil diunggah! Berkas Anda saat ini berstatus "Menunggu Persetujuan Kepegawaian".',
      employee: employee
    });
  });
});

// ========================================================
// VERIFIKASI MANUAL LPTI OLEH ADMIN
// ========================================================
app.post('/api/employees/:id/verify-lpti', (req, res) => {
  const { action, revisionNote } = req.body;

  if (!action || !['approve', 'revise'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Aksi verifikasi harus "approve" atau "revise".' });
  }

  const db = readDb();
  const employee = db.employees.find(e => e.id === req.params.id || e.nip === req.params.id);

  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
  }

  if (action === 'approve') {
    employee.lpti.status = 'approved';
    employee.lpti.revisionNote = '';

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

      const eventJp = db.event?.jp || 32;
      employee.accumulatedJp = (employee.accumulatedJp || 0) + eventJp;

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
    employee.certificate = null;

    writeDb(db);

    return res.json({
      success: true,
      message: `Catatan revisi untuk ${employee.name} telah dikirim ke portal pegawai. Akses sertifikat tetap terkunci.`,
      employee: employee
    });
  }
});

// ========================================================
// DATA E-SERTIFIKAT RESMI & QR CODE KEABSAHAN
// ========================================================
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

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  const verifyUrl = `${protocol}://${host}/api/verify-cert/${encodeURIComponent(employee.certificate.number)}`;

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

// Verifikasi Publik Keabsahan Sertifikat (Dapat diakses HP)
app.get('/api/verify-cert/:certNumber', (req, res) => {
  const db = readDb();
  const certNumber = decodeURIComponent(req.params.certNumber);
  const employee = db.employees.find(e => e.certificate && e.certificate.number === certNumber);

  if (!employee) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head><meta charset="UTF-8"><title>Sertifikat Tidak Ditemukan</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-50 min-h-screen flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-red-200 text-center">
          <h1 class="text-xl font-bold text-red-600 mb-2">SERTIFIKAT TIDAK DITEMUKAN</h1>
          <p class="text-sm text-slate-600 mb-4">Nomor <strong>${certNumber}</strong> tidak terdaftar dalam pangkalan data resmi kepegawaian.</p>
          <a href="/" class="text-xs font-bold text-emerald-700 underline">Kembali ke Portal</a>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verifikasi Keabsahan E-Sertifikat Kepegawaian</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-emerald-50 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-white rounded-3xl shadow-xl p-6 sm:p-8 border border-emerald-200 text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
        </div>
        <span class="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full uppercase tracking-wider mb-2">Terverifikasi Sah & Asli</span>
        <h2 class="text-xl font-extrabold text-slate-900 mb-1">E-Sertifikat Kepegawaian Resmi</h2>
        <p class="text-xs text-slate-500 mb-6 font-mono">${employee.certificate.number}</p>
        
        <div class="text-left bg-slate-50 rounded-2xl p-4 space-y-3 text-xs border border-slate-100 mb-6">
          <div><span class="text-slate-400 block">Nama Pegawai</span><span class="font-bold text-slate-800 text-sm">${employee.name}</span></div>
          <div><span class="text-slate-400 block">NIP</span><span class="font-mono font-semibold text-slate-800">${employee.nip}</span></div>
          <div><span class="text-slate-400 block">Kegiatan Pelatihan</span><span class="font-bold text-slate-800">${db.event.title}</span></div>
          <div><span class="text-slate-400 block">Bobot Pelatihan</span><span class="font-bold text-emerald-700">${db.event.jp} Jam Pelajaran (JP)</span></div>
          <div><span class="text-slate-400 block">Tanggal Terbit</span><span class="text-slate-700">${new Date(employee.certificate.issuedAt).toLocaleDateString('id-ID', { dateStyle: 'full' })}</span></div>
        </div>

        <a href="/pegawai" class="inline-block w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl transition text-xs shadow-md shadow-emerald-600/20">Buka Portal Pegawai</a>
      </div>
    </body>
    </html>
  `);
});

// Reset Demo Data (Mempertahankan 104 Pegawai BPMP Sultra & Me-reset Status Kehadiran / LPTI untuk Pengujian)
app.post('/api/reset-data', (req, res) => {
  const db = readDb();
  
  // Reset status untuk semua pegawai BPMP (set password Bpmp2026!)
  const updatedEmployees = (db.employees || []).map((emp, index) => {
    // 3 pegawai pertama diberikan status sampel untuk memudahkan presentasi / demo
    if (index === 0) {
      // Sampel 1: Disetujui & Sertifikat Terbit (Kepala BPMP)
      return {
        ...emp,
        password: "Bpmp2026!",
        attended: true,
        attendedAt: new Date(Date.now() - 3600000).toISOString(),
        accumulatedJp: 96,
        eventId: "EVT-2026-001",
        lpti: {
          status: "approved",
          fileName: "LPTI_Junaiddin_Pagala.pdf",
          fileOriginalName: "Laporan_LPTI_Junaiddin.pdf",
          filePath: "/uploads/lpti/LPTI_Budi_Santoso_EVT001.pdf",
          fileSize: 348160,
          uploadedAt: new Date(Date.now() - 1800000).toISOString(),
          revisionNote: ""
        },
        certificate: {
          number: "800.1.3/SERT-LPTI/2026/001",
          issuedAt: new Date(Date.now() - 900000).toISOString(),
          verifier: "Drs. H. Hendrawan, M.Si",
          verifierTitle: "Kepala Badan Kepegawaian dan Pengembangan SDM"
        }
      };
    } else if (index === 1) {
      // Sampel 2: Menunggu Persetujuan (Kasubbag Umum)
      return {
        ...emp,
        password: "Bpmp2026!",
        attended: true,
        attendedAt: new Date(Date.now() - 3000000).toISOString(),
        accumulatedJp: 64,
        eventId: "EVT-2026-001",
        lpti: {
          status: "pending",
          fileName: "LPTI_Rika_Ernita_Mekuo.pdf",
          fileOriginalName: "LPTI_Rika_Ernita_Final.pdf",
          filePath: "/uploads/lpti/LPTI_Siti_Nurhaliza_EVT001.pdf",
          fileSize: 284500,
          uploadedAt: new Date(Date.now() - 1200000).toISOString(),
          revisionNote: ""
        },
        certificate: null
      };
    } else if (index === 2) {
      // Sampel 3: Perlu Revisi
      return {
        ...emp,
        password: "Bpmp2026!",
        attended: true,
        attendedAt: new Date(Date.now() - 2400000).toISOString(),
        accumulatedJp: 48,
        eventId: "EVT-2026-001",
        lpti: {
          status: "revision",
          fileName: "LPTI_Joko_Purnomo.pdf",
          fileOriginalName: "Laporan_Pasca_Pelatihan_Joko.pdf",
          filePath: "/uploads/lpti/LPTI_Ahmad_Fauzi_EVT001.pdf",
          fileSize: 195200,
          uploadedAt: new Date(Date.now() - 600000).toISOString(),
          revisionNote: "Bab 3 Rencana Tindak Lanjut belum dilengkapi tandatangan atasan langsung. Mohon upload ulang dengan lembar pengesahan berstempel basah/TTE."
        },
        certificate: null
      };
    } else {
      // Sisa 101 pegawai dalam status belum hadir & siap untuk diuji coba scan QR & login
      return {
        ...emp,
        password: "Bpmp2026!",
        attended: false,
        attendedAt: null,
        accumulatedJp: emp.accumulatedJp || 32,
        eventId: "EVT-2026-001",
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
      };
    }
  });

  db.employees = updatedEmployees;
  db.system = {
    certPrefix: "800.1.3/SERT-LPTI/2026",
    certCounter: 2
  };

  writeDb(db);
  res.json({ success: true, message: `Pangkalan data 104 Pegawai BPMP Sultra berhasil disinkronkan & status pengujian di-reset!` });
});

// Routing Halaman Utama
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/pegawai', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pegawai.html')));

// Export app untuk Vercel Serverless Function (@vercel/node)
module.exports = app;

// Jalankan server jika dieksekusi langsung secara lokal
if (require.main === module || !IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`=====================================================`);
    console.log(` SISTEM PRESENSI, VERIFIKASI LPTI & E-SERTIFIKAT`);
    console.log(` Server berjalan aktif pada port http://localhost:${PORT}`);
    console.log(` - Portal Utama:   http://localhost:${PORT}/`);
    console.log(` - Admin Board:    http://localhost:${PORT}/admin`);
    console.log(` - Portal Pegawai: http://localhost:${PORT}/pegawai`);
    console.log(` Mode Server:      ${IS_VERCEL ? 'Vercel Serverless' : 'Local Node.js'}`);
    console.log(`=====================================================`);
  });
}
