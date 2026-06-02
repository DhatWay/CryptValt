// SUBMIT FLOW
// ============================================================
function goToStep2() {
  const title       = document.getElementById('ideaTitle').value.trim();
  const desc        = document.getElementById('ideaDescription').value.trim();
  const teaser      = document.getElementById('ideaTeaser').value.trim();
  const category    = document.getElementById('ideaCategory').value;
  const problem     = document.getElementById('ideaProblem').value.trim();
  const market      = document.getElementById('ideaMarket').value.trim();
  const marketSize  = document.getElementById('ideaMarketSize')?.value?.trim() || '';
  const costSavings = document.getElementById('ideaCostSavings')?.value?.trim() || '';
  const competitors = document.getElementById('ideaCompetitors')?.value?.trim() || '';
  const revenueModel = document.getElementById('ideaRevenueModel')?.value?.trim() || '';

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
  document.getElementById('encryptedPreview').textContent = (state.currentEncryption && state.currentEncryption.encB64 ? state.currentEncryption.encB64.slice(0, 300) : 'Encrypting...');
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
    title:        document.getElementById('ideaTitle').value,
    category:     document.getElementById('ideaCategory').value,
    teaser:       document.getElementById('ideaTeaser').value,
    description:  document.getElementById('ideaDescription').value,
    problem:      document.getElementById('ideaProblem').value,
    market:       document.getElementById('ideaMarket').value,
    marketSize:   document.getElementById('ideaMarketSize')?.value || '',
    costSavings:  document.getElementById('ideaCostSavings')?.value || '',
    competitors:  document.getElementById('ideaCompetitors')?.value || '',
    revenueModel: document.getElementById('ideaRevenueModel')?.value || '',
    hasFiles:     FileUploadEngine.hasFiles(),
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

  const durationDays = parseInt(document.getElementById('auctionDuration').value);
  const royaltyBps   = parseInt(document.getElementById('royaltyPct').value) * 100;
  const reserveETH   = parseFloat(reserve) / 3000; // Convert USD to ETH estimate

  // Build listing object for local state
  const listing = {
    id: 'CV-' + Date.now().toString(36).toUpperCase(),
    title: document.getElementById('ideaTitle').value,
    category: document.getElementById('ideaCategory').value,
    teaser: document.getElementById('ideaTeaser').value,
    cid: state.currentEncryption.cid,
    keyHash: state.currentEncryption.keyHashStr,
    score: state.currentScore,
    reserve: parseInt(reserve),
    duration: durationDays,
    royalty: parseInt(document.getElementById('royaltyPct').value),
    wallet: state.wallet,
    created: Date.now(),
    endsAt: Date.now() + (durationDays * 86400000),
    bids: [],
    status: 'live',
    onChain: false,
    onChainId: null,
    txHash: null,
  };

  // Attempt on-chain submission if contracts deployed
  if (Chain.isDeployed()) {
    try {
      document.querySelector('#launchLoading .loading-sub').textContent =
        'Confirm transaction in MetaMask...';
      const result = await Chain.listIdea({
        ipfsCid:          state.currentEncryption.cid,
        keyHash:          state.currentEncryption.keyHashStr,
        category:         listing.category,
        aiScore:          Math.round(state.currentScore.overallScore),
        dollarValueMidUSD: state.currentScore.dollarValueMid,
        reserveETH:       reserveETH,
        durationSeconds:  durationDays * 86400,
        royaltyBps:       royaltyBps,
      });
      listing.onChain   = true;
      listing.onChainId = result.listingId;
      listing.txHash    = result.txHash;
      listing.id        = 'CV-' + result.listingId;
    } catch(e) {
      // On-chain failed — fall back to local
      listing.onChain = false;
      notify('info', 'Saved Locally', 'On-chain submission failed. Listing saved locally.');
    }
  }

  state.listings.push(listing);
  localStorage.setItem('cv_listings', JSON.stringify(state.listings));

  document.getElementById('launchLoading').style.display = 'none';
  document.getElementById('launchSuccess').style.display = 'block';

  // Show tx hash if on-chain
  if (listing.onChain) {
    document.getElementById('launchSuccess').innerHTML += `
      <div style="margin-top:16px;font-family:var(--mono);font-size:10px;color:var(--green);letter-spacing:1px">
        ✓ ON-CHAIN TX: <a href="https://sepolia.etherscan.io/tx/${listing.txHash}" target="_blank"
        style="color:var(--cyan)">${listing.txHash.slice(0,20)}...</a>
      </div>`;
  }

  updateStats();
  renderListings();

  addClaudeEntry(
    listing.onChain ? 'ok' : 'info',
    listing.onChain ? 'On-Chain Listing Confirmed' : 'New Local Listing',
    `Idea "${listing.title}" listed. AI score: ${listing.score.overallScore}/100. ` +
    (listing.onChain ? `TX confirmed on-chain. ID: #${listing.onChainId}.` : 'Saved locally — deploy contracts for on-chain.')
  );
  notify('success', '🚀 Idea Listed', listing.onChain ? 'Confirmed on Ethereum!' : 'Live on CryptValt.');
}
// ── File Upload Handlers ───────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('fileDropZone').style.borderColor = 'var(--cyan)';
  document.getElementById('fileDropZone').style.background  = 'var(--cyan-dim)';
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('fileDropZone').style.borderColor = 'rgba(0,200,255,0.2)';
  document.getElementById('fileDropZone').style.background  = 'var(--surface2)';
  const files = Array.from(e.dataTransfer.files);
  files.forEach(addFileToUpload);
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  files.forEach(addFileToUpload);
}

function addFileToUpload(file) {
  try {
    const fileObj = FileUploadEngine.addFile(file);
    renderFileList();
    notify('success', '📎 File Added', file.name + ' (' + fileObj.sizeStr + ')');
  } catch(e) {
    notify('error', 'File Rejected', e.message);
  }
}

function removeFile(id) {
  FileUploadEngine.removeFile(id);
  renderFileList();
}

function renderFileList() {
  const list  = document.getElementById('fileList');
  const files = FileUploadEngine.getFiles();
  if (!list) return;

  if (files.length === 0) {
    list.innerHTML = '';
    return;
  }

  const statusColors = {
    pending:    'var(--text-muted)',
    encrypting: 'var(--gold)',
    uploading:  'var(--cyan)',
    done:       'var(--green)',
    error:      'var(--red)',
  };

  list.innerHTML = files.map(f => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface3);border:1px solid var(--border);margin-bottom:6px">
      <span style="font-size:20px;flex-shrink:0">${f.icon}</span>
      <div style="flex:1;overflow:hidden">
        <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</div>
        <div style="font-family:var(--mono);font-size:9px;color:${statusColors[f.status] || 'var(--text-muted)'};letter-spacing:1px;margin-top:2px">
          ${f.sizeStr} · ${f.status.toUpperCase()}${f.cid ? ' · ' + f.cid.slice(0,12) + '...' : ''}${f.error ? ' · ' + f.error : ''}
        </div>
      </div>
      ${f.status === 'pending' ? `<button onclick="removeFile('${f.id}')" style="background:transparent;border:1px solid var(--red);color:var(--red);padding:4px 8px;cursor:pointer;font-size:11px;font-family:var(--mono)">✕</button>` : ''}
    </div>
  `).join('');
}
