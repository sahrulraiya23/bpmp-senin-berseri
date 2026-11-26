/**
 * Router & Controller: Verifikasi LPTI ASN BPMP Sulawesi Tenggara
 * Menangani antrean kurasi, kunci klaim 15 menit atomik, persetujuan, revisi, dan riwayat audit.
 */

const express = require('express');
const path = require('path');

function createVerifikasiLptiRouter(db, helpers = {}) {
  const router = express.Router();
  const { getAdminFromToken, isAuthorizedLptiVerifier, multiEventService, PUBLIC_DIR } = helpers;

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

  // 1. Tampilan Web Halaman Verifikasi LPTI
  router.get('/admin/verifikasi-lpti', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-verifikasi-lpti.html'));
  });

  // 2. API JSON Data Daftar LPTI (Filter per Kegiatan, Kategori, Search, & Pagination)
  router.get('/api/admin/verifikasi-lpti', async (req, res) => {
    try {
      const filter = (req.query.filter || 'all').toLowerCase(); // 'all', 'pending', 'approved', 'revision'
      const search = (req.query.search || '').trim().toLowerCase();
      const targetNip = (req.query.nip || '').trim();
      const selectedKegiatanId = req.query.kegiatanId || req.query.eventId || null;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 25));

      const allEmployees = await db.getAllEmployees();
      const nowTs = Date.now();

      // Daftar Kegiatan Pelatihan
      let allKegiatan = [];
      if (multiEventService) {
        allKegiatan = await multiEventService.getAllKegiatan();
      } else if (typeof db.getAllEvents === 'function') {
        allKegiatan = await db.getAllEvents();
      }

      let activeKegiatan = null;
      if (selectedKegiatanId && selectedKegiatanId !== 'all') {
        activeKegiatan = (allKegiatan || []).find(k => String(k.id) === String(selectedKegiatanId));
      }
      if (!activeKegiatan && (allKegiatan || []).length > 0) {
        activeKegiatan = allKegiatan[0];
      }

      // Ekstrak pegawai dan LPTI (mendukung pivot multi-event)
      let store = null;
      if (multiEventService) {
        store = multiEventService._getStore();
      }

      const mapped = allEmployees.map((emp, idx) => {
        let lptiStatus = 'none';
        let lptiData = {};
        let attended = Boolean(emp.attended);

        if (store && activeKegiatan) {
          const pk = store.peserta_kegiatan.find(x => x.kegiatan_id === activeKegiatan.id && x.pegawai_id === emp.id);
          if (pk) {
            const hasPres = store.presensi.some(p => p.peserta_kegiatan_id === pk.id);
            if (hasPres) attended = true;
            const l = store.lpti.find(x => x.peserta_kegiatan_id === pk.id);
            if (l) {
              const statusMap = {
                'belum_unggah': 'none',
                'perlu_dikurasi': 'pending',
                'disetujui': 'approved',
                'revisi': 'revision'
              };
              lptiStatus = statusMap[l.status] || l.status;
              const isClaimedLock = l.lock_until && new Date(l.lock_until).getTime() > nowTs;
              lptiData = {
                status: lptiStatus,
                fileName: l.berkas_aktif?.fileName || null,
                fileOriginalName: l.berkas_aktif?.fileOriginalName || null,
                filePath: l.berkas_aktif?.filePath || null,
                fileSize: l.berkas_aktif?.fileSize || null,
                uploadedAt: l.diajukan_at || null,
                versi: l.versi || 1,
                catatan: l.catatan || '',
                diputuskanOleh: l.diputuskan_oleh || null,
                diputuskanNama: l.diputuskan_nama || null,
                diputuskanPada: l.diputuskan_at || null,
                diklaimOleh: isClaimedLock ? l.lock_by : null,
                diklaimSampai: isClaimedLock ? l.lock_until : null,
                isLocked: isClaimedLock
              };
            }
          }
        }

        // Fallback ke profil emp jika multi-event belum ada berkas
        if (lptiStatus === 'none' && emp.lpti) {
          const legacyLpti = emp.lpti || {};
          const isLegacyClaimed = legacyLpti.diklaimOleh && legacyLpti.diklaimSampai && new Date(legacyLpti.diklaimSampai).getTime() > nowTs;
          lptiStatus = legacyLpti.status || 'none';
          lptiData = {
            status: lptiStatus,
            fileName: legacyLpti.fileName || legacyLpti.fileOriginalName || null,
            fileOriginalName: legacyLpti.fileOriginalName || legacyLpti.fileName || null,
            filePath: legacyLpti.filePath || null,
            fileSize: legacyLpti.fileSize || null,
            uploadedAt: legacyLpti.uploadedAt || null,
            versi: parseInt(legacyLpti.versi, 10) || 1,
            catatan: legacyLpti.catatan || legacyLpti.revisionNote || '',
            diputuskanOleh: legacyLpti.diputuskanOleh || null,
            diputuskanNama: legacyLpti.diputuskanNama || null,
            diputuskanPada: legacyLpti.diputuskanPada || null,
            diklaimOleh: isLegacyClaimed ? legacyLpti.diklaimOleh : null,
            diklaimSampai: isLegacyClaimed ? legacyLpti.diklaimSampai : null,
            isLocked: isLegacyClaimed
          };
        }

        return {
          id: emp.id,
          noUrut: idx + 1,
          name: emp.name,
          nip: emp.nip,
          jabatan: emp.jabatan || emp.position || 'Aparatur Sipil Negara',
          instansi: emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
          attended: attended,
          lpti: lptiData
        };
      });

      // Hitung counts kategori
      const countAll = mapped.length;
      const countPending = mapped.filter(e => e.lpti.status === 'pending').length;
      const countApproved = mapped.filter(e => e.lpti.status === 'approved').length;
      const countRevision = mapped.filter(e => e.lpti.status === 'revision').length;

      let filtered = mapped;

      // Filter berdasarkan NIP spesifik jika diarahkan dari Rekap Presensi
      if (targetNip) {
        filtered = filtered.filter(e => String(e.nip).toLowerCase() === targetNip.toLowerCase());
      } else {
        // Filter Tab Status
        if (filter === 'pending') {
          filtered = filtered.filter(e => e.lpti.status === 'pending');
        } else if (filter === 'approved') {
          filtered = filtered.filter(e => e.lpti.status === 'approved');
        } else if (filter === 'revision') {
          filtered = filtered.filter(e => e.lpti.status === 'revision');
        }

        // Pencarian Nama / NIP
        if (search) {
          filtered = filtered.filter(e => 
            String(e.name).toLowerCase().includes(search) ||
            String(e.nip).toLowerCase().includes(search) ||
            String(e.jabatan).toLowerCase().includes(search)
          );
        }
      }

      // Prioritas urutan: pending paling atas
      filtered.sort((a, b) => {
        if (a.lpti.status === 'pending' && b.lpti.status !== 'pending') return -1;
        if (a.lpti.status !== 'pending' && b.lpti.status === 'pending') return 1;
        return a.noUrut - b.noUrut;
      });

      const total = filtered.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      const paginated = filtered.slice(offset, offset + limit);

      const rows = paginated.map((r, i) => ({
        ...r,
        no: offset + i + 1
      }));

      res.json({
        success: true,
        kegiatanList: allKegiatan,
        activeKegiatan: activeKegiatan,
        wajib_lpti: activeKegiatan ? Boolean(activeKegiatan.wajib_lpti) : true,
        employees: rows,
        counts: {
          all: countAll,
          pending: countPending,
          approved: countApproved,
          revision: countRevision
        },
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      });
    } catch (err) {
      console.error('[Verifikasi LPTI API Error]:', err);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar LPTI: ' + err.message });
    }
  });

  // 3. Tombol "Ambil LPTI Berikutnya" (Atomic Claim Next Unclaimed)
  router.post('/api/admin/verifikasi-lpti/claim-next', requireAdminAuth, async (req, res) => {
    try {
      const admin = req.admin;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const targetKegiatanId = req.body?.kegiatanId || req.query?.kegiatanId;

      if (multiEventService && targetKegiatanId && targetKegiatanId !== 'all') {
        const claimRes = await multiEventService.claimNextLpti(targetKegiatanId, admin.id || admin.username);
        if (!claimRes) {
          return res.status(404).json({
            success: false,
            code: 'NO_PENDING_QUEUE',
            message: 'Semua berkas LPTI untuk kegiatan ini telah selesai diverifikasi atau sedang diperiksa staf lain.'
          });
        }
        return res.json({
          success: true,
          message: 'Berhasil mengambil LPTI antrean berikutnya! Berkas dikunci selama 15 menit.',
          lpti: claimRes.lpti,
          employee: claimRes.employee
        });
      }

      const result = await db.getNextUnclaimedLpti(admin);
      if (!result.success || !result.employee) {
        return res.status(404).json({
          success: false,
          code: 'NO_PENDING_QUEUE',
          message: 'Semua berkas LPTI saat ini telah selesai diverifikasi atau sedang diperiksa staf lain.'
        });
      }

      // Kunci selama 15 menit
      const claimResult = await db.claimLpti(result.employee.id, admin, clientIp, 15);
      if (!claimResult.success) {
        return res.status(409).json(claimResult);
      }

      const freshEmp = await db.getEmployeeByIdOrNip(result.employee.id);
      res.json({
        success: true,
        message: `Berkas LPTI milik ${freshEmp.name} berhasil diambil dan dikunci selama 15 menit.`,
        employee: freshEmp,
        claimed_until: claimResult.diklaim_sampai
      });
    } catch (err) {
      console.error('[Claim Next Error]:', err);
      res.status(500).json({ success: false, message: 'Gagal mengambil berkas LPTI berikutnya: ' + err.message });
    }
  });

  // 4. Klaim Berkas LPTI Pegawai Tertentu
  router.post('/api/admin/verifikasi-lpti/:id/claim', requireAdminAuth, async (req, res) => {
    try {
      const admin = req.admin;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

      const result = await db.claimLpti(req.params.id, admin, clientIp, 15);
      if (!result.success) {
        const statusCode = result.code === 'ALREADY_CLAIMED' ? 409 : 400;
        return res.status(statusCode).json(result);
      }

      const freshEmp = await db.getEmployeeByIdOrNip(req.params.id);
      res.json({
        success: true,
        message: 'Berkas LPTI berhasil diklaim untuk diperiksa selama 15 menit.',
        employee: freshEmp,
        ...result
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal mengklaim LPTI: ' + err.message });
    }
  });

  // 5. Lepas Klaim LPTI
  router.post('/api/admin/verifikasi-lpti/:id/release', requireAdminAuth, async (req, res) => {
    try {
      const admin = req.admin;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

      const result = await db.releaseLptiClaim(req.params.id, admin, clientIp);
      if (!result.success) {
        return res.status(403).json(result);
      }

      res.json({ success: true, message: 'Klaim LPTI berhasil dilepas.' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal melepas klaim LPTI: ' + err.message });
    }
  });

  // 6. Setujui Berkas LPTI (Persetujuan Satu Tahap)
  router.post('/api/admin/verifikasi-lpti/:id/approve', requireAdminAuth, async (req, res) => {
    try {
      const admin = req.admin;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const employee = await db.getEmployeeByIdOrNip(req.params.id);
      if (!employee) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });

      // Verifikasi presensi aula wajib hadir
      if (!employee.attended) {
        return res.status(400).json({
          success: false,
          code: 'ATTENDANCE_REQUIRED',
          message: 'Persetujuan Ditolak: Pegawai belum tercatat hadir secara fisik di aula. Verifikasi kehadiran terlebih dahulu.'
        });
      }

      const currentVersi = parseInt(employee.lpti?.versi, 10) || 1;
      const catatan = (req.body.catatan || 'LPTI memenuhi standar substansi materi pelatihan').trim();

      const result = await db.approveLpti(employee.id, admin, currentVersi, catatan, clientIp);
      if (!result.success) {
        const code = result.code === 'LOCK_CONFLICT' || result.code === 'ALREADY_DECIDED' ? 409 : 400;
        return res.status(code).json(result);
      }

      // Terbitkan sertifikat HANYA jika pegawai memenuhi syarat kelayakan (presensi aula terpenuhi)
      // Melalui multiEventService agar atomik, mencatat audit log, dan tidak membypass aturan kelayakan
      if (employee.attended && (!employee.certificate || !employee.certificate.number)) {
        if (multiEventService) {
          try {
            const activeEvt = (await db.getActiveEvent()) || {};
            const certRes = await multiEventService.issueOrGetCertificate(activeEvt.id || 'keg_default', employee.id, admin);
            if (certRes?.certificate) {
              await db.updateEmployee(employee.id, {
                certificate: {
                  number: certRes.certificate.nomor,
                  token: certRes.certificate.token_qr,
                  issuedAt: certRes.certificate.terbit_at,
                  status: 'valid'
                }
              });
            }
          } catch (certErr) {
            console.warn('[Verifikasi LPTI] Sertifikat belum dapat diterbitkan:', certErr.message);
          }
        } else {
          const activeEvent = await db.getActiveEvent();
          const seq = await db.getNextCertificateSequence();
          const year = new Date().getFullYear();
          const padSeq = String(seq).padStart(4, '0');
          const certNumber = `${padSeq}/C6.26/Sertifikat/KP.04.00/${year}`;

          await db.saveCertificate({
            employee_id: employee.id,
            event_id: activeEvent?.id || null,
            number: certNumber,
            status: 'valid',
            issued_at: new Date().toISOString()
          });

          await db.updateEmployee(employee.id, {
            certificate: {
              number: certNumber,
              issuedAt: new Date().toISOString(),
              status: 'valid'
            }
          });
        }
      }

      const updatedEmp = await db.getEmployeeByIdOrNip(employee.id);
      res.json({
        success: true,
        message: `Berkas LPTI milik ${employee.name} berhasil disetujui.`,
        employee: updatedEmp
      });
    } catch (err) {
      console.error('[Approve LPTI Error]:', err);
      res.status(500).json({ success: false, message: 'Gagal menyetujui LPTI: ' + err.message });
    }
  });

  // 7. Minta Revisi Berkas LPTI (Catatan Wajib)
  router.post('/api/admin/verifikasi-lpti/:id/revise', requireAdminAuth, async (req, res) => {
    try {
      const admin = req.admin;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const employee = await db.getEmployeeByIdOrNip(req.params.id);
      if (!employee) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });

      const catatan = (req.body.catatan || req.body.revisionNote || '').trim();
      if (!catatan || catatan.length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Catatan revisi wajib diisi dengan jelas (minimal 5 karakter) sebagai panduan perbaikan bagi pegawai.'
        });
      }

      const currentVersi = parseInt(employee.lpti?.versi, 10) || 1;
      const result = await db.reviseLpti(employee.id, admin, currentVersi, catatan, clientIp);
      if (!result.success) {
        const code = result.code === 'LOCK_CONFLICT' || result.code === 'ALREADY_DECIDED' ? 409 : 400;
        return res.status(code).json(result);
      }

      const updatedEmp = await db.getEmployeeByIdOrNip(employee.id);
      res.json({
        success: true,
        message: `Status LPTI milik ${employee.name} berhasil diubah menjadi Revisi.`,
        employee: updatedEmp
      });
    } catch (err) {
      console.error('[Revise LPTI Error]:', err);
      res.status(500).json({ success: false, message: 'Gagal merevisi LPTI: ' + err.message });
    }
  });

  // 8. Riwayat Timeline Kurasi LPTI (dari tabel lpti_riwayat)
  router.get('/api/admin/verifikasi-lpti/:id/history', async (req, res) => {
    try {
      const employee = await db.getEmployeeByIdOrNip(req.params.id);
      if (!employee) return res.status(404).json({ success: false, message: 'Pegawai tidak ditemukan.' });

      const history = await db.getLptiHistory(employee.id);
      res.json({
        success: true,
        employee: {
          id: employee.id,
          name: employee.name,
          nip: employee.nip,
          jabatan: employee.jabatan
        },
        history: history || []
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal memuat riwayat LPTI: ' + err.message });
    }
  });

  return router;
}

module.exports = createVerifikasiLptiRouter;
