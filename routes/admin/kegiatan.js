/**
 * Router & Controller: Manajemen Kegiatan & Sesi Pelatihan ASN BPMP Sultra
 * Mendukung Multi-Event, multi-sesi, aturan kelayakan LPTI/sertifikat, dan jejak audit.
 */

const express = require('express');
const path = require('path');

function createKegiatanRouter(multiEventService, helpers = {}) {
  const router = express.Router();
  const { getAdminFromToken, PUBLIC_DIR } = helpers;

  // Middleware autentikasi admin
  function requireAdminAuth(req, res, next) {
    if (!getAdminFromToken) return next();
    const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Autentikasi admin diperlukan.' });
    }
    req.admin = admin;
    next();
  }

  // 1. Tampilan Halaman Admin Manajemen Kegiatan
  router.get('/admin/kegiatan', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-kegiatan.html'));
  });

  // 2. API: Mengambil Semua Kegiatan
  router.get('/api/admin/kegiatan', requireAdminAuth, async (req, res) => {
    try {
      const allKegiatan = await multiEventService.getAllKegiatan();
      const enriched = [];
      for (const k of allKegiatan) {
        const sesiList = await multiEventService.getSesiByKegiatan(k.id);
        enriched.push({
          ...k,
          total_sesi: sesiList.length,
          sesi: sesiList
        });
      }
      res.json({ success: true, kegiatan: enriched });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat kegiatan: ' + err.message });
    }
  });

  // 3. API: Mengambil Detail 1 Kegiatan & Sesi
  router.get('/api/admin/kegiatan/:id', requireAdminAuth, async (req, res) => {
    try {
      const keg = await multiEventService.getKegiatanById(req.params.id);
      if (!keg) {
        return res.status(404).json({ success: false, message: 'Kegiatan tidak ditemukan.' });
      }
      const sesi = await multiEventService.getSesiByKegiatan(keg.id);
      res.json({ success: true, kegiatan: keg, sesi });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat detail kegiatan: ' + err.message });
    }
  });

  // 4. API: Tambah Kegiatan Baru
  router.post('/api/admin/kegiatan', requireAdminAuth, async (req, res) => {
    try {
      const {
        nama,
        tgl_mulai,
        tgl_selesai,
        jp,
        wajib_lpti,
        batas_unggah_lpti,
        min_sesi_hadir,
        template_id,
        format_nomor
      } = req.body;

      if (!nama || !tgl_mulai) {
        return res.status(400).json({ success: false, message: 'Nama kegiatan dan tanggal mulai wajib diisi!' });
      }

      const userId = req.admin.username || req.admin.id || 'superadmin';
      const created = await multiEventService.createKegiatan({
        nama,
        tgl_mulai,
        tgl_selesai: tgl_selesai || tgl_mulai,
        jp: parseInt(jp, 10) || 2,
        wajib_lpti: Boolean(wajib_lpti),
        batas_unggah_lpti: batas_unggah_lpti || null,
        min_sesi_hadir: parseInt(min_sesi_hadir, 10) || 1,
        template_id: template_id || 'default_kemendikdasmen',
        format_nomor: format_nomor || '{counter}/C6.26/Sertifikat/KP.04.00/{tahun}'
      }, userId);

      res.json({ success: true, message: 'Kegiatan berhasil ditambahkan!', kegiatan: created });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal menambahkan kegiatan: ' + err.message });
    }
  });

  // 5. API: Perbarui Kegiatan
  router.put('/api/admin/kegiatan/:id', requireAdminAuth, async (req, res) => {
    try {
      const userId = req.admin.username || req.admin.id || 'superadmin';
      const updated = await multiEventService.updateKegiatan(req.params.id, req.body, userId);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Kegiatan tidak ditemukan.' });
      }
      res.json({ success: true, message: 'Kegiatan berhasil diperbarui!', kegiatan: updated });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memperbarui kegiatan: ' + err.message });
    }
  });

  // 6. API: Tambah Sesi ke Kegiatan
  router.post('/api/admin/kegiatan/:id/sesi', requireAdminAuth, async (req, res) => {
    try {
      const { nama, tanggal } = req.body;
      const userId = req.admin.username || req.admin.id || 'superadmin';
      const sesi = await multiEventService.addSesi(req.params.id, { nama, tanggal }, userId);
      res.json({ success: true, message: 'Sesi berhasil ditambahkan!', sesi });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal menambahkan sesi: ' + err.message });
    }
  });

  // 7. API: Hapus Sesi dari Kegiatan
  router.delete('/api/admin/kegiatan/:id/sesi/:sesiId', requireAdminAuth, async (req, res) => {
    try {
      const userId = req.admin.username || req.admin.id || 'superadmin';
      const deleted = await multiEventService.deleteSesi(req.params.sesiId, userId);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan.' });
      }
      res.json({ success: true, message: 'Sesi berhasil dihapus!', sesi: deleted });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal menghapus sesi: ' + err.message });
    }
  });

  return router;
}

module.exports = { createKegiatanRouter };
