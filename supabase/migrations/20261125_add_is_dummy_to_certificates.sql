-- Migrasi: Kolom is_dummy & Dukungan Status Pencabutan pada Sertifikat
-- Tanggal: 25 November 2026
-- Sistem: Senin Berseri (BPMP Provinsi Sulawesi Tenggara)

-- 1. Tambah kolom is_dummy, status, revoked_at, revocation_reason pada tabel certificates
ALTER TABLE public.certificates 
  ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_certificates_is_dummy ON public.certificates (is_dummy);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON public.certificates (status);

-- 2. Tambah kolom is_dummy pada tabel sertifikat jika tabel tersebut ada
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sertifikat') THEN
    ALTER TABLE public.sertifikat 
      ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_sertifikat_is_dummy ON public.sertifikat (is_dummy);
  END IF;
END $$;
