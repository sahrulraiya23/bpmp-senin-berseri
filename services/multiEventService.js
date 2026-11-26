/**
 * Multi-Event Service & Data Model Layer
 * Mendukung multi-event pelatihan, peserta_kegiatan, presensi bertahap,
 * siklus hidup LPTI berversi dengan claim lock, penerbitan sertifikat atomik & idempoten,
 * service riwayat bersama, dan audit log lengkap.
 */

const crypto = require('crypto');
const { generateRandomCertId, isValidCertIdFormat } = require('../cert-crypto');

class MultiEventService {
  constructor(db) {
    this.db = db;
    this._initialized = false;
  }

  /**
   * Mengambil memory store internal adapter (fallback storage untuk testing & offline)
   */
  _getStore() {
    if (typeof this.db.getMemoryStore === 'function') {
      return this.db.getMemoryStore();
    }
    if (!global.__seninBerseriStore) {
      global.__seninBerseriStore = {
        kegiatan: [],
        template_sertifikat: [],
        peserta_kegiatan: [],
        sesi_kegiatan: [],
        presensi: [],
        lpti: [],
        lpti_berkas: [],
        lpti_riwayat: [],
        sertifikat: [],
        audit_log: []
      };
    }
    return global.__seninBerseriStore;
  }

  /**
   * Inisialisasi dan migrasi data lama ke skema multi-event tanpa kehilangan data (Idempoten)
   */
  async init() {
    if (this._initialized) return;
    const store = this._getStore();

    // 1. Inisialisasi array tabel jika belum ada
    if (!store.kegiatan) store.kegiatan = [];
    if (!store.template_sertifikat) store.template_sertifikat = [];
    if (!store.peserta_kegiatan) store.peserta_kegiatan = [];
    if (!store.sesi_kegiatan) store.sesi_kegiatan = [];
    if (!store.presensi) store.presensi = [];
    if (!store.lpti) store.lpti = [];
    if (!store.lpti_berkas) store.lpti_berkas = [];
    if (!store.lpti_riwayat) store.lpti_riwayat = [];
    if (!store.sertifikat) store.sertifikat = [];
    if (!store.audit_log) store.audit_log = [];

    // 2. Buat Template Sertifikat Default (Preset A - E)
    const defaultTemplates = [
      { id: 'preset-a', nama: 'Preset A - Classic Blue & Gold', file_layout: 'preset-a.pdf', field_posisi_json: JSON.stringify({ namaY: 0.50, nomorY: 0.72 }) },
      { id: 'preset-b', nama: 'Preset B - Modern Emerald BPMP', file_layout: 'preset-b.pdf', field_posisi_json: JSON.stringify({ namaY: 0.50, nomorY: 0.72 }) },
      { id: 'preset-c', nama: 'Preset C - Elegant Maroon Gold', file_layout: 'preset-c.pdf', field_posisi_json: JSON.stringify({ namaY: 0.50, nomorY: 0.72 }) },
      { id: 'preset-d', nama: 'Preset D - Clean Minimalist Slate', file_layout: 'preset-d.pdf', field_posisi_json: JSON.stringify({ namaY: 0.50, nomorY: 0.72 }) },
      { id: 'preset-e', nama: 'Preset E - Kemendikdasmen Modern (Ramah & Bermutu)', file_layout: 'preset-e.pdf', field_posisi_json: JSON.stringify({ namaY: 0.48, nomorY: 0.75 }) }
    ];
    defaultTemplates.forEach(t => {
      if (!store.template_sertifikat.some(x => x.id === t.id)) {
        store.template_sertifikat.push(t);
      }
    });

    // 3. Migrasi kegiatan default dari data lama
    const defaultKegiatanId = 'EVT-2026-001';
    let defaultKegiatan = store.kegiatan.find(k => k.id === defaultKegiatanId);
    if (!defaultKegiatan) {
      defaultKegiatan = {
        id: defaultKegiatanId,
        nama: 'Pelatihan Transformasi Digital & Manajemen Kepegawaian ASN BPMP Sultra',
        tgl_mulai: '2026-11-18',
        tgl_selesai: '2026-11-20',
        jp: 32,
        wajib_lpti: 1,
        batas_unggah_lpti: '2026-12-31T23:59:59Z',
        min_sesi_hadir: 1,
        template_id: 'preset-e',
        format_nomor: '001{counter}/C6.26/Sertifikat/KP.04.00/{tahun}',
        counter_nomor: 0,
        status: 'aktif',
        created_at: new Date().toISOString()
      };
      store.kegiatan.push(defaultKegiatan);
    }

    // 4. Buat sesi default untuk kegiatan default
    const defaultSesiId = 'SESI-2026-001-1';
    if (!store.sesi_kegiatan.some(s => s.id === defaultSesiId)) {
      store.sesi_kegiatan.push({
        id: defaultSesiId,
        kegiatan_id: defaultKegiatanId,
        nama: 'Sesi Utama Pelatihan & Evaluasi Kepegawaian',
        tanggal: '2026-11-18',
        created_at: new Date().toISOString()
      });
    }

    // 5. Migrasi data seluruh pegawai yang ada ke peserta_kegiatan
    const allEmployees = await this.db.getAllEmployees();
    for (const emp of allEmployees) {
      const pesertaId = `PK-${defaultKegiatanId}-${emp.id}`;
      let peserta = store.peserta_kegiatan.find(pk => pk.kegiatan_id === defaultKegiatanId && pk.pegawai_id === emp.id);
      if (!peserta) {
        peserta = {
          id: pesertaId,
          kegiatan_id: defaultKegiatanId,
          pegawai_id: emp.id,
          created_at: emp.created_at || new Date().toISOString()
        };
        store.peserta_kegiatan.push(peserta);
      }

      // Migrasi Presensi
      if (emp.attended) {
        const presensiId = `PRS-${peserta.id}-${defaultSesiId}`;
        if (!store.presensi.some(p => p.peserta_kegiatan_id === peserta.id && p.sesi_id === defaultSesiId)) {
          store.presensi.push({
            id: presensiId,
            peserta_kegiatan_id: peserta.id,
            sesi_id: defaultSesiId,
            waktu: emp.attendedAt || new Date().toISOString(),
            metode: 'qr'
          });
        }
      }

      // Migrasi LPTI
      const lptiData = emp.lpti || {};
      const hasLpti = lptiData.filePath || emp.lpti_file_path || (lptiData.status && lptiData.status !== 'none');
      if (hasLpti) {
        let existingLpti = store.lpti.find(l => l.peserta_kegiatan_id === peserta.id);
        const lptiId = `LPTI-${peserta.id}`;
        const lptiStatus = lptiData.status || emp.lpti_status || 'perlu_dikurasi';
        const filePath = lptiData.filePath || emp.lpti_file_path || '';
        const fileName = lptiData.fileName || emp.lpti_file_name || 'Laporan_LPTI.pdf';

        if (!existingLpti) {
          existingLpti = {
            id: lptiId,
            peserta_kegiatan_id: peserta.id,
            versi: 1,
            berkas_aktif: filePath,
            status: lptiStatus === 'none' ? 'belum_unggah' : lptiStatus,
            lock_by: lptiData.diklaimOleh || null,
            lock_until: lptiData.diklaimSampai || null,
            diajukan_at: lptiData.uploadedAt || emp.lpti_uploaded_at || new Date().toISOString(),
            diputuskan_at: lptiData.diputuskanAt || null,
            diputuskan_oleh: lptiData.diputuskanOleh || null,
            catatan: lptiData.catatan || lptiData.revisionNote || emp.lpti_revision_note || null
          };
          store.lpti.push(existingLpti);

          if (filePath) {
            store.lpti_berkas.push({
              id: `LB-${lptiId}-1`,
              lpti_id: lptiId,
              versi: 1,
              path: filePath,
              ukuran: lptiData.fileSize || emp.lpti_file_size || 0,
              nama_asli: fileName,
              diunggah_at: existingLpti.diajukan_at
            });

            store.lpti_riwayat.push({
              id: `LR-${lptiId}-1`,
              lpti_id: lptiId,
              versi: 1,
              aksi: 'unggah',
              oleh_user_id: emp.nip,
              catatan: 'Pengunggahan berkas LPTI awal',
              created_at: existingLpti.diajukan_at
            });
          }
        }
      }

      // Migrasi Sertifikat
      const certNumber = emp.certificate?.number || emp.certificate_number;
      if (certNumber) {
        let existingCert = store.sertifikat.find(c => c.peserta_kegiatan_id === peserta.id);
        if (!existingCert) {
          defaultKegiatan.counter_nomor++;
          const certId = `CERT-${peserta.id}`;
          const tokenQr = emp.certificate?.certId || generateRandomCertId();
          const snapshot = {
            nama: emp.name,
            nip: emp.nip,
            jabatan: emp.jabatan || 'Aparatur Sipil Negara',
            instansi: emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
            kegiatan: defaultKegiatan.nama,
            tanggal: defaultKegiatan.tgl_mulai,
            jp: defaultKegiatan.jp,
            nomor: certNumber,
            token_qr: tokenQr,
            terbit_at: emp.certificate?.issuedAt || emp.certificate_issued_at || new Date().toISOString()
          };

          store.sertifikat.push({
            id: certId,
            peserta_kegiatan_id: peserta.id,
            nomor: certNumber,
            token_qr: tokenQr,
            snapshot_json: JSON.stringify(snapshot),
            status: 'aktif',
            terbit_at: snapshot.terbit_at,
            dicabut_at: null,
            alasan_cabut: null
          });
        }
      }
    }

    this._initialized = true;
  }

  // ================================================================
  // 1. KEGIATAN & SESI CRUD
  // ================================================================

  async getAllKegiatan() {
    await this.init();
    const store = this._getStore();
    return [...store.kegiatan].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async getKegiatanById(id) {
    await this.init();
    const store = this._getStore();
    return store.kegiatan.find(k => k.id === id) || null;
  }

  async createKegiatan(data, userId = 'superadmin') {
    await this.init();
    const store = this._getStore();
    const id = data.id || `EVT-${new Date().getFullYear()}-${String(store.kegiatan.length + 1).padStart(3, '0')}`;

    const newKegiatan = {
      id,
      nama: data.nama || data.title || 'Kegiatan Pelatihan Baru',
      tgl_mulai: data.tgl_mulai || data.schedule || new Date().toISOString().slice(0, 10),
      tgl_selesai: data.tgl_selesai || data.tgl_mulai || new Date().toISOString().slice(0, 10),
      jp: parseInt(data.jp, 10) || 2,
      wajib_lpti: data.wajib_lpti !== undefined ? (Number(data.wajib_lpti) ? 1 : 0) : 1,
      batas_unggah_lpti: data.batas_unggah_lpti || null,
      min_sesi_hadir: parseInt(data.min_sesi_hadir, 10) || 1,
      template_id: data.template_id || 'preset-e',
      format_nomor: data.format_nomor || '001{counter}/C6.26/Sertifikat/KP.04.00/{tahun}',
      counter_nomor: 0,
      status: data.status || 'aktif',
      created_at: new Date().toISOString()
    };

    store.kegiatan.push(newKegiatan);

    // Buat minimal 1 sesi default untuk kegiatan baru
    const sesiId = `SESI-${id}-1`;
    store.sesi_kegiatan.push({
      id: sesiId,
      kegiatan_id: id,
      nama: data.nama_sesi || 'Sesi Utama',
      tanggal: newKegiatan.tgl_mulai,
      created_at: new Date().toISOString()
    });

    // Auto enroll seluruh ASN BPMP ke kegiatan jika diminta
    const allEmployees = await this.db.getAllEmployees();
    for (const emp of allEmployees) {
      store.peserta_kegiatan.push({
        id: `PK-${id}-${emp.id}`,
        kegiatan_id: id,
        pegawai_id: emp.id,
        created_at: new Date().toISOString()
      });
    }

    // Catat ke Audit Log
    await this.recordAuditLog({
      userId,
      aksi: 'CREATE_KEGIATAN',
      entitas: 'kegiatan',
      entitasId: id,
      sebelum: null,
      sesudah: newKegiatan
    });

    return newKegiatan;
  }

  async updateKegiatan(id, data, userId = 'superadmin') {
    await this.init();
    const store = this._getStore();
    const keg = store.kegiatan.find(k => k.id === id);
    if (!keg) throw new Error(`Kegiatan dengan ID ${id} tidak ditemukan.`);

    const sebelum = { ...keg };

    if (data.nama !== undefined) keg.nama = data.nama;
    if (data.tgl_mulai !== undefined) keg.tgl_mulai = data.tgl_mulai;
    if (data.tgl_selesai !== undefined) keg.tgl_selesai = data.tgl_selesai;
    if (data.jp !== undefined) keg.jp = parseInt(data.jp, 10) || 2;
    if (data.wajib_lpti !== undefined) keg.wajib_lpti = Number(data.wajib_lpti) ? 1 : 0;
    if (data.batas_unggah_lpti !== undefined) keg.batas_unggah_lpti = data.batas_unggah_lpti;
    if (data.min_sesi_hadir !== undefined) keg.min_sesi_hadir = parseInt(data.min_sesi_hadir, 10) || 1;
    if (data.template_id !== undefined) keg.template_id = data.template_id;
    if (data.format_nomor !== undefined) keg.format_nomor = data.format_nomor;
    if (data.status !== undefined) keg.status = data.status;

    // Catat perubahan ke Audit Log
    await this.recordAuditLog({
      userId,
      aksi: 'UPDATE_KEGIATAN',
      entitas: 'kegiatan',
      entitasId: id,
      sebelum,
      sesudah: keg
    });

    return keg;
  }

  async getSesiByKegiatan(kegiatanId) {
    await this.init();
    const store = this._getStore();
    return store.sesi_kegiatan.filter(s => s.kegiatan_id === kegiatanId);
  }

  async addSesi(kegiatanId, { nama, tanggal }, userId = 'superadmin') {
    await this.init();
    const store = this._getStore();
    const sesi = {
      id: `sesi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      kegiatan_id: kegiatanId,
      nama: nama || `Sesi Pertemuan`,
      tanggal: tanggal || new Date().toISOString().split('T')[0]
    };
    store.sesi_kegiatan.push(sesi);

    await this.recordAuditLog({
      userId,
      aksi: 'TAMBAH_SESI',
      entitas: 'sesi_kegiatan',
      entitasId: sesi.id,
      sebelum: null,
      sesudah: sesi
    });

    return sesi;
  }

  async deleteSesi(sesiId, userId = 'superadmin') {
    await this.init();
    const store = this._getStore();
    const idx = store.sesi_kegiatan.findIndex(s => s.id === sesiId);
    if (idx === -1) return null;
    const deleted = store.sesi_kegiatan.splice(idx, 1)[0];

    // Hapus presensi terkait sesi ini
    store.presensi = store.presensi.filter(p => p.sesi_id !== sesiId);

    await this.recordAuditLog({
      userId,
      aksi: 'HAPUS_SESI',
      entitas: 'sesi_kegiatan',
      entitasId: sesiId,
      sebelum: deleted,
      sesudah: null
    });

    return deleted;
  }

  // ================================================================
  // 2. PESERTA & PRESENSI PER KEGIATAN
  // ================================================================

  async getPesertaKegiatan(kegiatanId, pegawaiId) {
    await this.init();
    const store = this._getStore();
    return store.peserta_kegiatan.find(pk => pk.kegiatan_id === kegiatanId && pk.pegawai_id === pegawaiId) || null;
  }

  async ensurePesertaKegiatan(kegiatanId, pegawaiId) {
    await this.init();
    const store = this._getStore();
    let pk = store.peserta_kegiatan.find(x => x.kegiatan_id === kegiatanId && x.pegawai_id === pegawaiId);
    if (!pk) {
      pk = {
        id: `PK-${kegiatanId}-${pegawaiId}`,
        kegiatan_id: kegiatanId,
        pegawai_id: pegawaiId,
        created_at: new Date().toISOString()
      };
      store.peserta_kegiatan.push(pk);
    }
    return pk;
  }

  async recordPresensi(kegiatanId, pegawaiId, sesiId = null, metode = 'qr') {
    await this.init();
    const store = this._getStore();
    const pk = await this.ensurePesertaKegiatan(kegiatanId, pegawaiId);

    // Ambil sesi target (default sesi pertama jika sesiId null)
    let targetSesiId = sesiId;
    if (!targetSesiId) {
      const sesiList = await this.getSesiByKegiatan(kegiatanId);
      if (sesiList.length === 0) throw new Error('Kegiatan ini belum memiliki sesi pelatihan.');
      targetSesiId = sesiList[0].id;
    }

    let prs = store.presensi.find(p => p.peserta_kegiatan_id === pk.id && p.sesi_id === targetSesiId);
    if (!prs) {
      prs = {
        id: `PRS-${pk.id}-${targetSesiId}`,
        peserta_kegiatan_id: pk.id,
        sesi_id: targetSesiId,
        waktu: new Date().toISOString(),
        metode: metode || 'qr'
      };
      store.presensi.push(prs);
    }

    // Hitung akumulasi sesi hadir
    const totalSesiHadir = store.presensi.filter(p => p.peserta_kegiatan_id === pk.id).length;
    return { success: true, presensi: prs, totalSesiHadir };
  }

  // ================================================================
  // 3. ATURAN KELAYAKAN SERTIFIKAT & PENERBITAN ATOMIK IDEMPOTEN
  // ================================================================

  async checkEligibility(kegiatanId, pegawaiId) {
    await this.init();
    const store = this._getStore();
    const kegiatan = await this.getKegiatanById(kegiatanId);
    if (!kegiatan) return { eligible: false, reasons: ['Kegiatan tidak ditemukan.'] };

    const pk = await this.getPesertaKegiatan(kegiatanId, pegawaiId);
    if (!pk) return { eligible: false, reasons: ['Pegawai belum terdaftar sebagai peserta kegiatan ini.'] };

    const sesiList = await this.getSesiByKegiatan(kegiatanId);
    const presensiList = store.presensi.filter(p => p.peserta_kegiatan_id === pk.id);
    const attendedSessions = presensiList.length;
    const minRequired = kegiatan.min_sesi_hadir || 1;

    const lpti = store.lpti.find(l => l.peserta_kegiatan_id === pk.id);
    const lptiStatus = lpti ? lpti.status : 'belum_unggah';

    const reasons = [];
    if (attendedSessions < minRequired) {
      reasons.push(`Presensi belum memenuhi syarat minimal (${attendedSessions}/${minRequired} sesi hadir).`);
    }

    if (kegiatan.wajib_lpti && lptiStatus !== 'disetujui') {
      reasons.push(`Laporan LPTI belum berstatus "Disetujui" (Status saat ini: ${lptiStatus}).`);
    }

    const eligible = (attendedSessions >= minRequired) && (!kegiatan.wajib_lpti || lptiStatus === 'disetujui');

    return {
      eligible,
      reasons,
      stats: {
        attendedSessions,
        totalSessions: sesiList.length || 1,
        minRequired,
        wajibLpti: Boolean(kegiatan.wajib_lpti),
        lptiStatus
      }
    };
  }

  async issueOrGetCertificate(kegiatanId, pegawaiId, adminUser = null) {
    await this.init();
    const store = this._getStore();
    const kegiatan = await this.getKegiatanById(kegiatanId);
    if (!kegiatan) throw new Error('Kegiatan tidak ditemukan.');

    const pk = await this.ensurePesertaKegiatan(kegiatanId, pegawaiId);
    const emp = await this.db.getEmployeeByIdOrNip(pegawaiId);
    if (!emp) throw new Error('Data pegawai tidak ditemukan.');

    // 1. Idempoten: Jika sertifikat sudah ada untuk peserta_kegiatan ini, kembalikan sertifikat yang sama
    const existingCert = store.sertifikat.find(c => c.peserta_kegiatan_id === pk.id);
    if (existingCert) {
      return {
        alreadyIssued: true,
        certificate: existingCert,
        snapshot: JSON.parse(existingCert.snapshot_json)
      };
    }

    // 2. Evaluasi aturan kelayakan
    const eligibility = await this.checkEligibility(kegiatanId, pegawaiId);
    if (!eligibility.eligible) {
      throw new Error(`Pegawai belum memenuhi syarat penerbitan sertifikat: ${eligibility.reasons.join(' ')}`);
    }

    // 3. Penomoran sertifikat atomik per kegiatan
    kegiatan.counter_nomor = (kegiatan.counter_nomor || 0) + 1;
    const counterStr = String(kegiatan.counter_nomor).padStart(3, '0');
    const tahun = new Date().getFullYear();
    const format = kegiatan.format_nomor || '001{counter}/C6.26/Sertifikat/KP.04.00/{tahun}';
    const nomor = format.replace('{counter}', counterStr).replace('{tahun}', String(tahun));

    // Token QR acak 12 karakter Crockford Base32
    const tokenQr = generateRandomCertId();

    // 4. Buat snapshot_json lengkap
    const snapshot = {
      nama: emp.name,
      nip: emp.nip,
      jabatan: emp.jabatan || 'Aparatur Sipil Negara',
      instansi: emp.instansi || 'BPMP Provinsi Sulawesi Tenggara',
      kegiatan: kegiatan.nama,
      tanggal: kegiatan.tgl_mulai,
      jp: kegiatan.jp,
      nomor,
      token_qr: tokenQr,
      terbit_at: new Date().toISOString()
    };

    const newCert = {
      id: `CERT-${pk.id}`,
      peserta_kegiatan_id: pk.id,
      nomor,
      token_qr: tokenQr,
      snapshot_json: JSON.stringify(snapshot),
      status: 'aktif',
      terbit_at: snapshot.terbit_at,
      dicabut_at: null,
      alasan_cabut: null
    };

    store.sertifikat.push(newCert);

    // Catat ke Audit Log
    await this.recordAuditLog({
      userId: adminUser?.username || 'system',
      aksi: 'ISSUE_CERTIFICATE',
      entitas: 'sertifikat',
      entitasId: newCert.id,
      sebelum: null,
      sesudah: newCert
    });

    return {
      alreadyIssued: false,
      certificate: newCert,
      snapshot
    };
  }

  async revokeCertificate(tokenQrOrNomor, alasan, adminUserId = 'superadmin') {
    await this.init();
    const store = this._getStore();
    const cert = store.sertifikat.find(c => c.token_qr === tokenQrOrNomor || c.nomor === tokenQrOrNomor);
    if (!cert) throw new Error('Sertifikat tidak ditemukan.');

    const sebelum = { ...cert };
    cert.status = 'dicabut';
    cert.dicabut_at = new Date().toISOString();
    cert.alasan_cabut = alasan || 'Pencabutan administratif oleh Bagian Kepegawaian';

    await this.recordAuditLog({
      userId: adminUserId,
      aksi: 'REVOKE_CERTIFICATE',
      entitas: 'sertifikat',
      entitasId: cert.id,
      sebelum,
      sesudah: cert
    });

    return cert;
  }

  async getCertificateByToken(tokenQr) {
    await this.init();
    const store = this._getStore();
    const cert = store.sertifikat.find(c => c.token_qr === tokenQr);
    if (!cert) return null;

    const snapshot = JSON.parse(cert.snapshot_json);
    return {
      ...cert,
      snapshot,
      isValid: cert.status === 'aktif',
      isRevoked: cert.status === 'dicabut'
    };
  }

  // ================================================================
  // 4. LPTI MULTI-EVENT & LINIMASA RIWAYAT
  // ================================================================

  async getLptiByPeserta(pesertaKegiatanId) {
    await this.init();
    const store = this._getStore();
    return store.lpti.find(l => l.peserta_kegiatan_id === pesertaKegiatanId) || null;
  }

  async claimNextLpti(kegiatanId, adminUserId) {
    await this.init();
    const store = this._getStore();
    const now = new Date();
    const nowTs = now.getTime();

    // 1. Lepas lock yang sudah kedaluwarsa (> 15 menit)
    store.lpti.forEach(l => {
      if (l.lock_until && new Date(l.lock_until).getTime() <= nowTs) {
        l.lock_by = null;
        l.lock_until = null;
      }
    });

    // 2. Ambil antrean LPTI kegiatan terpilih yang statusnya 'perlu_dikurasi' dan belum di-lock
    const pkIds = store.peserta_kegiatan.filter(pk => pk.kegiatan_id === kegiatanId).map(pk => pk.id);
    const unclaimed = store.lpti.find(l => pkIds.includes(l.peserta_kegiatan_id) && l.status === 'perlu_dikurasi' && !l.lock_by);

    if (!unclaimed) return null;

    // 3. Kunci atomik selama 15 menit
    unclaimed.lock_by = adminUserId;
    unclaimed.lock_until = new Date(nowTs + 15 * 60 * 1000).toISOString();

    const pk = store.peserta_kegiatan.find(p => p.id === unclaimed.peserta_kegiatan_id);
    const emp = pk ? await this.db.getEmployeeByIdOrNip(pk.pegawai_id) : null;

    return {
      lpti: unclaimed,
      employee: emp
    };
  }

  async submitLpti(kegiatanId, pegawaiId, fileInfo) {
    await this.init();
    const store = this._getStore();
    const pk = await this.ensurePesertaKegiatan(kegiatanId, pegawaiId);

    let lpti = store.lpti.find(l => l.peserta_kegiatan_id === pk.id);
    const now = new Date().toISOString();

    if (!lpti) {
      lpti = {
        id: `LPTI-${pk.id}`,
        peserta_kegiatan_id: pk.id,
        versi: 1,
        berkas_aktif: fileInfo.path,
        status: 'perlu_dikurasi',
        lock_by: null,
        lock_until: null,
        diajukan_at: now,
        diputuskan_at: null,
        diputuskan_oleh: null,
        catatan: null
      };
      store.lpti.push(lpti);
    } else {
      lpti.versi = (parseInt(lpti.versi, 10) || 1) + 1;
      lpti.berkas_aktif = fileInfo.path;
      lpti.status = 'perlu_dikurasi';
      lpti.lock_by = null;
      lpti.lock_until = null;
      lpti.diajukan_at = now;
      lpti.catatan = null;
    }

    // Simpan riwayat berkas historis
    store.lpti_berkas.push({
      id: `LB-${lpti.id}-${lpti.versi}`,
      lpti_id: lpti.id,
      versi: lpti.versi,
      path: fileInfo.path,
      ukuran: fileInfo.size || 0,
      nama_asli: fileInfo.originalName || 'Laporan_LPTI.pdf',
      diunggah_at: now
    });

    // Catat ke linimasa lpti_riwayat
    store.lpti_riwayat.push({
      id: `LR-${lpti.id}-${Date.now()}`,
      lpti_id: lpti.id,
      versi: lpti.versi,
      aksi: lpti.versi === 1 ? 'unggah' : 'unggah_ulang',
      oleh_user_id: pegawaiId,
      catatan: `Berkas LPTI versi ${lpti.versi} berhasil diunggah.`,
      created_at: now
    });

    return lpti;
  }

  async decideLpti(lptiId, aksi, adminUserId, catatan = '') {
    await this.init();
    const store = this._getStore();
    const lpti = store.lpti.find(l => l.id === lptiId);
    if (!lpti) throw new Error('Berkas LPTI tidak ditemukan.');

    const now = new Date().toISOString();
    lpti.status = aksi === 'setujui' ? 'disetujui' : 'revisi';
    lpti.diputuskan_at = now;
    lpti.diputuskan_oleh = adminUserId;
    lpti.catatan = catatan;
    lpti.lock_by = null;
    lpti.lock_until = null;

    store.lpti_riwayat.push({
      id: `LR-${lpti.id}-${Date.now()}`,
      lpti_id: lpti.id,
      versi: lpti.versi,
      aksi: aksi === 'setujui' ? 'setujui' : 'revisi',
      oleh_user_id: adminUserId,
      catatan: catatan || (aksi === 'setujui' ? 'LPTI disetujui tanpa catatan.' : 'Perlu revisi.'),
      created_at: now
    });

    return lpti;
  }

  async getLptiHistory(lptiId) {
    await this.init();
    const store = this._getStore();
    const history = store.lpti_riwayat.filter(r => r.lpti_id === lptiId);
    return history.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  // ================================================================
  // 5. SERVICE RIWAYAT BERSAMA (Dipakai Peserta & Admin)
  // ================================================================

  async getEmployeeTrainingHistory(pegawaiId) {
    await this.init();
    const store = this._getStore();
    const emp = await this.db.getEmployeeByIdOrNip(pegawaiId);
    if (!emp) throw new Error('Data pegawai tidak ditemukan.');

    const pks = store.peserta_kegiatan.filter(pk => pk.pegawai_id === emp.id);
    const historyItems = [];
    let currentYearJp = 0;
    let totalCertificates = 0;
    const currentYear = new Date().getFullYear();

    for (const pk of pks) {
      const keg = store.kegiatan.find(k => k.id === pk.kegiatan_id);
      if (!keg) continue;

      const sesiList = store.sesi_kegiatan.filter(s => s.kegiatan_id === keg.id);
      const presensiList = store.presensi.filter(p => p.peserta_kegiatan_id === pk.id);
      const attendedCount = presensiList.length;

      const lpti = store.lpti.find(l => l.peserta_kegiatan_id === pk.id);
      const cert = store.sertifikat.find(c => c.peserta_kegiatan_id === pk.id);

      const eligibility = await this.checkEligibility(keg.id, emp.id);

      let certDisplayStatus = 'Belum memenuhi';
      if (cert && cert.status === 'aktif') {
        certDisplayStatus = 'Terbit';
        totalCertificates++;
      } else if (eligibility.eligible) {
        certDisplayStatus = 'Siap';
      }

      const earnedJp = attendedCount >= (keg.min_sesi_hadir || 1) ? keg.jp : 0;
      const kegYear = new Date(keg.tgl_mulai || keg.created_at).getFullYear();
      if (kegYear === currentYear) {
        currentYearJp += earnedJp;
      }

      historyItems.push({
        pesertaKegiatanId: pk.id,
        kegiatan: {
          id: keg.id,
          nama: keg.nama,
          tglMulai: keg.tgl_mulai,
          tglSelesai: keg.tgl_selesai,
          jp: keg.jp,
          wajibLpti: Boolean(keg.wajib_lpti),
          batasUnggahLpti: keg.batas_unggah_lpti,
          status: keg.status
        },
        presensi: {
          attendedCount,
          totalSesi: sesiList.length || 1,
          isComplete: attendedCount >= (keg.min_sesi_hadir || 1),
          list: presensiList
        },
        lpti: lpti ? {
          id: lpti.id,
          status: lpti.status,
          versi: lpti.versi,
          berkasAktif: lpti.berkas_aktif,
          catatan: lpti.catatan,
          diputuskanOleh: lpti.diputuskan_oleh,
          diputuskanAt: lpti.diputuskan_at
        } : {
          status: 'belum_unggah'
        },
        sertifikat: cert ? {
          id: cert.id,
          nomor: cert.nomor,
          tokenQr: cert.token_qr,
          status: cert.status,
          terbitAt: cert.terbit_at,
          downloadUrl: `/sertifikat/${cert.token_qr}`
        } : null,
        certDisplayStatus,
        earnedJp,
        eligibility
      });
    }

    // Urutkan kegiatan terbaru terlebih dahulu
    historyItems.sort((a, b) => new Date(b.kegiatan.tglMulai) - new Date(a.kegiatan.tglMulai));

    return {
      employee: {
        id: emp.id,
        nip: emp.nip,
        name: emp.name,
        jabatan: emp.jabatan,
        panggol: emp.panggol,
        instansi: emp.instansi
      },
      summary: {
        currentYear,
        totalJpCurrentYear: currentYearJp,
        totalCertificates,
        totalEventsFollowed: historyItems.length
      },
      history: historyItems
    };
  }

  // ================================================================
  // 6. AUDIT LOG
  // ================================================================

  async recordAuditLog({ userId, aksi, entitas, entitasId, sebelum = null, sesudah = null }) {
    await this.init();
    const store = this._getStore();
    const log = {
      id: `AUDIT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      user_id: userId || 'system',
      aksi,
      entitas,
      entitas_id: entitasId,
      sebelum_json: sebelum ? JSON.stringify(sebelum) : null,
      sesudah_json: sesudah ? JSON.stringify(sesudah) : null,
      created_at: new Date().toISOString()
    };
    store.audit_log.unshift(log);
    return log;
  }

  async getAuditLogs(filters = {}) {
    await this.init();
    const store = this._getStore();
    let logs = [...store.audit_log];

    if (filters.userId) {
      logs = logs.filter(l => l.user_id === filters.userId);
    }
    if (filters.aksi) {
      logs = logs.filter(l => l.aksi === filters.aksi);
    }
    if (filters.entitas) {
      logs = logs.filter(l => l.entitas === filters.entitas);
    }
    if (filters.startDate) {
      logs = logs.filter(l => new Date(l.created_at) >= new Date(filters.startDate));
    }
    if (filters.endDate) {
      logs = logs.filter(l => new Date(l.created_at) <= new Date(filters.endDate));
    }

    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 25;
    const total = logs.length;
    const paginated = logs.slice((page - 1) * limit, page * limit);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      logs: paginated
    };
  }
}

module.exports = MultiEventService;
