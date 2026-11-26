-- ================================================================
-- SQL MIGRATION: PEMBAGIAN TINGKATAN AKUN SUPERADMIN & KEPEGAWAIAN
-- ================================================================
-- Jalankan di Supabase SQL Editor untuk memisahkan hak akses:
-- 1. Superadmin (superadmin) -> Role: superadmin
-- 2. Bagian Kepegawaian (admin) -> Role: kepegawaian

-- 1. Tambah / Perbarui Akun Superadmin
INSERT INTO public.admins (username, password, name, role) 
VALUES ('superadmin', 'Bpmp2026!', 'Super Administrator BPMP Sultra', 'superadmin') 
ON CONFLICT (username) DO UPDATE SET 
  name = 'Super Administrator BPMP Sultra', 
  role = 'superadmin',
  password = EXCLUDED.password;

-- 2. Perbarui Akun Admin Menjadi Bagian Kepegawaian
INSERT INTO public.admins (username, password, name, role) 
VALUES ('admin', 'Bpmp2026!', 'Bagian Kepegawaian BPMP Sultra', 'kepegawaian') 
ON CONFLICT (username) DO UPDATE SET 
  name = 'Bagian Kepegawaian BPMP Sultra', 
  role = 'kepegawaian',
  password = EXCLUDED.password;
