/**
 * BPMP Senin Berseri — Shared Layout System (Tabler Bootstrap 5)
 * Satu konfigurasi menu untuk semua peran (Pegawai, Admin, Superadmin).
 */

const BPMPLayout = {
  // Menu configuration per role
  menuConfig: {
    pegawai: [
      { id: 'home', label: 'Beranda', href: '/', icon: 'ti-home' },
      { id: 'dashboard', label: 'Portal ASN', href: '/login', icon: 'ti-id-badge' },
      { id: 'sertifikat', label: 'Cek Sertifikat', href: '/sertifikat', icon: 'ti-certificate' },
      { id: 'verif-wajah', label: 'Registrasi Wajah', href: '/verif-wajah', icon: 'ti-scan' },
      { id: 'proyektor', label: 'Layar Aula', href: '/proyektor', icon: 'ti-device-projector', target: '_blank' }
    ],
    admin: [
      { id: 'admin-dashboard', label: 'Dashboard Presensi', href: '/admin', icon: 'ti-layout-dashboard' },
      { id: 'sertifikat', label: 'Cek Sertifikat', href: '/sertifikat', icon: 'ti-certificate', target: '_blank' },
      { id: 'proyektor', label: 'Layar Aula', href: '/proyektor', icon: 'ti-device-projector', target: '_blank' },
      { id: 'pegawai', label: 'Portal ASN', href: '/login', icon: 'ti-user', target: '_blank' },
      { id: 'home', label: 'Beranda Portal', href: '/', icon: 'ti-home', target: '_blank' }
    ],
    superadmin: [
      { id: 'superadmin-summary', label: 'Konsol Superadmin', href: '/superadmin', icon: 'ti-shield-lock' },
      { id: 'admin', label: 'Dashboard Kepegawaian', href: '/admin', icon: 'ti-layout-dashboard' },
      { id: 'sertifikat', label: 'Cek Sertifikat', href: '/sertifikat', icon: 'ti-certificate', target: '_blank' },
      { id: 'proyektor', label: 'Layar Aula', href: '/proyektor', icon: 'ti-device-projector', target: '_blank' },
      { id: 'home', label: 'Beranda Portal', href: '/', icon: 'ti-home', target: '_blank' }
    ]
  },

  /**
   * Render Top Government Strip
   */
  renderTopStrip() {
    const today = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    return `
      <div class="gov-top-strip d-print-none">
        <div class="container-xl d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2 text-truncate">
            <span class="badge bg-primary text-white" style="font-size: 9px; padding: 2px 6px;">RESMI</span>
            <span class="d-none d-lg-inline">KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH</span>
            <span class="d-none d-lg-inline">•</span>
            <span class="text-truncate">BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA</span>
          </div>
          <div class="d-flex align-items-center gap-2 flex-shrink-0 ms-2">
            <i class="ti ti-calendar fs-4"></i>
            <span class="small">${today}</span>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render Brand Header (Navbar Header)
   */
  renderNavbar(opts = {}) {
    const role = opts.role || 'pegawai';
    const activeMenu = opts.activeMenu || '';
    const user = opts.user || null;
    const items = this.menuConfig[role] || this.menuConfig.pegawai;

    const navItemsHtml = items.map(item => {
      const isActive = item.id === activeMenu ? 'active fw-bold text-primary' : 'text-secondary';
      const targetAttr = item.target ? `target="${item.target}"` : '';
      const isSecClass = item.isSecondary ? 'text-muted' : '';
      return `
        <li class="nav-item">
          <a class="nav-link ${isActive} ${isSecClass} px-2 py-2" href="${item.href}" ${targetAttr}>
            <span class="nav-link-icon d-inline-block me-1">
              <i class="ti ${item.icon}"></i>
            </span>
            <span class="nav-link-title">${item.label}</span>
          </a>
        </li>
      `;
    }).join('');

    let userDropdownHtml = '';
    if (user) {
      const initial = (user.name || user.username || 'U').charAt(0).toUpperCase();
      const displayName = user.name || (role === 'superadmin' ? 'Super Administrator' : (role === 'admin' ? 'Admin Kepegawaian' : 'Pegawai ASN'));
      const displayRole = user.nip ? `NIP. ${user.nip}` : (role === 'superadmin' ? 'Superadmin' : 'Kepegawaian');
      const roleBadge = role === 'superadmin' 
        ? '<span class="badge bg-yellow text-dark fw-bold">Superadmin</span>'
        : (role === 'admin' ? '<span class="badge bg-primary text-white fw-bold">Kepegawaian</span>' : '<span class="badge bg-teal text-white">ASN</span>');

      userDropdownHtml = `
        <div class="nav-item dropdown">
          <a href="#" class="nav-link d-flex align-items-center p-1 rounded text-reset text-decoration-none" data-bs-toggle="dropdown" aria-label="Menu Pengguna">
            <span class="avatar avatar-sm bg-primary text-white fw-bold shadow-xs flex-shrink-0">${initial}</span>
            <div class="d-none d-lg-block ps-2 text-start" style="max-width: 140px;">
              <div class="fw-bold small text-truncate text-dark" title="${displayName}">${displayName}</div>
              <div class="text-muted small text-truncate" style="font-size: 11px;">${displayRole}</div>
            </div>
            <i class="ti ti-chevron-down ms-1 text-muted small d-none d-lg-inline"></i>
          </a>
          <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow shadow">
            <div class="dropdown-header">
              <div class="fw-bold text-truncate" style="max-width: 200px;">${displayName}</div>
              <div class="mt-1">${roleBadge}</div>
            </div>
            <div class="dropdown-divider"></div>
            ${role === 'pegawai' ? '<a class="dropdown-item" href="/verif-wajah"><i class="ti ti-scan me-2"></i> Pengaturan Wajah</a>' : ''}
            ${role === 'superadmin' ? '<a class="dropdown-item" href="/superadmin"><i class="ti ti-shield-lock me-2"></i> Konsol Superadmin</a>' : ''}
            ${role === 'superadmin' || role === 'admin' ? '<a class="dropdown-item" href="/admin"><i class="ti ti-dashboard me-2"></i> Dashboard Kepegawaian</a>' : ''}
            <a class="dropdown-item" href="/proyektor" target="_blank"><i class="ti ti-device-projector me-2"></i> Layar Proyektor Aula</a>
            <a class="dropdown-item" href="/sertifikat" target="_blank"><i class="ti ti-certificate me-2"></i> Cek Sertifikat Publik</a>
            <div class="dropdown-divider"></div>
            <a class="dropdown-item text-danger" href="javascript:void(0)" onclick="handleLogout()">
              <i class="ti ti-logout me-2"></i> Keluar (Logout)
            </a>
          </div>
        </div>
      `;
    } else {
      userDropdownHtml = `
        <div class="nav-item">
          <a href="/admin/login" class="btn btn-outline-primary btn-sm fw-medium shadow-xs">
            <i class="ti ti-lock me-1"></i> Login Admin
          </a>
        </div>
      `;
    }

    return `
      <header class="navbar navbar-expand-lg navbar-light d-print-none bg-white border-bottom shadow-xs py-2">
        <div class="container-xl d-flex align-items-center">
          <button class="navbar-toggler me-2" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu" aria-controls="navbar-menu" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          
          <div class="navbar-brand me-3 flex-shrink-0">
            <a href="/" class="d-flex align-items-center text-decoration-none text-dark">
              <img src="/icons/tutwurihandayani.png" alt="Logo Kemendikdasmen" width="38" height="38" class="me-2 flex-shrink-0 shadow-xs" style="object-fit: contain;">
              <div class="d-flex flex-column text-start">
                <span class="fw-bold" style="font-size: 14px; letter-spacing: -0.2px; line-height: 1.15; color: #0056b3;">Kemendikdasmen</span>
                <span class="text-secondary fw-semibold" style="font-size: 10px; letter-spacing: 0.1px; line-height: 1.2;">
                  <span class="d-none d-sm-inline">BPMP Provinsi Sulawesi Tenggara</span>
                  <span class="d-inline d-sm-none">BPMP Sultra</span>
                </span>
              </div>
            </a>
          </div>

          <div class="collapse navbar-collapse order-3 order-lg-2" id="navbar-menu">
            <ul class="navbar-nav align-items-lg-center">
              ${navItemsHtml}
            </ul>
          </div>

          <div class="navbar-nav flex-row order-2 order-lg-3 align-items-center gap-2 ms-auto flex-shrink-0">
            ${userDropdownHtml}
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
      <footer class="footer footer-transparent d-print-none mt-auto py-3 border-top bg-white">
        <div class="container-xl">
          <div class="row text-center align-items-center flex-row-reverse">
            <div class="col-lg-auto ms-lg-auto">
              <ul class="list-inline list-inline-dots mb-0 small text-muted">
                <li class="list-inline-item"><span class="badge bg-teal-lt"><i class="ti ti-check me-1"></i> Tabler Bootstrap 5</span></li>
                <li class="list-inline-item"><span class="badge bg-blue-lt"><i class="ti ti-database me-1"></i> Supabase Cloud</span></li>
              </ul>
            </div>
            <div class="col-12 col-lg-auto mt-3 mt-lg-0">
              <ul class="list-inline list-inline-dots mb-0 small text-muted">
                <li class="list-inline-item">
                  <strong>Balai Penjaminan Mutu Pendidikan (BPMP) Provinsi Sulawesi Tenggara</strong> &copy; 2026
                </li>
                <li class="list-inline-item">
                  Sistem Presensi Mandiri, Verifikasi LPTI &amp; E-Sertifikat ASN (Senin Berseri)
                </li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    `;
  },

  /**
   * Initialize layout on page load
   * Supports both #app-* and #bpmp-* element IDs across all application templates.
   */
  init(opts = {}) {
    const topStripEl = document.getElementById('app-topstrip') || document.getElementById('bpmp-top-strip');
    if (topStripEl) topStripEl.innerHTML = this.renderTopStrip();

    const navbarEl = document.getElementById('app-navbar') || document.getElementById('bpmp-navbar');
    if (navbarEl) navbarEl.innerHTML = this.renderNavbar(opts);

    const footerEl = document.getElementById('app-footer') || document.getElementById('bpmp-footer');
    if (footerEl) footerEl.innerHTML = this.renderFooter();
  }
};

window.BPMPLayout = BPMPLayout;
