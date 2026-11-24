const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../supabase-adapter');

test('SUITE: Langkah (d)-(g) - Multi-Staff Kurasi LPTI, Bulk Approve, Queue Next Claim, & Log Aktivitas', async (t) => {
  db.setSupabaseInstance(null); // Isolated in-memory

  const app = require('../server');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

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
    return { status: res.status, body, rawText: () => res.text() };
  }

  // Login superadmin & staf kepegawaian
  const superLogin = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'superadmin', password: process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!' })
  });
  const authHeaderSuper = `Bearer ${superLogin.body.token}`;

  const staff1 = await db.createAdmin({
    username: 'staf_kurasi_1',
    name: 'Siti Aminah, S.Pd.',
    peran: 'kepegawaian',
    password: 'Password123!'
  });
  const staff1Login = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'staf_kurasi_1', password: 'Password123!' })
  });
  const authHeaderStaff1 = `Bearer ${staff1Login.body.token}`;

  // Seed data pegawai untuk pengujian
  const empA = 'emp-multi-a';
  const empB = 'emp-multi-b';
  const empC = 'emp-multi-c';

  await db.createEmployee({ id: empA, name: 'Ahmad Dahlan', nip: '198501012010011001' });
  await db.createEmployee({ id: empB, name: 'Bambang Soeprapto', nip: '198602022010021002' });
  await db.createEmployee({ id: empC, name: 'Citra Dewi', nip: '198703032010032003' });

  await db.markEmployeeAttended(empA, true);
  await db.markEmployeeAttended(empB, true);
  // empC dibiarkan belum hadir aula (attended: false)

  await db.updateEmployee(empA, { lpti: { status: 'pending', versi: 1, filePath: '/uploads/lpti-a.pdf' } });
  await db.updateEmployee(empB, { lpti: { status: 'pending', versi: 1, filePath: '/uploads/lpti-b.pdf' } });
  await db.updateEmployee(empC, { lpti: { status: 'pending', versi: 1, filePath: '/uploads/lpti-c.pdf' } });

  await t.test('1. POST /api/admin/lpti/next-unclaimed - Staf 1 mengambil antrean LPTI pertama yang tersedia', async () => {
    const res = await makeRequest('/api/admin/lpti/next-unclaimed', {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.employee);
    assert.equal(res.body.employee.id, empA);
    assert.ok(res.body.claim.diklaim_sampai || res.body.claim.claimed_until);
  });

  await t.test('2. POST /api/admin/lpti/next-unclaimed - Mengambil antrean kedua', async () => {
    const res = await makeRequest('/api/admin/lpti/next-unclaimed', {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.employee.id, empB);
  });

  await t.test('3. POST /api/admin/lpti/next-unclaimed - Jika tidak ada lagi antrean pending (empC belum hadir), return 404', async () => {
    const res = await makeRequest('/api/admin/lpti/next-unclaimed', {
      method: 'POST',
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NO_PENDING_LPTI');
  });

  await t.test('4. POST /api/admin/lpti/bulk-approve - Menyetujui LPTI secara massal dengan proteksi kehadiran aula', async () => {
    // Release klaim empA & empB terlebih dahulu
    await db.releaseLptiClaim(empA, staff1);
    await db.releaseLptiClaim(empB, staff1);

    const res = await makeRequest('/api/admin/lpti/bulk-approve', {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({
        employeeIds: [empA, empB, empC],
        catatan: 'Disetujui serentak rapat kepegawaian'
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.approvedCount, 2); // empA & empB
    assert.equal(res.body.skippedCount, 1);  // empC dilewati karena belum hadir
    assert.equal(res.body.skippedList[0].id, empC);
    assert.match(res.body.skippedList[0].reason, /hadir/i);
  });

  await t.test('5. GET /api/admin/activity-logs - Membaca riwayat audit log aktivitas', async () => {
    const res = await makeRequest('/api/admin/activity-logs?limit=50', {
      headers: { Authorization: authHeaderStaff1 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.logs));
    assert.ok(res.body.logs.length >= 1);
    assert.equal(res.body.logs[0].aksi, 'bulk_approve_lpti');
  });

  await t.test('6. GET /api/admin/activity-logs/export - Mengunduh CSV log aktivitas', async () => {
    const res = await fetch(`${baseUrl}/api/admin/activity-logs/export`, {
      headers: { Authorization: authHeaderSuper }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const text = await res.text();
    assert.ok(text.includes('Waktu (ISO)'));
    assert.ok(text.includes('Aksi'));
  });

  await new Promise((resolve) => server.close(resolve));
});
