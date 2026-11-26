/**
 * Router & Controller: Portal Peserta ASN BPMP Sulawesi Tenggara
 * Menyediakan halaman riwayat pelatihan mandiri dan halaman interaktif per kegiatan.
 */

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

function createPesertaRouter(multiEventService, db, helpers = {}) {
  const router = express.Router();
  const { getEmployeeFromRequest, PUBLIC_DIR, UPLOAD_DIR } = helpers;

  // Setup Multer untuk upload LPTI peserta
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      if (UPLOAD_DIR && !fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }
      cb(null, UPLOAD_DIR || './uploads/lpti');
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
      const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
      cb(null, `LPTI-${uniqueSuffix}-${cleanOriginalName}`);
    }
  });

  const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: function (req, file, cb) {
      if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
        cb(null, true);
      } else {
        cb(new Error('Hanya berkas berformat PDF (.pdf) yang diperbolehkan!'));
      }
    }
  });

  // Middleware autentikasi peserta (terisolasi hanya untuk data milik sendiri)
  async function requirePesertaAuth(req, res, next) {
    const nip = getEmployeeFromRequest ? getEmployeeFromRequest(req) : null;
    if (!nip) {
      // Jika request halaman browser, redirect ke login
      if (req.accepts('html') && !req.xhr && !req.path.startsWith('/api/')) {
        return res.redirect('/login');
      }
      return res.status(401).json({ success: false, message: 'Sesi peserta tidak ditemukan. Silakan login kembali.' });
    }

    const employee = await db.getEmployeeByIdOrNip(nip);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Data profil pegawai tidak ditemukan.' });
    }

    req.peserta = employee;
    next();
  }

  // 1. Tampilan Halaman Riwayat Pelatihan Peserta
  router.get('/peserta/riwayat', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'peserta-riwayat.html'));
  });

  // 2. Tampilan Halaman Detail Kegiatan Peserta
  router.get('/peserta/kegiatan/:id', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'peserta-kegiatan-detail.html'));
  });

  // 3. API: Riwayat Pelatihan Peserta (Data Milik Sendiri)
  router.get('/api/peserta/riwayat', requirePesertaAuth, async (req, res) => {
    try {
      const year = req.query.year ? parseInt(req.query.year, 10) : null;
      const history = await multiEventService.getEmployeeTrainingHistory(req.peserta.id);

      let filteredKegiatan = history.history || [];
      if (year) {
        filteredKegiatan = filteredKegiatan.filter(k => {
          const tgl = k.kegiatan?.tglMulai || '';
          return tgl.startsWith(String(year));
        });
      }

      res.json({
        success: true,
        pegawai: {
          id: req.peserta.id,
          nip: req.peserta.nip,
          name: req.peserta.name,
          jabatan: req.peserta.jabatan,
          instansi: req.peserta.instansi
        },
        ringkasan: history.summary,
        kegiatan: filteredKegiatan
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat riwayat peserta: ' + err.message });
    }
  });

  // 4. API: Detail 1 Kegiatan untuk Peserta Tertentu
  router.get('/api/peserta/kegiatan/:id', requirePesertaAuth, async (req, res) => {
    try {
      const kegiatanId = req.params.id;
      const keg = await multiEventService.getKegiatanById(kegiatanId);
      if (!keg) {
        return res.status(404).json({ success: false, message: 'Kegiatan tidak ditemukan.' });
      }

      // Pastikan peserta terdaftar di pivot kegiatan
      const pk = await multiEventService.ensurePesertaKegiatan(kegiatanId, req.peserta.id);
      const sesiList = await multiEventService.getSesiByKegiatan(kegiatanId);
      const store = multiEventService._getStore();

      // Cek kehadiran peserta per sesi
      const sesiWithPresensi = sesiList.map(s => {
        const pres = store.presensi.find(p => p.peserta_kegiatan_id === pk.id && p.sesi_id === s.id);
        return {
          id: s.id,
          nama: s.nama,
          tanggal: s.tanggal,
          hadir: Boolean(pres),
          waktu_presensi: pres?.waktu || null,
          metode: pres?.metode || null
        };
      });

      // Data LPTI
      const lpti = store.lpti.find(l => l.peserta_kegiatan_id === pk.id) || null;
      let lptiRiwayat = [];
      let berkasAktif = null;
      if (lpti) {
        lptiRiwayat = await multiEventService.getLptiHistory(lpti.id);
        berkasAktif = lpti.berkas_aktif || null;
      }

      // Evaluasi Kelayakan Sertifikat
      const eligibility = await multiEventService.checkEligibility(kegiatanId, req.peserta.id);
      const sertifikat = store.sertifikat.find(cert => cert.peserta_kegiatan_id === pk.id) || null;

      res.json({
        success: true,
        kegiatan: keg,
        sesi: sesiWithPresensi,
        lpti: lpti ? {
          id: lpti.id,
          status: lpti.status,
          versi: lpti.versi,
          diajukan_at: lpti.diajukan_at,
          diputuskan_at: lpti.diputuskan_at,
          berkas: berkasAktif,
          riwayat: lptiRiwayat
        } : {
          status: 'belum_unggah',
          versi: 0,
          berkas: null,
          riwayat: []
        },
        eligibility,
        sertifikat: sertifikat ? {
          id: sertifikat.id,
          nomor: sertifikat.nomor,
          token_qr: sertifikat.token_qr,
          status: sertifikat.status,
          terbit_at: sertifikat.terbit_at,
          download_url: `/api/employees/${req.peserta.nip}/certificate.pdf`
        } : null
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat detail kegiatan: ' + err.message });
    }
  });

  // 5. API: Unggah / Unggah Ulang Berkas LPTI (Cepat, Aman & Idempoten)
  router.post('/api/peserta/kegiatan/:id/unggah-lpti', requirePesertaAuth, (req, res) => {
    upload.single('lptiFile')(req, res, async function (err) {
      try {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'Ukuran file melebihi batas maksimal 15MB!' });
          }
          return res.status(400).json({ success: false, message: 'Kesalahan unggah: ' + err.message });
        } else if (err) {
          return res.status(400).json({ success: false, message: err.message });
        }

        if (!req.file) {
          return res.status(400).json({ success: false, message: 'Silakan pilih berkas PDF LPTI terlebih dahulu!' });
        }

        const kegiatanId = req.params.id;
        const keg = await multiEventService.getKegiatanById(kegiatanId);
        if (!keg) {
          if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          return res.status(404).json({ success: false, message: 'Kegiatan tidak ditemukan.' });
        }

        // Validasi wajib_lpti
        if (!keg.wajib_lpti) {
          if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          return res.status(400).json({ success: false, message: 'Kegiatan ini tidak mewajibkan laporan LPTI.' });
        }

        // Validasi batas waktu (deadline)
        if (keg.batas_unggah_lpti) {
          const now = new Date();
          const deadline = new Date(keg.batas_unggah_lpti);
          if (now > deadline) {
            if (req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({
              success: false,
              message: `Batas waktu pengunggahan LPTI telah berakhir pada ${keg.batas_unggah_lpti}.`
            });
          }
        }

        const fileInfo = {
          fileName: req.file.filename,
          fileOriginalName: req.file.originalname,
          filePath: `/uploads/lpti/${req.file.filename}`,
          fileSize: req.file.size
        };

        const lpti = await multiEventService.submitLpti(kegiatanId, req.peserta.id, fileInfo);

        // Catat ke db adapter lama jika ada untuk kompatibilitas mundur
        if (typeof db.updateEmployeeLpti === 'function') {
          try {
            await db.updateEmployeeLpti(req.peserta.id, fileInfo);
          } catch (_) {}
        }

        return res.json({
          success: true,
          message: 'Berkas LPTI berhasil diunggah! Berkas Anda saat ini berstatus "Perlu Dikurasi".',
          lpti
        });
      } catch (unhandled) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(500).json({
          success: false,
          message: 'Terjadi kesalahan sistem saat menyimpan LPTI: ' + unhandled.message
        });
      }
    });
  });

  return router;
}

module.exports = { createPesertaRouter };
