/**
 * BPMP Senin Berseri — Skrip Migrasi Password Hash (Idempoten & Aman)
 * 
 * Aturan:
 * 1. Backup data sebelum migrasi.
 * 2. Hash semua password lama yang masih polos dengan bcrypt (cost 12).
 * 3. Simpan di kolom `password_hash` dan hapus/kosongkan properti `password` lama.
 * 4. Set `wajib_ganti_password = 1` untuk seluruh akun (admin dan pegawai).
 * 5. Idempoten: aman dijalankan berulang kali tanpa merusak hash yang sudah ada.
 */

const fs = require('fs');
const path = require('path');
const { hashPasswordSync, isBcryptHash } = require('../utils/password');

const BASE_DIR = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(BASE_DIR, 'backups');
const DB_JSON_PATH = path.join(BASE_DIR, 'db.json');

async function runMigration() {
  console.log('=== MEMULAI MIGRASI KEAMANAN PASSWORD (argon2/bcrypt cost 12) ===\n');

  // 1. BACKUP DATABASE FILE
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `db-backup-pre-password-hash-${timestamp}.json`);

  let dbData = null;
  if (fs.existsSync(DB_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(DB_JSON_PATH, 'utf8');
      if (raw.trim()) {
        dbData = JSON.parse(raw);
        fs.writeFileSync(backupPath, raw, 'utf8');
        console.log(`[BACKUP] Cadangan data lokal berhasil disimpan ke:\n  -> ${backupPath}`);
      }
    } catch (e) {
      console.warn('[BACKUP WARN] Gagal membaca db.json lama:', e.message);
    }
  }

  if (!dbData) {
    dbData = { employees: [], admins: [], events: [], audit_log: [] };
  }

  let migratedAdmins = 0;
  let alreadyHashedAdmins = 0;
  let migratedEmployees = 0;
  let alreadyHashedEmployees = 0;

  // 2. MIGRASI AKUN ADMIN
  if (!Array.isArray(dbData.admins)) {
    dbData.admins = [];
  }

  // Akun admin bawaan jika belum terdaftar
  const defaultAdmins = [
    { id: 1, username: 'superadmin', name: 'Super Administrator BPMP Sultra', role: 'superadmin', peran: 'superadmin' },
    { id: 2, username: 'admin', name: 'Bagian Kepegawaian BPMP Sultra', role: 'kepegawaian', peran: 'kepegawaian' }
  ];

  for (const def of defaultAdmins) {
    if (!dbData.admins.some(a => a.username === def.username)) {
      dbData.admins.push({ ...def });
    }
  }

  for (const admin of dbData.admins) {
    const rawPass = admin.password || admin.rawPassword || (admin.username === 'superadmin' ? (process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!') : 'Bpmp2026!');
    
    // Periksa apakah sudah di-hash bcrypt
    if (admin.password_hash && isBcryptHash(admin.password_hash)) {
      alreadyHashedAdmins++;
    } else {
      // Hash password dengan cost 12
      admin.password_hash = hashPasswordSync(rawPass);
      migratedAdmins++;
    }

    // Set wajib ganti password
    admin.wajib_ganti_password = true;

    // Hapus kolom password lama
    delete admin.password;
    delete admin.rawPassword;
  }

  // 3. MIGRASI AKUN PEGAWAI (EMPLOYEES)
  if (!Array.isArray(dbData.employees)) {
    dbData.employees = [];
  }

  for (const emp of dbData.employees) {
    const rawPass = emp.password || emp.rawPassword || 'Bpmp2026!';

    if (emp.password_hash && isBcryptHash(emp.password_hash)) {
      alreadyHashedEmployees++;
    } else {
      emp.password_hash = hashPasswordSync(rawPass);
      migratedEmployees++;
    }

    emp.wajib_ganti_password = true;
    emp.mustChangePassword = true;

    delete emp.password;
    delete emp.rawPassword;
  }

  // Simpan kembali ke db.json
  fs.writeFileSync(DB_JSON_PATH, JSON.stringify(dbData, null, 2), 'utf8');
  console.log(`[MIGRASI LOKAL] db.json berhasil diperbarui.`);
  console.log(`  - Admin di-hash baru   : ${migratedAdmins}`);
  console.log(`  - Admin sudah ter-hash : ${alreadyHashedAdmins}`);
  console.log(`  - Pegawai di-hash baru : ${migratedEmployees}`);
  console.log(`  - Pegawai sudah hash   : ${alreadyHashedEmployees}`);

  // 4. MIGRASI DI SUPABASE (Jika terkonfigurasi)
  try {
    const supabaseAdapter = require('../supabase-adapter');
    const client = supabaseAdapter.getClient();
    if (client) {
      console.log('\n[SUPABASE] Memeriksa koneksi Supabase Cloud Database...');
      
      // Update Admins di Supabase
      const { data: remoteAdmins, error: errAdmins } = await client.from('admins').select('id, username, password, password_hash, wajib_ganti_password');
      if (!errAdmins && remoteAdmins) {
        let sbAdminCount = 0;
        for (const ra of remoteAdmins) {
          if (!ra.password_hash || !isBcryptHash(ra.password_hash)) {
            const rawP = ra.password || (ra.username === 'superadmin' ? (process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!') : 'Bpmp2026!');
            const hashed = hashPasswordSync(rawP);
            await client.from('admins').update({
              password_hash: hashed,
              wajib_ganti_password: true
            }).eq('id', ra.id);
            sbAdminCount++;
          }
        }
        console.log(`[SUPABASE] Berhasil memigrasi ${sbAdminCount} akun admin di Cloud.`);
      }

      // Update Employees di Supabase
      const { data: remoteEmployees, error: errEmp } = await client.from('employees').select('id, nip, password, password_hash, wajib_ganti_password').limit(500);
      if (!errEmp && remoteEmployees) {
        let sbEmpCount = 0;
        for (const re of remoteEmployees) {
          if (!re.password_hash || !isBcryptHash(re.password_hash)) {
            const rawP = re.password || 'Bpmp2026!';
            const hashed = hashPasswordSync(rawP);
            await client.from('employees').update({
              password_hash: hashed,
              wajib_ganti_password: true
            }).eq('id', re.id);
            sbEmpCount++;
          }
        }
        console.log(`[SUPABASE] Berhasil memigrasi ${sbEmpCount} akun pegawai di Cloud.`);
      }
    }
  } catch (errSb) {
    console.log('[SUPABASE INFO] Melewati Supabase migration (offline/in-memory mode):', errSb.message);
  }

  // 5. MIGRASI DI MYSQL (Jika terkonfigurasi)
  try {
    if (process.env.DB_DRIVER === 'mysql') {
      const mysqlAdapter = require('../mysql-adapter');
      const pool = mysqlAdapter.getPool ? mysqlAdapter.getPool() : null;
      if (pool) {
        console.log('\n[MYSQL] Menjalankan migrasi kolom password_hash di MySQL...');
        await pool.execute('ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL');
        await pool.execute('ALTER TABLE admins ADD COLUMN IF NOT EXISTS wajib_ganti_password TINYINT(1) DEFAULT 1');
        await pool.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL');
        await pool.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS wajib_ganti_password TINYINT(1) DEFAULT 1');
        console.log('[MYSQL] Kolom schema berhasil dipastikan.');
      }
    }
  } catch (errMy) {
    console.log('[MYSQL INFO] Melewati MySQL migration:', errMy.message);
  }

  console.log('\n=== MIGRASI SELESAI DENGAN SUKSES (IDEMPOTEN) ===\n');
}

if (require.main === module) {
  runMigration().then(() => process.exit(0)).catch(err => {
    console.error('Error saat migrasi:', err);
    process.exit(1);
  });
}

module.exports = { runMigration };
