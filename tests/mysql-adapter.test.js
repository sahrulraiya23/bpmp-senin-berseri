const test = require('node:test');
const assert = require('node:assert/strict');

const mysqlAdapter = require('../mysql-adapter.js');

test('SUITE: Pengujian MySQL Adapter untuk Senin Berseri', async (t) => {
  // Mock MySQL Pool
  function createMockPool() {
    const employees = [
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
        attended: 0,
        attended_at: null,
        accumulated_jp: 4,
        face_photo_url: null,
        face_descriptor: null,
        face_registered_at: null,
        attendance_photo_url: null,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    const files = [];
    const attendances = [];
    const qrTokens = [];
    const certificates = [];

    return {
      _employees: employees,
      _files: files,
      _attendances: attendances,
      _qrTokens: qrTokens,
      _certificates: certificates,
      async execute(sql, params) {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT * FROM EMPLOYEES WHERE ID = ? OR NIP = ?')) {
          const val = params[0];
          const emp = employees.find(e => e.id === val || e.nip === val);
          return [emp ? [emp] : []];
        }

        if (sqlUpper.includes('UPDATE EMPLOYEES SET') && sqlUpper.includes('ATTENDED = 1')) {
          const empId = params[params.length - 1];
          const emp = employees.find(e => e.id === empId);
          if (emp) {
            emp.attended = 1;
            emp.attended_at = params[0];
            emp.event_id = params[1];
            emp.event_title = params[2];
            emp.accumulated_jp = params[3];
          }
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('INSERT INTO ATTENDANCES')) {
          attendances.push({
            employee_id: params[0],
            nip: params[1],
            name: params[2],
            event_id: params[3],
            event_title: params[4],
            qr_token: params[5],
            attendance_photo_url: params[6],
            attended_at: params[7]
          });
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('INSERT INTO QR_TOKENS')) {
          qrTokens.push({
            event_id: params[0],
            token: params[1],
            valid_until: params[2]
          });
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('UPDATE EVENTS SET CURRENT_QR_TOKEN')) {
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('INSERT INTO CERTIFICATES')) {
          certificates.push({
            id: params[0],
            certificate_number: params[1],
            employee_id: params[2],
            nip: params[3],
            name: params[4],
            event_id: params[5],
            event_title: params[6],
            issued_at: params[7],
            verifier: params[8],
            verifier_title: params[9],
            pdf_url: params[10],
            crypto_hash: params[11],
            crypto_signature: params[12]
          });
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('UPDATE EMPLOYEES SET') && sqlUpper.includes('FACE_PHOTO_URL = ?')) {
          const empId = params[params.length - 1];
          const emp = employees.find(e => e.id === empId);
          if (emp) {
            emp.face_photo_url = params[0];
            emp.face_descriptor = params[1];
            emp.face_registered_at = params[2];
          }
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('INSERT INTO FILES')) {
          files.push({
            id: params[0],
            bucket: params[1],
            file_name: params[2],
            content_type: params[3],
            file_data: params[4]
          });
          return [{ affectedRows: 1 }];
        }

        if (sqlUpper.includes('SELECT FILE_NAME, CONTENT_TYPE, FILE_DATA FROM FILES')) {
          const bucket = params[0];
          const fileName = params[1];
          const file = files.find(f => f.bucket === bucket && f.file_name === fileName);
          return [file ? [file] : []];
        }

        if (sqlUpper.includes('SELECT * FROM ADMINS')) {
          return [[{
            id: 1,
            username: 'superadmin',
            name: 'Super Administrator BPMP Sultra',
            role: 'superadmin'
          }]];
        }

        return [[]];
      },
      async query(sql, params) {
        const sqlUpper = sql.toUpperCase();
        if (sqlUpper.includes('SELECT * FROM EMPLOYEES')) {
          return [employees];
        }
        if (sqlUpper.includes('COUNT(*) AS TOTAL FROM EMPLOYEES')) {
          return [[{ total: employees.length }]];
        }
        if (sqlUpper.includes('SELECT ID FROM QR_TOKENS')) {
          const evtId = params[0];
          const token = params[1];
          const match = qrTokens.find(q => (q.event_id === evtId || q.event_id === 'EVT-DEFAULT') && q.token === token);
          return [match ? [{ id: 1 }] : []];
        }
        if (sqlUpper.includes('SELECT * FROM CERTIFICATES')) {
          return [certificates];
        }
        if (sqlUpper.includes('SELECT * FROM ATTENDANCES')) {
          return [attendances];
        }
        return [[]];
      }
    };
  }

  let mockPool;
  t.before(() => {
    mockPool = createMockPool();
    mysqlAdapter.setPool(mockPool);
  });

  await t.test('1. Membaca profil pegawai dari MySQL via getEmployeeByIdOrNip', async () => {
    const emp = await mysqlAdapter.getEmployeeByIdOrNip('199508232024011001');
    assert.ok(emp);
    assert.equal(emp.nip, '199508232024011001');
    assert.equal(emp.attended, false);
    assert.equal(emp.faceRegistered, false);
  });

  await t.test('2. Registrasi Master Wajah menyimpan data biometrik ke MySQL', async () => {
    const dummyPhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const updated = await mysqlAdapter.registerEmployeeFace('199508232024011001', {
      facePhotoUrl: dummyPhoto,
      faceDescriptor: [0.1, 0.2, 0.3]
    });

    assert.ok(updated);
    assert.equal(updated.faceRegistered, true);
    assert.equal(updated.facePhotoUrl, dummyPhoto);

    // Verifikasi di state pool mock
    assert.equal(mockPool._employees[0].face_photo_url, dummyPhoto);
  });

  await t.test('3. Presensi aula mencatat attended: true di MySQL dan terbaca di getAllEmployees', async () => {
    const updated = await mysqlAdapter.markEmployeeAttended('199508232024011001', 'EVT-001', 'Senin Berseri', 4);
    assert.ok(updated);
    assert.equal(updated.attended, true);

    const all = await mysqlAdapter.getAllEmployees();
    const emp = all.find(e => e.nip === '199508232024011001');
    assert.ok(emp);
    assert.equal(emp.attended, true, 'Status pegawai tercatat HADIR di tabel admin');
  });

  await t.test('4. Penyimpanan berkas/dokumen langsung di MySQL (tabel files) tanpa bucket eksternal', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 dummy pdf data');
    const resultUrl = await mysqlAdapter.uploadToStorage('lpti', 'LPTI-TEST-01.pdf', pdfBuffer, 'application/pdf');

    assert.ok(resultUrl.startsWith('/api/files/lpti/'));

    // Verifikasi berkas tersimpan dan dapat diambil via getFile
    const fetched = await mysqlAdapter.getFile('lpti', 'LPTI-TEST-01.pdf');
    assert.ok(fetched);
    assert.equal(fetched.fileName, 'LPTI-TEST-01.pdf');
    assert.equal(fetched.contentType, 'application/pdf');
    assert.deepEqual(fetched.fileBuffer, pdfBuffer);
  });

  await t.test('5. Pencegahan silent failover di lingkungan Vercel/Produksi tanpa MySQL', async () => {
    const prevVercel = process.env.VERCEL;
    const prevDbUrl = process.env.DATABASE_URL;
    const prevHost = process.env.MYSQL_HOST;
    try {
      process.env.VERCEL = '1';
      delete process.env.DATABASE_URL;
      delete process.env.MYSQL_HOST;
      mysqlAdapter.setPool(null);

      await assert.rejects(
        async () => {
          await mysqlAdapter.getEmployeeByIdOrNip('199508232024011001');
        },
        /MySQL Database tidak terkonfigurasi di Vercel\/Produksi/
      );
    } finally {
      process.env.VERCEL = prevVercel;
      if (prevDbUrl) process.env.DATABASE_URL = prevDbUrl;
      if (prevHost) process.env.MYSQL_HOST = prevHost;
      mysqlAdapter.setPool(mockPool);
    }
  });

  await t.test('6. Persistensi QR Token, Riwayat Presensi, dan E-Sertifikat di MySQL', async () => {
    // A. Simpan dan Validasi QR Token di Database
    const savedQr = await mysqlAdapter.saveQrToken('EVT-001', 'LPTI-TEST99', new Date(Date.now() + 30000));
    assert.equal(savedQr, true);
    const isValid = await mysqlAdapter.isQrTokenValid('EVT-001', 'LPTI-TEST99');
    assert.equal(isValid, true);

    // B. Presensi menyimpan log ke tabel attendances
    await mysqlAdapter.markEmployeeAttended('199508232024011001', 'EVT-001', 'Senin Berseri', 4, null, 'LPTI-TEST99');
    const logs = await mysqlAdapter.getAttendanceLogs('EVT-001');
    assert.ok(logs.length > 0);
    assert.equal(logs[0].nip, '199508232024011001');

    // C. Simpan Sertifikat Resmi ke Database
    const certSaved = await mysqlAdapter.saveCertificate({
      id: 'CERT-HASH-123',
      number: '800.1.3/SERT-LPTI/2026/001',
      employeeId: 'EMP-001',
      nip: '199508232024011001',
      name: 'Pegawai Test',
      eventId: 'EVT-001',
      eventTitle: 'Pelatihan ASN',
      issuedAt: new Date().toISOString(),
      verifier: 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: 'Kepala BPMP',
      cryptoHash: 'sha256hash',
      cryptoSignature: 'ecdsasig'
    });
    assert.equal(certSaved, true);
    const allCerts = await mysqlAdapter.getAllCertificates();
    assert.ok(allCerts.length > 0);
    assert.equal(allCerts[0].id, 'CERT-HASH-123');
  });
});
