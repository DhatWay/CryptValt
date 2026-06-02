/**
 * CryptValt — File Upload & Encryption System v1.0
 *
 * Supports any file type — PDF, images, Word docs,
 * presentations, videos, audio, zip archives.
 *
 * Architecture:
 * - Files read as ArrayBuffer via FileReader API
 * - Encrypted with AES-256-GCM (same key as idea text)
 * - Uploaded to IPFS as encrypted binary blobs
 * - Metadata stored separately (filename, type, size, CID)
 * - Buyer decrypts and downloads after purchase
 * - Max file size: 50MB per file, 5 files per listing
 */

const FileUploadEngine = (() => {

  const MAX_FILE_SIZE    = 50 * 1024 * 1024; // 50MB
  const MAX_FILES        = 5;
  const ALLOWED_TYPES    = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'application/zip', 'application/x-zip-compressed',
    'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/wav',
    'application/json',
  ];

  // ── State ──────────────────────────────────────────────
  let uploadedFiles = [];

  // ── Validate File ──────────────────────────────────────
  function validateFile(file) {
    const errors = [];
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name} exceeds 50MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
    }
    if (!ALLOWED_TYPES.includes(file.type) && file.type !== '') {
      // Allow unknown types but warn
      console.warn(`Unknown file type: ${file.type}`);
    }
    if (uploadedFiles.length >= MAX_FILES) {
      errors.push(`Maximum ${MAX_FILES} files per listing`);
    }
    return errors;
  }

  // ── Read File as ArrayBuffer ───────────────────────────
  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Encrypt File ───────────────────────────────────────
  async function encryptFile(file, cryptoKey) {
    const buffer    = await readFileAsArrayBuffer(file);
    const iv        = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      buffer
    );

    return {
      encrypted: new Uint8Array(encrypted),
      iv,
      originalName: file.name,
      originalType: file.type,
      originalSize: file.size,
    };
  }

  // ── Convert to Base64 for IPFS upload ─────────────────
  function arrayBufferToBase64(buffer) {
    const bytes  = new Uint8Array(buffer);
    let binary   = '';
    const chunk  = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view   = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buffer;
  }

  // ── Upload Encrypted File to IPFS ─────────────────────
  async function uploadEncryptedFile(file, cryptoKey, wallet) {
    // Encrypt
    const { encrypted, iv, originalName, originalType, originalSize } = await encryptFile(file, cryptoKey);

    // Build upload payload
    const payload = {
      encryptedData: arrayBufferToBase64(encrypted),
      iv:            arrayBufferToBase64(iv),
      keyHash:       '', // Will be set by caller
      category:      'file',
      title:         originalName,
      teaser:        `Encrypted file: ${originalName}`,
      metadata: {
        originalName,
        originalType,
        originalSize,
        encryptedSize: encrypted.length,
        uploadedAt:    new Date().toISOString(),
      },
    };

    // Upload via backend
    const response = await fetch(
      (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/ipfs/upload',
      {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Wallet-Address': wallet || '0x0000000000000000000000000000000000000000',
          'X-Timestamp':      Date.now().toString(),
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Upload failed for ${originalName}`);
    }

    const result = await response.json();
    return {
      cid:          result.data.cid,
      originalName,
      originalType,
      originalSize,
      encryptedSize: encrypted.length,
    };
  }

  // ── Decrypt & Download File ────────────────────────────
  async function decryptAndDownload(cid, cryptoKey, expectedName) {
    // Fetch from IPFS
    const response = await fetch(
      (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/ipfs/fetch/' + cid
    );
    if (!response.ok) throw new Error('Failed to fetch file from IPFS');

    const data          = await response.json();
    const encryptedData = base64ToArrayBuffer(data.encryptedData);
    const iv            = base64ToArrayBuffer(data.iv);

    // Decrypt
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      cryptoKey,
      encryptedData
    );

    // Trigger download
    const blob = new Blob([decrypted], { type: data.metadata?.originalType || 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = expectedName || data.metadata?.originalName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  }

  // ── Format File Size ───────────────────────────────────
  function formatSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ── Get File Icon ──────────────────────────────────────
  function getFileIcon(type) {
    if (type?.includes('pdf'))         return '📄';
    if (type?.includes('image'))       return '🖼️';
    if (type?.includes('word') || type?.includes('document')) return '📝';
    if (type?.includes('powerpoint') || type?.includes('presentation')) return '📊';
    if (type?.includes('excel') || type?.includes('sheet')) return '📈';
    if (type?.includes('video'))       return '🎥';
    if (type?.includes('audio'))       return '🎵';
    if (type?.includes('zip'))         return '🗜️';
    if (type?.includes('text'))        return '📃';
    return '📎';
  }

  // ── Add File to Upload List ────────────────────────────
  function addFile(file) {
    const errors = validateFile(file);
    if (errors.length > 0) throw new Error(errors[0]);

    const fileObj = {
      id:       Date.now().toString(36),
      file,
      name:     file.name,
      type:     file.type,
      size:     file.size,
      status:   'pending', // pending, encrypting, uploading, done, error
      cid:      null,
      error:    null,
      icon:     getFileIcon(file.type),
      sizeStr:  formatSize(file.size),
    };

    uploadedFiles.push(fileObj);
    return fileObj;
  }

  function removeFile(id) {
    uploadedFiles = uploadedFiles.filter(f => f.id !== id);
  }

  function getFiles() { return [...uploadedFiles]; }
  function clearFiles() { uploadedFiles = []; }
  function hasFiles() { return uploadedFiles.length > 0; }

  // ── Upload All Files ───────────────────────────────────
  async function uploadAllFiles(cryptoKey, wallet, onProgress) {
    const results = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const fileObj = uploadedFiles[i];
      fileObj.status = 'encrypting';
      if (onProgress) onProgress(fileObj, i, uploadedFiles.length);

      try {
        fileObj.status = 'uploading';
        if (onProgress) onProgress(fileObj, i, uploadedFiles.length);

        const result = await uploadEncryptedFile(fileObj.file, cryptoKey, wallet);
        fileObj.status = 'done';
        fileObj.cid    = result.cid;
        results.push({ ...result, id: fileObj.id });

        if (onProgress) onProgress(fileObj, i, uploadedFiles.length);
      } catch(e) {
        fileObj.status = 'error';
        fileObj.error  = e.message;
        if (onProgress) onProgress(fileObj, i, uploadedFiles.length);
      }
    }
    return results;
  }

  return {
    addFile,
    removeFile,
    getFiles,
    clearFiles,
    hasFiles,
    uploadAllFiles,
    decryptAndDownload,
    formatSize,
    getFileIcon,
    validateFile,
    MAX_FILE_SIZE,
    MAX_FILES,
  };

})();
