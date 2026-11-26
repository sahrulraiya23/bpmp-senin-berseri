-- ================================================================
-- SKEMA LENGKAP SUPABASE POSTGRESQL: BPMP SENIN BERSERI
-- ================================================================

-- 1. TABEL EVENTS (Pelatihan Kepegawaian)
CREATE TABLE IF NOT EXISTS public.events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  jp INTEGER NOT NULL DEFAULT 32,
  category TEXT NOT NULL,
  schedule TEXT,
  location TEXT,
  organizer TEXT DEFAULT 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
  active BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active',
  completed_at TIMESTAMPTZ,
  current_qr_token TEXT,
  previous_qr_token TEXT,
  qr_valid_until TIMESTAMPTZ,
  certificate_template JSONB,
  cert_settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL EMPLOYEES (104 Pegawai ASN BPMP Sultra)
CREATE TABLE IF NOT EXISTS public.employees (
  id TEXT PRIMARY KEY,
  nip TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT 'Bpmp2026!',
  panggol TEXT,
  jabatan TEXT,
  instansi TEXT DEFAULT 'BPMP Provinsi Sulawesi Tenggara',
  pendidikan TEXT,
  event_id TEXT REFERENCES public.events(id) ON DELETE SET NULL,
  event_title TEXT,
  attended BOOLEAN DEFAULT false,
  attended_at TIMESTAMPTZ,
  accumulated_jp INTEGER DEFAULT 0,
  lpti_status TEXT DEFAULT 'none',
  lpti_file_name TEXT,
  lpti_file_original_name TEXT,
  lpti_file_path TEXT,
  lpti_file_size INTEGER,
  lpti_uploaded_at TIMESTAMPTZ,
  lpti_revision_note TEXT,
  certificate_number TEXT,
  certificate_issued_at TIMESTAMPTZ,
  certificate_verifier TEXT,
  certificate_verifier_title TEXT,
  face_descriptor JSONB,
  face_photo_url TEXT,
  face_registered_at TIMESTAMPTZ,
  attendance_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL ADMINS (Autentikasi Panitia Kepegawaian)
CREATE TABLE IF NOT EXISTS public.admins (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'superadmin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. INSERT DATA ADMIN DEFAULT (Superadmin & Bagian Kepegawaian)
INSERT INTO public.admins (username, password, name, role) 
VALUES ('superadmin', 'Bpmp2026!', 'Super Administrator BPMP Sultra', 'superadmin') 
ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name, role = 'superadmin';

INSERT INTO public.admins (username, password, name, role) 
VALUES ('admin', 'Bpmp2026!', 'Bagian Kepegawaian BPMP Sultra', 'kepegawaian') 
ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name, role = 'kepegawaian';

-- 5. INSERT DATA EVENTS DEFAULT
INSERT INTO public.events (id, title, jp, category, schedule, location, organizer, active, status, certificate_template, cert_settings) VALUES ('EVT-2026-001', 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN BPMP Sultra', 32, 'Teknis & Manajerial Kepegawaian', '18 - 20 November 2026', 'Auditorium BPMP Sultra', 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara', true, 'active', NULL, '{"prefix":"800.1.3/SERT-LPTI/2026","nomorYRatio":0.75,"namaYRatio":0.48,"namaFontSize":28,"nomorFontSize":12,"showUnderline":true}'::jsonb) ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, status = EXCLUDED.status;

-- 6. INSERT DATA 104 ASN RESMI BPMP SULTRA
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-001', '197606122002121004', 'Junaiddin Pagala, ST, M.T.', 'Bpmp2026!', 'Pembina Tk.I, IV/b', 'Kepala', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-002', '198106022006042001', 'Rika Ernita Mekuo, S.Si. M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Kasubbag Umum', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-003', '196912311995121016', 'Riya Ld. Makruf Tonda, S.Pd, M.Pd.', 'Bpmp2026!', 'Pembina Utama Muda, IV/c', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-004', '197112311997021007', 'La Siara, S.Pd, M.Pd./ Ka Timker SD', 'Bpmp2026!', 'Pembina Utama Muda, IV/c', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-005', '196611171991012001', 'Dra. Tenri Sanna, M.Pd.', 'Bpmp2026!', 'Pembina Utama Muda, IV/c', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-006', '196812311990031040', 'Basir Sarulah, S.Pd, M.Pd.', 'Bpmp2026!', 'Pembina Utama Muda, IV/c', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-007', '196909021998022004', 'St. Asmawati, S.P, M.Pd.', 'Bpmp2026!', 'Pembina Tk.I, IV/b', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-008', '196904211994121002', 'Zuumi Kudus, S.Pd., M.Pd./ Ka Timker SMA', 'Bpmp2026!', 'Pembina Tk.I, IV/b', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-009', '198006162002121005', 'Dr. La Mashuri, S.Pd, M.Si.', 'Bpmp2026!', 'Pembina Tk.I, IV/b', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-010', '197204302002121002', 'Rahman Bake, S.S, M.Si.', 'Bpmp2026!', 'Pembina, IV/b', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-011', '197507202002121004', 'La Ode Sahara, S.Pd., M.Pd.', 'Bpmp2026!', 'Pembina, IV/b', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-012', '197203201999032002', 'Isnawati Abas, M.Pd, MA./ Ketua SPI', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-013', '197205282002122001', 'Sri Rianti A.M. Rays, S.Pd. M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-014', '198111282003121003', 'Ari Sudono, S.Si, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-015', '197910132003122001', 'Rahmawati, S.Si, M.Si./ Ka Timker Paud', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-016', '197706302005011001', 'Wahyu Falah, S.Si, M.Si./ Ka Timker SMP', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Madya', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-017', '197901262002122002', 'Nilam Sari, S.E.M.Si./ Keuangan', 'Bpmp2026!', 'Pembina, IV/a', 'Analis Pengelolaan Keuangan APBN Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-018', '198004242003122002', 'Kartini, S.Si.,M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-019', '197908032006042002', 'Tri Lestari, S.TP, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-020', '198203192008012008', 'Ince Amriani Sultaniah A, S.Si.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Widyaprada Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-021', '198006142005012004', 'Dr. Fitriani R, S.Ip. M.I.Kom.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Widyaprada Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-022', '197005231992032008', 'Etika Rosita, S.Sos.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Widyaprada Ahli Muda', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-023', '197401042002122001', 'Irene Irawati Arsanti, SH, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Pertama', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-024', '197703262003121003', 'Jurdin, S.Si, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Widyaprada Ahli Pertama', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-025', '197704252001122001', 'Yulia, SE, M.Acc.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-026', '196906252002122001', 'Sri Retno Darmayanti, ST, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-027', '197104192002121002', 'Muh. Sabri Sarita, ST. M.Si./ BMN', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-028', '197305142002122001', 'Nurhikmah, S.Pd.M.E.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-029', '197406122002122003', 'Zayati, S.Pd, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-030', '197503012002121001', 'Edy, S.Pd, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-031', '197409042002121002', 'Muh. Syafri Rumpa, ST, MT.', 'Bpmp2026!', 'Pembina, IV/a', 'Pengelola Sistem dan Teknologi Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-032', '197611062002122002', 'Muliana, S.Pd, M.Hum.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-033', '197106212003121002', 'Abdul Salam, S.Pd, M.Hum.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-034', '197209062003122001', 'Endang Lestariningsih, S.Pd. M.E.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-035', '197612092003122003', 'Misrawaty Syahrir, S. Sos, MA.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-036', '198001062003122001', 'Soesiana Ariani, S.Pd, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Informasi dan Komunikasi Publik', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-037', '197907192003122002', 'Wd. Yuli Wachdaniah M, S.Psi. M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-038', '197208252002121002', 'Muh. Nurung, S.Pd, M.Pd.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-039', '197908232005011002', 'Asruddin, ST, M.Eng.', 'Bpmp2026!', 'Pembina, IV/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-040', '197908052005012004', 'Kurniati Halmin, ST, M.Si.', 'Bpmp2026!', 'Pembina, IV/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-041', '197310152006041002', 'Muhamad Taufik R,ST, M.Pd.', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-042', '197401292001122001', 'Zuhasmi Hamaku, S.P, M.Si./ Persuratan', 'Bpmp2026!', 'Pembina, IV/a', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-043', '197901292005012006', 'Murdiah, S.T.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-044', '198204212006042002', 'Amniar, S.IP.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-045', '196903022003121001', 'H. Usman N, S.Pd.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-046', '196912311992032001', 'Hasaniy, S.E.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-047', '196902101994032003', 'Suriyati, S.Sos.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-048', '198309252009122002', 'Dewi Arifta Setyarini, SH./ Tata Laksana', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-049', '197207222002121002', 'Gaudensius Dadu Beribe, S.Kom.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengelola Sistem dan Teknologi Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-050', '197305102002121001', 'Rudin Buduhama, S.Sos.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-051', '197512102002121004', 'Rahmad, SE. M.Si.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-052', '198002122002122002', 'Umi Jariyah, SH./ Kepegawaian', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-053', '197105051994011001', 'Andi Basri, S.Sos./ Perencanaan Anggaran', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-054', '197611092002122001', 'Sitti Samsuria, SE.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-055', '197406062007011001', 'Said, S.Sos.', 'Bpmp2026!', 'Penata Tk.I, III/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-056', '197407012007011004', 'Mahmud, SE.', 'Bpmp2026!', 'Penata, III/c', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-057', '197610072010121002', 'Ramadhan, S.Pd.', 'Bpmp2026!', 'Penata, III/c', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-058', '198311042005011001', 'Novri Nasdiansyah, S.Ip.', 'Bpmp2026!', 'Penata, III/c', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-059', '198501222009101001', 'Sarafudin, S.M., M.M. / Admin', 'Bpmp2026!', 'Penata, III/c', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S2') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-060', '197202032014091001', 'Tunas Rianto, S.IP.', 'Bpmp2026!', 'Penata, III/c', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-061', '197108031993031002', 'Syamsul Bahri', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-062', '197112221994011001', 'H e l w i', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-063', '198307272001122002', 'Harmina', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMK') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-064', '197312242002122001', 'Neneng Suraya, S.H.', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-065', '198005062010121004', 'Haeruddin, S.T.', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Penelaah Teknis Kebijakan', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-066', '198302032010122002', 'Hasliati, A.Md.', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'D3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-067', '198407272009101001', 'Nurdin Saleh, SH.', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-068', '196910112005011003', 'M. Agung Satriyono', 'Bpmp2026!', 'Penata Muda Tk.I, III/b', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-069', '198404072009101003', 'Hariadin, S.E.', 'Bpmp2026!', 'Penata Muda, III/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-070', '198412312009101002', 'Ashar Konggi.S.AP', 'Bpmp2026!', 'Penata Muda, III/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-071', '198208072009102001', 'Elyati,S.Pd', 'Bpmp2026!', 'Penata Muda, III/a', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-072', '197808082009101004', 'Ratsul', 'Bpmp2026!', 'Penata Muda, III/a', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-073', '198204222009101002', 'Masruddin', 'Bpmp2026!', 'Penata Muda, III/a', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMK') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-074', '199109102022032011', 'Retno Endang Koeswarini L Saida, A.Md.', 'Bpmp2026!', 'Pengatur TK I,II/d', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'D3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-075', '199508192022031006', 'Ihwatul Rakhmat Samudra. A.Md,T', 'Bpmp2026!', 'Pengatur TK I,II/d', 'Teknisi Sarana dan Prasarana', 'BPMP Provinsi Sulawesi Tenggara', 'D3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-076', '199009012022032007', 'Evy Dian Ekawaty, A.Md', 'Bpmp2026!', 'Pengatur, II/c', 'Pengolah Data dan Informasi', 'BPMP Provinsi Sulawesi Tenggara', 'D3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-077', '197003072014091003', 'Syamsuddin. L', 'Bpmp2026!', 'Pengatur, II/c', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-078', '197703042009101001', 'Baharudin', 'Bpmp2026!', 'Pengatur, II/c', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA Paket C') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-079', '197501012025211052', 'Agusalim, S.Pd.I.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-080', '198407102025212035', 'Anita Rahmawaty, S.Si.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-081', '198411192025211032', 'Ilham Mado, S.Pd', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-082', '198807292025211042', 'Yus Setyawan, S.AP.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-083', '198912122025212077', 'Darna Eka Putri, S.Pd, SD.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-084', '199204272025212046', 'Rifka Ayu Pratiwi, S.Pt.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-085', '199203122025212048', 'Andi Tenri Mayasari, S.H.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-086', '199306042025212053', 'Indriani Saputri, S.IK.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-087', '199210182025211035', 'Sri Wahyudi, S.Sos.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-088', '199502242025211045', 'Tomy Eko Febriyan, S.AP.', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-089', '199911272025211015', 'Dony Khalik Novaldi, S.Ak./ Rumah Tangga', 'Bpmp2026!', 'Penata Muda, IX', 'Penata Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-090', '199901072025212023', 'Fitra Amalia Ramadhana Salam, A.Md., Stat.', 'Bpmp2026!', 'Pengatur, VII', 'Pengelola  Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'D3') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-091', '198704222025211053', 'Masri', 'Bpmp2026!', 'Pengatur Muda, V', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-092', '198407232025211046', 'Aswoyo Pangat', 'Bpmp2026!', 'Pengatur Muda, V', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-093', '199002282025211041', 'Kaharudin', 'Bpmp2026!', 'Pengatur Muda, V', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-094', '199503312025211026', 'Muh. Rezky Faisal Landouw', 'Bpmp2026!', 'Pengatur Muda, V', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-095', '198601192025212028', 'Fratiwi Tetambe', 'Bpmp2026!', 'Pengatur Muda, V', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-096', '198806012025212048', 'Tuti Parniati', 'Bpmp2026!', 'Pengatur Muda, V', 'Pengadministrasi Perkantoran', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-097', '198205242025211051', 'Ahmadi', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMU') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-098', '199401172025211067', 'Ardiansah', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMK') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-099', '198501032025211056', 'Armansyah', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'Paket C') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-100', '199003072025211071', 'Asrin', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMK') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-101', '197405132025212008', 'Ema', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-102', '199109242025211058', 'Hanibal Samaga', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-103', '197204012025212014', 'Rusnah', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'Paket C') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-104', '197608042025212016', 'Suharni', 'Bpmp2026!', '-', 'Operator Layanan Operasional', 'BPMP Provinsi Sulawesi Tenggara', 'SMA') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-TEST-01', '199508232024011001', 'Muhammad Saharullah Raiya', 'Bpmp2026!', 'Penata Muda, III/a', 'Pranata Komputer / Pengembang Sistem', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-TEST-02', '199703142024021002', 'M. Rafli', 'Bpmp2026!', 'Penata Muda, III/a', 'Pranata Komputer', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;
INSERT INTO public.employees (id, nip, name, password, panggol, jabatan, instansi, pendidikan) VALUES ('BPMP-TEST-03', '199811052024031003', 'User Pegawai ASN (Testing)', 'Bpmp2026!', 'Penata Muda, III/a', 'Staf Kepegawaian', 'BPMP Provinsi Sulawesi Tenggara', 'S1') ON CONFLICT (nip) DO UPDATE SET name = EXCLUDED.name, jabatan = EXCLUDED.jabatan, panggol = EXCLUDED.panggol;

-- 7. TABEL CERTIFICATES (Pangkalan Data E-Sertifikat Kriptografis Resmi)
CREATE TABLE IF NOT EXISTS public.certificates (
  id TEXT PRIMARY KEY, -- certId unik untuk verifikasi Dicoding-style
  certificate_number TEXT UNIQUE NOT NULL,
  employee_id TEXT NOT NULL,
  nip TEXT NOT NULL,
  name TEXT NOT NULL,
  event_id TEXT REFERENCES public.events(id) ON DELETE SET NULL,
  event_title TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verifier TEXT DEFAULT 'Junaiddin Pagala, ST, M.T.',
  verifier_title TEXT DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
  pdf_url TEXT,
  crypto_hash TEXT,
  crypto_signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_certificates_nip ON public.certificates (nip);
CREATE INDEX IF NOT EXISTS idx_certificates_number ON public.certificates (certificate_number);

-- 8. TABEL ATTENDANCES (Riwayat & Log Kehadiran Pegawai Per Kegiatan)
CREATE TABLE IF NOT EXISTS public.attendances (
  id BIGSERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL,
  nip TEXT NOT NULL,
  name TEXT NOT NULL,
  event_id TEXT REFERENCES public.events(id) ON DELETE SET NULL,
  event_title TEXT,
  qr_token TEXT,
  attendance_photo_url TEXT,
  attended_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendances_nip ON public.attendances (nip);
CREATE INDEX IF NOT EXISTS idx_attendances_event ON public.attendances (event_id);

-- 9. TABEL QR_TOKENS (Penyimpanan Token QR Aktif & Riwayatnya)
CREATE TABLE IF NOT EXISTS public.qr_tokens (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  token TEXT NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qr_event_token ON public.qr_tokens (event_id, token);

-- 10. STORAGE BUCKETS (Untuk PDF LPTI, Template Piagam, Foto Wajah, & Sertifikat PDF)
INSERT INTO storage.buckets (id, name, public) VALUES ('lpti', 'lpti', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('templates', 'templates', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('faces', 'faces', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('certificates', 'certificates', true) ON CONFLICT (id) DO NOTHING;

-- 11. ROW LEVEL SECURITY (RLS) POLICIES & PERMISSIONS
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;

-- Kebijakan Akses Universal (Read/Write via API Backend / Service Role / Anon)
DO $$
BEGIN
  -- Certificates
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'certificates' AND policyname = 'Allow public read certificates') THEN
    CREATE POLICY "Allow public read certificates" ON public.certificates FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'certificates' AND policyname = 'Allow all certificates') THEN
    CREATE POLICY "Allow all certificates" ON public.certificates FOR ALL USING (true);
  END IF;

  -- Attendances
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendances' AND policyname = 'Allow public read attendances') THEN
    CREATE POLICY "Allow public read attendances" ON public.attendances FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendances' AND policyname = 'Allow all attendances') THEN
    CREATE POLICY "Allow all attendances" ON public.attendances FOR ALL USING (true);
  END IF;

  -- QR Tokens
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qr_tokens' AND policyname = 'Allow public read qr_tokens') THEN
    CREATE POLICY "Allow public read qr_tokens" ON public.qr_tokens FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qr_tokens' AND policyname = 'Allow all qr_tokens') THEN
    CREATE POLICY "Allow all qr_tokens" ON public.qr_tokens FOR ALL USING (true);
  END IF;
END $$;

