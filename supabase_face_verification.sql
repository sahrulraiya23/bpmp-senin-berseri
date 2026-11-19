-- ================================================================
-- SQL MIGRATION: FITUR BIOMETRIK VERIFIKASI WAJAH ASN BPMP SULTRA
-- ================================================================
-- Jalankan query ini di Supabase SQL Editor untuk mengaktifkan kolom
-- biometrik wajah dan foto kehadiran di PostgreSQL.

-- 1. Tambah kolom biometrik pada tabel employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS face_descriptor TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS face_photo_url TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS face_registered_at TIMESTAMPTZ;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS attendance_photo_url TEXT;

-- 2. Buat bucket Supabase Storage khusus foto wajah & presensi jika belum ada
INSERT INTO storage.buckets (id, name, public) 
VALUES ('faces', 'faces', true) 
ON CONFLICT (id) DO NOTHING;

-- 3. Kebijakan akses Storage bucket 'faces'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow all access to faces'
  ) THEN
    CREATE POLICY "Allow all access to faces" ON storage.objects 
    FOR ALL 
    USING (bucket_id = 'faces') 
    WITH CHECK (bucket_id = 'faces');
  END IF;
END $$;
