const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const db = require('../supabase-adapter');

test('SUITE: Langkah (c) - Manajemen Akun Individu & Halaman Akun Admin', async (t) => {
  db.setSupabaseInstance(null); // Isolated in-memory fallback

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
    return { status: res.status, body };
  }

  // 1. Login superadmin untuk mendapatkan token otorisasi
  const superLogin = await makeRequest('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username: 'superadmin', password: process.env.SUPERADMIN_PASSWORD || 'Bpmp2026!' })
  });
  assert.equal(superLogin.status, 200);
  assert.ok(superLogin.body.token);
  const authHeaderSuper = `Bearer ${superLogin.body.token}`;

  let createdStaffId = null;
  let tempPasswordCreated = null;

  await t.test('1. GET /api/admins - Superadmin membaca daftar akun admin & jumlah superadmin aktif', async () => {
    const res = await makeRequest('/api/admins?status=all', {
      headers: { Authorization: authHeaderSuper }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.admins));
    assert.ok(res.body.activeSuperadminCount >= 1);
  });

  await t.test('2. POST /api/admins - Superadmin menambahkan akun staf kepegawaian baru dengan sandi sekali pakai', async () => {
    const res = await makeRequest('/api/admins', {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({
        username: '199203152019031005',
        name: 'Budi Santoso, S.Sos.',
        peran: 'kepegawaian'
      })
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.tempPassword, 'Harus menghasilkan sandi acak sekali pakai');
    assert.equal(res.body.admin.peran, 'kepegawaian');
    assert.equal(res.body.admin.wajib_ganti_password, true);

    createdStaffId = res.body.admin.id;
    tempPasswordCreated = res.body.tempPassword;
  });

  await t.test('3. Login staf baru menggunakan sandi sekali pakai dan mendeteksi wajib_ganti_password', async () => {
    const res = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: tempPasswordCreated
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.admin.wajib_ganti_password, true);
    assert.equal(res.body.admin.name, 'Budi Santoso, S.Sos.');
  });

  let staffToken = null;
  await t.test('4. POST /api/auth/admin-change-password - Staf mengganti sandi mandiri', async () => {
    const loginRes = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: tempPasswordCreated
      })
    });
    staffToken = `Bearer ${loginRes.body.token}`;

    const changeRes = await makeRequest('/api/auth/admin-change-password', {
      method: 'POST',
      headers: { Authorization: staffToken },
      body: JSON.stringify({
        oldPassword: tempPasswordCreated,
        newPassword: 'PasswordBaruBudi2026!'
      })
    });
    assert.equal(changeRes.status, 200);
    assert.equal(changeRes.body.success, true);

    // Login dengan sandi lama harus ditolak
    const failLogin = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: tempPasswordCreated
      })
    });
    assert.equal(failLogin.status, 401);

    // Login dengan sandi baru harus berhasil & wajib_ganti_password sudah false
    const successLogin = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: 'PasswordBaruBudi2026!'
      })
    });
    assert.equal(successLogin.status, 200);
    assert.equal(successLogin.body.admin.wajib_ganti_password, false);
  });

  await t.test('5. POST /api/admins/:id/toggle-active - Menonaktifkan akun staf & tolak login akun nonaktif', async () => {
    // Nonaktifkan akun Budi
    const resToggle = await makeRequest(`/api/admins/${createdStaffId}/toggle-active`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({ aktif: false })
    });
    assert.equal(resToggle.status, 200);
    assert.equal(resToggle.body.admin.aktif, false);

    // Coba login akun Budi yang sudah nonaktif -> harus ditolak HTTP 403
    const resBlocked = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: 'PasswordBaruBudi2026!'
      })
    });
    assert.equal(resBlocked.status, 403);
    assert.equal(resBlocked.body.inactive, true);
  });

  await t.test('6. POST /api/admins/:id/toggle-active - Mengaktifkan kembali akun staf', async () => {
    const resToggle = await makeRequest(`/api/admins/${createdStaffId}/toggle-active`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({ aktif: true })
    });
    assert.equal(resToggle.status, 200);
    assert.equal(resToggle.body.admin.aktif, true);

    // Sekarang akun bisa login kembali
    const resLogin = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: 'PasswordBaruBudi2026!'
      })
    });
    assert.equal(resLogin.status, 200);
  });

  await t.test('7. POST /api/admins/:id/reset-password - Superadmin mereset sandi staf ke sandi baru sekali pakai', async () => {
    const resReset = await makeRequest(`/api/admins/${createdStaffId}/reset-password`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper }
    });
    assert.equal(resReset.status, 200);
    assert.ok(resReset.body.tempPassword);
    assert.equal(resReset.body.admin.wajib_ganti_password, true);

    // Login dengan sandi sementara baru
    const resLoginTemp = await makeRequest('/api/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({
        username: '199203152019031005',
        password: resReset.body.tempPassword
      })
    });
    assert.equal(resLoginTemp.status, 200);
    assert.equal(resLoginTemp.body.admin.wajib_ganti_password, true);
  });

  await t.test('8. Pencegahan Mutlak: Menolak penonaktifan Superadmin aktif terakhir', async () => {
    // Cari id superadmin
    const listRes = await makeRequest('/api/admins?status=all', {
      headers: { Authorization: authHeaderSuper }
    });
    const superAdminAcc = listRes.body.admins.find(a => a.peran === 'superadmin' || a.role === 'superadmin');
    assert.ok(superAdminAcc);

    const resTryDeactivate = await makeRequest(`/api/admins/${superAdminAcc.id}/toggle-active`, {
      method: 'POST',
      headers: { Authorization: authHeaderSuper },
      body: JSON.stringify({ aktif: false })
    });
    assert.equal(resTryDeactivate.status, 400);
    assert.match(resTryDeactivate.body.message, /terakhir/i);
  });

  await t.test('9. Audit Log: Seluruh aktivitas manajemen akun tercatat di log aktivitas', async () => {
    const logs = await db.getActivityLogs(20);
    assert.ok(logs.length >= 3);
    const actions = logs.map(l => l.aksi);
    assert.ok(actions.includes('tambah_admin'));
    assert.ok(actions.includes('nonaktifkan_admin') || actions.includes('aktifkan_admin'));
    assert.ok(actions.includes('reset_password_admin'));
  });

  await new Promise((resolve) => server.close(resolve));
});
