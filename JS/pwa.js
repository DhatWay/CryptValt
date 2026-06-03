/**
 * CryptValt — PWA & Service Worker Registration
 */

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/CryptValt/sw.js')
      .then(reg => {
        console.log('[PWA] Service worker registered:', reg.scope);

        // Check for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });
      })
      .catch(err => console.warn('[PWA] Service worker registration failed:', err));

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SYNC_LISTINGS') {
        if (typeof renderListings === 'function') renderListings();
      }
    });
  });
}

function showUpdateBanner() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:1px solid var(--cyan);
    padding:12px 24px;z-index:999;display:flex;align-items:center;gap:16px;
    font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--text);
  `;
  banner.innerHTML = `
    <span>UPDATE AVAILABLE</span>
    <button onclick="window.location.reload()" style="background:var(--cyan);color:var(--bg);border:none;padding:6px 14px;cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:2px">REFRESH</button>
    <button onclick="this.parentElement.remove()" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">✕</button>
  `;
  document.body.appendChild(banner);
}

// Install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

function showInstallButton() {
  // Only show if not already installed
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.textContent = '+ Install App';
  btn.style.cssText = 'border-color:rgba(0,255,157,0.3);color:var(--green);';
  btn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') btn.remove();
    deferredPrompt = null;
  };
  const navLinks = document.querySelector('.nav-links');
  if (navLinks) navLinks.appendChild(btn);
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App installed');
  deferredPrompt = null;
});
