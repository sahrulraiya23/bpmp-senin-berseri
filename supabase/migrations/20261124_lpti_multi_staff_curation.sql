-- ==============================================================
-- MIGRASI: SISTEM KURASI LPTI MULTI-STAF DENGAN RIWAYAT LENGKAP
-- BPMP PROVINSI SULAWESI TENGGARA
-- ==============================================================

-- 1. ALTER TABLE EMPLOYEES (OPTIMISTIC LOCKING & STATUS KLAIM)
ALTER TABLE employees 
  ADD COLUMN IF NOT EXISTS lpti_versi INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS diklaim_oleh VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diklaim_pada TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diklaim_sampai TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diputuskan_oleh VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diputuskan_nama VARCHAR(150) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diputuskan_pada TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lpti_catatan TEXT DEFAULT NULL;

-- 2. TABEL LPTI_RIWAYAT (APPEND-ONLY)
CREATE TABLE IF NOT EXISTS lpti_riwayat (
  id BIGSERIAL PRIMARY KEY,
  pegawai_id VARCHAR(50) NOT NULL,
  lpti_id VARCHAR(100),
  aksi VARCHAR(35) NOT NULL, -- diunggah, diunggah_ulang, diklaim, dilepas, disetujui, direvisi, persetujuan_dibatalkan
  oleh VARCHAR(100) NOT NULL,
  nama_snapshot VARCHAR(150) NOT NULL,
  status_sebelum VARCHAR(30),
  status_sesudah VARCHAR(30) NOT NULL,
  catatan TEXT,
  waktu TIMESTAMPTZ DEFAULT NOW(),
  ip VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_lpti_riwayat_pegawai ON lpti_riwayat(pegawai_id);
CREATE INDEX IF NOT EXISTS idx_lpti_riwayat_waktu ON lpti_riwayat(waktu DESC);

-- Trigger Penguncian Append-Only: Menolak UPDATE & DELETE bahkan via Service Key
CREATE OR REPLACE FUNCTION prevent_lpti_riwayat_mod()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TABEL APPEND-ONLY: lpti_riwayat tidak dapat diubah (UPDATE) atau dihapus (DELETE)!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_lpti_riwayat_mod ON lpti_riwayat;
CREATE TRIGGER trg_prevent_lpti_riwayat_mod
BEFORE UPDATE OR DELETE ON lpti_riwayat
FOR EACH ROW
EXECUTE FUNCTION prevent_lpti_riwayat_mod();

-- RLS Lapisan Tambahan
ALTER TABLE lpti_riwayat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_lpti_riwayat_insert ON lpti_riwayat;
CREATE POLICY p_lpti_riwayat_insert ON lpti_riwayat FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS p_lpti_riwayat_select ON lpti_riwayat;
CREATE POLICY p_lpti_riwayat_select ON lpti_riwayat FOR SELECT USING (true);

-- 3. TABEL ADMINS & AKTIVITAS_LOG
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS peran VARCHAR(30) DEFAULT 'kepegawaian',
  ADD COLUMN IF NOT EXISTS aktif BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS terakhir_login TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wajib_ganti_password BOOLEAN DEFAULT false;

-- Normalisasi peran dari kolom lama 'role' jika ada
UPDATE admins SET peran = COALESCE(role, 'kepegawaian') WHERE peran IS NULL;

CREATE TABLE IF NOT EXISTS aktivitas_log (
  id BIGSERIAL PRIMARY KEY,
  aktor_id VARCHAR(100) NOT NULL,
  aktor_nama VARCHAR(150) NOT NULL,
  aksi VARCHAR(50) NOT NULL,
  target VARCHAR(100),
  keterangan TEXT,
  ip VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aktivitas_log_waktu ON aktivitas_log(created_at DESC);

-- 4. FUNGSI POSTGRES RPC: KLAIM LPTI
CREATE OR REPLACE FUNCTION rpc_klaim_lpti(
  p_pegawai_id VARCHAR(50),
  p_user_id VARCHAR(100),
  p_user_nama VARCHAR(150),
  p_user_peran VARCHAR(30),
  p_client_ip VARCHAR(50) DEFAULT NULL,
  p_duration_minutes INT DEFAULT 15
)
RETURNS JSONB AS $$
DECLARE
  v_emp RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_until TIMESTAMPTZ := NOW() + (p_duration_minutes || ' minutes')::INTERVAL;
BEGIN
  SELECT id, name, lpti_status, lpti_versi, diklaim_oleh, diklaim_sampai 
  INTO v_emp FROM employees WHERE id = p_pegawai_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Data pegawai tidak ditemukan.');
  END IF;

  IF v_emp.lpti_status NOT IN ('pending', 'perlu_dikurasi') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'message', 'Berkas LPTI belum siap dikurasi (status: ' || v_emp.lpti_status || ').');
  END IF;

  -- Cek apakah sedang diklaim staf lain & belum kedaluwarsa
  IF v_emp.diklaim_oleh IS NOT NULL AND v_emp.diklaim_sampai > v_now AND v_emp.diklaim_oleh <> p_user_id THEN
    -- Superadmin boleh ambil alih klaim
    IF p_user_peran <> 'superadmin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'ALREADY_CLAIMED',
        'message', 'Sedang diperiksa oleh staf lain.',
        'claimed_by', v_emp.diklaim_oleh,
        'claimed_until', v_emp.diklaim_sampai
      );
    END IF;
  END IF;

  -- Lakukan klaim
  UPDATE employees 
  SET diklaim_oleh = p_user_id,
      diklaim_pada = v_now,
      diklaim_sampai = v_until
  WHERE id = p_pegawai_id;

  INSERT INTO lpti_riwayat(pegawai_id, aksi, oleh, nama_snapshot, status_sebelum, status_sesudah, catatan, waktu, ip)
  VALUES (p_pegawai_id, 'diklaim', p_user_id, p_user_nama, v_emp.lpti_status, v_emp.lpti_status, 'Mengklaim antrean kurasi LPTI (15 menit)', v_now, p_client_ip);

  RETURN jsonb_build_object(
    'success', true,
    'pegawai_id', p_pegawai_id,
    'diklaim_oleh', p_user_id,
    'diklaim_sampai', v_until,
    'versi', v_emp.lpti_versi
  );
END;
$$ LANGUAGE plpgsql;

-- 5. FUNGSI POSTGRES RPC: LEPAS KLAIM LPTI
CREATE OR REPLACE FUNCTION rpc_lepas_klaim_lpti(
  p_pegawai_id VARCHAR(50),
  p_user_id VARCHAR(100),
  p_user_nama VARCHAR(150),
  p_user_peran VARCHAR(30),
  p_client_ip VARCHAR(50) DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_emp RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT id, lpti_status, diklaim_oleh INTO v_emp FROM employees WHERE id = p_pegawai_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Data pegawai tidak ditemukan.');
  END IF;

  IF v_emp.diklaim_oleh IS NOT NULL AND v_emp.diklaim_oleh <> p_user_id AND p_user_peran <> 'superadmin' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Hanya pengklaim atau superadmin yang dapat melepas klaim.');
  END IF;

  UPDATE employees 
  SET diklaim_oleh = NULL,
      diklaim_pada = NULL,
      diklaim_sampai = NULL
  WHERE id = p_pegawai_id;

  INSERT INTO lpti_riwayat(pegawai_id, aksi, oleh, nama_snapshot, status_sebelum, status_sesudah, catatan, waktu, ip)
  VALUES (p_pegawai_id, 'dilepas', p_user_id, p_user_nama, v_emp.lpti_status, v_emp.lpti_status, 'Melepas klaim antrean kurasi LPTI', v_now, p_client_ip);

  RETURN jsonb_build_object('success', true, 'message', 'Klaim LPTI berhasil dilepas.');
END;
$$ LANGUAGE plpgsql;

-- 6. FUNGSI POSTGRES RPC: SETUJUI LPTI (OPTIMISTIC LOCKING)
CREATE OR REPLACE FUNCTION rpc_setujui_lpti(
  p_pegawai_id VARCHAR(50),
  p_versi INT,
  p_user_id VARCHAR(100),
  p_user_nama VARCHAR(150),
  p_user_peran VARCHAR(30),
  p_client_ip VARCHAR(50) DEFAULT NULL,
  p_catatan TEXT DEFAULT NULL,
  p_jp INT DEFAULT 4,
  p_cert_number VARCHAR(100) DEFAULT NULL,
  p_verifier VARCHAR(150) DEFAULT 'Junaiddin Pagala, S.T., M.T.',
  p_verifier_title VARCHAR(150) DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
)
RETURNS JSONB AS $$
DECLARE
  v_emp RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_rows_affected INT;
BEGIN
  IF p_user_peran NOT IN ('superadmin', 'kepegawaian') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Anda tidak memiliki hak akses kurasi LPTI.');
  END IF;

  -- Optimistic locking: WHERE id = ? AND lpti_versi = ? AND lpti_status IN ('pending', 'perlu_dikurasi')
  UPDATE employees
  SET lpti_status = 'approved',
      lpti_versi = lpti_versi + 1,
      lpti_revision_note = '',
      diputuskan_oleh = p_user_id,
      diputuskan_nama = p_user_nama,
      diputuskan_pada = v_now,
      lpti_catatan = p_catatan,
      diklaim_oleh = NULL,
      diklaim_sampai = NULL,
      certificate_number = COALESCE(p_cert_number, certificate_number),
      certificate_issued_at = v_now,
      certificate_verifier = p_verifier,
      certificate_verifier_title = p_verifier_title,
      accumulated_jp = COALESCE(accumulated_jp, 0) + p_jp
  WHERE id = p_pegawai_id 
    AND lpti_versi = p_versi 
    AND lpti_status IN ('pending', 'perlu_dikurasi');

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    SELECT lpti_status, lpti_versi, diputuskan_nama, diputuskan_pada 
    INTO v_emp FROM employees WHERE id = p_pegawai_id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONFLICT',
      'message', 'Gagal menyetujui: Status LPTI telah diubah oleh staf lain atau versi tidak cocok.',
      'current_status', v_emp.lpti_status,
      'current_versi', v_emp.lpti_versi,
      'decided_by', v_emp.diputuskan_nama,
      'decided_at', v_emp.diputuskan_pada
    );
  END IF;

  -- Catat Riwayat Append-Only
  INSERT INTO lpti_riwayat(pegawai_id, aksi, oleh, nama_snapshot, status_sebelum, status_sesudah, catatan, waktu, ip)
  VALUES (p_pegawai_id, 'disetujui', p_user_id, p_user_nama, 'pending', 'approved', COALESCE(p_catatan, 'LPTI disetujui, e-sertifikat diterbitkan'), v_now, p_client_ip);

  RETURN jsonb_build_object(
    'success', true,
    'message', 'LPTI berhasil disetujui.',
    'pegawai_id', p_pegawai_id,
    'status', 'approved',
    'versi', p_versi + 1
  );
END;
$$ LANGUAGE plpgsql;

-- 7. FUNGSI POSTGRES RPC: REVISI LPTI (ALASAN WAJIB)
CREATE OR REPLACE FUNCTION rpc_revisi_lpti(
  p_pegawai_id VARCHAR(50),
  p_versi INT,
  p_user_id VARCHAR(100),
  p_user_nama VARCHAR(150),
  p_user_peran VARCHAR(30),
  p_alasan TEXT,
  p_client_ip VARCHAR(50) DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_emp RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_rows_affected INT;
BEGIN
  IF p_user_peran NOT IN ('superadmin', 'kepegawaian') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Anda tidak memiliki hak akses kurasi LPTI.');
  END IF;

  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Alasan / catatan revisi wajib diisi!');
  END IF;

  UPDATE employees
  SET lpti_status = 'revision',
      lpti_versi = lpti_versi + 1,
      lpti_revision_note = TRIM(p_alasan),
      diputuskan_oleh = p_user_id,
      diputuskan_nama = p_user_nama,
      diputuskan_pada = v_now,
      lpti_catatan = TRIM(p_alasan),
      diklaim_oleh = NULL,
      diklaim_sampai = NULL
  WHERE id = p_pegawai_id 
    AND lpti_versi = p_versi 
    AND lpti_status IN ('pending', 'perlu_dikurasi');

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    SELECT lpti_status, lpti_versi, diputuskan_nama, diputuskan_pada 
    INTO v_emp FROM employees WHERE id = p_pegawai_id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONFLICT',
      'message', 'Gagal merevisi: Status LPTI telah diubah oleh staf lain atau versi tidak cocok.',
      'current_status', v_emp.lpti_status,
      'current_versi', v_emp.lpti_versi,
      'decided_by', v_emp.diputuskan_nama,
      'decided_at', v_emp.diputuskan_pada
    );
  END IF;

  INSERT INTO lpti_riwayat(pegawai_id, aksi, oleh, nama_snapshot, status_sebelum, status_sesudah, catatan, waktu, ip)
  VALUES (p_pegawai_id, 'direvisi', p_user_id, p_user_nama, 'pending', 'revision', TRIM(p_alasan), v_now, p_client_ip);

  RETURN jsonb_build_object(
    'success', true,
    'message', 'LPTI telah dikembalikan untuk revisi.',
    'pegawai_id', p_pegawai_id,
    'status', 'revision',
    'versi', p_versi + 1
  );
END;
$$ LANGUAGE plpgsql;

-- 8. FUNGSI POSTGRES RPC: BATALKAN PERSETUJUAN (KHUSUS SUPERADMIN)
CREATE OR REPLACE FUNCTION rpc_batalkan_persetujuan_lpti(
  p_pegawai_id VARCHAR(50),
  p_user_id VARCHAR(100),
  p_user_nama VARCHAR(150),
  p_user_peran VARCHAR(30),
  p_alasan TEXT,
  p_client_ip VARCHAR(50) DEFAULT NULL,
  p_jp INT DEFAULT 4
)
RETURNS JSONB AS $$
DECLARE
  v_emp RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_user_peran <> 'superadmin' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Hanya Superadmin yang memiliki wewenang membatalkan persetujuan LPTI.');
  END IF;

  IF p_alasan IS NULL OR TRIM(p_alasan) = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'VALIDATION_ERROR', 'message', 'Alasan pembatalan persetujuan wajib diisi!');
  END IF;

  SELECT id, lpti_status, lpti_versi, accumulated_jp INTO v_emp FROM employees WHERE id = p_pegawai_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'message', 'Data pegawai tidak ditemukan.');
  END IF;

  IF v_emp.lpti_status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'message', 'Hanya berkas berstatus Disetujui yang dapat dibatalkan.');
  END IF;

  UPDATE employees
  SET lpti_status = 'pending',
      lpti_versi = lpti_versi + 1,
      lpti_revision_note = TRIM(p_alasan),
      diputuskan_oleh = p_user_id,
      diputuskan_nama = p_user_nama,
      diputuskan_pada = v_now,
      lpti_catatan = 'Persetujuan dibatalkan: ' || TRIM(p_alasan),
      diklaim_oleh = NULL,
      diklaim_sampai = NULL,
      accumulated_jp = GREATEST(0, COALESCE(accumulated_jp, 0) - p_jp)
  WHERE id = p_pegawai_id;

  INSERT INTO lpti_riwayat(pegawai_id, aksi, oleh, nama_snapshot, status_sebelum, status_sesudah, catatan, waktu, ip)
  VALUES (p_pegawai_id, 'persetujuan_dibatalkan', p_user_id, p_user_nama, 'approved', 'pending', TRIM(p_alasan), v_now, p_client_ip);

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Persetujuan LPTI berhasil dibatalkan oleh Superadmin. Status kembali ke Perlu Dikurasi.',
    'pegawai_id', p_pegawai_id,
    'status', 'pending',
    'versi', v_emp.lpti_versi + 1
  );
END;
$$ LANGUAGE plpgsql;
