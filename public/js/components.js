/**
 * BPMP Senin Berseri — Shared UI Components (Tabler Bootstrap 5)
 * Satu sumber komponen reusable untuk semua peran: Pegawai, Admin, Superadmin.
 */

const BPMPComponents = {
  /**
   * Status Badge Mapping
   * @param {string} status - 'hadir', 'pending', 'disetujui', 'approved', 'revisi', 'revision', 'ditolak', 'rejected', 'none'
   * @param {string} [label] - Optional custom label
   */
  createStatusBadge(status, label) {
    const s = String(status || '').toLowerCase().trim();
    let badgeClass = 'bg-secondary-lt';
    let icon = 'ti-circle';
    let text = label || status || 'Belum Ada';

    if (s === 'hadir' || s === 'attended' || s === 'present') {
      badgeClass = 'bg-success text-success-fg';
      icon = 'ti-circle-check';
      text = label || 'Hadir';
    } else if (s === 'disetujui' || s === 'approved' || s === 'verified') {
      badgeClass = 'bg-success text-success-fg';
      icon = 'ti-check';
      text = label || 'Disetujui';
    } else if (s === 'pending' || s === 'menunggu' || s === 'submitted' || s === 'waiting') {
      badgeClass = 'bg-warning text-warning-fg';
      icon = 'ti-clock';
      text = label || 'Menunggu Verifikasi';
    } else if (s === 'revisi' || s === 'revision') {
      badgeClass = 'bg-danger text-danger-fg';
      icon = 'ti-alert-triangle';
      text = label || 'Perlu Revisi';
    } else if (s === 'ditolak' || s === 'rejected') {
      badgeClass = 'bg-danger text-danger-fg';
      icon = 'ti-x';
      text = label || 'Ditolak';
    } else if (s === 'active' || s === 'aktif') {
      badgeClass = 'bg-teal text-teal-fg';
      icon = 'ti-antenna';
      text = label || 'Aktif';
    } else if (s === 'completed' || s === 'selesai') {
      badgeClass = 'bg-azure text-azure-fg';
      icon = 'ti-flag-check';
      text = label || 'Selesai';
    } else if (s === 'none' || !s) {
      badgeClass = 'bg-secondary-lt';
      icon = 'ti-minus';
      text = label || 'Belum Ada';
    }

    return `<span class="badge ${badgeClass} d-inline-flex align-items-center gap-1">
      <i class="ti ${icon}"></i> <span>${text}</span>
    </span>`;
  },

  /**
   * Stat Card
   * @param {Object} opts - { icon, value, label, subtext, color, id }
   */
  createStatCard(opts) {
    const color = opts.color || 'primary';
    const idAttr = opts.id ? `id="${opts.id}"` : '';
    const subtextHtml = opts.subtext ? `<div class="text-muted small mt-1">${opts.subtext}</div>` : '';
    
    return `
      <div class="card card-sm">
        <div class="card-body">
          <div class="row align-items-center">
            <div class="col-auto">
              <span class="bg-${color} text-white avatar">
                <i class="ti ${opts.icon || 'ti-chart-bar'} fs-2"></i>
              </span>
            </div>
            <div class="col">
              <div class="font-weight-medium" style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--tblr-secondary);">
                ${opts.label}
              </div>
              <div class="text-dark fw-bold fs-2" ${idAttr}>
                ${opts.value !== undefined ? opts.value : '0'}
              </div>
              ${subtextHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Page Header
   * @param {Object} opts - { title, pretitle, breadcrumbs, actions }
   */
  createPageHeader(opts) {
    const pretitleHtml = opts.pretitle ? `<div class="page-pretitle text-muted fw-bold text-uppercase" style="font-size: 11px; letter-spacing: 0.8px;">${opts.pretitle}</div>` : '';
    const actionsHtml = opts.actions || '';
    
    return `
      <div class="page-header d-print-none mb-3">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              ${pretitleHtml}
              <h2 class="page-title text-dark fw-bold">
                ${opts.title}
              </h2>
            </div>
            <div class="col-auto ms-auto d-print-none">
              <div class="btn-list">
                ${actionsHtml}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Empty State
   * @param {Object} opts - { icon, title, description, actionBtn }
   */
  createEmptyState(opts) {
    const actionHtml = opts.actionBtn ? `<div class="empty-action mt-3">${opts.actionBtn}</div>` : '';
    return `
      <div class="empty py-4 text-center">
        <div class="empty-icon text-muted mb-2">
          <i class="ti ${opts.icon || 'ti-database-off'}" style="font-size: 3rem; opacity: 0.4;"></i>
        </div>
        <p class="empty-title fw-bold fs-3 mb-1 text-dark">${opts.title || 'Tidak Ada Data'}</p>
        <p class="empty-subtitle text-muted small mx-auto" style="max-width: 420px;">
          ${opts.description || 'Data belum tersedia untuk kriteria yang dipilih.'}
        </p>
        ${actionHtml}
      </div>
    `;
  },

  /**
   * Toast Notification (Tabler style)
   */
  showToast(message, type = 'info') {
    let container = document.getElementById('bpmp-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bpmp-toast-container';
      container.style.cssText = 'position: fixed; top: 1.5rem; right: 1.5rem; z-index: 99999; display: flex; flex-direction: column; gap: 0.75rem; pointer-events: none;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'min-width: 300px; max-width: 440px; pointer-events: auto; box-shadow: var(--tblr-shadow-dropdown); border-radius: var(--tblr-border-radius);';
    
    let bgClass = 'alert-info';
    let icon = 'ti-info-circle';
    if (type === 'success') { bgClass = 'alert-success'; icon = 'ti-circle-check'; }
    if (type === 'error' || type === 'danger') { bgClass = 'alert-danger'; icon = 'ti-alert-circle'; }
    if (type === 'warning') { bgClass = 'alert-warning'; icon = 'ti-alert-triangle'; }

    toast.className = `alert ${bgClass} alert-dismissible shadow-sm mb-0 d-flex align-items-center gap-2 fade show`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <i class="ti ${icon} fs-2"></i>
      <div class="flex-fill small fw-medium">${message}</div>
      <button type="button" class="btn-close" aria-label="Close" onclick="this.parentElement.remove()"></button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
      }
    }, 4500);
  },

  /**
   * Reusable Confirmation Modal
   */
  showConfirmModal(opts) {
    const modalId = 'bpmpConfirmModal';
    let modalEl = document.getElementById(modalId);
    if (modalEl) modalEl.remove();

    const confirmBtnClass = opts.confirmClass || 'btn-primary';
    const confirmBtnText = opts.confirmText || 'Konfirmasi';
    const icon = opts.icon || 'ti-alert-triangle';
    const iconColor = opts.iconColor || 'warning';

    const modalHtml = `
      <div class="modal modal-blur fade" id="${modalId}" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog modal-sm modal-dialog-centered" role="document">
          <div class="modal-content">
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            <div class="modal-status bg-${iconColor}"></div>
            <div class="modal-body text-center py-4">
              <i class="ti ${icon} text-${iconColor}" style="font-size: 3rem;"></i>
              <h3 class="fw-bold mt-2 text-dark">${opts.title || 'Konfirmasi Tindakan'}</h3>
              <div class="text-muted small">${opts.message || 'Apakah Anda yakin ingin melanjutkan tindakan ini?'}</div>
            </div>
            <div class="modal-footer">
              <div class="w-100">
                <div class="row">
                  <div class="col"><button type="button" class="btn btn-outline-secondary w-100" data-bs-dismiss="modal">Batal</button></div>
                  <div class="col"><button type="button" class="btn ${confirmBtnClass} w-100" id="btnConfirmAction">${confirmBtnText}</button></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    modalEl = document.getElementById(modalId);
    const bsModal = new bootstrap.Modal(modalEl);

    document.getElementById('btnConfirmAction').addEventListener('click', () => {
      bsModal.hide();
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
    });

    bsModal.show();
  },

  /**
   * Render Attendance & Verification Chart using ApexCharts
   * Replaces old Chart.js implementation with design token colors
   */
  renderApexAttendanceChart(containerId, stats) {
    const el = document.getElementById(containerId);
    if (!el || typeof ApexCharts === 'undefined') return null;

    el.innerHTML = '';
    const hadir = stats.hadir || 0;
    const belumHadir = stats.belumHadir || (stats.total ? stats.total - hadir : 0);
    const disetujui = stats.disetujui || 0;
    const pendingLpti = stats.pendingLpti || 0;
    const revisiLpti = stats.revisiLpti || 0;

    const options = {
      series: [hadir, belumHadir, disetujui, pendingLpti, revisiLpti],
      labels: ['Hadir', 'Belum Hadir', 'LPTI Disetujui', 'LPTI Pending', 'LPTI Revisi'],
      colors: ['#2fb344', '#6c7a89', '#1a3a5c', '#f59f00', '#d63939'],
      chart: {
        type: 'donut',
        height: 280,
        fontFamily: 'inherit',
        sparkline: { enabled: false },
        animations: { enabled: true }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '65%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Total ASN',
                fontSize: '13px',
                fontWeight: 600,
                formatter: () => stats.total || (hadir + belumHadir)
              }
            }
          }
        }
      },
      legend: {
        position: 'bottom',
        fontSize: '12px',
        fontWeight: 500,
        markers: { radius: 12 }
      },
      tooltip: {
        fillSeriesColor: false,
        theme: 'light'
      },
      dataLabels: { enabled: false }
    };

    const chart = new ApexCharts(el, options);
    chart.render();
    return chart;
  }
};

window.BPMPComponents = BPMPComponents;
