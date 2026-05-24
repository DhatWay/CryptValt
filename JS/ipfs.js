/**
 * CryptValt — IPFS Storage
 * Real Pinata uploads — no mocks, no fallbacks
 */

async function uploadToIPFS(data, filename) {
  const blob     = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));
  formData.append('pinataMetadata', JSON.stringify({ name: filename }));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'pinata_api_key':        CONFIG.PINATA_API_KEY,
      'pinata_secret_api_key': CONFIG.PINATA_API_SECRET,
    },
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error('IPFS upload failed: ' + response.status + ' — ' + err);
  }

  const result = await response.json();
  return result.IpfsHash;
}

async function fetchFromIPFS(cid) {
  const response = await fetch('https://gateway.pinata.cloud/ipfs/' + cid);
  if (!response.ok) throw new Error('IPFS fetch failed: ' + response.status);
  return await response.json();
}

async function checkIPFSHealth() {
  const response = await fetch('https://api.pinata.cloud/data/testAuthentication', {
    headers: {
      'pinata_api_key':        CONFIG.PINATA_API_KEY,
      'pinata_secret_api_key': CONFIG.PINATA_API_SECRET,
    }
  });
  return response.ok;
}
