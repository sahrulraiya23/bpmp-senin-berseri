/**
 * Storage Adapter: SQLite (Local) + JSON Fallback (Vercel Serverless)
 * Mendukung penyimpanan SQLite di lingkungan server/lokal, dan fallback
 * otomatis ke storage JSON berbasis /tmp di Vercel Serverless agar terhindar dari
 * FUNCTION_INVOCATION_FAILED akibat native binary glibc / read-only filesystem.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const IS_VERCEL = Boolean(process.env.VERCEL);
const BASE_DIR = __dirname;
const TMP_DIR = IS_VERCEL ? os.tmpdir() : BASE_DIR;

// Deteksi apakah sqlite3 native binary dapat di-load
let sqlite3 = null;
let useSqlite = false;
let db = null;

if (!IS_VERCEL) {
  try {
    sqlite3 = require('sqlite3').verbose();
    const DB_PATH = path.join(BASE_DIR, 'database.sqlite');
    db = new sqlite3.Database(DB_PATH);
    useSqlite = true;
  } catch (err) {
    console.warn('Driver sqlite3 tidak tersedia atau gagal dimuat, beralih ke engine JSON:', err.message);
    useSqlite = false;
  }
} else {
  // Di Vercel Serverless, gunakan JSON engine di /tmp untuk stabilitas tanpa native C++ addons
  useSqlite = false;
}

// ========================================================
// 1. ENGINE JSON (UNTUK VERCEL SERVERLESS / FALLBACK)
// ========================================================
const JSON_DB_PATH = path.join(TMP_DIR, 'db.json');
const BUNDLED_JSON_PATH = path.join(BASE_DIR, 'db.json');

function initJsonDb() {
  if (IS_VERCEL && !fs.existsSync(JSON_DB_PATH)) {
    try {
      if (fs.existsSync(BUNDLED_JSON_PATH)) {
        fs.copyFileSync(BUNDLED_JSON_PATH, JSON_DB_PATH);
      }
    } catch (e) {
      console.warn('Gagal menyalin db.json awal ke /tmp:', e.message);
    }
  }
}

function readJson() {
  initJsonDb();
  try {
    if (fs.existsSync(JSON_DB_PATH)) {
      return JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
    }
    if (fs.existsSync(BUNDLED_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(BUNDLED_JSON_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading JSON DB:', err.message);
  }
  return {
    admins: [{ id: 1, username: 'admin', password: 'Bpmp2026!', name: 'Administrator Kepegawaian BPMP Sultra', role: 'superadmin' }],
    event: { active: false },
    events: [],
    employees: [],
    system: { certPrefix: "800.1.3/SERT-LPTI/2026", certCounter: 1 }
  };
}

function writeJson(data) {
  try {
    const target = (IS_VERCEL && fs.existsSync('/tmp')) ? JSON_DB_PATH : BUNDLED_JSON_PATH;
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing JSON DB:', err.message);
    return false;
  }
}

// ========================================================
// 2. ENGINE SQLITE (UNTUK LOKAL / DEDICATED SERVER)
// ========================================================
let initialized = false;
let initPromise = null;

function rawRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function rawGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function rawAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function ensureInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      if (useSqlite) {
        await initSqliteDb();
      } else {
        initJsonDb();
      }
      initialized = true;
    })();
  }
  await initPromise;
}

async function run(sql, params = []) {
  await ensureInitialized();
  return rawRun(sql, params);
}

async function get(sql, params = []) {
  await ensureInitialized();
  return rawGet(sql, params);
}

async function all(sql, params = []) {
  await ensureInitialized();
  return rawAll(sql, params);
}

function formatEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    nip: row.nip,
    name: row.name,
    password: row.password,
    panggol: row.panggol,
    jabatan: row.jabatan,
    instansi: row.instansi,
    pendidikan: row.pendidikan,
    eventId: row.event_id,
    eventTitle: row.event_title,
    attended: Boolean(row.attended),
    attendedAt: row.attended_at,
    accumulatedJp: row.accumulated_jp || 0,
    lpti: {
      status: row.lpti_status || 'none',
      fileName: row.lpti_file_name,
      fileOriginalName: row.lpti_file_original_name,
      filePath: row.lpti_file_path,
      fileSize: row.lpti_file_size,
      uploadedAt: row.lpti_uploaded_at,
      revisionNote: row.lpti_revision_note || ''
    },
    certificate: row.certificate_number ? {
      number: row.certificate_number,
      issuedAt: row.certificate_issued_at,
      verifier: row.certificate_verifier,
      verifierTitle: row.certificate_verifier_title
    } : null
  };
}

function formatEvent(row) {
  if (!row) return null;
  let certTemplate = null;
  let certSettings = null;
  try {
    if (row.certificate_template) certTemplate = JSON.parse(row.certificate_template);
  } catch (e) {}
  try {
    if (row.cert_settings) certSettings = JSON.parse(row.cert_settings);
  } catch (e) {}

  return {
    id: row.id,
    title: row.title,
    jp: row.jp || 32,
    category: row.category,
    schedule: row.schedule,
    location: row.location,
    organizer: row.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: Boolean(row.active),
    status: row.status || (Boolean(row.active) ? 'active' : 'completed'),
    completedAt: row.completed_at || null,
    certificateTemplate: certTemplate,
    certSettings: certSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function initSqliteDb() {
  await rawRun(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'superadmin',
      created_at TEXT
    )
  `);

  const existingAdmin = await rawGet('SELECT * FROM admins WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    await rawRun(
      'INSERT INTO admins (username, password, name, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['admin', 'Bpmp2026!', 'Administrator Kepegawaian BPMP Sultra', 'superadmin', new Date().toISOString()]
    );
  }

  await rawRun(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      jp INTEGER NOT NULL DEFAULT 32,
      category TEXT NOT NULL,
      schedule TEXT,
      location TEXT,
      organizer TEXT,
      active INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      completed_at TEXT,
      certificate_template TEXT,
      cert_settings TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  try {
    await rawRun("ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'active'");
  } catch (e) {}
  try {
    await rawRun("ALTER TABLE events ADD COLUMN completed_at TEXT");
  } catch (e) {}

  await rawRun(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      nip TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT 'Bpmp2026!',
      panggol TEXT,
      jabatan TEXT,
      instansi TEXT,
      pendidikan TEXT,
      event_id TEXT,
      event_title TEXT,
      attended INTEGER DEFAULT 0,
      attended_at TEXT,
      accumulated_jp INTEGER DEFAULT 0,
      lpti_status TEXT DEFAULT 'none',
      lpti_file_name TEXT,
      lpti_file_original_name TEXT,
      lpti_file_path TEXT,
      lpti_file_size INTEGER,
      lpti_uploaded_at TEXT,
      lpti_revision_note TEXT,
      certificate_number TEXT,
      certificate_issued_at TEXT,
      certificate_verifier TEXT,
      certificate_verifier_title TEXT
    )
  `);

  await rawRun(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const certPrefix = await rawGet('SELECT value FROM system_settings WHERE key = ?', ['cert_prefix']);
  if (!certPrefix) {
    await rawRun('INSERT INTO system_settings (key, value) VALUES (?, ?)', ['cert_prefix', '800.1.3/SERT-LPTI/2026']);
    await rawRun('INSERT INTO system_settings (key, value) VALUES (?, ?)', ['cert_counter', '1']);
  }

  // Seed data awal jika tabel pegawai masih kosong
  const empCount = await rawGet('SELECT COUNT(*) as count FROM employees');
  if (empCount.count === 0) {
    const jsonPath = path.join(BASE_DIR, 'db.json');
    if (fs.existsSync(jsonPath)) {
      const dbJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const rawEmployees = dbJson.employees || [];
      for (const emp of rawEmployees) {
        await rawRun(`
          INSERT INTO employees (
            id, nip, name, password, panggol, jabatan, instansi, pendidikan,
            event_id, event_title, attended, attended_at, accumulated_jp,
            lpti_status, lpti_file_name, lpti_file_original_name, lpti_file_path,
            lpti_file_size, lpti_uploaded_at, lpti_revision_note,
            certificate_number, certificate_issued_at, certificate_verifier, certificate_verifier_title
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          emp.id,
          String(emp.nip).trim(),
          emp.name,
          emp.password || 'Bpmp2026!',
          emp.panggol || '',
          emp.jabatan || '',
          emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
          emp.pendidikan || '',
          null,
          null,
          0,
          null,
          0,
          'none',
          null,
          null,
          null,
          null,
          null,
          '',
          null,
          null,
          null,
          null
        ]);
      }
    }
  }

  // Seed default official event jika kosong
  const eventCount = await rawGet('SELECT COUNT(*) as count FROM events');
  if (eventCount.count === 0) {
    await rawRun(`
      INSERT INTO events (
        id, title, jp, category, schedule, location, organizer, active, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `, [
      'EVT-2026-001',
      'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN BPMP Sultra',
      32,
      'Teknis & Manajerial Kepegawaian',
      '18 - 20 November 2026',
      'Auditorium BPMP Sultra',
      'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
      1,
      new Date().toISOString(),
      new Date().toISOString()
    ]);
  }
}

// Inisialisasi awal database
async function initDb() {
  return ensureInitialized();
}

// ========================================================
// 3. UNIVERSAL CRUD METHODS (ADAPTER INTERFACE)
// ========================================================

// EMPLOYEES
async function getAllEmployees() {
  if (useSqlite) {
    const rows = await all('SELECT * FROM employees ORDER BY id ASC');
    return rows.map(formatEmployee);
  } else {
    const dbData = readJson();
    return dbData.employees || [];
  }
}

async function getEmployeeByIdOrNip(idOrNip) {
  if (!idOrNip) return null;
  const clean = String(idOrNip).trim();
  if (useSqlite) {
    const row = await get('SELECT * FROM employees WHERE id = ? OR nip = ?', [clean, clean]);
    return formatEmployee(row);
  } else {
    const dbData = readJson();
    return (dbData.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean) || null;
  }
}

async function markEmployeeAttended(employeeId, eventId, eventTitle) {
  const now = new Date().toISOString();
  if (useSqlite) {
    const existing = await getEmployeeByIdOrNip(employeeId);
    const isNewEvent = Boolean(existing && existing.eventId !== eventId);

    if (isNewEvent) {
      await run(`
        UPDATE employees SET
          attended = 1,
          attended_at = ?,
          event_id = ?,
          event_title = ?,
          lpti_status = 'none',
          lpti_file_name = NULL,
          lpti_file_original_name = NULL,
          lpti_file_path = NULL,
          lpti_file_size = NULL,
          lpti_uploaded_at = NULL,
          lpti_revision_note = '',
          certificate_number = NULL,
          certificate_issued_at = NULL
        WHERE id = ? OR nip = ?
      `, [now, eventId, eventTitle, employeeId, employeeId]);
    } else {
      await run(
        'UPDATE employees SET attended = 1, attended_at = ?, event_id = ?, event_title = ? WHERE id = ? OR nip = ?',
        [now, eventId, eventTitle, employeeId, employeeId]
      );
    }
    return getEmployeeByIdOrNip(employeeId);
  } else {
    const dbData = readJson();
    const clean = String(employeeId).trim();
    const emp = (dbData.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
    if (emp) {
      const isNewEvent = Boolean(emp.eventId !== eventId);
      emp.attended = true;
      emp.attendedAt = now;
      emp.eventId = eventId;
      emp.eventTitle = eventTitle;

      if (isNewEvent) {
        emp.lpti = {
          status: 'none',
          fileName: null,
          fileOriginalName: null,
          filePath: null,
          fileSize: null,
          uploadedAt: null,
          revisionNote: ''
        };
        emp.certificate = null;
      }

      writeJson(dbData);
      return emp;
    }
    return null;
  }
}

async function updateEmployeeLpti(employeeId, lptiData) {
  const uploadedAt = lptiData.uploadedAt || new Date().toISOString();
  if (useSqlite) {
    await run(`
      UPDATE employees SET
        lpti_status = 'pending',
        lpti_file_name = ?,
        lpti_file_original_name = ?,
        lpti_file_path = ?,
        lpti_file_size = ?,
        lpti_uploaded_at = ?,
        lpti_revision_note = '',
        certificate_number = NULL,
        certificate_issued_at = NULL,
        certificate_verifier = NULL,
        certificate_verifier_title = NULL
      WHERE id = ? OR nip = ?
    `, [
      lptiData.fileName,
      lptiData.fileOriginalName,
      lptiData.filePath,
      lptiData.fileSize,
      uploadedAt,
      employeeId,
      employeeId
    ]);
    return getEmployeeByIdOrNip(employeeId);
  } else {
    const dbData = readJson();
    const clean = String(employeeId).trim();
    const emp = (dbData.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
    if (emp) {
      emp.lpti = {
        status: 'pending',
        fileName: lptiData.fileName,
        fileOriginalName: lptiData.fileOriginalName,
        filePath: lptiData.filePath,
        fileSize: lptiData.fileSize,
        uploadedAt: uploadedAt,
        revisionNote: ''
      };
      emp.certificate = null;
      writeJson(dbData);
      return emp;
    }
    return null;
  }
}

async function verifyEmployeeLpti(employeeId, certData = null, revisionNote = null) {
  if (certData) {
    if (useSqlite) {
      await run(`
        UPDATE employees SET
          lpti_status = 'approved',
          lpti_revision_note = '',
          certificate_number = ?,
          certificate_issued_at = ?,
          certificate_verifier = ?,
          certificate_verifier_title = ?,
          accumulated_jp = accumulated_jp + ?
        WHERE id = ? OR nip = ?
      `, [
        certData.number,
        certData.issuedAt,
        certData.verifier,
        certData.verifierTitle,
        certData.eventJp || 32,
        employeeId,
        employeeId
      ]);
      await run("UPDATE system_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'cert_counter'");
      return getEmployeeByIdOrNip(employeeId);
    } else {
      const dbData = readJson();
      const clean = String(employeeId).trim();
      const emp = (dbData.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
      if (emp) {
        if (!emp.lpti) emp.lpti = {};
        emp.lpti.status = 'approved';
        emp.lpti.revisionNote = '';
        emp.certificate = {
          number: certData.number,
          issuedAt: certData.issuedAt,
          verifier: certData.verifier,
          verifierTitle: certData.verifierTitle
        };
        emp.accumulatedJp = (emp.accumulatedJp || 0) + (certData.eventJp || 32);
        if (!dbData.system) dbData.system = {};
        dbData.system.certCounter = (dbData.system.certCounter || 1) + 1;
        writeJson(dbData);
        return emp;
      }
      return null;
    }
  } else if (revisionNote !== null) {
    if (useSqlite) {
      await run(`
        UPDATE employees SET
          lpti_status = 'revision',
          lpti_revision_note = ?,
          certificate_number = NULL,
          certificate_issued_at = NULL,
          certificate_verifier = NULL,
          certificate_verifier_title = NULL
        WHERE id = ? OR nip = ?
      `, [revisionNote, employeeId, employeeId]);
      return getEmployeeByIdOrNip(employeeId);
    } else {
      const dbData = readJson();
      const clean = String(employeeId).trim();
      const emp = (dbData.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
      if (emp) {
        if (!emp.lpti) emp.lpti = {};
        emp.lpti.status = 'revision';
        emp.lpti.revisionNote = revisionNote;
        emp.certificate = null;
        writeJson(dbData);
        return emp;
      }
      return null;
    }
  }
}

// EVENTS
async function getAllEvents() {
  if (useSqlite) {
    const rows = await all('SELECT * FROM events ORDER BY created_at DESC');
    return rows.map(formatEvent);
  } else {
    const dbData = readJson();
    return dbData.events || [];
  }
}

async function getActiveEvent() {
  if (useSqlite) {
    const row = await get('SELECT * FROM events WHERE active = 1 ORDER BY updated_at DESC, created_at DESC LIMIT 1');
    if (row) return formatEvent(row);
    const fallback = await get('SELECT * FROM events ORDER BY updated_at DESC, created_at DESC LIMIT 1');
    return formatEvent(fallback);
  } else {
    const dbData = readJson();
    const activeList = (dbData.events || []).filter(e => e.active);
    if (activeList.length > 0) {
      activeList.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
      return activeList[0];
    }
    if (dbData.event && dbData.event.title) return dbData.event;
    if (dbData.events && dbData.events.length > 0) return dbData.events[0];
    return null;
  }
}

async function getEventById(id) {
  if (!id) return null;
  if (useSqlite) {
    const row = await get('SELECT * FROM events WHERE id = ?', [id]);
    return formatEvent(row);
  } else {
    const dbData = readJson();
    return (dbData.events || []).find(e => e.id === id) || (dbData.event && dbData.event.id === id ? dbData.event : null);
  }
}

async function saveEvent(eventData, isNew = false) {
  const now = new Date().toISOString();
  const shouldBeNew = Boolean(isNew || eventData.isNew || !eventData.id || eventData.id === 'new');

  if (useSqlite) {
    let eventId = eventData.id;
    if (shouldBeNew || !eventId || eventId === 'new') {
      const rows = await all('SELECT id FROM events');
      let maxSeq = 0;
      rows.forEach(r => {
        const match = r.id && r.id.match(/EVT-(\d{4})-(\d+)/i);
        if (match) {
          const num = parseInt(match[2], 10);
          if (num > maxSeq) maxSeq = num;
        }
      });
      const year = new Date().getFullYear();
      eventId = `EVT-${year}-${String(maxSeq + 1).padStart(3, '0')}`;
    }

    const existing = await get('SELECT * FROM events WHERE id = ?', [eventId]);
    if (existing) {
      await run(`
        UPDATE events SET
          title = ?,
          jp = ?,
          category = ?,
          schedule = ?,
          location = ?,
          active = 1,
          status = 'active',
          updated_at = ?
        WHERE id = ?
      `, [
        eventData.title,
        parseInt(eventData.jp, 10) || 32,
        eventData.category,
        eventData.schedule || '',
        eventData.location || '',
        now,
        eventId
      ]);
    } else {
      await run(`
        INSERT INTO events (
          id, title, jp, category, schedule, location, organizer, active, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)
      `, [
        eventId,
        eventData.title,
        parseInt(eventData.jp, 10) || 32,
        eventData.category,
        eventData.schedule || '',
        eventData.location || '',
        eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
        now,
        now
      ]);
    }
    // Pastikan semua event lain non-aktif di layar aula dan QR
    await run('UPDATE events SET active = 0 WHERE id != ?', [eventId]);
    return getEventById(eventId);
  } else {
    const dbData = readJson();
    if (!dbData.events) dbData.events = [];
    let eventId = eventData.id;
    if (shouldBeNew || !eventId || eventId === 'new') {
      let maxSeq = 0;
      dbData.events.forEach(r => {
        const match = r.id && r.id.match(/EVT-(\d{4})-(\d+)/i);
        if (match) {
          const num = parseInt(match[2], 10);
          if (num > maxSeq) maxSeq = num;
        }
      });
      const year = new Date().getFullYear();
      eventId = `EVT-${year}-${String(maxSeq + 1).padStart(3, '0')}`;
    }

    const idx = dbData.events.findIndex(e => e.id === eventId);
    const newEv = {
      id: eventId,
      title: eventData.title,
      jp: parseInt(eventData.jp, 10) || 32,
      category: eventData.category,
      schedule: eventData.schedule || '',
      location: eventData.location || '',
      organizer: eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
      active: true,
      status: 'active',
      completedAt: null,
      certificateTemplate: (idx >= 0 && dbData.events[idx].certificateTemplate) ? dbData.events[idx].certificateTemplate : null,
      certSettings: (idx >= 0 && dbData.events[idx].certSettings) ? dbData.events[idx].certSettings : {
        prefix: '800.1.3/SERT-LPTI/2026',
        nomorYRatio: 0.72,
        namaYRatio: 0.50,
        namaFontSize: 26,
        nomorFontSize: 11
      },
      createdAt: (idx >= 0 && dbData.events[idx].createdAt) ? dbData.events[idx].createdAt : now,
      updatedAt: now
    };

    // Nonaktifkan semua event lain
    dbData.events.forEach(e => {
      e.active = false;
    });

    if (idx >= 0) {
      dbData.events[idx] = { ...dbData.events[idx], ...newEv, active: true };
    } else {
      dbData.events.unshift(newEv);
    }
    dbData.event = newEv;
    writeJson(dbData);
    return newEv;
  }
}

async function activateEventById(eventId) {
  const now = new Date().toISOString();
  if (useSqlite) {
    await run('UPDATE events SET active = 0');
    await run("UPDATE events SET active = 1, status = 'active', updated_at = ? WHERE id = ?", [now, eventId]);
    return getEventById(eventId);
  } else {
    const dbData = readJson();
    (dbData.events || []).forEach(e => {
      e.active = (e.id === eventId);
      if (e.id === eventId) {
        e.status = 'active';
        e.updatedAt = now;
      }
    });
    const found = (dbData.events || []).find(e => e.id === eventId);
    if (found) {
      found.active = true;
      found.status = 'active';
      found.updatedAt = now;
      dbData.event = found;
    }
    writeJson(dbData);
    return found;
  }
}

async function completeEventById(eventId) {
  const now = new Date().toISOString();
  if (useSqlite) {
    await run(`
      UPDATE events SET
        active = 0,
        status = 'completed',
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `, [now, now, eventId]);
    return getEventById(eventId);
  } else {
    const dbData = readJson();
    let target = null;
    (dbData.events || []).forEach(e => {
      if (e.id === eventId) {
        e.active = false;
        e.status = 'completed';
        e.completedAt = now;
        e.updatedAt = now;
        target = e;
      }
    });
    if (dbData.event && dbData.event.id === eventId) {
      dbData.event.active = false;
      dbData.event.status = 'completed';
      dbData.event.completedAt = now;
      dbData.event.updatedAt = now;
    }
    writeJson(dbData);
    return target || getEventById(eventId);
  }
}

async function syncEvents(clientEvents) {
  if (!Array.isArray(clientEvents) || clientEvents.length === 0) {
    return getAllEvents();
  }

  const now = new Date().toISOString();

  if (useSqlite) {
    for (const ev of clientEvents) {
      if (!ev || !ev.id || !ev.title) continue;
      const existing = await get('SELECT * FROM events WHERE id = ?', [ev.id]);
      if (!existing) {
        await run(`
          INSERT INTO events (
            id, title, jp, category, schedule, location, organizer, active, status, completed_at, certificate_template, cert_settings, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          ev.id,
          ev.title,
          ev.jp || 32,
          ev.category || 'Teknis',
          ev.schedule || '',
          ev.location || '',
          ev.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
          ev.active ? 1 : 0,
          ev.status || (ev.active ? 'active' : 'completed'),
          ev.completedAt || null,
          ev.certificateTemplate ? JSON.stringify(ev.certificateTemplate) : null,
          ev.certSettings ? JSON.stringify(ev.certSettings) : null,
          ev.createdAt || now,
          ev.updatedAt || now
        ]);
      } else {
        const clientUp = new Date(ev.updatedAt || 0).getTime();
        const serverUp = new Date(existing.updated_at || 0).getTime();
        if (clientUp > serverUp) {
          await run(`
            UPDATE events SET
              title = ?, jp = ?, category = ?, schedule = ?, location = ?,
              active = ?, status = ?, completed_at = ?, updated_at = ?
            WHERE id = ?
          `, [
            ev.title,
            ev.jp || 32,
            ev.category || 'Teknis',
            ev.schedule || '',
            ev.location || '',
            ev.active ? 1 : 0,
            ev.status || (ev.active ? 'active' : 'completed'),
            ev.completedAt || null,
            ev.updatedAt || now,
            ev.id
          ]);
        }
      }
    }
    return getAllEvents();
  } else {
    const dbData = readJson();
    if (!dbData.events) dbData.events = [];

    clientEvents.forEach(cEv => {
      if (!cEv || !cEv.id || !cEv.title) return;
      const idx = dbData.events.findIndex(e => e.id === cEv.id);
      if (idx === -1) {
        dbData.events.push({
          ...cEv,
          createdAt: cEv.createdAt || now,
          updatedAt: cEv.updatedAt || now
        });
      } else {
        const clientUp = new Date(cEv.updatedAt || 0).getTime();
        const serverUp = new Date(dbData.events[idx].updatedAt || 0).getTime();
        if (clientUp > serverUp) {
          dbData.events[idx] = { ...dbData.events[idx], ...cEv };
        }
      }
    });

    // Urutkan event terbaru
    dbData.events.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Sinkronkan active event
    const activeEv = dbData.events.find(e => e.active);
    if (activeEv) {
      dbData.event = activeEv;
    }

    writeJson(dbData);
    return dbData.events;
  }
}

async function deleteEventById(eventId) {
  if (useSqlite) {
    await run('DELETE FROM events WHERE id = ?', [eventId]);
    const remaining = await get('SELECT * FROM events ORDER BY created_at DESC LIMIT 1');
    if (remaining) {
      await run('UPDATE events SET active = 1 WHERE id = ?', [remaining.id]);
    }
    return true;
  } else {
    const dbData = readJson();
    dbData.events = (dbData.events || []).filter(e => e.id !== eventId);
    if (dbData.event && dbData.event.id === eventId) {
      dbData.event = dbData.events[0] || null;
    }
    writeJson(dbData);
    return true;
  }
}

async function toggleActiveEventStatus() {
  const activeEv = await getActiveEvent();
  if (!activeEv) return { success: false, active: false };
  const newStatus = activeEv.active ? 0 : 1;
  if (useSqlite) {
    await run('UPDATE events SET active = ? WHERE id = ?', [newStatus, activeEv.id]);
    return { success: true, active: Boolean(newStatus), eventId: activeEv.id };
  } else {
    const dbData = readJson();
    const ev = (dbData.events || []).find(e => e.id === activeEv.id) || dbData.event;
    if (ev) {
      ev.active = Boolean(newStatus);
      if (dbData.event) dbData.event.active = Boolean(newStatus);
      writeJson(dbData);
    }
    return { success: true, active: Boolean(newStatus), eventId: activeEv.id };
  }
}

async function updateEventTemplate(eventId, templateData) {
  const serialized = templateData ? JSON.stringify(templateData) : null;
  if (useSqlite) {
    if (eventId) {
      await run('UPDATE events SET certificate_template = ? WHERE id = ?', [serialized, eventId]);
    } else {
      await run('UPDATE events SET certificate_template = ? WHERE active = 1', [serialized]);
    }
    return true;
  } else {
    const dbData = readJson();
    const ev = (dbData.events || []).find(e => e.id === eventId) || dbData.event;
    if (ev) {
      ev.certificateTemplate = templateData;
      if (dbData.event && dbData.event.id === ev.id) {
        dbData.event.certificateTemplate = templateData;
      }
      writeJson(dbData);
    }
    return true;
  }
}

async function updateEventCertSettings(eventId, certSettings) {
  const serialized = JSON.stringify(certSettings);
  if (useSqlite) {
    if (eventId) {
      await run('UPDATE events SET cert_settings = ? WHERE id = ?', [serialized, eventId]);
    } else {
      await run('UPDATE events SET cert_settings = ? WHERE active = 1', [serialized]);
    }
    return true;
  } else {
    const dbData = readJson();
    const ev = (dbData.events || []).find(e => e.id === eventId) || dbData.event;
    if (ev) {
      ev.certSettings = certSettings;
      if (dbData.event && dbData.event.id === ev.id) {
        dbData.event.certSettings = certSettings;
      }
      writeJson(dbData);
    }
    return true;
  }
}

// ADMIN AUTH
async function verifyAdminCredentials(username, password) {
  if (useSqlite) {
    const admin = await get('SELECT id, username, name, role FROM admins WHERE username = ? AND password = ?', [username, password]);
    return admin || null;
  } else {
    const dbData = readJson();
    const admins = dbData.admins || [{ id: 1, username: 'admin', password: 'Bpmp2026!', name: 'Administrator Kepegawaian BPMP Sultra', role: 'superadmin' }];
    const found = admins.find(a => a.username === username && a.password === password);
    if (!found) return null;
    return { id: found.id, username: found.username, name: found.name, role: found.role };
  }
}

// SYSTEM SETTINGS & COUNTER
async function getSystemSettings() {
  if (useSqlite) {
    const rows = await all('SELECT * FROM system_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return {
      certPrefix: settings.cert_prefix || '800.1.3/SERT-LPTI/2026',
      certCounter: parseInt(settings.cert_counter, 10) || 1
    };
  } else {
    const dbData = readJson();
    return dbData.system || { certPrefix: '800.1.3/SERT-LPTI/2026', certCounter: 1 };
  }
}

// RESET TESTING DATA (Jaga semua 104 NIP Pegawai tetap utuh)
async function resetTestingData() {
  if (useSqlite) {
    await run(`
      UPDATE employees SET
        attended = 0,
        attended_at = NULL,
        accumulated_jp = 0,
        event_id = NULL,
        event_title = NULL,
        lpti_status = 'none',
        lpti_file_name = NULL,
        lpti_file_original_name = NULL,
        lpti_file_path = NULL,
        lpti_file_size = NULL,
        lpti_uploaded_at = NULL,
        lpti_revision_note = '',
        certificate_number = NULL,
        certificate_issued_at = NULL,
        certificate_verifier = NULL,
        certificate_verifier_title = NULL
    `);
    await run("UPDATE system_settings SET value = '1' WHERE key = 'cert_counter'");
    return true;
  } else {
    const dbData = readJson();
    dbData.employees = (dbData.employees || []).map(emp => ({
      ...emp,
      attended: false,
      attendedAt: null,
      accumulatedJp: 0,
      eventId: null,
      eventTitle: null,
      lpti: {
        status: 'none',
        fileName: null,
        fileOriginalName: null,
        filePath: null,
        fileSize: null,
        uploadedAt: null,
        revisionNote: ''
      },
      certificate: null
    }));
    if (dbData.system) dbData.system.certCounter = 1;
    writeJson(dbData);
    return true;
  }
}

module.exports = {
  db,
  useSqlite,
  initDb,
  getAllEmployees,
  getEmployeeByIdOrNip,
  markEmployeeAttended,
  updateEmployeeLpti,
  verifyEmployeeLpti,
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
  getSystemSettings,
  resetTestingData
};
