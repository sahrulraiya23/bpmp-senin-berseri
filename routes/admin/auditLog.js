/**
 * Router & Controller: Audit Log Sistem ASN BPMP Sultra
 * Menyediakan jejak rekam mutasi data, hanya dapat diakses oleh peran superadmin.
 */

const express = require('express');
const path = require('path');

function createAuditLogRouter(multiEventService, helpers = {}) {
  const router = express.Router();
  const { getAdminFromToken, PUBLIC_DIR } = helpers;

  // Middleware autentikasi khusus superadmin
  function requireSuperadminAuth(req, res, next) {
    if (!getAdminFromToken) return next();
    const admin = getAdminFromToken(req.headers.authorization, req.headers.cookie);
    const peran = admin ? (admin.role || admin.peran) : '';
    if (!admin || peran !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak: Hanya Superadmin yang berwenang membuka Audit Log.' });
    }
    req.admin = admin;
    next();
  }

  // 1. Tampilan Halaman Admin Audit Log
  router.get('/admin/audit-log', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-audit-log.html'));
  });

  // 2. API: Membaca Audit Log dengan Filter
  router.get('/api/admin/audit-log', requireSuperadminAuth, async (req, res) => {
    try {
      const { user, aksi, startDate, endDate } = req.query;
      const result = await multiEventService.getAuditLogs({
        userId: user,
        aksi: aksi,
        startDate: startDate,
        endDate: endDate
      });
      res.json({ success: true, logs: result.logs, total: result.total });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat audit log: ' + err.message });
    }
  });

  return router;
}

module.exports = { createAuditLogRouter };
