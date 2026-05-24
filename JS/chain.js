/**
 * CryptValt — On-Chain Integration Layer
 * Handles all Ethereum smart contract interactions.
 * Falls back gracefully when contracts not yet deployed.
 */

const ABIS = {
  CRYPTVALT: [
    'function getListing(uint256) view returns (tuple(uint128,uint64,uint64,uint128,uint64,uint64,uint96,uint96,uint64,address,uint32,address,uint8,bool,bool,bool,string,string,string,string))',
    'function getBidders(uint256) view returns (address[])',
    'function getBid(uint256,address) view returns (bytes32,uint256,uint256,uint256,bool,bool,bool)',
    'function getWinnerKey(uint256) view returns (string)',
    'function getInventorListings(address) view returns (uint256[])',
    'function getBidderHistory(address) view returns (uint256[])',
    'function getPlatformStats() view returns (uint256,uint256,uint256,uint256,bool)',
    'function getNonce(address) view returns (uint256)',
    'function pendingWithdrawals(address) view returns (uint256)',
    'function listingCount() view returns (uint256)',
    'function paused() view returns (bool)',
    'function listIdea(string,string,string,uint256,uint256,uint256,uint256,uint256,bytes) returns (uint256)',
    'function commitBid(uint256,bytes32) payable',
    'function revealBid(uint256,uint256,bytes32)',
    'function settleAuction(uint256)',
    'function deliverKey(uint256,string,bytes)',
    'function claimKeyDeadlineRefund(uint256)',
    'function raiseDispute(uint256,string)',
    'function withdraw()',
    'function listSecondary(uint256,uint256)',
    'function buySecondary(uint256) payable',
    'event IdeaListed(uint256 indexed,address indexed,string,string,uint256,uint256,uint256,uint256)',
    'event BidCommitted(uint256 indexed,address indexed,bytes32,uint256,uint256)',
    'event AuctionSettled(uint256 indexed,address indexed,uint256,uint256,uint256,uint256)',
    'event FundsReleased(uint256 indexed,address indexed,uint256,address,uint256)',
  ],
  GOVERNOR: [
    'function canBid(address) view returns (bool,string)',
    'function canList(address) view returns (bool,string)',
    'function getTrustTier(address) view returns (string)',
    'function getReputationScore(address) view returns (uint256)',
    'function getGovernanceStats() view returns (uint256,uint256,uint256,bool)',
  ],
  VALUATION: [
    'function quickEstimate(uint256,string,uint256) view returns (uint256,uint256,uint256)',
    'function getValuation(uint256) view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256))',
    'function getCategoryProfile(string) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  ],
};

const Chain = (() => {

  let provider  = null;
  let signer    = null;
  let contracts = { cryptvalt: null, governor: null, valuation: null };

  async function loadEthers() {
    if (window.ethers) return;
    await new Promise((resolve, reject) => {
      const s   = document.createElement('script');
      s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js';
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (!window.ethereum) return false;
    try {
      await loadEthers();
      provider = new ethers.BrowserProvider(window.ethereum);
      signer   = await provider.getSigner();

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CONFIG.CHAIN_ID) {
        await switchNetwork();
      }

      if (CONFIG.CONTRACTS.CRYPTVALT) {
        contracts.cryptvalt = new ethers.Contract(CONFIG.CONTRACTS.CRYPTVALT, ABIS.CRYPTVALT, signer);
      }
      if (CONFIG.CONTRACTS.GOVERNOR) {
        contracts.governor  = new ethers.Contract(CONFIG.CONTRACTS.GOVERNOR, ABIS.GOVERNOR, provider);
      }
      if (CONFIG.CONTRACTS.VALUATION) {
        contracts.valuation = new ethers.Contract(CONFIG.CONTRACTS.VALUATION, ABIS.VALUATION, provider);
      }

      return true;
    } catch(e) {
      console.error('Chain init error:', e);
      return false;
    }
  }

  async function switchNetwork() {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + CONFIG.CHAIN_ID.toString(16) }]
      });
    } catch(e) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId:         '0x' + CONFIG.CHAIN_ID.toString(16),
          chainName:       CONFIG.CHAIN_NAME,
          rpcUrls:         [CONFIG.RPC_URL],
          nativeCurrency:  { name: 'ETH', symbol: 'ETH', decimals: 18 },
          blockExplorerUrls: ['https://sepolia.etherscan.io']
        }]
      });
    }
  }

  async function signTypedData(action, listingId) {
    if (!signer || !CONFIG.CONTRACTS.CRYPTVALT) return '0x' + '0'.repeat(130);
    try {
      const nonce = await contracts.cryptvalt.getNonce(await signer.getAddress());
      return await signer.signTypedData(
        { name: 'CryptValt', version: '2', chainId: CONFIG.CHAIN_ID, verifyingContract: CONFIG.CONTRACTS.CRYPTVALT },
        { CryptValt: [{ name: 'action', type: 'string' }, { name: 'listingId', type: 'uint256' }, { name: 'signer', type: 'address' }, { name: 'nonce', type: 'uint256' }] },
        { action, listingId: listingId || 0, signer: await signer.getAddress(), nonce }
      );
    } catch(e) {
      return '0x' + '0'.repeat(130);
    }
  }

  async function listIdea(params) {
    if (!contracts.cryptvalt) return { onChain: false, id: 'CV-' + Date.now().toString(36).toUpperCase() };
    try {
      notify('info', '⬡ Submitting On-Chain', 'Confirm transaction in MetaMask...');
      const sig     = await signTypedData('LIST_IDEA', 0);
      const tx      = await contracts.cryptvalt.listIdea(
        params.ipfsCid, params.keyHash, params.category,
        params.aiScore, params.dollarValueMidUSD,
        ethers.parseEther(params.reserveETH.toString()),
        params.durationSeconds, params.royaltyBps, sig
      );
      notify('info', '⬡ Transaction Sent', 'Waiting for confirmation...');
      const receipt = await tx.wait();
      const event   = receipt.logs
        .map(log => { try { return contracts.cryptvalt.interface.parseLog(log); } catch { return null; } })
        .find(e => e && e.name === 'IdeaListed');
      const listingId = event ? Number(event.args.listingId) : null;
      notify('success', '✓ Listed On-Chain', `Listing #${listingId} confirmed.`);
      return { onChain: true, listingId, txHash: receipt.hash };
    } catch(e) {
      notify('error', 'Transaction Failed', e.reason || e.message);
      throw e;
    }
  }

  async function commitBid(listingId, commitment, depositETH) {
    if (!contracts.cryptvalt) return { onChain: false };
    try {
      notify('info', '⬡ Sealing Bid', 'Confirm in MetaMask...');
      const tx      = await contracts.cryptvalt.commitBid(listingId, commitment, { value: ethers.parseEther(depositETH.toString()) });
      const receipt = await tx.wait();
      notify('success', '✓ Bid Sealed On-Chain', `TX: ${receipt.hash.slice(0,12)}...`);
      return { onChain: true, txHash: receipt.hash };
    } catch(e) {
      notify('error', 'Bid Failed', e.reason || e.message);
      throw e;
    }
  }

  async function deliverKey(listingId, encryptedKey) {
    if (!contracts.cryptvalt) return { onChain: false };
    try {
      notify('info', '⬡ Delivering Key', 'Confirm in MetaMask...');
      const sig     = await signTypedData('DELIVER_KEY', listingId);
      const tx      = await contracts.cryptvalt.deliverKey(listingId, encryptedKey, sig);
      const receipt = await tx.wait();
      notify('success', '✓ Key Delivered — Funds Released', `TX: ${receipt.hash.slice(0,12)}...`);
      return { onChain: true, txHash: receipt.hash };
    } catch(e) {
      notify('error', 'Key Delivery Failed', e.reason || e.message);
      throw e;
    }
  }

  async function withdraw() {
    if (!contracts.cryptvalt) return { onChain: false };
    try {
      const pending = await contracts.cryptvalt.pendingWithdrawals(state.wallet);
      if (pending === 0n) { notify('info', 'Nothing to Withdraw', 'No pending funds.'); return; }
      const tx      = await contracts.cryptvalt.withdraw();
      const receipt = await tx.wait();
      notify('success', '✓ Withdrawal Complete', `TX: ${receipt.hash.slice(0,12)}...`);
      return { onChain: true, txHash: receipt.hash };
    } catch(e) {
      notify('error', 'Withdrawal Failed', e.reason || e.message);
      throw e;
    }
  }

  async function fetchOnChainListings() {
    if (!contracts.cryptvalt) return [];
    try {
      const count    = await contracts.cryptvalt.listingCount();
      const listings = [];
      for (let i = 1; i <= Number(count); i++) {
        try {
          const l = await contracts.cryptvalt.getListing(i);
          listings.push({
            id: 'CV-' + i, onChainId: i,
            title: l[16] || 'Encrypted Idea',
            category: l[19] || 'other',
            cid: l[16], keyHash: l[17],
            reserve: Number(ethers.formatEther(l[0])),
            aiScore: Number(l[7]),
            royalty: Number(l[6]) / 100,
            created: Number(l[1]) * 1000,
            endsAt:  Number(l[2]) * 1000,
            status:  ['live','reveal','awaiting_key','key_delivered','complete','disputed','cancelled','frozen'][Number(l[12])] || 'live',
            wallet:  l[9], winner: l[11],
            winningBid: Number(ethers.formatEther(l[3])),
            bidCount: Number(l[10]),
            keyDelivered: l[13], fundsReleased: l[14],
            score: { overallScore: Number(l[7]), dollarValueMid: Number(l[8]), dollarValueMin: Number(l[8]) * 0.7, dollarValueMax: Number(l[8]) * 1.4, scores: { marketability: Number(l[7]), scalability: Number(l[7]), consumerPotential: Number(l[7]), competitiveMoat: Number(l[7]), executionFeasibility: Number(l[7]), revenueClarity: Number(l[7]) } },
            bids: [], onChain: true,
          });
        } catch(e) { continue; }
      }
      return listings;
    } catch(e) { return []; }
  }

  async function getWalletReputation(wallet) {
    if (!contracts.governor) return null;
    try {
      const rep  = await contracts.governor.getReputationScore(wallet);
      const tier = await contracts.governor.getTrustTier(wallet);
      return { reputation: Number(rep), tier };
    } catch(e) { return null; }
  }

  function startEventListeners() {
    if (!contracts.cryptvalt) return;
    contracts.cryptvalt.on('IdeaListed', (listingId, inventor) => {
      if (typeof addClaudeEntry === 'function')
        addClaudeEntry('ok', 'On-Chain: Idea Listed', `Listing #${listingId} by ${shortenAddr(inventor)}.`);
      if (typeof updateStats === 'function') updateStats();
    });
    contracts.cryptvalt.on('AuctionSettled', (listingId, winner, winningBid) => {
      if (typeof addClaudeEntry === 'function')
        addClaudeEntry('ok', 'On-Chain: Auction Settled', `Listing #${listingId} sold for ${ethers.formatEther(winningBid)} ETH.`);
    });
    contracts.cryptvalt.on('FundsReleased', (listingId, inventor, amount) => {
      if (typeof addClaudeEntry === 'function')
        addClaudeEntry('ok', 'On-Chain: Funds Released', `${ethers.formatEther(amount)} ETH to inventor for listing #${listingId}.`);
    });
  }

  function isDeployed() { return CONFIG.CONTRACTS.CRYPTVALT !== null; }

  return { init, listIdea, commitBid, deliverKey, withdraw, fetchOnChainListings, getWalletReputation, startEventListeners, isDeployed };

})();
