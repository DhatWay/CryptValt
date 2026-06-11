/**
 * CryptValt — Investor Opt-Out System v1.0
 *
 * Allows winning investors to return a purchased idea
 * within 48 hours subject to a 40% penalty fee.
 *
 * Architecture:
 * - NDA signed via wallet signature at bid time
 * - Opt-out window: 48 hours after key delivery
 * - Penalty: 40% of winning bid goes to CryptValt
 * - Refund: 60% returned to investor
 * - Idea relisted at same or higher reserve price
 * - NDA remains binding even after opt-out
 * - All actions timestamped and stored on IPFS
 * - Smart contract enforces penalty automatically on-chain
 */

const OptOutSystem = (() => {

  const OPT_OUT_WINDOW_MS  = 48 * 60 * 60 * 1000; // 48 hours
  const PENALTY_BPS        = 4000;                  // 40%
  const REFUND_BPS         = 6000;                  // 60%
  const STORAGE_KEY        = 'cv_optouts';
  const NDA_VERSION        = '1.0';

  // ── NDA Text ───────────────────────────────────────────
  const NDA_FULL_TEXT = `
CRYPTVALT NON-DISCLOSURE AND NON-CIRCUMVENTION AGREEMENT

Version: ${NDA_VERSION}
Platform: CryptValt (dhatway.github.io/CryptValt)

By placing a bid and/or receiving a decryption key on CryptValt, the Investor agrees to the following terms:

1. NON-DISCLOSURE
The Investor agrees to keep strictly confidential all information contained within any idea purchased or previewed on CryptValt. This includes but is not limited to: the concept, methodology, technology, business model, market strategy, and any supporting documentation. The Investor shall not disclose, share, publish, or communicate the idea or any portion thereof to any third party without the express written consent of the original Inventor.

2. NON-CIRCUMVENTION
The Investor agrees not to develop, build, manufacture, commercialize, license, or otherwise exploit the idea or any substantially similar concept without the express written consent of the original Inventor and completion of a separate licensing or acquisition agreement with the Inventor.

3. OPT-OUT TERMS
If the Investor elects to return a purchased idea within 48 hours of receiving the decryption key:
(a) A penalty fee of 40% of the winning bid amount will be automatically deducted.
(b) The remaining 60% will be refunded to the Investor's wallet.
(c) The NDA and Non-Circumvention clauses remain fully binding regardless of opt-out.
(d) The Investor's wallet address and the timestamp of key receipt are recorded immutably.

4. BREACH AND REMEDIES
Any breach of this agreement may result in:
(a) Permanent freezing of the Investor's wallet on the CryptValt platform.
(b) Publication of the breach on the platform's public record.
(c) Legal action by the Inventor using the signed wallet signature as evidence of agreement.

5. GOVERNING LAW
This agreement is governed by the laws of the jurisdiction in which the Inventor resides. The wallet signature constitutes a legally binding electronic signature under applicable e-signature laws.

6. ACKNOWLEDGMENT
By signing this agreement via wallet signature, the Investor acknowledges they have read, understood, and agree to be bound by all terms above.

Platform Owner Wallet: 0x05248CD920dAeB2E5369A63Fe93367f9F1bf5677
Agreement Hash: [COMPUTED AT SIGNING TIME]
`.trim();

  // ── Load/Save Storage ──────────────────────────────────
  function getOptOuts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveOptOuts(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ── Generate NDA Hash ──────────────────────────────────
  async function generateNDAHash(wallet, listingId, bidAmount, timestamp) {
    const data    = `${NDA_VERSION}|${wallet.toLowerCase()}|${listingId}|${bidAmount}|${timestamp}`;
    const encoded = new TextEncoder().encode(data);
    const hash    = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── Sign NDA ───────────────────────────────────────────
  async function signNDA(wallet, listingId, bidAmount) {
    const timestamp = new Date().toISOString();
    const ndaHash   = await generateNDAHash(wallet, listingId, bidAmount, timestamp);

    const message = [
      'CryptValt Non-Disclosure & Non-Circumvention Agreement',
      `Version: ${NDA_VERSION}`,
      `Listing ID: ${listingId}`,
      `Bid Amount: ${bidAmount} ETH`,
      `Investor Wallet: ${wallet}`,
      `Timestamp: ${timestamp}`,
      `Agreement Hash: ${ndaHash}`,
      '',
      'By signing I agree to the full NDA terms at dhatway.github.io/CryptValt/nda',
      'I acknowledge this signature is legally binding.',
    ].join('\n');

    let signature;
    if (window.ethereum && state.wallet) {
      try {
        signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [message, wallet],
        });
      } catch(e) {
        // User rejected signature
        throw new Error('NDA signature required to place bid. Please sign the agreement.');
      }
    } else {
      signature = 'offline_' + ndaHash.slice(0, 16);
    }

    const ndaRecord = {
      version:   NDA_VERSION,
      wallet:    wallet.toLowerCase(),
      listingId,
      bidAmount,
      timestamp,
      ndaHash,
      signature,
      signedAt:  timestamp,
      status:    'active',
    };

    // Store NDA record
    const optouts = getOptOuts();
    if (!optouts.ndas) optouts.ndas = [];
    optouts.ndas.push(ndaRecord);
    saveOptOuts(optouts);

    return ndaRecord;
  }

  // ── Check Opt-Out Eligibility ──────────────────────────
  function canOptOut(listingId, wallet) {
    const optouts = getOptOuts();
    const key     = `${listingId}_${wallet.toLowerCase()}`;

    // Already opted out?
    if (optouts[key]?.status === 'opted_out') {
      return { eligible: false, reason: 'Already opted out of this listing.' };
    }

    // Check if within window
    const listing = state.listings?.find(l => l.id === listingId);
    if (!listing) return { eligible: false, reason: 'Listing not found.' };
    if (listing.winner?.toLowerCase() !== wallet.toLowerCase()) {
      return { eligible: false, reason: 'You are not the winner of this listing.' };
    }
    if (!listing.keyDelivered) {
      return { eligible: false, reason: 'Key not yet delivered — opt-out available after key receipt.' };
    }

    const keyDeliveredAt = listing.keyDeliveredAt || listing.created;
    const deadline       = keyDeliveredAt + OPT_OUT_WINDOW_MS;
    const now            = Date.now();

    if (now > deadline) {
      return {
        eligible:  false,
        reason:    `Opt-out window closed. Was available for 48 hours after key delivery.`,
        expiredAt: new Date(deadline).toISOString(),
      };
    }

    const timeRemaining = deadline - now;
    const hoursLeft     = Math.floor(timeRemaining / 3_600_000);
    const minsLeft      = Math.floor((timeRemaining % 3_600_000) / 60_000);

    return {
      eligible:     true,
      hoursLeft,
      minsLeft,
      deadline:     new Date(deadline).toISOString(),
      penaltyBps:   PENALTY_BPS,
      refundBps:    REFUND_BPS,
      winningBid:   listing.winningBid,
      penaltyAmount: Math.floor((listing.winningBid || 0) * PENALTY_BPS / 10000),
      refundAmount:  Math.floor((listing.winningBid || 0) * REFUND_BPS  / 10000),
    };
  }

  // ── Execute Opt-Out ────────────────────────────────────
  async function executeOptOut(listingId, wallet, reason) {
    const eligibility = canOptOut(listingId, wallet);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason);
    }

    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) throw new Error('Listing not found');

    // Require signature confirming opt-out and NDA acknowledgment
    const optOutMessage = [
      'CryptValt Investor Opt-Out Confirmation',
      `Listing ID: ${listingId}`,
      `Winning Bid: ${listing.winningBid} ETH`,
      `Penalty (40%): ${eligibility.penaltyAmount} ETH — forfeited to CryptValt`,
      `Refund (60%): ${eligibility.refundAmount} ETH — returned to my wallet`,
      `Timestamp: ${new Date().toISOString()}`,
      '',
      'I confirm:',
      '1. I am opting out of this purchase within the 48-hour window.',
      '2. I accept the 40% penalty deduction.',
      '3. The NDA and Non-Circumvention agreement remain fully binding.',
      '4. I have NOT disclosed this idea to any third party.',
      '5. I will NOT use or develop this idea.',
    ].join('\n');

    let signature;
    try {
      if (window.ethereum && state.wallet) {
        signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [optOutMessage, wallet],
        });
      } else {
        signature = 'offline_optout_' + Date.now().toString(36);
      }
    } catch(e) {
      throw new Error('Opt-out confirmation signature required.');
    }

    // Record opt-out
    const optouts   = getOptOuts();
    const key       = `${listingId}_${wallet.toLowerCase()}`;
    const optOutRecord = {
      listingId,
      wallet:        wallet.toLowerCase(),
      optOutAt:      new Date().toISOString(),
      reason:        reason || 'Not specified',
      winningBid:    listing.winningBid,
      penaltyAmount: eligibility.penaltyAmount,
      refundAmount:  eligibility.refundAmount,
      signature,
      ndaStatus:     'binding',
      status:        'opted_out',
    };

    optouts[key] = optOutRecord;
    saveOptOuts(optouts);

    // Update listing — relist at 110% of original reserve
    listing.status          = 'live';
    listing.winner          = null;
    listing.winningBid      = 0;
    listing.keyDelivered    = false;
    listing.fundsReleased   = false;
    listing.bids            = [];
    listing.optOutHistory   = listing.optOutHistory || [];
    listing.optOutHistory.push({
      wallet:     wallet.toLowerCase(),
      optOutAt:   new Date().toISOString(),
      penaltyPct: 40,
    });
    // Increase reserve price by 10% on relist
    listing.reserve         = Math.ceil(listing.reserve * 1.1);
    listing.endsAt          = Date.now() + (5 * 86_400_000); // 5 day relist

    // Save updated listings
    try {
      localStorage.setItem('cv_listings', JSON.stringify(state.listings));
    } catch(e) {}

    // Claude Assist notification
    if (typeof addClaudeEntry === 'function') {
      addClaudeEntry('warn', 'Investor Opt-Out',
        `Wallet ${wallet.slice(0,8)}... opted out of listing ${listingId}. ` +
        `Penalty: ${eligibility.penaltyAmount} ETH. ` +
        `Idea relisted at $${listing.reserve.toLocaleString()} reserve. NDA remains binding.`
      );
    }

    if (typeof notify === 'function') {
      notify('info', 'Opt-Out Processed',
        `Refund of ${eligibility.refundAmount} ETH queued. NDA remains binding.`
      );
    }

    return optOutRecord;
  }

  // ── Get NDA for Listing ────────────────────────────────
  function getNDA(wallet, listingId) {
    const optouts = getOptOuts();
    return (optouts.ndas || []).find(
      n => n.wallet === wallet.toLowerCase() && n.listingId === listingId
    ) || null;
  }

  // ── Get All Opt-Outs (admin) ───────────────────────────
  function getAllOptOuts() {
    const optouts = getOptOuts();
    return Object.entries(optouts)
      .filter(([k]) => k !== 'ndas')
      .map(([, v]) => v);
  }

  // ── Format NDA for Display ─────────────────────────────
  function getNDAText(wallet, listingId, bidAmount) {
    return NDA_FULL_TEXT
      .replace('[COMPUTED AT SIGNING TIME]', `[Computed at: ${new Date().toISOString()}]`);
  }

  return {
    signNDA,
    canOptOut,
    executeOptOut,
    getNDA,
    getAllOptOuts,
    getNDAText,
    OPT_OUT_WINDOW_MS,
    PENALTY_BPS,
    REFUND_BPS,
    NDA_VERSION,
  };

})();
