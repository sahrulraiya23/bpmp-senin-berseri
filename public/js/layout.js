/**
 * BPMP Senin Berseri — Shared Layout System (Tabler Bootstrap 5 Vertical Layout)
 * Satu konfigurasi menu terpusat untuk semua peran (Superadmin, Kepegawaian, ASN).
 */

if (typeof window !== 'undefined') {
  window.bootstrap = window.bootstrap || window.tabler?.bootstrap || window.tabler || {};
  if (!window.bootstrap.Modal && window.tabler?.Modal) {
    window.bootstrap.Modal = window.tabler.Modal;
  }
}

// XSS Sanitizer universal
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

const BPMPLayout = {
  // Master menu items definition
  menuItems: [
    // 1. GRUP OPERASIONAL
    {
      id: 'ringkasan',
      label: 'Ringkasan',
      href: '/admin',
      icon: 'ti-layout-dashboard',
      group: 'OPERASIONAL',
      roles: ['superadmin', 'kepegawaian', 'admin']
    },
    {
      id: 'rekap-presensi',
      label: 'Rekap Presensi',
      href: '/admin/rekap-presensi',
      icon: 'ti-clipboard-check',
      group: 'OPERASIONAL',
      roles: ['superadmin', 'kepegawaian', 'admin']
    },
    {
      id: 'verifikasi-lpti',
      label: 'Verifikasi LPTI',
      href: '/admin/verifikasi-lpti',
      icon: 'ti-file-check',
      group: 'OPERASIONAL',
      roles: ['superadmin', 'kepegawaian', 'admin'],
      badgeKey: 'lptiPending'
    },
    {
      id: 'riwayat-pegawai',
      label: 'Riwayat Pegawai',
      href: 'javascript:void(0)',
      onclick: 'BPMPLayout.openLookupPegawai()',
      icon: 'ti-user-search',
      group: 'OPERASIONAL',
      roles: ['superadmin', 'kepegawaian', 'admin']
    },

    // 2. GRUP PENGATURAN (Khusus Superadmin)
    {
      id: 'kegiatan',
      label: 'Manajemen Kegiatan',
      href: '/admin/kegiatan',
      icon: 'ti-calendar-event',
      group: 'PENGATURAN',
      roles: ['superadmin']
    },
    {
      id: 'template',
      label: 'Template Sertifikat',
      href: 'javascript:void(0)',
      onclick: 'BPMPLayout.openTemplateModal()',
      icon: 'ti-palette',
      group: 'PENGATURAN',
      roles: ['superadmin']
    },
    {
      id: 'qr',
      label: 'Dynamic QR',
      href: '/admin?tab=qr',
      icon: 'ti-qrcode',
      group: 'PENGATURAN',
      roles: ['superadmin']
    },
    {
      id: 'audit-log',
      label: 'Audit Log',
      href: '/admin/audit-log',
      icon: 'ti-history',
      group: 'PENGATURAN',
      roles: ['superadmin']
    },
    {
      id: 'pengguna',
      label: 'Pengguna',
      href: 'javascript:void(0)',
      onclick: 'BPMPLayout.openAdminAccountManager()',
      icon: 'ti-users',
      group: 'PENGATURAN',
      roles: ['superadmin']
    },

    // 3. GRUP TAUTAN
    {
      id: 'cek-sertifikat',
      label: 'Cek Sertifikat',
      href: '/sertifikat',
      icon: 'ti-certificate',
      group: 'TAUTAN',
      roles: ['superadmin', 'kepegawaian', 'admin'],
      target: '_blank'
    },
    {
      id: 'layar-aula',
      label: 'Layar Aula',
      href: '/proyektor',
      icon: 'ti-device-projector',
      group: 'TAUTAN',
      roles: ['superadmin', 'kepegawaian', 'admin'],
      target: '_blank'
    },
    {
      id: 'beranda-portal',
      label: 'Beranda Portal',
      href: '/',
      icon: 'ti-home',
      group: 'TAUTAN',
      roles: ['superadmin', 'kepegawaian', 'admin'],
      target: '_blank'
    }
  ],

  // Cache events & pending counts
  cachedEvents: [],
  lptiPendingCount: 0,
  clockTimer: null,

  /**
   * Dapatkan user yang sedang aktif
   */
  getCurrentUser() {
    try {
      const raw = localStorage.getItem('adminUser') || sessionStorage.getItem('adminUser');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  },

  /**
   * Dapatkan peran pengguna (superadmin / kepegawaian)
   */
  getUserRole() {
    const user = this.getCurrentUser();
    if (!user) return 'kepegawaian';
    const role = (user.peran || user.role || '').toLowerCase();
    if (role === 'superadmin' || user.username === 'superadmin') return 'superadmin';
    return 'kepegawaian';
  },

  /**
   * Render Sidebar Tabler Vertical Layout
   */
  renderSidebar(opts = {}) {
    const user = opts.user || this.getCurrentUser() || {};
    const role = (opts.role || this.getUserRole()).toLowerCase();
    const isSuper = role === 'superadmin';
    const activeMenu = opts.activeMenu || '';

    // Filter menu items berdasarkan role
    const allowedItems = this.menuItems.filter(item => item.roles.includes(role));

    // Kelompokkan berdasarkan grup, grup kosong disembunyikan
    const groups = ['OPERASIONAL', 'PENGATURAN', 'TAUTAN'];
    let menuHtml = '';

    groups.forEach(groupName => {
      const groupItems = allowedItems.filter(item => item.group === groupName);
      if (groupItems.length === 0) return; // Sembunyikan grup jika tidak ada item

      menuHtml += `
        <li class="nav-item-header text-uppercase text-white-50 fw-bold px-3 pt-3 pb-1" style="font-size: 10px; letter-spacing: 0.8px;">
          ${groupName}
        </li>
      `;

      groupItems.forEach(item => {
        const isActive = item.id === activeMenu;
        const activeClass = isActive ? 'active fw-bold text-white bg-primary bg-opacity-25' : 'text-white-75';
        const targetAttr = item.target ? `target="${item.target}"` : '';
        const onclickAttr = item.onclick ? `onclick="${item.onclick}"` : '';

        let badgeHtml = '';
        if (item.badgeKey === 'lptiPending') {
          badgeHtml = `<span id="sidebarBadgeLptiPending" class="badge bg-warning text-dark ms-auto font-monospace px-1.5 py-0.5" style="font-size: 10px;">${this.lptiPendingCount}</span>`;
        }

        menuHtml += `
          <li class="nav-item">
            <a class="nav-link ${activeClass} px-3 py-2 rounded-2 mx-2 mb-0.5" href="${item.href}" ${targetAttr} ${onclickAttr}>
              <span class="nav-link-icon d-inline-block me-2">
                <i class="ti ${item.icon} fs-3"></i>
              </span>
              <span class="nav-link-title">${item.label}</span>
              ${badgeHtml}
            </a>
          </li>
        `;
      });
    });

    const displayName = user.name || (isSuper ? 'Super Administrator' : 'Staf Kepegawaian');
    const initial = (displayName || 'A').charAt(0).toUpperCase();
    const roleBadgeText = isSuper ? 'Superadmin' : 'Kepegawaian';
    const roleBadgeClass = isSuper ? 'bg-yellow text-dark' : 'bg-primary text-white';

    return `
      <aside class="navbar navbar-vertical navbar-expand-lg d-print-none shadow-sm" data-bs-theme="dark" id="sidebarMenu" style="z-index: 1030;">
        <div class="container-fluid px-2">
          <!-- Mobile Toggle Button (Drawer) -->
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Buka Menu">
            <span class="navbar-toggler-icon"></span>
          </button>

          <!-- Brand Logo & Instansi (Satu identitas terpadu) -->
          <div class="navbar-brand navbar-brand-autodark px-2 py-2.5 my-1">
            <a href="/admin" class="d-flex align-items-center text-decoration-none text-white">
              <img src="/icons/tutwurihandayani.png" alt="Kemendikdasmen" width="34" height="34" class="me-2 flex-shrink-0" style="object-fit: contain;">
              <div class="d-flex flex-column text-start lh-sm">
                <span class="fw-bold text-white" style="font-size: 13px; letter-spacing: -0.2px;">Kemendikdasmen</span>
                <span class="text-white-50" style="font-size: 10px; letter-spacing: 0.1px;">BPMP Sultra</span>
              </div>
            </a>
          </div>

          <!-- Pemilih Event Aktif Global (Tersimpan di Sesi) -->
          <div class="sidebar-event-selector px-2 py-2 mb-2 w-100 border-top border-bottom border-white-10 bg-dark-lt rounded">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 9.5px; letter-spacing: 0.5px;">
                <i class="ti ti-calendar-event me-1"></i> EVENT AKTIF
              </span>
              <span id="sidebarEventStatusBadge" class="badge bg-green text-green-fg" style="font-size: 9px; padding: 1px 5px;">Aktif</span>
            </div>
            <select id="sidebarGlobalEventSelect" class="form-select form-select-sm bg-dark text-white border-secondary" style="font-size: 11.5px; cursor: pointer;" onchange="BPMPLayout.onGlobalEventChange(this.value)">
              <option value="">Memuat kegiatan...</option>
            </select>
          </div>

          <!-- Menu Items Collapsible -->
          <div class="collapse navbar-collapse" id="sidebar-menu">
            <ul class="navbar-nav pt-lg-1 w-100">
              ${menuHtml}
            </ul>

            <!-- Sidebar Footer: Nama User, Peran, Pengaturan, Keluar -->
            <div class="sidebar-footer mt-auto pt-3 border-top border-white-10 w-100 pb-2">
              <div class="d-flex align-items-center gap-2 mb-2 px-2">
                <span class="avatar avatar-sm bg-primary text-white fw-bold flex-shrink-0" id="sidebarUserAvatar">${initial}</span>
                <div class="text-truncate flex-grow-1" style="max-width: 120px;">
                  <div class="fw-bold text-white small text-truncate" id="sidebarUserName" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
                  <div class="text-white-50" style="font-size: 10px;" id="sidebarUserRoleDisplay">${roleBadgeText}</div>
                </div>
                <span class="badge ${roleBadgeClass} font-monospace" style="font-size: 9px;">${roleBadgeText}</span>
              </div>
              <div class="d-flex gap-1.5 px-2">
                ${isSuper ? `
                  <button type="button" class="btn btn-outline-light btn-sm flex-fill py-1 px-1.5" onclick="BPMPLayout.openSettingsModal()" style="font-size: 11px;" title="Pengaturan Sistem & Reset Data">
                    <i class="ti ti-settings me-1"></i> Pengaturan
                  </button>
                ` : ''}
                <button type="button" class="btn btn-outline-danger btn-sm flex-fill py-1 px-1.5" onclick="handleLogout()" style="font-size: 11px;" title="Keluar dari sesi admin">
                  <i class="ti ti-logout me-1"></i> Keluar
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    `;
  },

  /**
   * Render Topbar Tipis (Breadcrumb, Jam WITA, Tombol Aksi Halaman)
   */
  renderSlimHeader(opts = {}) {
    const role = (opts.role || this.getUserRole()).toLowerCase();
    const isSuper = role === 'superadmin';
    const breadcrumb = opts.breadcrumb || (isSuper ? 'BPMP SULTRA / SUPERADMIN' : 'BPMP SULTRA / KEPEGAWAIAN');
    const pageTitle = opts.title || 'Dashboard';
    const actionButton = opts.actionButton || '';

    return `
      <header class="navbar navbar-expand-md d-print-none sticky-top bg-white border-bottom shadow-xs py-2 px-3" id="slimHeader" style="z-index: 1020;">
        <div class="container-fluid d-flex align-items-center justify-content-between">
          
          <!-- Sisi Kiri: Hamburger Mobile & Breadcrumb / Judul -->
          <div class="d-flex align-items-center gap-2">
            <button class="navbar-toggler d-lg-none border-0 p-1" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Toggle Navigation">
              <i class="ti ti-menu-2 fs-2 text-dark"></i>
            </button>
            <div>
              <div class="text-uppercase fw-semibold text-secondary" style="font-size: 10px; letter-spacing: 0.5px;">
                ${breadcrumb}
              </div>
              <h2 class="page-title text-primary fw-bold mb-0 lh-1" style="font-size: 1.15rem;">
                ${pageTitle}
              </h2>
            </div>
          </div>

          <!-- Sisi Kanan: Live Date & Jam WITA + Tombol Aksi Halaman -->
          <div class="d-flex align-items-center gap-2">
            <!-- Live Clock WITA -->
            <div id="topbarLiveClockBadge" class="badge bg-secondary-lt text-secondary font-monospace px-2.5 py-1.5 d-none d-sm-inline-flex align-items-center" title="Waktu Indonesia Tengah (WITA)">
              <i class="ti ti-clock me-1.5"></i>
              <span id="topbarLiveClockText">--:--:-- WITA</span>
            </div>

            <!-- Tombol Aksi Halaman (Mis. Tambah Event khusus superadmin) -->
            ${actionButton}
          </div>

        </div>
      </header>
    `;
  },

  /**
   * Render Standard Footer
   */
  renderFooter() {
    return `
      <footer class="footer footer-transparent d-print-none mt-auto py-2.5 border-top bg-white">
        <div class="container-xl">
          <div class="row text-center align-items-center flex-row-reverse">
            <div class="col-lg-auto ms-lg-auto">
              <span class="small text-muted">Kementerian Pendidikan Dasar dan Menengah &bull; BPMP Sulawesi Tenggara</span>
            </div>
            <div class="col-12 col-lg-auto mt-2 mt-lg-0">
              <span class="small text-muted">
                <strong>Senin Berseri</strong> &copy; 2026 BPMP Sultra &bull; Presensi Aula, Verifikasi LPTI &amp; E-Sertifikat ASN
              </span>
            </div>
          </div>
        </div>
      </footer>
    `;
  },

  /**
   * Pengaturan Modal (Superadmin: Reset Data dengan konfirmasi RESET & log audit)
   */
  renderSettingsModal() {
    return `
      <div class="modal modal-blur fade" id="modalSystemSettings" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
          <div class="modal-content">
            <div class="modal-header bg-dark text-white py-2.5">
              <h5 class="modal-title text-white fw-bold">
                <i class="ti ti-settings me-2"></i> Pengaturan Sistem (Superadmin)
              </h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Tutup"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label fw-bold mb-1">Tautan Cepat Pengaturan</label>
                <div class="list-group list-group-flush border rounded">
                  <a href="/admin/kegiatan" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between py-2">
                    <span><i class="ti ti-calendar-event me-2 text-primary"></i> Manajemen Kegiatan Pelatihan</span>
                    <i class="ti ti-chevron-right text-muted"></i>
                  </a>
                  <a href="javascript:void(0)" onclick="BPMPLayout.openTemplateModal()" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between py-2">
                    <span><i class="ti ti-palette me-2 text-primary"></i> Katalog & Template E-Sertifikat</span>
                    <i class="ti ti-chevron-right text-muted"></i>
                  </a>
                  <a href="/admin/audit-log" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between py-2">
                    <span><i class="ti ti-history me-2 text-primary"></i> Log Aktivitas (Audit Trail)</span>
                    <i class="ti ti-chevron-right text-muted"></i>
                  </a>
                </div>
              </div>

              <!-- Bagian Reset Data Pengujian -->
              <div class="card bg-danger-lt border-danger p-3 mt-3">
                <div class="d-flex align-items-center gap-2 mb-2">
                  <i class="ti ti-alert-triangle text-danger fs-2"></i>
                  <h4 class="text-danger fw-bold mb-0">Reset Data Presensi &amp; LPTI</h4>
                </div>
                <p class="small text-danger mb-2">
                  Tindakan ini akan mengosongkan riwayat presensi aula, berkas LPTI, dan nomor sertifikat pengujian. <strong>104 data master ASN BPMP tetap aman.</strong>
                </p>
                <div class="mb-2">
                  <label class="form-label small fw-bold text-dark mb-1">
                    Ketik <span class="badge bg-danger text-white font-monospace">RESET</span> untuk konfirmasi:
                  </label>
                  <input type="text" id="inputResetConfirmation" class="form-control form-control-sm font-monospace text-uppercase" placeholder="Ketik RESET" oninput="BPMPLayout.checkResetInput(this.value)">
                </div>
                <button type="button" id="btnExecuteResetData" class="btn btn-danger btn-sm w-100 fw-bold" disabled onclick="BPMPLayout.executeResetData()">
                  <i class="ti ti-trash me-1"></i> Eksekusi Reset Data
                </button>
              </div>
            </div>
            <div class="modal-footer py-2">
              <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Tutup</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Modal Lookup Pegawai Cepat
   */
  renderLookupModal() {
    return `
      <div class="modal modal-blur fade" id="modalLookupPegawai" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" role="document">
          <div class="modal-content">
            <div class="modal-header py-2.5">
              <h5 class="modal-title fw-bold text-primary">
                <i class="ti ti-user-search me-2"></i> Cari Riwayat Pegawai ASN
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Tutup"></button>
            </div>
            <div class="modal-body p-3">
              <div class="input-icon mb-3">
                <span class="input-icon-addon"><i class="ti ti-search"></i></span>
                <input type="text" id="inputSearchLookupPegawai" class="form-control" placeholder="Cari nama atau NIP pegawai..." oninput="BPMPLayout.filterLookupPegawai(this.value)">
              </div>
              <div id="lookupPegawaiList" class="list-group list-group-flush border rounded" style="max-height: 350px; overflow-y: auto;">
                <div class="p-3 text-center text-muted">Memuat daftar pegawai...</div>
              </div>
            </div>
            <div class="modal-footer py-2">
              <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Tutup</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Setup Real-Time Clock WITA
   */
  startClock() {
    const update = () => {
      const now = new Date();
      // Format Jam WITA (UTC+8)
      const options = {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      const timeStr = now.toLocaleTimeString('id-ID', options).replace(/\./g, ':');
      const dateStr = now.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Makassar',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });

      const clockEl = document.getElementById('topbarLiveClockText');
      if (clockEl) {
        clockEl.textContent = `${dateStr} • ${timeStr} WITA`;
      }
      const pageClock = document.getElementById('textLastUpdated') || document.getElementById('liveClockBadge');
      if (pageClock && pageClock.id === 'textLastUpdated') {
        pageClock.textContent = `${timeStr} WITA`;
      }
    };

    update();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = setInterval(update, 1000);
  },

  /**
   * Ambil dan Sinkronkan Event Aktif Global
   */
  async initGlobalEvents() {
    try {
      const res = await fetch('/api/event');
      const data = await res.json();
      if (!data.success) return;

      this.cachedEvents = data.events || [];
      const select = document.getElementById('sidebarGlobalEventSelect');
      if (!select) return;

      select.innerHTML = '';
      if (this.cachedEvents.length === 0) {
        select.innerHTML = '<option value="">Tidak ada kegiatan aktif</option>';
        return;
      }

      // Ambil yang tersimpan di sesi
      const savedId = localStorage.getItem('bpmp_selected_event_id') || sessionStorage.getItem('bpmp_selected_event_id');
      let targetId = savedId;

      // Jika tidak ada di storage, pilih activeEvent dari server
      const serverActive = data.event || this.cachedEvents.find(e => e.status === 'aktif' || e.is_active) || this.cachedEvents[0];
      if (!targetId && serverActive) {
        targetId = String(serverActive.id);
        localStorage.setItem('bpmp_selected_event_id', targetId);
        sessionStorage.setItem('bpmp_selected_event_id', targetId);
      }

      this.cachedEvents.forEach(ev => {
        const opt = document.createElement('option');
        opt.value = ev.id;
        opt.textContent = `${ev.status === 'aktif' || ev.is_active ? '● ' : ''}${ev.title || ev.nama || 'Pelatihan'}`;
        if (String(ev.id) === String(targetId)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      // Update badge status
      this.updateEventBadge(targetId);

    } catch (e) {
      console.warn('Gagal memuat event global:', e);
    }
  },

  updateEventBadge(eventId) {
    const badge = document.getElementById('sidebarEventStatusBadge');
    if (!badge) return;
    const ev = this.cachedEvents.find(e => String(e.id) === String(eventId));
    if (ev && (ev.status === 'aktif' || ev.is_active)) {
      badge.className = 'badge bg-green text-green-fg';
      badge.textContent = 'Aktif';
    } else {
      badge.className = 'badge bg-secondary text-white';
      badge.textContent = 'Arsip';
    }
  },

  /**
   * Event Listener saat user ganti Event Aktif di sidebar
   */
  onGlobalEventChange(eventId) {
    if (!eventId) return;
    localStorage.setItem('bpmp_selected_event_id', eventId);
    sessionStorage.setItem('bpmp_selected_event_id', eventId);
    this.updateEventBadge(eventId);

    // Pancarkan event custom ke halaman aktif
    window.dispatchEvent(new CustomEvent('bpmp:eventChanged', { detail: { eventId } }));

    // Sinkronkan dropdown lokal di halaman jika ada
    const localSelect = document.getElementById('filterEventSelect') || document.getElementById('filterKegiatan');
    if (localSelect && localSelect.value !== eventId) {
      localSelect.value = eventId;
      localSelect.dispatchEvent(new Event('change'));
    }
  },

  /**
   * Cek pending LPTI untuk badge sidebar
   */
  async updateLptiPendingCount() {
    try {
      const res = await fetch('/api/admin/verifikasi-lpti?status=perlu_dikurasi&limit=1');
      const data = await res.json();
      if (data.success && typeof data.total === 'number') {
        this.lptiPendingCount = data.total;
        const badge = document.getElementById('sidebarBadgeLptiPending');
        if (badge) badge.textContent = data.total;
      }
    } catch (_) {}
  },

  /**
   * Open Settings Modal
   */
  openSettingsModal() {
    const el = document.getElementById('modalSystemSettings');
    if (el) {
      const modal = new window.bootstrap.Modal(el);
      modal.show();
    }
  },

  /**
   * Open Template Modal
   */
  openTemplateModal() {
    if (typeof window.openTemplateManagerModal === 'function') {
      window.openTemplateManagerModal();
    } else {
      window.location.href = '/admin#template';
    }
  },

  /**
   * Open Admin Accounts Modal
   */
  openAdminAccountManager() {
    if (typeof window.openAdminAccountManagerModal === 'function') {
      window.openAdminAccountManagerModal();
    } else {
      window.location.href = '/superadmin';
    }
  },

  /**
   * Open Lookup Pegawai Modal
   */
  cachedLookupEmployees: [],
  async openLookupPegawai() {
    const el = document.getElementById('modalLookupPegawai');
    if (!el) return;
    const modal = new window.bootstrap.Modal(el);
    modal.show();

    const listEl = document.getElementById('lookupPegawaiList');
    if (this.cachedLookupEmployees.length === 0) {
      try {
        listEl.innerHTML = '<div class="p-3 text-center text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Memuat data ASN...</div>';
        const res = await fetch('/api/employees');
        const data = await res.json();
        this.cachedLookupEmployees = (data.employees || data || []);
      } catch (e) {
        listEl.innerHTML = '<div class="p-3 text-danger text-center">Gagal memuat data pegawai.</div>';
        return;
      }
    }
    this.renderLookupList(this.cachedLookupEmployees);
  },

  renderLookupList(list) {
    const listEl = document.getElementById('lookupPegawaiList');
    if (!listEl) return;
    if (!list || list.length === 0) {
      listEl.innerHTML = '<div class="p-3 text-center text-muted">Pegawai tidak ditemukan.</div>';
      return;
    }
    listEl.innerHTML = list.slice(0, 50).map(emp => `
      <a href="/admin/pegawai/${emp.id || emp.nip}" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between py-2">
        <div>
          <div class="fw-bold text-dark small">${escapeHtml(emp.name)}</div>
          <div class="text-muted" style="font-size: 11px;">NIP. ${escapeHtml(emp.nip)} &bull; ${escapeHtml(emp.unit_kerja || emp.department || 'BPMP Sultra')}</div>
        </div>
        <i class="ti ti-arrow-right text-primary"></i>
      </a>
    `).join('');
  },

  filterLookupPegawai(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      this.renderLookupList(this.cachedLookupEmployees);
      return;
    }
    const filtered = this.cachedLookupEmployees.filter(e => 
      (e.name || '').toLowerCase().includes(q) || (e.nip || '').includes(q)
    );
    this.renderLookupList(filtered);
  },

  /**
   * Reset Data Validasi & Eksekusi
   */
  checkResetInput(val) {
    const btn = document.getElementById('btnExecuteResetData');
    if (btn) {
      btn.disabled = val.trim().toUpperCase() !== 'RESET';
    }
  },

  async executeResetData() {
    const input = document.getElementById('inputResetConfirmation');
    if (!input || input.value.trim().toUpperCase() !== 'RESET') {
      alert('Ketik RESET untuk mengonfirmasi reset data.');
      return;
    }

    if (!confirm('PERINGATAN TERAKHIR: Seluruh data presensi dan kurasi LPTI pengujian akan dikosongkan. Lanjutkan?')) {
      return;
    }

    const btn = document.getElementById('btnExecuteResetData');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Mereset...';
    }

    try {
      const token = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');
      const res = await fetch('/api/reset-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ confirmation: 'RESET' })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'Reset data pengujian berhasil!');
        window.location.reload();
      } else {
        alert(data.message || 'Gagal mereset data.');
      }
    } catch (e) {
      alert('Terjadi kesalahan saat memproses reset data: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-trash me-1"></i> Eksekusi Reset Data';
      }
    }
  },

  /**
   * Inisialisasi Layout pada Halaman
   */
  init(opts = {}) {
    const role = opts.role || this.getUserRole();
    const isSuper = role === 'superadmin';

    // 1. Sidebar Container
    const sidebarEl = document.getElementById('app-sidebar') || document.getElementById('sidebar-container') || document.getElementById('bpmp-sidebar');
    if (sidebarEl) {
      sidebarEl.innerHTML = this.renderSidebar({ ...opts, role });
    }

    // 2. Slim Topbar Header
    const topbarEl = document.getElementById('app-topbar') || document.getElementById('topbar-container') || document.getElementById('bpmp-header');
    if (topbarEl) {
      topbarEl.innerHTML = this.renderSlimHeader({ ...opts, role });
    }

    // 3. Fallback jika halaman lama masih menggunakan #bpmp-navbar atau #app-navbar
    const legacyNavbar = document.getElementById('bpmp-navbar') || document.getElementById('app-navbar');
    if (legacyNavbar && !sidebarEl) {
      // Jika halaman lama belum punya sidebar-container, render sidebar dan topbar di sini
      legacyNavbar.innerHTML = this.renderSidebar({ ...opts, role }) + this.renderSlimHeader({ ...opts, role });
    }

    // 4. Bersihkan banner instansi 3-lapis (#bpmp-top-strip / #app-topstrip)
    const topStrip = document.getElementById('bpmp-top-strip') || document.getElementById('app-topstrip');
    if (topStrip) {
      topStrip.innerHTML = ''; // Hapus banner 3 lapis
    }

    // 5. Footer Container
    const footerEl = document.getElementById('app-footer') || document.getElementById('bpmp-footer');
    if (footerEl) {
      footerEl.innerHTML = this.renderFooter();
    }

    // 6. Pasang Modal Pengaturan & Lookup di Body jika belum ada
    if (!document.getElementById('modalSystemSettings') && isSuper) {
      document.body.insertAdjacentHTML('beforeend', this.renderSettingsModal());
    }
    if (!document.getElementById('modalLookupPegawai')) {
      document.body.insertAdjacentHTML('beforeend', this.renderLookupModal());
    }

    // 7. Jalankan Jam WITA
    this.startClock();

    // 8. Inisialisasi Event Global di Sidebar
    this.initGlobalEvents();

    // 9. Update badge LPTI pending
    this.updateLptiPendingCount();
  }
};

// Global Fallback untuk handleLogout
if (typeof window.handleLogout !== 'function') {
  window.handleLogout = async function() {
    const token = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');
    try {
      if (token) {
        await fetch('/api/auth/admin-logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (_) {}
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminUser');
    localStorage.removeItem('bpmp_auth_nip');
    localStorage.removeItem('bpmp_auth_user');
    sessionStorage.removeItem('bpmp_auth_user');
    document.cookie = 'admin_token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.replace('/admin/login');
  };
}

window.BPMPLayout = BPMPLayout;
