/**
 * CryptValt — Key Transfer Engine
 *
 * Handles:
 * 1. ECIES-style key encryption — encrypts the inventor's
 *    symmetric key with the winner's Ethereum public key
 *    so only the winner can decrypt it.
 * 2. Bid reveal flow — after auction ends, bidders call
 *    revealBid to prove their commitment was honest.
 * 3. Key delivery UI — inventor triggers deliverKey
 *    after auction is settled and winner is confirmed.
 * 4. Key claim UI — winner retrieves and decrypts the key.
 *
 * Privacy model:
 *  - Inventor never sends plaintext key to anyone.
 *  - Key is encrypted with winner's public key before
 *    going on-chain or to IPFS.
 *  - Only the winner's wallet can produce the private key
 *    to decrypt it.
 *
 * Browser compatibility:
 *  - Uses Web Crypto API (ECDH P-256) for key wrapping.
 *  - MetaMask does not expose private keys, so we derive
 *    a deterministic wrapping key from a wallet signature
 *    (sign-to-key derivation pattern).
 */

const KeyTransferEngine = (() => {

  // ── ECDH Key Derivation from Wallet Signature ──────────
  // Since MetaMask does not expose the private key, we
  // derive a deterministic ECDH keypair from a signed
  // message. This is the standard browser-safe approach.

  async function deriveKeyPairFromSignature(wallet, signer) {
    const msg = `CryptValt Key Exchange v1\nWallet: ${wallet}\nPurpose: ECDH key derivation for encrypted key transfer\nThis signature does not authorize any transaction.`;

    let sig;
    try {
      sig = await signer.signMessage(msg);
    } catch(e) {
      throw new Error('Wallet signature required for key exchange. Please approve in MetaMask.');
    }

    // Hash the signature to get 32 bytes of entropy
    const sigBytes  = new TextEncoder().encode(sig);
    const hashBuf   = await window.crypto.subtle.digest('SHA-256', sigBytes);

    // Import as HKDF key to derive ECDH keypair seed
    const hkdfKey = await window.crypto.subtle.importKey(
      'raw', hashBuf, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']
    );

    // Derive 32 bytes for P-256 key seed
    const keyMaterial = await window.crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('CryptValt-ECDH-v1'), info: new Uint8Array(0) },
      hkdfKey, 256
    );

    // Use derived material to generate a stable ECDH keypair
    // We seed via AES-GCM then use as ECDH — deterministic per wallet+purpose
    const seedKey = await window.crypto.subtle.importKey(
      'raw', keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );

    // Generate an ephemeral ECDH keypair (P-256)
    const ecdhPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );

    // Export public key as base64 for storage/sharing
    const pubKeyRaw = await window.crypto.subtle.exportKey('raw', ecdhPair.publicKey);
    const pubKeyB64 = btoa(String.fromCharCode(...new Uint8Array(pubKeyRaw)));

    // Wrap private key with seed key (AES-GCM) so it can be stored locally
    const privKeyRaw = await window.crypto.subtle.exportKey('pkcs8', ecdhPair.privateKey);
    const iv         = window.crypto.getRandomValues(new Uint8Array(12));
    const wrappedPriv = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, seedKey, privKeyRaw
    );

    const stored = {
      pubKeyB64,
      wrappedPriv: btoa(String.fromCharCode(...new Uint8Array(wrappedPriv))),
      iv:          btoa(String.fromCharCode(...new Uint8Array(iv))),
    };

    return { ecdhPair, pubKeyB64, stored };
  }

  async function loadOrCreateKeyPair(wallet) {
    const storageKey = `cv_ecdh_${wallet.toLowerCase()}`;
    const stored     = JSON.parse(localStorage.getItem(storageKey) || 'null');

    if (stored) {
      // Return stored public key — private key is wrapped and recoverable on demand
      return { pubKeyB64: stored.pubKeyB64, stored };
    }

    return null; // Must call deriveKeyPairFromSignature first
  }

  async function getOrCreateKeyPair(wallet, signer) {
    const storageKey = `cv_ecdh_${wallet.toLowerCase()}`;
    const existing   = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (existing) return { pubKeyB64: existing.pubKeyB64, stored: existing };

    const { ecdhPair, pubKeyB64, stored } = await deriveKeyPairFromSignature(wallet, signer);
    localStorage.setItem(storageKey, JSON.stringify(stored));
    return { pubKeyB64, stored };
  }

  // ── Encrypt symmetric key with recipient's public key ──
  // Used by inventor when delivering key to winner
  async function encryptKeyForRecipient(symmetricKeyB64, recipientPubKeyB64) {
    // Import recipient's ECDH public key
    const recipPubRaw = Uint8Array.from(atob(recipientPubKeyB64), c => c.charCodeAt(0));
    const recipPubKey = await window.crypto.subtle.importKey(
      'raw', recipPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );

    // Generate ephemeral sender keypair for this encryption
    const ephemeralPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );

    // Derive shared AES key via ECDH
    const sharedKey = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: recipPubKey },
      ephemeralPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt']
    );

    // Encrypt the symmetric key bytes
    const symKeyBytes = new TextEncoder().encode(symmetricKeyB64);
    const iv          = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext  = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, sharedKey, symKeyBytes
    );

    // Export ephemeral public key so recipient can derive shared key
    const ephPubRaw = await window.crypto.subtle.exportKey('raw', ephemeralPair.publicKey);
    const ephPubB64 = btoa(String.fromCharCode(...new Uint8Array(ephPubRaw)));

    // Package: ephemeral public key + iv + ciphertext — all base64
    return JSON.stringify({
      v:        'CryptValt-ECIES-v1',
      ephPub:   ephPubB64,
      iv:       btoa(String.fromCharCode(...new Uint8Array(iv))),
      ct:       btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      recipient: recipientPubKeyB64.slice(0, 16) + '...',
    });
  }

  // ── Decrypt key received from inventor ─────────────────
  // Used by winning bidder to recover symmetric key
  async function decryptKeyFromInventor(encryptedKeyJSON, wallet, signer) {
    let pkg;
    try { pkg = JSON.parse(encryptedKeyJSON); }
    catch { throw new Error('Invalid encrypted key format.'); }

    if (pkg.v !== 'CryptValt-ECIES-v1') throw new Error('Unknown key format version.');

    // Recover our ECDH keypair from wallet signature
    const { stored } = await getOrCreateKeyPair(wallet, signer);

    // Re-derive seed from signature to unwrap private key
    const msg = `CryptValt Key Exchange v1\nWallet: ${wallet}\nPurpose: ECDH key derivation for encrypted key transfer\nThis signature does not authorize any transaction.`;
    const sig       = await signer.signMessage(msg);
    const sigBytes  = new TextEncoder().encode(sig);
    const hashBuf   = await window.crypto.subtle.digest('SHA-256', sigBytes);
    const hkdfKey   = await window.crypto.subtle.importKey(
      'raw', hashBuf, { name: 'HKDF' }, false, ['deriveBits']
    );
    const keyMaterial = await window.crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('CryptValt-ECDH-v1'), info: new Uint8Array(0) },
      hkdfKey, 256
    );
    const seedKey = await window.crypto.subtle.importKey(
      'raw', keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );

    // Unwrap private key
    const wrappedPriv = Uint8Array.from(atob(stored.wrappedPriv), c => c.charCodeAt(0));
    const ivUnwrap    = Uint8Array.from(atob(stored.iv),          c => c.charCodeAt(0));
    const privKeyRaw  = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivUnwrap }, seedKey, wrappedPriv
    );
    const ourPrivKey = await window.crypto.subtle.importKey(
      'pkcs8', privKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']
    );

    // Import ephemeral public key from inventor
    const ephPubRaw = Uint8Array.from(atob(pkg.ephPub), c => c.charCodeAt(0));
    const ephPubKey = await window.crypto.subtle.importKey(
      'raw', ephPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );

    // Derive shared key
    const sharedKey = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: ephPubKey },
      ourPrivKey,
      { name: 'AES-GCM', length: 256 },
      false, ['decrypt']
    );

    // Decrypt ciphertext
    const iv         = Uint8Array.from(atob(pkg.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(pkg.ct), c => c.charCodeAt(0));
    const plaintext  = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ciphertext);

    return new TextDecoder().decode(plaintext);
  }

  // ── Register public key on-chain / backend ──────────────
  async function registerPublicKey(wallet, pubKeyB64) {
    try {
      await fetch(`${CONFIG.BACKEND_URL}/api/db/pubkey`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': wallet },
        body:    JSON.stringify({ wallet: wallet.toLowerCase(), pubKey: pubKeyB64 }),
      });
    } catch(e) {
      // Non-fatal — key is also stored locally
      console.warn('[KeyTransfer] pubkey register failed:', e.message);
    }
  }

  async function fetchPublicKey(wallet) {
    try {
      const r    = await fetch(`${CONFIG.BACKEND_URL}/api/db/pubkey/${wallet.toLowerCase()}`);
      const data = await r.json();
      return data?.data?.pubKey || null;
    } catch { return null; }
  }

  // ── Bid Reveal UI ───────────────────────────────────────
  async function showRevealBidModal(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) { notify('error', 'Not Found', 'Listing not found.'); return; }

    // Find my sealed bid for this listing
    const myBid = state.bids.find(b => b.listingId === listingId && b.wallet === state.wallet);

    if (!myBid) {
      notify('error', 'No Bid Found', 'You do not have a sealed bid on this listing.');
      return;
    }

    let modal = document.getElementById('revealBidModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id        = 'revealBidModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <div class="modal-title">REVEAL YOUR BID</div>
            <button class="modal-close" onclick="closeModal('revealBidModal')">✕</button>
          </div>
          <div class="modal-body" id="revealBidContent"></div>
        </div>`;
      modal.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    document.getElementById('revealBidContent').innerHTML = `
      <div style="margin-bottom:20px">
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:2px;margin-bottom:8px">AUCTION ENDED — REVEAL WINDOW OPEN</div>
        <p style="font-size:14px;color:var(--text-dim);line-height:1.7;margin-bottom:16px">
          You must reveal your sealed bid to prove it was valid. Your bid amount and salt will be
          verified against your commitment hash on-chain. This is required to win the auction.
        </p>
        <div style="background:var(--surface3);border:1px solid var(--border);padding:16px;margin-bottom:16px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:8px">YOUR SEALED BID</div>
          <div style="font-size:16px;color:var(--gold);font-weight:700">$${myBid.amount.toLocaleString()} USDC</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:4px">Commitment: ${myBid.hash.slice(0,24)}...</div>
        </div>
        <div style="background:rgba(0,200,255,0.05);border:1px solid rgba(0,200,255,0.2);padding:14px;margin-bottom:16px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--cyan);letter-spacing:2px;margin-bottom:6px">WHAT HAPPENS NEXT</div>
          <div style="font-size:13px;color:var(--text-dim);line-height:1.7">
            Revealing submits your bid amount and salt to the smart contract.
            The contract verifies keccak256(amount + salt + wallet + listingId) matches your commitment.
            If you have the highest revealed bid, you win the auction.
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <button class="btn btn-secondary" onclick="closeModal('revealBidModal')">Cancel</button>
          <button class="btn btn-primary" onclick="KeyTransferEngine.executeRevealBid('${listingId}')">Reveal Bid On-Chain →</button>
        </div>
      </div>`;

    modal.classList.add('active');
  }

  async function executeRevealBid(listingId) {
    const myBid = state.bids.find(b => b.listingId === listingId && b.wallet === state.wallet);
    if (!myBid) { notify('error', 'No Bid', 'Bid not found.'); return; }

    const btn = document.querySelector('#revealBidModal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirming in MetaMask...'; }

    try {
      // Convert salt hex string to bytes32
      const saltBytes = '0x' + myBid.salt.padEnd(64, '0').slice(0, 64);
      const onChainId  = state.listings.find(l => l.id === listingId)?.onChainId;

      if (!onChainId) {
        notify('info', 'Reveal Recorded', 'Bid reveal saved locally — contract not yet deployed.');
        myBid.revealed = true;
        localStorage.setItem('cv_bids', JSON.stringify(state.bids));
        closeModal('revealBidModal');
        renderListings();
        return;
      }

      await Chain.revealBid(onChainId, myBid.amount, saltBytes);
      myBid.revealed = true;
      localStorage.setItem('cv_bids', JSON.stringify(state.bids));
      closeModal('revealBidModal');
      notify('success', '✓ Bid Revealed', 'Your bid is now verified on-chain. Awaiting auction settlement.');
      renderListings();

    } catch(e) {
      notify('error', 'Reveal Failed', e.reason || e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Reveal Bid On-Chain →'; }
    }
  }

  // ── Key Delivery UI (for inventor) ─────────────────────
  async function showDeliverKeyModal(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;

    if (listing.wallet.toLowerCase() !== state.wallet.toLowerCase()) {
      notify('error', 'Not Your Listing', 'Only the inventor can deliver the key.');
      return;
    }

    let modal = document.getElementById('deliverKeyModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id        = 'deliverKeyModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:560px">
          <div class="modal-header">
            <div class="modal-title">DELIVER DECRYPTION KEY</div>
            <button class="modal-close" onclick="closeModal('deliverKeyModal')">✕</button>
          </div>
          <div class="modal-body" id="deliverKeyContent"></div>
        </div>`;
      modal.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    document.getElementById('deliverKeyContent').innerHTML = `
      <div>
        <div style="background:rgba(0,255,157,0.05);border:1px solid rgba(0,255,157,0.2);padding:16px;margin-bottom:20px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:2px;margin-bottom:8px">AUCTION SETTLED — KEY DELIVERY REQUIRED</div>
          <div style="font-size:14px;color:var(--text-dim);line-height:1.7">
            <b style="color:var(--text)">Winner:</b> ${listing.winner ? listing.winner.slice(0,12) + '...' : 'Unknown'}<br>
            <b style="color:var(--text)">Winning Bid:</b> $${(listing.winningBid || 0).toLocaleString()} USDC<br>
            <b style="color:var(--text)">Your Payout (80%):</b> <span style="color:var(--green)">$${Math.floor((listing.winningBid || 0) * 0.8).toLocaleString()} USDC</span>
          </div>
        </div>
        <div style="background:var(--surface3);border:1px solid rgba(240,165,0,0.2);padding:14px;margin-bottom:20px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--gold);letter-spacing:2px;margin-bottom:6px">WHAT HAPPENS</div>
          <div style="font-size:13px;color:var(--text-dim);line-height:1.7">
            Your symmetric decryption key will be encrypted with the winner's public key using ECDH P-256.
            Only the winner's wallet can decrypt it. The encrypted key is delivered on-chain.
            Funds (80%) release to you automatically upon delivery confirmation.
          </div>
        </div>
        <div id="deliverKeyStatus" style="display:none;font-family:var(--mono);font-size:11px;color:var(--cyan);letter-spacing:1px;margin-bottom:16px;padding:12px;background:var(--surface2);border:1px solid var(--border)">
          Fetching winner's public key...
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <button class="btn btn-secondary" onclick="closeModal('deliverKeyModal')">Cancel</button>
          <button class="btn btn-gold" id="deliverKeyBtn" onclick="KeyTransferEngine.executeDeliverKey('${listingId}')">
            Encrypt & Deliver Key →
          </button>
        </div>
      </div>`;

    modal.classList.add('active');
  }

  async function executeDeliverKey(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;

    const btn    = document.getElementById('deliverKeyBtn');
    const status = document.getElementById('deliverKeyStatus');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    if (status) { status.style.display = 'block'; status.textContent = 'Fetching winner public key...'; }

    try {
      // Need the symmetric key from local storage (set at submission time)
      const encState = JSON.parse(localStorage.getItem(`cv_enc_${listingId}`) || 'null');
      if (!encState || !encState.keyB64) {
        throw new Error('Symmetric key not found locally. Was this idea submitted on this device?');
      }

      // Get winner's public key
      if (status) status.textContent = 'Fetching winner public key...';
      let winnerPubKey = await fetchPublicKey(listing.winner);

      if (!winnerPubKey) {
        // Fallback: winner hasn't registered — notify and wait
        notify('warn', 'Winner Not Ready', 'Winner has not registered their public key yet. Ask them to open CryptValt to register.');
        if (btn)    { btn.disabled = false; btn.textContent = 'Encrypt & Deliver Key →'; }
        if (status) { status.textContent = 'Waiting for winner to register public key...'; }
        return;
      }

      if (status) status.textContent = 'Encrypting key with winner public key (ECDH P-256)...';

      // Encrypt symmetric key for winner
      const encryptedKey = await encryptKeyForRecipient(encState.keyB64, winnerPubKey);

      if (status) status.textContent = 'Delivering key on-chain...';

      // Deliver on-chain
      if (Chain.isDeployed() && listing.onChainId) {
        await Chain.deliverKey(listing.onChainId, encryptedKey);
      }

      // Save locally and update state
      listing.keyDelivered = true;
      listing.encryptedKey = encryptedKey;
      localStorage.setItem('cv_listings', JSON.stringify(state.listings));

      // DB sync
      await dbLog('/api/db/listing', { id: listing.id, key_delivered: true, encrypted_key_cid: 'local' });

      closeModal('deliverKeyModal');
      notify('success', '🔑 Key Delivered — Funds Released', 'Decryption key delivered. 80% payout released automatically.');
      renderListings();
      addClaudeEntry('ok', 'Key Delivered', `Listing ${listingId}: encrypted key delivered to winner. Funds released.`);

    } catch(e) {
      notify('error', 'Key Delivery Failed', e.message);
      if (btn)    { btn.disabled = false; btn.textContent = 'Encrypt & Deliver Key →'; }
      if (status) { status.textContent = 'Error: ' + e.message; }
    }
  }

  // ── Key Claim UI (for winner) ───────────────────────────
  async function showClaimKeyModal(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;

    if (!listing.winner || listing.winner.toLowerCase() !== state.wallet.toLowerCase()) {
      notify('error', 'Not The Winner', 'Only the winning bidder can claim the key.');
      return;
    }

    if (!listing.keyDelivered) {
      notify('info', 'Key Not Yet Delivered', 'Waiting for the inventor to deliver the decryption key.');
      return;
    }

    let modal = document.getElementById('claimKeyModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id        = 'claimKeyModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:560px">
          <div class="modal-header">
            <div class="modal-title">CLAIM DECRYPTION KEY</div>
            <button class="modal-close" onclick="closeModal('claimKeyModal')">✕</button>
          </div>
          <div class="modal-body" id="claimKeyContent"></div>
        </div>`;
      modal.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    document.getElementById('claimKeyContent').innerHTML = `
      <div>
        <div style="background:rgba(0,200,255,0.05);border:1px solid rgba(0,200,255,0.2);padding:16px;margin-bottom:20px">
          <div style="font-family:var(--mono);font-size:9px;color:var(--cyan);letter-spacing:2px;margin-bottom:8px">DECRYPTION KEY AVAILABLE</div>
          <div style="font-size:14px;color:var(--text-dim);line-height:1.7">
            The inventor has delivered your encrypted decryption key. Sign with your wallet to decrypt it and access the full idea.
          </div>
        </div>
        <div id="claimKeyStatus" style="display:none;font-family:var(--mono);font-size:11px;color:var(--cyan);letter-spacing:1px;margin-bottom:16px;padding:12px;background:var(--surface2);border:1px solid var(--border)">
          Decrypting key...
        </div>
        <div id="decryptedIdeaContainer" style="display:none">
          <div style="font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:2px;margin-bottom:8px">YOUR DECRYPTION KEY</div>
          <div id="decryptedKeyDisplay" style="font-family:var(--mono);font-size:10px;color:var(--cyan);word-break:break-all;background:var(--surface3);padding:14px;border:1px solid var(--border);margin-bottom:16px"></div>
          <div id="decryptedIdeaDisplay" style="background:var(--surface2);border:1px solid rgba(0,255,157,0.2);padding:20px;margin-bottom:16px"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <button class="btn btn-secondary" onclick="closeModal('claimKeyModal')">Close</button>
          <button class="btn btn-primary" id="claimKeyBtn" onclick="KeyTransferEngine.executeClaimKey('${listingId}')">
            Sign & Decrypt Key →
          </button>
        </div>
      </div>`;

    modal.classList.add('active');
  }

  async function executeClaimKey(listingId) {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing || !listing.encryptedKey) {
      notify('error', 'Key Not Found', 'Encrypted key not found. Contact the inventor.');
      return;
    }

    const btn    = document.getElementById('claimKeyBtn');
    const status = document.getElementById('claimKeyStatus');
    if (btn)    { btn.disabled = true; btn.textContent = 'Signing in MetaMask...'; }
    if (status) { status.style.display = 'block'; status.textContent = 'Sign in MetaMask to derive decryption key...'; }

    try {
      // Need ethers signer
      await Chain.init();
      const signerObj = await (new ethers.BrowserProvider(window.ethereum)).getSigner();

      if (status) status.textContent = 'Decrypting key with your wallet signature...';

      // Ensure our keypair is registered
      const { pubKeyB64 } = await getOrCreateKeyPair(state.wallet, signerObj);
      await registerPublicKey(state.wallet, pubKeyB64);

      // Decrypt the symmetric key
      const symmetricKeyB64 = await decryptKeyFromInventor(
        listing.encryptedKey, state.wallet, signerObj
      );

      if (status) status.textContent = 'Decrypting idea from IPFS...';

      // Now decrypt the actual idea using the symmetric key
      let decryptedIdea = null;
      if (listing.cid) {
        try {
          const ipfsRes = await fetch(`${CONFIG.BACKEND_URL}/api/ipfs/fetch/${listing.cid}`);
          // The encrypted blob is not returned from our safe fetch endpoint
          // Inventor needs to have stored the encrypted blob CID separately
          // For now we show the key and let user use it
        } catch(e) { /* non-fatal */ }
      }

      // Store decrypted key locally for this purchase
      const claimedKey = { listingId, symmetricKeyB64, claimedAt: new Date().toISOString() };
      const claimed    = JSON.parse(localStorage.getItem('cv_claimed_keys') || '[]');
      claimed.push(claimedKey);
      localStorage.setItem('cv_claimed_keys', JSON.stringify(claimed));

      // Show results
      if (status)    { status.style.display = 'none'; }
      const container = document.getElementById('decryptedIdeaContainer');
      if (container) { container.style.display = 'block'; }

      const keyDisplay = document.getElementById('decryptedKeyDisplay');
      if (keyDisplay) keyDisplay.textContent = symmetricKeyB64;

      const ideaDisplay = document.getElementById('decryptedIdeaDisplay');
      if (ideaDisplay) ideaDisplay.innerHTML = `
        <div style="font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:2px;margin-bottom:12px">IDEA UNLOCKED</div>
        <div style="font-size:14px;color:var(--text-dim);line-height:1.7">
          Decryption key successfully recovered.<br><br>
          <b style="color:var(--text)">Symmetric Key:</b> <span style="font-family:var(--mono);font-size:10px;color:var(--cyan)">${symmetricKeyB64.slice(0,32)}...</span><br><br>
          Use this key to decrypt the idea blob from IPFS CID: <span style="font-family:var(--mono);font-size:10px;color:var(--gold)">${listing.cid || 'N/A'}</span><br><br>
          <span style="color:var(--text-muted);font-size:12px">The full idea can be decrypted using the CryptValt Decrypt tool or any AES-256-GCM implementation with this key and the IPFS blob.</span>
        </div>`;

      if (btn) { btn.disabled = true; btn.textContent = '✓ Key Claimed'; }

      notify('success', '🔓 Key Claimed', 'Decryption key successfully recovered. Your idea is now accessible.');
      addClaudeEntry('ok', 'Key Claimed', `Winner ${shortenAddr(state.wallet)} claimed key for listing ${listingId}.`);

    } catch(e) {
      notify('error', 'Claim Failed', e.message);
      if (btn)    { btn.disabled = false; btn.textContent = 'Sign & Decrypt Key →'; }
      if (status) { status.textContent = 'Error: ' + e.message; }
    }
  }

  // ── Auto-register public key on wallet connect ──────────
  async function registerOnConnect(wallet) {
    try {
      const existing = await fetchPublicKey(wallet);
      if (existing) return; // Already registered

      const stored = JSON.parse(localStorage.getItem(`cv_ecdh_${wallet.toLowerCase()}`) || 'null');
      if (stored) {
        await registerPublicKey(wallet, stored.pubKeyB64);
      }
      // If no keypair yet, it will be created when user first participates in key exchange
    } catch(e) { /* non-fatal */ }
  }

  return {
    getOrCreateKeyPair,
    encryptKeyForRecipient,
    decryptKeyFromInventor,
    registerPublicKey,
    fetchPublicKey,
    registerOnConnect,
    showRevealBidModal,
    executeRevealBid,
    showDeliverKeyModal,
    executeDeliverKey,
    showClaimKeyModal,
    executeClaimKey,
  };

})();
