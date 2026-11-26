/**
 * Router & Controller: Detail Riwayat Pelatihan Pegawai (Admin View)
 * Menyediakan tampilan linimasa pelatihan read-only untuk admin kepegawaian.
 */

const express = require('express');
const path = require('path');

function createPegawaiDetailRouter(multiEventService, helpers = {}) {
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

  // 1. Tampilan Halaman Detail Pegawai
  router.get('/admin/pegawai/:id', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-pegawai-detail.html'));
  });

  // 2. API: Data Riwayat Pegawai Lengkap
  router.get('/api/admin/pegawai/:id/history', requireAdminAuth, async (req, res) => {
    try {
      const history = await multiEventService.getEmployeeTrainingHistory(req.params.id);
      if (!history || !history.employee) {
        return res.status(404).json({ success: false, message: 'Data pegawai tidak ditemukan.' });
      }

      // Ambil juga audit log yang berelasi dengan pegawai ini
      const logsResult = await multiEventService.getAuditLogs({
        entitasId: String(history.employee.id)
      });

      res.json({
        success: true,
        pegawai: history.employee,
        ringkasan: history.summary,
        kegiatan: history.history,
        audit_logs: logsResult.logs
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat riwayat pegawai: ' + err.message });
    }
  });

  return router;
}

module.exports = { createPegawaiDetailRouter };
