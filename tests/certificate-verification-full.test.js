const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');

if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch (e) {}
}

const db = require('../supabase-adapter');
const certCrypto = require('../cert-crypto');
const certificateService = require('../services/certificate');

// Isolasi adapter lokal untuk unit test agar instan tanpa timeout jaringan
db.setSupabaseInstance(null);

test('SUITE: Pengujian Fitur Verifikasi E-Sertifikat & Data Dummy Dicoding-Style', async (t) => {

  // Pastikan server express berjalan
  let serverInstance;
  let testPort = 3009;
  let serverApp;

  await t.test('1. Setup Server & Port Khusus Testing', async () => {
    // Import server
    delete require.cache[require.resolve('../server')];
    serverApp = require('../server');
    
    await new Promise((resolve) => {
      serverInstance = serverApp.listen(testPort, () => {
        resolve();
      });
    });
    assert.ok(serverInstance, 'Server berhasil dijalankan pada port testing');
  });

  const requestJson = (path, options = {}) => {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${testPort}${path}`, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (_) { parsed = body; }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      req.end();
    });
  };

  await t.test('2. ID Kriptografis 12 Karakter Aman & Bebas Karakter Ambigu (0, O, 1, I)', () => {
    const id1 = certCrypto.generateRandomCertId();
    assert.equal(id1.length, 12, 'Panjang ID harus tepat 12 karakter');
    assert.match(id1, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/, 'Karakter harus dari alphabet bersih');
    assert.equal(id1.includes('0'), false, 'Tidak boleh ada angka 0');
    assert.equal(id1.includes('O'), false, 'Tidak boleh ada huruf O');
    assert.equal(id1.includes('1'), false, 'Tidak boleh ada angka 1');
    assert.equal(id1.includes('I'), false, 'Tidak boleh ada huruf I');

    const testId = certCrypto.generateRandomCertId('TEST');
    assert.equal(testId.startsWith('TEST'), true, 'ID dummy harus berawalan TEST');
    assert.equal(testId.length, 12, 'Panjang ID dummy tetap 12 karakter');
  });

  await t.test('3. URL QR Menggunakan Domain Produksi Resmi (Bukan Preview Domain)', () => {
    const baseUrl = certCrypto.getProductionBaseUrl();
    assert.equal(baseUrl, 'https://bpmp-senin-berseri.vercel.app', 'Harus menggunakan domain produksi');
    assert.equal(baseUrl.includes('-git-'), false, 'Tidak boleh menggunakan git preview branch');
    assert.equal(baseUrl.includes('/preview'), false, 'Tidak boleh menggunakan preview deployment');
  });

  await t.test('4. Seed Dummy Data Idempotent & Eksekusi Simpan 6 Variasi Sertifikat', async () => {
    // Simpan dummy data
    await db.saveCertificate({
      id: 'TEST2VALD222',
      number: '0001/TEST/KP.04.00/2026',
      name: 'Budi Santoso, S.Pd.',
      nip: '198802022015022002',
      eventTitle: 'Pemanfaatan Platform Digital Kepegawaian ASN',
      status: 'valid',
      is_dummy: true
    });

    await db.saveCertificate({
      id: 'TEST6REVKD66',
      number: '0005/TEST/KP.04.00/2026',
      name: 'Dewi Sartika Putri, M.A.',
      nip: '199307082020122005',
      eventTitle: 'Strategi Komunikasi Efektif ASN',
      status: 'revoked',
      revoked_at: '2026-05-15T09:30:00.000Z',
      revocation_reason: 'Pembaruan data kompetensi dan penerbitan sertifikat revisi',
      is_dummy: true
    });

    // Jalankan simpan kedua kali dengan ID yang sama (Idempotent)
    await db.saveCertificate({
      id: 'TEST2VALD222',
      number: '0001/TEST/KP.04.00/2026',
      name: 'Budi Santoso, S.Pd.',
      nip: '198802022015022002',
      eventTitle: 'Pemanfaatan Platform Digital Kepegawaian ASN',
      status: 'valid',
      is_dummy: true
    });

    const cert1 = await db.getCertificateByIdOrNumber('TEST2VALD222');
    assert.ok(cert1, 'Sertifikat dummy 1 berhasil disimpan');
    assert.equal(cert1.status, 'valid');
    assert.equal(cert1.is_dummy, true);
  });

  await t.test('5. Verifikasi Publik: Sertifikat Valid Mengembalikan Data Bersih TANPA NIP', async () => {
    const res = await requestJson('/api/verify-certificate-data/TEST2VALD222');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.found, true);
    assert.equal(res.body.certificate.status, 'valid');
    assert.equal(res.body.certificate.recipientName, 'Budi Santoso, S.Pd.');
    assert.equal(res.body.certificate.isDummy, true, 'isDummy harus terdeteksi');
    assert.ok(res.body.certificate.previewUrl, 'Pratinjau PDF harus ada untuk yang valid');

    // KEAMANAN KRUSIAL: NIP TIDAK BOLEH DIKIRIM KE KLIEN PUBLIK
    assert.equal(res.body.certificate.nip, undefined, 'NIP tidak boleh diekspos');
    assert.equal(res.body.certificate.employeeNip, undefined, 'employeeNip tidak boleh diekspos');
  });

  await t.test('6. Verifikasi Publik: Sertifikat Dicabut (Revoked) Menampilkan Status & Alasan TANPA Pratinjau', async () => {
    const res = await requestJson('/api/verify-certificate-data/TEST6REVKD66');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.certificate.status, 'revoked');
    assert.ok(res.body.certificate.revokedAt, 'Harus mencantumkan tanggal pencabutan');
    assert.ok(res.body.certificate.revocationReason, 'Harus mencantumkan alasan pencabutan');
    assert.equal(res.body.certificate.previewUrl, null, 'Pratinjau PDF ditiadakan untuk sertifikat dicabut');
    assert.equal(res.body.certificate.pdfUrl, null, 'Berkas PDF ditiadakan untuk sertifikat dicabut');
  });

  await t.test('7. Anti-Enumerasi: ID Salah / Acak Mengembalikan 404 Pesan Seragam', async () => {
    // Kasus A: Format salah (misal terlalu pendek / mengandung 0 atau karakter ilegal)
    const resInvalidFormat = await requestJson('/api/verify-certificate-data/WRONG123');
    assert.equal(resInvalidFormat.status, 404);
    assert.equal(resInvalidFormat.body.success, false);
    assert.equal(resInvalidFormat.body.found, false);

    // Kasus B: Format 12 karakter benar tapi tidak terdaftar di database
    const resNotFound = await requestJson('/api/verify-certificate-data/ZZZZ9999XXXX');
    assert.equal(resNotFound.status, 404);
    assert.equal(resNotFound.body.success, false);
    assert.equal(resNotFound.body.found, false);

    // Pesan harus persis sama persis agar penyerang tidak dapat menebak ID yang ada vs tidak ada
    assert.equal(resInvalidFormat.body.message, resNotFound.body.message, 'Pesan penolakan harus seragam');
  });

  await t.test('8. Isolasi Data Dummy: Tidak Masuk ke KPI & Riwayat Sertifikat Resmi', async () => {
    const allOfficial = await db.getAllCertificates(false);
    const hasDummy = allOfficial.some(c => c.is_dummy || String(c.id).startsWith('TEST'));
    assert.equal(hasDummy, false, 'Sertifikat dummy tidak boleh terhitung di laporan resmi/KPI');

    const allWithDummy = await db.getAllCertificates(true);
    const foundDummy = allWithDummy.some(c => c.is_dummy || String(c.id).startsWith('TEST'));
    assert.equal(foundDummy, true, 'Sertifikat dummy tersedia jika dipanggil dengan flag true');
  });

  await t.test('9. Penghapusan Dummy Bersih via deleteDummyCertificates()', async () => {
    const delResult = await db.deleteDummyCertificates();
    assert.equal(delResult.success, true);

    const check = await db.getCertificateByIdOrNumber('TEST2VALD222');
    assert.equal(check, null, 'Sertifikat dummy harus terhapus bersih');
  });

  await t.test('10. Rate Limiter: Permintaan Berlebih Mengembalikan HTTP 429', async () => {
    let got429 = false;
    for (let i = 0; i < 45; i++) {
      const res = await requestJson('/api/verify-certificate-data/TEST1VALID01');
      if (res.status === 429) {
        got429 = true;
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Terlalu banyak permintaan'));
        break;
      }
    }
    assert.equal(got429, true, 'Rate limiter harus memicu HTTP 429 jika melebihi kuota per menit');
  });

  await t.test('11. Cleanup Server Testing', async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  });

});
