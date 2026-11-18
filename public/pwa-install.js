/**
 * PWA Install Prompt & Service Worker Registration
 * Mendukung Android (Chrome, Edge, Samsung Internet) & iOS (Safari)
 */

let deferredInstallPrompt = null;

// 1. Daftarkan Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => {
        console.log('PWA ServiceWorker terdaftar:', reg.scope);
      })
      .catch(err => {
        console.warn('Gagal mendaftarkan ServiceWorker:', err.message);
      });
  });
}

// 2. Deteksi apakah sudah terpasang (Standalone Mode)
function isRunningStandalone() {
  return (window.matchMedia('(display-mode: standalone)').matches) ||
         (window.navigator.standalone === true) ||
         document.referrer.includes('android-app://');
}

// 3. Deteksi Perangkat Mobile & iOS
function isIosDevice() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua) || (window.innerWidth <= 768);
}

// 4. Render Banner PWA Install Otomatis di HP
function injectPwaInstallBanner() {
  if (isRunningStandalone()) return; // Jika sudah terpasang di layar utama, jangan tampilkan
  if (document.getElementById('pwaInstallBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwaInstallBanner';
  banner.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 16px;
    right: 16px;
    max-width: 460px;
    margin: 0 auto;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-left: 5px solid #0f766e;
    border-radius: 14px;
    box-shadow: 0 14px 32px rgba(0, 45, 91, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);
    padding: 14px 16px;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    animation: pwaSlideUp 0.35s ease-out;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const isIos = isIosDevice();

  banner.innerHTML = `
    <style>
      @keyframes pwaSlideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
      <div style="display: flex; align-items: center;">
        <img src="/icons/icon-192.png" alt="Senin Berseri" style="width: 42px; height: 42px; border-radius: 10px; margin-right: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
        <div>
          <div style="font-weight: 800; font-size: 13.5px; color: #002d5b; line-height: 1.2;">Pasang Aplikasi di HP</div>
          <div style="font-size: 11px; color: #0f766e; font-weight: 700; text-transform: uppercase;">Senin Berseri &bull; BPMP Sultra</div>
        </div>
      </div>
      <button onclick="dismissPwaBanner()" style="background: none; border: none; font-size: 20px; color: #94a3b8; cursor: pointer; padding: 2px 6px;" title="Tutup">&times;</button>
    </div>

    <p style="font-size: 12px; color: #475569; margin: 0 0 10px 0; line-height: 1.45;">
      Pasang di Layar Utama HP Anda untuk presensi instan, scan QR kamera proyektor aula, dan unduh sertifikat seperti aplikasi resmi.
    </p>

    ${isIos ? `
      <div style="background: #f0fdf4; border: 1px dashed #86efac; border-radius: 8px; padding: 9px 12px; font-size: 12px; color: #166534; line-height: 1.4;">
        📲 <strong>Panduan iPhone / Safari:</strong><br>
        1. Ketuk tombol <strong>Bagikan (Share)</strong> <span style="font-size: 14px;">⎋</span> di bilah bawah browser Safari.<br>
        2. Gulir ke bawah lalu ketuk <strong>"Tambahkan ke Layar Utama" (Add to Home Screen)</strong>.
      </div>
    ` : `
      <div id="pwaActionArea" style="display: flex; gap: 8px;">
        <button id="btnPwaInstallNow" onclick="triggerPwaInstall()" style="flex: 1; background: #0f766e; color: #ffffff; border: none; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 6px rgba(15, 118, 110, 0.3);">
          <span>📲 Pasang Aplikasi Sekarang</span>
        </button>
        <button onclick="dismissPwaBanner()" style="background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px; font-weight: 700; cursor: pointer;">
          Nanti
        </button>
      </div>
    `}
  `;

  document.body.appendChild(banner);
}

// 5. Tangkap Event beforeinstallprompt (Android / Chrome / Edge)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('PWA: beforeinstallprompt siap ditrigger.');

  // Tampilkan tombol install in-page jika ada
  revealInPageInstallButtons();

  const dismissedTime = localStorage.getItem('bpmp_pwa_dismissed');
  const now = Date.now();
  if (!dismissedTime || (now - parseInt(dismissedTime, 10)) > (24 * 60 * 60 * 1000)) {
    setTimeout(injectPwaInstallBanner, 1000);
  }
});

// 6. Tangani Tombol Install saat Ditekan
async function triggerPwaInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    console.log('PWA user choice:', choiceResult.outcome);
    if (choiceResult.outcome === 'accepted') {
      dismissPwaBanner();
    }
    deferredInstallPrompt = null;
  } else if (isIosDevice()) {
    alert('Panduan iPhone / Safari:\n\n1. Ketuk tombol Bagikan (Share ⎋) di bilah bawah Safari.\n2. Pilih "Tambahkan ke Layar Utama" (Add to Home Screen).\n3. Ketuk "Tambah" di pojok kanan atas.');
  } else {
    alert('Cara Pasang di HP:\n\n1. Ketuk icon titik tiga (⋮) di pojok kanan atas peramban browser Anda.\n2. Pilih menu "Pasang Aplikasi" (Install App) atau "Tambahkan ke Layar Utama" (Add to Home screen).\n3. Icon "Senin Berseri" akan langsung muncul di layar utama HP Anda!');
  }
}

// 7. Tutup Banner
function dismissPwaBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) {
    banner.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(100%)';
    setTimeout(() => banner.remove(), 250);
  }
  localStorage.setItem('bpmp_pwa_dismissed', Date.now().toString());
}

// 8. Event saat aplikasi berhasil dipasang
window.addEventListener('appinstalled', () => {
  console.log('Senin Berseri PWA berhasil dipasang di perangkat.');
  dismissPwaBanner();
  hideInPageInstallButtons();
});

// 9. Munculkan tombol install yang ada di dalam halaman jika belum standalone
function revealInPageInstallButtons() {
  if (isRunningStandalone()) return;
  const buttons = document.querySelectorAll('.btn-pwa-install, #btnInstallPwaPegawai');
  buttons.forEach(btn => {
    btn.classList.remove('d-none');
    btn.style.display = 'inline-flex';
  });
}

function hideInPageInstallButtons() {
  const buttons = document.querySelectorAll('.btn-pwa-install, #btnInstallPwaPegawai');
  buttons.forEach(btn => {
    btn.style.display = 'none';
  });
}

// 10. Auto-run saat DOM Siap
window.addEventListener('DOMContentLoaded', () => {
  if (isRunningStandalone()) {
    console.log('Aplikasi berjalan dalam mode Standalone PWA.');
    return;
  }

  // Tampilkan tombol in-page
  revealInPageInstallButtons();

  // Untuk mobile (Android atau iOS), tampilkan banner otomatis jika belum pernah di-dismiss
  if (isMobileDevice()) {
    const dismissedTime = localStorage.getItem('bpmp_pwa_dismissed');
    const now = Date.now();
    if (!dismissedTime || (now - parseInt(dismissedTime, 10)) > (24 * 60 * 60 * 1000)) {
      setTimeout(injectPwaInstallBanner, 1500);
    }
  }
});

