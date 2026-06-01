/**
 * CryptValt — Investor Access Key System v1.0
 *
 * Controls who can place bids on the platform.
 * Investors apply, Claude AI screens them, approved
 * wallets receive a cryptographic access key.
 *
 * Pre-deployment: keys stored in localStorage + IPFS
 * Post-deployment: keys verified on-chain by Governor contract
 */

const InvestorKeySystem = (() => {

  const KEY_PREFIX    = 'CVK-';
  const KEY_VERSION   = '1';
  const STORAGE_KEY   = 'cv_investor_keys';
  const PENDING_KEY   = 'cv_pending_applications';

  // ── Application Status ─────────────────────────────────
  const STATUS = {
    PENDING:  'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REVOKED:  'revoked',
  };

  // ── Load stored data ───────────────────────────────────
  function getApprovedKeys() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function getPendingApplications() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch { return []; }
  }

  function saveApprovedKeys(keys) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  }

  function savePendingApplications(apps) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(apps));
  }

  // ── Check if wallet has valid key ──────────────────────
  function hasValidKey(walletAddress) {
    if (!walletAddress) return false;
    const keys = getApprovedKeys();
    const entry = keys[walletAddress.toLowerCase()];
    if (!entry) return false;
    if (entry.status !== STATUS.APPROVED) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) return false;
    return true;
  }

  function getKey(walletAddress) {
    const keys = getApprovedKeys();
    return keys[walletAddress.toLowerCase()] || null;
  }

  // ── Generate Access Key ────────────────────────────────
  async function generateAccessKey(walletAddress, tier = 'standard') {
    const random    = Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    const timestamp = Date.now().toString(36).toUpperCase();
    const key       = `${KEY_PREFIX}${KEY_VERSION}-${tier.toUpperCase()}-${timestamp}-${random.toUpperCase().slice(0,8)}`;

    // Hash the key for verification
    const encoded = new TextEncoder().encode(key + walletAddress.toLowerCase());
    const hash    = await window.crypto.subtle.digest('SHA-256', encoded);
    const keyHash = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2,'0')).join('');

    return { key, keyHash, tier };
  }

  // ── Submit Application ─────────────────────────────────
  async function submitApplication(walletAddress, applicationData) {
    const apps = getPendingApplications();

    // Check if already applied
    const existing = apps.find(a => a.wallet === walletAddress.toLowerCase());
    if (existing) {
      if (existing.status === STATUS.PENDING) {
        throw new Error('Application already pending. Please wait for review.');
      }
      if (existing.status === STATUS.APPROVED) {
        throw new Error('You already have an approved investor key.');
      }
    }

    // Screen with Claude AI via backend
    const screening = await screenApplication(walletAddress, applicationData);

    const application = {
      id:          'APP-' + Date.now().toString(36).toUpperCase(),
      wallet:      walletAddress.toLowerCase(),
      status:      STATUS.PENDING,
      submittedAt: new Date().toISOString(),
      screening,
      data:        applicationData,
    };

    // Auto-approve if screening score is high enough
    if (screening.score >= 70 && screening.recommendation === 'approve') {
      const { key, keyHash, tier } = await generateAccessKey(walletAddress, screening.tier || 'standard');
      application.status    = STATUS.APPROVED;
      application.approvedAt = new Date().toISOString();
      application.key       = key;
      application.keyHash   = keyHash;
      application.tier      = tier;

      // Save approved key
      const keys = getApprovedKeys();
      keys[walletAddress.toLowerCase()] = {
        key,
        keyHash,
        tier,
        wallet:     walletAddress.toLowerCase(),
        status:     STATUS.APPROVED,
        approvedAt: new Date().toISOString(),
        expiresAt:  null, // No expiry by default
        screening,
      };
      saveApprovedKeys(keys);
    }

    apps.push(application);
    savePendingApplications(apps);

    return application;
  }

  // ── Screen Application with Claude ────────────────────
  async function screenApplication(walletAddress, data) {
    try {
      const response = await fetch(
        (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/score/assist',
        {
          method:  'POST',
          headers: {
            'Content-Type':     'application/json',
            'X-Wallet-Address': walletAddress,
          },
          body: JSON.stringify({
            query: `Screen this investor application for CryptValt — an encrypted idea marketplace. Return ONLY JSON: { "score": <0-100>, "recommendation": "approve" or "reject", "tier": "standard" or "premium", "reason": "<one sentence>", "riskLevel": "low" or "medium" or "high" }`,
            platformContext: {
              application: data,
              wallet: walletAddress,
              platform: 'CryptValt Investor Access',
            },
          }),
        }
      );

      if (!response.ok) throw new Error('Screening failed');
      const result   = await response.json();
      const text     = result.data?.response || '';
      const clean    = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      try {
        const match = clean.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : defaultScreening();
      } catch {
        return defaultScreening();
      }
    } catch {
      return defaultScreening();
    }
  }

  function defaultScreening() {
    return { score: 60, recommendation: 'approve', tier: 'standard', reason: 'Default approval — manual review recommended', riskLevel: 'medium' };
  }

  // ── Verify Key ─────────────────────────────────────────
  async function verifyKey(walletAddress, keyString) {
    const stored = getKey(walletAddress);
    if (!stored) return { valid: false, reason: 'No key found for this wallet' };
    if (stored.status !== STATUS.APPROVED) return { valid: false, reason: 'Key not approved' };
    if (stored.expiresAt && Date.now() > stored.expiresAt) return { valid: false, reason: 'Key expired' };

    // Verify hash
    const encoded  = new TextEncoder().encode(keyString + walletAddress.toLowerCase());
    const hash     = await window.crypto.subtle.digest('SHA-256', encoded);
    const keyHash  = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');

    if (keyHash !== stored.keyHash) return { valid: false, reason: 'Key hash mismatch' };

    return { valid: true, tier: stored.tier, approvedAt: stored.approvedAt };
  }

  // ── Admin: Approve manually ────────────────────────────
  async function adminApprove(walletAddress, tier = 'standard') {
    const { key, keyHash } = await generateAccessKey(walletAddress, tier);
    const keys = getApprovedKeys();
    keys[walletAddress.toLowerCase()] = {
      key, keyHash, tier,
      wallet:     walletAddress.toLowerCase(),
      status:     STATUS.APPROVED,
      approvedAt: new Date().toISOString(),
      expiresAt:  null,
      adminApproved: true,
    };
    saveApprovedKeys(keys);

    // Update pending application if exists
    const apps = getPendingApplications();
    const idx  = apps.findIndex(a => a.wallet === walletAddress.toLowerCase());
    if (idx >= 0) {
      apps[idx].status     = STATUS.APPROVED;
      apps[idx].approvedAt = new Date().toISOString();
      apps[idx].key        = key;
      savePendingApplications(apps);
    }

    return { key, tier };
  }

  // ── Admin: Revoke ──────────────────────────────────────
  function adminRevoke(walletAddress, reason = 'Revoked by admin') {
    const keys = getApprovedKeys();
    if (keys[walletAddress.toLowerCase()]) {
      keys[walletAddress.toLowerCase()].status   = STATUS.REVOKED;
      keys[walletAddress.toLowerCase()].revokedAt = new Date().toISOString();
      keys[walletAddress.toLowerCase()].revokeReason = reason;
      saveApprovedKeys(keys);
    }
    return true;
  }

  // ── Get all applications (admin) ───────────────────────
  function getAllApplications() {
    return getPendingApplications();
  }

  function getAllApprovedKeys() {
    return getApprovedKeys();
  }

  // ── Tier Benefits ──────────────────────────────────────
  const TIERS = {
    standard: {
      name:        'Standard Investor',
      maxBids:     10,
      color:       'var(--cyan)',
      description: 'Access to all public auctions',
    },
    premium: {
      name:        'Premium Investor',
      maxBids:     50,
      color:       'var(--gold)',
      description: 'Priority access, higher bid limits, early notifications',
    },
    vip: {
      name:        'VIP Investor',
      maxBids:     999,
      color:       '#ff6fff',
      description: 'Unlimited bids, private auction access, direct inventor introductions',
    },
  };

  function getTierInfo(tier) {
    return TIERS[tier] || TIERS.standard;
  }

  return {
    hasValidKey,
    getKey,
    submitApplication,
    verifyKey,
    adminApprove,
    adminRevoke,
    getAllApplications,
    getAllApprovedKeys,
    getTierInfo,
    STATUS,
    TIERS,
  };

})();
