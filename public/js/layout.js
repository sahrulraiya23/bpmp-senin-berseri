/**
 * BPMP Senin Berseri — Shared Layout System (Tabler Bootstrap 5)
 * Satu konfigurasi menu untuk semua peran (Pegawai, Admin, Superadmin).
 */

const BPMPLayout = {
  // Menu configuration per role
  menuConfig: {
    pegawai: [
      { id: 'home', label: 'Beranda', href: '/', icon: 'ti-home' },
      { id: 'dashboard', label: 'Presensi & Pelatihan', href: '/login', icon: 'ti-id-badge' },
      { id: 'sertifikat', label: 'Cek Sertifikat', href: '/sertifikat', icon: 'ti-certificate' },
      { id: 'verif-wajah', label: 'Registrasi Wajah', href: '/verif-wajah', icon: 'ti-scan' },
      { id: 'proyektor', label: 'Layar Aula', href: '/proyektor', icon: 'ti-device-projector', target: '_blank' },
      { id: 'admin-login', label: 'Login Admin', href: '/admin/login', icon: 'ti-lock-access', isSecondary: true }
    ],
    admin: [
      { id: 'admin-dashboard', label: 'Dashboard Presensi', href: '/admin', icon: 'ti-layout-dashboard' },
      { id: 'sertifikat', label: 'Cek Sertifikat Publik', href: '/sertifikat', icon: 'ti-certificate', target: '_blank' },
      { id: 'section-lpti', label: 'Verifikasi LPTI', href: '#section-lpti', icon: 'ti-file-check' },
      { id: 'section-template', label: 'Pengaturan Sertifikat', href: '#section-template', icon: 'ti-certificate' },
      { id: 'section-event', label: 'Kelola Pelatihan', href: '#section-event', icon: 'ti-calendar-event' },
      { id: 'proyektor', label: 'Layar Proyektor', href: '/proyektor', icon: 'ti-device-projector', target: '_blank' },
      { id: 'home', label: 'Beranda Aplikasi', href: '/', icon: 'ti-home', target: '_blank' },
      { id: 'pegawai', label: 'Portal Pegawai', href: '/login', icon: 'ti-user', target: '_blank' }
    ],
    superadmin: [
      { id: 'superadmin-summary', label: 'Ringkasan Sistem', href: '/superadmin', icon: 'ti-shield-lock' },
      { id: 'sertifikat', label: 'Cek Sertifikat Publik', href: '/sertifikat', icon: 'ti-certificate', target: '_blank' },
      { id: 'section-admins', label: 'Admin Kepegawaian', href: '#section-admins', icon: 'ti-users' },
      { id: 'section-employees', label: 'Master Data 104 ASN', href: '#section-employees', icon: 'ti-address-book' },
      { id: 'section-sync', label: 'Database Supabase', href: '#section-sync', icon: 'ti-cloud-upload' },
      { id: 'section-export', label: 'Ekspor Rekap', href: '#section-export', icon: 'ti-download' },
      { id: 'admin', label: 'Dashboard Admin', href: '/admin', icon: 'ti-id-badge', target: '_blank' },
      { id: 'home', label: 'Beranda Aplikasi', href: '/', icon: 'ti-home', target: '_blank' },
      { id: 'pegawai', label: 'Portal Pegawai', href: '/login', icon: 'ti-user', target: '_blank' }
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
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-primary text-white" style="font-size: 9px; padding: 2px 6px;">RESMI</span>
            <span class="d-none d-md-inline">KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH</span>
            <span class="d-none d-md-inline">•</span>
            <span>BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA</span>
          </div>
          <div class="d-flex align-items-center gap-2">
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
      const isActive = item.id === activeMenu ? 'active fw-bold' : '';
      const targetAttr = item.target ? `target="${item.target}"` : '';
      const isSecClass = item.isSecondary ? 'text-muted' : '';
      return `
        <li class="nav-item">
          <a class="nav-link ${isActive} ${isSecClass}" href="${item.href}" ${targetAttr}>
            <span class="nav-link-icon d-md-none d-lg-inline-block">
              <i class="ti ${item.icon}"></i>
            </span>
            <span class="nav-link-title">${item.label}</span>
          </a>
        </li>
      `;
    }).join('');

    let userDropdownHtml = '';
    if (user) {
      const initial = (user.name || 'U').charAt(0).toUpperCase();
      const roleBadge = role === 'superadmin' 
        ? '<span class="badge bg-yellow text-dark fw-bold">Superadmin</span>'
        : (role === 'admin' ? '<span class="badge bg-primary text-white fw-bold">Admin</span>' : '<span class="badge bg-teal text-white">ASN</span>');

      userDropdownHtml = `
        <div class="nav-item dropdown">
          <a href="#" class="nav-link d-flex lh-1 text-reset p-0" data-bs-toggle="dropdown" aria-label="Open user menu">
            <span class="avatar avatar-sm bg-primary text-white fw-bold">${initial}</span>
            <div class="d-none d-xl-block ps-2 text-start">
              <div class="fw-bold fs-4">${user.name || 'Pengguna'}</div>
              <div class="mt-1 small text-muted">${user.nip ? `NIP. ${user.nip}` : (user.role || 'Administrator')}</div>
            </div>
          </a>
          <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow shadow">
            <div class="dropdown-header">
              <div class="fw-bold">${user.name || 'Pengguna'}</div>
              <div class="text-muted small">${roleBadge}</div>
            </div>
            <div class="dropdown-divider"></div>
            ${role === 'pegawai' ? '<a class="dropdown-item" href="/verif-wajah"><i class="ti ti-scan me-2"></i> Pengaturan Wajah</a>' : ''}
            ${role !== 'pegawai' ? '<a class="dropdown-item" href="/admin"><i class="ti ti-dashboard me-2"></i> Dashboard Admin</a>' : ''}
            <a class="dropdown-item text-danger" href="javascript:void(0)" onclick="handleLogout()">
              <i class="ti ti-logout me-2"></i> Keluar (Logout)
            </a>
          </div>
        </div>
      `;
    } else {
      userDropdownHtml = `
        <div class="nav-item">
          <a href="/admin/login" class="btn btn-outline-primary btn-sm">
            <i class="ti ti-lock me-1"></i> Login Admin
          </a>
        </div>
      `;
    }

    return `
      <header class="navbar navbar-expand-md navbar-light d-print-none bg-white border-bottom shadow-xs">
        <div class="container-xl">
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbar-menu" aria-controls="navbar-menu" aria-expanded="false" aria-label="Toggle navigation">
            <span class="navbar-toggler-icon"></span>
          </button>
          
          <h1 class="navbar-brand navbar-brand-autodark d-none-navbar-horizontal pe-0 pe-md-3">
            <a href="/" class="d-flex align-items-center text-decoration-none text-dark">
              <img src="/icons/kemendikdasmen-logo.svg" alt="Logo Kemendikdasmen" width="40" height="40" class="me-2 rounded-circle shadow-xs">
              <div class="d-flex flex-column text-start">
                <span class="fw-bold" style="font-size: 15px; letter-spacing: -0.2px; line-height: 1.15; color: #0056b3;">Kemendikdasmen</span>
                <span class="text-secondary fw-semibold" style="font-size: 10px; letter-spacing: 0.2px; line-height: 1.2;">BPMP Provinsi Sulawesi Tenggara</span>
              </div>
            </a>
          </h1>

          <div class="navbar-nav flex-row order-md-last align-items-center gap-2">
            ${userDropdownHtml}
          </div>

          <div class="collapse navbar-collapse" id="navbar-menu">
            <ul class="navbar-nav">
              ${navItemsHtml}
            </ul>
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
                  Sistem Presensi Mandiri, Verifikasi LPTI & E-Sertifikat ASN (Senin Berseri)
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
   * Target elements: #app-topstrip, #app-navbar, #app-footer
   */
  init(opts = {}) {
    const topStripEl = document.getElementById('app-topstrip');
    if (topStripEl) topStripEl.innerHTML = this.renderTopStrip();

    const navbarEl = document.getElementById('app-navbar');
    if (navbarEl) navbarEl.innerHTML = this.renderNavbar(opts);

    const footerEl = document.getElementById('app-footer');
    if (footerEl) footerEl.innerHTML = this.renderFooter();
  }
};

window.BPMPLayout = BPMPLayout;
