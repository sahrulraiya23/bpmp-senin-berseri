const os = require('os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { generateCertificatePdf } = require('./certificate-generator');
const certificateService = require('./services/certificate');
const { 
  signCertificate, 
  generateCertId, 
  generateRandomCertId, 
  isValidCertIdFormat, 
  getProductionBaseUrl, 
  verifyCertificateSignature 
} = require('./cert-crypto');
// Auto-load .env environment file (Node.js 20+)
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (e) {}
}

const DB_DRIVER = process.env.DB_DRIVER || 'supabase';
const supabaseAdapter = require('./supabase-adapter');
const db = DB_DRIVER === 'mysql' ? require('./mysql-adapter') : supabaseAdapter;
const sqliteDb = db;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Paths & Environment
const IS_VERCEL = Boolean(process.env.VERCEL);
const BASE_DIR = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(BASE_DIR, 'public'))
  ? path.join(BASE_DIR, 'public')
  : path.join(BASE_DIR, 'templates');
const DATA_DIR = IS_VERCEL ? os.tmpdir() : BASE_DIR;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'lpti');
const TEMPLATE_DIR = path.join(DATA_DIR, 'uploads', 'templates');
const FACES_DIR = path.join(DATA_DIR, 'uploads', 'faces');

// Ensure upload directories exist
[UPLOAD_DIR, TEMPLATE_DIR, FACES_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('Gagal membuat folder:', dir, e.message);
  }
});

// Static File Serving - Frontend Berada di PUBLIC_DIR
app.use(express.static(PUBLIC_DIR));
app.use('/azia', express.static(PUBLIC_DIR));
app.use('/uploads/lpti', express.static(UPLOAD_DIR));
app.use('/uploads/templates', express.static(TEMPLATE_DIR));
app.use('/uploads/faces', express.static(FACES_DIR));
if (IS_VERCEL) {
  app.use('/uploads/lpti', express.static(path.join(BASE_DIR, 'uploads', 'lpti')));
  app.use('/uploads/templates', express.static(path.join(BASE_DIR, 'uploads', 'templates')));
  app.use('/uploads/faces', express.static(path.join(BASE_DIR, 'uploads', 'faces')));
}

// Melayani file yang disimpan langsung di database (MySQL / Cloud Database)
app.get('/api/files/:bucket/:filename', async (req, res) => {
  try {
    if (typeof db.getFile === 'function') {
      const file = await db.getFile(req.params.bucket, req.params.filename);
      if (file && file.fileBuffer) {
        res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(file.fileBuffer);
      }
    }
    return res.status(404).send('Berkas tidak ditemukan.');
  } catch (e) {
    return res.status(500).send('Gagal membaca berkas: ' + e.message);
  }
});

// Admin session store (Stateless HMAC-signed token + fallback memory map)
const JWT_SECRET = process.env.SESSION_SECRET || 'bpmp-senin-berseri-secret-key-2026';
const adminSessions = new Map();

function createAdminToken(admin) {
  const peran = admin.peran || admin.role || (admin.username === 'superadmin' ? 'superadmin' : 'kepegawaian');
  const isSuper = peran === 'superadmin' || admin.username === 'superadmin';
  const payload = {
    id: admin.id,
    u: admin.username,
    r: isSuper ? 'superadmin' : 'kepegawaian',
    peran: isSuper ? 'superadmin' : 'kepegawaian',
    n: admin.name || (isSuper ? 'Super Administrator BPMP Sultra' : 'Petugas Kepegawaian'),
    wajib_ganti_password: Boolean(admin.wajib_ganti_password),
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
            const isSuper = payload.r === 'superadmin' || payload.peran === 'superadmin' || payload.u === 'superadmin';
            return {
              id: payload.id,
              username: payload.u || (isSuper ? 'superadmin' : 'admin'),
              role: isSuper ? 'superadmin' : 'kepegawaian',
              peran: isSuper ? 'superadmin' : 'kepegawaian',
              name: payload.n || (isSuper ? 'Super Administrator BPMP Sultra' : 'Petugas Kepegawaian'),
              wajib_ganti_password: Boolean(payload.wajib_ganti_password)
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

function createEmployeeSessionToken(employee) {
  if (!employee || !employee.nip) return '';
  const hash = crypto.createHmac('sha256', JWT_SECRET).update(`${employee.nip}:${employee.id}`).digest('hex');
  return `${employee.nip}:${hash}`;
}

function getEmployeeFromRequest(req) {
  const cookieHeader = req.headers.cookie || '';
  const matchCookie = cookieHeader.match(/employee_session=([^;]+)/);
  if (matchCookie) {
    const raw = decodeURIComponent(matchCookie[1].trim());
    const nip = raw.split(':')[0];
    if (nip) return nip;
  }
  if (req.headers['x-employee-nip']) {
    return String(req.headers['x-employee-nip']).trim();
  }
  if (req.query.sessionNip) {
    return String(req.query.sessionNip).trim();
  }
  return null;
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
      targetEvent = await db.getEventById(requestedId);
    }
    if (!targetEvent) {
      targetEvent = await db.getActiveEvent();
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

    // Simpan token QR aktif ke database (tabel qr_tokens & events)
    if (typeof db.saveQrToken === 'function') {
      try {
        await db.saveQrToken(targetEvent.id, qrState.token, qrState.validUntil);
      } catch (errSaveQr) {
        console.warn('Gagal menyimpan token QR ke DB:', errSaveQr.message);
      }
    }

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

  const admin = await db.verifyAdminCredentials(username, password);
  if (!admin) {
    return res.status(401).json({
      success: false,
      message: 'Username atau Password salah!'
    });
  }

  if (admin.error === 'INACTIVE' || admin.aktif === false) {
    return res.status(403).json({
      success: false,
      inactive: true,
      message: 'Akun administrator Anda telah dinonaktifkan. Silakan hubungi Super Administrator.'
    });
  }

  const token = createAdminToken(admin);

  // Set HTTP Cookie untuk keamanan ganda dan persistensi lintas serverless Vercel
  res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`);

  const isSuper = admin.role === 'superadmin' || admin.username === 'superadmin';

  res.json({
    success: true,
    message: `Selamat datang, ${admin.name}!`,
    token: token,
    admin: admin,
    redirectUrl: isSuper ? '/superadmin' : '/admin'
  });
});

// 2. Admin Check Session
app.get('/api/auth/admin-check', (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) {
    return res.status(401).json({ success: false, authenticated: false, message: 'Sesi admin tidak valid atau telah berakhir.' });
  }
  const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || Boolean(process.env.VERCEL);
  res.json({ success: true, authenticated: true, admin, isProduction });
});

// 3. Admin Logout (Support both POST, GET, and direct browser redirect)
const handleAdminLogout = (req, res) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace(/^Bearer\s+/i, '').trim();
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }
  if (token) {
    adminSessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (req.method === 'GET' && !req.xhr && !req.headers.accept?.includes('application/json')) {
    return res.redirect('/admin/login');
  }
  res.json({ success: true, message: 'Anda telah berhasil keluar dari dashboard admin.' });
};
app.post('/api/auth/admin-logout', handleAdminLogout);
app.get('/api/auth/admin-logout', handleAdminLogout);
app.get('/admin/logout', handleAdminLogout);

// ==============================================================
// 0. PASSWORD HASHING & RATE LIMITING SECURITY HELPERS
// ==============================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password).trim(), salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword || !password) return false;
  const cleanPass = String(password).trim();
  const cleanStored = String(storedPassword).trim();

  // Format salt:hash
  if (cleanStored.includes(':')) {
    const [salt, key] = cleanStored.split(':');
    const hash = crypto.pbkdf2Sync(cleanPass, salt, 10000, 64, 'sha512').toString('hex');
    return key === hash;
  }

  // Fallback plain text legacy
  return cleanPass === cleanStored;
}

// In-memory Rate Limiter: Map<identifier, { count, firstAttempt, lockedUntil }>
const loginAttemptTracker = new Map();

function checkLoginRateLimit(identifier) {
  const now = Date.now();
  const record = loginAttemptTracker.get(identifier);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    return {
      allowed: false,
      message: `Terlalu banyak percobaan login yang gagal. Akun dikunci sementara selama ${remainingMinutes} menit demi keamanan. Silakan coba kembali nanti.`
    };
  }

  // Reset setelah jendela 5 menit lewat
  if (now - record.firstAttempt > 300000) {
    loginAttemptTracker.delete(identifier);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordLoginFailure(identifier) {
  const now = Date.now();
  const record = loginAttemptTracker.get(identifier) || { count: 0, firstAttempt: now, lockedUntil: null };
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = now + 300000; // 5 menit
  }
  loginAttemptTracker.set(identifier, record);
}

function clearLoginAttempts(identifier) {
  loginAttemptTracker.delete(identifier);
}

// ==============================================================
// 0. EVENT STATUS DERIVATION & TIME WINDOW HELPERS
// ==============================================================
function getEventDerivedStatus(event) {
  if (!event) return { status: 'none', label: 'Tidak Ada Kegiatan', isPresensiAllowed: false, reason: 'Belum ada kegiatan pelatihan yang aktif.' };

  // Status Selesai / Arsip
  if (event.status === 'completed') {
    return {
      status: 'Selesai',
      label: 'Selesai (Arsip Kegiatan)',
      isPresensiAllowed: false,
      reason: 'Kegiatan pelatihan telah selesai dilaksanakan dan diarsipkan oleh Administrator.'
    };
  }

  const now = new Date();
  const scheduleStr = String(event.schedule || '');

  // Deteksi tahun / tanggal masa depan dalam jadwal
  const matchYear = scheduleStr.match(/\b(20\d\d)\b/);
  if (matchYear) {
    const year = parseInt(matchYear[1], 10);
    if (year > now.getFullYear()) {
      return {
        status: 'Akan Datang',
        label: 'Akan Datang',
        isPresensiAllowed: false,
        reason: `Kegiatan pelatihan dijadwalkan pada ${event.schedule}. Sesi presensi belum dibuka.`
      };
    }
  }

  // Jika status dinonaktifkan / jeda oleh admin
  if (!event.active) {
    return {
      status: 'Akan Datang',
      label: 'Akan Datang (Presensi Ditutup)',
      isPresensiAllowed: false,
      reason: 'Sesi presensi aula saat ini sedang dijeda atau belum dibuka oleh Administrator.'
    };
  }

  // Sedang berlangsung
  return {
    status: 'Berlangsung',
    label: 'Sedang Berlangsung',
    isPresensiAllowed: true,
    reason: 'Sesi presensi di aula sedang aktif.'
  };
}

// 4. Employee Login (Mandiri Pegawai dengan NIP & Password)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { nip, password, isTestUser } = req.body || {};
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || Boolean(process.env.VERCEL);

    if (!nip || !password) {
      return res.status(400).json({ success: false, message: 'NIP dan Password wajib diisi!' });
    }

    const cleanNip = String(nip).trim();
    const cleanPassword = String(password).trim();
    const rateLimitKey = `${cleanNip}_${ip}`;

    // 1. Tolak login 1-klik / akun testing di lingkungan produksi
    if (isProduction && (isTestUser || ['sahrul', 'rafli', 'user'].includes(cleanNip.toLowerCase()))) {
      return res.status(403).json({
        success: false,
        message: 'Akses uji coba cepat (1-klik) dinonaktifkan di lingkungan produksi.'
      });
    }

    // 2. Periksa Rate Limit (5x gagal -> kunci 5 menit)
    const rateCheck = checkLoginRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({ success: false, message: rateCheck.message });
    }

    const employee = await db.getEmployeeByIdOrNip(cleanNip);
    if (!employee) {
      recordLoginFailure(rateLimitKey);
      return res.status(401).json({
        success: false,
        message: 'NIP atau kata sandi tidak valid. Silakan periksa kembali.'
      });
    }

    const defaultPassword = 'Bpmp2026!';
    const storedPassword = employee.password || defaultPassword;

    // Verifikasi Password (hash atau legacy default)
    let isPasswordCorrect = verifyPassword(cleanPassword, storedPassword);
    if (!isPasswordCorrect && (cleanPassword === defaultPassword || cleanPassword === 'bpmp123')) {
      isPasswordCorrect = true;
    }

    if (!isPasswordCorrect) {
      recordLoginFailure(rateLimitKey);
      return res.status(401).json({
        success: false,
        message: 'NIP atau kata sandi tidak valid. Silakan periksa kembali.'
      });
    }

    // Login berhasil -> Bersihkan tracker kegagalan
    clearLoginAttempts(rateLimitKey);

    // Deteksi apakah pegawai harus ganti kata sandi
    const isDefaultPass = (cleanPassword === 'bpmp123' || cleanPassword === 'Bpmp2026!' || !String(storedPassword).includes(':'));
    const mustChangePassword = Boolean(employee.mustChangePassword || isDefaultPass);

    // Auto-hash password legacy di latar belakang
    if (!String(storedPassword).includes(':')) {
      try {
        await db.updateEmployee(employee.id, { password: hashPassword(cleanPassword) });
      } catch (eHash) {}
    }

    const activeEvent = await db.getActiveEvent();
    const { password: _, ...safeEmployee } = employee;
    const employeeSessionToken = createEmployeeSessionToken(employee);
    res.cookie('employee_session', employeeSessionToken, { httpOnly: true, sameSite: 'lax', path: '/' });

    return res.json({
      success: true,
      message: `Login berhasil! Selamat datang, ${employee.name}.`,
      mustChangePassword,
      isProduction,
      sessionToken: employeeSessionToken,
      employee: {
        ...safeEmployee,
        needsFaceRegistration: false,
        faceRegistered: Boolean(employee.faceRegistered)
      },
      redirectUrl: '/pegawai',
      event: activeEvent
    });
  } catch (err) {
    console.error('Error in /api/auth/login:', err);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem. Silakan coba kembali.' });
  }
});

// 5. Ganti Kata Sandi Pegawai (Wajib saat login pertama atau mandiri)
app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { nip, oldPassword, newPassword } = req.body || {};
    if (!nip || !oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'NIP, kata sandi lama, dan kata sandi baru wajib diisi!' });
    }

    const cleanNip = String(nip).trim();
    const cleanOld = String(oldPassword).trim();
    const cleanNew = String(newPassword).trim();

    if (cleanNew.length < 6) {
      return res.status(400).json({ success: false, message: 'Kata sandi baru minimal 6 karakter!' });
    }
    if (cleanNew === 'bpmp123' || cleanNew === 'Bpmp2026!') {
      return res.status(400).json({ success: false, message: 'Kata sandi baru tidak boleh menggunakan kata sandi default!' });
    }

    const employee = await db.getEmployeeByIdOrNip(cleanNip);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
    }

    const storedPassword = employee.password || 'Bpmp2026!';
    let isOldValid = verifyPassword(cleanOld, storedPassword);
    if (!isOldValid && (cleanOld === 'bpmp123' || cleanOld === 'Bpmp2026!')) {
      isOldValid = true;
    }

    if (!isOldValid) {
      return res.status(401).json({ success: false, message: 'Kata sandi lama yang Anda masukkan tidak sesuai.' });
    }

    const hashedNew = hashPassword(cleanNew);
    await db.updateEmployee(employee.id, {
      password: hashedNew,
      mustChangePassword: false
    });

    return res.json({
      success: true,
      message: 'Kata sandi berhasil diperbarui dengan aman!'
    });
  } catch (err) {
    console.error('Error in /api/auth/change-password:', err);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui kata sandi: ' + err.message });
  }
});

// ========================================================
// PRESENSI SCAN TOKEN & VERIFIKASI WAJAH AULA
// ========================================================
app.post(['/api/presensi/verify-token', '/api/attendance/verify'], async (req, res) => {
  try {
    const employeeId = req.body.employeeId || req.body.nip || req.body.id;
    const token = req.body.token || req.body.presenceToken || req.body.qrToken;
    const eventId = req.body.eventId;
    const attendancePhoto = req.body.attendancePhoto || req.body.faceSnapshot;

    if (!employeeId || !token) {
      return res.status(400).json({ success: false, message: 'Identitas Pegawai dan Kode Token QR wajib diisi!' });
    }

    let activeEvent = null;
    const requestedId = eventId || req.query.eventId || req.query.id;
    if (requestedId) {
      activeEvent = await db.getEventById(requestedId);
    }
    if (!activeEvent || !activeEvent.title) {
      activeEvent = await db.getActiveEvent();
    }

    if (!activeEvent || !activeEvent.title) {
      return res.status(400).json({
        success: false,
        message: 'Presensi ditolak: Belum ada event kegiatan pelatihan yang aktif di aula!'
      });
    }

    // Validasi status turunan event & jendela waktu presensi (Server-Side)
    const derivedStatus = getEventDerivedStatus(activeEvent);
    if (!derivedStatus.isPresensiAllowed) {
      return res.status(400).json({
        success: false,
        message: `Presensi ditolak: ${derivedStatus.reason}`
      });
    }

    const qrState = getCurrentQrState(activeEvent.id);
    let cleanToken = String(token).trim().toUpperCase();
    // Normalisasi token jika user hanya mengetik 6 karakter heksadesimal tanpa prefix LPTI-
    if (!cleanToken.startsWith('LPTI-') && cleanToken.length === 6) {
      cleanToken = 'LPTI-' + cleanToken;
    }
    let isValid = (cleanToken === qrState.token || cleanToken === qrState.previousToken);
    if (!isValid && typeof db.isQrTokenValid === 'function') {
      try {
        isValid = await db.isQrTokenValid(activeEvent.id, cleanToken);
      } catch (errCheckQr) {}
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: `Token QR (${cleanToken}) tidak cocok atau telah kedaluwarsa (>30 detik) untuk kegiatan "${activeEvent.title}". Silakan scan langsung dari layar proyektor aula!`
      });
    }

    const employee = await db.getEmployeeByIdOrNip(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan dalam sistem.' });
    }

    // Simpan foto bukti presensi (jika ada snapshot selfie) ke Supabase Storage
    let attendancePhotoUrl = null;
    if (attendancePhoto && typeof attendancePhoto === 'string' && attendancePhoto.startsWith('data:image')) {
      try {
        const base64Data = attendancePhoto.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `ATTEND-${employee.nip || employee.id}-${Date.now()}.jpg`;
        try {
          const localFilePath = path.join(FACES_DIR, filename);
          fs.writeFileSync(localFilePath, buffer);
          attendancePhotoUrl = `/uploads/faces/${filename}`;
        } catch (fsErr) {}

        // Upload langsung ke Supabase Storage bucket 'faces'
        try {
          const cloudUrl = await db.uploadToStorage('faces', filename, buffer, 'image/jpeg');
          if (cloudUrl) attendancePhotoUrl = cloudUrl;
        } catch (storageErr) {
          console.warn('Gagal upload presensi ke Supabase Storage:', storageErr.message);
        }
      } catch (photoErr) {
        console.warn('Gagal memproses attendancePhoto:', photoErr.message);
      }
    }

    // Cek apakah pegawai SUDAH HADIR KHUSUS pada kegiatan aktif ini
    const isAlreadyAttendedThisEvent = Boolean(employee.attended && employee.eventId === activeEvent.id);
    if (isAlreadyAttendedThisEvent) {
      let finalEmp = employee;
      if (!employee.accumulatedJp || employee.accumulatedJp === 0) {
        if (typeof db.ensureEmployeeJp === 'function') {
          finalEmp = await db.ensureEmployeeJp(employee.id, activeEvent.jp || 32);
        }
      }
      return res.json({
        success: true,
        alreadyAttended: true,
        message: `Pegawai ${employee.name} sudah tercatat HADIR sebelumnya pada kegiatan "${activeEvent.title}".`,
        employee: finalEmp || employee,
        event: activeEvent
      });
    }

    const updatedEmployee = await db.markEmployeeAttended(
      employee.id,
      activeEvent.id,
      activeEvent.title,
      activeEvent.jp || 32,
      attendancePhotoUrl,
      cleanToken
    );

    const successMsg = `Presensi aula berhasil dicatat! Selamat mengikuti kegiatan "${activeEvent.title}".`;

    return res.json({
      success: true,
      message: successMsg,
      employee: updatedEmployee || employee,
      event: activeEvent
    });
  } catch (errPresensi) {
    console.error('Error in presensi verification:', errPresensi);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem: ' + errPresensi.message });
  }
});

// ========================================================
// BIOMETRIK WAJAH ASN: PENDAFTARAN & RESET
// ========================================================
app.post('/api/employees/:id/register-face', async (req, res) => {
  try {
    const { facePhoto, faceDescriptor } = req.body || {};
    const employee = await db.getEmployeeByIdOrNip(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
    }

    if (!facePhoto || typeof facePhoto !== 'string' || !facePhoto.startsWith('data:image')) {
      return res.status(400).json({ success: false, message: 'Foto wajah master wajib berupa format data:image (base64).' });
    }

    const base64Data = facePhoto.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `MASTER-FACE-${employee.nip || employee.id}-${Date.now()}.jpg`;

    let facePhotoUrl = null;

    // Simpan buffer lokal hanya untuk caching non-kritis jika sistem berkas mengizinkan
    try {
      const localFilePath = path.join(FACES_DIR, filename);
      fs.writeFileSync(localFilePath, buffer);
      facePhotoUrl = `/uploads/faces/${filename}`;
    } catch (fsErr) {
      // Non-fatal di lingkungan serverless ber-filesystem read-only
    }

    // Wajib upload ke Supabase Storage bucket 'faces' di Supabase atau lingkungan Vercel/Produksi
    const isCloudRequired = db.isSupabaseAvailable() || IS_VERCEL || process.env.NODE_ENV === 'production';
    if (isCloudRequired) {
      try {
        const cloudUrl = await db.uploadToStorage('faces', filename, buffer, 'image/jpeg');
        if (!cloudUrl) {
          throw new Error('Supabase Storage tidak mengembalikan URL publik yang valid.');
        }
        facePhotoUrl = cloudUrl;
      } catch (storageErr) {
        console.error('[Storage Error in register-face]:', storageErr.message);
        return res.status(502).json({
          success: false,
          message: `Gagal mengunggah foto wajah ke Supabase Storage: ${storageErr.message}. Pastikan bucket 'faces' tersedia.`
        });
      }
    }

    try {
      const updated = await db.registerEmployeeFace(employee.id, {
        faceDescriptor: faceDescriptor || null,
        facePhotoUrl: facePhotoUrl
      });

      return res.json({
        success: true,
        message: `Data biometrik wajah pegawai ${employee.name} berhasil didaftarkan secara permanen di Supabase!`,
        employee: updated
      });
    } catch (dbErr) {
      console.error('[Database Error in register-face]:', dbErr.message);
      return res.status(500).json({
        success: false,
        message: `Gagal menyimpan biometrik wajah ke database: ${dbErr.message}`
      });
    }
  } catch (err) {
    console.error('Unhandled error in /api/employees/:id/register-face:', err);
    return res.status(500).json({
      success: false,
      message: `Terjadi kesalahan sistem: ${err.message}`
    });
  }
});

app.post('/api/employees/:id/reset-face', async (req, res) => {
  try {
    const employee = await db.getEmployeeByIdOrNip(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
    }

    const updated = await db.resetEmployeeFace(employee.id);
    return res.json({
      success: true,
      message: `Data biometrik wajah ${employee.name} berhasil di-reset. Pegawai dapat mendaftarkan ulang wajahnya.`,
      employee: updated
    });
  } catch (err) {
    console.error('Error in /api/employees/:id/reset-face:', err);
    return res.status(500).json({ success: false, message: `Gagal mereset biometrik wajah: ${err.message}` });
  }
});

// ========================================================
// EVENT MANAGEMENT APIs (SQLITE BACKED)
// ========================================================
app.get('/api/event', async (req, res) => {
  let targetEvent = null;
  const requestedId = req.query.eventId || req.query.id;
  if (requestedId) {
    targetEvent = await db.getEventById(requestedId);
  }
  if (!targetEvent) {
    targetEvent = await db.getActiveEvent();
  }
  const allEvents = await db.getAllEvents();
  res.json({ success: true, event: targetEvent, events: allEvents });
});

app.get('/api/events', async (req, res) => {
  const allEvents = await db.getAllEvents();
  const activeEvent = await db.getActiveEvent();
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
    const saved = await db.saveEvent(req.body, isNew);
    // Pastikan event baru/tersimpan ini langsung menjadi sesi resmi yang aktif di aula & QR
    await db.activateEventById(saved.id);
    const allEvents = await db.getAllEvents();
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
  const activated = await db.activateEventById(req.params.id);
  if (!activated) {
    return res.status(404).json({ success: false, message: 'Event tidak ditemukan dalam daftar.' });
  }
  const allEvents = await db.getAllEvents();
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
    const completed = await db.completeEventById(req.params.id);
    if (!completed) {
      return res.status(404).json({ success: false, message: 'Event tidak ditemukan dalam daftar.' });
    }
    const allEvents = await db.getAllEvents();
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
      await db.syncEvents(clientEvents);
    }
    const allEvents = await db.getAllEvents();
    const activeEvent = await db.getActiveEvent();
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
  const deleted = await db.deleteEventById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Event tidak ditemukan.' });
  }
  const allEvents = await db.getAllEvents();
  const activeEvent = await db.getActiveEvent();
  res.json({
    success: true,
    message: `Event "${deleted.title}" berhasil dihapus dari sistem.`,
    event: activeEvent,
    events: allEvents
  });
});

app.post('/api/event/toggle-status', async (req, res) => {
  const toggled = await db.toggleActiveEventStatus();
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
    try {
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

      let templateFilePath = `/uploads/templates/${req.file.filename}`;
      if (supabaseAdapter && typeof supabaseAdapter.isSupabaseAvailable === 'function' && supabaseAdapter.isSupabaseAvailable() && req.file.path && fs.existsSync(req.file.path)) {
        try {
          const fileBuffer = fs.readFileSync(req.file.path);
          const storageUrl = await supabaseAdapter.uploadToStorage('templates', req.file.filename, fileBuffer, req.file.mimetype);
          if (storageUrl) templateFilePath = storageUrl;
        } catch (storageErr) {
          console.warn('Gagal upload template ke Supabase Storage:', storageErr.message);
        }
      }

      const newTemplate = {
        hasCustomTemplate: true,
        fileType: fileType,
        fileName: req.file.filename,
        fileOriginalName: req.file.originalname,
        filePath: templateFilePath,
        fileSize: req.file.size,
        uploadedAt: new Date().toISOString()
      };

      const updatedEvent = await db.updateEventTemplate(targetEventId, newTemplate);

      return res.json({
        success: true,
        message: `Template sertifikat (${fileType === 'pdf' ? 'Dokumen PDF' : 'Foto/Gambar'}) berhasil diunggah & diterapkan!`,
        template: newTemplate,
        event: updatedEvent
      });
    } catch (unhandledErr) {
      console.error('Unhandled upload-template error:', unhandledErr);
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan sistem saat memproses template sertifikat: ' + unhandledErr.message
      });
    }
  });
});

function resolveTemplatePath(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath; // Supabase Cloud Storage public URL
  }
  const cleanPath = String(filePath).replace(/^\//, '');
  const basename = path.basename(filePath);
  const candidates = [
    path.join(DATA_DIR, cleanPath),
    path.join(BASE_DIR, cleanPath),
    path.join(TEMPLATE_DIR, basename),
    path.join(DATA_DIR, 'uploads', 'templates', basename),
    path.join(BASE_DIR, 'uploads', 'templates', basename)
  ];
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) return cand;
    } catch (e) {}
  }
  return null;
}

// ==============================================================
// FITUR BARU: TEMPLATE SERTIFIKAT TERKUNCI & ZONA PANDUAN
// ==============================================================

// 1. Ambil Semua Template Sertifikat (Preset Bawaan A, B, C, D + Template Kustom)
app.get('/api/admin/certificate-templates', async (req, res) => {
  try {
    const customTemplates = await db.getAllCertificateTemplates();
    const presets = Object.keys(certificateService.PRESET_TEMPLATES).map(key => {
      const p = certificateService.PRESET_TEMPLATES[key];
      return {
        id: `preset-${key.toLowerCase()}`,
        presetKey: key,
        nama: p.nama,
        theme: p.theme,
        qrPosition: p.defaultQrPosition,
        isPreset: true,
        patternIsi: p.patternIsi,
        pejabat: p.defaultPejabat
      };
    });
    res.json({
      success: true,
      presets: presets,
      customTemplates: customTemplates,
      all: [...presets, ...customTemplates]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat daftar template: ' + err.message });
  }
});

// 2. Upload Template Sertifikat Baru oleh Admin Kepegawaian (Terkunci & Berversi)
app.post('/api/admin/certificate-templates/upload', (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin || !['superadmin', 'admin'].includes(admin.role)) {
    return res.status(403).json({ success: false, message: 'Hanya Admin Kepegawaian yang diizinkan mengunggah template sertifikat.' });
  }

  uploadTemplate.single('templateFile')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'Berkas template (PNG atau PDF) wajib diunggah!' });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!['.png', '.pdf', '.jpg', '.jpeg'].includes(ext)) {
        return res.status(400).json({ success: false, message: 'Format berkas harus PNG atau PDF A4 Landscape!' });
      }

      let filePath = `/uploads/templates/${req.file.filename}`;
      if (typeof db.uploadToStorage === 'function') {
        try {
          const fileBuffer = fs.readFileSync(req.file.path);
          const storageUrl = await db.uploadToStorage('templates', req.file.filename, fileBuffer, req.file.mimetype);
          if (storageUrl) filePath = storageUrl;
        } catch (e) {}
      }

      const nama = (req.body.nama || req.file.originalname.replace(/\.[^/.]+$/, '')).trim();
      const basePreset = (req.body.basePreset || 'A').toUpperCase();
      const qrPosition = req.body.qrPosition === 'kiri' ? 'kiri' : 'kanan';
      const existingId = req.body.templateId;

      let versi = 1;
      let templateId = existingId || `tpl-${Date.now()}`;
      if (existingId) {
        const oldTpl = await db.getCertificateTemplateById(existingId);
        if (oldTpl) {
          versi = (parseInt(oldTpl.versi, 10) || 1) + 1;
        }
      }

      const configJson = {
        basePreset,
        qrPosition,
        patternIsi: req.body.patternIsi || undefined,
        pejabat: {
          nama: req.body.pejabatNama || 'Junaiddin Pagala, S.T., M.T.',
          nip: req.body.pejabatNip || '197606122002121004',
          jabatan: req.body.pejabatJabatan || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
        }
      };

      const record = await db.saveCertificateTemplate({
        id: templateId,
        nama,
        file_latar: filePath,
        config_json: configJson,
        versi,
        aktif: true,
        dibuat_oleh: admin.name || admin.username || 'Admin Kepegawaian'
      });

      res.json({
        success: true,
        message: `Template "${nama}" versi ${versi} berhasil disimpan dengan tata letak zona terkunci.`,
        template: record
      });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Gagal memproses template: ' + e.message });
    }
  });
});

// 3. Unduh Panduan Zona (Overlay Grid PDF) untuk Desainer Grafis
app.get('/api/admin/certificate-templates/overlay', async (req, res) => {
  try {
    const preset = (req.query.preset || 'A').toUpperCase();
    const qrPos = req.query.qrPosition === 'kiri' ? 'kiri' : 'kanan';
    const overlayBytes = await certificateService.generateZoneOverlayPdf(preset, qrPos);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Panduan_Zona_Template_Sertifikat.pdf"');
    res.setHeader('Content-Length', overlayBytes.length);
    res.send(Buffer.from(overlayBytes));
  } catch (err) {
    res.status(500).send('Gagal membuat file panduan zona overlay: ' + err.message);
  }
});

// 4. Pratinjau Template Sertifikat dengan Sampel Data ASN
app.get('/api/admin/certificate-templates/preview-sample.pdf', async (req, res) => {
  try {
    const presetKey = (req.query.preset || 'A').toUpperCase();
    const qrPosition = req.query.qrPosition === 'kiri' ? 'kiri' : 'kanan';
    const templateId = req.query.templateId;

    let customTpl = null;
    if (templateId && templateId.startsWith('tpl-')) {
      customTpl = await db.getCertificateTemplateById(templateId);
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const baseUrl = `${protocol}://${host}`;

    const templateObj = {
      presetKey,
      qrPosition,
      file_latar: customTpl ? resolveTemplatePath(customTpl.file_latar) : null,
      patternIsi: customTpl?.config_json?.patternIsi
    };

    const sampleData = {
      nomor: '0031/C6.26/Sertifikat/KP.04.00/2026',
      nama: 'Sri Wahyudi, S.Sos., M.AP.',
      nip: '198503152010011012',
      jabatan: 'Subbagian Tata Usaha & Kepegawaian',
      instansi: 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
      judul: 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN BPMP Sultra',
      tanggal: '18 - 20 November 2026',
      jp: 32,
      lokasi: 'BPMP Provinsi Sulawesi Tenggara',
      issuedAt: new Date().toISOString()
    };

    const result = await certificateService.generateCertificatePdf({
      template: templateObj,
      data: sampleData,
      token: 'sample-preview-token',
      baseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Pratinjau_Template_Sertifikat.pdf"');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.send(result.pdfBuffer);
  } catch (err) {
    res.status(500).send('Gagal membuat pratinjau sertifikat: ' + err.message);
  }
});

// 5. Penerbitan Sertifikat (Single & Bulk) - Penomoran Unik & Validasi Server Ketat
app.post('/api/admin/issue-certificates', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });
  }

  const { eventId, employeeIds, templateId } = req.body;
  if (!eventId || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ success: false, message: 'Event ID dan daftar ID Pegawai wajib dipilih.' });
  }

  const event = await db.getEventById(eventId);
  if (!event) return res.status(404).json({ success: false, message: 'Data kegiatan tidak ditemukan.' });

  const year = new Date().getFullYear();
  let nextSeq = await db.getNextCertificateSequence(year);

  const issuedList = [];
  const skippedList = [];

  for (const empId of employeeIds) {
    const employee = await db.getEmployeeByIdOrNip(empId);
    if (!employee) {
      skippedList.push({ id: empId, reason: 'Pegawai tidak ditemukan' });
      continue;
    }

    // SERVER-SIDE VALIDATION (Poin 9): Hanya jika Hadir DAN LPTI Disetujui!
    if (!employee.attended) {
      skippedList.push({ id: empId, name: employee.name, reason: 'Presensi belum Hadir di aula' });
      continue;
    }

    if (!employee.lpti || employee.lpti.status !== 'approved') {
      skippedList.push({ id: empId, name: employee.name, reason: 'Berkas LPTI belum Disetujui oleh admin' });
      continue;
    }

    // Penomoran sekuensial unik bebas tabrakan saat bulk (Poin 6)
    const certNumber = `${String(nextSeq).padStart(4, '0')}/C6.26/Sertifikat/KP.04.00/${year}`;
    nextSeq++;

    // Token acak unik untuk QR & URL publik (Poin 5)
    const certToken = crypto.randomBytes(16).toString('hex');

    // Cek apakah sebelumnya sudah ada sertifikat (Poin 7: Koreksi data = terbit ulang versi baru, lama dicabut)
    const existingCerts = await db.getCertificatesByEmployeeId(employee.id);
    const prevCert = existingCerts.find(c => c.event_id === eventId && c.status === 'valid');
    let versi = 1;

    if (prevCert) {
      await db.revokeCertificate(prevCert.id, 'Terbit ulang versi baru setelah koreksi data peserta');
      versi = (prevCert.versi || 1) + 1;
    }

    const issuedRecord = await db.saveIssuedCertificate({
      event_id: event.id,
      pegawai_id: employee.id,
      nomor: certNumber,
      token: certToken,
      template_id: templateId || event.templateId || 'preset-a',
      template_versi: 1,
      versi: versi,
      status: 'valid',
      issued_at: new Date().toISOString()
    });

    // Update profil pegawai
    await db.updateEmployee(employee.id, {
      certificate: {
        number: certNumber,
        token: certToken,
        issuedAt: issuedRecord.issued_at,
        verifier: 'Junaiddin Pagala, S.T., M.T.',
        verifierTitle: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
      }
    });

    issuedList.push({
      employeeId: employee.id,
      name: employee.name,
      nip: employee.nip,
      certNumber: certNumber,
      token: certToken,
      versi: versi
    });
  }

  res.json({
    success: true,
    message: `Berhasil menerbitkan ${issuedList.length} sertifikat resmi. (${skippedList.length} dilewati karena belum memenuhi syarat).`,
    issuedCount: issuedList.length,
    skippedCount: skippedList.length,
    issued: issuedList,
    skipped: skippedList
  });
});

// 6. Endpoint Verifikasi Publik Keabsahan E-Sertifikat (Poin 5)
// URL QR: {BASE_URL}/cek-sertifikat/{token}
app.get('/api/cek-sertifikat/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const cert = await db.getCertificateByToken(token);

    if (!cert) {
      // Fallback: periksa jika token adalah certNumber lama
      const legacyCert = await db.getCertificateByIdOrNumber(token);
      if (legacyCert) {
        return res.json({
          success: true,
          certificate: {
            nomor: legacyCert.certificate_number || legacyCert.number,
            nama: legacyCert.name || 'Aparatur Sipil Negara',
            judul: legacyCert.event_title || 'Pengembangan Kompetensi Senin Berseri',
            tanggal: certificateService.formatTanggalIndonesia(legacyCert.issued_at),
            status: 'Resmi Terverifikasi (Valid)',
            statusRaw: 'valid'
          }
        });
      }

      return res.status(404).json({
        success: false,
        message: 'Sertifikat tidak ditemukan atau token verifikasi tidak valid dalam pangkalan data resmi BPMP Sultra.'
      });
    }

    const employee = await db.getEmployeeByIdOrNip(cert.pegawai_id);
    const event = (cert.event_id ? await db.getEventById(cert.event_id) : await db.getActiveEvent()) || {};

    const isValid = cert.status === 'valid';
    res.json({
      success: true,
      certificate: {
        nomor: cert.nomor,
        nama: employee ? employee.name : 'Aparatur Sipil Negara',
        judul: event.title || 'Pengembangan Kompetensi ASN BPMP Sultra',
        tanggal: certificateService.formatTanggalIndonesia(event.schedule || cert.issued_at),
        status: isValid ? 'Resmi Terverifikasi (Valid)' : 'Dicabut (Revoked)',
        statusRaw: cert.status,
        revocationReason: cert.revocation_reason || null,
        revokedAt: cert.revoked_at ? certificateService.formatTanggalIndonesia(cert.revoked_at) : null,
        versi: cert.versi || 1,
        issuedAt: certificateService.formatTanggalIndonesia(cert.issued_at)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memverifikasi sertifikat: ' + err.message });
  }
});

// Route Tampilan Web Verifikasi Publik
app.get('/cek-sertifikat/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'cek-sertifikat.html'));
});

app.delete('/api/event/template', async (req, res) => {
  const targetEventId = req.body?.eventId || req.query?.eventId;
  await db.updateEventTemplate(targetEventId, null);
  res.json({ success: true, message: 'Template kustom berhasil dihapus. Event kembali menggunakan desain piagam standar resmi.' });
});

app.post('/api/event/cert-settings', async (req, res) => {
  const { eventId, prefix, nomorYRatio, namaYRatio, namaFontSize, nomorFontSize, showUnderline } = req.body;
  const targetEventId = eventId;

  const parseRatio = (v, def) => {
    if (v === undefined || v === null || v === '') return def;
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    if (isNaN(n)) return def;
    const normalized = n > 1 ? n / 100 : n;
    return Math.max(0.05, Math.min(0.95, normalized));
  };

  const certSettings = {
    prefix: (prefix || '800.1.3/SERT-LPTI/2026').trim(),
    nomorYRatio: parseRatio(nomorYRatio, 0.72),
    namaYRatio: parseRatio(namaYRatio, 0.50),
    namaFontSize: Math.max(14, Math.min(48, parseInt(namaFontSize, 10) || 26)),
    nomorFontSize: Math.max(8, Math.min(24, parseInt(nomorFontSize, 10) || 11)),
    showUnderline: showUnderline !== false
  };

  const updated = await db.updateEventCertSettings(targetEventId, certSettings);

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
    const event = (targetEventId ? await db.getEventById(targetEventId) : await db.getActiveEvent()) || {};
    const certConfig = event.certSettings || {};

    const templatePath = resolveTemplatePath(event.certificateTemplate?.filePath);

    // Nilai koordinat dapat dioverride langsung dari parameter query untuk Instant Live Testing
    const parseParam = (param, fallback) => {
      if (param === undefined || param === null || param === '') return fallback;
      const n = parseFloat(String(param).replace(',', '.'));
      if (isNaN(n)) return fallback;
      return n > 1 ? n / 100 : n;
    };

    const finalPrefix = (req.query.prefix || certConfig.prefix || '800.1.3/SERT-LPTI/2026').trim();
    const finalNomorY = parseParam(req.query.nomorY, certConfig.nomorYRatio || 0.72);
    const finalNamaY = parseParam(req.query.namaY, certConfig.namaYRatio || 0.50);
    const finalNamaSize = parseInt(req.query.namaSize || certConfig.namaFontSize || 26, 10);
    const finalNomorSize = parseInt(req.query.nomorSize || certConfig.nomorFontSize || 11, 10);
    const finalShowUnderline = req.query.showUnderline !== undefined ? (req.query.showUnderline === 'true' || req.query.showUnderline === '1') : (certConfig.showUnderline !== false);

    const sampleCertNumber = `${finalPrefix}/001`;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    
    const sampleCrypto = signCertificate({
      certNumber: sampleCertNumber,
      employeeNip: '197606122002121004',
      employeeName: 'Junaiddin Pagala, ST, M.T.',
      eventTitle: event.title || 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN',
      eventJp: event.jp || 32,
      issuedAt: new Date().toISOString()
    });
    const sampleVerifyUrl = `${protocol}://${host}/sertifikat/${sampleCrypto.certId}`;

    const pdfBuffer = await generateCertificatePdf({
      templatePath: templatePath,
      certNumber: sampleCertNumber,
      certId: sampleCrypto.certId,
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
      verifyUrl: sampleVerifyUrl,
      nomorYRatio: finalNomorY,
      namaYRatio: finalNamaY,
      namaFontSize: finalNamaSize,
      nomorFontSize: finalNomorSize,
      showUnderline: finalShowUnderline
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Sample_Certificate_Preview.pdf"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Length', pdfBuffer.length);
    // Simpan berkas PDF sertifikat ke database (tabel files)
    if (typeof db.uploadToStorage === 'function') {
      try {
        db.uploadToStorage('certificates', filename, Buffer.from(pdfBuffer), 'application/pdf').catch(() => {});
      } catch (e) {}
    }

    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    console.error('Error sample cert PDF:', error);
    res.status(500).send('Gagal menghasilkan preview sample PDF: ' + error.message);
  }
});

// ========================================================
// SYSTEM HEALTH CHECK
// ========================================================
app.get('/api/system/status', async (req, res) => {
  const isAvailable = Boolean(db.isSupabaseAvailable && db.isSupabaseAvailable());
  res.json({
    status: 'healthy',
    time: new Date().toISOString(),
    isVercel: Boolean(process.env.VERCEL),
    database: isAvailable ? 'Supabase PostgreSQL (Cloud)' : 'Local Storage Fallback',
    supabaseConnected: isAvailable
  });
});

// ========================================================
// EMPLOYEES & LPTI VERIFICATION APIs
// ========================================================
app.get('/api/employees', async (req, res) => {
  const employees = await db.getAllEmployees();
  const activeEvent = await db.getActiveEvent();
  const allEvents = await db.getAllEvents();
  res.json({ success: true, employees, event: activeEvent, events: allEvents });
});

app.get('/api/employees/:id', async (req, res) => {
  const emp = await db.getEmployeeByIdOrNip(req.params.id);
  if (!emp) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
  let targetEvent = null;
  const requestedEventId = req.query.eventId || req.query.event;
  if (requestedEventId) {
    targetEvent = await db.getEventById(requestedEventId);
  }
  if (!targetEvent) {
    targetEvent = await db.getActiveEvent();
  }
  const derivedStatus = getEventDerivedStatus(targetEvent);
  res.json({ success: true, employee: emp, event: targetEvent, derivedStatus });
});

// Endpoint Event Mendatang (Akan Datang)
app.get('/api/events/upcoming', async (req, res) => {
  try {
    const allEvents = await db.getAllEvents();
    const upcomingEvents = (allEvents || [])
      .filter(ev => ev.status !== 'completed')
      .map(ev => {
        const derived = getEventDerivedStatus(ev);
        return {
          id: ev.id,
          title: ev.title,
          schedule: ev.schedule,
          location: ev.location,
          jp: ev.jp || 2,
          category: ev.category || 'Pelatihan ASN',
          status: ev.status,
          active: ev.active,
          derivedStatus: derived
        };
      })
      .slice(0, 10);

    res.json({ success: true, events: upcomingEvents });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil event mendatang: ' + err.message });
  }
});

// Endpoint Riwayat Pelatihan Khusus Pegawai Login
app.get('/api/employees/:id/history', async (req, res) => {
  try {
    const cleanId = String(req.params.id).trim();
    const emp = await db.getEmployeeByIdOrNip(cleanId);
    if (!emp) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });

    const requestedYear = req.query.year ? String(req.query.year).trim() : null;
    const allEvents = await db.getAllEvents();

    // Bangun daftar riwayat pelatihan yang relevan
    const historyItems = [];
    (allEvents || []).forEach(ev => {
      // Event yang belum lewat tanggal atau dibatalkan dan belum pernah dihadiri pegawai tidak masuk Riwayat
      const isAttended = Boolean(emp.attended && (emp.eventId === ev.id || !emp.eventId));
      const isCompleted = ev.status === 'completed';
      const hasCertificate = Boolean(emp.certificate && (emp.eventId === ev.id || !emp.eventId));

      if (isCompleted || isAttended || hasCertificate) {
        const yearMatch = (ev.schedule || '').match(/\b(20\d\d)\b/);
        const itemYear = yearMatch ? yearMatch[1] : '2026';

        if (!requestedYear || requestedYear === 'all' || itemYear === requestedYear) {
          const lptiStatus = (emp.eventId === ev.id || !emp.eventId) ? (emp.lpti?.status || 'none') : 'none';
          const lptiNote = (emp.eventId === ev.id || !emp.eventId) ? (emp.lpti?.revisionNote || '') : '';
          const cert = (emp.eventId === ev.id || !emp.eventId) ? emp.certificate : null;

          historyItems.push({
            eventId: ev.id,
            title: ev.title,
            schedule: ev.schedule,
            location: ev.location,
            jp: ev.jp || 2,
            category: ev.category || 'Pelatihan ASN',
            year: itemYear,
            attended: isAttended,
            attendedAt: isAttended ? (emp.attendedAt || ev.completedAt || 'Terverifikasi') : null,
            lptiStatus: lptiStatus,
            lptiRevisionNote: lptiNote,
            certificate: cert,
            certificatePdfUrl: cert ? `/api/employees/${emp.nip || emp.id}/certificate.pdf` : null
          });
        }
      }
    });

    // Hitung total JP yang berhasil diselesaikan (Hadir dan LPTI disetujui / sertifikat terbit)
    const targetYearJp = parseInt(process.env.TARGET_ANNUAL_JP || '20', 10);
    const totalJpCompleted = historyItems
      .filter(item => item.attended && (item.lptiStatus === 'approved' || item.certificate))
      .reduce((sum, item) => sum + (item.jp || 0), 0);

    res.json({
      success: true,
      employee: {
        id: emp.id,
        nip: emp.nip,
        name: emp.name,
        jabatan: emp.jabatan,
        faceRegistered: emp.faceRegistered
      },
      targetYearJp,
      totalJpCompleted,
      history: historyItems
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat pegawai: ' + err.message });
  }
});

app.post('/api/employees/:id/upload-lpti', (req, res) => {
  upload.single('lptiFile')(req, res, async function (err) {
    try {
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

      const employee = await db.getEmployeeByIdOrNip(req.params.id);
      if (!employee) {
        if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
      }

      if (!employee.attended) {
        if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Anda belum melakukan Presensi Kehadiran. Silakan scan Dynamic QR Code di aula terlebih dahulu!'
        });
      }

      let uploadedFilePath = `/uploads/lpti/${req.file.filename}`;
      if (supabaseAdapter && typeof supabaseAdapter.isSupabaseAvailable === 'function' && supabaseAdapter.isSupabaseAvailable() && req.file.path && fs.existsSync(req.file.path)) {
        try {
          const fileBuffer = fs.readFileSync(req.file.path);
          const storageUrl = await supabaseAdapter.uploadToStorage('lpti', req.file.filename, fileBuffer, req.file.mimetype);
          if (storageUrl) uploadedFilePath = storageUrl;
        } catch (storageErr) {
          console.warn('Gagal upload LPTI ke Supabase Storage:', storageErr.message);
        }
      }

      const updatedEmployee = await db.updateEmployeeLpti(employee.id, {
        fileName: req.file.filename,
        fileOriginalName: req.file.originalname,
        filePath: uploadedFilePath,
        fileSize: req.file.size
      });

      return res.json({
        success: true,
        message: 'Berkas LPTI berhasil diunggah! Berkas Anda saat ini berstatus "Menunggu Persetujuan Kepegawaian".',
        employee: updatedEmployee
      });
    } catch (unhandledErr) {
      console.error('Unhandled upload-lpti error:', unhandledErr);
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan sistem saat memproses berkas LPTI: ' + unhandledErr.message
      });
    }
  });
});

// ==============================================================
// FITUR KURASI LPTI MULTI-STAF: KLAIM, RELEASE, HEARTBEAT, DECISION
// ==============================================================

// ==============================================================
// DAFTAR VERIFIKATOR RESMI LPTI KEPEGAWAIAN (3 NIP RESMI)
// 198002122002122002: Umi Jariyah, SH.
// 199203122025212048: Andi Tenri Mayasari, S.H.
// 199306042025212053: Indriani Saputri, S.IK.
// ==============================================================
const AUTHORIZED_LPTI_VERIFIERS = [
  '198002122002122002', // Umi Jariyah, SH.
  '199203122025212048', // Andi Tenri Mayasari, S.H.
  '199306042025212053'  // Indriani Saputri, S.IK.
];

function isAuthorizedLptiVerifier(admin) {
  if (!admin) return false;
  const username = String(admin.username || admin.nip || '').trim();
  const role = admin.peran || admin.role || '';
  
  // Superadmin memiliki wewenang penuh
  if (role === 'superadmin' || username.toLowerCase() === 'superadmin') {
    return true;
  }
  
  // Hanya 3 verifikator resmi Kepegawaian yang diizinkan
  if (AUTHORIZED_LPTI_VERIFIERS.includes(username)) {
    return true;
  }

  // Dukungan lingkungan pengujian lokal (unit test / non-production)
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  if (!isProd && ['admin', 'staf_kurasi_1', 'staf2', 'staf_ani', 'staf_budi'].includes(username)) {
    return true;
  }

  return false;
}

// 1. Klaim Berkas LPTI (15 Menit Lock)
app.post('/api/admin/lpti/:id/claim', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_VERIFIER',
      message: 'Akses Ditolak: Hanya Tim Verifikator LPTI resmi (Umi Jariyah, SH. / Andi Tenri Mayasari, S.H. / Indriani Saputri, S.IK.) atau Superadmin yang berwenang mengklaim berkas LPTI.'
    });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const result = await db.claimLpti(req.params.id, admin, clientIp, 15);

  if (!result.success) {
    if (result.code === 'ALREADY_CLAIMED') {
      return res.status(409).json(result);
    }
    return res.status(400).json(result);
  }

  res.json({
    success: true,
    message: `Berkas LPTI berhasil diklaim untuk diperiksa selama 15 menit.`,
    ...result
  });
});

// 2. Perpanjang Klaim LPTI (Heartbeat)
app.post('/api/admin/lpti/:id/heartbeat', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({ success: false, message: 'Hak akses tidak memadai untuk perpanjangan klaim LPTI.' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const result = await db.claimLpti(req.params.id, admin, clientIp, 15);

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json({
    success: true,
    message: 'Durasi klaim berhasil diperpanjang 15 menit.',
    claimed_until: result.diklaim_sampai
  });
});

// 3. Lepas Klaim LPTI
app.post('/api/admin/lpti/:id/release', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({ success: false, message: 'Hak akses tidak memadai untuk melepas klaim LPTI.' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const result = await db.releaseLptiClaim(req.params.id, admin, clientIp);

  if (!result.success) {
    return res.status(403).json(result);
  }

  res.json({ success: true, message: 'Klaim LPTI berhasil dilepas.' });
});

// 4. Verifikasi LPTI (Setujui / Revisi dengan Optimistic Locking)
app.post('/api/employees/:id/verify-lpti', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_VERIFIER',
      message: 'Akses Ditolak: Hanya Tim Verifikator LPTI resmi (Umi Jariyah, SH. / Andi Tenri Mayasari, S.H. / Indriani Saputri, S.IK.) atau Superadmin yang berwenang menyetujui atau merevisi berkas LPTI.'
    });
  }

  const { action, revisionNote, catatan, versi } = req.body;
  if (!action || !['approve', 'revise'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Aksi verifikasi harus "approve" atau "revise".' });
  }

  const employee = await db.getEmployeeByIdOrNip(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const targetVersi = parseInt(versi !== undefined ? versi : employee.lpti?.versi || 1, 10);
  const empEvtId = employee.eventId;
  const event = (empEvtId ? await db.getEventById(empEvtId) : await db.getActiveEvent()) || {};

  if (action === 'approve') {
    // Generate nomor sertifikat jika belum ada
    let certNumber = employee.certificate?.number;
    if (!certNumber) {
      const year = new Date().getFullYear();
      const nextSeq = await db.getNextCertificateSequence(year);
      certNumber = `${String(nextSeq).padStart(4, '0')}/C6.26/Sertifikat/KP.04.00/${year}`;
    }

    const result = await db.approveLpti(
      employee.id,
      targetVersi,
      admin,
      clientIp,
      catatan || 'Berkas LPTI disetujui.',
      event.jp || 4,
      certNumber,
      'Junaiddin Pagala, S.T., M.T.',
      'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
    );

    if (!result.success) {
      if (result.code === 'CONFLICT') {
        return res.status(409).json(result);
      }
      return res.status(400).json(result);
    }

    const updatedEmployee = await db.getEmployeeByIdOrNip(employee.id);
    return res.json({
      success: true,
      message: `Berkas LPTI ${employee.name} berhasil DISETUJUI oleh ${admin.name || admin.username}! E-Sertifikat nomor ${certNumber} diterbitkan.`,
      employee: updatedEmployee
    });
  } else {
    // Aksi: Revise (Alasan wajib diisi)
    const reasonText = (revisionNote || catatan || '').trim();
    if (!reasonText) {
      return res.status(400).json({ success: false, message: 'Catatan / alasan revisi wajib diisi agar pegawai mengetahui perbaikan yang diperlukan!' });
    }

    const result = await db.reviseLpti(
      employee.id,
      targetVersi,
      admin,
      clientIp,
      reasonText
    );

    if (!result.success) {
      if (result.code === 'CONFLICT') {
        return res.status(409).json(result);
      }
      return res.status(400).json(result);
    }

    const updatedEmployee = await db.getEmployeeByIdOrNip(employee.id);
    return res.json({
      success: true,
      message: `Catatan revisi untuk ${employee.name} berhasil dikirim ke portal pegawai. Akses sertifikat tetap terkunci.`,
      employee: updatedEmployee
    });
  }
});

// 5. Pembatalan Persetujuan LPTI (Khusus Superadmin dengan Alasan Wajib)
app.post('/api/admin/lpti/:id/cancel-approval', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  const peran = admin.peran || admin.role || 'kepegawaian';
  if (peran !== 'superadmin') {
    return res.status(403).json({
      success: false,
      message: 'Hanya Super Administrator yang berwenang membatalkan persetujuan LPTI.'
    });
  }

  const { reason } = req.body;
  if (!reason || !String(reason).trim() || String(reason).trim().length < 5) {
    return res.status(400).json({
      success: false,
      message: 'Alasan pembatalan persetujuan wajib diisi secara jelas (minimal 5 karakter)!'
    });
  }

  const employee = await db.getEmployeeByIdOrNip(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const empEvtId = employee.eventId;
  const event = (empEvtId ? await db.getEventById(empEvtId) : await db.getActiveEvent()) || {};

  const result = await db.cancelLptiApproval(employee.id, admin, clientIp, String(reason).trim(), event.jp || 4);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // Catat aksi superadmin di aktivitas_log
  await db.recordActivityLog(
    admin.username || admin.id,
    admin.name || admin.username,
    'BATALKAN_PERSETUJUAN_LPTI',
    employee.nip,
    `Membatalkan persetujuan LPTI pegawai ${employee.name}. Alasan: ${String(reason).trim()}`,
    clientIp
  );

  const updatedEmployee = await db.getEmployeeByIdOrNip(employee.id);
  res.json({
    success: true,
    message: `Persetujuan LPTI untuk ${employee.name} berhasil dibatalkan. Status dikembalikan ke "Perlu Dikurasi".`,
    employee: updatedEmployee
  });
});

// 6. Riwayat Timeline Kurasi LPTI (Append-Only)
app.get('/api/employees/:id/lpti-history', async (req, res) => {
  try {
    const employee = await db.getEmployeeByIdOrNip(req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });

    const history = await db.getLptiHistory(employee.id);
    res.json({
      success: true,
      pegawai_id: employee.id,
      name: employee.name,
      nip: employee.nip,
      history: history || []
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat LPTI: ' + err.message });
  }
});

// 7. Ambil LPTI Berikutnya (Queue Next Unclaimed)
app.post('/api/admin/lpti/next-unclaimed', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({ success: false, message: 'Hak akses tidak memadai untuk mengambil antrean LPTI.' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const result = await db.getNextUnclaimedLpti(admin, clientIp);
  if (!result.success) {
    return res.status(result.code === 'NO_PENDING_LPTI' ? 404 : 400).json(result);
  }

  res.json(result);
});

// 8. Bulk Approve LPTI
app.post('/api/admin/lpti/bulk-approve', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  if (!isAuthorizedLptiVerifier(admin)) {
    return res.status(403).json({ success: false, message: 'Akses Ditolak: Hanya Tim Verifikator LPTI resmi atau Superadmin yang berwenang melakukan persetujuan massal berkas LPTI.' });
  }

  const { employeeIds, catatan } = req.body;
  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ success: false, message: 'Pilih minimal satu pegawai untuk disetujui berkas LPTI-nya.' });
  }

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const result = await db.bulkApproveLpti(employeeIds, admin, clientIp, catatan);
  res.json(result);
});

// 9. Log Aktivitas (Audit Trail)
app.get('/api/admin/activity-logs', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });

  const filters = {
    aksi: req.query.aksi || null,
    aktor_id: req.query.staf || null,
    limit: parseInt(req.query.limit, 10) || 100
  };

  const logs = await db.getActivityLogs(filters);
  res.json({ success: true, logs });
});

// 10. Ekspor Log Aktivitas (CSV)
app.get('/api/admin/activity-logs/export', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) return res.status(401).send('Autentikasi admin diperlukan.');

  const logs = await db.getActivityLogs({ limit: 1000 });
  const headers = ['ID', 'Waktu (ISO)', 'Aktor ID', 'Nama Staf', 'Aksi', 'Target', 'Keterangan', 'IP'];
  const rows = logs.map(l => [
    l.id || '',
    l.created_at || '',
    `"${(l.aktor_id || '').replace(/"/g, '""')}"`,
    `"${(l.aktor_nama || '').replace(/"/g, '""')}"`,
    `"${(l.aksi || '').replace(/"/g, '""')}"`,
    `"${(l.target || '').replace(/"/g, '""')}"`,
    `"${(l.keterangan || '').replace(/"/g, '""')}"`,
    `"${(l.ip || '').replace(/"/g, '""')}"`
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const filename = `LOG_AKTIVITAS_SENIN_BERSERI_${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
});

// Metadata E-Sertifikat
app.get('/api/employees/:id/certificate', async (req, res) => {
  const employee = await db.getEmployeeByIdOrNip(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });

  if (employee.lpti?.status !== 'approved' || !employee.certificate) {
    return res.status(403).json({
      success: false,
      message: 'E-Sertifikat masih terkunci. Berkas LPTI Anda harus disetujui oleh Admin Kepegawaian terlebih dahulu.'
    });
  }

  const empEvtId = employee.eventId;
  const event = (empEvtId ? await db.getEventById(empEvtId) : await db.getActiveEvent()) || {};

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;

  const certCrypto = signCertificate({
    certNumber: employee.certificate.number,
    employeeNip: employee.nip,
    employeeName: employee.name,
    eventTitle: event.title || 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN',
    eventJp: event.jp || 4,
    issuedAt: employee.certificate.issuedAt
  });
  const certId = certCrypto.certId;
  const verifyUrl = `${protocol}://${host}/sertifikat/${certId}`;

  const certQrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 180,
    color: { dark: '#0c233c', light: '#ffffff' }
  });

  res.json({
    success: true,
    certificate: {
      certId: certId,
      number: employee.certificate.number,
      issuedAt: employee.certificate.issuedAt,
      verifier: employee.certificate.verifier,
      verifierTitle: employee.certificate.verifierTitle || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      employeeName: employee.name,
      employeeNip: employee.nip,
      employeeJabatan: employee.jabatan,
      employeeInstansi: employee.instansi,
      eventTitle: event.title || 'Pelatihan Kepegawaian ASN',
      eventJp: event.jp || 4,
      eventCategory: event.category || 'Teknis & Manajerial Kepegawaian',
      eventSchedule: event.schedule || 'Jadwal Ditentukan',
      eventLocation: event.location || 'Auditorium Sasana Praja',
      qrVerification: certQrDataUrl,
      verifyUrl: verifyUrl,
      cryptoHash: certCrypto.sha256Digest,
      cryptoSignature: certCrypto.signatureHex,
      pdfDownloadUrl: `/api/employees/${employee.nip || employee.id}/certificate.pdf?download=true`,
      pdfPreviewUrl: `/api/employees/${employee.nip || employee.id}/certificate.pdf`,
      template: event.certificateTemplate || null,
      certSettings: event.certSettings || null
    }
  });
});

// Unduh / Streaming Asli PDF E-Sertifikat Pegawai (Dibatasi ID Sesi & Generator Template Terkunci)
app.get('/api/employees/:id/certificate.pdf', async (req, res) => {
  try {
    const employee = await db.getEmployeeByIdOrNip(req.params.id);
    if (!employee) return res.status(404).send('Data pegawai tidak ditemukan.');

    // Validasi Keamanan Akses: Pegawai hanya boleh unduh sertifikat miliknya sendiri
    const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
    if (!admin) {
      const requesterNip = getEmployeeFromRequest(req);
      if (requesterNip && requesterNip !== employee.nip && requesterNip !== employee.id) {
        return res.status(403).send('Akses Ditolak: Anda hanya memiliki izin untuk mengunduh e-sertifikat atas nama Anda sendiri.');
      }
    }

    if (employee.lpti?.status !== 'approved' || !employee.certificate) {
      return res.status(403).send('E-Sertifikat masih terkunci atau belum disetujui admin.');
    }

    const empEvtId = employee.eventId;
    const event = (empEvtId ? await db.getEventById(empEvtId) : await db.getActiveEvent()) || {};

    // Dapatkan data sertifikat terbit dari tabel sertifikat
    const certList = await db.getCertificatesByEmployeeId(employee.id);
    const certRecord = certList.find(c => c.status === 'valid') || {};
    const certNumber = certRecord.nomor || employee.certificate.number || '0001/C6.26/Sertifikat/KP.04.00/2026';
    
    // Gunakan ID verifikasi 12 karakter Crockford Base32 yang konsisten & deterministik
    const cleanCertId = certRecord.id || certRecord.cert_id || (certRecord.token && certRecord.token.length === 12 ? certRecord.token : generateCertId(certNumber, employee.nip));
    const certToken = cleanCertId;

    // Pastikan tersimpan dan terindeks di pangkalan data certificates
    try {
      await db.saveCertificate({
        id: cleanCertId,
        certId: cleanCertId,
        number: certNumber,
        certificate_number: certNumber,
        name: employee.name,
        nip: employee.nip,
        eventId: employee.eventId,
        eventTitle: event.title || 'Pengembangan Kompetensi ASN BPMP Sultra',
        issuedAt: employee.certificate.issuedAt || certRecord.issued_at || new Date().toISOString(),
        status: 'valid',
        token: certToken,
        is_dummy: false
      });
    } catch (saveErr) {
      console.warn('Auto-index certificate notice:', saveErr.message);
    }

    // Dapatkan template yang ditentukan event atau preset default
    const templateId = event.templateId || certRecord.template_id;
    let customTemplate = null;
    if (templateId && templateId.startsWith('tpl-')) {
      customTemplate = await db.getCertificateTemplateById(templateId);
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
    const baseUrl = `${protocol}://${host}`;

    const templateObj = {
      presetKey: customTemplate?.config_json?.basePreset || 'A',
      qrPosition: customTemplate?.config_json?.qrPosition || 'kanan',
      file_latar: customTemplate ? resolveTemplatePath(customTemplate.file_latar) : resolveTemplatePath(event.certificateTemplate?.filePath),
      patternIsi: customTemplate?.config_json?.patternIsi
    };

    const certData = {
      nomor: certNumber,
      nama: employee.name,
      nip: employee.nip,
      jabatan: employee.jabatan || employee.position || 'Aparatur Sipil Negara',
      instansi: employee.instansi || 'BPMP Provinsi Sulawesi Tenggara',
      judul: event.title || 'Pengembangan Kompetensi ASN BPMP Sultra',
      tanggal: event.schedule || 'Tahun 2026',
      jp: event.jp || 4,
      lokasi: event.location || 'BPMP Provinsi Sulawesi Tenggara',
      issuedAt: employee.certificate.issuedAt || certRecord.issued_at || new Date().toISOString()
    };

    const result = await certificateService.generateCertificatePdf({
      template: templateObj,
      data: {
        ...certData,
        certId: cleanCertId,
        id: cleanCertId
      },
      token: cleanCertId,
      baseUrl: baseUrl
    });

    const isDownload = req.query.download === 'true';
    const filename = `Sertifikat_${employee.nip}_${(employee.name || 'Pegawai').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Length', result.pdfBuffer.length);

    // Simpan berkas PDF sertifikat ke database (tabel files) jika storage tersedia
    if (typeof db.uploadToStorage === 'function') {
      try {
        db.uploadToStorage('certificates', filename, result.pdfBuffer, 'application/pdf').catch(() => {});
      } catch (e) {}
    }

    res.send(result.pdfBuffer);
  } catch (error) {
    console.error('Error cert PDF:', error);
    res.status(500).send('Gagal menghasilkan e-sertifikat PDF: ' + error.message);
  }
});

// ========================================================
// RATE LIMITING & KEAMANAN VERIFIKASI E-SERTIFIKAT PUBLIK
// ========================================================
const verifyRateLimitMap = new Map();
function checkVerifyRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReq = 40;

  const record = verifyRateLimitMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count++;
  }
  verifyRateLimitMap.set(ip, record);

  // Bersihkan entri kedaluwarsa berkala
  if (verifyRateLimitMap.size > 1000) {
    for (const [k, v] of verifyRateLimitMap.entries()) {
      if (now > v.resetTime) verifyRateLimitMap.delete(k);
    }
  }

  if (record.count > maxReq) {
    return res.status(429).json({
      success: false,
      message: 'Terlalu banyak permintaan verifikasi sertifikat dari alamat IP Anda. Silakan coba kembali dalam 1 menit.'
    });
  }
  next();
}

// ========================================================
// API Verifikasi Data Sertifikat (Dicoding-Style & Kriptografi)
// ========================================================
app.get('/api/verify-certificate-data/:query', checkVerifyRateLimit, async (req, res) => {
  try {
    const rawQuery = decodeURIComponent(req.params.query || '').trim();
    const upperQuery = rawQuery.toUpperCase();

    // 1. Validasi Format ID: 12 karakter aman tanpa karakter mirip (0/O, 1/I)
    // Jika tidak valid, kembalikan 404 seragam tanpa membedakan "format salah" vs "tidak ada" (anti-enumerasi)
    if (!isValidCertIdFormat(upperQuery)) {
      return res.status(404).json({
        success: false,
        found: false,
        message: 'Sertifikat dengan ID verifikasi tersebut tidak ditemukan dalam pangkalan data resmi.'
      });
    }

    // 2. Cari di database certificates
    let dbCert = null;
    if (typeof db.getCertificateByIdOrNumber === 'function') {
      try {
        dbCert = await db.getCertificateByIdOrNumber(upperQuery);
      } catch (e) {}
    }

    // Fallback: periksa token
    if (!dbCert && typeof db.getCertificateByToken === 'function') {
      try {
        dbCert = await db.getCertificateByToken(upperQuery);
      } catch (e) {}
    }

    // Fallback: cari di profil pegawai
    if (!dbCert) {
      const employees = await db.getAllEmployees();
      for (const emp of employees) {
        if (!emp.certificate || !emp.certificate.number) continue;
        const certNum = emp.certificate.number;
        const certId = generateCertId(certNum, emp.nip);
        const legacyMd5 = crypto.createHash('md5').update(`${emp.nip}-${certNum}`).digest('hex').toUpperCase();
        const storedToken = String(emp.certificate.token || '').trim().toUpperCase();

        if (
          certId === upperQuery || 
          legacyMd5 === upperQuery || 
          (storedToken && storedToken === upperQuery) ||
          String(certNum).trim().toUpperCase() === upperQuery
        ) {
          dbCert = {
            id: certId,
            certificate_number: certNum,
            name: emp.name,
            nip: emp.nip,
            event_id: emp.eventId,
            event_title: emp.eventTitle,
            issued_at: emp.certificate.issuedAt || new Date().toISOString(),
            status: 'valid',
            is_dummy: false
          };
          // Simpan ke database certificates agar berikutnya instan
          try {
            await db.saveCertificate(dbCert);
          } catch (_) {}
          break;
        }
      }
    }

    if (!dbCert) {
      return res.status(404).json({
        success: false,
        found: false,
        message: 'Sertifikat dengan ID verifikasi tersebut tidak ditemukan dalam pangkalan data resmi.'
      });
    }

    // Ambil metadata event jika tersedia
    let eventTitle = dbCert.event_title || 'Pengembangan Kompetensi ASN: Senin Berseri';
    let eventDates = 'Tahun 2026';
    let eventJp = 2;

    if (dbCert.event_id) {
      try {
        const ev = await db.getEventById(dbCert.event_id);
        if (ev) {
          eventTitle = ev.title || eventTitle;
          eventDates = ev.schedule || ev.date || eventDates;
          eventJp = ev.jp || eventJp;
        }
      } catch (_) {}
    }

    const isDummy = Boolean(dbCert.is_dummy || String(dbCert.id).startsWith('TEST'));
    const isRevoked = dbCert.status === 'revoked';

    // Respons Publik Ter-sanitasi: TIDAK MENGIRIM NIP ATAU DATA INTERNAL KE KLIEN
    const publicCertificate = {
      certId: dbCert.id,
      number: dbCert.certificate_number,
      recipientName: dbCert.name || 'Aparatur Sipil Negara',
      eventTitle: eventTitle,
      eventDates: eventDates,
      eventJp: eventJp,
      issuedAt: dbCert.issued_at,
      verifier: dbCert.verifier || 'Junaiddin Pagala, S.T., M.T.',
      verifierTitle: dbCert.verifier_title || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      status: isRevoked ? 'revoked' : 'valid',
      isDummy: isDummy,
      cryptoHash: dbCert.crypto_hash,
      cryptoSignature: dbCert.crypto_signature
    };

    if (isRevoked) {
      publicCertificate.revokedAt = dbCert.revoked_at || dbCert.updated_at || dbCert.issued_at;
      publicCertificate.revocationReason = dbCert.revocation_reason || 'Pencabutan dokumen resmi: Terdapat pembaharuan data kompetensi atau penerbitan sertifikat versi revisi.';
      publicCertificate.previewUrl = null;
      publicCertificate.pdfUrl = null;
    } else {
      publicCertificate.previewUrl = dbCert.pdf_url || `/api/certificates/${dbCert.id}/preview.pdf`;
      publicCertificate.pdfUrl = dbCert.pdf_url || `/api/certificates/${dbCert.id}/preview.pdf`;
    }

    res.json({
      success: true,
      found: true,
      certificate: publicCertificate
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memverifikasi sertifikat: ' + err.message });
  }
});

// Endpoint Pratinjau PDF Sertifikat Publik / Verifikasi
app.get('/api/certificates/:id/preview.pdf', async (req, res) => {
  try {
    const certId = decodeURIComponent(req.params.id || '').trim().toUpperCase();
    let cert = await db.getCertificateByIdOrNumber(certId);
    if (!cert && typeof db.getCertificateByToken === 'function') {
      cert = await db.getCertificateByToken(certId);
    }

    if (!cert || cert.status === 'revoked') {
      return res.status(404).send('Berkas sertifikat tidak ditemukan atau telah dicabut.');
    }

    if (cert.pdf_url && (cert.pdf_url.startsWith('http://') || cert.pdf_url.startsWith('https://'))) {
      return res.redirect(cert.pdf_url);
    }

    // Buat pratinjau PDF on the fly jika belum ada file statis
    const certPdf = await certificateService.generateCertificatePdf({
      template: { presetKey: cert.template_id?.includes('b') ? 'B' : 'A', qrPosition: 'kanan' },
      data: {
        certId: cert.id,
        nomor: cert.certificate_number,
        nama: cert.name,
        nip: cert.nip || '-',
        judul: cert.event_title || 'Pengembangan Kompetensi ASN Senin Berseri',
        tanggal: 'Tahun 2026',
        jp: 2,
        lokasi_instansi: 'Aula Utama BPMP Provinsi Sulawesi Tenggara'
      },
      token: cert.id,
      baseUrl: getProductionBaseUrl()
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Sertifikat-${cert.id}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(certPdf.pdfBuffer);
  } catch (err) {
    res.status(500).send('Gagal memuat pratinjau sertifikat: ' + err.message);
  }
});

// Halaman Uji Coba Sertifikat Dummy Admin
app.get('/admin/uji-sertifikat', (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || Boolean(process.env.VERCEL);
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  const isSuperadmin = admin && (admin.role === 'superadmin' || admin.peran === 'superadmin');

  if (isProduction && !isSuperadmin) {
    return res.status(403).send('Akses Ditolak: Halaman uji coba sertifikat hanya dapat diakses di lingkungan pengujian atau oleh Superadmin.');
  }

  res.sendFile(path.join(PUBLIC_DIR, 'admin-uji-sertifikat.html'));
});

// API Daftar Sertifikat Dummy untuk Halaman Uji Coba
app.get('/api/admin/dummy-certificates', async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || Boolean(process.env.VERCEL);
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  const isSuperadmin = admin && (admin.role === 'superadmin' || admin.peran === 'superadmin');

  if (isProduction && !isSuperadmin) {
    return res.status(403).json({ success: false, message: 'Akses ditolak.' });
  }

  const all = await db.getAllCertificates(true);
  const dummyList = all.filter(c => c.is_dummy || String(c.id).startsWith('TEST'));
  res.json({ success: true, certificates: dummyList, baseUrl: getProductionBaseUrl() });
});

// Verifikasi Publik Keabsahan Sertifikat (Redirect ke Halaman Publik Dicoding-Style)
app.get('/api/verify-cert/:certNumber', (req, res) => {
  res.redirect('/sertifikat/' + encodeURIComponent(req.params.certNumber));
});

// Reset Testing Data API (Khusus Super Administrator)
app.post('/api/reset-data', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin || admin.role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak: Operasi reset data pengujian hanya diizinkan untuk Super Administrator.'
    });
  }
  await db.resetTestingData();
  res.json({ success: true, message: 'Seluruh data pengujian berhasil dibersihkan! 104 data pegawai asli tetap tersimpan rapi.' });
});

// ========================================================
// SUPERADMIN & CRUD MANAGEMENT APIs (SB ADMIN 2)
// ========================================================
function requireSuperAdminMiddleware(req, res, next) {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  const isSuper = admin && ((admin.peran || admin.role) === 'superadmin' || admin.username === 'superadmin');
  if (!isSuper) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak: Operasi ini hanya diizinkan untuk Super Administrator.'
    });
  }
  req.admin = admin;
  next();
}

function requireAdminMiddleware(req, res, next) {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) {
    return res.status(401).json({
      success: false,
      message: 'Sesi admin kedaluwarsa. Silakan login kembali.'
    });
  }
  req.admin = admin;
  next();
}

// 0. Endpoint Diagnostik Khusus Admin (Mode Penyimpanan, Env Status, Status Wajah Pegawai)
app.get(['/api/admin/diagnostik', '/api/diagnostik'], requireAdminMiddleware, async (req, res) => {
  try {
    const isDbActive = typeof db.isDatabaseAvailable === 'function' ? db.isDatabaseAvailable() : db.isSupabaseAvailable();
    const isVercel = Boolean(process.env.VERCEL);
    const nodeEnv = process.env.NODE_ENV || 'development';

    const envStatus = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL || process.env.MYSQL_URL),
      MYSQL_HOST: Boolean(process.env.MYSQL_HOST),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      SUPABASE_KEY: Boolean(process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
      ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
      SUPERADMIN_PASSWORD: Boolean(process.env.SUPERADMIN_PASSWORD)
    };

    let storageBucketStatus = 'ready';
    let storageBucketError = null;

    if (DB_DRIVER === 'supabase') {
      try {
        const client = typeof db.getClient === 'function' ? db.getClient() : null;
        if (client) {
          const { data, error } = await client.storage.from('faces').list('', { limit: 1 });
          if (error) {
            storageBucketStatus = 'error';
            storageBucketError = error.message;
          } else {
            storageBucketStatus = 'ready';
          }
        } else {
          storageBucketStatus = isVercel ? 'disabled' : 'local_disk';
        }
      } catch (e) {
        storageBucketStatus = 'exception';
        storageBucketError = e.message;
      }
    } else {
      // Driver MySQL: Berkas disimpan langsung di MySQL (tabel files / column longblob)
      storageBucketStatus = isDbActive ? 'mysql_database_blob' : (isVercel ? 'disabled' : 'local_disk');
    }

    let targetEmployeeStatus = null;
    const nipQuery = req.query.nip || req.query.id;
    if (nipQuery) {
      const emp = await db.getEmployeeByIdOrNip(String(nipQuery).trim());
      if (emp) {
        targetEmployeeStatus = {
          found: true,
          id: emp.id,
          nip: emp.nip,
          name: emp.name,
          attended: Boolean(emp.attended),
          attendedAt: emp.attendedAt || null,
          faceRegistered: Boolean(emp.faceRegistered || emp.facePhotoUrl),
          facePhotoUrl: emp.facePhotoUrl || null,
          faceRegisteredAt: emp.faceRegisteredAt || null
        };
      } else {
        targetEmployeeStatus = { found: false, nip: nipQuery };
      }
    }

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: {
        isVercel,
        nodeEnv,
        driver: DB_DRIVER,
        storageMode: isDbActive ? DB_DRIVER : 'in-memory'
      },
      envStatus,
      storageBucket: {
        bucket: 'faces',
        status: storageBucketStatus,
        error: storageBucketError
      },
      employeeStatus: targetEmployeeStatus
    });
  } catch (err) {
    console.error('Error in /api/admin/diagnostik:', err);
    return res.status(500).json({ success: false, message: 'Gagal menjalankan diagnostik: ' + err.message });
  }
});

// 1. Ringkasan Statistik untuk SB Admin 2 Dashboard
app.get('/api/superadmin/summary', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const employees = await db.getAllEmployees();
    const events = await db.getAllEvents();
    const activeEvent = await db.getActiveEvent();
    const admins = await db.getAllAdmins();

    const totalEmployees = employees.length;
    const totalPresent = employees.filter(e => e.attended).length;
    const totalPendingLpti = employees.filter(e => e.lpti && e.lpti.status === 'pending').length;
    const totalApprovedLpti = employees.filter(e => e.lpti && e.lpti.status === 'approved').length;
    const totalCertificates = employees.filter(e => e.certificate && e.certificate.number).length;
    const totalFaces = employees.filter(e => e.faceRegistered).length;

    res.json({
      success: true,
      data: {
        totalEmployees,
        totalPresent,
        totalPendingLpti,
        totalApprovedLpti,
        totalCertificates,
        totalFaces,
        totalEvents: events.length,
        activeEvent,
        totalAdmins: admins.length,
        isCloudConnected: db.isSupabaseAvailable()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat ringkasan superadmin: ' + err.message });
  }
});

// 2. CRUD Pegawai (Kelola Pegawai)
app.post('/api/employees', requireAdminMiddleware, async (req, res) => {
  try {
    const created = await db.createEmployee(req.body);
    res.status(201).json({ success: true, message: `Pegawai ${created.name} berhasil ditambahkan!`, employee: created });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/employees/:id', requireAdminMiddleware, async (req, res) => {
  try {
    const updated = await db.updateEmployee(req.params.id, req.body);
    res.json({ success: true, message: `Data pegawai ${updated.name} berhasil diperbarui!`, employee: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.delete('/api/employees/:id', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const success = await db.deleteEmployee(req.params.id);
    if (!success) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });
    res.json({ success: true, message: 'Data pegawai berhasil dihapus dari sistem.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/employees/:id/reset-password', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const newPass = req.body.newPassword || 'Bpmp2026!';
    const updated = await db.resetEmployeePassword(req.params.id, newPass);
    res.json({ success: true, message: `Password pegawai ${updated.name} berhasil di-reset ke "${newPass}".`, employee: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 3. CRUD Administrator & Petugas Kepegawaian (Kelola Admin)
app.get('/api/admins', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const statusFilter = req.query.status || 'all';
    const admins = await db.getAllAdmins(statusFilter);
    const activeSuperCount = await db.countActiveSuperadmins();
    res.json({
      success: true,
      admins,
      activeSuperadminCount: activeSuperCount,
      warning: activeSuperCount <= 1 ? 'Peringatan: Hanya ada 1 akun Super Administrator aktif. Sistem memerlukan minimal satu Super Administrator!' : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admins', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const { username, name, peran, role, password } = req.body;
    if (!username || !String(username).trim()) {
      return res.status(400).json({ success: false, message: 'NIP / Username admin wajib diisi!' });
    }
    const cleanUser = String(username).trim();
    const cleanName = String(name || cleanUser).trim();
    const chosenPeran = peran || role || 'kepegawaian';

    const created = await db.createAdmin({
      username: cleanUser,
      name: cleanName,
      peran: chosenPeran,
      role: chosenPeran,
      password: password,
      wajib_ganti_password: true
    });

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    await db.recordActivityLog({
      aktor_id: req.admin.username,
      aktor_nama: req.admin.name,
      aksi: 'tambah_admin',
      target: created.username,
      keterangan: `Membuat akun admin baru (${created.peran}): ${created.name} (${created.username})`,
      ip: clientIp
    });

    res.status(201).json({
      success: true,
      message: `Akun administrator "${created.username}" berhasil dibuat!`,
      admin: created,
      tempPassword: created.initialPassword
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/admins/:id', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const updated = await db.updateAdmin(req.params.id, req.body);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    await db.recordActivityLog({
      aktor_id: req.admin.username,
      aktor_nama: req.admin.name,
      aksi: 'ubah_admin',
      target: updated.username,
      keterangan: `Memperbarui data akun admin: ${updated.name} (${updated.username}), peran: ${updated.peran}`,
      ip: clientIp
    });

    res.json({ success: true, message: `Akun admin "${updated.username}" berhasil diperbarui!`, admin: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/admins/:id/toggle-active', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const targetState = req.body.aktif !== undefined ? Boolean(req.body.aktif) : null;
    const updated = await db.toggleAdminActive(req.params.id, targetState);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const aksiText = updated.aktif ? 'mengaktifkan' : 'menonaktifkan';

    await db.recordActivityLog({
      aktor_id: req.admin.username,
      aktor_nama: req.admin.name,
      aksi: updated.aktif ? 'aktifkan_admin' : 'nonaktifkan_admin',
      target: updated.username,
      keterangan: `Superadmin ${aksiText} akun admin: ${updated.name} (${updated.username})`,
      ip: clientIp
    });

    res.json({
      success: true,
      message: `Akun admin "${updated.username}" berhasil ${updated.aktif ? 'diaktifkan' : 'dinonaktifkan'}!`,
      admin: updated
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/admins/:id/reset-password', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const tempPassword = req.body.newPassword || `Bpmp${Math.floor(1000 + Math.random() * 9000)}!`;
    const result = await db.resetAdminPassword(req.params.id, tempPassword);
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    await db.recordActivityLog({
      aktor_id: req.admin.username,
      aktor_nama: req.admin.name,
      aksi: 'reset_password_admin',
      target: result.username,
      keterangan: `Mereset password akun admin: ${result.name} (${result.username}) dengan password sekali pakai`,
      ip: clientIp
    });

    res.json({
      success: true,
      message: `Password akun "${result.username}" berhasil direset!`,
      tempPassword: result.tempPassword,
      admin: result
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/admin-change-password', async (req, res) => {
  const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });
  }

  const { oldPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 8 karakter!' });
  }

  if (oldPassword) {
    const verified = await db.verifyAdminCredentials(admin.username, oldPassword);
    if (!verified || verified.error) {
      return res.status(400).json({ success: false, message: 'Password lama tidak cocok!' });
    }
  }

  try {
    const updated = await db.updateAdmin(admin.username, {
      password: String(newPassword).trim(),
      wajib_ganti_password: false
    });

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    await db.recordActivityLog({
      aktor_id: admin.username,
      aktor_nama: admin.name,
      aksi: 'ganti_password_mandiri',
      target: admin.username,
      keterangan: `Admin ${admin.name} (${admin.username}) berhasil memperbarui password mandiri.`,
      ip: clientIp
    });

    const newToken = createAdminToken({ ...updated, wajib_ganti_password: false });
    res.setHeader('Set-Cookie', `admin_token=${newToken}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`);

    res.json({
      success: true,
      message: 'Password berhasil diperbarui! Silakan simpan password baru Anda.',
      token: newToken
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admins/:id', requireSuperAdminMiddleware, async (req, res) => {
  try {
    await db.deleteAdmin(req.params.id);
    res.json({ success: true, message: 'Akun admin berhasil dihapus.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 4. Hapus Event Pelatihan
app.delete('/api/events/:id', requireSuperAdminMiddleware, async (req, res) => {
  try {
    await db.deleteEventById(req.params.id);
    res.json({ success: true, message: 'Event berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Export Backup Data
app.get('/api/superadmin/export-data', requireSuperAdminMiddleware, async (req, res) => {
  try {
    const employees = await db.getAllEmployees();
    const events = await db.getAllEvents();
    const admins = await db.getAllAdmins();
    const backupData = {
      exportedAt: new Date().toISOString(),
      system: 'BPMP Sulawesi Tenggara - Senin Berseri',
      totalEmployees: employees.length,
      totalEvents: events.length,
      employees,
      events,
      admins
    };
    const filename = `BACKUP_SENIN_BERSERI_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========================================================
// PAGE ROUTES (Landing Page di "/", Portal Pegawai di "/login")
// ========================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pegawai.html'));
});

app.get('/pegawai', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'pegawai.html'));
});

app.get('/verif-wajah', (req, res) => {
  res.redirect('/pegawai');
});

app.get('/verifikasi-wajah', (req, res) => {
  res.redirect('/pegawai');
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

app.get('/superadmin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'superadmin.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/proyektor', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'proyektor.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'proyektor.html'));
});

// Halaman Publik Verifikasi E-Sertifikat Kriptografis (Dicoding Style)
app.get('/sertifikat', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'sertifikat.html'));
});

app.get('/sertifikat/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'sertifikat.html'));
});

app.get('/verify/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'sertifikat.html'));
});

// 404 Handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Export Express app untuk Vercel Serverless Function (@vercel/node)
module.exports = app;

// Jalankan standalone server jika file dieksekusi langsung
if (require.main === module) {
  db.initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 BPMP Sultra - Senin Berseri running on port ${PORT}`);
      console.log(`💾 Storage: ${db.isSupabaseAvailable() ? 'Supabase PostgreSQL (Cloud Database & Storage)' : 'Local In-Memory Cache (db.json)'}`);
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
