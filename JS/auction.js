/**
 * CryptValt — Auction, Listings & Rendering
 */

function renderListings(filter = 'all', sort = 'newest') {
  const grid = document.getElementById('listingsGrid');
  let listings = [...state.listings];

  if (filter !== 'all') listings = listings.filter(l => l.category === filter);

  if (sort === 'score') listings.sort((a,b) => b.score.overallScore - a.score.overallScore);
  else if (sort === 'value') listings.sort((a,b) => b.score.dollarValueMid - a.score.dollarValueMid);
  else if (sort === 'ending') listings.sort((a,b) => a.endsAt - b.endsAt);
  else listings.sort((a,b) => b.created - a.created);

  document.getElementById('marketCount').textContent = listings.length + ' LISTINGS';

  if (listings.length === 0) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon">🔐</div><div class="empty-title">No Listings Yet</div><div class="empty-sub">Be the first to submit an encrypted idea</div></div>`;
    return;
  }

  grid.innerHTML = listings.map(l => renderListingCard(l)).join('');
}

function renderListingCard(l) {
  const isLive = l.status === 'live' && l.endsAt > Date.now();
  const timeLeft = getTimeLeft(l.endsAt);
  const topBid = l.bids.length > 0 ? Math.max(...l.bids.map(b => b.amount)) : 0;
  const score = l.score;
  const scoreColor = score.overallScore >= 75 ? 'var(--green)' : score.overallScore >= 50 ? 'var(--gold)' : 'var(--red)';

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-id">${l.id}</div>
          <div style="margin-top:6px">${isLive ? '<span class="badge badge-live"><div class="badge-dot"></div>LIVE</span>' : '<span class="badge badge-ended">ENDED</span>'}</div>
        </div>
        <div class="card-score">
          <div class="score-num" style="color:${scoreColor}">${score.overallScore}</div>
          <div class="score-label">AI SCORE</div>
        </div>
      </div>

      <div class="card-title">${l.title}</div>
      <div class="card-category">${l.category}</div>
      <p style="font-size:14px;color:var(--text-dim);margin-bottom:16px;line-height:1.5;font-style:italic">"${l.teaser}"</p>

      <div class="card-encrypted">${fakeEncryptedString(80)}</div>

      <div class="score-bars">
        ${renderScoreBar('Marketability', score.scores.marketability)}
        ${renderScoreBar('Scalability', score.scores.scalability)}
        ${renderScoreBar('Consumer Potential', score.scores.consumerPotential)}
      </div>

      <div class="card-meta">
        <div class="meta-item">
          <div class="meta-label">AI Value Est.</div>
          <div class="meta-value gold">$${score.dollarValueMid.toLocaleString()}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Reserve Price</div>
          <div class="meta-value cyan">$${l.reserve.toLocaleString()}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Top Bid</div>
          <div class="meta-value ${topBid > 0 ? 'green' : ''}">${topBid > 0 ? '$' + topBid.toLocaleString() : 'No Bids'}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Royalty</div>
          <div class="meta-value">${l.royalty}%</div>
        </div>
      </div>

      ${isLive ? `
      <div class="auction-timer" id="timer-${l.id}">
        <div class="timer-unit"><span class="timer-num">${timeLeft.d}</span><span class="timer-label">DAYS</span></div>
        <div class="timer-unit"><span class="timer-num">${timeLeft.h}</span><span class="timer-label">HRS</span></div>
        <div class="timer-unit"><span class="timer-num">${timeLeft.m}</span><span class="timer-label">MIN</span></div>
        <div class="timer-unit"><span class="timer-num">${timeLeft.s}</span><span class="timer-label">SEC</span></div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn btn-secondary btn-sm" onclick="viewReport('${l.id}')">View Full Report</button>
        ${isLive ? `<button class="btn btn-gold btn-sm" onclick="openBid('${l.id}')">Place Sealed Bid</button>` : '<button class="btn btn-sm" disabled style="opacity:0.4;cursor:default;border:1px solid var(--border);background:transparent;color:var(--text-muted)">Auction Ended</button>'}
      </div>
    </div>
  `;
}

function getTimeLeft(endsAt) {
  const diff = Math.max(0, endsAt - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return {
    d: String(d).padStart(2,'0'),
    h: String(h).padStart(2,'0'),
    m: String(m).padStart(2,'0'),
    s: String(s).padStart(2,'0')
  };
}

function openBid(listingId) {
  if (!state.wallet) {
    notify('error', 'Wallet Required', 'Connect your wallet to place a bid.');
    connectWallet();
    return;
  }
  const listing = state.listings.find(l => l.id === listingId);
  if (!listing) return;

  const topBid = listing.bids.length > 0 ? Math.max(...listing.bids.map(b => b.amount)) : listing.reserve;

  document.getElementById('bidModalContent').innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">IDEA</div>
      <div style="font-size:18px;font-weight:700;letter-spacing:1px">${listing.title}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--cyan);margin-top:4px">${listing.id}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:6px">AI VALUE</div>
        <div style="font-family:var(--display);font-size:20px;color:var(--gold)">$${listing.score.dollarValueMid.toLocaleString()}</div>
      </div>
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:6px">RESERVE</div>
        <div style="font-family:var(--display);font-size:20px;color:var(--cyan)">$${listing.reserve.toLocaleString()}</div>
      </div>
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:6px">TOP BID</div>
        <div style="font-family:var(--display);font-size:20px;color:var(--green)">${listing.bids.length > 0 ? '$' + topBid.toLocaleString() : 'None'}</div>
      </div>
    </div>

    <div class="bid-section">
      <div class="bid-title">// SEALED BID — Your amount is hidden until auction end</div>
      <div class="bid-input-row">
        <input type="number" class="bid-input" id="bidAmount" placeholder="${topBid + 1}" min="${listing.reserve}">
        <div class="bid-currency">USDC</div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:8px;letter-spacing:1px">// Minimum bid: $${listing.reserve.toLocaleString()} · Your bid is cryptographically sealed</div>
    </div>

    <div class="legal-box" style="margin-top:20px">
      <div class="legal-title">⚖ Bidder Agreement</div>
      <div class="legal-text">By placing this bid, you agree: (1) If you win, you are obligated to pay the bid amount. (2) Funds will be held in escrow until key delivery. (3) Upon receiving the decryption key, the sale is final. (4) Platform fee of 20% applies to the seller — you pay the full bid amount.</div>
    </div>

    <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <button class="btn btn-secondary" onclick="closeModal('bidModal')">Cancel</button>
      <button class="btn btn-gold" onclick="submitBid('${listingId}')">Sign & Submit Sealed Bid</button>
    </div>
  `;

  document.getElementById('bidModal').classList.add('active');
}

async function submitBid(listingId) {
  const amount = parseInt(document.getElementById('bidAmount').value);
  const listing = state.listings.find(l => l.id === listingId);

  if (!amount || amount < listing.reserve) {
    notify('error', 'Invalid Bid', `Bid must be at least $${listing.reserve.toLocaleString()}`);
    return;
  }

  const salt = Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
  const bidMsg = `CryptValt Bid | Listing: ${listingId} | Amount: ${amount} USDC | Wallet: ${state.wallet} | Salt: ${salt} | Time: ${new Date().toISOString()}`;
  const sig = await signMessage(bidMsg);

  // Create sealed bid hash
  const hashInput = new TextEncoder().encode(amount + salt + state.wallet);
  const hashBuf = await window.crypto.subtle.digest('SHA-256', hashInput);
  const bidHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

  const bid = {
    id: 'BID-' + Date.now().toString(36).toUpperCase(),
    listingId,
    amount,
    wallet: state.wallet,
    salt,
    hash: bidHash,
    sig,
    timestamp: Date.now()
  };

  listing.bids.push(bid);
  state.bids.push(bid);
  localStorage.setItem('cv_listings', JSON.stringify(state.listings));
  localStorage.setItem('cv_bids', JSON.stringify(state.bids));

  closeModal('bidModal');
  renderListings();
  notify('success', '🎯 Sealed Bid Submitted', `Bid of $${amount.toLocaleString()} USDC sealed for "${listing.title}"`);

  addClaudeEntry('info', 'New Sealed Bid', `Bid received on "${listing.title}" (${listingId}). Amount sealed. Bid hash: ${bidHash.slice(0,16)}... Running bid pattern analysis...`);
}

function viewReport(listingId) {
  const listing = state.listings.find(l => l.id === listingId);
  if (!listing) return;

  const topBid = listing.bids.length > 0 ? Math.max(...listing.bids.map(b => b.amount)) : 0;

  document.getElementById('reportModalContent').innerHTML = `
    <div style="margin-bottom:20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text-muted);letter-spacing:2px">${listing.id} · ${listing.category.toUpperCase()}</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:1px;margin-top:4px">${listing.title}</div>
        <p style="font-size:14px;color:var(--text-dim);font-style:italic;margin-top:6px">"${listing.teaser}"</p>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px">
        ${listing.status === 'live' && listing.endsAt > Date.now() ? `<button class="btn btn-gold btn-sm" onclick="closeModal('reportModal');openBid('${listing.id}')">Place Bid</button>` : ''}
      </div>
    </div>
    <hr class="divider">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">TOP BID</div>
        <div style="font-family:var(--display);font-size:22px;color:var(--green)">${topBid > 0 ? '$' + topBid.toLocaleString() : '—'}</div>
      </div>
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">BIDS</div>
        <div style="font-family:var(--display);font-size:22px;color:var(--cyan)">${listing.bids.length}</div>
      </div>
      <div style="background:var(--surface3);padding:14px;text-align:center">
        <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">ROYALTY</div>
        <div style="font-family:var(--display);font-size:22px;color:var(--gold)">${listing.royalty}%</div>
      </div>
    </div>
    ${renderAIReport(listing.score, listing.title)}
  `;

  document.getElementById('reportModal').classList.add('active');
}

function renderDashboard() {
  const myListings = state.listings.filter(l => l.wallet === state.wallet);
  const myBids = state.bids.filter(b => b.wallet === state.wallet);

  document.getElementById('myIdeasCount').textContent = myListings.length;
  document.getElementById('myBidsCount').textContent = myBids.length;

  const earned = myListings.reduce((sum, l) => {
    if (l.bids.length > 0 && l.status !== 'live') {
      const top = Math.max(...l.bids.map(b => b.amount));
      return sum + Math.floor(top * CONFIG.INVENTOR_SHARE);
    }
    return sum;
  }, 0);
  document.getElementById('myEarned').textContent = '$' + earned.toLocaleString();

  const myIdeasGrid = document.getElementById('myIdeasGrid');
  if (myListings.length === 0) {
    myIdeasGrid.innerHTML = `<div class="empty"><div class="empty-icon">💡</div><div class="empty-title">No Ideas Yet</div><div class="empty-sub">Submit your first encrypted idea</div></div>`;
  } else {
    myIdeasGrid.innerHTML = myListings.map(l => renderListingCard(l)).join('');
  }
}

function updateStats() {
  const live = state.listings.filter(l => l.status === 'live' && l.endsAt > Date.now()).length;
  const volume = state.listings.reduce((sum, l) => {
    if (l.bids.length > 0) return sum + Math.max(...l.bids.map(b => b.amount));
    return sum;
  }, 0);
  document.getElementById('statIdeas').textContent = state.listings.length;
  document.getElementById('statVolume').textContent = volume > 0 ? '$' + volume.toLocaleString() : '$0';
  document.getElementById('statActive').textContent = live;
}

function filterListings(val) { renderListings(val); }

function sortListings(val) { renderListings('all', val); }
