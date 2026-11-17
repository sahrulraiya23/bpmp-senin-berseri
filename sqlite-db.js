const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
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
  let certificateTemplate = null;
  let certSettings = null;
  try {
    if (row.certificate_template) certificateTemplate = JSON.parse(row.certificate_template);
  } catch {}
  try {
    if (row.cert_settings) certSettings = JSON.parse(row.cert_settings);
  } catch {}

  return {
    id: row.id,
    title: row.title,
    jp: row.jp || 32,
    category: row.category,
    schedule: row.schedule,
    location: row.location,
    organizer: row.organizer,
    active: Boolean(row.active),
    certificateTemplate: certificateTemplate,
    certSettings: certSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'superadmin',
      created_at TEXT
    )
  `);

  const existingAdmin = await get('SELECT * FROM admins WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    await run(
      'INSERT INTO admins (username, password, name, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['admin', 'Bpmp2026!', 'Administrator Kepegawaian BPMP Sultra', 'superadmin', new Date().toISOString()]
    );
  }

  await run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      jp INTEGER NOT NULL DEFAULT 32,
      category TEXT NOT NULL,
      schedule TEXT,
      location TEXT,
      organizer TEXT,
      active INTEGER DEFAULT 0,
      certificate_template TEXT,
      cert_settings TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await run(`
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

  await run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  const certPrefix = await get('SELECT value FROM system_settings WHERE key = ?', ['cert_prefix']);
  if (!certPrefix) {
    await run('INSERT INTO system_settings (key, value) VALUES (?, ?)', ['cert_prefix', '800.1.3/SERT-LPTI/2026']);
    await run('INSERT INTO system_settings (key, value) VALUES (?, ?)', ['cert_counter', '1']);
  }

  // Seed employees from db.json if employees table empty
  const empCount = await get('SELECT COUNT(*) as count FROM employees');
  if (empCount.count === 0) {
    const jsonPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(jsonPath)) {
      const dbJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const rawEmployees = dbJson.employees || [];
      for (const emp of rawEmployees) {
        await run(`
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
          null,
          null,
          null,
          null,
          null
        ]);
      }
    }
  }
}

// ==========================================
// DATA ACCESS HELPERS
// ==========================================

async function getAllEmployees() {
  const rows = await all('SELECT * FROM employees ORDER BY id ASC');
  return rows.map(formatEmployee);
}

async function getEmployeeByIdOrNip(idOrNip) {
  if (!idOrNip) return null;
  const clean = String(idOrNip).trim();
  const row = await get('SELECT * FROM employees WHERE id = ? OR nip = ?', [clean, clean]);
  return formatEmployee(row);
}

async function markEmployeeAttended(employeeId, eventId, eventTitle) {
  const now = new Date().toISOString();
  await run(
    'UPDATE employees SET attended = 1, attended_at = ?, event_id = ?, event_title = ? WHERE id = ? OR nip = ?',
    [now, eventId, eventTitle, employeeId, employeeId]
  );
  return getEmployeeByIdOrNip(employeeId);
}

async function updateEmployeeLpti(employeeId, lptiData) {
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
    lptiData.uploadedAt || new Date().toISOString(),
    employeeId,
    employeeId
  ]);
  return getEmployeeByIdOrNip(employeeId);
}

async function verifyEmployeeLpti(employeeId, action, revisionNote, eventJp = 32) {
  const emp = await getEmployeeByIdOrNip(employeeId);
  if (!emp) return null;

  if (action === 'approve') {
    let certNumber = emp.certificate?.number;
    let issuedAt = emp.certificate?.issuedAt;

    if (!certNumber) {
      const counterRow = await get("SELECT value FROM system_settings WHERE key = 'cert_counter'");
      const counter = parseInt(counterRow?.value || '1', 10);
      const prefixRow = await get("SELECT value FROM system_settings WHERE key = 'cert_prefix'");
      const prefix = prefixRow?.value || '800.1.3/SERT-LPTI/' + new Date().getFullYear();
      certNumber = `${prefix}/${String(counter).padStart(3, '0')}`;
      issuedAt = new Date().toISOString();

      await run("UPDATE system_settings SET value = ? WHERE key = 'cert_counter'", [String(counter + 1)]);
    }

    const newJp = (emp.accumulatedJp || 0) + (eventJp || 32);

    await run(`
      UPDATE employees SET
        lpti_status = 'approved',
        lpti_revision_note = '',
        certificate_number = ?,
        certificate_issued_at = ?,
        certificate_verifier = 'Junaiddin Pagala, ST, M.T.',
        certificate_verifier_title = 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
        accumulated_jp = ?
      WHERE id = ? OR nip = ?
    `, [
      certNumber,
      issuedAt,
      newJp,
      emp.id,
      emp.id
    ]);
  } else if (action === 'revise') {
    await run(`
      UPDATE employees SET
        lpti_status = 'revision',
        lpti_revision_note = ?,
        certificate_number = NULL,
        certificate_issued_at = NULL,
        certificate_verifier = NULL,
        certificate_verifier_title = NULL
      WHERE id = ? OR nip = ?
    `, [
      revisionNote || 'Berkas LPTI memerlukan perbaikan.',
      emp.id,
      emp.id
    ]);
  }

  return getEmployeeByIdOrNip(employeeId);
}

// EVENTS HELPERS
async function getAllEvents() {
  const rows = await all('SELECT * FROM events ORDER BY created_at DESC');
  return rows.map(formatEvent);
}

async function getActiveEvent() {
  const row = await get('SELECT * FROM events WHERE active = 1 LIMIT 1');
  return formatEvent(row);
}

async function getEventById(id) {
  const row = await get('SELECT * FROM events WHERE id = ?', [id]);
  return formatEvent(row);
}

async function saveEvent(eventData) {
  const existingEvents = await getAllEvents();
  let eventId = eventData.id;

  if (!eventId || eventId === 'new' || eventData.isNew) {
    const nextNum = existingEvents.length + 1;
    eventId = `EVT-2026-${String(nextNum).padStart(3, '0')}`;
  }

  const existing = await getEventById(eventId);
  const now = new Date().toISOString();

  // If new event is activated, deactivate others
  await run('UPDATE events SET active = 0');

  const title = eventData.title.trim();
  const jp = parseInt(eventData.jp, 10) || 32;
  const category = (eventData.category || 'Teknis & Manajerial Kepegawaian').trim();
  const schedule = (eventData.schedule || 'Jadwal Ditentukan').trim();
  const location = (eventData.location || 'Auditorium Sasana Praja BKPSDM & Hybrid').trim();
  const organizer = (eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara').trim();

  let certificateTemplate = existing ? existing.certificateTemplate : null;
  let certSettings = existing ? existing.certSettings : null;

  if (existing) {
    await run(`
      UPDATE events SET
        title = ?, jp = ?, category = ?, schedule = ?, location = ?,
        organizer = ?, active = 1, updated_at = ?
      WHERE id = ?
    `, [title, jp, category, schedule, location, organizer, now, eventId]);
  } else {
    await run(`
      INSERT INTO events (
        id, title, jp, category, schedule, location, organizer, active,
        certificate_template, cert_settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `, [
      eventId, title, jp, category, schedule, location, organizer,
      certificateTemplate ? JSON.stringify(certificateTemplate) : null,
      certSettings ? JSON.stringify(certSettings) : null,
      now, now
    ]);
  }

  return getEventById(eventId);
}

async function activateEventById(eventId) {
  const target = await getEventById(eventId);
  if (!target) return null;

  await run('UPDATE events SET active = 0');
  await run('UPDATE events SET active = 1, updated_at = ? WHERE id = ?', [new Date().toISOString(), eventId]);
  return getEventById(eventId);
}

async function deleteEventById(eventId) {
  const target = await getEventById(eventId);
  if (!target) return null;

  await run('DELETE FROM events WHERE id = ?', [eventId]);
  // If no active event, set the first remaining event as active
  const remaining = await getAllEvents();
  if (target.active && remaining.length > 0) {
    await activateEventById(remaining[0].id);
  }
  return target;
}

async function toggleActiveEventStatus() {
  const currentActive = await getActiveEvent();
  if (!currentActive) {
    // If none active, try to activate the first available event
    const events = await getAllEvents();
    if (events.length > 0) {
      await activateEventById(events[0].id);
      return getActiveEvent();
    }
    return null;
  }

  await run('UPDATE events SET active = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), currentActive.id]);
  return getEventById(currentActive.id);
}

async function updateEventTemplate(eventId, template) {
  const target = (await getEventById(eventId)) || (await getActiveEvent());
  if (!target) return null;

  const jsonStr = template ? JSON.stringify(template) : null;
  await run('UPDATE events SET certificate_template = ?, updated_at = ? WHERE id = ?', [
    jsonStr,
    new Date().toISOString(),
    target.id
  ]);
  return getEventById(target.id);
}

async function updateEventCertSettings(eventId, settings) {
  const target = (await getEventById(eventId)) || (await getActiveEvent());
  if (!target) return null;

  const jsonStr = settings ? JSON.stringify(settings) : null;
  await run('UPDATE events SET cert_settings = ?, updated_at = ? WHERE id = ?', [
    jsonStr,
    new Date().toISOString(),
    target.id
  ]);

  if (settings?.prefix) {
    await run("UPDATE system_settings SET value = ? WHERE key = 'cert_prefix'", [settings.prefix.trim()]);
  }

  return getEventById(target.id);
}

// ADMIN AUTHENTICATION
async function verifyAdminCredentials(username, password) {
  if (!username || !password) return null;
  const cleanU = String(username).trim();
  const cleanP = String(password).trim();
  const admin = await get('SELECT * FROM admins WHERE username = ? AND password = ?', [cleanU, cleanP]);
  if (!admin) return null;
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role
  };
}

// RESET TESTING DATA (keeps the 104 real employees, clears all dummy tests)
async function resetTestingData() {
  await run(`
    UPDATE employees SET
      event_id = NULL,
      event_title = NULL,
      attended = 0,
      attended_at = NULL,
      accumulated_jp = 0,
      lpti_status = 'none',
      lpti_file_name = NULL,
      lpti_file_original_name = NULL,
      lpti_file_path = NULL,
      lpti_file_size = NULL,
      lpti_uploaded_at = NULL,
      lpti_revision_note = NULL,
      certificate_number = NULL,
      certificate_issued_at = NULL,
      certificate_verifier = NULL,
      certificate_verifier_title = NULL
  `);

  await run('DELETE FROM events');
  await run("UPDATE system_settings SET value = '1' WHERE key = 'cert_counter'");
  return true;
}

module.exports = {
  db,
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
  deleteEventById,
  toggleActiveEventStatus,
  updateEventTemplate,
  updateEventCertSettings,
  verifyAdminCredentials,
  resetTestingData
};
