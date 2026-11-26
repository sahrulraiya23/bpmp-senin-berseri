const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const path = require('path');

const MultiEventService = require('../services/multiEventService');
const { createKegiatanRouter } = require('../routes/admin/kegiatan');
const { createAuditLogRouter } = require('../routes/admin/auditLog');
const { createPegawaiDetailRouter } = require('../routes/admin/pegawaiDetail');
const { createPesertaRouter } = require('../routes/peserta/pesertaRoutes');

describe('SUITE: FASE 3 & 3B - Rute Admin Multi-Event & Portal Peserta', () => {
  let app;
  let server;
  let port;
  let baseUrl;
  let service;
  let mockDb;

  const mockAdminSuper = { id: 1, username: 'superadmin', role: 'superadmin', peran: 'superadmin' };
  const mockAdminStaf = { id: 2, username: 'staf1', role: 'kepegawaian', peran: 'kepegawaian' };
  const mockPeserta = {
    id: 'emp_01',
    nip: '199508232024011001',
    name: 'Muhammad Saharullah Raiya',
    jabatan: 'Pranata Komputer',
    instansi: 'BPMP Provinsi Sulawesi Tenggara'
  };

  before(async () => {
    mockDb = {
      _memoryStore: {
        employees: [mockPeserta],
        kegiatan: [],
        sesi_kegiatan: [],
        peserta_kegiatan: [],
        presensi: [],
        lpti: [],
        lpti_berkas: [],
        lpti_riwayat: [],
        sertifikat: [],
        audit_log: []
      },
      getAllEmployees: async () => [mockPeserta],
      getEmployeeByIdOrNip: async (idOrNip) => {
        if (idOrNip === mockPeserta.id || idOrNip === mockPeserta.nip) return mockPeserta;
        return null;
      }
    };

    service = new MultiEventService(mockDb);
    await service.init();

    app = express();
    app.use(express.json());

    const helpersAdmin = {
      getAdminFromToken: (auth, cookie) => {
        if (cookie && cookie.includes('role=superadmin')) return mockAdminSuper;
        if (cookie && cookie.includes('role=staf')) return mockAdminStaf;
        return null;
      },
      PUBLIC_DIR: path.join(__dirname, '..', 'public')
    };

    const helpersPeserta = {
      getEmployeeFromRequest: (req) => {
        if (req.headers['x-employee-nip']) return req.headers['x-employee-nip'];
        const cookie = req.headers.cookie || '';
        if (cookie.includes('employee_session=')) return mockPeserta.nip;
        return null;
      },
      PUBLIC_DIR: path.join(__dirname, '..', 'public'),
      UPLOAD_DIR: path.join(__dirname, '..', 'uploads', 'lpti')
    };

    app.use(createKegiatanRouter(service, helpersAdmin));
    app.use(createAuditLogRouter(service, helpersAdmin));
    app.use(createPegawaiDetailRouter(service, helpersAdmin));
    app.use(createPesertaRouter(service, mockDb, helpersPeserta));

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('1. Admin: GET /api/admin/kegiatan memerlukan autentikasi admin', async () => {
    const res = await fetch(`${baseUrl}/api/admin/kegiatan`);
    assert.equal(res.status, 401);
  });

  test('2. Admin: GET /api/admin/kegiatan mengembalikan daftar kegiatan jika terautentikasi', async () => {
    const res = await fetch(`${baseUrl}/api/admin/kegiatan`, {
      headers: { cookie: 'role=staf' }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.kegiatan));
    assert.ok(data.kegiatan.length >= 1);
  });

  test('3. Admin: POST /api/admin/kegiatan menambah kegiatan baru dan tercatat di audit_log', async () => {
    const newKeg = {
      nama: 'Pelatihan Kurikulum Merdeka 2026',
      tgl_mulai: '2026-06-01',
      tgl_selesai: '2026-06-03',
      jp: 8,
      wajib_lpti: true,
      min_sesi_hadir: 2
    };

    const res = await fetch(`${baseUrl}/api/admin/kegiatan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: 'role=superadmin'
      },
      body: JSON.stringify(newKeg)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.kegiatan.nama, newKeg.nama);
    assert.equal(data.kegiatan.jp, 8);

    // Cek Audit Log
    const auditResult = await service.getAuditLogs({ aksi: 'CREATE_KEGIATAN' });
    assert.ok(auditResult.logs.length >= 1);
  });

  test('4. Superadmin: GET /api/admin/audit-log tolak staf biasa dan izinkan superadmin', async () => {
    // Staf biasa ditolak 403
    const resStaf = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { cookie: 'role=staf' }
    });
    assert.equal(resStaf.status, 403);

    // Superadmin diizinkan 200
    const resSuper = await fetch(`${baseUrl}/api/admin/audit-log`, {
      headers: { cookie: 'role=superadmin' }
    });
    assert.equal(resSuper.status, 200);
    const data = await resSuper.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.logs));
  });

  test('5. Admin: GET /api/admin/pegawai/:id/history mengembalikan riwayat pelatihan read-only', async () => {
    const res = await fetch(`${baseUrl}/api/admin/pegawai/${mockPeserta.nip}/history`, {
      headers: { cookie: 'role=staf' }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.pegawai.nip, mockPeserta.nip);
    assert.ok(data.ringkasan);
    assert.ok(Array.isArray(data.kegiatan));
  });

  test('6. Peserta: GET /api/peserta/riwayat memerlukan sesi login peserta', async () => {
    const resNoAuth = await fetch(`${baseUrl}/api/peserta/riwayat`);
    assert.equal(resNoAuth.status, 401);

    const resAuth = await fetch(`${baseUrl}/api/peserta/riwayat`, {
      headers: { 'x-employee-nip': mockPeserta.nip }
    });
    assert.equal(resAuth.status, 200);
    const data = await resAuth.json();
    assert.equal(data.success, true);
    assert.equal(data.pegawai.nip, mockPeserta.nip);
    assert.ok(Array.isArray(data.kegiatan));
  });

  test('7. Peserta: GET /api/peserta/kegiatan/:id mengembalikan rincian sesi, LPTI dan kelayakan sertifikat', async () => {
    const allKeg = await service.getAllKegiatan();
    const targetId = allKeg[0].id;

    const res = await fetch(`${baseUrl}/api/peserta/kegiatan/${targetId}`, {
      headers: { 'x-employee-nip': mockPeserta.nip }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.kegiatan.id, targetId);
    assert.ok(Array.isArray(data.sesi));
    assert.ok(data.lpti);
    assert.ok(data.eligibility);
  });
});
