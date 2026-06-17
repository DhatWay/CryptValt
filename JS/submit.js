/**
 * CryptValt — Submission Flow v2.0
 *
 * New workflow:
 * Step 1 — Inventor fills out idea form
 * Step 2 — Idea sent to backend POST /api/ideas/submit
 *           Backend encrypts server-side, runs full AI scoring,
 *           runs USPTO patent search, returns score + ideaId
 * Step 3 — Score displayed to inventor
 * Step 4 — Inventor sets auction parameters
 * Step 5 — Inventor signs with wallet, listing goes on-chain
 *
 * No IPFS. No browser encryption. Works in any Web3 browser.
 */

function goToStep2() {
  const title        = document.getElementById('ideaTitle').value.trim();
  const desc         = document.getElementById('ideaDescription').value.trim();
  const teaser       = document.getElementById('ideaTeaser').value.trim();
  const category     = document.getElementById('ideaCategory').value;
  const problem      = document.getElementById('ideaProblem').value.trim();
  const market       = document.getElementById('ideaMarket').value.trim();
  const marketSize   = document.getElementById('ideaMarketSize')?.value?.trim()   || '';
  const costSavings  = document.getElementById('ideaCostSavings')?.value?.trim()  || '';
  const competitors  = document.getElementById('ideaCompetitors')?.value?.trim()  || '';
  const revenueModel = document.getElementById('ideaRevenueModel')?.value?.trim() || '';

  if (!title || !desc || !teaser || !category || !problem || !market) {
    notify('error', 'Missing Fields', 'Please fill in all required fields.');
    return;
  }
  if (desc.length < 50) {
    notify('error', 'Description Too Short', 'Please describe your idea in at least 50 characters.');
    return;
  }
  if (!state.wallet) {
    notify('error', 'Wallet Required', 'Connect your wallet to continue.');
    return;
  }

  state.currentIdea = { title, description: desc, teaser, category, problem, market, marketSize, costSavings, competitors, revenueModel };

  setStep(2);
  document.getElementById('submitStep1').style.display = 'none';
  document.getElementById('submitStep2').style.display = 'block';
  submitIdeaToBackend();
}

async function submitIdeaToBackend() {
  const loadEl   = document.getElementById('encryptLoading');
  const resultEl = document.getElementById('encryptResult');
  if (loadEl)   loadEl.style.display   = 'block';
  if (resultEl) resultEl.style.display = 'none';

  setEP(1, 'active');

  const messages = ['Securing your idea...','Running AI analysis...','Searching patents...','Generating report...'];
  let mi = 0;
  const progressEl = document.getElementById('encryptStatus') || document.querySelector('.loading-sub');
  const interval   = setInterval(() => {
    if (mi < messages.length) {
      setEP(mi + 1, 'done');
      if (mi + 1 < 4) setEP(mi + 2, 'active');
      if (progressEl) progressEl.textContent = messages[mi];
      mi++;
    }
  }, 3500);

  try {
    const response = await fetch(CONFIG.BACKEND_URL + '/api/ideas/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Wallet-Address': state.wallet, 'X-Timestamp': Date.now().toString() },
      body:    JSON.stringify({ ...state.currentIdea, reservePrice: 0, royaltyPct: 0, durationDays: 7 }),
    });

    clearInterval(interval);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Submission failed: ' + response.status }));
      throw new Error(err.message || 'Submission failed');
    }

    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Submission failed');

    state.currentIdeaId   = result.data.ideaId;
    state.currentIdeaHash = result.data.ideaHash;
    state.currentScore    = result.data.score;
    state.currentPatent   = result.data.patentResult;

    setEP(2, 'done'); setEP(3, 'done'); setEP(4, 'done');
    if (loadEl)   loadEl.style.display   = 'none';
    if (resultEl) resultEl.style.display = 'block';

    const cidEl     = document.getElementById('ipfsCid');
    const hashEl    = document.getElementById('keyHash');
    const previewEl = document.getElementById('encryptedPreview');
    if (cidEl)     cidEl.textContent     = result.data.ideaId;
    if (hashEl)    hashEl.textContent    = result.data.ideaHash.slice(0,32) + '...';
    if (previewEl) previewEl.textContent = 'Idea secured. SHA-256: ' + result.data.ideaHash.slice(0,32) + '...';

    showPatentStatus(result.data.patentResult);
    notify('success', 'Idea Secured & Scored', 'Your idea is encrypted and ready for listing.');

  } catch(e) {
    clearInterval(interval);
    if (loadEl) loadEl.style.display = 'none';
    notify('error', 'Submission Failed', e.message);
    setStep(1);
    document.getElementById('submitStep2').style.display = 'none';
    document.getElementById('submitStep1').style.display = 'block';
  }
}

function showPatentStatus(patentResult) {
  if (!patentResult) return;
  const colors  = { CLEAR:'var(--green)', REVIEW_NEEDED:'var(--gold)', CONFLICT_LIKELY:'var(--red)', NOT_SEARCHED:'var(--text-muted)', SEARCH_FAILED:'var(--text-muted)' };
  const labels  = { CLEAR:'CLEAR — No conflicting patents found', REVIEW_NEEDED:'REVIEW NEEDED — Similar patents exist', CONFLICT_LIKELY:'CONFLICT LIKELY — Close prior art found', NOT_SEARCHED:'Patent search not performed', SEARCH_FAILED:'Patent search temporarily unavailable' };
  const container = document.getElementById('encryptResult');
  if (!container) return;
  const el = document.createElement('div');
  el.style.cssText = `margin-top:12px;padding:12px 16px;background:var(--surface2);border:1px solid ${colors[patentResult.status]||'var(--border)'};`;
  el.innerHTML = `<div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:6px">USPTO PATENT SEARCH</div><div style="font-size:13px;color:${colors[patentResult.status]||'var(--text-muted)'};font-weight:600">${labels[patentResult.status]||patentResult.status}</div>${patentResult.results&&patentResult.results.length>0?`<div style="font-size:11px;color:var(--text-muted);margin-top:6px">${patentResult.results.length} related patent(s) found</div>`:''}`;
  container.appendChild(el);
}

function goToStep3() {
  setStep(3);
  document.getElementById('submitStep2').style.display = 'none';
  document.getElementById('submitStep3').style.display = 'block';
  document.getElementById('scoringLoading').style.display = 'none';
  document.getElementById('scoreResult').style.display    = 'block';
  if (state.currentScore) {
    document.getElementById('scoreResult').innerHTML = renderAIReport(state.currentScore, state.currentIdea?.title||'');
    setTimeout(() => {
      document.getElementById('scoreResult').innerHTML += `<div style="margin-top:24px"><button class="btn btn-primary btn-full" onclick="goToStep4()">Set Auction Parameters →</button></div>`;
    }, 300);
  }
}

function goToStep4() {
  setStep(4);
  document.getElementById('submitStep3').style.display = 'none';
  document.getElementById('submitStep4').style.display = 'block';
  if (state.currentScore) {
    const mid       = state.currentScore.dollarValueMid || state.currentScore.saleValuation?.dollarValueMid || 0;
    const suggested = Math.floor(mid * 0.3);
    const priceEl   = document.getElementById('reservePrice');
    if (priceEl) { priceEl.value = suggested; priceEl.placeholder = `Suggested: $${suggested.toLocaleString()} (30% of AI value)`; }
  }
}

async function goToStep5() {
  if (!document.getElementById('legalAgree').checked) { notify('error','Agreement Required','You must agree to the legal terms.'); return; }
  const reserve = document.getElementById('reservePrice').value;
  if (!reserve || reserve < 1) { notify('error','Reserve Price Required','Enter a reserve price.'); return; }
  if (!state.currentIdeaId) { notify('error','Idea Not Submitted','Please complete Step 2 first.'); return; }

  setStep(5);
  document.getElementById('submitStep4').style.display = 'none';
  document.getElementById('submitStep5').style.display = 'block';

  const durationDays = parseInt(document.getElementById('auctionDuration').value) || 7;
  const royaltyPct   = parseInt(document.getElementById('royaltyPct').value)      || 0;
  const royaltyBps   = royaltyPct * 100;
  const reserveETH   = parseFloat(reserve) / 3000;

  const listing = {
    id: state.currentIdeaId, title: state.currentIdea.title,
    category: state.currentIdea.category, teaser: state.currentIdea.teaser,
    ideaHash: state.currentIdeaHash, score: state.currentScore, patent: state.currentPatent,
    reserve: parseInt(reserve), duration: durationDays, royalty: royaltyPct,
    wallet: state.wallet, created: Date.now(), endsAt: Date.now()+(durationDays*86400000),
    bids: [], status: 'live', onChain: false, onChainId: null, txHash: null,
  };

  if (Chain.isDeployed()) {
    try {
      document.querySelector('#launchLoading .loading-sub').textContent = 'Confirm transaction in MetaMask...';
      const result = await Chain.listIdea({
        ipfsCid: state.currentIdeaHash, keyHash: state.currentIdeaHash,
        category: listing.category, aiScore: Math.round(state.currentScore.overallScore),
        dollarValueMidUSD: state.currentScore.dollarValueMid || state.currentScore.saleValuation?.dollarValueMid || 0,
        reserveETH, durationSeconds: durationDays*86400, royaltyBps,
      });
      listing.onChain = true; listing.onChainId = result.listingId; listing.txHash = result.txHash;
      await fetch(CONFIG.BACKEND_URL+'/api/ideas/go-live', {
        method:'PATCH', headers:{'Content-Type':'application/json','X-Wallet-Address':state.wallet},
        body: JSON.stringify({ ideaId: state.currentIdeaId, onChainId: result.listingId, txHash: result.txHash }),
      }).catch(()=>{});
    } catch(e) {
      listing.onChain = false;
      notify('info','Saved — On-Chain Failed', e.reason||e.message);
      await fetch(CONFIG.BACKEND_URL+'/api/ideas/go-live', {
        method:'PATCH', headers:{'Content-Type':'application/json','X-Wallet-Address':state.wallet},
        body: JSON.stringify({ ideaId: state.currentIdeaId }),
      }).catch(()=>{});
    }
  } else {
    await fetch(CONFIG.BACKEND_URL+'/api/ideas/go-live', {
      method:'PATCH', headers:{'Content-Type':'application/json','X-Wallet-Address':state.wallet},
      body: JSON.stringify({ ideaId: state.currentIdeaId }),
    }).catch(()=>{});
  }

  state.listings.push(listing);
  localStorage.setItem('cv_listings', JSON.stringify(state.listings));
  state.currentIdea = null; state.currentIdeaId = null; state.currentIdeaHash = null; state.currentScore = null; state.currentPatent = null;

  document.getElementById('launchLoading').style.display = 'none';
  document.getElementById('launchSuccess').style.display = 'block';
  if (listing.onChain) {
    document.getElementById('launchSuccess').innerHTML += `<div style="margin-top:16px;font-family:var(--mono);font-size:10px;color:var(--green)">✓ ON-CHAIN TX: <a href="https://sepolia.etherscan.io/tx/${listing.txHash}" target="_blank" style="color:var(--cyan)">${listing.txHash.slice(0,20)}...</a></div>`;
  }

  updateStats(); renderListings();
  addClaudeEntry(listing.onChain?'ok':'info', listing.onChain?'On-Chain Listing Confirmed':'New Listing Live', `Idea "${listing.title}" listed. AI score: ${listing.score.overallScore}/100.`);
  notify('success','Idea Listed!', listing.onChain?'Confirmed on Ethereum!':'Live on CryptValt.');
}

function handleDragOver(e) { e.preventDefault(); document.getElementById('fileDropZone').style.borderColor='var(--cyan)'; }
function handleDrop(e) { e.preventDefault(); document.getElementById('fileDropZone').style.borderColor='rgba(0,200,255,0.2)'; Array.from(e.dataTransfer.files).forEach(addFileToUpload); }
function handleFileSelect(e) { Array.from(e.target.files).forEach(addFileToUpload); }
function addFileToUpload(file) { try { FileUploadEngine.addFile(file); renderFileList(); notify('success','File Added',file.name); } catch(e) { notify('error','File Rejected',e.message); } }
function removeFile(id) { FileUploadEngine.removeFile(id); renderFileList(); }
function renderFileList() {
  const list = document.getElementById('fileList');
  const files = FileUploadEngine.getFiles();
  if (!list) return;
  if (!files.length) { list.innerHTML=''; return; }
  list.innerHTML = files.map(f=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface3);border:1px solid var(--border);margin-bottom:6px"><span style="font-size:20px">${f.icon}</span><div style="flex:1"><div style="font-size:13px;font-weight:600">${f.name}</div><div style="font-size:9px;color:var(--text-muted)">${f.sizeStr}</div></div>${f.status==='pending'?`<button onclick="removeFile('${f.id}')" style="background:transparent;border:1px solid var(--red);color:var(--red);padding:4px 8px;cursor:pointer;font-size:11px">✕</button>`:''}</div>`).join('');
}