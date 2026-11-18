const os = require('os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { generateCertificatePdf } = require('./certificate-generator');
const sqliteDb = require('./sqlite-db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Paths & Environment
const IS_VERCEL = Boolean(process.env.VERCEL);
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = IS_VERCEL ? os.tmpdir() : BASE_DIR;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'lpti');
const TEMPLATE_DIR = path.join(DATA_DIR, 'uploads', 'templates');

// Ensure upload directories exist
[UPLOAD_DIR, TEMPLATE_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('Gagal membuat folder:', dir, e.message);
  }
});

// Static File Serving
app.use(express.static(PUBLIC_DIR));
app.use('/uploads/lpti', express.static(UPLOAD_DIR));
app.use('/uploads/templates', express.static(TEMPLATE_DIR));
if (IS_VERCEL) {
  app.use('/uploads/lpti', express.static(path.join(BASE_DIR, 'uploads', 'lpti')));
  app.use('/uploads/templates', express.static(path.join(BASE_DIR, 'uploads', 'templates')));
}

// Admin session store (Stateless HMAC-signed token + fallback memory map)
const JWT_SECRET = process.env.SESSION_SECRET || 'bpmp-senin-berseri-secret-key-2026';
const adminSessions = new Map();

function createAdminToken(admin) {
  const payload = {
    u: admin.username,
    r: admin.role || 'admin',
    n: admin.name || 'Administrator BPMP',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 hari persisten
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  const token = `adm.${body}.${signature}`;
  adminSessions.set(token, { admin, createdAt: Date.now() });
  return token;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return null;
  const clean = token.trim();
  
  // Format token stateless: adm.<base64url>.<signature>
  if (clean.startsWith('adm.')) {
    const parts = clean.split('.');
    if (parts.length === 3) {
      const [, body, sig] = parts;
      const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
      if (sig === expectedSig) {
        try {
          const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
          if (!payload.exp || payload.exp > Math.floor(Date.now() / 1000)) {
            return {
              username: payload.u || 'admin',
              role: payload.r || 'admin',
              name: payload.n || 'Administrator BPMP'
            };
          }
        } catch (e) {}
      }
    }
  }

  // Fallback ke memori map jika ada token sesi lama
  if (adminSessions.has(clean)) {
    const session = adminSessions.get(clean);
    if (Date.now() - session.createdAt < 30 * 24 * 60 * 60 * 1000) {
      return session.admin;
    }
  }

  return null;
}

function getAdminFromToken(authHeader, cookieHeader) {
  let token = null;
  if (authHeader) {
    token = authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  if (!token && cookieHeader) {
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1].trim());
  }
  return verifyAdminToken(token);
}

// Multer Storage for LPTI PDFs
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Hanya file berformat PDF (.pdf) yang diperbolehkan!'));
    }
  }
});

// Multer Storage for Certificate Templates (PDF & Images)
const templateStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(TEMPLATE_DIR)) fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    cb(null, TEMPLATE_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
    cb(null, `TEMPLATE-${uniqueSuffix}${ext}`);
  }
});

const uploadTemplate = multer({
  storage: templateStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowedExts.includes(ext) || allowedMimes.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung! Harap unggah Foto (.JPG, .PNG) atau Dokumen PDF (.PDF).'));
    }
  }
});

// ========================================================
// STATELESS DYNAMIC QR CODE ENGINE (30s Window)
// ========================================================
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

// Endpoint Current Dynamic QR Code
app.get('/api/qr/current', async (req, res) => {
  try {
    let targetEvent = null;
    const requestedId = req.query.eventId || req.query.id;
    if (requestedId) {
      targetEvent = await sqliteDb.getEventById(requestedId);
    }
    if (!targetEvent) {
      targetEvent = await sqliteDb.getActiveEvent();
    }

    if (!targetEvent || !targetEvent.title || !targetEvent.active || targetEvent.status === 'completed') {
      return res.json({
        success: true,
        active: false,
        status: targetEvent ? targetEvent.status : 'inactive',
        message: (targetEvent && targetEvent.status === 'completed')
          ? `Kegiatan pelatihan "${targetEvent.title}" (${targetEvent.id}) telah SELESAI. Presensi mandiri ditutup.`
          : 'Belum ada event pelatihan yang aktif di layar presensi aula.',
        eventId: targetEvent ? targetEvent.id : null,
        eventTitle: targetEvent ? targetEvent.title : ''
      });
    }

    const qrState = getCurrentQrState(targetEvent.id);
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const scanUrl = `${protocol}://${host}/pegawai?token=${qrState.token}&event=${targetEvent.id}&action=presensi`;

    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 340,
      color: {
        dark: '#064e3b',
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
      eventId: targetEvent.id,
      eventTitle: targetEvent.title,
      eventJp: targetEvent.jp,
      scanUrl: scanUrl,
      qrImage: qrDataUrl
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghasilkan QR Code: ' + error.message });
  }
});

// ========================================================
// AUTHENTICATION APIs
// ========================================================

// 1. Admin Login (Soft UI Console)
app.post('/api/auth/admin-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan Password admin wajib diisi!' });
  }

  const admin = await sqliteDb.verifyAdminCredentials(username, password);
  if (!admin) {
    return res.status(401).json({
      success: false,
      message: 'Username atau Password Administrator salah! (Default: admin / Bpmp2026!)'
    });
  }

  const token = createAdminToken(admin);

  // Set HTTP Cookie untuk keamanan ganda dan persistensi lintas serverless Vercel
  res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`);

  res.json({
    success: true,
    message: `Selamat datang, ${admin.name}!`,
    token: token,
    admin: admin
  });
});

// 2. Admin Check Session
app.get('/api/auth/admin-check', (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) {
    return res.status(401).json({ success: false, authenticated: false, message: 'Sesi admin tidak valid atau telah berakhir.' });
  }
  res.json({ success: true, authenticated: true, admin });
});

// 3. Admin Logout
app.post('/api/auth/admin-logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    adminSessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.json({ success: true, message: 'Anda telah berhasil keluar dari dashboard admin.' });
});

// 4. Employee Login (Mandiri Pegawai dengan NIP & Password)
app.post('/api/auth/login', async (req, res) => {
  const { nip, password } = req.body;
  if (!nip || !password) {
    return res.status(400).json({ success: false, message: 'NIP dan Password wajib diisi!' });
  }

  const cleanNip = String(nip).trim();
  const cleanPassword = String(password).trim();

  const employee = await sqliteDb.getEmployeeByIdOrNip(cleanNip);
  if (!employee) {
    return res.status(401).json({
      success: false,
      message: `NIP "${cleanNip}" tidak terdaftar dalam pangkalan data pegawai BPMP Sulawesi Tenggara.`
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

  const activeEvent = await sqliteDb.getActiveEvent();
  const { password: _, ...safeEmployee } = employee;

  return res.json({
    success: true,
    message: `Login berhasil! Selamat datang, ${employee.name}.`,
    employee: safeEmployee,
    event: activeEvent
  });
});

// ========================================================
// PRESENSI SCAN TOKEN (AULA PROYEKTOR)
// ========================================================
app.post('/api/presensi/verify-token', async (req, res) => {
  const { employeeId, token } = req.body;
  if (!employeeId || !token) {
    return res.status(400).json({ success: false, message: 'Identitas Pegawai dan Kode Token QR wajib diisi!' });
  }

  const activeEvent = await sqliteDb.getActiveEvent();
  if (!activeEvent || !activeEvent.title) {
    return res.status(400).json({
      success: false,
      message: 'Presensi ditolak: Belum ada event kegiatan pelatihan yang aktif di aula!'
    });
  }

  const qrState = getCurrentQrState(activeEvent.id);
  const cleanToken = token.trim().toUpperCase();
  const isValid = (cleanToken === qrState.token || cleanToken === qrState.previousToken);

  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: 'Token QR tidak valid atau telah kedaluwarsa (>30 detik). Silakan scan langsung dari layar proyektor aula!'
    });
  }

  const employee = await sqliteDb.getEmployeeByIdOrNip(employeeId);
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

  const updatedEmployee = await sqliteDb.markEmployeeAttended(employee.id, activeEvent.id, activeEvent.title);

  return res.json({
    success: true,
    message: `Presensi Berhasil! Status kehadiran ${employee.name} kini resmi HADIR pada kegiatan "${activeEvent.title}".`,
    employee: updatedEmployee
  });
});

// ========================================================
// EVENT MANAGEMENT APIs (SQLITE BACKED)
// ========================================================
app.get('/api/event', async (req, res) => {
  let targetEvent = null;
  const requestedId = req.query.eventId || req.query.id;
  if (requestedId) {
    targetEvent = await sqliteDb.getEventById(requestedId);
  }
  if (!targetEvent) {
    targetEvent = await sqliteDb.getActiveEvent();
  }
  const allEvents = await sqliteDb.getAllEvents();
  res.json({ success: true, event: targetEvent, events: allEvents });
});

app.get('/api/events', async (req, res) => {
  const allEvents = await sqliteDb.getAllEvents();
  const activeEvent = await sqliteDb.getActiveEvent();
  res.json({ success: true, events: allEvents, currentEvent: activeEvent });
});

const handleSaveEvent = async (req, res) => {
  const { title, jp } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Judul kegiatan pelatihan wajib diisi!' });
  }

  const parsedJp = parseInt(jp, 10);
  if (isNaN(parsedJp) || parsedJp < 1 || parsedJp > 120) {
    return res.status(400).json({ success: false, message: 'Alokasi Jam Pelajaran (JP) harus berupa angka 1 - 120 JP!' });
  }

  try {
    const isNew = Boolean(req.body.isNew || req.body.isNewEvent || !req.body.id || req.body.id === 'new');
    const saved = await sqliteDb.saveEvent(req.body, isNew);
    // Pastikan event baru/tersimpan ini langsung menjadi sesi resmi yang aktif di aula & QR
    await sqliteDb.activateEventById(saved.id);
    const allEvents = await sqliteDb.getAllEvents();
    res.json({
      success: true,
      message: `Event "${saved.title}" (${saved.id}) berhasil disimpan & diaktifkan di layar aula!`,
      event: saved,
      events: allEvents
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menyimpan event: ' + err.message });
  }
};

app.put('/api/event', handleSaveEvent);
app.post('/api/event', handleSaveEvent);

app.post('/api/events/:id/activate', async (req, res) => {
  const activated = await sqliteDb.activateEventById(req.params.id);
  if (!activated) {
    return res.status(404).json({ success: false, message: 'Event tidak ditemukan dalam daftar.' });
  }
  const allEvents = await sqliteDb.getAllEvents();
  res.json({
    success: true,
    message: `Event "${activated.title}" (${activated.id}) kini aktif sebagai sesi resmi di aula!`,
    event: activated,
    events: allEvents
  });
});

// Endpoint Selesaikan Event Pelatihan
app.post('/api/events/:id/complete', async (req, res) => {
  try {
    const completed = await sqliteDb.completeEventById(req.params.id);
    if (!completed) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan dalam daftar.' });
    }
    const allEvents = await sqliteDb.getAllEvents();
    res.json({
      success: true,
      message: `Event "${completed.title}" (${completed.id}) resmi diselesaikan! Presensi ditutup & data diarsipkan.`,
      event: completed,
      events: allEvents
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal menyelesaikan event: ' + err.message });
  }
});

// Endpoint Sinkronisasi Event Lintas Serverless Vercel
app.post('/api/events/sync', async (req, res) => {
  try {
    const clientEvents = req.body.events;
    if (Array.isArray(clientEvents) && clientEvents.length > 0) {
      await sqliteDb.syncEvents(clientEvents);
    }
    const allEvents = await sqliteDb.getAllEvents();
    const activeEvent = await sqliteDb.getActiveEvent();
    res.json({
      success: true,
      message: 'Event berhasil disinkronkan.',
      events: allEvents,
      event: activeEvent
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal sinkronisasi event: ' + err.message });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  const deleted = await sqliteDb.deleteEventById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Event tidak ditemukan.' });
  }
  const allEvents = await sqliteDb.getAllEvents();
  const activeEvent = await sqliteDb.getActiveEvent();
  res.json({
    success: true,
    message: `Event "${deleted.title}" berhasil dihapus dari sistem.`,
    event: activeEvent,
    events: allEvents
  });
});

app.post('/api/event/toggle-status', async (req, res) => {
  const toggled = await sqliteDb.toggleActiveEventStatus();
  const isActive = Boolean(toggled && toggled.active);
  res.json({
    success: true,
    active: isActive,
    message: isActive ? 'Sesi presensi event resmi DIBUKA & QR Code diterbitkan!' : 'Sesi presensi event DITUTUP sementara.'
  });
});

// ========================================================
// CERTIFICATE TEMPLATE & SETTINGS APIs (PER-EVENT)
// ========================================================
app.post('/api/event/upload-template', (req, res) => {
  uploadTemplate.single('templateFile')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Ukuran file template melebihi batas 20MB!' });
      }
      return res.status(400).json({ success: false, message: 'Kesalahan unggah: ' + err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Silakan pilih berkas Foto (.PNG, .JPG) atau Dokumen PDF (.PDF) terlebih dahulu!' });
    }

    const targetEventId = req.body?.eventId || req.query?.eventId;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = ext === '.pdf' ? 'pdf' : 'image';

    const newTemplate = {
      hasCustomTemplate: true,
      fileType: fileType,
      fileName: req.file.filename,
      fileOriginalName: req.file.originalname,
      filePath: `/uploads/templates/${req.file.filename}`,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString()
    };

    const updatedEvent = await sqliteDb.updateEventTemplate(targetEventId, newTemplate);

    res.json({
      success: true,
      message: `Template sertifikat (${fileType === 'pdf' ? 'Dokumen PDF' : 'Foto/Gambar'}) berhasil diunggah & diterapkan!`,
      template: newTemplate,
      event: updatedEvent
    });
  });
});

app.delete('/api/event/template', async (req, res) => {
  const targetEventId = req.body?.eventId || req.query?.eventId;
  await sqliteDb.updateEventTemplate(targetEventId, null);
  res.json({ success: true, message: 'Template kustom berhasil dihapus. Event kembali menggunakan desain piagam standar resmi.' });
});

app.post('/api/event/cert-settings', async (req, res) => {
  const { eventId, prefix, nomorYRatio, namaYRatio, namaFontSize, nomorFontSize } = req.body;
  const targetEventId = eventId;

  const certSettings = {
    prefix: (prefix || '800.1.3/SERT-LPTI/2026').trim(),
    nomorYRatio: parseFloat(nomorYRatio) || 0.72,
    namaYRatio: parseFloat(namaYRatio) || 0.50,
    namaFontSize: parseInt(namaFontSize, 10) || 26,
    nomorFontSize: parseInt(nomorFontSize, 10) || 11
  };

  const updated = await sqliteDb.updateEventCertSettings(targetEventId, certSettings);

  res.json({
    success: true,
    message: 'Pengaturan penomoran & tata letak teks sertifikat berhasil disimpan!',
    certSettings: certSettings,
    event: updated
  });
});

// Streaming Preview Contoh Sertifikat PDF
app.get('/api/event/sample-certificate.pdf', async (req, res) => {
  try {
    const targetEventId = req.query.eventId;
    const event = (targetEventId ? await sqliteDb.getEventById(targetEventId) : await sqliteDb.getActiveEvent()) || {};
    const certConfig = event.certSettings || {};

    let templatePath = null;
    if (event.certificateTemplate?.filePath) {
      const p = path.join(BASE_DIR, event.certificateTemplate.filePath.replace(/^\//, ''));
      if (fs.existsSync(p)) templatePath = p;
    }

    const sampleCertNumber = `${certConfig.prefix || '800.1.3/SERT-LPTI/2026'}/001`;

    const pdfBuffer = await generateCertificatePdf({
      templatePath: templatePath,
      certNumber: sampleCertNumber,
      employeeName: 'Junaiddin Pagala, ST, M.T.',
      employeeNip: '197606122002121004',
      employeeJabatan: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      employeeInstansi: 'BPMP Provinsi Sulawesi Tenggara',
      eventTitle: event.title || 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN',
      eventJp: event.jp || 32,
      eventSchedule: event.schedule || '18 - 20 November 2026',
      verifier: 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      verifierNip: '197606122002121004',
      issuedAt: new Date().toISOString(),
      verifyUrl: 'http://localhost:3000/api/verify-cert/' + encodeURIComponent(sampleCertNumber),
      nomorYRatio: certConfig.nomorYRatio || 0.72,
      namaYRatio: certConfig.namaYRatio || 0.50,
      namaFontSize: certConfig.namaFontSize || 26,
      nomorFontSize: certConfig.nomorFontSize || 11
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Sample_Certificate_Preview.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error sample cert PDF:', error);
    res.status(500).send('Gagal menghasilkan preview sample PDF: ' + error.message);
  }
});

// ========================================================
// EMPLOYEES & LPTI VERIFICATION APIs
// ========================================================
app.get('/api/employees', async (req, res) => {
  const employees = await sqliteDb.getAllEmployees();
  const activeEvent = await sqliteDb.getActiveEvent();
  const allEvents = await sqliteDb.getAllEvents();
  res.json({ success: true, employees, event: activeEvent, events: allEvents });
});

app.get('/api/employees/:id', async (req, res) => {
  const emp = await sqliteDb.getEmployeeByIdOrNip(req.params.id);
  if (!emp) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
  const activeEvent = await sqliteDb.getActiveEvent();
  res.json({ success: true, employee: emp, event: activeEvent });
});

app.post('/api/employees/:id/upload-lpti', (req, res) => {
  upload.single('lptiFile')(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Ukuran file melebihi batas 15MB!' });
      }
      return res.status(400).json({ success: false, message: 'Kesalahan unggah: ' + err.message });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Silakan pilih berkas PDF asli LPTI terlebih dahulu!' });
    }

    const employee = await sqliteDb.getEmployeeByIdOrNip(req.params.id);
    if (!employee) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
    }

    if (!employee.attended) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Anda belum melakukan Presensi Kehadiran. Silakan scan Dynamic QR Code di aula terlebih dahulu!'
      });
    }

    const updatedEmployee = await sqliteDb.updateEmployeeLpti(employee.id, {
      fileName: req.file.filename,
      fileOriginalName: req.file.originalname,
      filePath: `/uploads/lpti/${req.file.filename}`,
      fileSize: req.file.size
    });

    res.json({
      success: true,
      message: 'Berkas LPTI berhasil diunggah! Berkas Anda saat ini berstatus "Menunggu Persetujuan Kepegawaian".',
      employee: updatedEmployee
    });
  });
});

app.post('/api/employees/:id/verify-lpti', async (req, res) => {
  const { action, revisionNote } = req.body;
  if (!action || !['approve', 'revise'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Aksi verifikasi harus "approve" atau "revise".' });
  }

  const employee = await sqliteDb.getEmployeeByIdOrNip(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
  }

  const empEvtId = employee.eventId;
  const event = (empEvtId ? await sqliteDb.getEventById(empEvtId) : await sqliteDb.getActiveEvent()) || {};

  const updatedEmployee = await sqliteDb.verifyEmployeeLpti(employee.id, action, revisionNote, event.jp || 32);

  if (action === 'approve') {
    return res.json({
      success: true,
      message: `Berkas LPTI ${employee.name} berhasil DISETUJUI! E-Sertifikat resmi nomor ${updatedEmployee.certificate.number} telah diterbitkan.`,
      employee: updatedEmployee
    });
  } else {
    return res.json({
      success: true,
      message: `Catatan revisi untuk ${employee.name} telah dikirim ke portal pegawai. Akses sertifikat tetap terkunci.`,
      employee: updatedEmployee
    });
  }
});

// Metadata E-Sertifikat
app.get('/api/employees/:id/certificate', async (req, res) => {
  const employee = await sqliteDb.getEmployeeByIdOrNip(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });

  if (employee.lpti?.status !== 'approved' || !employee.certificate) {
    return res.status(403).json({
      success: false,
      message: 'E-Sertifikat masih terkunci. Berkas LPTI Anda harus disetujui oleh Admin Kepegawaian terlebih dahulu.'
    });
  }

  const empEvtId = employee.eventId;
  const event = (empEvtId ? await sqliteDb.getEventById(empEvtId) : await sqliteDb.getActiveEvent()) || {};

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  const verifyUrl = `${protocol}://${host}/api/verify-cert/${encodeURIComponent(employee.certificate.number)}`;

  const certQrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 140,
    color: { dark: '#064e3b', light: '#ffffff' }
  });

  res.json({
    success: true,
    certificate: {
      number: employee.certificate.number,
      issuedAt: employee.certificate.issuedAt,
      verifier: employee.certificate.verifier,
      verifierTitle: employee.certificate.verifierTitle || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      employeeName: employee.name,
      employeeNip: employee.nip,
      employeeJabatan: employee.jabatan,
      employeeInstansi: employee.instansi,
      eventTitle: event.title || 'Pelatihan Kepegawaian ASN',
      eventJp: event.jp || 32,
      eventCategory: event.category || 'Teknis & Manajerial Kepegawaian',
      eventSchedule: event.schedule || 'Jadwal Ditentukan',
      eventLocation: event.location || 'Auditorium Sasana Praja',
      qrVerification: certQrDataUrl,
      verifyUrl: verifyUrl,
      pdfDownloadUrl: `/api/employees/${employee.nip || employee.id}/certificate.pdf?download=true`,
      pdfPreviewUrl: `/api/employees/${employee.nip || employee.id}/certificate.pdf`,
      template: event.certificateTemplate || null,
      certSettings: event.certSettings || null
    }
  });
});

// Unduh / Streaming Asli PDF E-Sertifikat Pegawai
app.get('/api/employees/:id/certificate.pdf', async (req, res) => {
  try {
    const employee = await sqliteDb.getEmployeeByIdOrNip(req.params.id);
    if (!employee) return res.status(404).send('Data pegawai tidak ditemukan.');

    if (employee.lpti?.status !== 'approved' || !employee.certificate) {
      return res.status(403).send('E-Sertifikat masih terkunci atau belum disetujui admin.');
    }

    const empEvtId = employee.eventId;
    const event = (empEvtId ? await sqliteDb.getEventById(empEvtId) : await sqliteDb.getActiveEvent()) || {};
    const certConfig = event.certSettings || {};

    let templatePath = null;
    if (event.certificateTemplate?.filePath) {
      const p = path.join(BASE_DIR, event.certificateTemplate.filePath.replace(/^\//, ''));
      if (fs.existsSync(p)) templatePath = p;
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const verifyUrl = `${protocol}://${host}/api/verify-cert/${encodeURIComponent(employee.certificate.number)}`;

    const pdfBuffer = await generateCertificatePdf({
      templatePath: templatePath,
      certNumber: employee.certificate.number,
      employeeName: employee.name,
      employeeNip: employee.nip,
      employeeJabatan: employee.jabatan,
      employeeInstansi: employee.instansi,
      eventTitle: event.title || 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN',
      eventJp: event.jp || 32,
      eventSchedule: event.schedule || '18 - 20 November 2026',
      verifier: employee.certificate.verifier || 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: employee.certificate.verifierTitle || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      verifierNip: '197606122002121004',
      issuedAt: employee.certificate.issuedAt,
      verifyUrl: verifyUrl,
      nomorYRatio: certConfig.nomorYRatio || 0.72,
      namaYRatio: certConfig.namaYRatio || 0.50,
      namaFontSize: certConfig.namaFontSize || 26,
      nomorFontSize: certConfig.nomorFontSize || 11
    });

    const isDownload = req.query.download === 'true';
    const filename = `Sertifikat_${employee.nip}_${(employee.name || 'Pegawai').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error cert PDF:', error);
    res.status(500).send('Gagal menghasilkan e-sertifikat PDF: ' + error.message);
  }
});

// Verifikasi Publik Keabsahan Sertifikat
app.get('/api/verify-cert/:certNumber', async (req, res) => {
  const certNumber = decodeURIComponent(req.params.certNumber);
  const employees = await sqliteDb.getAllEmployees();
  const employee = employees.find(e => e.certificate && e.certificate.number === certNumber);

  if (!employee) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="id">
      <head><meta charset="UTF-8"><title>Verifikasi Gagal - BPMP Sultra</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4 font-sans text-slate-800">
        <div class="max-w-md w-full bg-white rounded-3xl p-8 border border-rose-200 shadow-xl text-center">
          <div class="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">✕</div>
          <h1 class="text-xl font-black text-rose-800 mb-2">Sertifikat Tidak Ditemukan</h1>
          <p class="text-sm text-slate-500 mb-6">Nomor registrasi <code>${certNumber}</code> tidak tercatat dalam database resmi BPMP Provinsi Sulawesi Tenggara.</p>
          <a href="/" class="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold">Kembali ke Beranda</a>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head><meta charset="UTF-8"><title>Verifikasi Sertifikat Resmi - BPMP Sultra</title><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-slate-50 flex items-center justify-center min-h-screen p-4 font-sans text-slate-800">
      <div class="max-w-md w-full bg-white rounded-3xl p-8 border border-emerald-200 shadow-xl text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
        <span class="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full tracking-wider mb-2">E-Sertifikat Resmi & Sah</span>
        <h1 class="text-lg font-black text-slate-900 mb-1">${employee.name}</h1>
        <p class="text-xs font-mono text-slate-500 mb-4">NIP: ${employee.nip}</p>
        <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left text-xs space-y-1.5 mb-6">
          <div><span class="text-slate-400">Nomor Surat:</span> <strong class="font-mono text-emerald-700 block">${employee.certificate.number}</strong></div>
          <div><span class="text-slate-400">Kegiatan:</span> <span class="font-bold text-slate-800 block">${employee.eventTitle || 'Pelatihan Kepegawaian ASN'}</span></div>
          <div><span class="text-slate-400">Instansi:</span> <span class="font-medium text-slate-700 block">${employee.instansi}</span></div>
          <div><span class="text-slate-400">Diterbitkan Pada:</span> <span class="font-medium text-slate-700 block">${new Date(employee.certificate.issuedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        </div>
        <a href="/api/employees/${employee.nip}/certificate.pdf" target="_blank" class="w-full inline-block py-3 bg-emerald-700 text-white font-bold rounded-xl text-xs hover:bg-emerald-800 transition">Lihat Dokumen PDF Resmi ↗</a>
      </div>
    </body>
    </html>
  `);
});

// Reset Testing Data API
app.post('/api/reset-data', async (req, res) => {
  await sqliteDb.resetTestingData();
  res.json({ success: true, message: 'Seluruh data pengujian berhasil dibersihkan! 104 data pegawai asli tetap tersimpan rapi.' });
});

// ========================================================
// PAGE ROUTES
// ========================================================
app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/pegawai', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pegawai.html'));
});

app.get('/proyektor', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'proyektor.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'proyektor.html'));
});

// 404 Handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Export Express app untuk Vercel Serverless Function (@vercel/node)
module.exports = app;

// Jalankan standalone server jika file dieksekusi langsung
if (require.main === module) {
  sqliteDb.initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 BPMP Sultra - Senin Berseri running on port ${PORT}`);
      console.log(`💾 Storage: ${sqliteDb.useSqlite ? 'SQLite (database.sqlite)' : 'JSON Engine (/tmp/db.json)'}`);
      console.log(`🔐 Admin Login: http://localhost:${PORT}/admin/login`);
      console.log(`📊 Dashboard Admin: http://localhost:${PORT}/admin`);
      console.log(`📽️ Layar Proyektor: http://localhost:${PORT}/proyektor`);
      console.log(`👤 Portal Pegawai: http://localhost:${PORT}/pegawai`);
      console.log(`====================================================`);
    });
  }).catch(err => {
    console.error('Fatal: Gagal menginisialisasi database:', err);
  });
}
