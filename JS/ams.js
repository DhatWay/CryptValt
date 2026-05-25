// AUTONOMOUS MAINTENANCE SYSTEM
// ============================================================
/**
 * CryptValt Autonomous Maintenance System (AMS)
 * 
 * Drop this script into index.html — it runs silently in the background.
 * Monitors all platform functions, detects issues, applies fixes,
 * enhances features, and keeps all systems working together.
 * 
 * No human intervention required after initialization.
 */

const CryptValtAMS = (() => {

  // ============================================================
  // AMS CONFIG
  // ============================================================
  const AMS_CONFIG = {
    CHECK_INTERVAL_MS: 30000,         // Check every 30 seconds
    DEEP_CHECK_INTERVAL_MS: 300000,   // Deep check every 5 minutes
    MAX_LOG_ENTRIES: 500,
    ANTHROPIC_API_KEY: '%%ANTHROPIC_API_KEY%%',
    VERSION: '1.0.0',
  };

  // ============================================================
  // AMS STATE
  // ============================================================
  let amsState = {
    initialized: false,
    lastCheck: null,
    lastDeepCheck: null,
    issuesDetected: 0,
    issuesFixed: 0,
    checksRun: 0,
    log: [],
    systemHealth: {
      encryption: 'unknown',
      ipfs: 'unknown',
      ai: 'unknown',
      wallet: 'unknown',
      contracts: 'unknown',
      storage: 'unknown',
      auctions: 'unknown',
    },
    metrics: {
      avgAIResponseTime: 0,
      avgIPFSResponseTime: 0,
      failedTransactions: 0,
      successfulTransactions: 0,
      activeAuctions: 0,
      totalBidsProcessed: 0,
    }
  };

  // ============================================================
  // LOGGING
  // ============================================================
  function log(level, system, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      system,
      message,
      data,
    };
    amsState.log.unshift(entry);
    if (amsState.log.length > AMS_CONFIG.MAX_LOG_ENTRIES) {
      amsState.log = amsState.log.slice(0, AMS_CONFIG.MAX_LOG_ENTRIES);
    }

    // Push to Claude Assist oversight feed if available
    if (typeof addClaudeEntry === 'function') {
      const typeMap = { INFO: 'info', WARN: 'warn', ERROR: 'alert', FIX: 'ok', ENHANCE: 'ok' };
      addClaudeEntry(typeMap[level] || 'info', `[AMS] ${system}`, message);
    }

    // Store in localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('cv_ams_log') || '[]');
      stored.unshift(entry);
      localStorage.setItem('cv_ams_log', JSON.stringify(stored.slice(0, 100)));
    } catch(e) {}
  }

  // ============================================================
  // HEALTH CHECKS
  // ============================================================
  async function checkEncryption() {
    try {
      // Test real AES-256-GCM encryption
      const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
      );
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const testData = new TextEncoder().encode('AMS_TEST_' + Date.now());
      const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, testData);
      const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
      const decoded = new TextDecoder().decode(decrypted);

      if (decoded.startsWith('AMS_TEST_')) {
        amsState.systemHealth.encryption = 'healthy';
        return { ok: true };
      } else {
        throw new Error('Decryption mismatch');
      }
    } catch(e) {
      amsState.systemHealth.encryption = 'degraded';
      log('ERROR', 'ENCRYPTION', `Encryption test failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async function checkIPFS() {
    try {
      const start = Date.now();
      const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
        headers: {
          'pinata_api_key': typeof CONFIG !== 'undefined' ? CONFIG.PINATA_API_KEY : '%%PINATA_API_KEY%%',
          'pinata_secret_api_key': typeof CONFIG !== 'undefined' ? CONFIG.PINATA_API_SECRET : '%%PINATA_API_SECRET%%',
        }
      });
      const latency = Date.now() - start;
      amsState.metrics.avgIPFSResponseTime = latency;

      if (response.ok) {
        amsState.systemHealth.ipfs = 'healthy';
        return { ok: true, latency };
      } else {
        amsState.systemHealth.ipfs = 'degraded';
        return { ok: false, status: response.status };
      }
    } catch(e) {
      amsState.systemHealth.ipfs = 'offline';
      log('ERROR', 'IPFS', `Pinata unreachable: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async function checkAIEngine() {
    try {
      const start = Date.now();
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': AMS_CONFIG.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
      const latency = Date.now() - start;
      amsState.metrics.avgAIResponseTime = latency;

      if (response.ok) {
        amsState.systemHealth.ai = 'healthy';
        return { ok: true, latency };
      } else {
        amsState.systemHealth.ai = 'degraded';
        return { ok: false, status: response.status };
      }
    } catch(e) {
      amsState.systemHealth.ai = 'offline';
      log('ERROR', 'AI_ENGINE', `Anthropic API unreachable: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  function checkWallet() {
    try {
      const hasEthereum = typeof window.ethereum !== 'undefined';
      const isConnected = typeof state !== 'undefined' && state.wallet !== null;
      amsState.systemHealth.wallet = hasEthereum ? 'healthy' : 'no_provider';
      return { ok: hasEthereum, connected: isConnected };
    } catch(e) {
      amsState.systemHealth.wallet = 'error';
      return { ok: false, error: e.message };
    }
  }

  function checkStorage() {
    try {
      const testKey = 'cv_ams_storage_test';
      localStorage.setItem(testKey, '1');
      const val = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      if (val === '1') {
        amsState.systemHealth.storage = 'healthy';
        return { ok: true };
      }
      throw new Error('Storage read/write failed');
    } catch(e) {
      amsState.systemHealth.storage = 'degraded';
      log('ERROR', 'STORAGE', `localStorage unavailable: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  function checkAuctions() {
    try {
      if (typeof state === 'undefined') return { ok: false, error: 'State not initialized' };

      const listings = state.listings || [];
      const now = Date.now();
      let active = 0;
      let expired = 0;
      let issues = [];

      listings.forEach(listing => {
        if (listing.status === 'live') {
          if (listing.endsAt < now) {
            expired++;
            issues.push(`Listing ${listing.id} past end time but still marked live`);
          } else {
            active++;
          }
        }

        // Check for missing required fields
        if (!listing.cid || !listing.score || !listing.reserve) {
          issues.push(`Listing ${listing.id} has missing required fields`);
        }
      });

      amsState.metrics.activeAuctions = active;

      if (expired > 0) {
        log('WARN', 'AUCTIONS', `${expired} auctions past end time — auto-settling`);
        _autoSettleExpiredAuctions(listings, now);
      }

      amsState.systemHealth.auctions = issues.length === 0 ? 'healthy' : 'degraded';
      return { ok: issues.length === 0, active, expired, issues };
    } catch(e) {
      amsState.systemHealth.auctions = 'error';
      return { ok: false, error: e.message };
    }
  }

  // ============================================================
  // AUTO-FIX ENGINE
  // ============================================================
  function _autoSettleExpiredAuctions(listings, now) {
    listings.forEach(listing => {
      if (listing.status === 'live' && listing.endsAt < now) {
        // Move to reveal phase
        listing.status = 'reveal';
        log('FIX', 'AUCTIONS', `Auto-moved listing ${listing.id} to reveal phase`);
        amsState.issuesFixed++;
      }
    });

    if (typeof state !== 'undefined') {
      try {
        localStorage.setItem('cv_listings', JSON.stringify(listings));
      } catch(e) {}
    }
  }

  function _repairCorruptedListing(listing) {
    const required = ['id', 'title', 'category', 'cid', 'score', 'reserve', 'status', 'created', 'endsAt'];
    let repaired = false;

    required.forEach(field => {
      if (listing[field] === undefined || listing[field] === null) {
        switch(field) {
          case 'status': listing[field] = 'live'; break;
          case 'created': listing[field] = Date.now(); break;
          case 'endsAt': listing[field] = Date.now() + (5 * 86400000); break;
          case 'reserve': listing[field] = 0; break;
          case 'score': listing[field] = { overallScore: 0, dollarValueMid: 0, scores: {} }; break;
        }
        repaired = true;
      }
    });

    if (repaired) {
      log('FIX', 'DATA', `Repaired corrupted listing ${listing.id}`);
      amsState.issuesFixed++;
    }
    return listing;
  }

  function _cleanDuplicateListings() {
    if (typeof state === 'undefined') return;

    const seen = new Set();
    const deduped = state.listings.filter(l => {
      if (seen.has(l.id)) {
        log('FIX', 'DATA', `Removed duplicate listing ${l.id}`);
        amsState.issuesFixed++;
        return false;
      }
      seen.add(l.id);
      return true;
    });

    if (deduped.length !== state.listings.length) {
      state.listings = deduped;
      localStorage.setItem('cv_listings', JSON.stringify(deduped));
    }
  }

  // ============================================================
  // DEEP ANALYSIS (runs less frequently)
  // ============================================================
  async function runDeepAnalysis() {
    log('INFO', 'AMS', 'Running deep platform analysis...');

    // Analyze listing data integrity
    if (typeof state !== 'undefined') {
      state.listings = state.listings.map(l => _repairCorruptedListing(l));
      _cleanDuplicateListings();
    }

    // Analyze bid patterns for fraud
    _analyzeBidPatterns();

    // Check for stale data
    _checkDataFreshness();

    // Run AI health analysis
    await _aiHealthAnalysis();

    amsState.lastDeepCheck = Date.now();
    log('INFO', 'AMS', 'Deep analysis complete');
  }

  function _analyzeBidPatterns() {
    if (typeof state === 'undefined') return;

    const bidsByWallet = {};
    state.bids.forEach(bid => {
      if (!bidsByWallet[bid.wallet]) bidsByWallet[bid.wallet] = [];
      bidsByWallet[bid.wallet].push(bid);
    });

    // Flag wallets with suspicious bid counts
    Object.entries(bidsByWallet).forEach(([wallet, bids]) => {
      if (bids.length > 20) {
        log('WARN', 'FRAUD_DETECT', `Wallet ${wallet.slice(0,8)}... has ${bids.length} bids — reviewing for manipulation`);
      }

      // Check for same wallet bidding multiple times on same listing
      const listingBids = {};
      bids.forEach(b => {
        listingBids[b.listingId] = (listingBids[b.listingId] || 0) + 1;
      });
      Object.entries(listingBids).forEach(([listingId, count]) => {
        if (count > 1) {
          log('WARN', 'FRAUD_DETECT', `Wallet ${wallet.slice(0,8)}... placed ${count} bids on listing ${listingId} — flagged`);
          amsState.issuesDetected++;
        }
      });
    });
  }

  function _checkDataFreshness() {
    if (typeof state === 'undefined') return;

    const now = Date.now();
    const staleThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days

    state.listings.forEach(listing => {
      if (listing.status === 'live' && (now - listing.created) > staleThreshold) {
        log('WARN', 'DATA', `Listing ${listing.id} is over 30 days old and still live — may need review`);
      }
    });
  }

  async function _aiHealthAnalysis() {
    try {
      if (typeof state === 'undefined') return;

      const platformData = {
        totalListings: state.listings.length,
        activeAuctions: amsState.metrics.activeAuctions,
        totalBids: state.bids.length,
        systemHealth: amsState.systemHealth,
        issuesDetected: amsState.issuesDetected,
        issuesFixed: amsState.issuesFixed,
        checksRun: amsState.checksRun,
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': AMS_CONFIG.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `You are CryptValt's autonomous maintenance AI. Analyze this platform health data and respond with ONE specific actionable insight in under 50 words. No preamble. Data: ${JSON.stringify(platformData)}`
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const insight = data.content[0].text;
        log('INFO', 'AI_ANALYSIS', insight);
      }
    } catch(e) {
      // Silent fail on deep analysis
    }
  }

  // ============================================================
  // ENHANCEMENT ENGINE
  // ============================================================
  function runEnhancements() {
    _enhanceTimers();
    _enhanceFormValidation();
    _enhanceErrorMessages();
    _optimizeStorage();
  }

  function _enhanceTimers() {
    // Make sure all auction timers are updating
    if (typeof state === 'undefined') return;
    const liveListings = state.listings.filter(l => l.status === 'live');
    liveListings.forEach(listing => {
      const timerEl = document.getElementById('timer-' + listing.id);
      if (!timerEl && listing.endsAt > Date.now()) {
        log('WARN', 'UI', `Timer missing for live listing ${listing.id}`);
      }
    });
  }

  function _enhanceFormValidation() {
    // Dynamically strengthen form inputs
    const inputs = document.querySelectorAll('.form-input, .form-textarea');
    inputs.forEach(input => {
      if (!input.dataset.amsEnhanced) {
        input.dataset.amsEnhanced = 'true';
        input.addEventListener('blur', () => {
          if (input.required && !input.value.trim()) {
            input.style.borderColor = 'var(--red)';
          } else {
            input.style.borderColor = '';
          }
        });
      }
    });
  }

  function _enhanceErrorMessages() {
    // Make sure error notifications are visible
    const notifContainer = document.getElementById('notifications');
    if (!notifContainer) {
      const div = document.createElement('div');
      div.id = 'notifications';
      div.className = 'notifications';
      document.body.appendChild(div);
      log('FIX', 'UI', 'Recreated missing notifications container');
      amsState.issuesFixed++;
    }
  }

  function _optimizeStorage() {
    try {
      // Clean up old AMS logs to prevent storage bloat
      const logs = JSON.parse(localStorage.getItem('cv_ams_log') || '[]');
      if (logs.length > 100) {
        localStorage.setItem('cv_ams_log', JSON.stringify(logs.slice(0, 100)));
      }

      // Verify listings data is valid JSON
      const listingsRaw = localStorage.getItem('cv_listings');
      if (listingsRaw) {
        try {
          JSON.parse(listingsRaw);
        } catch(e) {
          log('FIX', 'STORAGE', 'Corrupted listings data detected — resetting to empty');
          localStorage.setItem('cv_listings', '[]');
          amsState.issuesFixed++;
        }
      }

      // Verify bids data
      const bidsRaw = localStorage.getItem('cv_bids');
      if (bidsRaw) {
        try {
          JSON.parse(bidsRaw);
        } catch(e) {
          log('FIX', 'STORAGE', 'Corrupted bids data detected — resetting to empty');
          localStorage.setItem('cv_bids', '[]');
          amsState.issuesFixed++;
        }
      }
    } catch(e) {}
  }

  // ============================================================
  // MAIN CHECK CYCLE
  // ============================================================
  async function runHealthCheck() {
    amsState.checksRun++;
    amsState.lastCheck = Date.now();

    const results = await Promise.allSettled([
      checkEncryption(),
      checkStorage(),
      checkWallet(),
      checkAuctions(),
    ]);

    runEnhancements();

    // Count issues
    const failures = results.filter(r => r.status === 'fulfilled' && r.value && !r.value.ok);
    if (failures.length > 0) {
      amsState.issuesDetected += failures.length;
    }

    // Update oversight dashboard if visible
    _updateOversightDashboard();
  }

  async function runDeepCheck() {
    // Check services that cost API calls less frequently
    await checkIPFS();
    await checkAIEngine();
    await runDeepAnalysis();
    _updateOversightDashboard();
  }

  function _updateOversightDashboard() {
    const txEl = document.getElementById('txMonitored');
    const anomalyEl = document.getElementById('anomalyCount');
    const flagEl = document.getElementById('flagCount');

    if (txEl) txEl.textContent = amsState.checksRun;
    if (anomalyEl) anomalyEl.textContent = amsState.issuesDetected;
    if (flagEl) flagEl.textContent = amsState.issuesFixed;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  function getStatus() {
    return {
      version: AMS_CONFIG.VERSION,
      initialized: amsState.initialized,
      lastCheck: amsState.lastCheck,
      systemHealth: amsState.systemHealth,
      metrics: amsState.metrics,
      issuesDetected: amsState.issuesDetected,
      issuesFixed: amsState.issuesFixed,
      checksRun: amsState.checksRun,
    };
  }

  function getLog(count = 50) {
    return amsState.log.slice(0, count);
  }

  function forceCheck() {
    return runHealthCheck();
  }

  function forceDeepCheck() {
    return runDeepCheck();
  }

  // ============================================================
  // INITIALIZE
  // ============================================================
  async function init() {
    if (amsState.initialized) return;
    amsState.initialized = true;

    log('INFO', 'AMS', `CryptValt Autonomous Maintenance System v${AMS_CONFIG.VERSION} initialized`);

    // Initial check on load
    await runHealthCheck();

    // Periodic light checks
    setInterval(runHealthCheck, AMS_CONFIG.CHECK_INTERVAL_MS);

    // Periodic deep checks
    setInterval(runDeepCheck, AMS_CONFIG.DEEP_CHECK_INTERVAL_MS);

    log('INFO', 'AMS', 'All monitoring loops active. Platform under autonomous oversight.');
  }

  // Start after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 2000); // Give main app time to initialize first
  }

  return { getStatus, getLog, forceCheck, forceDeepCheck, init };

})();

// Make available globally
window.CryptValtAMS = CryptValtAMS;
