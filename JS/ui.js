/**
 * CryptValt — UI & Navigation
 */

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  // Check wallet gates
  if (name === 'submit') {
    document.getElementById('submitConnectGate').style.display = state.wallet ? 'none' : 'flex';
    document.getElementById('submitForm').style.display = state.wallet ? 'block' : 'none';
  }
  if (name === 'dashboard') {
    document.getElementById('dashConnectGate').style.display = state.wallet ? 'none' : 'flex';
    document.getElementById('dashContent').style.display = state.wallet ? 'block' : 'none';
    if (state.wallet) renderDashboard();
  }
}

function scrollToMarket() {
  document.getElementById('market').scrollIntoView({ behavior: 'smooth' });
}

function switchTab(tabId, btn) {
  ['tabMyIdeas','tabMyBids','tabWon','tabEarnings'].forEach(t => {
    document.getElementById(t).style.display = 'none';
  });
  document.getElementById(tabId).style.display = 'block';
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function goToStep2() {
  const title = document.getElementById('ideaTitle').value.trim();
  const desc = document.getElementById('ideaDescription').value.trim();
  const teaser = document.getElementById('ideaTeaser').value.trim();
  const category = document.getElementById('ideaCategory').value;
  const problem = document.getElementById('ideaProblem').value.trim();
  const market = document.getElementById('ideaMarket').value.trim();

  if (!title || !desc || !teaser || !category || !problem || !market) {
    notify('error', 'Missing Fields', 'Please fill in all required fields.');
    return;
  }
  if (!state.wallet) {
    notify('error', 'Wallet Required', 'Connect your wallet to continue.');
    return;
  }

  setStep(2);
  document.getElementById('submitStep1').style.display = 'none';
  document.getElementById('submitStep2').style.display = 'block';
  runEncryption();
}

async function runEncryption() {
  document.getElementById('encryptLoading').style.display = 'block';
  document.getElementById('encryptResult').style.display = 'none';

  await sleep(600);
  setEP(1, 'done'); setEP(2, 'active');

  const fullText = JSON.stringify({
    title: document.getElementById('ideaTitle').value,
    description: document.getElementById('ideaDescription').value,
    problem: document.getElementById('ideaProblem').value,
    market: document.getElementById('ideaMarket').value,
    marketSize: document.getElementById('ideaMarketSize').value,
    wallet: state.wallet,
    timestamp: new Date().toISOString()
  });

  const key = await generateKey();
  const { encrypted, iv } = await encryptData(key, fullText);
  const keyB64 = await exportKey(key);
  const keyHashStr = await hashKey(keyB64);
  const encB64 = toBase64(encrypted);
  const ivB64 = toBase64(iv);

  state.currentEncryption = { key, keyB64, keyHashStr, encB64, ivB64, fullText };

  await sleep(500);
  setEP(2, 'done'); setEP(3, 'active');

  const ipfsPayload = {
    encryptedData: encB64,
    iv: ivB64,
    keyHash: keyHashStr,
    category: document.getElementById('ideaCategory').value,
    teaser: document.getElementById('ideaTeaser').value,
    title: document.getElementById('ideaTitle').value,
    wallet: state.wallet,
    timestamp: new Date().toISOString()
  };

  const cid = await uploadToIPFS(ipfsPayload, 'idea_' + Date.now() + '.json');
  state.currentEncryption.cid = cid;

  setEP(3, 'done'); setEP(4, 'active');
  await sleep(400);
  setEP(4, 'done');

  document.getElementById('encryptLoading').style.display = 'none';
  document.getElementById('encryptResult').style.display = 'block';
  document.getElementById('ipfsCid').textContent = cid;
  document.getElementById('keyHash').textContent = keyHashStr.slice(0,32) + '...';
  document.getElementById('encryptedPreview').textContent = (state.currentEncryption && state.currentEncryption.encB64 ? state.currentEncryption.encB64 : '...encrypted data...');
}

async function goToStep3() {
  setStep(3);
  document.getElementById('submitStep2').style.display = 'none';
  document.getElementById('submitStep3').style.display = 'block';

  const statuses = [
    'Analyzing market context...',
    'Evaluating scalability vectors...',
    'Assessing consumer demand signals...',
    'Modeling competitive landscape...',
    'Calculating revenue scenarios...',
    'Generating investor report...'
  ];

  let si = 0;
  const statusEl = document.getElementById('scoringStatus');
  const statusInterval = setInterval(() => {
    if (si < statuses.length) statusEl.textContent = statuses[si++];
  }, 1800);

  const ideaData = {
    title: document.getElementById('ideaTitle').value,
    category: document.getElementById('ideaCategory').value,
    teaser: document.getElementById('ideaTeaser').value,
    description: document.getElementById('ideaDescription').value,
    problem: document.getElementById('ideaProblem').value,
    market: document.getElementById('ideaMarket').value,
    marketSize: document.getElementById('ideaMarketSize').value,
  };

  const score = await scoreIdea(ideaData);
  clearInterval(statusInterval);
  state.currentScore = score;

  document.getElementById('scoringLoading').style.display = 'none';
  document.getElementById('scoreResult').style.display = 'block';
  document.getElementById('scoreResult').innerHTML = renderAIReport(score, ideaData.title);

  // Auto-advance to step 4 after showing results
  setTimeout(() => {
    document.getElementById('scoreResult').innerHTML += `
      <div style="margin-top:24px">
        <button class="btn btn-primary btn-full" onclick="goToStep4()">Set Auction Parameters →</button>
      </div>
    `;
  }, 500);
}

function goToStep4() {
  setStep(4);
  document.getElementById('submitStep3').style.display = 'none';
  document.getElementById('submitStep4').style.display = 'block';

  // Suggest reserve price based on AI valuation
  if (state.currentScore) {
    const suggested = Math.floor(state.currentScore.dollarValueMid * 0.3);
    document.getElementById('reservePrice').value = suggested;
    document.getElementById('reservePrice').placeholder = `Suggested: $${suggested.toLocaleString()} (30% of AI value)`;
  }
}

async function goToStep5() {
  if (!document.getElementById('legalAgree').checked) {
    notify('error', 'Agreement Required', 'You must agree to the legal terms.');
    return;
  }

  const reserve = document.getElementById('reservePrice').value;
  if (!reserve || reserve < 1) {
    notify('error', 'Reserve Price Required', 'Enter a reserve price.');
    return;
  }

  setStep(5);
  document.getElementById('submitStep4').style.display = 'none';
  document.getElementById('submitStep5').style.display = 'block';

  const legalMsg = `I, ${state.wallet}, hereby list idea "${document.getElementById('ideaTitle').value}" on CryptValt. IPFS CID: ${state.currentEncryption.cid}. I agree to all platform terms. Timestamp: ${new Date().toISOString()}`;
  const sig = await signMessage(legalMsg);

  await sleep(1500);

  // Create listing object
  const listing = {
    id: 'CV-' + Date.now().toString(36).toUpperCase(),
    title: document.getElementById('ideaTitle').value,
    category: document.getElementById('ideaCategory').value,
    teaser: document.getElementById('ideaTeaser').value,
    cid: state.currentEncryption.cid,
    keyHash: state.currentEncryption.keyHashStr,
    encData: state.currentEncryption.encB64.slice(0, 100),
    score: state.currentScore,
    reserve: parseInt(reserve),
    duration: parseInt(document.getElementById('auctionDuration').value),
    royalty: parseInt(document.getElementById('royaltyPct').value),
    wallet: state.wallet,
    sig: sig,
    created: Date.now(),
    endsAt: Date.now() + (parseInt(document.getElementById('auctionDuration').value) * 86400000),
    bids: [],
    status: 'live'
  };

  state.listings.push(listing);
  localStorage.setItem('cv_listings', JSON.stringify(state.listings));

  document.getElementById('launchLoading').style.display = 'none';
  document.getElementById('launchSuccess').style.display = 'block';
  updateStats();
  renderListings();

  addClaudeEntry('ok', 'New Listing Detected', `Idea "${listing.title}" listed by ${shortenAddr(listing.wallet)}. AI score: ${listing.score.overallScore}/100. Reserve: $${listing.reserve.toLocaleString()}. CID: ${listing.cid.slice(0,20)}... Monitoring for bid activity.`);
  notify('success', '🚀 Idea Listed', 'Your encrypted idea is now live on CryptValt.');
}

function setStep(n) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('step' + i);
    if (i < n) { el.className = 'step done'; }
    else if (i === n) { el.className = 'step active'; }
    else { el.className = 'step'; }
  }
}

function setEP(n, state) {
  const el = document.getElementById('ep' + n);
  el.className = 'progress-dot ' + state;
}

function renderAIReport(score, title) {
  const pct = (v) => `${Math.min(100, Math.max(0, v || 0))}%`;
  const scoreColor = (v) => v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--gold)' : 'var(--red)';
  const s = score.scores || {};

  const section = (label, content, color = 'var(--cyan)') => content ? `
    <div class="report-section">
      <div class="report-section-title" style="color:${color}">${label}</div>
      <div class="report-text">${typeof content === 'object' ? Object.entries(content).filter(([k,v]) => k === 'analysis' || typeof v === 'string').map(([k,v]) => k === 'analysis' ? v : '').join('') || JSON.stringify(content) : content}</div>
    </div>` : '';

  const moneySection = (label, data, color = 'var(--gold)') => {
    if (!data) return '';
    const analysis = data.analysis || '';
    const details  = Object.entries(data)
      .filter(([k,v]) => k !== 'analysis' && typeof v === 'string' && v)
      .map(([k,v]) => `<div style="display:flex;gap:8px;margin-bottom:6px"><span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);width:140px;flex-shrink:0;letter-spacing:1px">${k.replace(/([A-Z])/g,' $1').toUpperCase()}</span><span style="font-size:13px;color:var(--text-dim)">${v}</span></div>`)
      .join('');
    return `
    <div class="report-section">
      <div class="report-section-title" style="color:${color}">${label}</div>
      ${details}
      ${analysis ? `<div class="report-text" style="margin-top:10px">${analysis}</div>` : ''}
    </div>`;
  };

  return `
    <div class="ai-report">
      <div class="ai-report-header">
        <div class="ai-icon">⬡</div>
        <div>
          <div class="ai-report-title">INVESTOR ANALYSIS REPORT</div>
          <div class="ai-report-sub">${title} — CryptValt AI Scoring Engine v4.0</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-family:var(--display);font-size:52px;letter-spacing:2px;color:${scoreColor(score.overallScore)};line-height:1">${score.overallScore || 0}</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px">/100 OVERALL</div>
          ${score.confidenceScore ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:1px;margin-top:2px">CONFIDENCE: ${score.confidenceScore}%</div>` : ''}
        </div>
      </div>
      <!-- Attestation Badge -->
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${score.teeVerified ? 'rgba(0,255,157,0.05)' : 'rgba(240,165,0,0.05)'};border:1px solid ${score.teeVerified ? 'rgba(0,255,157,0.2)' : 'rgba(240,165,0,0.2)'};margin-bottom:16px">
        <div style="font-size:18px">${score.teeVerified ? '🔒' : '🔓'}</div>
        <div>
          <div style="font-family:var(--mono);font-size:9px;color:${score.teeVerified ? 'var(--green)' : 'var(--gold)'};letter-spacing:2px;margin-bottom:2px">${score.teeVerified ? 'TEE-VERIFIED SCORING' : 'METADATA-ONLY SCORING'}</div>
          <div style="font-size:12px;color:var(--text-dim)">${score.providerInfo?.attestNote || (score.teeVerified ? 'Score generated inside a trusted execution environment.' : 'Score based on public metadata only. Idea content never sent to any server.')}</div>
        </div>
        ${score.teeVerified ? `<div style="margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--green);letter-spacing:1px">✓ ATTESTED</div>` : `<div style="margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--gold);letter-spacing:1px">${score.scoringProvider?.toUpperCase() || 'ANTHROPIC'}</div>`}
      </div>

      <div class="dollar-value">
        <div class="dollar-label">AI Estimated Market Value</div>
        <div class="dollar-amount">$${(score.dollarValueMid || 0).toLocaleString()}</div>
        <div class="dollar-range">Range: $${(score.dollarValueMin || 0).toLocaleString()} — $${(score.dollarValueMax || 0).toLocaleString()}</div>
        ${score.valuationMethodology ? `<div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:8px;letter-spacing:1px">${score.valuationMethodology}</div>` : ''}
      </div>

      <div class="score-bars" style="margin-bottom:24px">
        ${Object.entries(s).map(([key, val]) => renderScoreBar(key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()), val)).join('')}
      </div>

      ${score.executiveSummary ? `<div class="report-section"><div class="report-section-title">Executive Summary</div><div class="report-text" style="font-size:16px;line-height:1.8">${score.executiveSummary}</div></div>` : ''}

      ${moneySection('Market Opportunity', score.marketOpportunity)}
      ${moneySection('Problem Analysis', score.problemAnalysis, 'var(--red)')}
      ${moneySection('Cost Savings & Economic Value', score.costSavingsAnalysis, 'var(--green)')}
      ${moneySection('Revenue Projections', score.revenueProjections, 'var(--gold)')}
      ${moneySection('Competitive Analysis', score.competitiveAnalysis)}
      ${moneySection('IP & Patent Analysis', score.ipAnalysis, 'var(--gold)')}
      ${moneySection('Time to Market', score.timeToMarket)}
      ${moneySection('Regulatory Landscape', score.regulatoryLandscape)}
      ${moneySection('Industry Disruption', score.disruptionAnalysis, 'var(--red)')}
      ${moneySection('Social & Economic Impact', score.socialImpact, 'var(--green)')}
      ${moneySection('Exit Scenarios', score.exitScenarios, 'var(--gold)')}

      ${score.riskFactors && Array.isArray(score.riskFactors) ? `
      <div class="report-section">
        <div class="report-section-title" style="color:var(--red)">Risk Factors</div>
        ${score.riskFactors.map((r,i) => `<div style="display:flex;gap:10px;margin-bottom:8px"><span style="font-family:var(--mono);font-size:10px;color:var(--red);flex-shrink:0">${i+1}.</span><div class="report-text" style="color:rgba(255,59,107,0.8)">${r}</div></div>`).join('')}
      </div>` : score.riskFactors ? section('Risk Factors', score.riskFactors, 'var(--red)') : ''}

      ${score.comparables && Array.isArray(score.comparables) ? `
      <div class="report-section">
        <div class="report-section-title">Comparable Deals</div>
        ${score.comparables.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-dim)">→ ${c}</div>`).join('')}
      </div>` : ''}

      ${score.investorVerdict ? `
      <div class="report-section" style="background:rgba(240,165,0,0.05);border:1px solid rgba(240,165,0,0.15);padding:20px;margin-top:8px">
        <div class="report-section-title" style="color:var(--gold)">Investor Verdict</div>
        <div class="report-text" style="color:var(--gold);font-size:16px;line-height:1.8">${score.investorVerdict}</div>
      </div>` : ''}
    </div>
  `;
}

function renderScoreBar(label, value) {
  const v = Math.min(100, Math.max(0, value || 0));
  const color = v >= 75 ? 'var(--green)' : v >= 50 ? 'var(--gold)' : 'var(--red)';
  return `
    <div class="score-bar-row">
      <div class="score-bar-label">${label}</div>
      <div class="score-bar-track">
        <div class="score-bar-fill" style="width:${v}%;background:linear-gradient(90deg,${color},${color}88)"></div>
      </div>
      <div class="score-bar-val" style="color:${color}">${v}</div>
    </div>
  `;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function notify(type, title, msg) {
  const icons = { success: '✓', error: '✕', info: '⬡', warn: '⚠' };
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.innerHTML = `<div class="notif-icon">${icons[type] || '⬡'}</div><div><div class="notif-title">${title}</div><div class="notif-msg">${msg}</div></div>`;
  document.getElementById('notifications').prepend(el);
  setTimeout(() => el.remove(), 5000);
}
