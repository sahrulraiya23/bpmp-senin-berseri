-- ================================================================
-- SKEMA LENGKAP MYSQL DATABASE: SENIN BERSERI BPMP SULTRA
-- ================================================================
-- Kompatibel dengan MySQL 5.7+, MySQL 8.0+, MariaDB, TiDB, PlanetScale,
-- Aiven, Railway, dan cloud MySQL providers lainnya.
-- ================================================================

CREATE DATABASE IF NOT EXISTS `senin_berseri` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `senin_berseri`;

-- 1. TABEL EVENTS (Kegiatan Pelatihan ASN BPMP Sultra)
CREATE TABLE IF NOT EXISTS `events` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `jp` INT NOT NULL DEFAULT 32,
  `category` VARCHAR(128) DEFAULT 'Teknis & Manajerial Kepegawaian',
  `schedule` VARCHAR(128) DEFAULT NULL,
  `location` VARCHAR(128) DEFAULT 'Auditorium BPMP Sultra',
  `organizer` VARCHAR(255) DEFAULT 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
  `active` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `completed_at` DATETIME DEFAULT NULL,
  `current_qr_token` VARCHAR(32) DEFAULT NULL,
  `previous_qr_token` VARCHAR(32) DEFAULT NULL,
  `qr_valid_until` DATETIME DEFAULT NULL,
  `certificate_template` LONGTEXT DEFAULT NULL,
  `cert_settings` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_events_active` (`active`),
  INDEX `idx_events_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. TABEL EMPLOYEES (Data 104 Pegawai ASN & Presensi)
CREATE TABLE IF NOT EXISTS `employees` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `nip` VARCHAR(32) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL DEFAULT 'Bpmp2026!',
  `panggol` VARCHAR(128) DEFAULT '',
  `jabatan` VARCHAR(255) DEFAULT '',
  `instansi` VARCHAR(255) DEFAULT 'BPMP Provinsi Sulawesi Tenggara',
  `pendidikan` VARCHAR(64) DEFAULT '',
  `event_id` VARCHAR(64) DEFAULT NULL,
  `event_title` VARCHAR(255) DEFAULT NULL,
  `attended` TINYINT(1) NOT NULL DEFAULT 0,
  `attended_at` DATETIME DEFAULT NULL,
  `accumulated_jp` INT NOT NULL DEFAULT 0,
  `lpti_status` VARCHAR(32) NOT NULL DEFAULT 'none',
  `lpti_file_name` VARCHAR(255) DEFAULT NULL,
  `lpti_file_original_name` VARCHAR(255) DEFAULT NULL,
  `lpti_file_path` VARCHAR(255) DEFAULT NULL,
  `lpti_file_size` INT DEFAULT NULL,
  `lpti_file_data` LONGTEXT DEFAULT NULL,
  `lpti_uploaded_at` DATETIME DEFAULT NULL,
  `lpti_revision_note` TEXT DEFAULT NULL,
  `certificate_number` VARCHAR(128) DEFAULT NULL,
  `certificate_issued_at` DATETIME DEFAULT NULL,
  `certificate_verifier` VARCHAR(255) DEFAULT 'Junaiddin Pagala, ST, M.T.',
  `certificate_verifier_title` VARCHAR(255) DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
  `attendance_photo_url` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_employees_nip` (`nip`),
  INDEX `idx_employees_attended` (`attended`),
  INDEX `idx_employees_lpti_status` (`lpti_status`),
  INDEX `idx_employees_event_id` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TABEL ADMINS (Superadmin & Petugas Kepegawaian)
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL DEFAULT 'Bpmp2026!',
  `name` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'kepegawaian',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_admins_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TABEL FILES (Penyimpanan Berkas/Foto Langsung di Database Tanpa Bucket Eksternal)
CREATE TABLE IF NOT EXISTS `files` (
  `id` VARCHAR(128) NOT NULL PRIMARY KEY,
  `bucket` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `content_type` VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
  `file_data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_files_bucket_name` (`bucket`, `file_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TABEL ATTENDANCES (Riwayat / Log Presensi Pegawai Per Event)
CREATE TABLE IF NOT EXISTS `attendances` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `employee_id` VARCHAR(64) NOT NULL,
  `nip` VARCHAR(32) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `event_id` VARCHAR(64) NOT NULL,
  `event_title` VARCHAR(255) DEFAULT NULL,
  `qr_token` VARCHAR(32) DEFAULT NULL,
  `attendance_photo_url` LONGTEXT DEFAULT NULL,
  `attended_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_attendances_nip` (`nip`),
  INDEX `idx_attendances_event` (`event_id`),
  INDEX `idx_attendances_attended_at` (`attended_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. TABEL QR_TOKENS (Penyimpanan Token QR Presensi Aktif & Riwayatnya)
CREATE TABLE IF NOT EXISTS `qr_tokens` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_id` VARCHAR(64) NOT NULL,
  `token` VARCHAR(32) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` DATETIME NOT NULL,
  INDEX `idx_qr_event_token` (`event_id`, `token`),
  INDEX `idx_qr_valid_until` (`valid_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. TABEL CERTIFICATES (Pangkalan Data E-Sertifikat & Kriptografi)
CREATE TABLE IF NOT EXISTS `certificates` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY, -- certId unik untuk verifikasi
  `certificate_number` VARCHAR(128) NOT NULL UNIQUE,
  `employee_id` VARCHAR(64) NOT NULL,
  `nip` VARCHAR(32) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `event_id` VARCHAR(64) NOT NULL,
  `event_title` VARCHAR(255) DEFAULT NULL,
  `issued_at` DATETIME NOT NULL,
  `verifier` VARCHAR(255) DEFAULT 'Junaiddin Pagala, ST, M.T.',
  `verifier_title` VARCHAR(255) DEFAULT 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
  `pdf_url` VARCHAR(255) DEFAULT NULL,
  `crypto_hash` VARCHAR(128) DEFAULT NULL,
  `crypto_signature` LONGTEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_cert_nip` (`nip`),
  INDEX `idx_cert_event` (`event_id`),
  INDEX `idx_cert_number` (`certificate_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. SEED DATA DEFAULT ADMIN
INSERT INTO `admins` (`username`, `password`, `name`, `role`) VALUES
('superadmin', 'Bpmp2026!', 'Super Administrator BPMP Sultra', 'superadmin'),
('admin', 'Bpmp2026!', 'Bagian Kepegawaian BPMP Sultra', 'kepegawaian')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
