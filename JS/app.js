/**
 * CryptValt — App Init & Wallet
 */

function checkSavedWallet() {
  const saved = localStorage.getItem('cv_wallet');
  if (saved) setWallet(saved);
}

async function connectWallet() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setWallet(accounts[0]);
      notify('success', '⬡ Wallet Connected', shortenAddr(accounts[0]));
      localStorage.setItem('cv_wallet', accounts[0]);
    } catch(e) {
      notify('error', 'Connection Failed', e.message);
    }
  } else {
    // Demo mode for testing without MetaMask
    const demoWallet = '0x26A01Cb4af917a8FD359738b48Dc60E92b1C6504';
    setWallet(demoWallet);
    notify('info', 'Demo Mode', 'MetaMask not detected. Using demo wallet.');
    localStorage.setItem('cv_wallet', demoWallet);
  }
}

function setWallet(addr) {
  state.wallet = addr;
  document.getElementById('walletBadge').style.display = 'flex';
  document.getElementById('walletAddr').textContent = shortenAddr(addr);
  document.getElementById('connectBtn').style.display = 'none';
}

async function signMessage(message) {
  if (typeof window.ethereum !== 'undefined') {
    try {
      const sig = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, state.wallet]
      });
      return sig;
    } catch(e) { return 'demo_sig_' + Date.now(); }
  }
  return 'demo_sig_' + Date.now();
}

window.addEventListener('load', async () => {
  updateStats();
  renderListings();
  document.getElementById('initTime').textContent = timeNow();
  startClaudeMonitor();
  checkSavedWallet();

  const deployed = CONFIG.CONTRACTS.CRYPTVALT !== null;
  if (typeof addClaudeEntry === 'function') {
    addClaudeEntry(
      deployed ? 'ok' : 'info',
      deployed ? 'On-Chain Mode Active' : 'Local Mode Active',
      deployed
        ? 'Contracts connected. On-chain mode active.'
        : 'Running in local mode. Add contract addresses to CONFIG.CONTRACTS to activate on-chain.'
    );
  }

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', accounts => {
      if (accounts.length === 0) {
        state.wallet = null;
        document.getElementById('walletBadge').style.display = 'none';
        document.getElementById('connectBtn').style.display = 'block';
      } else {
        setWallet(accounts[0]);
        localStorage.setItem('cv_wallet', accounts[0]);
      }
    });
    window.ethereum.on('chainChanged', () => window.location.reload());
  }
});
