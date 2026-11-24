const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../supabase-adapter');

test('SUITE: Langkah (a) - Migrasi, Transaksi RPC, Optimistic Locking, & Append-Only Riwayat', async (t) => {
  // Gunakan adapter lokal terisolasi untuk unit test
  const originalSupabase = db.getClient();
  db.setSupabaseInstance(null);

  const testPegawaiId = 'emp-multi-staff-test-01';

  // Buat dan persiapkan pegawai uji coba
  await db.createEmployee({
    id: testPegawaiId,
    name: 'Drs. H. Syarifuddin, M.Si.',
    nip: '197001011995011001',
    jabatan: 'Widyaprada Ahli Madya',
    instansi: 'BPMP Provinsi Sulawesi Tenggara'
  });

  await db.markEmployeeAttended(testPegawaiId, true);
  await db.updateEmployee(testPegawaiId, {
    lpti: {
      status: 'pending',
      versi: 1,
      fileName: 'LPTI-Syarifuddin.pdf',
      fileOriginalName: 'LPTI-Syarifuddin.pdf'
    }
  });

  const staff1 = { username: 'staf_ani', name: 'Ani Suryani, S.Kom.', peran: 'kepegawaian' };
  const staff2 = { username: 'staf_budi', name: 'Budi Santoso, S.Sos.', peran: 'kepegawaian' };
  const superadmin = { username: 'superadmin', name: 'Super Administrator', peran: 'superadmin' };

  await t.test('1. Klaim LPTI: Staf 1 mengklaim LPTI berstatus pending selama 15 menit', async () => {
    const claimRes = await db.claimLpti(testPegawaiId, staff1, '127.0.0.1', 15);
    assert.equal(claimRes.success, true);
    assert.equal(claimRes.diklaim_oleh, 'staf_ani');
    assert.ok(new Date(claimRes.diklaim_sampai) > new Date());
  });

  await t.test('2. Lock Collision: Staf 2 ditolak mengklaim LPTI yang sedang diperiksa Staf 1', async () => {
    const claimRes2 = await db.claimLpti(testPegawaiId, staff2, '127.0.0.2', 15);
    assert.equal(claimRes2.success, false);
    assert.equal(claimRes2.code, 'ALREADY_CLAIMED');
    assert.equal(claimRes2.claimed_by, 'staf_ani');
  });

  await t.test('3. Superadmin Override: Superadmin berhak mengambil alih klaim staf lain', async () => {
    const overrideRes = await db.claimLpti(testPegawaiId, superadmin, '127.0.0.3', 15);
    assert.equal(overrideRes.success, true);
    assert.equal(overrideRes.diklaim_oleh, 'superadmin');
  });

  await t.test('4. Lepas Klaim: Klaim berhasil dilepas', async () => {
    const releaseRes = await db.releaseLptiClaim(testPegawaiId, superadmin, '127.0.0.3');
    assert.equal(releaseRes.success, true);

    const emp = await db.getEmployeeByIdOrNip(testPegawaiId);
    assert.equal(emp.lpti?.diklaimOleh, null);
  });

  await t.test('5. Optimistic Locking: Dua staf memutuskan LPTI yang sama bersamaan -> Staf kedua mendapat 409 CONFLICT', async () => {
    const emp = await db.getEmployeeByIdOrNip(testPegawaiId);
    const initialVersi = emp.lpti?.versi || 1;

    // Staf 1 menyetujui dengan versi 1
    const res1 = await db.approveLpti(testPegawaiId, initialVersi, staff1, '127.0.0.1', 'LPTI lengkap & terverifikasi', 4);
    assert.equal(res1.success, true);
    assert.equal(res1.status, 'approved');
    assert.equal(res1.versi, initialVersi + 1);

    // Staf 2 mencoba merevisi dengan versi lama (1)
    const res2 = await db.reviseLpti(testPegawaiId, initialVersi, staff2, '127.0.0.2', 'Perlu tambah bukti');
    assert.equal(res2.success, false);
    assert.equal(res2.code, 'CONFLICT');
    assert.equal(res2.current_status, 'approved');
    assert.equal(res2.current_versi, initialVersi + 1);
  });

  await t.test('6. Pembatalan Persetujuan: Hanya Superadmin yang berwenang membatalkan LPTI disetujui (alasan wajib)', async () => {
    // Staf biasa mencoba membatalkan -> FORBIDDEN
    const forbiddenRes = await db.cancelLptiApproval(testPegawaiId, staff1, '127.0.0.1', 'Ingin batalkan', 4);
    assert.equal(forbiddenRes.success, false);
    assert.equal(forbiddenRes.code, 'FORBIDDEN');

    // Superadmin membatalkan tanpa alasan -> VALIDATION_ERROR
    const noReasonRes = await db.cancelLptiApproval(testPegawaiId, superadmin, '127.0.0.3', '', 4);
    assert.equal(noReasonRes.success, false);
    assert.equal(noReasonRes.code, 'VALIDATION_ERROR');

    // Superadmin membatalkan dengan alasan -> SUKSES, status kembali ke pending
    const cancelRes = await db.cancelLptiApproval(testPegawaiId, superadmin, '127.0.0.3', 'Ditemukan ketidaksesuaian lampiran tanda tangan', 4);
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.status, 'pending');

    const empAfterCancel = await db.getEmployeeByIdOrNip(testPegawaiId);
    assert.equal(empAfterCancel.lpti?.status, 'pending');
  });

  await t.test('7. Append-Only Riwayat: Seluruh riwayat tercatat berurutan & modifikasi dilarang keras', async () => {
    const history = await db.getLptiHistory(testPegawaiId);
    assert.ok(Array.isArray(history));
    assert.ok(history.length >= 4, 'Setiap aksi harus menghasilkan baris baru di riwayat');

    const actions = history.map(h => h.aksi);
    assert.ok(actions.includes('diklaim'), 'Aksi diklaim harus tercatat');
    assert.ok(actions.includes('dilepas'), 'Aksi dilepas harus tercatat');
    assert.ok(actions.includes('disetujui'), 'Aksi disetujui harus tercatat');
    assert.ok(actions.includes('persetujuan_dibatalkan'), 'Aksi pembatalan harus tercatat');

    // Pastikan nama_snapshot staf tercatat
    const approveRecord = history.find(h => h.aksi === 'disetujui');
    assert.equal(approveRecord.nama_snapshot, 'Ani Suryani, S.Kom.');

    // Verifikasi proteksi append-only
    assert.throws(() => {
      db.preventLptiRiwayatModification();
    }, /TABEL APPEND-ONLY/);
  });

});
