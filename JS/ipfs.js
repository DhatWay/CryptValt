/**
 * CryptValt — IPFS Storage v3.0
 * Routes through secure backend proxy
 */

async function uploadToIPFS(data, filename) {
  const response = await fetch(CONFIG.BACKEND_URL + '/api/ipfs/upload', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Wallet-Address': state.wallet || '0x0000000000000000000000000000000000000000',
      'X-Timestamp':      Date.now().toString(),
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || 'IPFS upload failed: ' + response.status);
  }

  const result = await response.json();
  if (!result.success) throw new Error('IPFS upload failed');
  return result.data.cid;
}

async function fetchFromIPFS(cid) {
  const response = await fetch(CONFIG.BACKEND_URL + '/api/ipfs/fetch/' + cid);
  if (!response.ok) throw new Error('IPFS fetch failed: ' + response.status);
  const result = await response.json();
  return result.data;
}

async function checkIPFSHealth() {
  try {
    const response = await fetch(CONFIG.BACKEND_URL + '/api/ipfs/status');
    const result   = await response.json();
    return result.data?.pinata === 'online';
  } catch {
    return false;
  }
}
