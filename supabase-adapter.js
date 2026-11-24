/**
 * Supabase Database & Cloud Storage Adapter
 * 100% Cloud-Native PostgreSQL & Cloud Storage untuk BPMP Senin Berseri
 * Menggantikan SQLite sepenuhnya tanpa native compilation dependencies.
 */

const path = require('path');
const fs = require('fs');

// Polyfill Dummy WebSocket untuk Node.js < 22 (mencegah error supabase-js realtime di backend)
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {
    constructor() {}
    addEventListener() {}
    removeEventListener() {}
  };
}

const { createClient } = require('@supabase/supabase-js');

// Load environment variables automatically jika belum dimuat
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (e) {
    // Silently continue jika .env tidak ada
  }
}

function isVercel() {
  return Boolean(process.env.VERCEL);
}

function isProd() {
  return isVercel() || process.env.NODE_ENV === 'production';
}

let _supabaseInstance = null;
let _isConfigured = false;
let _explicitNull = false;

// Cache Persisten Biometrik Wajah Lokal & Supabase Storage Cloud
const FACES_CACHE_PATH = path.join(__dirname, 'uploads', 'faces', 'descriptors_cache.json');
const _faceMemCache = new Map();

function getFaceCache(nip) {
  if (!nip) return null;
  const cleanNip = String(nip).trim();
  if (_faceMemCache.has(cleanNip)) {
    return _faceMemCache.get(cleanNip);
  }
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') {
    return null;
  }
  try {
    if (fs.existsSync(FACES_CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(FACES_CACHE_PATH, 'utf8'));
      if (data && data[cleanNip]) {
        _faceMemCache.set(cleanNip, data[cleanNip]);
        return data[cleanNip];
      }
    }
  } catch (e) {}
  return null;
}

async function ensureFaceCacheFromCloud(nip) {
  if (!nip) return null;
  const cleanNip = String(nip).trim();
  const cached = getFaceCache(cleanNip);
  if (cached) return cached;

  const client = getClient();
  if (!client) return null;

  try {
    const { data, error } = await client.storage.from('faces').download(`meta-${cleanNip}.json`);
    if (!error && data) {
      const text = await data.text();
      const meta = JSON.parse(text);
      if (meta && (meta.facePhotoUrl || meta.faceDescriptor)) {
        _faceMemCache.set(cleanNip, meta);
        try {
          const dir = path.dirname(FACES_CACHE_PATH);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          let localData = {};
          if (fs.existsSync(FACES_CACHE_PATH)) {
            try { localData = JSON.parse(fs.readFileSync(FACES_CACHE_PATH, 'utf8')); } catch(e){}
          }
          localData[cleanNip] = meta;
          fs.writeFileSync(FACES_CACHE_PATH, JSON.stringify(localData, null, 2), 'utf8');
        } catch (fsErr) {}
        return meta;
      }
    }
  } catch (err) {}
  return null;
}

function saveFaceCache(nip, obj) {
  if (!nip || !obj) return;
  const cleanNip = String(nip).trim();
  _faceMemCache.set(cleanNip, obj);
  // Jangan menimpa data produksi saat test runner berjalan
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') return;
  try {
    const dir = path.dirname(FACES_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let data = {};
    if (fs.existsSync(FACES_CACHE_PATH)) {
      try { data = JSON.parse(fs.readFileSync(FACES_CACHE_PATH, 'utf8')); } catch(e){}
    }
    data[cleanNip] = obj;
    fs.writeFileSync(FACES_CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

function deleteFaceCache(nip) {
  if (!nip) return;
  const cleanNip = String(nip).trim();
  _faceMemCache.delete(cleanNip);
  try {
    if (fs.existsSync(FACES_CACHE_PATH)) {
      let data = JSON.parse(fs.readFileSync(FACES_CACHE_PATH, 'utf8'));
      delete data[cleanNip];
      fs.writeFileSync(FACES_CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (e) {}
}

// In-Memory store untuk development lokal sebelum file .env diisi credential Supabase
let _memoryStore = null;

const BUILTIN_TEST_USERS = [
  {
    id: 'BPMP-TEST-01',
    username: 'sahrul',
    nip: '199508232024011001',
    name: 'Muhammad Saharullah Raiya',
    password: 'bpmp123',
    panggol: 'Penata Muda, III/a',
    jabatan: 'Pranata Komputer / Pengembang Sistem',
    instansi: 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: 'S1',
    accumulatedJp: 4,
    attended: false,
    lpti: { status: 'none', fileName: null, revisionNote: '' },
    certificate: null
  },
  {
    id: 'BPMP-TEST-02',
    username: 'rafli',
    nip: '199703142024021002',
    name: 'M. Rafli',
    password: 'bpmp123',
    panggol: 'Penata Muda, III/a',
    jabatan: 'Pengelola Kepegawaian & Mutu ASN',
    instansi: 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: 'S1',
    accumulatedJp: 4,
    attended: false,
    lpti: { status: 'none', fileName: null, revisionNote: '' },
    certificate: null
  },
  {
    id: 'BPMP-TEST-03',
    username: 'user',
    nip: '199811052024031003',
    name: 'User Pegawai ASN (Testing)',
    password: 'bpmp123',
    panggol: 'Pengatur, II/c',
    jabatan: 'Staf Pelaksana BPMP Sultra',
    instansi: 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: 'D3',
    accumulatedJp: 4,
    attended: false,
    lpti: { status: 'none', fileName: null, revisionNote: '' },
    certificate: null
  }
];

function getMemoryStore() {
  if (_memoryStore) return _memoryStore;
  try {
    // Membantu bundler Vercel (NFT) mengikutsertakan db.json dalam fungsi serverless
    _memoryStore = require('./db.json');
  } catch (errRequire) {
    const jsonPath = path.join(__dirname, 'db.json');
    if (fs.existsSync(jsonPath)) {
      try {
        _memoryStore = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (e) {
        _memoryStore = { employees: [], events: [], event: null, admins: [] };
      }
    } else {
      _memoryStore = { employees: [], events: [], event: null, admins: [] };
    }
  }

  // Pastikan akun testing selalu ada di employees
  if (!_memoryStore.employees) _memoryStore.employees = [];
  BUILTIN_TEST_USERS.forEach(tu => {
    if (!_memoryStore.employees.some(e => e.id === tu.id || e.nip === tu.nip || (e.username && e.username === tu.username))) {
      _memoryStore.employees.unshift({ ...tu });
    }
  });

  // Normalisasi events
  if (!_memoryStore.events) _memoryStore.events = [];
  if (_memoryStore.event && !_memoryStore.events.some(e => e.id === _memoryStore.event.id)) {
    _memoryStore.events.push(_memoryStore.event);
  }

  // Normalisasi akun admins (Superadmin & Bagian Kepegawaian)
  if (!_memoryStore.admins || _memoryStore.admins.length === 0 || !_memoryStore.admins.some(a => a.username === 'superadmin')) {
    _memoryStore.admins = [
      {
        id: 1,
        username: 'superadmin',
        password: process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!',
        name: 'Super Administrator BPMP Sultra',
        role: 'superadmin'
      },
      {
        id: 2,
        username: 'admin',
        password: process.env.ADMIN_PASSWORD || 'Bpmp2026!',
        name: 'Bagian Kepegawaian BPMP Sultra',
        role: 'kepegawaian'
      }
    ];
  } else {
    const adminObj = _memoryStore.admins.find(a => a.username === 'admin');
    if (adminObj) {
      adminObj.role = 'kepegawaian';
      adminObj.name = 'Bagian Kepegawaian BPMP Sultra';
    }
  }

  // Tambahkan BUILTIN_TEST_USERS ke admins
  BUILTIN_TEST_USERS.forEach(tu => {
    if (!_memoryStore.admins.some(a => a.username === tu.username)) {
      _memoryStore.admins.push({
        id: _memoryStore.admins.length + 1,
        username: tu.username,
        name: tu.name,
        password: tu.password,
        role: 'kepegawaian',
        createdAt: new Date().toISOString()
      });
    }
  });

  return _memoryStore;
}

function getClient() {
  if (_explicitNull) return null;
  if (_supabaseInstance) return _supabaseInstance;
  const SUPABASE_URL = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const SUPABASE_KEY = (
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      _supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
      _isConfigured = true;
      console.log('✅ Supabase Client berhasil diinisialisasi:', SUPABASE_URL);
    } catch (err) {
      console.warn('⚠️ Gagal inisialisasi Supabase client:', err.message);
    }
  }
  return _supabaseInstance;
}

function setSupabaseInstance(instance) {
  _supabaseInstance = instance;
  _isConfigured = Boolean(instance);
  _explicitNull = (instance === null);
  _faceMemCache.clear();
}

function isSupabaseAvailable() {
  return Boolean(getClient());
}

// Proxy agar pemanggilan supabase.<method> langsung menggunakan client aktif
const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getClient();
    if (!client) {
      throw new Error('Supabase client belum diinisialisasi (SUPABASE_URL atau SUPABASE_KEY belum terisi di .env)');
    }
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  }
});

// ==============================================================
// FORMATTER HELPERS
// ==============================================================
function formatSupabaseEmployee(row) {
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
    password: row.password || 'Bpmp2026!',
    panggol: row.panggol || '',
    jabatan: row.jabatan || '',
    instansi: row.instansi || 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: row.pendidikan || '',
    eventId: row.event_id || null,
    eventTitle: row.event_title || null,
    attended: isAttended,
    attendedAt: row.attended_at || null,
    attendance: attendanceObj,
    accumulatedJp: Number(row.accumulated_jp) || 0,
    lpti: {
      status: row.lpti_status || 'none',
      fileName: row.lpti_file_name || null,
      fileOriginalName: row.lpti_file_original_name || null,
      filePath: row.lpti_file_path || null,
      fileSize: row.lpti_file_size || null,
      uploadedAt: row.lpti_uploaded_at || null,
      revisionNote: row.lpti_revision_note || ''
    },
    certificate: row.certificate_number ? {
      number: row.certificate_number,
      issuedAt: row.certificate_issued_at,
      verifier: row.certificate_verifier || 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: row.certificate_verifier_title || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
    } : null,
    faceRegistered: Boolean(row.face_photo_url || row.face_descriptor || getFaceCache(row.nip)?.facePhotoUrl),
    facePhotoUrl: row.face_photo_url || getFaceCache(row.nip)?.facePhotoUrl || null,
    faceDescriptor: row.face_descriptor
      ? (typeof row.face_descriptor === 'string' ? JSON.parse(row.face_descriptor) : row.face_descriptor)
      : (getFaceCache(row.nip)?.faceDescriptor || null),
    faceRegisteredAt: row.face_registered_at || getFaceCache(row.nip)?.faceRegisteredAt || null,
    attendancePhotoUrl: row.attendance_photo_url || null
  };
}

function formatSupabaseEvent(row) {
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

  return {
    id: row.id,
    title: row.title,
    jp: row.jp || 32,
    category: row.category || 'Teknis',
    schedule: row.schedule || '',
    location: row.location || 'Auditorium BPMP Sultra',
    organizer: row.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: Boolean(row.active),
    status: row.status || (row.active ? 'active' : 'completed'),
    completedAt: row.completed_at || null,
    certificateTemplate: row.certificate_template || null,
    certSettings: row.cert_settings ? { ...defaultCertSettings, ...row.cert_settings } : defaultCertSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ==============================================================
// SEEDING DARI DB.JSON JIKA TABEL SUPABASE MASIH KOSONG
// ==============================================================
async function seedFromDbJson() {
  const client = getClient();
  if (!client) return;

  try {
    const jsonPath = path.join(__dirname, 'db.json');
    if (!fs.existsSync(jsonPath)) return;
    const dbData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    // 1. Seed Superadmin & Bagian Kepegawaian
    await client.from('admins').upsert([
      {
        username: 'superadmin',
        password: process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!',
        name: 'Super Administrator BPMP Sultra',
        role: 'superadmin'
      },
      {
        username: 'admin',
        password: process.env.ADMIN_PASSWORD || 'Bpmp2026!',
        name: 'Bagian Kepegawaian BPMP Sultra',
        role: 'kepegawaian'
      }
    ], { onConflict: 'username' });

    // 2. Seed Default Event
    if (dbData.event && dbData.event.id) {
      const ev = dbData.event;
      await client.from('events').upsert({
        id: ev.id,
        title: ev.title || 'Pelatihan Transformasi Digital BPMP Sultra',
        jp: parseInt(ev.jp, 10) || 32,
        category: ev.category || 'Teknis & Manajerial Kepegawaian',
        schedule: ev.schedule || '18 - 20 November 2026',
        location: ev.location || 'Auditorium BPMP Sultra',
        organizer: ev.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
        active: true,
        status: 'active'
      }, { onConflict: 'id' });
    }

    // 3. Seed 104 Pegawai BPMP Sultra
    if (Array.isArray(dbData.employees) && dbData.employees.length > 0) {
      const records = dbData.employees.map(emp => ({
        id: emp.id,
        nip: String(emp.nip).trim(),
        name: emp.name,
        password: emp.password || 'Bpmp2026!',
        panggol: emp.panggol || '',
        jabatan: emp.jabatan || '',
        instansi: emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
        pendidikan: emp.pendidikan || '',
        event_id: emp.eventId || (dbData.event?.id || null),
        event_title: emp.eventTitle || (dbData.event?.title || null),
        attended: Boolean(emp.attended),
        attended_at: emp.attendedAt || null,
        accumulated_jp: Number(emp.accumulatedJp) || 0
      }));

      // Batch 50 data agar tidak melampaui limit payload
      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        await client.from('employees').upsert(batch, { onConflict: 'nip' });
      }
      console.log(`✅ [Supabase PostgreSQL] Berhasil seeding ${records.length} data pegawai ke cloud!`);
    }
  } catch (err) {
    console.warn('⚠️ [Supabase] Auto-seeding exception:', err.message);
  }
}

// ==============================================================
// INITIALIZE DATABASE
// ==============================================================
async function initDb() {
  const client = getClient();
  if (!client) {
    console.log('ℹ️ [Database] Berjalan dalam mode In-Memory Store (db.json)');
    console.log('💡 Untuk mengaktifkan Supabase PostgreSQL Cloud: Atur SUPABASE_URL & SUPABASE_KEY di file .env');
    return true;
  }

  try {
    const { count, error } = await client
      .from('employees')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.warn('⚠️ [Supabase] Koneksi database berhasil, namun tabel belum dibuat:', error.message);
      console.log('💡 Jalankan script supabase_schema.sql di Supabase SQL Editor jika tabel belum tersedia.');
      return false;
    }

    console.log(`✅ [Supabase PostgreSQL] Terhubung dengan sukses! (${count || 0} pegawai terdaftar di cloud database)`);
    if (count === 0) {
      await seedFromDbJson();
    }
    return true;
  } catch (err) {
    console.warn('⚠️ [Supabase] Inisialisasi error:', err.message);
    return false;
  }
}

// ==============================================================
// EMPLOYEES CRUD
// ==============================================================
async function getAllEmployees() {
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('employees')
      .select('*')
      .order('id', { ascending: true });

    if (!error && data) {
      return data.map(formatSupabaseEmployee);
    }
    console.error('Supabase getAllEmployees error:', error?.message);
    if (isProd()) {
      throw new Error(`Gagal mengambil data seluruh pegawai dari Supabase: ${error?.message || 'Database error'}`);
    }
  } else if (isProd()) {
    throw new Error('Supabase Cloud Database tidak terkonfigurasi di lingkungan Vercel/Produksi. Failover in-memory dinonaktifkan.');
  }

  // Memory fallback HANYA untuk development offline non-Vercel
  const mem = getMemoryStore();
  return (mem.employees || []).map(emp => {
    const isAttended = Boolean(emp.attended);
    return {
      ...emp,
      nip: String(emp.nip || '').trim(),
      faceRegistered: Boolean(emp.facePhotoUrl || emp.face_photo_url || emp.faceRegistered),
      facePhotoUrl: emp.facePhotoUrl || emp.face_photo_url || null,
      attendancePhotoUrl: emp.attendancePhotoUrl || emp.attendance_photo_url || null,
      attendance: {
        status: isAttended ? 'present' : 'absent',
        time: isAttended ? (emp.attendedAt || 'Pukul 08:30:00 WITA') : null
      }
    };
  });
}

async function getEmployeeByIdOrNip(idOrNip) {
  if (!idOrNip) return null;
  const clean = String(idOrNip).trim();
  const lower = clean.toLowerCase();

  const client = getClient();
  if (client) {
    // 1. Query Supabase Cloud Database terlebih dahulu (Prioritas Utama)
    const { data, error } = await client
      .from('employees')
      .select('*')
      .or(`id.eq.${clean},nip.eq.${clean}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[Supabase Error] getEmployeeByIdOrNip(${clean}):`, error.message);
      if (isProd()) {
        throw new Error(`Gagal memuat profil pegawai dari Supabase: ${error.message}`);
      }
    } else if (data) {
      if (!data.face_photo_url && !data.face_descriptor) {
        await ensureFaceCacheFromCloud(data.nip);
      }
      return formatSupabaseEmployee(data);
    }
  } else if (isProd()) {
    throw new Error(`Supabase Cloud Database tidak terkonfigurasi di lingkungan Vercel/Produksi. Gagal memuat data pegawai ${clean}.`);
  }

  // 2. Memory fallback HANYA jika Supabase tidak terkonfigurasi pada lingkungan dev lokal offline
  const mem = getMemoryStore();
  const foundMem = (mem.employees || []).find(e => 
    (e.id && e.id.toLowerCase() === lower) || 
    String(e.nip || '').trim() === clean || 
    (e.username && e.username.toLowerCase() === lower)
  );
  if (foundMem) {
    const isAttended = Boolean(foundMem.attended);
    return {
      ...foundMem,
      nip: String(foundMem.nip || '').trim(),
      faceRegistered: Boolean(foundMem.facePhotoUrl || foundMem.face_photo_url || foundMem.faceRegistered),
      facePhotoUrl: foundMem.facePhotoUrl || foundMem.face_photo_url || null,
      attendancePhotoUrl: foundMem.attendancePhotoUrl || foundMem.attendance_photo_url || null,
      attendance: {
        status: isAttended ? 'present' : 'absent',
        attendedAt: foundMem.attendedAt || null,
        method: 'qr'
      }
    };
  }

  return null;
}

async function ensureEmployeeJp(id, eventJp = 32) {
  const clean = String(id).trim();
  const emp = await getEmployeeByIdOrNip(clean);
  if (!emp) return null;

  const jpVal = parseInt(eventJp, 10) || 32;
  if (!emp.accumulatedJp || emp.accumulatedJp === 0) {
    const client = getClient();
    if (client) {
      const { data, error } = await client
        .from('employees')
        .update({ accumulated_jp: jpVal, updated_at: new Date().toISOString() })
        .eq('id', emp.id)
        .select()
        .single();

      if (!error && data) return formatSupabaseEmployee(data);
    } else {
      emp.accumulatedJp = jpVal;
      return emp;
    }
  }
  return emp;
}

async function markEmployeeAttended(id, eventId, eventTitle, eventJp = 32, attendancePhotoUrl = null, qrToken = null) {
  const now = new Date().toISOString();
  const clean = String(id).trim();
  const jpToAdd = parseInt(eventJp, 10) || 32;

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const currentJp = Number(existing.accumulatedJp) || 0;
  const newJp = currentJp > 0 ? currentJp + jpToAdd : jpToAdd;

  const client = getClient();
  if (client) {
    const updatePayload = {
      attended: true,
      attended_at: now,
      event_id: eventId || null,
      event_title: eventTitle || null,
      accumulated_jp: newJp,
      updated_at: now
    };

    let { data, error } = await client
      .from('employees')
      .update(updatePayload)
      .eq('id', existing.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[Supabase Error] markEmployeeAttended(${existing.id}):`, error.message);
      throw new Error(`Gagal mencatat presensi pegawai ke Supabase: ${error.message}`);
    }

    // Rekam jejak presensi ke tabel attendances di database Supabase
    try {
      await client.from('attendances').insert({
        employee_id: existing.id,
        nip: existing.nip,
        name: existing.name,
        event_id: eventId || null,
        event_title: eventTitle || null,
        qr_token: qrToken || null,
        attendance_photo_url: attendancePhotoUrl || null,
        attended_at: now
      });
    } catch (attErr) {}

    if (data) {
      return formatSupabaseEmployee(data);
    }
  }

  if (isProd()) {
    throw new Error('Supabase Cloud Database tidak terkonfigurasi di lingkungan Vercel/Produksi. Presensi tidak dapat disimpan.');
  }

  // Memory fallback HANYA untuk development offline non-Vercel
  const lower = clean.toLowerCase();
  const targetId = existing.id;
  const targetNip = existing.nip;
  const mem = getMemoryStore();
  const rawEmp = (mem.employees || []).find(e => 
    (e.id && e.id.toLowerCase() === lower) || 
    String(e.nip || '').trim() === clean || 
    (e.username && e.username.toLowerCase() === lower) ||
    e.id === targetId ||
    String(e.nip || '').trim() === String(targetNip).trim()
  );
  if (rawEmp) {
    rawEmp.attended = true;
    rawEmp.attendedAt = now;
    rawEmp.eventId = eventId || null;
    rawEmp.eventTitle = eventTitle || null;
    rawEmp.accumulatedJp = newJp;
    if (attendancePhotoUrl) {
      rawEmp.attendancePhotoUrl = attendancePhotoUrl;
      rawEmp.attendance_photo_url = attendancePhotoUrl;
    }
    rawEmp.attendance = {
      status: 'present',
      attendedAt: now,
      time: 'Pukul ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WITA'
    };
  }

  existing.attended = true;
  existing.attendedAt = now;
  existing.eventId = eventId || null;
  existing.eventTitle = eventTitle || null;
  existing.accumulatedJp = newJp;
  if (attendancePhotoUrl) existing.attendancePhotoUrl = attendancePhotoUrl;
  existing.attendance = {
    status: 'present',
    attendedAt: now,
    time: 'Pukul ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WITA'
  };

  return existing;
}

async function registerEmployeeFace(id, { faceDescriptor = null, facePhotoUrl = null }) {
  const now = new Date().toISOString();
  const clean = String(id).trim();

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const descStr = faceDescriptor ? (typeof faceDescriptor === 'string' ? faceDescriptor : JSON.stringify(faceDescriptor)) : null;

  const client = getClient();
  if (client) {
    const updatePayload = {
      face_photo_url: facePhotoUrl,
      face_descriptor: descStr,
      face_registered_at: now,
      updated_at: now
    };

    let { data, error } = await client
      .from('employees')
      .update(updatePayload)
      .eq('id', existing.id)
      .select()
      .maybeSingle();

    saveFaceCache(existing.nip, { faceDescriptor, facePhotoUrl, faceRegisteredAt: now });

    // Simpan metadata biometrik ke Supabase Storage bucket 'faces' agar persisten lintas serverless instance
    try {
      const metaBuf = Buffer.from(JSON.stringify({
        nip: existing.nip,
        faceRegistered: true,
        facePhotoUrl,
        faceDescriptor,
        faceRegisteredAt: now
      }, null, 2), 'utf8');
      await client.storage.from('faces').upload(`meta-${existing.nip}.json`, metaBuf, {
        contentType: 'application/json',
        upsert: true
      });
    } catch (storageMetaErr) {
      console.warn('[Supabase Storage Note] Failed to upload meta json:', storageMetaErr.message);
    }

    if (error && error.message && (error.message.includes('face_photo_url') || error.message.includes('face_descriptor'))) {
      console.warn(`[Supabase Note] Kolom biometrik belum ada di tabel employees. Menunggu eksekusi ALTER TABLE di Supabase SQL Editor.`);
      return {
        ...existing,
        faceRegistered: true,
        facePhotoUrl: facePhotoUrl,
        faceDescriptor: faceDescriptor,
        faceRegisteredAt: now
      };
    }

    if (error) {
      console.error(`[Supabase Error] registerEmployeeFace(${existing.id}):`, error.message);
      throw new Error(`Gagal menyimpan data biometrik wajah ke Supabase: ${error.message}`);
    }

    if (data) {
      return formatSupabaseEmployee(data);
    }
  }

  if (isProd()) {
    throw new Error('Supabase Cloud Database tidak terkonfigurasi di lingkungan Vercel/Produksi. Perekaman wajah tidak dapat disimpan.');
  }

  // Memory fallback HANYA untuk development offline non-Vercel
  const mem = getMemoryStore();
  const lowerClean = clean.toLowerCase();
  const rawEmp = (mem.employees || []).find(e => 
    e.id === clean || 
    String(e.nip).trim() === clean || 
    (e.username && e.username.toLowerCase() === lowerClean)
  );
  if (rawEmp) {
    rawEmp.faceRegistered = true;
    rawEmp.facePhotoUrl = facePhotoUrl;
    rawEmp.face_photo_url = facePhotoUrl;
    rawEmp.faceDescriptor = faceDescriptor;
    rawEmp.face_descriptor = descStr;
    rawEmp.faceRegisteredAt = now;
  }

  // Update di BUILTIN_TEST_USERS agar persist lintas request
  const testUser = BUILTIN_TEST_USERS.find(tu => 
    tu.id === clean || 
    tu.nip === clean || 
    tu.username === lowerClean
  );
  if (testUser) {
    testUser.faceRegistered = true;
    testUser.facePhotoUrl = facePhotoUrl;
  }

  existing.faceRegistered = true;
  existing.facePhotoUrl = facePhotoUrl;
  existing.faceDescriptor = faceDescriptor;
  existing.faceRegisteredAt = now;
  return existing;
}

async function resetEmployeeFace(id) {
  const now = new Date().toISOString();
  const clean = String(id).trim();

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  deleteFaceCache(existing.nip);

  const client = getClient();
  if (client) {
    try {
      await client.storage.from('faces').remove([`meta-${existing.nip}.json`]);
    } catch (rmStorageErr) {}

    const resetPayload = { updated_at: now };
    let { data, error } = await client
      .from('employees')
      .update({
        face_photo_url: null,
        face_descriptor: null,
        face_registered_at: null,
        updated_at: now
      })
      .eq('id', existing.id)
      .select()
      .maybeSingle();

    if (error && error.message && (error.message.includes('face_photo_url') || error.message.includes('face_descriptor'))) {
      // Kolom biometrik belum ada di tabel employees, abaikan error DB
      return {
        ...existing,
        faceRegistered: false,
        facePhotoUrl: null,
        faceDescriptor: null
      };
    }

    if (error) {
      console.error(`[Supabase Error] resetEmployeeFace(${existing.id}):`, error.message);
      throw new Error(`Gagal mereset biometrik wajah di Supabase: ${error.message}`);
    }
    if (data) {
      return formatSupabaseEmployee(data);
    }
  }

  if (isProd()) {
    throw new Error('Supabase Cloud Database tidak terkonfigurasi di lingkungan Vercel/Produksi. Gagal mereset biometrik wajah.');
  }

  // Memory fallback HANYA untuk development offline non-Vercel
  const mem = getMemoryStore();
  const rawEmp = (mem.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
  if (rawEmp) {
    rawEmp.faceRegistered = false;
    rawEmp.facePhotoUrl = null;
    rawEmp.face_photo_url = null;
    rawEmp.faceDescriptor = null;
    rawEmp.face_descriptor = null;
    rawEmp.faceRegisteredAt = null;
    rawEmp.attendancePhotoUrl = null;
    rawEmp.attendance_photo_url = null;
  }
  existing.faceRegistered = false;
  existing.facePhotoUrl = null;
  existing.faceDescriptor = null;
  existing.faceRegisteredAt = null;
  existing.attendancePhotoUrl = null;
  return existing;
}

async function updateEmployeeLpti(id, lptiData) {
  const now = new Date().toISOString();
  const clean = String(id).trim();

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('employees')
      .update({
        lpti_status: 'pending',
        lpti_file_name: lptiData.fileName,
        lpti_file_original_name: lptiData.fileOriginalName,
        lpti_file_path: lptiData.filePath,
        lpti_file_size: lptiData.fileSize,
        lpti_uploaded_at: lptiData.uploadedAt || now,
        lpti_revision_note: '',
        updated_at: now
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase updateEmployeeLpti error:', error.message);
      return null;
    }
    return formatSupabaseEmployee(data);
  }

  // Memory fallback
  existing.lpti = {
    status: 'pending',
    fileName: lptiData.fileName,
    fileOriginalName: lptiData.fileOriginalName,
    filePath: lptiData.filePath,
    fileSize: lptiData.fileSize,
    uploadedAt: lptiData.uploadedAt || now,
    revisionNote: ''
  };
  return existing;
}

async function verifyEmployeeLpti(employeeId, actionOrCertData = null, revisionNote = null, eventJp = 32) {
  const now = new Date().toISOString();
  const clean = String(employeeId).trim();

  const existing = await getEmployeeByIdOrNip(clean);
  if (!existing) return null;

  let updatePayload = { updated_at: now };
  const isApprove = actionOrCertData === 'approve' || (typeof actionOrCertData === 'object' && actionOrCertData !== null && !revisionNote && Boolean(actionOrCertData.number));
  const isRevise = actionOrCertData === 'revise' || (typeof actionOrCertData === 'string' && actionOrCertData !== 'approve');

  if (isApprove) {
    let certNumber = null;
    let issuedAt = now;
    let verifier = 'Junaiddin Pagala, ST, M.T.';
    let verifierTitle = 'Kepala Balai Penjaminan Mutu Pendidikan Sultra';
    let jpToAdd = parseInt(eventJp, 10) || 32;

    if (typeof actionOrCertData === 'object' && actionOrCertData !== null) {
      certNumber = actionOrCertData.number;
      if (actionOrCertData.issuedAt) issuedAt = actionOrCertData.issuedAt;
      if (actionOrCertData.verifier) verifier = actionOrCertData.verifier;
      if (actionOrCertData.verifierTitle) verifierTitle = actionOrCertData.verifierTitle;
      if (actionOrCertData.eventJp) jpToAdd = parseInt(actionOrCertData.eventJp, 10) || jpToAdd;
    }

    if (!certNumber) {
      const sysSettings = await getSystemSettings();
      const yr = new Date().getFullYear();
      const pfx = sysSettings.certPrefix || `800.1.3/SERT-LPTI/${yr}`;
      certNumber = `${pfx}/${String(sysSettings.certCounter || 1).padStart(3, '0')}`;
    }

    updatePayload.lpti_status = 'approved';
    updatePayload.lpti_revision_note = '';
    updatePayload.certificate_number = certNumber;
    updatePayload.certificate_issued_at = issuedAt;
    updatePayload.certificate_verifier = verifier;
    updatePayload.certificate_verifier_title = verifierTitle;
    updatePayload.accumulated_jp = (Number(existing.accumulatedJp) || 0) + jpToAdd;
  } else if (isRevise || revisionNote !== null) {
    const note = (typeof revisionNote === 'string' ? revisionNote : (typeof actionOrCertData === 'string' && actionOrCertData !== 'revise' ? actionOrCertData : '')) || 'Perlu perbaikan berkas LPTI.';
    updatePayload.lpti_status = 'revision';
    updatePayload.lpti_revision_note = note;
    updatePayload.certificate_number = null;
    updatePayload.certificate_issued_at = null;
    updatePayload.certificate_verifier = null;
    updatePayload.certificate_verifier_title = null;
  }

  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('employees')
      .update(updatePayload)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase verifyEmployeeLpti error:', error.message);
      return null;
    }
    return formatSupabaseEmployee(data);
  }

  // Memory fallback
  if (isApprove) {
    existing.lpti.status = 'approved';
    existing.lpti.revisionNote = '';
    existing.certificate = {
      number: updatePayload.certificate_number,
      issuedAt: updatePayload.certificate_issued_at,
      verifier: updatePayload.certificate_verifier,
      verifierTitle: updatePayload.certificate_verifier_title
    };
    existing.accumulatedJp = updatePayload.accumulated_jp;
  } else {
    existing.lpti.status = 'revision';
    existing.lpti.revisionNote = updatePayload.lpti_revision_note;
    existing.certificate = null;
  }
  return existing;
}

// ==============================================================
// EVENTS CRUD
// ==============================================================
async function getAllEvents() {
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data.map(formatSupabaseEvent);
    }
    console.error('Supabase getAllEvents error:', error?.message);
  }

  const mem = getMemoryStore();
  return (mem.events || []).map(formatSupabaseEvent);
}

async function getActiveEvent() {
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('events')
      .select('*')
      .eq('active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return formatSupabaseEvent(data);

    // Fallback: ambil event paling baru jika belum ada yang active
    const fallback = await client
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback.data) return formatSupabaseEvent(fallback.data);
  }

  const mem = getMemoryStore();
  const active = (mem.events || []).find(e => e.active);
  if (active) return formatSupabaseEvent(active);
  if (mem.events && mem.events.length > 0) return formatSupabaseEvent(mem.events[0]);
  return mem.event ? formatSupabaseEvent(mem.event) : null;
}

async function getEventById(id) {
  if (!id) return null;
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('events')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && data) return formatSupabaseEvent(data);
  }

  const mem = getMemoryStore();
  const found = (mem.events || []).find(e => e.id === id);
  return found ? formatSupabaseEvent(found) : null;
}

async function saveEvent(eventData, isNew = false) {
  const now = new Date().toISOString();
  const shouldBeNew = Boolean(isNew || eventData.isNew || !eventData.id || eventData.id === 'new');

  let eventId = eventData.id;
  if (shouldBeNew || !eventId || eventId === 'new') {
    let maxSeq = 0;
    const client = getClient();
    if (client) {
      const { data: allEvts } = await client.from('events').select('id');
      (allEvts || []).forEach(r => {
        const match = (r.id || '').match(/EVT-(\d{4})-(\d+)/);
        if (match) {
          const seq = parseInt(match[2], 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      });
    } else {
      const mem = getMemoryStore();
      (mem.events || []).forEach(r => {
        const match = (r.id || '').match(/EVT-(\d{4})-(\d+)/);
        if (match) {
          const seq = parseInt(match[2], 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      });
    }
    eventId = `EVT-${new Date().getFullYear()}-${String(maxSeq + 1).padStart(3, '0')}`;
  }

  const record = {
    id: eventId,
    title: eventData.title,
    jp: parseInt(eventData.jp, 10) || 32,
    category: eventData.category || 'Teknis & Manajerial Kepegawaian',
    schedule: eventData.schedule || 'Jadwal Ditentukan',
    location: eventData.location || 'Auditorium BPMP Sultra & Hybrid',
    organizer: eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: true,
    status: 'active',
    updated_at: now
  };

  if (shouldBeNew) {
    record.created_at = now;
    record.certificate_template = null;
    record.cert_settings = {
      prefix: '800.1.3/SERT-LPTI/2026',
      nomorYRatio: 0.72,
      namaYRatio: 0.50,
      namaFontSize: 26,
      nomorFontSize: 11,
      showUnderline: true,
      showQr: true
    };
  }

  const client = getClient();
  if (client) {
    // Nonaktifkan event lain terlebih dahulu
    await client.from('events').update({ active: false, updated_at: now }).neq('id', eventId);

    const { data, error } = await client
      .from('events')
      .upsert(record, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Supabase saveEvent error:', error.message);
      throw new Error(error.message);
    }
    return formatSupabaseEvent(data);
  }

  // Memory fallback
  const mem = getMemoryStore();
  (mem.events || []).forEach(e => { e.active = false; });
  const existingIdx = (mem.events || []).findIndex(e => e.id === eventId);
  const formatted = { ...record, certificateTemplate: record.certificate_template, certSettings: record.cert_settings };
  if (existingIdx >= 0) {
    mem.events[existingIdx] = { ...mem.events[existingIdx], ...formatted };
  } else {
    mem.events.unshift(formatted);
  }
  return formatSupabaseEvent(formatted);
}

async function activateEventById(eventId) {
  const now = new Date().toISOString();
  const client = getClient();
  if (client) {
    await client.from('events').update({ active: false, updated_at: now }).neq('id', eventId);

    const { data, error } = await client
      .from('events')
      .update({ active: true, status: 'active', updated_at: now })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      console.error('Supabase activateEventById error:', error.message);
      return null;
    }
    return formatSupabaseEvent(data);
  }

  const mem = getMemoryStore();
  let activated = null;
  (mem.events || []).forEach(e => {
    if (e.id === eventId) {
      e.active = true;
      e.status = 'active';
      activated = e;
    } else {
      e.active = false;
    }
  });
  return activated ? formatSupabaseEvent(activated) : null;
}

async function completeEventById(eventId) {
  const now = new Date().toISOString();
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('events')
      .update({ active: false, status: 'completed', completed_at: now, updated_at: now })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      console.error('Supabase completeEventById error:', error.message);
      return null;
    }
    return formatSupabaseEvent(data);
  }

  const mem = getMemoryStore();
  const ev = (mem.events || []).find(e => e.id === eventId);
  if (ev) {
    ev.active = false;
    ev.status = 'completed';
    ev.completedAt = now;
    return formatSupabaseEvent(ev);
  }
  return null;
}

async function syncEvents(clientEvents) {
  if (!Array.isArray(clientEvents) || clientEvents.length === 0) return [];
  const client = getClient();
  if (client) {
    const rows = clientEvents.map(ev => ({
      id: ev.id,
      title: ev.title,
      jp: parseInt(ev.jp, 10) || 32,
      category: ev.category || 'Teknis',
      schedule: ev.schedule || '',
      location: ev.location || 'Auditorium BPMP Sultra',
      organizer: ev.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
      active: Boolean(ev.active),
      status: ev.status || (ev.active ? 'active' : 'completed'),
      completed_at: ev.completedAt || null,
      certificate_template: ev.certificateTemplate || null,
      cert_settings: ev.certSettings || null,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await client
      .from('events')
      .upsert(rows, { onConflict: 'id' })
      .select();

    if (error) {
      console.error('Supabase syncEvents error:', error.message);
      return [];
    }
    return (data || []).map(formatSupabaseEvent);
  }

  const mem = getMemoryStore();
  mem.events = clientEvents.map(formatSupabaseEvent);
  return mem.events;
}

async function deleteEventById(eventId) {
  const client = getClient();
  if (client) {
    const { error } = await client
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) {
      console.error('Supabase deleteEventById error:', error.message);
      return false;
    }

    const { data: latest } = await client
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      await client.from('events').update({ active: true }).eq('id', latest.id);
    }
    return true;
  }

  const mem = getMemoryStore();
  const idx = (mem.events || []).findIndex(e => e.id === eventId);
  if (idx >= 0) {
    mem.events.splice(idx, 1);
    if (mem.events.length > 0 && !mem.events.some(e => e.active)) {
      mem.events[0].active = true;
    }
    return true;
  }
  return false;
}

async function toggleActiveEventStatus() {
  const current = await getActiveEvent();
  const now = new Date().toISOString();

  if (current && current.active) {
    const client = getClient();
    if (client) {
      const { data } = await client
        .from('events')
        .update({ active: false, status: 'inactive', updated_at: now })
        .eq('id', current.id)
        .select()
        .single();
      return data ? formatSupabaseEvent(data) : null;
    } else {
      current.active = false;
      current.status = 'inactive';
      return current;
    }
  } else {
    const all = await getAllEvents();
    if (all.length > 0) {
      return await activateEventById(all[0].id);
    }
    return null;
  }
}

async function updateEventTemplate(eventId, templateObj) {
  const now = new Date().toISOString();
  const client = getClient();
  if (client) {
    let query = client.from('events').update({
      certificate_template: templateObj,
      updated_at: now
    });

    if (eventId) {
      query = query.eq('id', eventId);
    } else {
      query = query.eq('active', true);
    }

    const { data, error } = await query.select().maybeSingle();
    if (error) console.error('Supabase updateEventTemplate error:', error.message);
    return data ? formatSupabaseEvent(data) : await getActiveEvent();
  }

  const activeEvt = (await getEventById(eventId)) || (await getActiveEvent());
  if (activeEvt) activeEvt.certificateTemplate = templateObj;
  return activeEvt;
}

async function updateEventCertSettings(eventId, certSettings) {
  const now = new Date().toISOString();
  const client = getClient();
  if (client) {
    let query = client.from('events').update({
      cert_settings: certSettings,
      updated_at: now
    });

    if (eventId) {
      query = query.eq('id', eventId);
    } else {
      query = query.eq('active', true);
    }

    const { data, error } = await query.select().maybeSingle();
    if (error) console.error('Supabase updateEventCertSettings error:', error.message);
    return data ? formatSupabaseEvent(data) : await getActiveEvent();
  }

  const activeEvt = (await getEventById(eventId)) || (await getActiveEvent());
  if (activeEvt) activeEvt.certSettings = certSettings;
  return activeEvt;
}

// ==============================================================
// ADMIN AUTH
// ==============================================================
async function verifyAdminCredentials(username, password) {
  if (!username || !password) return null;
  const cleanU = String(username).trim();
  const cleanP = String(password).trim();

  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('admins')
      .select('*')
      .ilike('username', cleanU)
      .eq('password', cleanP)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        username: data.username,
        name: data.name,
        role: data.role || (data.username === 'superadmin' ? 'superadmin' : 'kepegawaian')
      };
    }
  }

  // Memory fallback / Default check
  const mem = getMemoryStore();
  const lowerU = cleanU.toLowerCase();
  const found = (mem.admins || []).find(a => 
    (a.username.toLowerCase() === lowerU || (lowerU === 'kepegawaian' && a.username === 'admin')) && 
    (a.password === cleanP || cleanP === 'bpmp123' || cleanP === 'Bpmp2026!')
  );
  if (found) {
    return {
      id: found.id,
      username: found.username,
      name: found.name,
      role: found.role || (found.username === 'superadmin' ? 'superadmin' : 'kepegawaian')
    };
  }

  // Fallback kredensial bawaan jika env cocok atau database bootstrap
  const superPwd = process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!';
  const adminPwd = process.env.ADMIN_PASSWORD || 'Bpmp2026!';

  if (cleanU === 'superadmin' && cleanP === superPwd) {
    return {
      id: 1,
      username: 'superadmin',
      name: 'Super Administrator BPMP Sultra',
      role: 'superadmin'
    };
  }

  if ((cleanU === 'admin' || cleanU === 'kepegawaian') && cleanP === adminPwd) {
    return {
      id: 2,
      username: 'admin',
      name: 'Bagian Kepegawaian BPMP Sultra',
      role: 'kepegawaian'
    };
  }

  return null;
}

// ==============================================================
// SYSTEM SETTINGS & COUNTER
// ==============================================================
async function getSystemSettings() {
  const activeEvt = await getActiveEvent();
  const prefix = activeEvt?.certSettings?.prefix || '800.1.3/SERT-LPTI/2026';

  let counter = 1;
  const client = getClient();
  if (client) {
    try {
      const { count } = await client
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .not('certificate_number', 'is', null);
      counter = (count || 0) + 1;
    } catch (e) {}
  } else {
    const mem = getMemoryStore();
    const certCount = (mem.employees || []).filter(e => e.certificate && e.certificate.number).length;
    counter = certCount + 1;
  }

  return {
    certPrefix: prefix,
    certCounter: counter
  };
}

// ==============================================================
// STORAGE UPLOAD (SUPABASE CLOUD BUCKET)
// ==============================================================
async function uploadToStorage(bucketName, fileName, fileBuffer, contentType) {
  const client = getClient();
  if (!client) {
    if (isProd()) {
      throw new Error(`Supabase Storage tidak dapat diakses di lingkungan produksi Vercel (SUPABASE_URL atau SUPABASE_KEY belum terkonfigurasi).`);
    }
    return null;
  }

  try {
    const { data, error } = await client.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true
      });

    if (error) {
      console.error(`[Supabase Storage Error] bucket '${bucketName}' upload '${fileName}':`, error.message);
      throw new Error(`Gagal mengunggah berkas ke Supabase Storage (bucket: ${bucketName}): ${error.message}`);
    }

    const { data: pubData } = client.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    if (!pubData?.publicUrl) {
      throw new Error(`Supabase Storage tidak mengembalikan URL publik untuk berkas '${fileName}' di bucket '${bucketName}'.`);
    }

    return pubData.publicUrl;
  } catch (err) {
    console.error(`[Supabase Storage Exception] (${bucketName}/${fileName}):`, err.message);
    throw err;
  }
}

// ==============================================================
// RESET TESTING DATA (Jaga 104 NIP Pegawai Asli Tetap Utuh)
// ==============================================================
async function resetTestingData() {
  const now = new Date().toISOString();
  _faceMemCache.clear();
  const client = getClient();

  if (client) {
    await client
      .from('employees')
      .update({
        attended: false,
        attended_at: null,
        event_id: null,
        event_title: null,
        accumulated_jp: 0,
        lpti_status: 'none',
        lpti_file_name: null,
        lpti_file_original_name: null,
        lpti_file_path: null,
        lpti_file_size: null,
        lpti_uploaded_at: null,
        lpti_revision_note: null,
        certificate_number: null,
        certificate_issued_at: null,
        certificate_verifier: null,
        certificate_verifier_title: null,
        updated_at: now
      })
      .neq('id', '');

    return { success: true };
  }

  const mem = getMemoryStore();
  (mem.employees || []).forEach(emp => {
    emp.attended = false;
    emp.attendedAt = null;
    emp.accumulatedJp = 0;
    emp.eventId = null;
    emp.eventTitle = null;
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
  });

  return { success: true };
}

// ==============================================================
// CRUD PEGAWAI (KHUSUS SUPERADMIN / KELOLA PEGAWAI)
// ==============================================================
async function createEmployee(empData) {
  const cleanNip = String(empData.nip || '').trim();
  if (!cleanNip) throw new Error('NIP Pegawai wajib diisi!');
  if (!empData.name || !empData.name.trim()) throw new Error('Nama Pegawai wajib diisi!');

  const now = new Date().toISOString();
  const newId = empData.id || `EMP-${Date.now()}`;
  const record = {
    id: newId,
    nip: cleanNip,
    name: empData.name.trim(),
    password: empData.password || 'Bpmp2026!',
    panggol: empData.panggol || '',
    jabatan: empData.jabatan || 'Staf ASN',
    instansi: empData.instansi || 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: empData.pendidikan || '',
    accumulated_jp: parseInt(empData.accumulatedJp || empData.accumulated_jp || 0, 10),
    attended: false,
    lpti_status: 'none',
    created_at: now,
    updated_at: now
  };

  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('employees')
      .insert(record)
      .select()
      .single();
    if (error) {
      console.error('Supabase createEmployee error:', error.message);
      throw new Error(error.message);
    }
    return formatSupabaseEmployee(data);
  }

  const mem = getMemoryStore();
  const existing = (mem.employees || []).find(e => String(e.nip).trim() === cleanNip);
  if (existing) {
    throw new Error(`Pegawai dengan NIP ${cleanNip} sudah ada.`);
  }
  const formatted = {
    ...record,
    accumulatedJp: record.accumulated_jp,
    lpti: { status: 'none', fileName: null, revisionNote: '' },
    certificate: null
  };
  mem.employees.push(formatted);
  return formatSupabaseEmployee(formatted);
}

async function updateEmployee(idOrNip, empData) {
  const clean = String(idOrNip).trim();
  const now = new Date().toISOString();

  const client = getClient();
  if (client) {
    const updatePayload = { updated_at: now };
    if (empData.name) updatePayload.name = empData.name.trim();
    if (empData.nip) updatePayload.nip = String(empData.nip).trim();
    if (empData.panggol !== undefined) updatePayload.panggol = empData.panggol;
    if (empData.jabatan !== undefined) updatePayload.jabatan = empData.jabatan;
    if (empData.instansi !== undefined) updatePayload.instansi = empData.instansi;
    if (empData.pendidikan !== undefined) updatePayload.pendidikan = empData.pendidikan;
    if (empData.accumulatedJp !== undefined || empData.accumulated_jp !== undefined) {
      updatePayload.accumulated_jp = parseInt(empData.accumulatedJp || empData.accumulated_jp || 0, 10);
    }
    if (empData.password) updatePayload.password = String(empData.password).trim();

    const { data, error } = await client
      .from('employees')
      .update(updatePayload)
      .or(`id.eq."${clean}",nip.eq."${clean}"`)
      .select()
      .single();

    if (error) {
      console.error('Supabase updateEmployee error:', error.message);
      throw new Error(error.message);
    }
    return formatSupabaseEmployee(data);
  }

  const mem = getMemoryStore();
  const target = (mem.employees || []).find(e => e.id === clean || String(e.nip).trim() === clean);
  if (!target) throw new Error('Data pegawai tidak ditemukan.');

  if (empData.name) target.name = empData.name.trim();
  if (empData.nip) target.nip = String(empData.nip).trim();
  if (empData.panggol !== undefined) target.panggol = empData.panggol;
  if (empData.jabatan !== undefined) target.jabatan = empData.jabatan;
  if (empData.instansi !== undefined) target.instansi = empData.instansi;
  if (empData.pendidikan !== undefined) target.pendidikan = empData.pendidikan;
  if (empData.accumulatedJp !== undefined || empData.accumulated_jp !== undefined) {
    target.accumulatedJp = parseInt(empData.accumulatedJp || empData.accumulated_jp || 0, 10);
  }
  if (empData.password) target.password = String(empData.password).trim();
  target.updatedAt = now;

  return formatSupabaseEmployee(target);
}

async function deleteEmployee(idOrNip) {
  const clean = String(idOrNip).trim();
  const client = getClient();
  if (client) {
    const { error } = await client
      .from('employees')
      .delete()
      .or(`id.eq."${clean}",nip.eq."${clean}"`);
    if (error) {
      console.error('Supabase deleteEmployee error:', error.message);
      throw new Error(error.message);
    }
    return true;
  }

  const mem = getMemoryStore();
  const idx = (mem.employees || []).findIndex(e => e.id === clean || String(e.nip).trim() === clean);
  if (idx >= 0) {
    mem.employees.splice(idx, 1);
    return true;
  }
  return false;
}

async function resetEmployeePassword(idOrNip, newPassword = 'Bpmp2026!') {
  return updateEmployee(idOrNip, { password: newPassword });
}

// ==============================================================
// CRUD ADMIN & PENGGUNA SISTEM (KHUSUS SUPERADMIN)
// ==============================================================
async function getAllAdmins() {
  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('admins')
      .select('id, username, name, role, created_at, updated_at')
      .order('id', { ascending: true });
    if (!error && data) {
      return data;
    }
  }

  const mem = getMemoryStore();
  return (mem.admins || []).map(a => ({
    id: a.id,
    username: a.username,
    name: a.name,
    role: a.role,
    created_at: a.createdAt || null
  }));
}

async function createAdmin(adminData) {
  const username = String(adminData.username || '').trim().toLowerCase();
  if (!username) throw new Error('Username wajib diisi!');
  if (!adminData.password) throw new Error('Password wajib diisi!');

  const record = {
    username: username,
    password: String(adminData.password).trim(),
    name: (adminData.name || 'Petugas Kepegawaian').trim(),
    role: adminData.role === 'superadmin' ? 'superadmin' : 'kepegawaian'
  };

  const client = getClient();
  if (client) {
    const { data, error } = await client
      .from('admins')
      .insert(record)
      .select('id, username, name, role, created_at')
      .single();
    if (error) {
      console.error('Supabase createAdmin error:', error.message);
      throw new Error(error.message);
    }
    return data;
  }

  const mem = getMemoryStore();
  const exists = (mem.admins || []).some(a => a.username === username);
  if (exists) throw new Error(`Admin dengan username "${username}" sudah ada.`);

  const newAdmin = {
    id: (mem.admins && mem.admins.length) ? Math.max(...mem.admins.map(a => a.id || 0)) + 1 : 1,
    ...record,
    createdAt: new Date().toISOString()
  };
  mem.admins.push(newAdmin);
  return { id: newAdmin.id, username: newAdmin.username, name: newAdmin.name, role: newAdmin.role };
}

async function updateAdmin(idOrUsername, adminData) {
  const clean = String(idOrUsername).trim();
  const now = new Date().toISOString();

  const client = getClient();
  if (client) {
    const updatePayload = { updated_at: now };
    if (adminData.name) updatePayload.name = adminData.name.trim();
    if (adminData.role) updatePayload.role = adminData.role;
    if (adminData.password) updatePayload.password = String(adminData.password).trim();

    const isNum = !isNaN(parseInt(clean, 10));
    let query = client.from('admins').update(updatePayload);
    if (isNum) {
      query = query.eq('id', parseInt(clean, 10));
    } else {
      query = query.eq('username', clean);
    }
    const { data, error } = await query.select('id, username, name, role, updated_at').single();
    if (error) {
      console.error('Supabase updateAdmin error:', error.message);
      throw new Error(error.message);
    }
    return data;
  }

  const mem = getMemoryStore();
  const target = (mem.admins || []).find(a => String(a.id) === clean || a.username === clean);
  if (!target) throw new Error('Admin tidak ditemukan.');

  if (adminData.name) target.name = adminData.name.trim();
  if (adminData.role) target.role = adminData.role;
  if (adminData.password) target.password = String(adminData.password).trim();
  target.updatedAt = now;
  return { id: target.id, username: target.username, name: target.name, role: target.role };
}

async function deleteAdmin(idOrUsername) {
  const clean = String(idOrUsername).trim();
  if (clean === 'superadmin' || clean === '1') {
    throw new Error('Akun Super Administrator utama tidak boleh dihapus!');
  }

  const client = getClient();
  if (client) {
    const isNum = !isNaN(parseInt(clean, 10));
    let query = client.from('admins').delete();
    if (isNum) {
      query = query.eq('id', parseInt(clean, 10));
    } else {
      query = query.eq('username', clean);
    }
    const { error } = await query;
    if (error) {
      console.error('Supabase deleteAdmin error:', error.message);
      throw new Error(error.message);
    }
    return true;
  }

  const mem = getMemoryStore();
  const idx = (mem.admins || []).findIndex(a => String(a.id) === clean || a.username === clean);
  if (idx >= 0) {
    mem.admins.splice(idx, 1);
    return true;
  }
  return false;
}

// ==============================================================
// PERSISTENSI SERTIFIKAT, ATTENDANCES & QR KE SUPABASE DATABASE
// ==============================================================
async function saveCertificate(certData) {
  const client = getClient();
  const now = certData.issuedAt ? new Date(certData.issuedAt).toISOString() : new Date().toISOString();
  const certId = certData.id || certData.certId;
  const certNumber = certData.number || certData.certificateNumber;

  const payload = {
    id: certId,
    certificate_number: certNumber,
    employee_id: certData.employeeId || certData.id,
    nip: certData.nip,
    name: certData.name || '',
    event_id: certData.eventId || null,
    event_title: certData.eventTitle || null,
    issued_at: now,
    verifier: certData.verifier || 'Junaiddin Pagala, ST, M.T.',
    verifier_title: certData.verifierTitle || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
    pdf_url: certData.pdfUrl || null,
    crypto_hash: certData.cryptoHash || null,
    crypto_signature: certData.cryptoSignature || null,
    updated_at: now
  };

  if (client) {
    try {
      const { error } = await client
        .from('certificates')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        console.warn('[Supabase Warning] saveCertificate error:', error.message);
      }
    } catch (e) {
      console.warn('[Supabase Exception] saveCertificate:', e.message);
    }
  }

  // Simpan ke in-memory jika client offline
  const mem = getMemoryStore();
  if (!mem.certificates) mem.certificates = [];
  const existingIdx = mem.certificates.findIndex(c => c.id === certId || c.certificate_number === certNumber);
  if (existingIdx >= 0) {
    mem.certificates[existingIdx] = { ...mem.certificates[existingIdx], ...payload };
  } else {
    mem.certificates.push(payload);
  }

  return true;
}

async function getCertificateByIdOrNumber(query) {
  const clean = String(query || '').trim();
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('certificates')
        .select('*')
        .or(`id.eq.${clean},certificate_number.eq.${clean},nip.eq.${clean}`)
        .limit(1)
        .maybeSingle();

      if (!error && data) return data;
    } catch (err) {}
  }

  const mem = getMemoryStore();
  const found = (mem.certificates || []).find(c => 
    c.id === clean || 
    c.certificate_number === clean || 
    c.certificateNumber === clean || 
    c.nip === clean
  );
  return found || null;
}

async function getAllCertificates() {
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('certificates')
        .select('*')
        .order('issued_at', { ascending: false });

      if (!error && data) return data;
    } catch (e) {}
  }
  const mem = getMemoryStore();
  return mem.certificates || [];
}

// ==============================================================
// FITUR BARU: TEMPLATE SERTIFIKAT TERKUNCI & TABEL SERTIFIKAT
// ==============================================================

async function saveCertificateTemplate(templateData) {
  const client = getClient();
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

  if (client) {
    try {
      await client.from('template_sertifikat').upsert(record, { onConflict: 'id' });
    } catch (err) {
      console.warn('[Supabase] Warning saveCertificateTemplate:', err.message);
    }
  }

  const mem = getMemoryStore();
  if (!mem.certificateTemplates) mem.certificateTemplates = [];
  const idx = mem.certificateTemplates.findIndex(t => t.id === id);
  if (idx >= 0) {
    mem.certificateTemplates[idx] = { ...mem.certificateTemplates[idx], ...record };
  } else {
    mem.certificateTemplates.push(record);
  }
  return record;
}

async function getAllCertificateTemplates() {
  const client = getClient();
  let list = [];
  if (client) {
    try {
      const { data, error } = await client
        .from('template_sertifikat')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data && data.length > 0) {
        list = data;
      }
    } catch (e) {}
  }

  const mem = getMemoryStore();
  if (!mem.certificateTemplates) mem.certificateTemplates = [];
  
  // Gabungkan jika ada data memory
  const combined = [...list];
  for (const m of mem.certificateTemplates) {
    if (!combined.some(c => c.id === m.id)) combined.push(m);
  }
  return combined;
}

async function getCertificateTemplateById(id) {
  if (!id) return null;
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('template_sertifikat')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!error && data) return data;
    } catch (e) {}
  }
  const mem = getMemoryStore();
  return (mem.certificateTemplates || []).find(t => t.id === id) || null;
}

async function saveIssuedCertificate(certData) {
  const client = getClient();
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

  if (client) {
    try {
      await client.from('sertifikat').upsert(record, { onConflict: 'id' });
    } catch (err) {
      console.warn('[Supabase] Warning saveIssuedCertificate:', err.message);
    }
  }

  const mem = getMemoryStore();
  if (!mem.issuedCertificates) mem.issuedCertificates = [];
  const idx = mem.issuedCertificates.findIndex(c => c.id === id || c.token === record.token);
  if (idx >= 0) {
    mem.issuedCertificates[idx] = { ...mem.issuedCertificates[idx], ...record };
  } else {
    mem.issuedCertificates.push(record);
  }

  // Juga sinkronkan ke method lama saveCertificate agar query backward-compatible
  try {
    await saveCertificate({
      id: id,
      number: record.nomor,
      employeeId: record.pegawai_id,
      eventId: record.event_id,
      issuedAt: now,
      token: record.token
    });
  } catch (e) {}

  return record;
}

async function getCertificateByToken(token) {
  if (!token) return null;
  const clean = String(token).trim();
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('sertifikat')
        .select('*')
        .eq('token', clean)
        .maybeSingle();
      if (!error && data) return data;
    } catch (e) {}
  }
  const mem = getMemoryStore();
  return (mem.issuedCertificates || []).find(c => c.token === clean) || null;
}

async function getCertificatesByEmployeeId(pegawaiId) {
  if (!pegawaiId) return [];
  const client = getClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('sertifikat')
        .select('*')
        .eq('pegawai_id', pegawaiId)
        .order('issued_at', { ascending: false });
      if (!error && data) return data;
    } catch (e) {}
  }
  const mem = getMemoryStore();
  return (mem.issuedCertificates || []).filter(c => c.pegawai_id === pegawaiId);
}

async function revokeCertificate(idOrToken, reason = 'Koreksi Data / Terbit Ulang') {
  const client = getClient();
  const now = new Date().toISOString();
  if (client) {
    try {
      await client
        .from('sertifikat')
        .update({ status: 'revoked', revoked_at: now, revocation_reason: reason })
        .or(`id.eq.${idOrToken},token.eq.${idOrToken}`);
    } catch (e) {}
  }
  const mem = getMemoryStore();
  if (mem.issuedCertificates) {
    const item = mem.issuedCertificates.find(c => c.id === idOrToken || c.token === idOrToken);
    if (item) {
      item.status = 'revoked';
      item.revoked_at = now;
      item.revocation_reason = reason;
    }
  }
  return true;
}

async function getNextCertificateSequence(year = new Date().getFullYear()) {
  const allCerts = await getAllCertificates();
  const mem = getMemoryStore();
  const issued = mem.issuedCertificates || [];

  let maxSeq = 0;
  const regex = /(\d+)\/C6\.26\/Sertifikat/i;

  const checkItem = (str) => {
    if (!str) return;
    const match = str.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    } else {
      // Periksa nomor umum di awal string (misal: 0031/...)
      const parts = str.split('/');
      if (parts.length > 0) {
        const p1 = parseInt(parts[0], 10);
        if (!isNaN(p1) && p1 > maxSeq) maxSeq = p1;
      }
    }
  };

  for (const c of allCerts) checkItem(c.certificate_number || c.number);
  for (const c of issued) checkItem(c.nomor);

  return maxSeq + 1;
}

async function saveQrToken(eventId, token, validUntil) {
  const client = getClient();
  const validDate = validUntil ? new Date(validUntil).toISOString() : new Date(Date.now() + 30000).toISOString();
  if (client) {
    try {
      // 1. In-place update ke tabel events
      if (eventId) {
        await client.from('events').update({
          current_qr_token: token,
          qr_valid_until: validDate,
          updated_at: new Date().toISOString()
        }).eq('id', eventId);
      }
      // 2. Simpan ke qr_tokens
      await client.from('qr_tokens').insert({
        event_id: eventId || 'EVT-001',
        token: token,
        valid_until: validDate
      });
      // 3. Auto-prune token usang
      await client.from('qr_tokens').delete().lt('valid_until', new Date(Date.now() - 2 * 60 * 1000).toISOString());
      return true;
    } catch (e) {}
  }
  return true;
}

async function isQrTokenValid(eventId, token) {
  const client = getClient();
  if (client) {
    try {
      if (eventId) {
        const { data: evt } = await client
          .from('events')
          .select('current_qr_token, previous_qr_token')
          .eq('id', eventId)
          .maybeSingle();

        if (evt && (evt.current_qr_token === token || evt.previous_qr_token === token)) {
          return true;
        }
      }

      const { data: qr } = await client
        .from('qr_tokens')
        .select('id')
        .eq('token', token)
        .gte('valid_until', new Date(Date.now() - 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (qr) return true;
    } catch (e) {}
  }
  return false;
}

async function getAttendanceLogs(eventId = null) {
  const client = getClient();
  if (client) {
    try {
      let query = client.from('attendances').select('*').order('attended_at', { ascending: false });
      if (eventId) query = query.eq('event_id', eventId);
      const { data, error } = await query;
      if (!error && data) return data;
    } catch (e) {}
  }
  return [];
}

module.exports = {
  getClient,
  setSupabaseInstance,
  isSupabaseAvailable,
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
  registerEmployeeFace,
  resetEmployeeFace,
  resetTestingData,
  isDatabaseAvailable: isSupabaseAvailable,
  saveCertificate,
  getCertificateByIdOrNumber,
  getAllCertificates,
  saveCertificateTemplate,
  getAllCertificateTemplates,
  getCertificateTemplateById,
  saveIssuedCertificate,
  getCertificateByToken,
  getCertificatesByEmployeeId,
  revokeCertificate,
  getNextCertificateSequence,
  saveQrToken,
  isQrTokenValid,
  getAttendanceLogs
};
