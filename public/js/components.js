/**
 * BPMP Senin Berseri — Shared UI Components (Tabler Bootstrap 5)
 * Satu sumber komponen reusable untuk semua peran: Pegawai, Admin, Superadmin.
 */

if (typeof window !== 'undefined') {
  window.bootstrap = window.bootstrap || window.tabler?.bootstrap || window.tabler || {};
  if (!window.bootstrap.Modal && window.tabler?.Modal) {
    window.bootstrap.Modal = window.tabler.Modal;
  }
}

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
   * Institutional Alert Box (Standar Instansi)
   * @param {Object} opts - { type: 'info'|'success'|'warning'|'danger'|'primary', title, message, icon, badgeText, dismissable, actionBtn, id }
   */
  createAlert(opts) {
    const type = opts.type || 'info';
    let alertClass = 'alert-info border-info-subtle';
    let defaultIcon = 'ti-info-circle';
    let defaultBadge = 'PEMBERITAHUAN';

    if (type === 'success') {
      alertClass = 'alert-success border-success-subtle';
      defaultIcon = 'ti-circle-check';
      defaultBadge = 'BERHASIL';
    } else if (type === 'warning') {
      alertClass = 'alert-warning border-warning-subtle';
      defaultIcon = 'ti-alert-triangle';
      defaultBadge = 'PERHATIAN';
    } else if (type === 'danger' || type === 'error') {
      alertClass = 'alert-danger border-danger-subtle';
      defaultIcon = 'ti-alert-circle';
      defaultBadge = 'PERINGATAN';
    } else if (type === 'primary') {
      alertClass = 'alert-primary border-primary-subtle';
      defaultIcon = 'ti-shield-check';
      defaultBadge = 'STANDAR INSTANSI';
    }

    const icon = opts.icon || defaultIcon;
    const badgeText = opts.badgeText || defaultBadge;
    const badgeColor = type === 'danger' ? 'danger' : (type === 'warning' ? 'warning text-dark' : (type === 'success' ? 'success' : 'primary'));
    const titleHtml = opts.title ? `
      <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
        <span class="badge bg-${badgeColor} text-uppercase font-monospace" style="font-size: 0.65rem; letter-spacing: 0.5px;">${badgeText}</span>
        <h4 class="alert-title mb-0 fw-bold">${opts.title}</h4>
      </div>
    ` : '';
    const dismissBtn = opts.dismissable ? `<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>` : '';
    const actionHtml = opts.actionBtn ? `<div class="mt-2 pt-2 border-top border-opacity-10">${opts.actionBtn}</div>` : '';
    const idAttr = opts.id ? `id="${opts.id}"` : '';

    return `
      <div class="alert ${alertClass} ${opts.dismissable ? 'alert-dismissible' : ''} shadow-sm mb-3" ${idAttr} role="alert">
        <div class="d-flex">
          <div class="me-3">
            <span class="avatar avatar-sm rounded bg-${type === 'warning' ? 'warning-lt text-warning' : (type === 'danger' ? 'danger-lt text-danger' : (type === 'success' ? 'success-lt text-success' : 'primary-lt text-primary'))}">
              <i class="ti ${icon} fs-2"></i>
            </span>
          </div>
          <div class="flex-fill">
            ${titleHtml}
            <div class="text-secondary small lh-base">${opts.message}</div>
            ${actionHtml}
          </div>
          ${dismissBtn}
        </div>
      </div>
    `;
  },

  /**
   * Institutional Announcement Banner (Maklumat Pelayanan / Petunjuk Resmi)
   */
  createAnnouncementBanner(opts) {
    const icon = opts.icon || 'ti-speakerphone';
    const itemsHtml = Array.isArray(opts.items) ? `
      <ul class="mb-0 mt-2 ps-3 small text-secondary">
        ${opts.items.map(item => `<li class="mb-1">${item}</li>`).join('')}
      </ul>
    ` : '';
    const badge = opts.dateBadge || 'MAKLUMAT RESMI BPMP SULTRA';

    return `
      <div class="card border-primary-subtle shadow-sm mb-3 bg-light-subtle overflow-hidden">
        <div class="card-status-top bg-primary"></div>
        <div class="card-body p-3">
          <div class="d-flex align-items-start gap-3">
            <div class="col-auto">
              <span class="avatar avatar-md rounded bg-primary text-white shadow-sm">
                <i class="ti ${icon} fs-2"></i>
              </span>
            </div>
            <div class="col">
              <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-1">
                <span class="badge bg-primary-lt text-primary font-monospace" style="font-size: 0.7rem; letter-spacing: 0.5px;">${badge}</span>
                <span class="text-secondary font-monospace" style="font-size: 0.72rem;"><i class="ti ti-shield-check me-1 text-primary"></i>Standar Kepegawaian BPMP Sultra</span>
              </div>
              <h4 class="card-title fw-bold text-primary mb-1">${opts.title}</h4>
              <p class="text-secondary small mb-1">${opts.subtitle || ''}</p>
              ${itemsHtml}
              ${opts.footer ? `<div class="mt-2 pt-2 border-top border-light-subtle small text-secondary">${opts.footer}</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
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
  },

  /**
   * Ekstraksi Vektor Biometrik Wajah 128 Titik dari Canvas
   * Menggunakan kombinasi Grid Spasial Luminansi (64 bin), Distribusi Krominansi Kulit (32 bin),
   * dan Orientasi Gradien Fitur Wajah (32 bin) yang dinormalisasi L2.
   * @param {HTMLCanvasElement} canvas
   * @returns {{ descriptor: number[], hasHumanFace: boolean, skinRatio: number }}
   */
  extractFaceDescriptor(canvas) {
    if (!canvas || !canvas.getContext) {
      return { descriptor: null, hasHumanFace: false, skinRatio: 0 };
    }
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Fokus pada area wajah (kotak tengah 60% x 70% di dalam panduan oval)
    const x0 = Math.floor(width * 0.2);
    const y0 = Math.floor(height * 0.15);
    const w = Math.floor(width * 0.6);
    const h = Math.floor(height * 0.7);

    let imgData;
    try {
      imgData = ctx.getImageData(x0, y0, w, h);
    } catch (e) {
      return { descriptor: null, hasHumanFace: false, skinRatio: 0 };
    }
    const pixels = imgData.data;

    // 1. Grid Spasial 8x8 (64 fitur)
    const gridFeatures = new Array(64).fill(0);
    const cellW = w / 8;
    const cellH = h / 8;
    const cellCounts = new Array(64).fill(0);

    // 2. 32-bin Distribusi Krominansi
    const colorBins = new Array(32).fill(0);

    // 3. 32-bin Gradien Tepi Fitur Wajah (mata, hidung, bibir)
    const gradBins = new Array(32).fill(0);

    let totalSkinPixels = 0;
    const totalPixels = w * h;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // Luminansi terstandarisasi
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const gx = Math.min(7, Math.floor(x / cellW));
        const gy = Math.min(7, Math.floor(y / cellH));
        const gIdx = gy * 8 + gx;
        gridFeatures[gIdx] += lum;
        cellCounts[gIdx]++;

        // Deteksi warna kulit manusia (YCbCr / RGB heuristic)
        if (r > 60 && g > 40 && b > 20 && (r - g) > 10 && (r - b) > 10) {
          totalSkinPixels++;
        }

        // Krominansi
        const cr = Math.floor(Math.max(0, Math.min(15, (r - g) / 16)));
        const cb = Math.floor(Math.max(0, Math.min(15, (b - g + 128) / 16)));
        colorBins[cr]++;
        colorBins[16 + cb]++;

        // Gradien horizontal
        if (x > 0 && x < w - 1) {
          const leftLum = (pixels[idx - 4] * 0.299 + pixels[idx - 3] * 0.587 + pixels[idx - 2] * 0.114) / 255;
          const diff = Math.abs(lum - leftLum);
          const bIdx = Math.min(31, Math.floor(diff * 32));
          gradBins[bIdx]++;
        }
      }
    }

    // Normalisasi Grid
    for (let i = 0; i < 64; i++) {
      gridFeatures[i] = cellCounts[i] ? gridFeatures[i] / cellCounts[i] : 0;
    }

    // Normalisasi Bins
    for (let i = 0; i < 32; i++) {
      colorBins[i] /= (totalPixels || 1);
      gradBins[i] /= (totalPixels || 1);
    }

    // Gabungkan 64 + 32 + 32 = 128 vektor float
    const rawVector = [...gridFeatures, ...colorBins, ...gradBins];

    // L2 Normalization ke unit vector
    let norm = 0;
    for (let i = 0; i < rawVector.length; i++) norm += rawVector[i] * rawVector[i];
    norm = Math.sqrt(norm) || 1;
    const descriptor = rawVector.map(v => +(v / norm).toFixed(6));

    const skinRatio = totalSkinPixels / (totalPixels || 1);
    const hasHumanFace = skinRatio > 0.08;

    return { descriptor, hasHumanFace, skinRatio };
  },

  /**
   * Hitung Kemiripan Biometrik Wajah (Cosine Similarity 0 - 1)
   * @param {number[]} descA
   * @param {number[]} descB
   * @returns {number} Nilai kemiripan antara 0.0 sampai 1.0 (0% - 100%)
   */
  calculateFaceSimilarity(descA, descB) {
    if (!Array.isArray(descA) || !Array.isArray(descB) || descA.length !== descB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < descA.length; i++) {
      dot += descA[i] * descB[i];
      normA += descA[i] * descA[i];
      normB += descB[i] * descB[i];
    }
    if (!normA || !normB) return 0;
    return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
  }
};

window.BPMPComponents = BPMPComponents;
