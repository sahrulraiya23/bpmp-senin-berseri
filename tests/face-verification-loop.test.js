const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DB_DRIVER = 'supabase';
process.env.SESSION_SECRET = 'test-secret-key-2026';
process.env.ADMIN_PASSWORD = 'Bpmp2026!';

const app = require('../server.js');
const db = require('../supabase-adapter.js');

// Helper to send HTTP requests to test server
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const reqOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (body) {
      if (!reqOptions.headers['Content-Type']) {
        reqOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// Mock Supabase Store to verify cloud database behavior
function createMockSupabase() {
  const employeesTable = [
    {
      id: 'BPMP-TEST-01',
      nip: '199508232024011001',
      name: 'Muhammad Saharullah Raiya',
      password: 'bpmp123',
      panggol: 'Penata Muda, III/a',
      jabatan: 'Pranata Komputer / Pengembang Sistem',
      instansi: 'BPMP Provinsi Sulawesi Tenggara',
      pendidikan: 'S1',
      event_id: 'EVT-001',
      event_title: 'Pelatihan Transformasi Digital BPMP Sultra',
      attended: false,
      attended_at: null,
      accumulated_jp: 4,
      face_photo_url: null,
      face_descriptor: null,
      face_registered_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  const storageFiles = {};
  const certificatesTable = [];
  const attendancesTable = [];
  const qrTokensTable = [];

  return {
    _employees: employeesTable,
    _storageFiles: storageFiles,
    _certificates: certificatesTable,
    _attendances: attendancesTable,
    _qrTokens: qrTokensTable,
    from(tableName) {
      if (tableName === 'employees') {
        let filterEqId = null;
        let filterOr = null;
        let updateData = null;

        const queryObj = {
          select(fields) {
            return this;
          },
          order(col, opts) {
            return this;
          },
          limit(n) {
            return this;
          },
          eq(col, val) {
            if (col === 'id') filterEqId = val;
            return this;
          },
          or(orExpr) {
            filterOr = orExpr;
            return this;
          },
          update(data) {
            updateData = data;
            return this;
          },
          single() {
            return this.maybeSingle();
          },
          async maybeSingle() {
            let row = null;
            if (filterEqId) {
              row = employeesTable.find(e => e.id === filterEqId);
            } else if (filterOr) {
              const match = filterOr.match(/id\.eq\.([^,]+),nip\.eq\.([^,]+)/);
              if (match) {
                const targetId = match[1].replace(/"/g, '');
                const targetNip = match[2].replace(/"/g, '');
                row = employeesTable.find(e => e.id === targetId || e.nip === targetNip);
              }
            }

            if (updateData && row) {
              Object.assign(row, updateData);
              return { data: { ...row }, error: null };
            }

            return { data: row ? { ...row } : null, error: null };
          },
          then(resolve, reject) {
            let result = [...employeesTable];
            if (updateData && filterEqId) {
              const row = employeesTable.find(e => e.id === filterEqId);
              if (row) Object.assign(row, updateData);
              resolve({ data: row ? [{ ...row }] : [], error: null });
              return;
            }
            resolve({ data: result, error: null });
          }
        };

        return queryObj;
      }

      if (tableName === 'events') {
        return {
          select() { return this; },
          order() { return this; },
          limit() { return this; },
          eq() { return this; },
          update(data) { return this; },
          async maybeSingle() {
            return {
              data: {
                id: 'EVT-001',
                title: 'Pelatihan Transformasi Digital BPMP Sultra',
                jp: 4,
                active: true,
                status: 'active',
                current_qr_token: 'LPTI-TEST01',
                previous_qr_token: null
              },
              error: null
            };
          }
        };
      }

      if (tableName === 'admins') {
        return {
          select() { return this; },
          ilike() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: {
                id: 1,
                username: 'superadmin',
                name: 'Super Administrator BPMP Sultra',
                role: 'superadmin'
              },
              error: null
            };
          }
        };
      }

      if (tableName === 'certificates') {
        let filterOr = null;
        let upsertPayload = null;
        return {
          select() { return this; },
          order() { return this; },
          limit() { return this; },
          or(expr) { filterOr = expr; return this; },
          upsert(payload) {
            upsertPayload = payload;
            const existingIdx = certificatesTable.findIndex(c => c.id === payload.id);
            if (existingIdx >= 0) certificatesTable[existingIdx] = payload;
            else certificatesTable.push(payload);
            return this;
          },
          async maybeSingle() {
            if (filterOr) {
              const clean = filterOr.split(',')[0].replace('id.eq.', '').trim();
              const found = certificatesTable.find(c => c.id === clean || c.certificate_number === clean || c.nip === clean);
              return { data: found || null, error: null };
            }
            return { data: upsertPayload || certificatesTable[0] || null, error: null };
          }
        };
      }

      if (tableName === 'attendances') {
        return {
          select() { return this; },
          order() { return this; },
          async insert(payload) {
            attendancesTable.push(payload);
            return { data: payload, error: null };
          }
        };
      }

      if (tableName === 'qr_tokens') {
        return {
          select() { return this; },
          delete() { return this; },
          lt() { return this; },
          gte() { return this; },
          limit() { return this; },
          async insert(payload) {
            qrTokensTable.push(payload);
            return { data: payload, error: null };
          },
          async maybeSingle() {
            return { data: qrTokensTable[0] || null, error: null };
          }
        };
      }

      return {
        select() { return this; },
        ilike() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; }
      };
    },
    storage: {
      from(bucket) {
        return {
          async upload(fileName, buffer, opts) {
            if (bucket === 'fail-bucket') {
              return { data: null, error: new Error('Simulated Supabase storage bucket error') };
            }
            storageFiles[`${bucket}/${fileName}`] = buffer;
            return { data: { path: `${bucket}/${fileName}` }, error: null };
          },
          getPublicUrl(fileName) {
            return {
              data: {
                publicUrl: `https://test-project.supabase.co/storage/v1/object/public/${bucket}/${fileName}`
              }
            };
          }
        };
      }
    }
  };
}

test('SUITE: Perbaikan Bug Verifikasi Wajah, Presensi Supabase, & Pencegahan Loop', async (t) => {
  let server;
  let mockSupabase;

  t.before(async () => {
    mockSupabase = createMockSupabase();
    db.setSupabaseInstance(mockSupabase);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
  });

  t.after((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  await t.test('1. Login Pegawai membaca status profil awal dari database', async () => {
    const res = await makeRequest(server, {
      path: '/api/auth/login',
      method: 'POST'
    }, {
      nip: '199508232024011001',
      password: 'bpmp123'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.nip, '199508232024011001');
    assert.equal(res.body.employee.needsFaceRegistration, false, 'Fitur verifikasi wajah dinonaktifkan');
    assert.equal(res.body.redirectUrl, '/pegawai', 'Langsung ke portal pegawai');
  });

  await t.test('2. Registrasi Master Wajah berhasil mengunggah ke Supabase Storage dan memperbarui PostgreSQL', async () => {
    const dummyDescriptor = Array(128).fill(0.123);
    const dummyBase64Photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...';

    const res = await makeRequest(server, {
      path: '/api/employees/BPMP-TEST-01/register-face',
      method: 'POST'
    }, {
      faceDescriptor: dummyDescriptor,
      facePhoto: dummyBase64Photo
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.faceRegistered, true, 'Status faceRegistered bernilai true');
    assert.ok(res.body.employee.facePhotoUrl, 'facePhotoUrl terisi');

    // Pastikan di Supabase PostgreSQL juga terupdate
    const pgEmp = mockSupabase._employees.find(e => e.id === 'BPMP-TEST-01');
    assert.ok(pgEmp.face_photo_url, 'Kolom face_photo_url di PostgreSQL terisi');
    assert.ok(pgEmp.face_registered_at, 'Kolom face_registered_at di PostgreSQL terisi');
  });

  await t.test('3. Akses Dashboard Pegawai setelah registrasi membaca wajah dari Supabase dan TIDAK dialihkan loop', async () => {
    const res = await makeRequest(server, {
      path: '/api/auth/login',
      method: 'POST'
    }, {
      nip: '199508232024011001',
      password: 'bpmp123'
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.employee.faceRegistered, true, 'Harus true dari Supabase');
    assert.equal(res.body.employee.needsFaceRegistration, false, 'TIDAK butuh registrasi lagi!');
    assert.equal(res.body.redirectUrl, '/pegawai', 'TIDAK dialihkan ke /verif-wajah lagi');
  });

  await t.test('4. Presensi aula mencatat status HADIR ke Supabase dan terbaca di daftar Pegawai Admin', async () => {
    const qrRes = await makeRequest(server, {
      path: '/api/qr/current',
      method: 'GET'
    });
    assert.equal(qrRes.status, 200);
    const token = qrRes.body.token;
    assert.ok(token, 'Token QR diterbitkan');

    const attendRes = await makeRequest(server, {
      path: '/api/presensi/verify-token',
      method: 'POST'
    }, {
      employeeId: 'BPMP-TEST-01',
      token: token,
      eventId: 'EVT-001',
      attendancePhoto: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'
    });

    assert.equal(attendRes.status, 200);
    assert.equal(attendRes.body.success, true);
    assert.equal(attendRes.body.employee.attended, true, 'Pegawai tercatat hadir');

    // Verifikasi bahwa status di Supabase PostgreSQL bernilai attended: true
    const pgEmp = mockSupabase._employees.find(e => e.id === 'BPMP-TEST-01');
    assert.equal(pgEmp.attended, true, 'PostgreSQL mencatat attended = true');
  });

  await t.test('5. Penanganan Error Upload Storage: jika Storage gagal, kembalikan HTTP 502 dan JANGAN klaim berhasil', async () => {
    const originalFrom = mockSupabase.storage.from;
    mockSupabase.storage.from = () => ({
      async upload() {
        return { data: null, error: new Error('Koneksi storage timeout atau bucket tidak diizinkan') };
      }
    });

    const res = await makeRequest(server, {
      path: '/api/employees/BPMP-TEST-01/register-face',
      method: 'POST'
    }, {
      faceDescriptor: [0.1, 0.2],
      facePhoto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    });

    assert.equal(res.status, 502, 'Mengembalikan status 502 saat storage gagal');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Gagal mengunggah berkas ke Supabase Storage/);

    mockSupabase.storage.from = originalFrom;
  });

  await t.test('6. Pencegahan Failover Diam-Diam di Lingkungan Vercel/Produksi', async () => {
    const prevVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = '1';
      db.setSupabaseInstance(null);

      await assert.rejects(
        async () => {
          await db.getEmployeeByIdOrNip('199508232024011001');
        },
        /Supabase Cloud Database tidak terkonfigurasi/
      );
    } finally {
      process.env.VERCEL = prevVercel;
      db.setSupabaseInstance(mockSupabase);
    }
  });

  await t.test('7. Endpoint Diagnostik Khusus Admin (/api/admin/diagnostik)', async () => {
    const unauthRes = await makeRequest(server, {
      path: '/api/admin/diagnostik',
      method: 'GET'
    });
    assert.equal(unauthRes.status, 401);

    const loginAdminRes = await makeRequest(server, {
      path: '/api/auth/admin-login',
      method: 'POST'
    }, {
      username: 'superadmin',
      password: 'Bpmp2026!'
    });
    assert.equal(loginAdminRes.status, 200);
    const adminToken = loginAdminRes.body.token;

    const diagRes = await makeRequest(server, {
      path: '/api/admin/diagnostik?nip=199508232024011001',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });

    assert.equal(diagRes.status, 200);
    assert.equal(diagRes.body.success, true);
    assert.equal(diagRes.body.environment.storageMode, 'supabase');
    assert.equal(typeof diagRes.body.envStatus.SUPABASE_URL, 'boolean');
    assert.equal(typeof diagRes.body.envStatus.SUPABASE_KEY, 'boolean');
    assert.equal(typeof diagRes.body.envStatus.SESSION_SECRET, 'boolean');
    assert.ok(diagRes.body.employeeStatus);
    assert.equal(diagRes.body.employeeStatus.nip, '199508232024011001');
    assert.equal(diagRes.body.employeeStatus.faceRegistered, true);
    assert.equal(diagRes.body.employeeStatus.attended, true);
  });

  await t.test('8. Persistensi Tabel Sertifikat & Log Presensi di Supabase', async () => {
    // 8a. Simpan Sertifikat Resmi ke tabel certificates di Supabase
    const certSaveResult = await db.saveCertificate({
      id: 'SUPA-CERT-TEST-99',
      number: '800.1.3/SERT-LPTI/2026/099',
      employeeId: 'BPMP-TEST-01',
      nip: '199508232024011001',
      name: 'Muhammad Saharullah Raiya',
      eventId: 'EVT-001',
      eventTitle: 'Pelatihan Transformasi Digital BPMP Sultra',
      issuedAt: new Date().toISOString(),
      verifier: 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      cryptoHash: 'hash-test-sha256',
      cryptoSignature: 'sig-test-ecdsa'
    });
    assert.equal(certSaveResult, true);

    // 8b. Verifikasi sertifikat dapat ditemukan via query pangkalan data
    const foundCert = await db.getCertificateByIdOrNumber('SUPA-CERT-TEST-99');
    assert.ok(foundCert);
    assert.equal(foundCert.id, 'SUPA-CERT-TEST-99');
    assert.equal(foundCert.certificate_number, '800.1.3/SERT-LPTI/2026/099');

    // 8c. Verifikasi endpoint publik membaca dari tabel database certificates
    const verifyApiRes = await makeRequest(server, {
      path: '/api/verify-certificate-data/SUPA-CERT-TEST-99',
      method: 'GET'
    });
    assert.equal(verifyApiRes.status, 200);
    assert.equal(verifyApiRes.body.success, true);
    assert.equal(verifyApiRes.body.certificate.certId, 'SUPA-CERT-TEST-99');
    assert.equal(verifyApiRes.body.certificate.number, '800.1.3/SERT-LPTI/2026/099');
  });
});
