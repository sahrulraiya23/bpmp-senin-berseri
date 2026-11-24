const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../supabase-adapter');

test('SUITE: Langkah (b) - Endpoint Express Kurasi LPTI, Klaim, Heartbeat, & Pembatalan', async (t) => {
  db.setSupabaseInstance(null); // Isolated in-memory fallback

  // Pastikan server terimpor dan berjalan pada port dinamis
  const app = require('../server');
  const server = http.createServer(app);
  
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Helper HTTP request
  async function makeRequest(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  // Token admin testing
  const { signAdminToken } = require('../server');
  // Generate admin tokens
  const tokenKepegawaian1 = 'admin_staf1_token';
  const tokenKepegawaian2 = 'admin_staf2_token';
  const tokenSuperadmin = 'superadmin_token';

  // Seed pegawai testing
  const empId = 'emp-endpoint-test-01';
  await db.createEmployee({
    id: empId,
    name: 'Andi Nurhaliza, S.Pd.',
    nip: '198805122014022001',
    jabatan: 'Analis Kepegawaian',
    instansi: 'BPMP Provinsi Sulawesi Tenggara'
  });

  await db.markEmployeeAttended(empId, true);
  await db.updateEmployee(empId, {
    lpti: {
      status: 'pending',
      versi: 1,
      fileName: 'LPTI-Andi.pdf',
      fileOriginalName: 'LPTI-Andi.pdf'
    }
  });

  // Login superadmin & staf kepegawaian untuk mendapatkan valid session
  const adminLogin1 = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD || 'Bpmp2026!' })
  });
  const authHeaderStaff1 = `Bearer ${adminLogin1.body.token}`;

  const superLogin = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'superadmin', password: process.env.SUPERADMIN_PASSWORD || 'SuperBpmp2026!' })
  });
  const authHeaderSuper = `Bearer ${superLogin.body.token}`;

  // Buat akun staf 2 untuk tes tabrakan klaim
  await db.createAdmin({
    username: 'staf2',
    password: 'Password123!',
    name: 'Rahmat Hidayat, S.Kom.',
    role: 'kepegawaian'
  });
  const adminLogin2 = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'staf2', password: 'Password123!' })
  });
  const authHeaderStaff2 = `Bearer ${adminLogin2.body.token}`;

  await t.test('1. POST /api/admin/lpti/:id/claim - Staf 1 mengklaim antrean LPTI', async () => {
    const res = await makeRequest(`/api/admin/lpti/${empId}/claim`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.diklaim_sampai);
  });

  await t.test('2. POST /api/admin/lpti/:id/claim - Staf 2 ditolak dengan HTTP 409 (ALREADY_CLAIMED)', async () => {
    const res = await makeRequest(`/api/admin/lpti/${empId}/claim`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff2 }
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'ALREADY_CLAIMED');
  });

  await t.test('3. POST /api/admin/lpti/:id/heartbeat - Perpanjang klaim 15 menit', async () => {
    const res = await makeRequest(`/api/admin/lpti/${empId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.claimed_until);
  });

  await t.test('4. POST /api/admin/lpti/:id/release - Melepas klaim', async () => {
    const res = await makeRequest(`/api/admin/lpti/${empId}/release`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  await t.test('5. POST /api/employees/:id/verify-lpti - Setujui LPTI & Optimistic Locking 409 pada versi lama', async () => {
    // 5a. Staf 1 menyetujui versi 1 -> 200 OK
    const resApprove = await makeRequest(`/api/employees/${empId}/verify-lpti`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 },
      body: JSON.stringify({ action: 'approve', versi: 1, catatan: 'LPTI telah diperiksa & sesuai standar.' })
    });
    assert.equal(resApprove.status, 200);
    assert.equal(resApprove.body.success, true);
    assert.equal(resApprove.body.employee.lpti.status, 'approved');

    // 5b. Staf 2 mencoba merevisi dengan versi 1 lama -> HTTP 409 Conflict!
    const resConflict = await makeRequest(`/api/employees/${empId}/verify-lpti`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff2 },
      body: JSON.stringify({ action: 'revise', versi: 1, revisionNote: 'Perlu revisi data' })
    });
    assert.equal(resConflict.status, 409);
    assert.equal(resConflict.body.success, false);
    assert.equal(resConflict.body.code, 'CONFLICT');
  });

  await t.test('6. POST /api/admin/lpti/:id/cancel-approval - Pembatalan persetujuan oleh Superadmin', async () => {
    // Staf biasa ditolak membatalkan -> 403 Forbidden
    const resForbidden = await makeRequest(`/api/admin/lpti/${empId}/cancel-approval`, {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 },
      body: JSON.stringify({ reason: 'Ingin batalkan' })
    });
    assert.equal(resForbidden.status, 403);

    // Superadmin tanpa alasan -> 400 Bad Request
    const resNoReason = await makeRequest(`/api/admin/lpti/${empId}/cancel-approval`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({ reason: '' })
    });
    assert.equal(resNoReason.status, 400);

    // Superadmin dengan alasan valid -> 200 OK
    const resSuccess = await makeRequest(`/api/admin/lpti/${empId}/cancel-approval`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({ reason: 'Ditemukan ketidaksesuaian laporan praktik baik' })
    });
    assert.equal(resSuccess.status, 200);
    assert.equal(resSuccess.body.success, true);
    assert.equal(resSuccess.body.employee.lpti.status, 'pending');
  });

  await t.test('7. GET /api/employees/:id/lpti-history - Riwayat timeline kurasi', async () => {
    const res = await makeRequest(`/api/employees/${empId}/lpti-history`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.history));
    assert.ok(res.body.history.length >= 4);

    const actions = res.body.history.map(h => h.aksi);
    assert.ok(actions.includes('diklaim'));
    assert.ok(actions.includes('dilepas'));
    assert.ok(actions.includes('disetujui'));
    assert.ok(actions.includes('persetujuan_dibatalkan'));
  });

  // Tutup test server
  await new Promise((resolve) => server.close(resolve));
});
