-- ================================================================
-- MIGRASI FASE 1: SKEMA MULTI-EVENT & MIGRASI DATA RELASIONAL
-- Kompatibel SQLite / PostgreSQL / MySQL (Idempoten & Transaksional)
-- ================================================================

-- 1. TABEL TEMPLATE SERTIFIKAT
CREATE TABLE IF NOT EXISTS template_sertifikat (
  id VARCHAR(64) PRIMARY KEY,
  nama VARCHAR(255) NOT NULL,
  file_layout VARCHAR(255) NOT NULL,
  field_posisi_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABEL KEGIATAN PELATIHAN
CREATE TABLE IF NOT EXISTS kegiatan (
  id VARCHAR(64) PRIMARY KEY,
  nama VARCHAR(255) NOT NULL,
  tgl_mulai VARCHAR(32),
  tgl_selesai VARCHAR(32),
  jp INTEGER NOT NULL DEFAULT 2,
  wajib_lpti INTEGER NOT NULL DEFAULT 1,
  batas_unggah_lpti VARCHAR(64),
  min_sesi_hadir INTEGER NOT NULL DEFAULT 1,
  template_id VARCHAR(64) REFERENCES template_sertifikat(id) ON DELETE SET NULL,
  format_nomor VARCHAR(255) DEFAULT '001{counter}/C6.26/Sertifikat/KP.04.00/{tahun}',
  counter_nomor INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'aktif',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. TABEL SESI KEGIATAN
CREATE TABLE IF NOT EXISTS sesi_kegiatan (
  id VARCHAR(64) PRIMARY KEY,
  kegiatan_id VARCHAR(64) NOT NULL REFERENCES kegiatan(id) ON DELETE CASCADE,
  nama VARCHAR(255) NOT NULL,
  tanggal VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABEL PESERTA KEGIATAN (Multi-Event Pivot Pegawai <-> Kegiatan)
CREATE TABLE IF NOT EXISTS peserta_kegiatan (
  id VARCHAR(64) PRIMARY KEY,
  kegiatan_id VARCHAR(64) NOT NULL REFERENCES kegiatan(id) ON DELETE CASCADE,
  pegawai_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(kegiatan_id, pegawai_id)
);

-- 5. TABEL PRESENSI (Per Peserta per Sesi)
CREATE TABLE IF NOT EXISTS presensi (
  id VARCHAR(64) PRIMARY KEY,
  peserta_kegiatan_id VARCHAR(64) NOT NULL REFERENCES peserta_kegiatan(id) ON DELETE CASCADE,
  sesi_id VARCHAR(64) NOT NULL REFERENCES sesi_kegiatan(id) ON DELETE CASCADE,
  waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metode VARCHAR(32) NOT NULL DEFAULT 'qr',
  UNIQUE(peserta_kegiatan_id, sesi_id)
);

-- 6. TABEL LPTI (1 Peserta per Kegiatan = Max 1 LPTI Aktif)
CREATE TABLE IF NOT EXISTS lpti (
  id VARCHAR(64) PRIMARY KEY,
  peserta_kegiatan_id VARCHAR(64) NOT NULL UNIQUE REFERENCES peserta_kegiatan(id) ON DELETE CASCADE,
  versi INTEGER NOT NULL DEFAULT 1,
  berkas_aktif TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'belum_unggah',
  lock_by VARCHAR(128) DEFAULT NULL,
  lock_until TIMESTAMP DEFAULT NULL,
  diajukan_at TIMESTAMP DEFAULT NULL,
  diputuskan_at TIMESTAMP DEFAULT NULL,
  diputuskan_oleh VARCHAR(128) DEFAULT NULL,
  catatan TEXT DEFAULT NULL
);

-- 7. TABEL LPTI BERKAS (Versi Historis Berkas LPTI)
CREATE TABLE IF NOT EXISTS lpti_berkas (
  id VARCHAR(64) PRIMARY KEY,
  lpti_id VARCHAR(64) NOT NULL REFERENCES lpti(id) ON DELETE CASCADE,
  versi INTEGER NOT NULL DEFAULT 1,
  path TEXT NOT NULL,
  ukuran INTEGER DEFAULT 0,
  nama_asli VARCHAR(255),
  diunggah_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. TABEL LPTI RIWAYAT (Append-Only Audit Linimasa Kurasi)
CREATE TABLE IF NOT EXISTS lpti_riwayat (
  id VARCHAR(64) PRIMARY KEY,
  lpti_id VARCHAR(64) NOT NULL REFERENCES lpti(id) ON DELETE CASCADE,
  versi INTEGER NOT NULL DEFAULT 1,
  aksi VARCHAR(64) NOT NULL,
  oleh_user_id VARCHAR(128),
  catatan TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. TABEL SERTIFIKAT (1 Peserta per Kegiatan = Max 1 Sertifikat)
CREATE TABLE IF NOT EXISTS sertifikat (
  id VARCHAR(64) PRIMARY KEY,
  peserta_kegiatan_id VARCHAR(64) NOT NULL UNIQUE REFERENCES peserta_kegiatan(id) ON DELETE CASCADE,
  nomor VARCHAR(128) NOT NULL UNIQUE,
  token_qr VARCHAR(128) NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'aktif',
  terbit_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dicabut_at TIMESTAMP DEFAULT NULL,
  alasan_cabut TEXT DEFAULT NULL
);

-- 10. TABEL AUDIT LOG (Audit Perubahan Aturan & Aksi Admin)
CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128),
  aksi VARCHAR(64) NOT NULL,
  entitas VARCHAR(64) NOT NULL,
  entitas_id VARCHAR(64),
  sebelum_json TEXT,
  sesudah_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. INDEKS OPTIMASI PENCARIAN & JOIN
CREATE INDEX IF NOT EXISTS idx_peserta_kegiatan_keg_peg ON peserta_kegiatan(kegiatan_id, pegawai_id);
CREATE INDEX IF NOT EXISTS idx_presensi_peserta ON presensi(peserta_kegiatan_id);
CREATE INDEX IF NOT EXISTS idx_lpti_status ON lpti(status);
CREATE INDEX IF NOT EXISTS idx_sertifikat_token_qr ON sertifikat(token_qr);
CREATE INDEX IF NOT EXISTS idx_audit_log_entitas ON audit_log(entitas, entitas_id);
