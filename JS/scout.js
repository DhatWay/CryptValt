/**
 * CryptValt — Scout Referral System v1.0
 *
 * Investors earn a percentage of platform fees when they
 * scout ideas that successfully sell on CryptValt.
 *
 * How it works:
 * - Every investor gets a unique referral code tied to their wallet
 * - They share the code with inventors
 * - Inventor submits idea using the referral link/code
 * - If idea sells, scout automatically earns 15% of platform fee
 * - Multipliers apply for Platinum and Founder holders
 *
 * Scout tiers:
 * - Standard investor  — 15% of platform fee
 * - Platinum member    — 20% of platform fee
 * - Founder NFT holder — 25% of platform fee
 */

const ScoutSystem = (() => {

  const STORAGE_KEY     = 'cv_scout_data';
  const REFERRAL_PARAM  = 'ref';

  // Scout multipliers by tier
  const MULTIPLIERS = {
    standard: 0.15,   // 15% of platform fee
    platinum: 0.20,   // 20%
    founder:  0.25,   // 25%
  };

  // ── Load/Save ──────────────────────────────────────────
  function getData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ── Generate Referral Code ─────────────────────────────
  function generateCode(walletAddress) {
    if (!walletAddress) return null;
    // Code = first 6 chars of wallet + 4 random chars
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'CV' + walletAddress.slice(2, 6).toUpperCase() + random;
  }

  // ── Get or Create Code for Wallet ─────────────────────
  function getCode(walletAddress) {
    if (!walletAddress) return null;
    const data = getData();
    const key  = walletAddress.toLowerCase();

    if (!data[key]) {
      data[key] = {
        code:          generateCode(walletAddress),
        wallet:        walletAddress.toLowerCase(),
        createdAt:     new Date().toISOString(),
        listings:      [],
        successCount:  0,
        totalEarnings: 0,
        claimedAmount: 0,
        tier:          'standard',
      };
      saveData(data);
    }
    return data[key].code;
  }

  // ── Get Referral Link ──────────────────────────────────
  function getReferralLink(walletAddress) {
    const code = getCode(walletAddress);
    if (!code) return null;
    const base = window.location.origin + window.location.pathname;
    return `${base}?${REFERRAL_PARAM}=${code}`;
  }

  // ── Check URL for Referral Code ────────────────────────
  function checkReferralInURL() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get(REFERRAL_PARAM);
    if (code) {
      localStorage.setItem('cv_active_referral', code);
      // Clean URL without removing the code from storage
      const cleanURL = window.location.pathname;
      window.history.replaceState({}, '', cleanURL);
      return code;
    }
    return localStorage.getItem('cv_active_referral');
  }

  // ── Find Scout Wallet from Code ────────────────────────
  function findScoutWallet(code) {
    if (!code) return null;
    const data = getData();
    for (const key in data) {
      if (data[key].code === code) return data[key].wallet;
    }
    return null;
  }

  // ── Register Listing with Scout ────────────────────────
  function registerListing(listingId, inventorWallet, scoutCode) {
    if (!scoutCode) return null;
    const scoutWallet = findScoutWallet(scoutCode);
    if (!scoutWallet) return null;
    if (scoutWallet === inventorWallet.toLowerCase()) return null; // Can't self-refer

    const data   = getData();
    const scout  = data[scoutWallet];
    if (!scout) return null;

    scout.listings.push({
      listingId,
      inventorWallet: inventorWallet.toLowerCase(),
      registeredAt:   new Date().toISOString(),
      status:         'pending',
      saleAmount:     0,
      earned:         0,
    });
    saveData(data);

    // Store active referral for this listing
    localStorage.setItem(`cv_listing_scout_${listingId}`, scoutWallet);
    return scoutWallet;
  }

  // ── Record Successful Sale ─────────────────────────────
  function recordSale(listingId, saleAmount, platformFee) {
    const scoutWallet = localStorage.getItem(`cv_listing_scout_${listingId}`);
    if (!scoutWallet) return null;

    const data  = getData();
    const scout = data[scoutWallet];
    if (!scout) return null;

    const multiplier = MULTIPLIERS[scout.tier] || MULTIPLIERS.standard;
    const earned     = Math.floor(platformFee * multiplier);

    const listing = scout.listings.find(l => l.listingId === listingId);
    if (listing) {
      listing.status     = 'sold';
      listing.saleAmount = saleAmount;
      listing.earned     = earned;
      listing.soldAt     = new Date().toISOString();
    }

    scout.successCount++;
    scout.totalEarnings += earned;
    saveData(data);

    return { scoutWallet, earned, multiplier };
  }

  // ── Get Scout Profile ──────────────────────────────────
  function getProfile(walletAddress) {
    if (!walletAddress) return null;
    const data = getData();
    return data[walletAddress.toLowerCase()] || null;
  }

  // ── Get Pending Earnings ───────────────────────────────
  function getPendingEarnings(walletAddress) {
    const profile = getProfile(walletAddress);
    if (!profile) return 0;
    return profile.totalEarnings - profile.claimedAmount;
  }

  // ── Update Scout Tier ──────────────────────────────────
  function updateTier(walletAddress, tier) {
    const data = getData();
    const key  = walletAddress.toLowerCase();
    if (data[key]) {
      data[key].tier = tier;
      saveData(data);
    }
  }

  // ── Get Leaderboard ────────────────────────────────────
  function getLeaderboard(limit = 10) {
    const data    = getData();
    const scouts  = Object.values(data)
      .filter(s => s.successCount > 0)
      .sort((a, b) => b.totalEarnings - a.totalEarnings)
      .slice(0, limit);
    return scouts;
  }

  return {
    getCode,
    getReferralLink,
    checkReferralInURL,
    registerListing,
    recordSale,
    getProfile,
    getPendingEarnings,
    updateTier,
    getLeaderboard,
    findScoutWallet,
    MULTIPLIERS,
  };

})();
