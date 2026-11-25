const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const certificateService = require('../services/certificate');
const db = require('../supabase-adapter');

test('SUITE: Fitur E-Sertifikat Terkunci & Keabsahan Verifikasi', async (t) => {
  db.setSupabaseInstance(null);

  await t.test('1. Preset Templates: Menyiapkan preset resmi (A, B, C, D, E) dengan QR kiri/kanan', async () => {
    const presets = certificateService.PRESET_TEMPLATES;
    assert.ok(presets['A'], 'Preset A harus tersedia');
    assert.ok(presets['B'], 'Preset B harus tersedia');
    assert.ok(presets['C'], 'Preset C harus tersedia');
    assert.ok(presets['D'], 'Preset D harus tersedia');
    assert.ok(presets['E'], 'Preset E harus tersedia');

    assert.equal(presets['A'].defaultQrPosition, 'kanan');
    assert.equal(presets['B'].defaultQrPosition, 'kiri');
    assert.equal(presets['C'].defaultQrPosition, 'kanan');
    assert.equal(presets['D'].defaultQrPosition, 'kiri');
    assert.equal(presets['E'].defaultQrPosition, 'kiri');
  });

  await t.test('2. Layout Terkunci: Zona QR memenuhi standar minimal 25 x 25 mm (~71 pt)', async () => {
    const layoutKanan = certificateService.getLockedLayoutConfig('kanan');
    const layoutKiri = certificateService.getLockedLayoutConfig('kiri');

    // 25 mm di 72 DPI = 70.87 pt
    assert.ok(layoutKanan.zones.qr.size >= 71, 'Ukuran QR kanan minimal 25x25mm (>= 71 pt)');
    assert.ok(layoutKiri.zones.qr.size >= 71, 'Ukuran QR kiri minimal 25x25mm (>= 71 pt)');
    assert.equal(layoutKiri.zones.qr.x, 95, 'QR kiri berada di sisi kiri bawah');
    assert.ok(layoutKanan.zones.qr.x > 600, 'QR kanan berada di sisi kanan bawah');
  });

  await t.test('3. Auto-Scaling & Word-Wrap: Nama sangat panjang dan judul tema panjang tidak error', async () => {
    const longName = 'Prof. Dr. Ir. Raden Mas Danang Haryo Tejo Kusumo Wibowo, S.T., M.Kom., Ph.D., IPU., ASEAN Eng.';
    const longTitle = 'Bimbingan Teknis Akselerasi Digitalisasi Pembelajaran, Tata Kelola Manajemen Talenta ASN, Integrasi Penjaminan Mutu Berkelanjutan, dan Transformasi Birokrasi Berbasis Kecerdasan Buatan Tingkat Nasional';

    const result = await certificateService.generateCertificatePdf({
      template: { presetKey: 'A', qrPosition: 'kanan' },
      data: {
        nomor: '0031/C6.26/Sertifikat/KP.04.00/2026',
        nama: longName,
        nip: '198001012005011001',
        jabatan: 'Widyaprada Ahli Madya',
        instansi: 'BPMP Provinsi Sulawesi Tenggara',
        judul: longTitle,
        tanggal: '18 - 20 November 2026',
        jp: 32
      },
      token: 'test-long-text-token-abc123'
    });

    assert.ok(result.pdfBuffer instanceof Buffer, 'Harus menghasilkan buffer PDF');
    assert.ok(result.pdfBuffer.length > 1000, 'Ukuran PDF harus valid');
    assert.equal(result.token, 'test-long-text-token-abc123');
    assert.equal(result.nomor, '0031/C6.26/Sertifikat/KP.04.00/2026');
  });

  await t.test('4. Format Tanggal Bahasa Indonesia (Tunggal & Rentang Hari)', async () => {
    const tglTunggal = certificateService.formatTanggalIndonesia('2026-04-22');
    assert.equal(tglTunggal, '22 April 2026');

    const tglRentang = certificateService.formatTanggalIndonesia('2026-11-18', '2026-11-20');
    assert.equal(tglRentang, '18 - 20 November 2026');
  });

  await t.test('5. Generator Panduan Zona (Overlay Grid PDF) untuk Desainer Grafis', async () => {
    const overlayA = await certificateService.generateZoneOverlayPdf('A', 'kanan');
    const overlayB = await certificateService.generateZoneOverlayPdf('B', 'kiri');

    assert.ok(overlayA instanceof Uint8Array || Buffer.isBuffer(overlayA));
    assert.ok(overlayB instanceof Uint8Array || Buffer.isBuffer(overlayB));
    assert.ok(overlayA.length > 1000, 'Overlay PDF A harus valid');
    assert.ok(overlayB.length > 1000, 'Overlay PDF B harus valid');
  });

  await t.test('6. Penomoran Unik Bebas Tabrakan (Bulk Collision-Free Sequence)', async () => {
    const seq1 = await db.getNextCertificateSequence(2026);
    assert.ok(typeof seq1 === 'number' && seq1 >= 1);

    const year = 2026;
    const certNum1 = `${String(seq1).padStart(4, '0')}/C6.26/Sertifikat/KP.04.00/${year}`;
    const certNum2 = `${String(seq1 + 1).padStart(4, '0')}/C6.26/Sertifikat/KP.04.00/${year}`;

    assert.notEqual(certNum1, certNum2, 'Nomor berurutan tidak boleh sama');
    assert.match(certNum1, /^\d{4}\/C6\.26\/Sertifikat\/KP\.04\.00\/2026$/);
  });

  await t.test('7. Penerbitan & Revocation: Terbit ulang versi baru mencabut sertifikat lama', async () => {
    const testPegawaiId = 'emp-test-cert-revocation';
    const testEventId = 'evt-test-2026';
    const token1 = 'tok-v1-' + Date.now();
    const token2 = 'tok-v2-' + Date.now();

    // Terbit Versi 1
    const certV1 = await db.saveIssuedCertificate({
      id: 'cert-v1-' + Date.now(),
      event_id: testEventId,
      pegawai_id: testPegawaiId,
      nomor: '0050/C6.26/Sertifikat/KP.04.00/2026',
      token: token1,
      template_id: 'preset-a',
      versi: 1,
      status: 'valid'
    });

    assert.equal(certV1.status, 'valid');

    // Lakukan pencabutan / koreksi data
    await db.revokeCertificate(certV1.id, 'Koreksi Gelar dan NIP Peserta');

    // Cek sertifikat v1 setelah dicabut
    const checkedV1 = await db.getCertificateByToken(token1);
    assert.equal(checkedV1.status, 'revoked');
    assert.equal(checkedV1.revocation_reason, 'Koreksi Gelar dan NIP Peserta');

    // Terbit Versi 2
    const certV2 = await db.saveIssuedCertificate({
      id: 'cert-v2-' + Date.now(),
      event_id: testEventId,
      pegawai_id: testPegawaiId,
      nomor: '0051/C6.26/Sertifikat/KP.04.00/2026',
      token: token2,
      template_id: 'preset-b',
      versi: 2,
      status: 'valid'
    });

    assert.equal(certV2.status, 'valid');
    assert.equal(certV2.versi, 2);

    const checkedV2 = await db.getCertificateByToken(token2);
    assert.equal(checkedV2.status, 'valid');
  });

  await t.test('6. Preset E: Render template Kemendikdasmen Modern (Ramah & Bermutu)', async () => {
    const res = await certificateService.generateCertificatePdf({
      template: { id: 'preset-e', presetKey: 'E' },
      data: {
        nomor: '00110/C6.26/Sertifikat/KP.04.00/2026',
        nama: 'Rika Ernita Mekuo, S.Si. M.Si.',
        judul: 'Peningkatan Kompetensi FGD dengan tema Kearsipan dan Tata Naskah Persuratan Dinas',
        tanggal: '19 s.d. 20 September 2026',
        jp: 8,
        lokasi: 'BPMP Provinsi Sulawesi Tenggara'
      },
      token: 'TESTPRESETE12'
    });

    assert.ok(res.pdfBuffer instanceof Buffer, 'Harus menghasilkan buffer PDF');
    assert.ok(res.pdfBuffer.length > 20000, 'Ukuran PDF harus memuat template gambar');
    assert.equal(res.token, 'TESTPRESETE12');
  });

});
