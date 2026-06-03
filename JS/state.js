/**
 * CryptValt — Global State
 */

const state = {
  wallet:             null,
  listings:           JSON.parse(localStorage.getItem('cv_listings') || '[]'),
  bids:               JSON.parse(localStorage.getItem('cv_bids')     || '[]'),
  currentEncryption:  null,
  currentScore:       null,
  claudeHistory:      [],
  filter:             'all',
  sort:               'newest',
};

function saveListings() {
  try { localStorage.setItem('cv_listings', JSON.stringify(state.listings)); } catch(e) {}
}

function saveBids() {
  try { localStorage.setItem('cv_bids', JSON.stringify(state.bids)); } catch(e) {}
}
