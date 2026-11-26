const test = require('node:test');
const assert = require('node:assert/strict');

const supabaseAdapter = require('../supabase-adapter.js');
const MultiEventService = require('../services/multiEventService.js');

test('SUITE: FASE 1 & FASE 2 - Skema Baru Multi-Event, Aturan Sertifikat & Riwayat Bersama', async (t) => {
  const service = new MultiEventService(supabaseAdapter);
  await service.init();

  let testKegiatan;
  const testNip = '199508232024011001'; // Muhammad Saharullah Raiya

  await t.test('1. Skema & Inisialisasi: Kegiatan default dan migrasi data awal tersedia', async () => {
    const listKeg = await service.getAllKegiatan();
    assert.ok(Array.isArray(listKeg));
    assert.ok(listKeg.length >= 1);

    const defaultKeg = listKeg.find(k => k.id === 'EVT-2026-001');
    assert.ok(defaultKeg);
    assert.equal(defaultKeg.nama, 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN BPMP Sultra');
    assert.equal(defaultKeg.wajib_lpti, 1);
  });

  await t.test('2. CRUD Kegiatan & Audit Log: Membuat kegiatan baru mencatat ke audit_log', async () => {
    testKegiatan = await service.createKegiatan({
      nama: 'Bimtek Pengelolaan Kinerja ASN 2026',
      tgl_mulai: '2026-12-01',
      tgl_selesai: '2026-12-02',
      jp: 4,
      wajib_lpti: 1,
      min_sesi_hadir: 2,
      template_id: 'preset-a',
      format_nomor: '002{counter}/C6.26/Sertifikat/KP.04.00/{tahun}'
    }, 'superadmin');

    assert.ok(testKegiatan);
    assert.equal(testKegiatan.nama, 'Bimtek Pengelolaan Kinerja ASN 2026');
    assert.equal(testKegiatan.min_sesi_hadir, 2);

    const auditLogs = await service.getAuditLogs({ entitas: 'kegiatan', entitasId: testKegiatan.id });
    assert.ok(auditLogs.logs.length >= 1);
    assert.equal(auditLogs.logs[0].aksi, 'CREATE_KEGIATAN');
  });

  await t.test('3. Evaluasi Kelayakan: Belum hadir & belum unggah LPTI -> Not Eligible', async () => {
    const check1 = await service.checkEligibility(testKegiatan.id, testNip);
    assert.equal(check1.eligible, false);
    assert.ok(check1.reasons.length >= 1);
  });

  await t.test('4. Presensi Bertahap: Hadir 1 sesi (kurang dari syarat 2 sesi) -> Masih Belum Eligible', async () => {
    await service.recordPresensi(testKegiatan.id, testNip, 'SESI-1');
    const check2 = await service.checkEligibility(testKegiatan.id, testNip);
    assert.equal(check2.eligible, false);
  });

  await t.test('5. Presensi Lengkap tapi LPTI belum disetujui -> Masih Belum Eligible', async () => {
    await service.recordPresensi(testKegiatan.id, testNip, 'SESI-2');
    const check3 = await service.checkEligibility(testKegiatan.id, testNip);
    assert.equal(check3.eligible, false);
    assert.ok(check3.reasons.some(r => r.includes('LPTI')));
  });

  await t.test('6. Siklus Hidup LPTI: Unggah berkas, klaim antrean, dan persetujuan kurasi', async () => {
    // 1. Peserta mengunggah LPTI
    const submitted = await service.submitLpti(testKegiatan.id, testNip, {
      path: '/uploads/lpti/laporan-kinerja-v1.pdf',
      size: 204800,
      originalName: 'Laporan_Kinerja_2026.pdf'
    });
    assert.equal(submitted.status, 'perlu_dikurasi');
    assert.equal(submitted.versi, 1);

    // 2. Admin mengklaim LPTI berikutnya
    const claimed = await service.claimNextLpti(testKegiatan.id, 'admin_kepegawaian');
    assert.ok(claimed);
    assert.equal(claimed.lpti.lock_by, 'admin_kepegawaian');

    // 3. Admin menyetujui LPTI
    const decided = await service.decideLpti(submitted.id, 'setujui', 'admin_kepegawaian', 'Dokumen notula sangat lengkap.');
    assert.equal(decided.status, 'disetujui');

    // 4. Linimasa riwayat LPTI tercatat
    const history = await service.getLptiHistory(submitted.id);
    assert.ok(history.length >= 2);
    assert.equal(history[0].aksi, 'unggah');
    assert.equal(history[history.length - 1].aksi, 'setujui');
  });

  await t.test('7. Penerbitan Sertifikat Atomik & Idempoten: Cetak ulang tidak menduplikasi nomor', async () => {
    // 1. Cek kelayakan sekarang: harus sudah eligible
    const checkEligible = await service.checkEligibility(testKegiatan.id, testNip);
    assert.equal(checkEligible.eligible, true);

    // 2. Terbitkan sertifikat pertama kali
    const issue1 = await service.issueOrGetCertificate(testKegiatan.id, testNip, { username: 'admin' });
    assert.equal(issue1.alreadyIssued, false);
    assert.ok(issue1.certificate.nomor);
    assert.ok(issue1.certificate.token_qr);
    assert.equal(issue1.certificate.status, 'aktif');

    const firstNomor = issue1.certificate.nomor;
    const firstToken = issue1.certificate.token_qr;

    // 3. Cetak kedua kali (Idempoten): Harus mengembalikan sertifikat & nomor yang persis sama
    const issue2 = await service.issueOrGetCertificate(testKegiatan.id, testNip, { username: 'admin' });
    assert.equal(issue2.alreadyIssued, true);
    assert.equal(issue2.certificate.nomor, firstNomor);
    assert.equal(issue2.certificate.token_qr, firstToken);
  });

  await t.test('8. Verifikasi Publik & Pencabutan: Menampilkan status aktif lalu dicabut dengan alasan', async () => {
    const certData = await service.issueOrGetCertificate(testKegiatan.id, testNip);
    const token = certData.certificate.token_qr;

    // 1. Verifikasi publik saat aktif
    const pubValid = await service.getCertificateByToken(token);
    assert.ok(pubValid);
    assert.equal(pubValid.isValid, true);
    assert.equal(pubValid.isRevoked, false);
    assert.equal(pubValid.snapshot.nama, 'Muhammad Saharullah Raiya');

    // 2. Cabut sertifikat
    await service.revokeCertificate(token, 'Pembatalan administratif karena revisi data NIP', 'superadmin');

    // 3. Verifikasi publik setelah dicabut
    const pubRevoked = await service.getCertificateByToken(token);
    assert.ok(pubRevoked);
    assert.equal(pubRevoked.isValid, false);
    assert.equal(pubRevoked.isRevoked, true);
    assert.equal(pubRevoked.alasan_cabut, 'Pembatalan administratif karena revisi data NIP');
  });

  await t.test('9. Service Riwayat Bersama: Mengembalikan linimasa kegiatan lengkap untuk peserta & admin', async () => {
    const history = await service.getEmployeeTrainingHistory(testNip);
    assert.ok(history);
    assert.equal(history.employee.nip, testNip);
    assert.ok(Array.isArray(history.history));
    assert.ok(history.history.length >= 1);
    assert.ok(history.summary.currentYear > 2020);
  });
});
