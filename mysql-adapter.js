/**
 * MySQL Database & File Storage Adapter
 * 100% Pure MySQL Implementation untuk BPMP Senin Berseri
 * Kompatibel dengan Vercel Serverless Function (@vercel/node) & Cloud MySQL
 */

const path = require('path');
const fs = require('fs');
const { hashPasswordSync, verifyPassword, generateTempPassword, isBcryptHash } = require('./utils/password');
let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  // Gracefully handle if mysql2 is not installed yet
}

// Otomatis load .env jika ada
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (e) {}
}

let _pool = null;
let _memoryStore = null;

function isVercel() {
  return Boolean(process.env.VERCEL);
}

function isProd() {
  return isVercel() || process.env.NODE_ENV === 'production';
}

function getMemoryStore() {
  if (_memoryStore) return _memoryStore;
  try {
    _memoryStore = require('./db.json');
  } catch (e) {
    const jsonPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(jsonPath)) {
      try {
        _memoryStore = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (err) {
        _memoryStore = { employees: [], events: [], admins: [] };
      }
    } else {
      _memoryStore = { employees: [], events: [], admins: [] };
    }
  }
  return _memoryStore;
}

function isConfigured() {
  return Boolean(
    process.env.DATABASE_URL ||
    process.env.MYSQL_URL ||
    process.env.MYSQL_HOST
  );
}

function getPool() {
  if (_pool) return _pool;
  if (!mysql) return null;

  const dbUrl = (process.env.DATABASE_URL || process.env.MYSQL_URL || '').trim();

  let poolConfig = {
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };

  if (dbUrl) {
    // Support URL format: mysql://user:password@host:port/database
    poolConfig.uri = dbUrl;
    if (dbUrl.includes('ssl') || process.env.MYSQL_SSL === 'true') {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
  } else if (process.env.MYSQL_HOST) {
    poolConfig.host = process.env.MYSQL_HOST;
    poolConfig.port = parseInt(process.env.MYSQL_PORT, 10) || 3306;
    poolConfig.user = process.env.MYSQL_USER || 'root';
    poolConfig.password = process.env.MYSQL_PASSWORD || '';
    poolConfig.database = process.env.MYSQL_DATABASE || 'senin_berseri';
    if (process.env.MYSQL_SSL === 'true') {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
  } else {
    return null;
  }

  try {
    _pool = mysql.createPool(poolConfig);
    console.log('✅ [MySQL Pool] Koneksi pool berhasil diinisialisasi.');
    return _pool;
  } catch (err) {
    console.error('❌ [MySQL Pool Error]:', err.message);
    return null;
  }
}

function setPool(customPool) {
  _pool = customPool;
}

// ==============================================================
// FORMATTER HELPERS
// ==============================================================
function formatEmployeeRow(row) {
  if (!row) return null;
  const isAttended = Boolean(row.attended);
  let timeStr = null;
  if (row.attended_at) {
    try {
      const d = new Date(row.attended_at);
      timeStr = !isNaN(d.getTime())
        ? 'Pukul ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WITA'
        : String(row.attended_at);
    } catch (e) {
      timeStr = String(row.attended_at);
    }
  }

  let certSettings = null;
  if (row.cert_settings) {
    try {
      certSettings = typeof row.cert_settings === 'string' ? JSON.parse(row.cert_settings) : row.cert_settings;
    } catch (e) {}
  }

  const attendanceObj = {
    status: isAttended ? 'present' : 'absent',
    time: timeStr || (isAttended ? 'Pukul 08:30:00 WITA' : null)
  };
  if (row.event_id) {
    attendanceObj[row.event_id] = {
      status: isAttended ? 'present' : 'absent',
      time: timeStr || (isAttended ? 'Pukul 08:30:00 WITA' : null)
    };
  }

  return {
    id: row.id,
    nip: String(row.nip || '').trim(),
    name: row.name,
    password_hash: row.password_hash || (row.password ? (isBcryptHash(row.password) ? row.password : hashPasswordSync(row.password)) : null),
    wajib_ganti_password: Boolean(row.wajib_ganti_password !== undefined ? row.wajib_ganti_password : true),
    mustChangePassword: Boolean(row.wajib_ganti_password !== undefined ? row.wajib_ganti_password : true),
    panggol: row.panggol || '',
    jabatan: row.jabatan || '',
    instansi: row.instansi || 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: row.pendidikan || '',
    eventId: row.event_id || null,
    eventTitle: row.event_title || null,
    attended: isAttended,
    attendedAt: row.attended_at ? new Date(row.attended_at).toISOString() : null,
    attendance: attendanceObj,
    accumulatedJp: Number(row.accumulated_jp) || 0,
    lpti: {
      status: row.lpti_status || 'none',
      fileName: row.lpti_file_name || null,
      fileOriginalName: row.lpti_file_original_name || null,
      filePath: row.lpti_file_path || null,
      fileSize: row.lpti_file_size || null,
      uploadedAt: row.lpti_uploaded_at ? new Date(row.lpti_uploaded_at).toISOString() : null,
      revisionNote: row.lpti_revision_note || ''
    },
    certificate: row.certificate_number ? {
      number: row.certificate_number,
      issuedAt: row.certificate_issued_at ? new Date(row.certificate_issued_at).toISOString() : null,
      verifier: row.certificate_verifier || 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: row.certificate_verifier_title || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
    } : null
  };
}

function formatEventRow(row) {
  if (!row) return null;
  const defaultCertSettings = {
    prefix: '800.1.3/SERT-LPTI/2026',
    nomorYRatio: 0.72,
    namaYRatio: 0.50,
    namaFontSize: 26,
    nomorFontSize: 11,
    showUnderline: true,
    showQr: true
  };

  let certSettings = defaultCertSettings;
  if (row.cert_settings) {
    try {
      const parsed = typeof row.cert_settings === 'string' ? JSON.parse(row.cert_settings) : row.cert_settings;
      certSettings = { ...defaultCertSettings, ...parsed };
    } catch (e) {}
  }

  let certTemplate = null;
  if (row.certificate_template) {
    try {
      certTemplate = typeof row.certificate_template === 'string' ? JSON.parse(row.certificate_template) : row.certificate_template;
    } catch (e) {
      certTemplate = row.certificate_template;
    }
  }

  return {
    id: row.id,
    title: row.title,
    jp: Number(row.jp) || 32,
    category: row.category || 'Teknis & Manajerial Kepegawaian',
    schedule: row.schedule || '',
    location: row.location || 'Auditorium BPMP Sultra',
    organizer: row.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: Boolean(row.active),
    status: row.status || (row.active ? 'active' : 'completed'),
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    certificateTemplate: certTemplate,
    certSettings: certSettings,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

// ==============================================================
// SEEDING DARI DB.JSON JIKA TABEL MYSQL KOSONG
// ==============================================================
async function seedDatabase(pool) {
  try {
    const mem = getMemoryStore();

    // 1. Seed Default Event
    if (mem.event && mem.event.id) {
      const ev = mem.event;
      const certSettingsStr = JSON.stringify(ev.certSettings || {});
      await pool.execute(
        `INSERT INTO events (id, title, jp, category, schedule, location, organizer, active, status, cert_settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE title = VALUES(title), jp = VALUES(jp), cert_settings = VALUES(cert_settings)`,
        [ev.id, ev.title, parseInt(ev.jp, 10) || 32, ev.category || '', ev.schedule || '', ev.location || '', ev.organizer || '', certSettingsStr]
      );
    }

    // 2. Seed Admins
    await pool.execute(
      `INSERT INTO admins (username, password, name, role)
       VALUES ('superadmin', 'Bpmp2026!', 'Super Administrator BPMP Sultra', 'superadmin'),
              ('admin', 'Bpmp2026!', 'Bagian Kepegawaian BPMP Sultra', 'kepegawaian')
       ON DUPLICATE KEY UPDATE name = VALUES(name)`
    );

    // 3. Seed 104 Pegawai BPMP Sultra
    if (Array.isArray(mem.employees) && mem.employees.length > 0) {
      for (const emp of mem.employees) {
        await pool.execute(
          `INSERT INTO employees (
            id, nip, name, password, panggol, jabatan, instansi, pendidikan,
            event_id, event_title, attended, attended_at, accumulated_jp,
            lpti_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            jabatan = VALUES(jabatan),
            panggol = VALUES(panggol)`,
          [
            emp.id,
            String(emp.nip).trim(),
            emp.name,
            emp.password || 'Bpmp2026!',
            emp.panggol || '',
            emp.jabatan || '',
            emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
            emp.pendidikan || '',
            emp.eventId || (mem.event?.id || null),
            emp.eventTitle || (mem.event?.title || null),
            emp.attended ? 1 : 0,
            emp.attendedAt ? new Date(emp.attendedAt) : null,
            Number(emp.accumulatedJp) || 0,
            emp.lpti?.status || 'none'
          ]
        );
      }
      console.log(`✅ [MySQL Seeding] Berhasil memasukkan ${mem.employees.length} pegawai BPMP Sultra ke MySQL database.`);
    }
  } catch (err) {
    console.error('⚠️ [MySQL Seeding Error]:', err.message);
  }
}

// ==============================================================
// INITIALIZE DATABASE (AUTO CREATE TABLES & SEED)
// ==============================================================
async function initDb() {
  const pool = getPool();
  if (!pool) {
    if (isProd()) {
      console.error('❌ [MySQL Fatal] DATABASE_URL atau MYSQL_HOST wajib disetel di Environment Variables Vercel!');
      return false;
    }
    console.log('ℹ️ [Database] Menjalankan mode In-Memory Store (db.json). Atur DATABASE_URL di .env untuk mengaktifkan MySQL.');
    return true;
  }

  try {
    // 1. Buat Tabel Jika Belum Ada
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        jp INT NOT NULL DEFAULT 32,
        category VARCHAR(128) DEFAULT 'Teknis & Manajerial Kepegawaian',
        schedule VARCHAR(128) DEFAULT NULL,
        location VARCHAR(128) DEFAULT 'Auditorium BPMP Sultra',
        organizer VARCHAR(255) DEFAULT 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
        active TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        completed_at DATETIME DEFAULT NULL,
        certificate_template LONGTEXT DEFAULT NULL,
        cert_settings LONGTEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_events_active (active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        nip VARCHAR(32) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL DEFAULT 'Bpmp2026!',
        panggol VARCHAR(128) DEFAULT '',
        jabatan VARCHAR(255) DEFAULT '',
        instansi VARCHAR(255) DEFAULT 'BPMP Provinsi Sulawesi Tenggara',
        pendidikan VARCHAR(64) DEFAULT '',
        event_id VARCHAR(64) DEFAULT NULL,
        event_title VARCHAR(255) DEFAULT NULL,
        attended TINYINT(1) NOT NULL DEFAULT 0,
        attended_at DATETIME DEFAULT NULL,
        accumulated_jp INT NOT NULL DEFAULT 0,
        lpti_status VARCHAR(32) NOT NULL DEFAULT 'none',
        lpti_file_name VARCHAR(255) DEFAULT NULL,
        lpti_file_original_name VARCHAR(255) DEFAULT NULL,
        lpti_file_path VARCHAR(255) DEFAULT NULL,
        lpti_file_size INT DEFAULT NULL,
        lpti_file_data LONGTEXT DEFAULT NULL,
        lpti_uploaded_at DATETIME DEFAULT NULL,
        lpti_revision_note TEXT DEFAULT NULL,
        certificate_number VARCHAR(128) DEFAULT NULL,
        certificate_issued_at DATETIME DEFAULT NULL,
        certificate_verifier VARCHAR(255) DEFAULT 'Junaiddin Pagala, ST, M.T.',
        certificate_verifier_title VARCHAR(255) DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
        attendance_photo_url LONGTEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_employees_nip (nip),
        INDEX idx_employees_attended (attended)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL DEFAULT 'Bpmp2026!',
        name VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'kepegawaian',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_admins_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(128) NOT NULL PRIMARY KEY,
        bucket VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        content_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
        file_data LONGBLOB NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_files_bucket_name (bucket, file_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 1.5. Buat Tabel Attendances, QR Tokens, dan Certificates
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS attendances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(64) NOT NULL,
        nip VARCHAR(32) NOT NULL,
        name VARCHAR(255) NOT NULL,
        event_id VARCHAR(64) NOT NULL,
        event_title VARCHAR(255) DEFAULT NULL,
        qr_token VARCHAR(32) DEFAULT NULL,
        attendance_photo_url LONGTEXT DEFAULT NULL,
        attended_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attendances_nip (nip),
        INDEX idx_attendances_event (event_id),
        INDEX idx_attendances_attended_at (attended_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS qr_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(64) NOT NULL,
        token VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        valid_until DATETIME NOT NULL,
        INDEX idx_qr_event_token (event_id, token),
        INDEX idx_qr_valid_until (valid_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS certificates (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        certificate_number VARCHAR(128) NOT NULL UNIQUE,
        employee_id VARCHAR(64) NOT NULL,
        nip VARCHAR(32) NOT NULL,
        name VARCHAR(255) NOT NULL,
        event_id VARCHAR(64) NOT NULL,
        event_title VARCHAR(255) DEFAULT NULL,
        issued_at DATETIME NOT NULL,
        verifier VARCHAR(255) DEFAULT 'Junaiddin Pagala, ST, M.T.',
        verifier_title VARCHAR(255) DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
        pdf_url VARCHAR(255) DEFAULT NULL,
        crypto_hash VARCHAR(128) DEFAULT NULL,
        crypto_signature LONGTEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cert_nip (nip),
        INDEX idx_cert_event (event_id),
        INDEX idx_cert_number (certificate_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Pastikan kolom current_qr_token, previous_qr_token, & qr_valid_until ada pada tabel events
    try {
      await pool.execute(`ALTER TABLE events ADD COLUMN current_qr_token VARCHAR(32) DEFAULT NULL`);
    } catch (ignore) {}
    try {
      await pool.execute(`ALTER TABLE events ADD COLUMN previous_qr_token VARCHAR(32) DEFAULT NULL`);
    } catch (ignore) {}
    try {
      await pool.execute(`ALTER TABLE events ADD COLUMN qr_valid_until DATETIME DEFAULT NULL`);
    } catch (ignore) {}

    // 2. Periksa apakah tabel employees sudah terisi
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM employees');
    const count = rows[0]?.total || 0;
    console.log(`✅ [MySQL Database] Terhubung dengan sukses! (${count} pegawai terdaftar)`);

    if (count === 0) {
      await seedDatabase(pool);
    }

    return true;
  } catch (err) {
    console.error('❌ [MySQL Init Error]:', err.message);
    if (isProd()) return false;
    return true;
  }
}

// ==============================================================
// EMPLOYEES CRUD
// ==============================================================
async function getAllEmployees() {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query('SELECT * FROM employees ORDER BY id ASC');
      return rows.map(formatEmployeeRow);
    } catch (err) {
      console.error('[MySQL Error] getAllEmployees:', err.message);
      if (isProd()) throw err;
    }
  } else if (isProd()) {
    throw new Error('MySQL Database tidak terkonfigurasi di Vercel/Produksi. Failover in-memory dinonaktifkan.');
  }

  // Memory fallback hanya untuk local dev non-Vercel
  const mem = getMemoryStore();
  return (mem.employees || []).map(emp => formatEmployeeRow(emp));
}

async function getEmployeeByIdOrNip(idOrNip) {
  if (!idOrNip) return null;
  const clean = String(idOrNip).trim();
  const lower = clean.toLowerCase();

  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM employees WHERE id = ? OR nip = ? LIMIT 1',
        [clean, clean]
      );
      if (rows && rows.length > 0) {
        return formatEmployeeRow(rows[0]);
      }
    } catch (err) {
      console.error(`[MySQL Error] getEmployeeByIdOrNip(${clean}):`, err.message);
      if (isProd()) throw err;
    }
  } else if (isProd()) {
    throw new Error(`MySQL Database tidak terkonfigurasi di Vercel/Produksi. Gagal memuat data pegawai ${clean}.`);
  }

  // Memory fallback hanya untuk local dev
  const mem = getMemoryStore();
  const foundMem = (mem.employees || []).find(e =>
    (e.id && e.id.toLowerCase() === lower) ||
    String(e.nip || '').trim() === clean ||
    (e.username && e.username.toLowerCase() === lower)
  );
  return foundMem ? formatEmployeeRow(foundMem) : null;
}

async function createEmployee(empData) {
  const pool = getPool();
  const id = empData.id || `BPMP-${Date.now()}`;
  const nip = String(empData.nip || '').trim();
  const name = empData.name;
  const password = empData.password || 'Bpmp2026!';
  const panggol = empData.panggol || '';
  const jabatan = empData.jabatan || '';
  const instansi = empData.instansi || 'BPMP Provinsi Sulawesi Tenggara';
  const pendidikan = empData.pendidikan || '';

  if (pool) {
    await pool.execute(
      `INSERT INTO employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, nip, name, password, panggol, jabatan, instansi, pendidikan]
    );
    return getEmployeeByIdOrNip(id);
  }

  const mem = getMemoryStore();
  const newEmp = { id, nip, name, password, panggol, jabatan, instansi, pendidikan };
  mem.employees.push(newEmp);
  return formatEmployeeRow(newEmp);
}

async function updateEmployee(id, empData) {
  const clean = String(id).trim();
  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const pool = getPool();
  if (pool) {
    await pool.execute(
      `UPDATE employees SET
        name = COALESCE(?, name),
        panggol = COALESCE(?, panggol),
        jabatan = COALESCE(?, jabatan),
        instansi = COALESCE(?, instansi),
        pendidikan = COALESCE(?, pendidikan),
        updated_at = NOW()
       WHERE id = ?`,
      [empData.name || null, empData.panggol || null, empData.jabatan || null, empData.instansi || null, empData.pendidikan || null, existing.id]
    );
    return getEmployeeByIdOrNip(existing.id);
  }

  Object.assign(existing, empData);
  return existing;
}

async function deleteEmployee(id) {
  const clean = String(id).trim();
  const pool = getPool();
  if (pool) {
    const [res] = await pool.execute('DELETE FROM employees WHERE id = ? OR nip = ?', [clean, clean]);
    return res.affectedRows > 0;
  }
  const mem = getMemoryStore();
  const idx = mem.employees.findIndex(e => e.id === clean || e.nip === clean);
  if (idx >= 0) {
    mem.employees.splice(idx, 1);
    return true;
  }
  return false;
}

async function resetEmployeePassword(id, newPass = null) {
  const clean = String(id).trim();
  const tempPass = newPass || generateTempPassword();
  const hashed = hashPasswordSync(tempPass);
  const pool = getPool();
  if (pool) {
    try {
      await pool.execute('UPDATE employees SET password_hash = ?, wajib_ganti_password = 1, updated_at = NOW() WHERE id = ? OR nip = ?', [hashed, clean, clean]);
    } catch (_) {
      await pool.execute('UPDATE employees SET password = ?, updated_at = NOW() WHERE id = ? OR nip = ?', [hashed, clean, clean]);
    }
    const emp = await getEmployeeByIdOrNip(clean);
    return { ...emp, tempPassword: tempPass };
  }
  const emp = await getEmployeeByIdOrNip(clean);
  if (emp) {
    emp.password_hash = hashed;
    emp.wajib_ganti_password = true;
    emp.mustChangePassword = true;
    delete emp.password;
  }
  return { ...emp, tempPassword: tempPass };
}

async function ensureEmployeeJp(id, eventJp = 32) {
  const clean = String(id).trim();
  const emp = await getEmployeeByIdOrNip(clean);
  if (!emp) return null;
  const jpVal = parseInt(eventJp, 10) || 32;

  if (!emp.accumulatedJp || emp.accumulatedJp === 0) {
    const pool = getPool();
    if (pool) {
      await pool.execute('UPDATE employees SET accumulated_jp = ?, updated_at = NOW() WHERE id = ?', [jpVal, emp.id]);
      return getEmployeeByIdOrNip(emp.id);
    }
    emp.accumulatedJp = jpVal;
  }
  return emp;
}

// ==============================================================
// PRESENSI KEGIATAN
// ==============================================================
async function markEmployeeAttended(id, eventId, eventTitle, eventJp = 32, attendancePhotoUrl = null, qrToken = null) {
  const now = new Date();
  const clean = String(id).trim();
  const jpToAdd = parseInt(eventJp, 10) || 32;

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const currentJp = Number(existing.accumulatedJp) || 0;
  const newJp = currentJp > 0 ? currentJp + jpToAdd : jpToAdd;

  const pool = getPool();
  if (pool) {
    try {
      await pool.execute(
        `UPDATE employees SET
          attended = 1,
          attended_at = ?,
          event_id = ?,
          event_title = ?,
          accumulated_jp = ?,
          attendance_photo_url = COALESCE(?, attendance_photo_url),
          updated_at = NOW()
         WHERE id = ?`,
        [now, eventId || null, eventTitle || null, newJp, attendancePhotoUrl || null, existing.id]
      );

      // Simpan catatan riwayat ke tabel attendances di database
      try {
        await pool.execute(
          `INSERT INTO attendances (employee_id, nip, name, event_id, event_title, qr_token, attendance_photo_url, attended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [existing.id, existing.nip, existing.name, eventId || null, eventTitle || null, qrToken || null, attendancePhotoUrl || null, now]
        );
      } catch (logErr) {
        console.warn('[MySQL Warning] Gagal menulis ke tabel attendances:', logErr.message);
      }

      return getEmployeeByIdOrNip(existing.id);
    } catch (err) {
      console.error(`[MySQL Error] markEmployeeAttended(${existing.id}):`, err.message);
      throw new Error(`Gagal mencatat presensi pegawai ke MySQL: ${err.message}`);
    }
  }

  if (isProd()) {
    throw new Error('MySQL Database tidak terkonfigurasi di Vercel/Produksi. Presensi tidak dapat disimpan.');
  }

  existing.attended = true;
  existing.attendedAt = now.toISOString();
  existing.eventId = eventId || null;
  existing.eventTitle = eventTitle || null;
  existing.accumulatedJp = newJp;
  if (attendancePhotoUrl) existing.attendancePhotoUrl = attendancePhotoUrl;
  return existing;
}

// ==============================================================
// LPTI & SERTIFIKAT
// ==============================================================
async function updateEmployeeLpti(id, lptiData) {
  const now = new Date();
  const clean = String(id).trim();
  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const pool = getPool();
  if (pool) {
    try {
      await pool.execute(
        `UPDATE employees SET
          lpti_status = 'pending',
          lpti_file_name = ?,
          lpti_file_original_name = ?,
          lpti_file_path = ?,
          lpti_file_size = ?,
          lpti_uploaded_at = ?,
          lpti_revision_note = '',
          updated_at = NOW()
         WHERE id = ?`,
        [
          lptiData.fileName || null,
          lptiData.fileOriginalName || null,
          lptiData.filePath || null,
          lptiData.fileSize || null,
          lptiData.uploadedAt ? new Date(lptiData.uploadedAt) : now,
          existing.id
        ]
      );
      return getEmployeeByIdOrNip(existing.id);
    } catch (err) {
      console.error('[MySQL Error] updateEmployeeLpti:', err.message);
      throw err;
    }
  }

  existing.lpti = {
    status: 'pending',
    fileName: lptiData.fileName,
    fileOriginalName: lptiData.fileOriginalName,
    filePath: lptiData.filePath,
    fileSize: lptiData.fileSize,
    uploadedAt: now.toISOString(),
    revisionNote: ''
  };
  return existing;
}

async function verifyEmployeeLpti(employeeId, actionOrCertData = null, revisionNote = null, eventJp = 32) {
  const clean = String(employeeId).trim();
  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const now = new Date();
  let action = 'approve';
  let certNumber = null;
  let verifier = 'Junaiddin Pagala, ST, M.T.';
  let verifierTitle = 'Kepala Balai Penjaminan Mutu Pendidikan Sultra';

  if (typeof actionOrCertData === 'object' && actionOrCertData !== null) {
    action = actionOrCertData.action || 'approve';
    certNumber = actionOrCertData.number || actionOrCertData.certNumber || null;
    verifier = actionOrCertData.verifier || verifier;
    verifierTitle = actionOrCertData.verifierTitle || verifierTitle;
  } else if (typeof actionOrCertData === 'string') {
    action = actionOrCertData;
  }

  const pool = getPool();
  if (action === 'approve') {
    if (!certNumber) {
      const year = now.getFullYear();
      certNumber = `800.1.3/SERT-LPTI/${year}/${existing.nip || Date.now()}`;
    }

    if (pool) {
      await pool.execute(
        `UPDATE employees SET
          lpti_status = 'approved',
          certificate_number = ?,
          certificate_issued_at = ?,
          certificate_verifier = ?,
          certificate_verifier_title = ?,
          updated_at = NOW()
         WHERE id = ?`,
        [certNumber, now, verifier, verifierTitle, existing.id]
      );
      return getEmployeeByIdOrNip(existing.id);
    }

    existing.lpti.status = 'approved';
    existing.certificate = {
      number: certNumber,
      issuedAt: now.toISOString(),
      verifier,
      verifierTitle
    };
    return existing;
  } else if (action === 'revise' || action === 'reject') {
    const note = revisionNote || (typeof actionOrCertData === 'object' ? actionOrCertData.revisionNote : '') || 'Perlu perbaikan laporan LPTI.';
    if (pool) {
      await pool.execute(
        `UPDATE employees SET
          lpti_status = 'revision',
          lpti_revision_note = ?,
          updated_at = NOW()
         WHERE id = ?`,
        [note, existing.id]
      );
      return getEmployeeByIdOrNip(existing.id);
    }
    existing.lpti.status = 'revision';
    existing.lpti.revisionNote = note;
    return existing;
  }

  return existing;
}

// ==============================================================
// EVENTS CRUD
// ==============================================================
async function getAllEvents() {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query('SELECT * FROM events ORDER BY created_at DESC');
      return rows.map(formatEventRow);
    } catch (err) {
      console.error('[MySQL Error] getAllEvents:', err.message);
      if (isProd()) throw err;
    }
  }

  const mem = getMemoryStore();
  return (mem.events || []).map(formatEventRow);
}

async function getActiveEvent() {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query('SELECT * FROM events WHERE active = 1 ORDER BY updated_at DESC LIMIT 1');
      if (rows && rows.length > 0) return formatEventRow(rows[0]);

      // Fallback: ambil event paling baru
      const [fallbackRows] = await pool.query('SELECT * FROM events ORDER BY created_at DESC LIMIT 1');
      if (fallbackRows && fallbackRows.length > 0) return formatEventRow(fallbackRows[0]);
    } catch (err) {
      console.error('[MySQL Error] getActiveEvent:', err.message);
      if (isProd()) throw err;
    }
  }

  const mem = getMemoryStore();
  const active = (mem.events || []).find(e => e.active);
  if (active) return formatEventRow(active);
  if (mem.events && mem.events.length > 0) return formatEventRow(mem.events[0]);
  return mem.event ? formatEventRow(mem.event) : null;
}

async function getEventById(id) {
  if (!id) return null;
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.execute('SELECT * FROM events WHERE id = ? LIMIT 1', [id]);
      if (rows && rows.length > 0) return formatEventRow(rows[0]);
    } catch (err) {
      console.error(`[MySQL Error] getEventById(${id}):`, err.message);
    }
  }
  const mem = getMemoryStore();
  const ev = (mem.events || []).find(e => e.id === id);
  return ev ? formatEventRow(ev) : null;
}

async function saveEvent(eventData) {
  const id = eventData.id || `EVT-${Date.now()}`;
  const title = eventData.title;
  const jp = parseInt(eventData.jp, 10) || 32;
  const category = eventData.category || 'Teknis & Manajerial Kepegawaian';
  const schedule = eventData.schedule || '';
  const location = eventData.location || 'Auditorium BPMP Sultra';
  const organizer = eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara';
  const certSettingsStr = JSON.stringify(eventData.certSettings || {});

  const pool = getPool();
  if (pool) {
    await pool.execute(
      `INSERT INTO events (id, title, jp, category, schedule, location, organizer, active, status, cert_settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        jp = VALUES(jp),
        category = VALUES(category),
        schedule = VALUES(schedule),
        location = VALUES(location),
        organizer = VALUES(organizer),
        cert_settings = VALUES(cert_settings),
        updated_at = NOW()`,
      [id, title, jp, category, schedule, location, organizer, certSettingsStr]
    );
    return getEventById(id);
  }

  const mem = getMemoryStore();
  const newEv = { ...eventData, id, jp, active: true, status: 'active' };
  mem.events.unshift(newEv);
  return formatEventRow(newEv);
}

async function activateEventById(id) {
  const pool = getPool();
  if (pool) {
    await pool.execute('UPDATE events SET active = 0');
    await pool.execute('UPDATE events SET active = 1, status = "active", updated_at = NOW() WHERE id = ?', [id]);
    return getEventById(id);
  }
  const mem = getMemoryStore();
  mem.events.forEach(e => { e.active = (e.id === id); });
  return getEventById(id);
}

async function completeEventById(id) {
  const pool = getPool();
  if (pool) {
    await pool.execute('UPDATE events SET active = 0, status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [id]);
    return getEventById(id);
  }
  const mem = getMemoryStore();
  const ev = mem.events.find(e => e.id === id);
  if (ev) {
    ev.active = false;
    ev.status = 'completed';
    ev.completedAt = new Date().toISOString();
  }
  return ev;
}

async function syncEvents(eventsList) {
  if (!Array.isArray(eventsList)) return [];
  for (const ev of eventsList) {
    await saveEvent(ev);
  }
  return getAllEvents();
}

async function deleteEventById(id) {
  const pool = getPool();
  if (pool) {
    const [res] = await pool.execute('DELETE FROM events WHERE id = ?', [id]);
    return res.affectedRows > 0;
  }
  const mem = getMemoryStore();
  const idx = mem.events.findIndex(e => e.id === id);
  if (idx >= 0) {
    mem.events.splice(idx, 1);
    return true;
  }
  return false;
}

async function toggleActiveEventStatus(id) {
  const ev = await getEventById(id);
  if (!ev) return null;
  if (ev.active) {
    return completeEventById(id);
  } else {
    return activateEventById(id);
  }
}

async function updateEventTemplate(id, templateData) {
  const str = JSON.stringify(templateData);
  const pool = getPool();
  if (pool) {
    await pool.execute('UPDATE events SET certificate_template = ?, updated_at = NOW() WHERE id = ?', [str, id]);
    return getEventById(id);
  }
  const ev = await getEventById(id);
  if (ev) ev.certificateTemplate = templateData;
  return ev;
}

async function updateEventCertSettings(id, certSettings) {
  const str = JSON.stringify(certSettings);
  const pool = getPool();
  if (pool) {
    await pool.execute('UPDATE events SET cert_settings = ?, updated_at = NOW() WHERE id = ?', [str, id]);
    return getEventById(id);
  }
  const ev = await getEventById(id);
  if (ev) ev.certSettings = certSettings;
  return ev;
}

// ==============================================================
// ADMIN AUTH & CRUD
// ==============================================================
async function verifyAdminCredentials(username, password) {
  if (!username || !password) return null;
  const cleanU = String(username).trim();
  const cleanP = String(password).trim();

  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM admins WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [cleanU]
      );
      if (rows && rows.length > 0) {
        const data = rows[0];
        const isValid = await verifyPassword(cleanP, data.password_hash || data.password);
        if (isValid) {
          return {
            id: data.id,
            username: data.username,
            name: data.name,
            role: data.role || (data.username === 'superadmin' ? 'superadmin' : 'kepegawaian'),
            peran: data.role || (data.username === 'superadmin' ? 'superadmin' : 'kepegawaian'),
            wajib_ganti_password: Boolean(data.wajib_ganti_password)
          };
        }
      }
    } catch (err) {
      console.error('[MySQL Error] verifyAdminCredentials:', err.message);
    }
  }

  // Memory fallback
  const mem = getMemoryStore();
  const lowerU = cleanU.toLowerCase();
  const found = (mem.admins || []).find(a =>
    a.username.toLowerCase() === lowerU || (lowerU === 'kepegawaian' && a.username === 'admin')
  );
  if (found) {
    const isValid = await verifyPassword(cleanP, found.password_hash || found.password);
    if (isValid) {
      return {
        id: found.id,
        username: found.username,
        name: found.name,
        role: found.role || (found.username === 'superadmin' ? 'superadmin' : 'kepegawaian'),
        peran: found.role || (found.username === 'superadmin' ? 'superadmin' : 'kepegawaian'),
        wajib_ganti_password: Boolean(found.wajib_ganti_password)
      };
    }
  }
  return null;
}

async function getAllAdmins() {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query('SELECT id, username, name, role, wajib_ganti_password, created_at FROM admins ORDER BY id ASC');
      return rows;
    } catch (err) {
      console.error('[MySQL Error] getAllAdmins:', err.message);
    }
  }
  const mem = getMemoryStore();
  return (mem.admins || []).map(a => {
    const { password, password_hash, ...safe } = a;
    return safe;
  });
}

async function createAdmin(adminData) {
  const pool = getPool();
  const username = String(adminData.username || '').trim();
  const rawPass = adminData.password || adminData.tempPassword || generateTempPassword();
  const hashedPassword = isBcryptHash(rawPass) ? rawPass : hashPasswordSync(rawPass);
  const name = adminData.name || username;
  const role = adminData.role || 'kepegawaian';

  if (pool) {
    try {
      const [res] = await pool.execute(
        'INSERT INTO admins (username, password_hash, name, role, wajib_ganti_password, created_at) VALUES (?, ?, ?, ?, 1, NOW())',
        [username, hashedPassword, name, role]
      );
      return { id: res.insertId, username, name, role, tempPassword: rawPass, initialPassword: rawPass, wajib_ganti_password: true };
    } catch (_) {
      const [res] = await pool.execute(
        'INSERT INTO admins (username, password, name, role, created_at) VALUES (?, ?, ?, ?, NOW())',
        [username, hashedPassword, name, role]
      );
      return { id: res.insertId, username, name, role, tempPassword: rawPass, initialPassword: rawPass, wajib_ganti_password: true };
    }
  }

  const mem = getMemoryStore();
  const newAdm = { id: Date.now(), username, password_hash: hashedPassword, name, role, wajib_ganti_password: true };
  mem.admins.push(newAdm);
  return { ...newAdm, tempPassword: rawPass, initialPassword: rawPass };
}

async function updateAdmin(id, adminData) {
  const cleanId = String(id).trim();
  const pool = getPool();
  const rawP = adminData.password || adminData.password_hash;
  const hashedP = rawP ? (isBcryptHash(rawP) ? rawP : hashPasswordSync(rawP)) : null;

  if (pool) {
    try {
      await pool.execute(
        `UPDATE admins SET
          name = COALESCE(?, name),
          role = COALESCE(?, role),
          password_hash = COALESCE(?, password_hash),
          wajib_ganti_password = COALESCE(?, wajib_ganti_password)
         WHERE id = ? OR username = ?`,
        [adminData.name || null, adminData.role || null, hashedP, adminData.wajib_ganti_password !== undefined ? (adminData.wajib_ganti_password ? 1 : 0) : null, cleanId, cleanId]
      );
    } catch (_) {
      await pool.execute(
        `UPDATE admins SET
          name = COALESCE(?, name),
          role = COALESCE(?, role),
          password = COALESCE(?, password)
         WHERE id = ? OR username = ?`,
        [adminData.name || null, adminData.role || null, hashedP, cleanId, cleanId]
      );
    }
    const [rows] = await pool.execute('SELECT id, username, name, role, wajib_ganti_password FROM admins WHERE id = ? OR username = ?', [cleanId, cleanId]);
    return rows[0] || null;
  }
  const mem = getMemoryStore();
  const a = mem.admins.find(adm => String(adm.id) === cleanId || adm.username === cleanId);
  if (a) {
    Object.assign(a, adminData);
    if (hashedP) {
      a.password_hash = hashedP;
      delete a.password;
    }
  }
  return a;
}

async function deleteAdmin(id) {
  const cleanId = String(id).trim();
  const pool = getPool();
  if (pool) {
    const [res] = await pool.execute('DELETE FROM admins WHERE id = ? OR username = ?', [cleanId, cleanId]);
    return res.affectedRows > 0;
  }
  const mem = getMemoryStore();
  const idx = mem.admins.findIndex(adm => String(adm.id) === cleanId || adm.username === cleanId);
  if (idx >= 0) {
    mem.admins.splice(idx, 1);
    return true;
  }
  return false;
}

// ==============================================================
// STORAGE & FILES (100% DI MYSQL TANPA BUCKET EKSTERNAL)
// ==============================================================
async function uploadToStorage(bucketName, fileName, fileBuffer, contentType = 'application/octet-stream') {
  const pool = getPool();

  // Jika berupa foto/gambar, simpan sebagai Data URI langsung agar langsung tampil di browser!
  if (contentType && contentType.startsWith('image/')) {
    const base64 = fileBuffer.toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    // Simpan juga salinan biner di tabel files jika MySQL aktif
    if (pool) {
      try {
        const id = `${bucketName}_${fileName}`;
        await pool.execute(
          `INSERT INTO files (id, bucket, file_name, content_type, file_data, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE file_data = VALUES(file_data), content_type = VALUES(content_type)`,
          [id, bucketName, fileName, contentType, fileBuffer]
        );
      } catch (e) {
        console.warn('MySQL file table insert notice:', e.message);
      }
    }
    return dataUri;
  }

  // Untuk dokumen PDF (LPTI, template sertifikat): simpan ke tabel files
  if (pool) {
    try {
      const id = `${bucketName}_${fileName}`;
      await pool.execute(
        `INSERT INTO files (id, bucket, file_name, content_type, file_data, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE file_data = VALUES(file_data), content_type = VALUES(content_type)`,
        [id, bucketName, fileName, contentType, fileBuffer]
      );
      return `/api/files/${encodeURIComponent(bucketName)}/${encodeURIComponent(fileName)}`;
    } catch (err) {
      console.error(`[MySQL Storage Error] (${bucketName}/${fileName}):`, err.message);
      if (isProd()) throw new Error(`Gagal menyimpan file ke database MySQL: ${err.message}`);
    }
  }

  // Fallback Data URI
  const base64 = fileBuffer.toString('base64');
  return `data:${contentType};base64,${base64}`;
}

async function getFile(bucket, fileName) {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.execute(
        'SELECT file_name, content_type, file_data FROM files WHERE bucket = ? AND file_name = ? LIMIT 1',
        [bucket, fileName]
      );
      if (rows && rows.length > 0) {
        return {
          fileName: rows[0].file_name,
          contentType: rows[0].content_type,
          fileBuffer: rows[0].file_data
        };
      }
    } catch (err) {
      console.error('[MySQL Error] getFile:', err.message);
    }
  }
  return null;
}

async function getSystemSettings() {
  const activeEvt = await getActiveEvent();
  const prefix = activeEvt?.certSettings?.prefix || '800.1.3/SERT-LPTI/2026';
  let counter = 1;

  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query('SELECT COUNT(*) AS total FROM employees WHERE certificate_number IS NOT NULL');
      counter = (rows[0]?.total || 0) + 1;
    } catch (e) {}
  } else {
    const mem = getMemoryStore();
    const certCount = (mem.employees || []).filter(e => e.certificate && e.certificate.number).length;
    counter = certCount + 1;
  }

  return { certPrefix: prefix, certCounter: counter };
}

// ==============================================================
// PERSISTENSI QR TOKEN & SERTIFIKAT KE MYSQL
// ==============================================================
async function saveQrToken(eventId, token, validUntil) {
  const pool = getPool();
  if (!pool) return false;
  try {
    const validDate = validUntil ? new Date(validUntil) : new Date(Date.now() + 30000);
    
    // 1. In-place update ke tabel events: hemat ruang & anti-bloat (hanya 1 baris aktif per event)
    if (eventId) {
      await pool.execute(
        `UPDATE events SET
           previous_qr_token = current_qr_token,
           current_qr_token = ?,
           qr_valid_until = ?
         WHERE id = ?`,
        [token, validDate, eventId]
      );
    }

    // 2. Simpan token terbaru ke qr_tokens
    await pool.execute(
      `INSERT INTO qr_tokens (event_id, token, valid_until) VALUES (?, ?, ?)`,
      [eventId || 'EVT-DEFAULT', token, validDate]
    );

    // 3. AUTO-CLEANUP / PRUNING: Hapus token kedaluwarsa (> 2 menit yang lalu)
    // Menjamin tabel qr_tokens tidak pernah membengkak (selalu maksimal 2-4 baris saja)
    await pool.execute(
      `DELETE FROM qr_tokens WHERE valid_until < NOW() - INTERVAL 2 MINUTE`
    );

    return true;
  } catch (err) {
    console.warn('[MySQL Warning] saveQrToken error:', err.message);
    return false;
  }
}

async function isQrTokenValid(eventId, token) {
  const pool = getPool();
  if (!pool) return false;
  try {
    // 1. Cek langsung ke tabel events (paling cepat dan hemat tanpa query tabel riwayat)
    if (eventId) {
      const [evtRows] = await pool.query(
        `SELECT id FROM events 
         WHERE id = ? AND (current_qr_token = ? OR previous_qr_token = ?)
         LIMIT 1`,
        [eventId, token, token]
      );
      if (evtRows && evtRows.length > 0) return true;
    }

    // 2. Cek ke tabel qr_tokens toleransi aktif
    const [rows] = await pool.query(
      `SELECT id FROM qr_tokens 
       WHERE (event_id = ? OR event_id = 'EVT-DEFAULT') 
         AND token = ? 
         AND valid_until >= NOW() - INTERVAL 60 SECOND
       LIMIT 1`,
      [eventId || 'EVT-DEFAULT', token]
    );
    return rows && rows.length > 0;
  } catch (err) {
    return false;
  }
}

async function saveCertificate(certData) {
  const pool = getPool();
  const now = certData.issuedAt ? new Date(certData.issuedAt) : new Date();
  if (pool) {
    try {
      await pool.execute(
        `INSERT INTO certificates (
          id, certificate_number, employee_id, nip, name, event_id, event_title,
          issued_at, verifier, verifier_title, pdf_url, crypto_hash, crypto_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          certificate_number = VALUES(certificate_number),
          event_title = VALUES(event_title),
          issued_at = VALUES(issued_at),
          verifier = VALUES(verifier),
          verifier_title = VALUES(verifier_title),
          pdf_url = COALESCE(VALUES(pdf_url), pdf_url),
          crypto_hash = VALUES(crypto_hash),
          crypto_signature = VALUES(crypto_signature)`,
        [
          certData.id || certData.certId,
          certData.number || certData.certificateNumber,
          certData.employeeId || certData.id,
          certData.nip,
          certData.name || '',
          certData.eventId || 'EVT-001',
          certData.eventTitle || '',
          now,
          certData.verifier || 'Junaiddin Pagala, ST, M.T.',
          certData.verifierTitle || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
          certData.pdfUrl || null,
          certData.cryptoHash || null,
          certData.cryptoSignature || null
        ]
      );
      return true;
    } catch (err) {
      console.warn('[MySQL Warning] saveCertificate error:', err.message);
      return false;
    }
  }
  return false;
}

async function getCertificateByIdOrNumber(query) {
  const clean = String(query).trim();
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM certificates WHERE id = ? OR certificate_number = ? LIMIT 1`,
        [clean, clean]
      );
      if (rows.length > 0) return rows[0];
    } catch (err) {}
  }
  return null;
}

async function getAllCertificates(includeDummy = false) {
  const pool = getPool();
  if (pool) {
    try {
      let sql = `SELECT * FROM certificates`;
      if (!includeDummy) {
        sql += ` WHERE is_dummy IS NULL OR is_dummy = 0`;
      }
      sql += ` ORDER BY issued_at DESC`;
      const [rows] = await pool.query(sql);
      return rows;
    } catch (err) {}
  }
  return [];
}

async function deleteDummyCertificates() {
  const pool = getPool();
  let deleted = 0;
  if (pool) {
    try {
      const [res] = await pool.query(`DELETE FROM certificates WHERE is_dummy = 1 OR id LIKE 'TEST%'`);
      deleted = res.affectedRows || 0;
    } catch (err) {}
  }
  return { success: true, deleted };
}

// Memory fallback store untuk MySQL mode
const mysqlCertStore = {
  templates: [],
  issued: []
};

async function saveCertificateTemplate(templateData) {
  const pool = getPool();
  const id = templateData.id || `tpl-${Date.now()}`;
  const record = {
    id: id,
    nama: templateData.nama || 'Template Sertifikat Kustom',
    file_latar: templateData.file_latar || templateData.filePath || '',
    config_json: templateData.config_json || templateData.config || {},
    versi: parseInt(templateData.versi, 10) || 1,
    aktif: templateData.aktif !== false,
    dibuat_oleh: templateData.dibuat_oleh || 'Admin Kepegawaian',
    updated_at: new Date().toISOString()
  };

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO template_sertifikat (id, nama, file_latar, config_json, versi, aktif, dibuat_oleh, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE nama=VALUES(nama), file_latar=VALUES(file_latar), config_json=VALUES(config_json), versi=VALUES(versi), aktif=VALUES(aktif), updated_at=NOW()`,
        [record.id, record.nama, record.file_latar, JSON.stringify(record.config_json), record.versi, record.aktif ? 1 : 0, record.dibuat_oleh]
      );
    } catch (e) {}
  }

  const idx = mysqlCertStore.templates.findIndex(t => t.id === id);
  if (idx >= 0) mysqlCertStore.templates[idx] = { ...mysqlCertStore.templates[idx], ...record };
  else mysqlCertStore.templates.push(record);
  return record;
}

async function getAllCertificateTemplates() {
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(`SELECT * FROM template_sertifikat ORDER BY created_at DESC`);
      if (rows && rows.length > 0) return rows;
    } catch (e) {}
  }
  return mysqlCertStore.templates;
}

async function getCertificateTemplateById(id) {
  if (!id) return null;
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(`SELECT * FROM template_sertifikat WHERE id = ? LIMIT 1`, [id]);
      if (rows.length > 0) return rows[0];
    } catch (e) {}
  }
  return mysqlCertStore.templates.find(t => t.id === id) || null;
}

async function saveIssuedCertificate(certData) {
  const pool = getPool();
  const now = certData.issued_at || new Date().toISOString();
  const id = certData.id || `cert-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const record = {
    id: id,
    event_id: certData.event_id || certData.eventId,
    pegawai_id: certData.pegawai_id || certData.pegawaiId || certData.employeeId,
    nomor: certData.nomor || certData.number,
    token: certData.token,
    template_id: certData.template_id || certData.templateId || 'preset-a',
    template_versi: parseInt(certData.template_versi || 1, 10),
    versi: parseInt(certData.versi || 1, 10),
    status: certData.status || 'valid',
    revoked_at: certData.revoked_at || null,
    revocation_reason: certData.revocation_reason || null,
    issued_at: now,
    created_at: now
  };

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO sertifikat (id, event_id, pegawai_id, nomor, token, template_id, template_versi, versi, status, issued_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE status=VALUES(status), versi=VALUES(versi)`,
        [record.id, record.event_id, record.pegawai_id, record.nomor, record.token, record.template_id, record.template_versi, record.versi, record.status, record.issued_at]
      );
    } catch (e) {}
  }

  const idx = mysqlCertStore.issued.findIndex(c => c.id === id || c.token === record.token);
  if (idx >= 0) mysqlCertStore.issued[idx] = { ...mysqlCertStore.issued[idx], ...record };
  else mysqlCertStore.issued.push(record);
  return record;
}

async function getCertificateByToken(token) {
  if (!token) return null;
  const clean = String(token).trim();
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(`SELECT * FROM sertifikat WHERE token = ? LIMIT 1`, [clean]);
      if (rows.length > 0) return rows[0];
    } catch (e) {}
  }
  return mysqlCertStore.issued.find(c => c.token === clean) || null;
}

async function getCertificatesByEmployeeId(pegawaiId) {
  if (!pegawaiId) return [];
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(`SELECT * FROM sertifikat WHERE pegawai_id = ? ORDER BY issued_at DESC`, [pegawaiId]);
      if (rows) return rows;
    } catch (e) {}
  }
  return mysqlCertStore.issued.filter(c => c.pegawai_id === pegawaiId);
}

async function revokeCertificate(idOrToken, reason = 'Koreksi Data / Terbit Ulang') {
  const pool = getPool();
  const now = new Date().toISOString();
  if (pool) {
    try {
      await pool.query(
        `UPDATE sertifikat SET status = 'revoked', revoked_at = NOW(), revocation_reason = ? WHERE id = ? OR token = ?`,
        [reason, idOrToken, idOrToken]
      );
    } catch (e) {}
  }
  const item = mysqlCertStore.issued.find(c => c.id === idOrToken || c.token === idOrToken);
  if (item) {
    item.status = 'revoked';
    item.revoked_at = now;
    item.revocation_reason = reason;
  }
  return true;
}

async function getNextCertificateSequence(year = new Date().getFullYear()) {
  let maxSeq = 0;
  const pool = getPool();
  if (pool) {
    try {
      const [rows] = await pool.query(`SELECT nomor FROM sertifikat`);
      for (const r of rows) {
        if (r.nomor) {
          const parts = r.nomor.split('/');
          const p1 = parseInt(parts[0], 10);
          if (!isNaN(p1) && p1 > maxSeq) maxSeq = p1;
        }
      }
    } catch (e) {}
  }
  for (const c of mysqlCertStore.issued) {
    if (c.nomor) {
      const parts = c.nomor.split('/');
      const p1 = parseInt(parts[0], 10);
      if (!isNaN(p1) && p1 > maxSeq) maxSeq = p1;
    }
  }
  return maxSeq + 1;
}

async function getAttendanceLogs(eventId = null) {
  const pool = getPool();
  if (pool) {
    try {
      if (eventId) {
        const [rows] = await pool.query(
          `SELECT * FROM attendances WHERE event_id = ? ORDER BY attended_at DESC`,
          [eventId]
        );
        return rows;
      }
      const [rows] = await pool.query(`SELECT * FROM attendances ORDER BY attended_at DESC LIMIT 500`);
      return rows;
    } catch (err) {}
  }
  return [];
}

async function resetTestingData() {
  const pool = getPool();
  if (pool) {
    await pool.execute(
      `UPDATE employees SET
        attended = 0,
        attended_at = NULL,
        accumulated_jp = 0,
        lpti_status = 'none',
        lpti_file_name = NULL,
        lpti_file_path = NULL,
        certificate_number = NULL,
        certificate_issued_at = NULL,
        attendance_photo_url = NULL,
        updated_at = NOW()`
    );
  }
  const mem = getMemoryStore();
  (mem.employees || []).forEach(e => {
    e.attended = false;
    e.attendedAt = null;
    e.accumulatedJp = 0;
  });
  return true;
}

module.exports = {
  isConfigured,
  isDatabaseAvailable: () => Boolean(getPool()),
  isSupabaseAvailable: () => Boolean(getPool()), // Alias untuk kompatibilitas
  getPool,
  setPool,
  initDb,
  getAllEmployees,
  getEmployeeByIdOrNip,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  resetEmployeePassword,
  ensureEmployeeJp,
  markEmployeeAttended,
  updateEmployeeLpti,
  verifyEmployeeLpti,
  saveEmployeeLpti: updateEmployeeLpti,
  updateLptiStatus: verifyEmployeeLpti,
  getAllEvents,
  getActiveEvent,
  getEventById,
  saveEvent,
  activateEventById,
  completeEventById,
  syncEvents,
  deleteEventById,
  toggleActiveEventStatus,
  updateEventTemplate,
  updateEventCertSettings,
  verifyAdminCredentials,
  getAllAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  getSystemSettings,
  uploadToStorage,
  getFile,
  resetTestingData,
  saveQrToken,
  isQrTokenValid,
  saveCertificate,
  getCertificateByIdOrNumber,
  getAllCertificates,
  deleteDummyCertificates,
  saveCertificateTemplate,
  getAllCertificateTemplates,
  getCertificateTemplateById,
  saveIssuedCertificate,
  getCertificateByToken,
  getCertificatesByEmployeeId,
  revokeCertificate,
  getNextCertificateSequence,
  getAttendanceLogs
};
