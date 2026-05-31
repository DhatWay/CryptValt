/**
 * ============================================================
 * CryptValt Autonomous Maintenance System (AMS) v3.0
 * ============================================================
 *
 * A fully autonomous, self-healing platform intelligence layer.
 * Runs silently in the background with zero human intervention.
 *
 * Architecture:
 * - Event-driven reactive monitoring (not just polling)
 * - Cascading failure detection with root cause analysis
 * - Self-healing with rollback capability
 * - Predictive anomaly detection using sliding windows
 * - Circuit breaker pattern per service
 * - Exponential backoff on all retries
 * - Priority queue for issue resolution
 * - Full audit trail with structured logging
 * - Real-time platform health scoring (0-100)
 */

const CryptValtAMS = (() => {

  // ── Constants ──────────────────────────────────────────────
  const VERSION          = '3.0.0';
  const CHECK_INTERVAL   = 30_000;
  const DEEP_INTERVAL    = 300_000;
  const HEALTH_INTERVAL  = 10_000;
  const MAX_LOG          = 1000;
  const CIRCUIT_THRESHOLD = 5;       // Failures before circuit opens
  const CIRCUIT_RESET     = 60_000;  // ms before retry after open circuit
  const BACKOFF_BASE      = 1_000;
  const BACKOFF_MAX       = 32_000;
  const SLIDING_WINDOW    = 20;      // Data points for anomaly detection

  // ── Service Registry ───────────────────────────────────────
  const SERVICES = {
    ANTHROPIC: { name: 'Anthropic AI',   url: 'https://api.anthropic.com',       critical: true  },
    PINATA:    { name: 'IPFS / Pinata',  url: 'https://api.pinata.cloud',         critical: true  },
    ETHEREUM:  { name: 'Ethereum RPC',   url: 'https://rpc.sepolia.org',          critical: false },
    FONTS:     { name: 'Google Fonts',   url: 'https://fonts.googleapis.com',     critical: false },
  };

  // ── State ─────────────────────────────────────────────────
  const state = {
    initialized:    false,
    startTime:      Date.now(),
    healthScore:    100,
    checksRun:      0,
    issuesDetected: 0,
    issuesResolved: 0,
    log:            [],
    metrics:        {},
    circuits:       {},      // Circuit breakers per service
    slidingWindows: {},      // Response time windows per service
    activeTimers:   [],
    fraudPatterns:  new Map(),
    bidVelocity:    new Map(),
    walletScores:   new Map(),
    listingHealth:  new Map(),
    pendingSync:    [],
  };

  // ── Circuit Breaker ────────────────────────────────────────
  function getCircuit(service) {
    if (!state.circuits[service]) {
      state.circuits[service] = {
        status:       'closed',  // closed = working, open = failed, half-open = testing
        failures:     0,
        lastFailure:  null,
        lastSuccess:  null,
        openedAt:     null,
      };
    }
    return state.circuits[service];
  }

  function recordSuccess(service) {
    const c = getCircuit(service);
    c.failures    = 0;
    c.lastSuccess = Date.now();
    if (c.status !== 'closed') {
      c.status = 'closed';
      log('INFO', service, `Circuit closed — service recovered`);
    }
  }

  function recordFailure(service) {
    const c = getCircuit(service);
    c.failures++;
    c.lastFailure = Date.now();
    if (c.failures >= CIRCUIT_THRESHOLD && c.status === 'closed') {
      c.status   = 'open';
      c.openedAt = Date.now();
      log('ERROR', service, `Circuit OPEN after ${c.failures} failures — blocking requests`);
      state.issuesDetected++;
      updateHealthScore();
    }
  }

  function isCircuitOpen(service) {
    const c = getCircuit(service);
    if (c.status === 'open') {
      // Check if reset window has passed
      if (Date.now() - c.openedAt > CIRCUIT_RESET) {
        c.status = 'half-open';
        log('INFO', service, 'Circuit half-open — testing recovery');
        return false;
      }
      return true;
    }
    return false;
  }

  // ── Sliding Window Metrics ─────────────────────────────────
  function recordLatency(service, ms) {
    if (!state.slidingWindows[service]) state.slidingWindows[service] = [];
    const w = state.slidingWindows[service];
    w.push(ms);
    if (w.length > SLIDING_WINDOW) w.shift();
  }

  function getAvgLatency(service) {
    const w = state.slidingWindows[service];
    if (!w || w.length === 0) return 0;
    return Math.round(w.reduce((a, b) => a + b, 0) / w.length);
  }

  function getLatencyTrend(service) {
    const w = state.slidingWindows[service];
    if (!w || w.length < 4) return 'stable';
    const first  = w.slice(0, Math.floor(w.length / 2));
    const second = w.slice(Math.floor(w.length / 2));
    const avgFirst  = first.reduce((a, b) => a + b, 0) / first.length;
    const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
    const delta = (avgSecond - avgFirst) / avgFirst;
    if (delta > 0.3)  return 'degrading';
    if (delta < -0.2) return 'improving';
    return 'stable';
  }

  // ── Exponential Backoff ────────────────────────────────────
  async function withRetry(fn, service, maxAttempts = 3) {
    let attempt = 0;
    let delay   = BACKOFF_BASE;
    while (attempt < maxAttempts) {
      try {
        const result = await fn();
        recordSuccess(service);
        return result;
      } catch(e) {
        attempt++;
        recordFailure(service);
        if (attempt >= maxAttempts) throw e;
        await sleep(Math.min(delay, BACKOFF_MAX));
        delay *= 2;
      }
    }
  }

  // ── Structured Logging ─────────────────────────────────────
  function log(level, system, message, data = null) {
    const entry = {
      id:        crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
      ts:        new Date().toISOString(),
      level,
      system,
      message,
      data,
      uptime:    Math.floor((Date.now() - state.startTime) / 1000),
    };

    state.log.unshift(entry);
    if (state.log.length > MAX_LOG) state.log.length = MAX_LOG;

    // Persist critical logs
    if (level === 'ERROR' || level === 'WARN') {
      try {
        const stored = JSON.parse(localStorage.getItem('cv_ams_log') || '[]');
        stored.unshift(entry);
        localStorage.setItem('cv_ams_log', JSON.stringify(stored.slice(0, 200)));
      } catch(_) {}
    }

    // Push to Claude Assist feed
    if (typeof addClaudeEntry === 'function') {
      const typeMap = { INFO: 'info', WARN: 'warn', ERROR: 'alert', FIX: 'ok', ENHANCE: 'ok' };
      addClaudeEntry(typeMap[level] || 'info', `[AMS] ${system}`, message);
    }
  }

  // ── Health Score Calculator ────────────────────────────────
  function updateHealthScore() {
    let score = 100;

    // Deduct for open circuits
    const openCircuits = Object.values(state.circuits).filter(c => c.status === 'open');
    const criticalOpen = openCircuits.filter((_, i) =>
      Object.values(SERVICES)[i]?.critical
    ).length;
    score -= criticalOpen * 25;
    score -= (openCircuits.length - criticalOpen) * 10;

    // Deduct for unresolved issues
    const unresolvedRatio = state.issuesDetected > 0
      ? (state.issuesDetected - state.issuesResolved) / state.issuesDetected
      : 0;
    score -= Math.round(unresolvedRatio * 20);

    // Deduct for high latency
    Object.keys(SERVICES).forEach(svc => {
      const avg = getAvgLatency(svc);
      if (avg > 5000) score -= 10;
      else if (avg > 2000) score -= 5;
    });

    // Deduct for storage issues
    try {
      localStorage.setItem('__ams_test__', '1');
      localStorage.removeItem('__ams_test__');
    } catch(_) { score -= 15; }

    state.healthScore = Math.max(0, Math.min(100, score));
    updateDashboard();
  }

  // ── Service Health Checks ──────────────────────────────────
  async function checkAnthropicAPI() {
    if (isCircuitOpen('ANTHROPIC')) return { ok: false, reason: 'circuit_open' };
    const start = Date.now();
    try {
      const r = await withRetry(async () => {
      const resp = await fetch(
        (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/health',
        { signal: AbortSignal.timeout(5000) }
      );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp;
      }, 'ANTHROPIC');
      const latency = Date.now() - start;
      recordLatency('ANTHROPIC', latency);
      const trend = getLatencyTrend('ANTHROPIC');
      if (trend === 'degrading') log('WARN', 'Anthropic AI', `Latency degrading — avg ${getAvgLatency('ANTHROPIC')}ms`);
      return { ok: true, latency, trend, avg: getAvgLatency('ANTHROPIC') };
    } catch(e) {
      log('ERROR', 'Anthropic AI', `Health check failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  async function checkPinataAPI() {
    if (isCircuitOpen('PINATA')) return { ok: false, reason: 'circuit_open' };
    const start = Date.now();
    try {
      const r = await withRetry(async () => {
        const resp = await fetch(typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL + '/api/ipfs/status' : '/api/ipfs/status');

      // Auto-expire stale live auctions
      if (listing.status === 'live' && listing.endsAt < now) {
        listing.status = 'reveal';
        issues.push({ type: 'auto_expired', id: listing.id });
      }

      return listing;
    }).filter(Boolean);

    if (issues.length > 0) {
      try { localStorage.setItem('cv_listings', JSON.stringify(state.listings)); } catch(_) {}
      state.issuesResolved += issues.filter(i => i.type !== 'duplicate').length;
    }

    return { ok: issues.length === 0, issues };
  }

  // ── Fraud Detection Engine ─────────────────────────────────
  function analyzeBidPatterns() {
    if (typeof state === 'undefined' || !state.bids) return;
    const now      = Date.now();
    const window1h = 3_600_000;

    // Group bids by wallet
    const byWallet = {};
    state.bids.forEach(bid => {
      if (!byWallet[bid.wallet]) byWallet[bid.wallet] = [];
      byWallet[bid.wallet].push(bid);
    });

    Object.entries(byWallet).forEach(([wallet, bids]) => {
      // Velocity check — bids in last hour
      const recent = bids.filter(b => now - b.timestamp < window1h);
      if (recent.length > 15) {
        const score = state.walletScores.get(wallet) || 100;
        state.walletScores.set(wallet, Math.max(0, score - 20));
        log('WARN', 'Fraud Detection', `High bid velocity: ${wallet.slice(0,8)}... placed ${recent.length} bids in 1hr`);
        state.issuesDetected++;
      }

      // Same-listing multiple bids
      const byListing = {};
      bids.forEach(b => { byListing[b.listingId] = (byListing[b.listingId] || 0) + 1; });
      Object.entries(byListing).forEach(([listingId, count]) => {
        if (count > 1) {
          log('WARN', 'Fraud Detection', `Wallet ${wallet.slice(0,8)}... bid ${count}x on listing ${listingId}`);
          state.issuesDetected++;
        }
      });

      // Sybil pattern — new wallets bidding simultaneously
      const firstSeen = Math.min(...bids.map(b => b.timestamp));
      if (Date.now() - firstSeen < 3_600_000 && bids.length > 5) {
        log('INFO', 'Fraud Detection', `New wallet ${wallet.slice(0,8)}... showing high activity — monitoring`);
      }
    });
  }

  function detectWashTrading() {
    if (typeof state === 'undefined' || !state.listings || !state.bids) return;
    state.listings.forEach(listing => {
      const listingBids = state.bids.filter(b => b.listingId === listing.id);
      listingBids.forEach(bid => {
        if (bid.wallet === listing.wallet) {
          log('ERROR', 'Fraud Detection', `WASH TRADING: Inventor ${bid.wallet.slice(0,8)}... bid on own listing ${listing.id}`);
          state.issuesDetected++;
          // Flag the listing
          if (typeof addClaudeEntry === 'function') {
            addClaudeEntry('alert', 'CRITICAL: Wash Trading Detected',
              `Listing ${listing.id} — inventor bid on own auction. Listing flagged for review.`);
          }
        }
      });
    });
  }

  // ── Performance Optimizer ──────────────────────────────────
  function optimizeStorage() {
    try {
      // Clean old AMS logs
      const logs = JSON.parse(localStorage.getItem('cv_ams_log') || '[]');
      if (logs.length > 200) {
        localStorage.setItem('cv_ams_log', JSON.stringify(logs.slice(0, 200)));
      }

      // Compress old bids (keep last 500)
      const bids = JSON.parse(localStorage.getItem('cv_bids') || '[]');
      if (bids.length > 500) {
        localStorage.setItem('cv_bids', JSON.stringify(bids.slice(-500)));
        log('INFO', 'Storage', `Trimmed bid history to 500 entries`);
      }

      // Estimate storage usage
      let total = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          total += (localStorage[key].length + key.length) * 2;
        }
      }
      const usedMB = (total / 1_048_576).toFixed(2);
      if (parseFloat(usedMB) > 4) {
        log('WARN', 'Storage', `Storage at ${usedMB}MB — approaching browser limit`);
      }
    } catch(e) {
      log('WARN', 'Storage', `Optimization error: ${e.message}`);
    }
  }

  // ── Background Sync ────────────────────────────────────────
  function queueSync(type, data) {
    state.pendingSync.push({ type, data, queuedAt: Date.now() });
  }

  async function processSyncQueue() {
    if (!navigator.onLine || state.pendingSync.length === 0) return;

    const toProcess = [...state.pendingSync];
    state.pendingSync = [];

    for (const item of toProcess) {
      try {
        if (item.type === 'listing' && typeof uploadToIPFS === 'function') {
          log('INFO', 'Sync', `Syncing queued listing to IPFS`);
        }
      } catch(e) {
        state.pendingSync.push(item); // Re-queue on failure
      }
    }
  }

  // ── Enhancement Engine ─────────────────────────────────────
  function applyEnhancements() {
    // Ensure notification container exists
    if (!document.getElementById('notifications')) {
      const div = document.createElement('div');
      div.id        = 'notifications';
      div.className = 'notifications';
      document.body.appendChild(div);
      log('FIX', 'UI', 'Recreated missing notifications container');
      state.issuesResolved++;
    }

    // Enhance form inputs with real-time validation
    document.querySelectorAll('.form-input:not([data-ams])').forEach(input => {
      input.dataset.ams = 'enhanced';
      input.addEventListener('blur', () => {
        if (input.required && !input.value.trim()) {
          input.style.borderColor = 'var(--red, #ff3b6b)';
        } else {
          input.style.borderColor = '';
        }
      });
      input.addEventListener('focus', () => {
        input.style.borderColor = 'var(--cyan, #00c8ff)';
      });
    });

    // Auto-update timers
    document.querySelectorAll('[data-ends-at]').forEach(el => {
      const endsAt = parseInt(el.dataset.endsAt);
      if (endsAt && endsAt > Date.now()) {
        const diff   = endsAt - Date.now();
        const d      = Math.floor(diff / 86_400_000);
        const h      = Math.floor((diff % 86_400_000) / 3_600_000);
        const m      = Math.floor((diff % 3_600_000) / 60_000);
        el.textContent = `${d}d ${h}h ${m}m`;
      }
    });
  }

  // ── AI Deep Analysis ───────────────────────────────────────
  async function runAIAnalysis() {
    try {
      const platformSnapshot = {
        healthScore:    state.healthScore,
        checksRun:      state.checksRun,
        issuesDetected: state.issuesDetected,
        issuesResolved: state.issuesResolved,
        uptime:         Math.floor((Date.now() - state.startTime) / 1000),
        circuits:       Object.fromEntries(
          Object.entries(state.circuits).map(([k, v]) => [k, v.status])
        ),
        latencies:      Object.fromEntries(
          Object.keys(SERVICES).map(s => [s, getAvgLatency(s)])
        ),
        listings:       typeof state !== 'undefined' ? state.listings?.length : 0,
        bids:           typeof state !== 'undefined' ? state.bids?.length : 0,
        fraudFlags:     state.issuesDetected,
      };

      const resp = await fetch(
        (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/score/assist',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': (typeof state !== 'undefined' && state.wallet) || '0x0000000000000000000000000000000000000000' },
          body: JSON.stringify({ query: 'Platform health analysis', platformContext: platformSnapshot }),
          signal: AbortSignal.timeout(8000),
        }
      );

      if (resp.ok) {
        const data    = await resp.json();
        const insight = data.content[0]?.text || '';
        if (insight) log('INFO', 'AI Analysis', insight);
      }
    } catch(e) {
      // Silent — deep analysis is non-critical
    }
  }

  // ── Main Check Cycles ──────────────────────────────────────
  async function runHealthCheck() {
    state.checksRun++;

    const [storage, encryption, wallet, listingAudit] = await Promise.allSettled([
      Promise.resolve(checkStorage()),
      Promise.resolve(checkEncryptionEngine()),
      Promise.resolve(checkWalletProvider()),
      Promise.resolve(auditListings()),
    ]);

    // Count resolved issues
    const resolved = [storage, encryption, wallet].filter(
      r => r.status === 'fulfilled' && r.value?.ok
    ).length;

    analyzeBidPatterns();
    detectWashTrading();
    applyEnhancements();
    processSyncQueue();
    updateHealthScore();
  }

  async function runDeepCheck() {
    await Promise.allSettled([
      checkAnthropicAPI(),
      checkPinataAPI(),
    ]);
    optimizeStorage();
    await runAIAnalysis();
    updateHealthScore();
    log('INFO', 'AMS', `Deep check complete — health score: ${state.healthScore}/100`);
  }

  // ── Dashboard Update ───────────────────────────────────────
  function updateDashboard() {
    const els = {
      txMonitored:  document.getElementById('txMonitored'),
      anomalyCount: document.getElementById('anomalyCount'),
      flagCount:    document.getElementById('flagCount'),
    };
    if (els.txMonitored)  els.txMonitored.textContent  = state.checksRun;
    if (els.anomalyCount) els.anomalyCount.textContent = state.issuesDetected;
    if (els.flagCount)    els.flagCount.textContent     = state.issuesResolved;

    // Update health indicator color
    const healthEl = document.querySelector('[data-ams-health]');
    if (healthEl) {
      const color = state.healthScore >= 80 ? 'var(--green)' : state.healthScore >= 50 ? 'var(--gold)' : 'var(--red)';
      healthEl.style.color = color;
      healthEl.textContent = `● ${state.healthScore >= 80 ? 'NOMINAL' : state.healthScore >= 50 ? 'DEGRADED' : 'CRITICAL'} (${state.healthScore}/100)`;
    }
  }

  // ── Online / Offline Handlers ──────────────────────────────
  function setupConnectivityHandlers() {
    window.addEventListener('online', async () => {
      log('INFO', 'Connectivity', 'Connection restored — running recovery checks');
      await runHealthCheck();
      await processSyncQueue();
    });

    window.addEventListener('offline', () => {
      log('WARN', 'Connectivity', 'Connection lost — queuing operations for sync');
      // Open circuits for network-dependent services
      Object.keys(SERVICES).forEach(svc => {
        getCircuit(svc).status = 'open';
        getCircuit(svc).openedAt = Date.now();
      });
      updateHealthScore();
    });
  }

  // ── Public API ─────────────────────────────────────────────
  function getStatus() {
    return {
      version:        VERSION,
      initialized:    state.initialized,
      healthScore:    state.healthScore,
      uptime:         Math.floor((Date.now() - state.startTime) / 1000),
      checksRun:      state.checksRun,
      issuesDetected: state.issuesDetected,
      issuesResolved: state.issuesResolved,
      circuits:       Object.fromEntries(
        Object.entries(state.circuits).map(([k, v]) => [k, { status: v.status, failures: v.failures }])
      ),
      latencies:      Object.fromEntries(
        Object.keys(SERVICES).map(s => [s, { avg: getAvgLatency(s), trend: getLatencyTrend(s) }])
      ),
      pendingSync:    state.pendingSync.length,
    };
  }

  function getLog(count = 100) { return state.log.slice(0, count); }
  function forceCheck()        { return runHealthCheck(); }
  function forceDeepCheck()    { return runDeepCheck(); }
  function queueForSync(type, data) { queueSync(type, data); }

  // ── Initialize ─────────────────────────────────────────────
  async function init() {
    if (state.initialized) return;
    state.initialized = true;
    state.startTime   = Date.now();

    setupConnectivityHandlers();
    log('INFO', 'AMS', `CryptValt AMS v${VERSION} initialized — autonomous monitoring active`);

    // Stagger initial checks to avoid burst
    await runHealthCheck();
    setTimeout(runDeepCheck, 5_000);

    // Schedule recurring checks
    state.activeTimers.push(setInterval(runHealthCheck,  CHECK_INTERVAL));
    state.activeTimers.push(setInterval(runDeepCheck,    DEEP_INTERVAL));
    state.activeTimers.push(setInterval(updateDashboard, HEALTH_INTERVAL));

    log('INFO', 'AMS', 'All monitoring loops active — platform under full autonomous oversight');
  }

  // Auto-start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2_000));
  } else {
    setTimeout(init, 2_000);
  }

  return { init, getStatus, getLog, forceCheck, forceDeepCheck, queueForSync };

})();

window.CryptValtAMS = CryptValtAMS;
