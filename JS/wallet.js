/**
 * CryptValt — Wallet Manager
 */

const WalletManager = (() => {

  async function connect() {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const addr = accounts[0];
        setWallet(addr);
        localStorage.setItem('cv_wallet', addr);
        notify('success', '⬡ Wallet Connected', shortenAddr(addr));

        // Listen for account changes
        window.ethereum.on('accountsChanged', (accs) => {
          if (accs.length === 0) disconnect();
          else setWallet(accs[0]);
        });

        window.ethereum.on('chainChanged', () => window.location.reload());
        return addr;
      } catch(e) {
        notify('error', 'Connection Failed', e.message);
        return null;
      }
    } else {
      // Demo mode
      const demo = '0x05248CD920dAeB2E5369A63Fe93367f9F1bf5677';
      setWallet(demo);
      localStorage.setItem('cv_wallet', demo);
      notify('error', 'MetaMask Required', 'Install MetaMask or a Web3 wallet to use CryptValt.');
      return demo;
    }
  }

  function disconnect() {
    state.wallet = null;
    localStorage.removeItem('cv_wallet');
    document.getElementById('walletBadge').style.display = 'none';
    document.getElementById('connectBtn').style.display = 'block';
    notify('info', 'Wallet Disconnected', 'Your wallet has been disconnected.');
  }

  function setWallet(addr) {
    state.wallet = addr;
    const badge = document.getElementById('walletBadge');
    const btn   = document.getElementById('connectBtn');
    if (badge) { badge.style.display = 'flex'; }
    if (btn)   { btn.style.display = 'none'; }
    const addrEl = document.getElementById('walletAddr');
    if (addrEl) addrEl.textContent = shortenAddr(addr);
  }

  function checkSaved() {
    const saved = localStorage.getItem('cv_wallet');
    if (saved) setWallet(saved);
  }

  async function sign(message) {
    if (typeof window.ethereum !== 'undefined' && state.wallet) {
      try {
        return await window.ethereum.request({
          method: 'personal_sign',
          params: [message, state.wallet]
        });
      } catch(e) {
        throw new Error('MetaMask required — no fallback signature in production.');
      }
    }
    throw new Error('MetaMask required — no fallback signature in production.');
  }

  function shortenAddr(addr) {
    return addr ? addr.slice(0,6) + '...' + addr.slice(-4) : '';
  }

  return { connect, disconnect, setWallet, checkSaved, sign, shortenAddr };

})();

function connectWallet() { return WalletManager.connect(); }
function shortenAddr(addr) { return WalletManager.shortenAddr(addr); }
async function signMessage(msg) { return WalletManager.sign(msg); }
