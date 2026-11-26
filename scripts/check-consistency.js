/**
 * Skrip Pemeriksaan Konsistensi Data (Read-Only)
 * Mendaftar ketidakkonsistenan data sistem:
 * 1. Sertifikat tanpa peserta_kegiatan
 * 2. Sertifikat pada pegawai yang tidak eligible (presensi < min_sesi_hadir atau LPTI belum disetujui)
 * 3. Kegiatan tanpa nama / tanggal / sesi
 * 4. Sertifikat tanpa rekaman audit_log
 * 
 * CATATAN: Skrip ini hanya menampilkan hasil temuan dan TIDAK menghapus data secara otomatis.
 */

const MultiEventService = require('../services/multiEventService');
const db = require('../supabase-adapter');

async function runConsistencyCheck() {
  console.log('='.repeat(70));
  console.log('🔍 PEMERIKSAAN KONSISTENSI DATA PRESENSI, LPTI & E-SERTIFIKAT');
  console.log('='.repeat(70));
  console.log(`Waktu Pemeriksaan: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' })} WITA\n`);

  const service = new MultiEventService(db);
  await service.init();
  const store = service._getStore();

  const issues = {
    orphanCertificates: [],
    ineligibleCertificates: [],
    incompleteKegiatan: [],
    certificatesWithoutAuditLog: []
  };

  // -------------------------------------------------------------
  // 1. Sertifikat Tanpa Peserta Kegiatan (Orphan Certificates)
  // -------------------------------------------------------------
  for (const cert of store.sertifikat) {
    const pk = store.peserta_kegiatan.find(p => p.id === cert.peserta_kegiatan_id);
    if (!pk) {
      issues.orphanCertificates.push({
        certId: cert.id,
        nomor: cert.nomor,
        pesertaKegiatanId: cert.peserta_kegiatan_id,
        status: cert.status
      });
    }
  }

  // -------------------------------------------------------------
  // 2. Sertifikat Pada Pegawai Yang Tidak Eligible
  // -------------------------------------------------------------
  for (const cert of store.sertifikat) {
    if (cert.status !== 'aktif') continue; // hanya evaluasi sertifikat aktif
    const pk = store.peserta_kegiatan.find(p => p.id === cert.peserta_kegiatan_id);
    if (!pk) continue; // sudah masuk di kategori 1

    const keg = store.kegiatan.find(k => k.id === pk.kegiatan_id);
    const presensiCount = store.presensi.filter(p => p.peserta_kegiatan_id === pk.id).length;
    const lpti = store.lpti.find(l => l.peserta_kegiatan_id === pk.id);
    const lptiStatus = lpti ? lpti.status : 'belum_unggah';

    const minRequired = keg ? (parseInt(keg.min_sesi_hadir, 10) || 1) : 1;
    const isWajibLpti = keg ? Boolean(keg.wajib_lpti) : false;

    const reasons = [];
    if (presensiCount < minRequired) {
      reasons.push(`Presensi kurang (${presensiCount}/${minRequired} sesi)`);
    }
    if (isWajibLpti && lptiStatus !== 'disetujui') {
      reasons.push(`LPTI belum disetujui (status: ${lptiStatus})`);
    }

    if (reasons.length > 0) {
      issues.ineligibleCertificates.push({
        certId: cert.id,
        nomor: cert.nomor,
        pegawaiId: pk.pegawai_id,
        kegiatanId: pk.kegiatan_id,
        alasan: reasons.join('; ')
      });
    }
  }

  // -------------------------------------------------------------
  // 3. Kegiatan Tanpa Nama / Tanggal / Sesi
  // -------------------------------------------------------------
  for (const keg of store.kegiatan) {
    const sesiList = store.sesi_kegiatan.filter(s => s.kegiatan_id === keg.id);
    const missing = [];
    if (!keg.nama || keg.nama.trim() === '' || keg.nama === 'Data tidak lengkap') {
      missing.push('Nama Kegiatan Kosong');
    }
    if (!keg.tgl_mulai || keg.tgl_mulai === '—') {
      missing.push('Tanggal Mulai Kosong');
    }
    if (sesiList.length === 0) {
      missing.push('Tidak Memiliki Sesi Kegiatan');
    }

    if (missing.length > 0) {
      issues.incompleteKegiatan.push({
        kegiatanId: keg.id,
        nama: keg.nama || '(kosong)',
        tglMulai: keg.tgl_mulai || '(kosong)',
        totalSesi: sesiList.length,
        kekurangan: missing.join(', ')
      });
    }
  }

  // -------------------------------------------------------------
  // 4. Sertifikat Tanpa Rekaman Audit Log
  // -------------------------------------------------------------
  for (const cert of store.sertifikat) {
    const certLog = store.audit_log.find(l => {
      if (l.entitas === 'sertifikat' && (l.entitas_id === cert.id || l.entitas_id === cert.token_qr)) {
        return true;
      }
      if (l.sesudah_json && (l.sesudah_json.includes(cert.nomor) || l.sesudah_json.includes(cert.id))) {
        return true;
      }
      return false;
    });

    if (!certLog) {
      issues.certificatesWithoutAuditLog.push({
        certId: cert.id,
        nomor: cert.nomor,
        status: cert.status,
        terbitAt: cert.terbit_at
      });
    }
  }

  // =============================================================
  // TAMPILKAN LAPORAN HASIL PEMERIKSAAN
  // =============================================================

  console.log('--- 1. Sertifikat Tanpa Peserta Kegiatan (Orphan) ---');
  if (issues.orphanCertificates.length === 0) {
    console.log('✅ Tidak ditemukan sertifikat yatim (semua sertifikat terhubung ke peserta_kegiatan).');
  } else {
    console.log(`⚠️  Ditemukan ${issues.orphanCertificates.length} sertifikat tanpa peserta_kegiatan:`);
    console.table(issues.orphanCertificates);
  }
  console.log('');

  console.log('--- 2. Sertifikat Pada Pegawai Tidak Eligible ---');
  if (issues.ineligibleCertificates.length === 0) {
    console.log('✅ Semua sertifikat aktif terbit pada pegawai yang memenuhi syarat kelayakan.');
  } else {
    console.log(`⚠️  Ditemukan ${issues.ineligibleCertificates.length} sertifikat pada pegawai yang tidak eligible:`);
    console.table(issues.ineligibleCertificates);
  }
  console.log('');

  console.log('--- 3. Kegiatan Tanpa Nama / Tanggal / Sesi ---');
  if (issues.incompleteKegiatan.length === 0) {
    console.log('✅ Seluruh kegiatan memiliki nama, tanggal, dan minimal 1 sesi.');
  } else {
    console.log(`⚠️  Ditemukan ${issues.incompleteKegiatan.length} kegiatan dengan data tidak lengkap:`);
    console.table(issues.incompleteKegiatan);
  }
  console.log('');

  console.log('--- 4. Sertifikat Tanpa Audit Log ---');
  if (issues.certificatesWithoutAuditLog.length === 0) {
    console.log('✅ Seluruh sertifikat memiliki jejak rekaman di audit_log.');
  } else {
    console.log(`⚠️  Ditemukan ${issues.certificatesWithoutAuditLog.length} sertifikat tanpa rekaman audit_log:`);
    console.table(issues.certificatesWithoutAuditLog);
  }
  console.log('');

  const totalFindings = issues.orphanCertificates.length +
    issues.ineligibleCertificates.length +
    issues.incompleteKegiatan.length +
    issues.certificatesWithoutAuditLog.length;

  console.log('='.repeat(70));
  if (totalFindings === 0) {
    console.log('🎉 STATUS KONSISTENSI: SEMPURNA (0 Masalah Ditemukan)');
  } else {
    console.log(`📋 TOTAL TEMUAN: ${totalFindings} Butir Inkonsistensi Didaftarkan (Tidak Dihapus Otomatis).`);
  }
  console.log('='.repeat(70));

  return {
    success: true,
    totalFindings,
    issues
  };
}

if (require.main === module) {
  runConsistencyCheck()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error saat pemeriksaan konsistensi:', err);
      process.exit(1);
    });
}

module.exports = { runConsistencyCheck };
