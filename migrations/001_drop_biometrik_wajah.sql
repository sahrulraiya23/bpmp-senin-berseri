-- ================================================================
-- MIGRASI: DROP SELURUH KOLOM & TABEL BIOMETRIK WAJAH (FASE 0)
-- Idempoten dan aman dieksekusi berulang kali
-- ================================================================

-- 1. DROP KOLOM PADA TABEL EMPLOYEES / PEGAWAI (PostgreSQL / Supabase)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='face_descriptor') THEN
    ALTER TABLE public.employees DROP COLUMN face_descriptor;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='face_photo_url') THEN
    ALTER TABLE public.employees DROP COLUMN face_photo_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='face_registered_at') THEN
    ALTER TABLE public.employees DROP COLUMN face_registered_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='attendance_photo_url') THEN
    ALTER TABLE public.employees DROP COLUMN attendance_photo_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='skor_wajah') THEN
    ALTER TABLE public.employees DROP COLUMN skor_wajah;
  END IF;
END $$;

-- 2. HAPUS TABEL FACE LOGS JIKA PERNAH ADA
DROP TABLE IF EXISTS public.face_verification_logs CASCADE;
DROP TABLE IF EXISTS public.face_logs CASCADE;
