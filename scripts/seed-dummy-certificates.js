/**
 * Script Seeding Sertifikat Dummy untuk Uji Coba Verifikasi E-Sertifikat
 * BPMP Provinsi Sulawesi Tenggara - Senin Berseri
 *
 * Penggunaan:
 *   npm run seed:sertifikat-dummy
 *   npm run seed:sertifikat-dummy -- --hapus
 *   npm run seed:sertifikat-dummy -- --force-production
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment jika ada
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch (e) {}
}

const db = require('../supabase-adapter');
const certificateService = require('../services/certificate');
const { signCertificate, getProductionBaseUrl } = require('../cert-crypto');

const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' || Boolean(process.env.VERCEL);
const args = process.argv.slice(2);
const isHapus = args.includes('--hapus') || args.includes('-h');
const isForceProd = args.includes('--force-production') || args.includes('--force');

// 6 Sertifikat Dummy Standar Uji Coba (ID 12 Karakter berawalan TEST, hanya karakter aman 2-9, A-Z tanpa 0/O, 1/I)
const DUMMY_CERTIFICATES = [
  {
    id: 'TEST2VALD222',
    number: '0001/TEST/KP.04.00/2026',
    name: 'Budi Santoso, S.Pd.',
    nip: '198802022015022002',
    eventTitle: 'Pemanfaatan Platform Digital Kepegawaian ASN',
    eventDates: '14 April 2026',
    eventJp: 2,
    qrPosition: 'kiri',
    presetKey: 'A',
    status: 'valid',
    isDummy: true,
    issuedAt: '2026-04-14T08:00:00.000Z',
    description: 'Valid, nama biasa, QR di sisi kiri'
  },
  {
    id: 'TEST3LNGNM33',
    number: '0002/TEST/KP.04.00/2026',
    name: 'Prof. Dr. Ir. H. Raden Mas Bagus Cokroaminoto Hadiningrat, M.Si., M.Ed., Ph.D.',
    nip: '197505121998031002',
    eventTitle: 'Transformasi Layanan Publik Berkelanjutan',
    eventDates: '21 April 2026',
    eventJp: 4,
    qrPosition: 'kanan',
    presetKey: 'A',
    status: 'valid',
    isDummy: true,
    issuedAt: '2026-04-21T08:00:00.000Z',
    description: 'Valid, nama sangat panjang bergelar, QR di sisi kanan'
  },
  {
    id: 'TEST4JUDL444',
    number: '0003/TEST/KP.04.00/2026',
    name: 'Siti Rahmawati, S.Kom.',
    nip: '199203152019032003',
    eventTitle: 'Pengembangan dan Peningkatan Kompetensi Terpadu Tata Kelola Kepegawaian Berbasis Kecerdasan Buatan dan Big Data Mutu Pendidikan ASN Sulawesi Tenggara',
    eventDates: '28 April 2026',
    eventJp: 4,
    qrPosition: 'kanan',
    presetKey: 'A',
    status: 'valid',
    isDummy: true,
    issuedAt: '2026-04-28T08:00:00.000Z',
    description: 'Valid, judul pelatihan panjang dua baris'
  },
  {
    id: 'TEST5DTEGP55',
    number: '0004/TEST/KP.04.00/2026',
    name: 'Ahmad Fauzi, S.T.',
    nip: '199011202017011004',
    eventTitle: 'Lokakarya Penguatan Budaya Kerja BerAKHLAK',
    eventDates: '04 s.d. 06 Mei 2026',
    eventJp: 12,
    qrPosition: 'kiri',
    presetKey: 'A',
    status: 'valid',
    isDummy: true,
    issuedAt: '2026-05-06T11:00:00.000Z',
    description: 'Valid, kegiatan beberapa hari (rentang tanggal)'
  },
  {
    id: 'TEST6REVKD66',
    number: '0005/TEST/KP.04.00/2026',
    name: 'Dewi Sartika Putri, M.A.',
    nip: '199307082020122005',
    eventTitle: 'Strategi Komunikasi Efektif ASN',
    eventDates: '11 Mei 2026',
    eventJp: 2,
    qrPosition: 'kanan',
    presetKey: 'A',
    status: 'revoked',
    revokedAt: '2026-05-15T09:30:00.000Z',
    revocationReason: 'Pencabutan dokumen resmi: Terdapat pembaharuan data kompetensi dan penerbitan sertifikat versi revisi.',
    isDummy: true,
    issuedAt: '2026-05-11T08:00:00.000Z',
    description: 'Sertifikat dicabut (revoked), tanpa pratinjau'
  },
  {
    id: 'TEST7TPLB777',
    number: '0006/TEST/KP.04.00/2026',
    name: 'Hendrik Pratama, S.Sos.',
    nip: '199402172022031006',
    eventTitle: 'Pengelolaan Kinerja Pegawai dan Disiplin ASN',
    eventDates: '18 Mei 2026',
    eventJp: 2,
    qrPosition: 'kiri',
    presetKey: 'B',
    status: 'valid',
    isDummy: true,
    issuedAt: '2026-05-18T08:00:00.000Z',
    description: 'Valid, menggunakan template Preset B (Modern Emerald BPMP Sultra)'
  }
];

async function main() {
  console.log('========================================================');
  console.log('⚙️  PENGELOLA SEED SERTIFIKAT DUMMY - SENIN BERSERI');
  console.log('========================================================');

  // Proteksi Produksi
  if (isProduction && !isForceProd) {
    console.error('❌ DITOLAK: Perintah seed dummy tidak diizinkan di lingkungan PRODUKSI!');
    console.error('   Gunakan flag --force-production jika benar-benar bermaksud mengujinya.');
    process.exit(1);
  }

  // Opsi Hapus Data Dummy
  if (isHapus) {
    console.log('🗑️  Menghapus seluruh sertifikat dummy (is_dummy = true / ID berawalan TEST)...');
    try {
      const result = await db.deleteDummyCertificates();
      console.log(`✅ Berhasil menghapus data dummy sertifikat: ${result.deleted || 0} entri dibersihkan.`);
    } catch (e) {
      console.error('⚠️  Gagal menghapus dummy:', e.message);
    }
    process.exit(0);
  }

  console.log(`🚀 Menyiapkan 6 sertifikat dummy standar uji coba...`);
  const baseUrl = getProductionBaseUrl();

  for (const item of DUMMY_CERTIFICATES) {
    console.log(`\n📌 [${item.id}] ${item.description}`);
    console.log(`   Penerima : ${item.name}`);
    console.log(`   Pelatihan: ${item.eventTitle}`);
    console.log(`   Status   : ${item.status.toUpperCase()} | QR: ${item.qrPosition} | Preset: ${item.presetKey}`);

    // Generate Kriptografi ECDSA
    const certCrypto = signCertificate({
      certNumber: item.number,
      employeeNip: item.nip,
      employeeName: item.name,
      eventTitle: item.eventTitle,
      eventJp: item.eventJp,
      issuedAt: item.issuedAt
    });

    let pdfUrl = `/api/certificates/${item.id}/preview.pdf`;

    // Buat PDF asli dan simpan jika valid
    if (item.status === 'valid') {
      try {
        const certPdfResult = await certificateService.generateCertificatePdf({
          template: { presetKey: item.presetKey, qrPosition: item.qrPosition },
          data: {
            certId: item.id,
            nomor: item.number,
            nama: item.name,
            nip: item.nip,
            judul: item.eventTitle,
            tanggal: item.eventDates,
            jp: item.eventJp,
            lokasi_instansi: 'Aula Utama BPMP Provinsi Sulawesi Tenggara'
          },
          token: item.id,
          baseUrl: baseUrl
        });

        // Simpan buffer ke folder lokal atau upload ke Supabase Storage jika aktif
        const filename = `DUMMY-${item.id}.pdf`;
        if (typeof db.uploadToStorage === 'function') {
          try {
            await db.uploadToStorage('certificates', filename, certPdfResult.pdfBuffer, 'application/pdf');
            pdfUrl = `/api/certificates/${item.id}/preview.pdf`;
          } catch (_) {}
        }
      } catch (errPdf) {
        console.warn(`   ⚠️ Peringatan generate PDF [${item.id}]:`, errPdf.message);
      }
    }

    // Upsert ke database (Idempotent: menimpa jika sudah ada tanpa menduplikasi)
    await db.saveCertificate({
      id: item.id,
      number: item.number,
      employeeId: item.id,
      nip: item.nip,
      name: item.name,
      eventTitle: item.eventTitle,
      issuedAt: item.issuedAt,
      verifier: 'Junaiddin Pagala, S.T., M.T.',
      verifierTitle: 'Kepala Balai Penjaminan Mutu Pendidikan Sultra',
      pdfUrl: pdfUrl,
      cryptoHash: certCrypto.sha256Digest,
      cryptoSignature: certCrypto.signatureHex,
      is_dummy: true,
      status: item.status,
      revoked_at: item.revokedAt || null,
      revocation_reason: item.revocationReason || null
    });

    console.log(`   ✅ Tersimpan di database! URL: ${baseUrl}/sertifikat/${item.id}`);
  }

  console.log('\n========================================================');
  console.log('🎉 SEED DUMMY BERHASIL!');
  console.log('   Semua 6 sertifikat dummy siap diuji di /sertifikat/:id');
  console.log('   Dan tersedia di halaman dashboard: /admin/uji-sertifikat');
  console.log('========================================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in seed:', err);
  process.exit(1);
});
