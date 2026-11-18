-- ================================================================
-- HAK AKSES LENGKAP (GRANT PRIVILEGES) SUPABASE: BPMP SENIN BERSERI
-- ================================================================

-- 1. Berikan hak akses penuh pada schema public ke service_role, anon, & authenticated
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- 2. Hak akses otomatis untuk tabel/sequence baru di masa mendatang
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- 3. Kebijakan Storage untuk unggah PDF LPTI & Template Piagam
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Allow all access to lpti and templates'
  ) THEN
    CREATE POLICY "Allow all access to lpti and templates" ON storage.objects 
    FOR ALL 
    USING (bucket_id IN ('lpti', 'templates')) 
    WITH CHECK (bucket_id IN ('lpti', 'templates'));
  END IF;
END $$;
