/**
 * CryptValt — App Init & Wallet
 */

function checkSavedWallet() {
  const saved = localStorage.getItem('cv_wallet');
  if (saved) setWallet(saved);
}

// connectWallet and signMessage are defined in index.html
// and support both injected wallets and WalletConnect

function setWallet(addr) {
  state.wallet = addr;
  document.getElementById('walletBadge').style.display = 'flex';
  document.getElementById('walletAddr').textContent = shortenAddr(addr);
  document.getElementById('connectBtn').style.display = 'none';
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
