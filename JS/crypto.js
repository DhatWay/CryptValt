/**
 * CryptValt — Encryption Engine
 * Real AES-256-GCM — no mocks
 */

async function generateKey() {
  return await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

async function encryptData(key, data) {
  const iv      = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoded
  );
  return { encrypted: new Uint8Array(encrypted), iv };
}

async function decryptData(key, encryptedBytes, iv) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, encryptedBytes
  );
  return new TextDecoder().decode(decrypted);
}

async function exportKey(key) {
  const raw = await window.crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importKey(keyB64) {
  const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  return await window.crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
  );
}

async function hashKey(keyB64) {
  const data = new TextEncoder().encode(keyB64);
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function generateSealedBidCommitment(amount, listingId, wallet) {
  const salt = Array.from(window.crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2,'0')).join('');
  const data = new TextEncoder().encode(amount + salt + wallet + listingId);
  const hash = await window.crypto.subtle.digest('SHA-256', data);
  const bidHash = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2,'0')).join('');
  return { salt, bidHash, commitment: '0x' + bidHash };
}