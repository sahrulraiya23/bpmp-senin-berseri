/**
 * BPMP Senin Berseri — Shared Layout System (Tabler Vertical Layout — Light Theme)
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
  showArchivedEvents: false,
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
   * Toggle Sidebar Collapsed Mode (260px <-> 72px icon mode)
   */
  toggleSidebarCollapse() {
    const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('bpmp_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    const icon = document.getElementById('btnToggleCollapseIcon');
    if (icon) {
      icon.className = isCollapsed ? 'ti ti-layout-sidebar-left-expand fs-3' : 'ti ti-layout-sidebar-left-collapse fs-3';
    }
  },

  /**
   * Render Sidebar Tabler Vertical Layout (Tema Terang: Latar Putih Bersih #FFFFFF, Border #E5E7EB, Lebar 260px)
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
        <li class="nav-item-header bpmp-group-title">
          ${groupName}
        </li>
      `;

      groupItems.forEach(item => {
        const isActive = item.id === activeMenu;
        const activeClass = isActive ? 'active' : '';
        const targetAttr = item.target ? `target="${item.target}"` : '';
        const onclickAttr = item.onclick ? `onclick="${item.onclick}"` : '';

        let badgeHtml = '';
        if (item.badgeKey === 'lptiPending') {
          const badgeStyle = this.lptiPendingCount > 0 
            ? 'background-color: #FEF3C7; color: #92400E; border: 1px solid #FCD34D;' 
            : 'background-color: #F3F4F6; color: #6B7280; border: 1px solid #E5E7EB;';
          badgeHtml = `<span id="sidebarBadgeLptiPending" class="badge ms-auto font-monospace px-1.5 py-0.5 rounded-pill" style="${badgeStyle} font-size: 10.5px;">${this.lptiPendingCount}</span>`;
        }

        menuHtml += `
          <li class="nav-item">
            <a class="bpmp-nav-link ${activeClass}" href="${item.href}" ${targetAttr} ${onclickAttr}>
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
    const roleLabel = isSuper ? 'Super Administrator' : 'Bagian Kepegawaian';

    return `
      <aside class="navbar navbar-vertical navbar-expand-lg d-print-none" id="sidebarMenu" style="z-index: 1030; background: #ffffff !important; background-color: #ffffff !important; border-right: 1px solid #E5E7EB !important;">
        <div class="container-fluid px-0 h-100 d-flex flex-column" style="background-color: #ffffff !important;">
          
          <!-- Mobile Toggle Button (Drawer) -->
          <div class="d-lg-none d-flex justify-content-between align-items-center px-3 py-2 border-bottom" style="border-color: #E5E7EB !important; background-color: #ffffff !important;">
            <span class="fw-bold text-dark small">Menu Navigasi</span>
            <button class="navbar-toggler border-0 p-1" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Tutup Menu">
              <i class="ti ti-x fs-2 text-dark"></i>
            </button>
          </div>

          <!-- Brand Logo & Instansi (Latar Putih, Teks #0056b3) -->
          <div class="navbar-brand px-3 py-3 d-flex align-items-center justify-content-between" style="background-color: #ffffff !important;">
            <a href="/admin" class="d-flex align-items-center text-decoration-none">
              <img src="/icons/tutwurihandayani.png" alt="Kemendikdasmen" width="34" height="34" class="me-2 flex-shrink-0" style="object-fit: contain;">
              <div class="brand-text-hide d-flex flex-column text-start lh-sm">
                <span class="fw-bold" style="font-size: 13.5px; letter-spacing: -0.2px; color: #0056b3;">Kemendikdasmen</span>
                <span style="font-size: 10px; letter-spacing: 0.1px; color: #6B7280;">BPMP Sultra</span>
              </div>
            </a>
          </div>

          <!-- Pemilih Event Aktif Global (Latar Terang, Tanpa Badge Arsip, Ada Checkbox Tampilkan Arsip) -->
          <div class="sidebar-event-selector px-3 py-2.5 mb-1 border-top border-bottom" style="border-color: #E5E7EB !important; background-color: #F9FAFB !important;">
            <label for="sidebarGlobalEventSelect" class="form-label text-uppercase fw-bold mb-1 d-flex justify-content-between align-items-center" style="font-size: 10px; letter-spacing: 0.5px; color: #6B7280;">
              <span><i class="ti ti-calendar-event me-1"></i> EVENT AKTIF</span>
            </label>
            <select id="sidebarGlobalEventSelect" class="form-select form-select-sm bg-white border" style="font-size: 11.5px; border-color: #D1D5DB; color: #1F2937; cursor: pointer;" onchange="BPMPLayout.onGlobalEventChange(this.value)">
              <option value="">Memuat kegiatan...</option>
            </select>
            <div class="form-check form-check-inline mt-1.5 mb-0" style="min-height: auto;">
              <input class="form-check-input" type="checkbox" id="chkShowArchivedEvents" style="cursor: pointer; width: 13px; height: 13px; margin-top: 3px;" onchange="BPMPLayout.toggleArchivedEvents(this.checked)">
              <label class="form-check-label small" for="chkShowArchivedEvents" style="font-size: 11px; cursor: pointer; user-select: none; color: #6B7280 !important;">
                Tampilkan arsip
              </label>
            </div>
          </div>

          <!-- Menu Items Collapsible -->
          <div class="collapse navbar-collapse flex-grow-1" id="sidebar-menu" style="background-color: #ffffff !important;">
            <ul class="navbar-nav pt-lg-1 w-100 flex-grow-1 overflow-y-auto" style="background-color: #ffffff !important;">
              ${menuHtml}
            </ul>

            <!-- Sidebar Footer: Avatar + Nama (Truncated) + Peran (Teks Kecil, Bukan Badge) + Tombol Keluar Tautan Teks Merah -->
            <div class="sidebar-footer mt-auto p-3 border-top w-100" style="border-color: #E5E7EB !important; background-color: #FAFAFA !important;">
              <div class="d-flex align-items-center gap-2 mb-2">
                <span class="avatar avatar-sm bg-primary text-white fw-bold flex-shrink-0" id="sidebarUserAvatar">${initial}</span>
                <div class="sidebar-user-details text-truncate flex-grow-1" style="min-width: 0;">
                  <div class="fw-bold small text-truncate" id="sidebarUserName" style="color: #111827;" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
                  <div class="small text-truncate" id="sidebarUserRoleDisplay" style="color: #6B7280; font-size: 11px;">${roleLabel}</div>
                </div>
              </div>
              <div class="sidebar-user-details d-flex align-items-center justify-content-between pt-1 border-top" style="border-color: #F3F4F6 !important;">
                ${isSuper ? `
                  <a href="javascript:void(0)" onclick="BPMPLayout.openSettingsModal()" class="small text-decoration-none d-inline-flex align-items-center gap-1 text-secondary" style="font-size: 11.5px;" title="Pengaturan Sistem & Reset Data">
                    <i class="ti ti-settings fs-4"></i> Pengaturan
                  </a>
                ` : '<div></div>'}
                <a href="javascript:void(0)" onclick="handleLogout()" class="small text-decoration-none d-inline-flex align-items-center gap-1 text-danger fw-semibold" style="font-size: 11.5px;" title="Keluar dari sesi admin">
                  <i class="ti ti-logout fs-4"></i> Keluar
                </a>
              </div>
            </div>
          </div>

        </div>
      </aside>
    `;
  },

  /**
   * Render Topbar Tipis (Judul/Breadcrumb di kiri, Tanggal + Jam WITA di kanan, Tombol Aksi bila ada)
   */
  renderSlimHeader(opts = {}) {
    const role = (opts.role || this.getUserRole()).toLowerCase();
    const isSuper = role === 'superadmin';
    const breadcrumb = opts.breadcrumb || (isSuper ? 'BPMP SULTRA / SUPERADMIN' : 'BPMP SULTRA / KEPEGAWAIAN');
    const pageTitle = opts.title || 'Dashboard';
    const actionButton = opts.actionButton || '';

    return `
      <header class="navbar navbar-expand-md d-print-none sticky-top bg-white border-bottom shadow-xs py-2 px-3" id="slimHeader" style="z-index: 1020; border-color: #E5E7EB !important;">
        <div class="container-fluid px-0 d-flex align-items-center justify-content-between">
          
          <!-- Sisi Kiri: Hamburger Mobile & Desktop Collapse Toggle & Breadcrumb / Judul -->
          <div class="d-flex align-items-center gap-2">
            <!-- Mobile Drawer Button (< 992px) -->
            <button class="navbar-toggler d-lg-none border-0 p-1" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Buka Menu">
              <i class="ti ti-menu-2 fs-2 text-dark"></i>
            </button>

            <!-- Desktop Collapse Toggle Button (>= 992px) -->
            <button class="btn btn-ghost-secondary btn-icon btn-sm d-none d-lg-inline-flex text-muted border-0" type="button" onclick="BPMPLayout.toggleSidebarCollapse()" title="Kecilkan / Perluas Sidebar">
              <i class="ti ti-layout-sidebar-left-collapse fs-3" id="btnToggleCollapseIcon"></i>
            </button>

            <div>
              <div class="text-uppercase fw-semibold" style="font-size: 10px; letter-spacing: 0.5px; color: #6B7280;">
                ${breadcrumb}
              </div>
              <h2 class="page-title fw-bold mb-0 lh-1" style="font-size: 1.15rem; color: #0056b3 !important;">
                ${pageTitle}
              </h2>
            </div>
          </div>

          <!-- Sisi Kanan: Live Date & Jam WITA + Tombol Aksi Halaman -->
          <div class="d-flex align-items-center gap-2">
            <!-- Live Clock WITA -->
            <div id="topbarLiveClockBadge" class="badge font-monospace px-2.5 py-1.5 d-none d-sm-inline-flex align-items-center" style="background-color: #F3F4F6; color: #374151; border: 1px solid #E5E7EB;" title="Waktu Indonesia Tengah (WITA)">
              <i class="ti ti-clock me-1.5 text-muted"></i>
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
      <footer class="footer footer-transparent d-print-none mt-auto py-2.5 border-top bg-white" style="border-color: #E5E7EB !important;">
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
            <div class="modal-header py-2.5 border-bottom" style="background-color: #F8FAFC; border-color: #E5E7EB !important;">
              <h5 class="modal-title fw-bold text-dark">
                <i class="ti ti-settings me-2 text-primary"></i> Pengaturan Sistem (Superadmin)
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Tutup"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label fw-bold mb-1 text-dark">Tautan Cepat Pengaturan</label>
                <div class="list-group list-group-flush border rounded" style="border-color: #E5E7EB !important;">
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
   * Render Event Options pada dropdown berdasarkan status dan toggle arsip
   */
  renderEventOptions() {
    const select = document.getElementById('sidebarGlobalEventSelect');
    if (!select) return;

    select.innerHTML = '';
    if (this.cachedEvents.length === 0) {
      select.innerHTML = '<option value="">Tidak ada kegiatan</option>';
      return;
    }

    // Default: hanya event aktif (status === 'aktif' || is_active || active || status !== 'completed' && status !== 'arsip')
    let displayList = this.cachedEvents;
    if (!this.showArchivedEvents) {
      displayList = this.cachedEvents.filter(e => e.status === 'aktif' || e.is_active || e.active || (e.status !== 'completed' && e.status !== 'arsip'));
      // Jika tidak ada yang aktif sama sekali, fallback ke seluruh event
      if (displayList.length === 0) {
        displayList = this.cachedEvents;
      }
    }

    const savedId = localStorage.getItem('bpmp_selected_event_id') || sessionStorage.getItem('bpmp_selected_event_id');
    let targetId = savedId;
    if (!targetId && displayList[0]) {
      targetId = String(displayList[0].id);
      localStorage.setItem('bpmp_selected_event_id', targetId);
      sessionStorage.setItem('bpmp_selected_event_id', targetId);
    }

    displayList.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev.id;
      const isActive = ev.status === 'aktif' || ev.is_active || ev.active;
      opt.textContent = `${isActive ? '● ' : ''}${ev.title || ev.nama || 'Pelatihan'}`;
      if (String(ev.id) === String(targetId)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  },

  /**
   * Toggle Tampilkan Arsip Kegiatan
   */
  toggleArchivedEvents(checked) {
    this.showArchivedEvents = Boolean(checked);
    localStorage.setItem('bpmp_show_archived', this.showArchivedEvents ? 'true' : 'false');
    this.renderEventOptions();
  },

  /**
   * Ambil dan Sinkronkan Event Aktif Global
   */
  async initGlobalEvents() {
    try {
      this.showArchivedEvents = localStorage.getItem('bpmp_show_archived') === 'true';
      const chk = document.getElementById('chkShowArchivedEvents');
      if (chk) chk.checked = this.showArchivedEvents;

      const res = await fetch('/api/event');
      const data = await res.json();
      if (!data.success) return;

      this.cachedEvents = data.events || [];
      this.renderEventOptions();
    } catch (e) {
      console.warn('Gagal memuat event global:', e);
    }
  },

  /**
   * Event Listener saat user ganti Event Aktif di sidebar
   */
  onGlobalEventChange(eventId) {
    if (!eventId) return;
    localStorage.setItem('bpmp_selected_event_id', eventId);
    sessionStorage.setItem('bpmp_selected_event_id', eventId);

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
   * Kuning bila >0 (#FEF3C7, teks #92400E, border #FCD34D), abu bila 0 (#F3F4F6, teks #6B7280, border #E5E7EB)
   */
  async updateLptiPendingCount() {
    try {
      const res = await fetch('/api/admin/verifikasi-lpti?status=perlu_dikurasi&limit=1');
      const data = await res.json();
      if (data.success && typeof data.total === 'number') {
        this.lptiPendingCount = data.total;
        const badge = document.getElementById('sidebarBadgeLptiPending');
        if (badge) {
          badge.textContent = data.total;
          if (data.total > 0) {
            badge.style.backgroundColor = '#FEF3C7';
            badge.style.color = '#92400E';
            badge.style.border = '1px solid #FCD34D';
          } else {
            badge.style.backgroundColor = '#F3F4F6';
            badge.style.color = '#6B7280';
            badge.style.border = '1px solid #E5E7EB';
          }
        }
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
   * Cek Apakah Halaman Saat Ini Adalah Halaman Dashboard Admin
   * Sidebar Tabler Vertical HANYA boleh tampil di halaman Admin.
   */
  isAdminPage(opts = {}) {
    if (opts.hasSidebar === false || opts.isAdminPage === false) return false;
    if (opts.hasSidebar === true || opts.isAdminPage === true) return true;

    const path = (window.location.pathname || '').toLowerCase();
    // Halaman login admin BUKAN dashboard admin (tidak boleh ada sidebar)
    if (path === '/admin/login' || path.startsWith('/admin/login')) return false;

    // Halaman rute admin resmi
    if (path.startsWith('/admin') || path.startsWith('/superadmin')) {
      return true;
    }

    // Periksa jika dokumen secara eksplisit memiliki kontainer sidebar admin
    const hasAdminSidebarContainer = !!(document.getElementById('app-sidebar') || document.getElementById('sidebar-container'));
    const role = (opts.role || this.getUserRole() || '').toLowerCase();
    if (hasAdminSidebarContainer && (role === 'admin' || role === 'superadmin' || role === 'kepegawaian')) {
      // Pastikan bukan halaman publik
      const publicPaths = ['/', '/index.html', '/login', '/login.html', '/proyektor', '/qr', '/sertifikat', '/verify'];
      if (publicPaths.some(p => path === p || (p !== '/' && path.startsWith(p)))) {
        return false;
      }
      return true;
    }

    return false;
  },

  /**
   * Injeksi CSS Layout & Tema Terang Sidebar Langsung ke Dokumen
   * Semua offset & aturan sidebar di-scope ketat ke body.has-admin-sidebar
   */
  injectLayoutStyles() {
    if (document.getElementById('bpmp-injected-layout-styles')) return;
    const style = document.createElement('style');
    style.id = 'bpmp-injected-layout-styles';
    style.textContent = `
      :root {
        --bpmp-sidebar-w: 260px;
        --bpmp-sidebar-collapsed-w: 72px;
      }

      html, body {
        overflow-x: hidden !important;
      }

      /* HANYA HALAMAN ADMIN (body.has-admin-sidebar) */
      body.has-admin-sidebar #app-sidebar,
      body.has-admin-sidebar #sidebar-container,
      body.has-admin-sidebar #bpmp-sidebar {
        display: block;
      }

      /* HALAMAN NON-ADMIN (Landing Page, Portal Pegawai, Sertifikat, Login): SEMBUNYIKAN SIDEBAR TOTAL */
      body:not(.has-admin-sidebar) #app-sidebar,
      body:not(.has-admin-sidebar) #sidebar-container,
      body:not(.has-admin-sidebar) #bpmp-sidebar,
      body:not(.has-admin-sidebar) #sidebarMenu,
      body:not(.has-admin-sidebar) aside.navbar-vertical {
        display: none !important;
      }

      /* HALAMAN NON-ADMIN: Konten 100% lebar tanpa offset margin kiri */
      body:not(.has-admin-sidebar) .page-wrapper {
        margin-left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }

      /* Sidebar Admin (Latar Putih Bersih / Theme Light) */
      #sidebarMenu,
      .navbar-vertical.navbar-expand-lg {
        background-color: #ffffff !important;
        border-right: 1px solid #E5E7EB !important;
      }

      @media (min-width: 992px) {
        body.has-admin-sidebar #sidebarMenu,
        body.has-admin-sidebar .navbar-vertical.navbar-expand-lg {
          width: var(--bpmp-sidebar-w) !important;
          position: fixed !important;
          top: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
          z-index: 1030 !important;
          background-color: #ffffff !important;
          border-right: 1px solid #E5E7EB !important;
          box-shadow: none !important;
          transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        body.has-admin-sidebar .page-wrapper {
          margin-left: var(--bpmp-sidebar-w) !important;
          width: calc(100% - var(--bpmp-sidebar-w)) !important;
          max-width: calc(100% - var(--bpmp-sidebar-w)) !important;
          min-height: 100vh;
          transition: margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1), width 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          display: flex;
          flex-direction: column;
        }

        /* Mode Ikon Collapsed */
        body.has-admin-sidebar.sidebar-collapsed #sidebarMenu,
        body.has-admin-sidebar.sidebar-collapsed .navbar-vertical.navbar-expand-lg {
          width: var(--bpmp-sidebar-collapsed-w) !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .page-wrapper {
          margin-left: var(--bpmp-sidebar-collapsed-w) !important;
          width: calc(100% - var(--bpmp-sidebar-collapsed-w)) !important;
          max-width: calc(100% - var(--bpmp-sidebar-collapsed-w)) !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .sidebar-hide-collapsed,
        body.has-admin-sidebar.sidebar-collapsed .bpmp-group-title,
        body.has-admin-sidebar.sidebar-collapsed .sidebar-event-selector,
        body.has-admin-sidebar.sidebar-collapsed .sidebar-user-details,
        body.has-admin-sidebar.sidebar-collapsed .nav-link-title,
        body.has-admin-sidebar.sidebar-collapsed #sidebarBadgeLptiPending {
          display: none !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .navbar-brand {
          justify-content: center !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .navbar-brand .brand-text-hide {
          display: none !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .bpmp-nav-link {
          justify-content: center !important;
          padding: 0.65rem 0.5rem !important;
          margin: 0.15rem 0.35rem !important;
          border-left: 3px solid transparent !important;
          border-radius: 6px !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .bpmp-nav-link.active {
          border-left: 3px solid #1D4ED8 !important;
          border-radius: 0 6px 6px 0 !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .bpmp-nav-link .nav-link-icon {
          margin-right: 0 !important;
        }

        body.has-admin-sidebar.sidebar-collapsed .sidebar-footer {
          padding: 0.75rem 0.25rem !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
        }
      }

      @media (max-width: 991.98px) {
        body.has-admin-sidebar .page-wrapper {
          margin-left: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
        }

        body.has-admin-sidebar #sidebarMenu,
        body.has-admin-sidebar .navbar-vertical.navbar-expand-lg {
          width: 260px !important;
          background-color: #ffffff !important;
          border-right: 1px solid #E5E7EB !important;
        }
      }

      /* Nav Item Link Styling Tema Terang */
      .bpmp-nav-link {
        color: #374151 !important;
        font-weight: 500;
        font-size: 0.85rem;
        padding: 0.55rem 0.75rem !important;
        border-radius: 0.375rem;
        margin: 0.1rem 0.5rem;
        transition: all 0.15s ease;
        border-left: 3px solid transparent;
        display: flex;
        align-items: center;
        text-decoration: none !important;
      }

      .bpmp-nav-link .nav-link-icon {
        color: #6B7280 !important;
        transition: color 0.15s ease;
      }

      .bpmp-nav-link:hover {
        background-color: #F3F4F6 !important;
        color: #111827 !important;
      }

      .bpmp-nav-link:hover .nav-link-icon {
        color: #374151 !important;
      }

      .bpmp-nav-link.active {
        background-color: #E8F0FE !important;
        color: #1D4ED8 !important;
        border-left: 3px solid #1D4ED8 !important;
        font-weight: 600 !important;
        border-radius: 0 0.375rem 0.375rem 0 !important;
      }

      .bpmp-nav-link.active .nav-link-icon {
        color: #1D4ED8 !important;
      }

      .bpmp-group-title {
        text-transform: uppercase;
        color: #9CA3AF !important;
        font-size: 10px !important;
        letter-spacing: 0.8px;
        font-weight: 700;
        padding: 0.85rem 1rem 0.25rem 1rem;
        user-select: none;
      }
    `;
    document.head.appendChild(style);
  },

  /**
   * Inisialisasi Layout pada Halaman
   */
  init(opts = {}) {
    this.injectLayoutStyles();

    const isAdmin = this.isAdminPage(opts);
    const role = opts.role || (isAdmin ? this.getUserRole() : 'pegawai');
    const isSuper = role === 'superadmin';

    if (isAdmin) {
      // 1. Terapkan kelas body khusus Admin
      document.body.classList.add('has-admin-sidebar');

      // Pulihkan status collapse sidebar dari localStorage
      if (localStorage.getItem('bpmp_sidebar_collapsed') === 'true') {
        document.body.classList.add('sidebar-collapsed');
      } else {
        document.body.classList.remove('sidebar-collapsed');
      }

      // 2. Sidebar Container (HANYA UNTUK ADMIN)
      const sidebarEl = document.getElementById('app-sidebar') || document.getElementById('sidebar-container') || document.getElementById('bpmp-sidebar');
      if (sidebarEl) {
        sidebarEl.style.display = 'block';
        sidebarEl.innerHTML = this.renderSidebar({ ...opts, role });
      }

      // 3. Slim Topbar Header (HANYA UNTUK ADMIN)
      const topbarEl = document.getElementById('app-topbar') || document.getElementById('topbar-container') || document.getElementById('bpmp-header');
      if (topbarEl) {
        topbarEl.innerHTML = this.renderSlimHeader({ ...opts, role });
      }

      // Update icon toggle collapse jika ada
      const toggleIcon = document.getElementById('btnToggleCollapseIcon');
      if (toggleIcon) {
        toggleIcon.className = document.body.classList.contains('sidebar-collapsed')
          ? 'ti ti-layout-sidebar-left-expand fs-3'
          : 'ti ti-layout-sidebar-left-collapse fs-3';
      }

      // 4. Modal Pengaturan & Lookup Pegawai (Superadmin)
      if (!document.getElementById('modalSystemSettings') && isSuper) {
        document.body.insertAdjacentHTML('beforeend', this.renderSettingsModal());
      }
      if (!document.getElementById('modalLookupPegawai')) {
        document.body.insertAdjacentHTML('beforeend', this.renderLookupModal());
      }

      // 5. Jalankan Jam WITA & Selector Event Global
      this.startClock();
      this.initGlobalEvents();
      this.updateLptiPendingCount();
    } else {
      // HALAMAN NON-ADMIN (Beranda, Portal Pegawai, Proyektor, Sertifikat, Login):
      // Bersihkan class dan pastikan sidebar TIDAK ADA sama sekali
      document.body.classList.remove('has-admin-sidebar', 'sidebar-collapsed');

      const sidebarEl = document.getElementById('app-sidebar') || document.getElementById('sidebar-container') || document.getElementById('bpmp-sidebar');
      if (sidebarEl) {
        sidebarEl.innerHTML = '';
        sidebarEl.style.display = 'none';
      }
      const existingSidebar = document.getElementById('sidebarMenu');
      if (existingSidebar) {
        existingSidebar.remove();
      }
    }

    // Bersihkan banner instansi 3-lapis lama (#bpmp-top-strip / #app-topstrip)
    const topStrip = document.getElementById('bpmp-top-strip') || document.getElementById('app-topstrip');
    if (topStrip) {
      topStrip.innerHTML = '';
    }

    // Bersihkan legacy navbar kosong agar tidak mengganggu layout
    const legacyNavbar = document.getElementById('bpmp-navbar') || document.getElementById('app-navbar');
    if (legacyNavbar && !isAdmin) {
      legacyNavbar.innerHTML = '';
    }

    // Footer Container (Bisa dimuat di semua halaman)
    const footerEl = document.getElementById('app-footer') || document.getElementById('bpmp-footer');
    if (footerEl) {
      footerEl.innerHTML = this.renderFooter();
    }
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
