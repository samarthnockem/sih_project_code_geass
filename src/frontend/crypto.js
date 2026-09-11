(function () {
  "use strict";

  const DB_NAME = "kryptovault-crypto-identity";
  const DB_VERSION = 1;
  const STORE_NAME = "keys";
  const IDENTITY_KEY_PREFIX = "document-encryption-identity";
  const RSA_OAEP_PARAMS = {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256"
  };
  const AES_GCM_PARAMS = {
    name: "AES-GCM",
    length: 256
  };
  const DEFAULT_PASSWORD_KDF_ITERATIONS = 310000;

  function requireWebCrypto() {
    if (!globalThis.crypto?.subtle) {
      throw new Error("Web Crypto is required for document encryption identity.");
    }
  }

  function requireIndexedDb() {
    if (!globalThis.indexedDB) {
      throw new Error("IndexedDB is required to store the document encryption private key.");
    }
  }

  function normalizeWalletAddress(walletAddress) {
    const normalized = String(walletAddress || "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new Error("A valid wallet address is required for the document encryption identity.");
    }
    return normalized;
  }

  function identityStoreKey(walletAddress) {
    return `${IDENTITY_KEY_PREFIX}:${normalizeWalletAddress(walletAddress)}`;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function arrayBufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function getPasswordKdfIterations() {
    const configured = Number(window.KRYPTO_PASSWORD_KDF_ITERATIONS || DEFAULT_PASSWORD_KDF_ITERATIONS);
    if (!Number.isInteger(configured) || configured < 210000) {
      throw new Error("Password KDF iterations must be an integer of at least 210000.");
    }
    return configured;
  }

  async function sha256Base64Url(value) {
    const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest("SHA-256", input);
    return arrayBufferToBase64(digest).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  async function sha256Hex(value) {
    requireWebCrypto();
    const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest("SHA-256", input);
    return arrayBufferToHex(digest);
  }

  function openDatabase() {
    requireIndexedDb();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onerror = () => reject(request.error || new Error("Could not open crypto identity database."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function readStoredIdentity(walletAddress) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(storeKey);

      request.onerror = () => reject(request.error || new Error("Could not read encryption identity."));
      request.onsuccess = () => resolve(request.result || null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not read encryption identity."));
      };
    });
  }

  async function writeStoredIdentity(walletAddress, identity) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(identity, storeKey);

      request.onerror = () => reject(request.error || new Error("Could not store encryption identity."));
      request.onsuccess = () => resolve();
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not store encryption identity."));
      };
    });
  }

  async function deleteStoredIdentity(walletAddress) {
    const db = await openDatabase();
    const storeKey = identityStoreKey(walletAddress);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(storeKey);

      request.onerror = () => reject(request.error || new Error("Could not delete encryption identity."));
      request.onsuccess = () => resolve();
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not delete encryption identity."));
      };
    });
  }

  async function exportPublicKey(publicKey) {
    const publicKeyBytes = await crypto.subtle.exportKey("spki", publicKey);
    return arrayBufferToBase64(publicKeyBytes);
  }

  async function importPublicKey(publicEncryptionKey) {
    requireWebCrypto();
    return crypto.subtle.importKey(
      "spki",
      base64ToArrayBuffer(publicEncryptionKey),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"]
    );
  }

  async function generateDocumentEncryptionIdentity(walletAddress) {
    requireWebCrypto();
    requireIndexedDb();
    const ownerWallet = normalizeWalletAddress(walletAddress);

    const keyPair = await crypto.subtle.generateKey(RSA_OAEP_PARAMS, false, ["wrapKey", "unwrapKey"]);
    const publicEncryptionKey = await exportPublicKey(keyPair.publicKey);
    const keyId = await sha256Base64Url(publicEncryptionKey);
    const identity = {
      keyId,
      walletAddress: ownerWallet,
      algorithm: "RSA-OAEP",
      hash: "SHA-256",
      createdAt: new Date().toISOString(),
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicEncryptionKey
    };

    await writeStoredIdentity(ownerWallet, identity);
    return identity;
  }

  async function getDocumentEncryptionIdentity(walletAddress) {
    const ownerWallet = normalizeWalletAddress(walletAddress);
    const existing = await readStoredIdentity(ownerWallet);
    if (existing?.publicKey && existing?.privateKey && existing?.publicEncryptionKey) {
      return existing;
    }

    return generateDocumentEncryptionIdentity(ownerWallet);
  }

  async function ensureDocumentEncryptionIdentityRegistered(walletAddress) {
    if (!window.KryptoVaultApi) {
      throw new Error("API client is required to register the document encryption public key.");
    }

    const identity = await getDocumentEncryptionIdentity(walletAddress);
    await window.KryptoVaultApi.put("/api/users/me/encryption-key", {
      publicEncryptionKey: identity.publicEncryptionKey
    });
    return {
      keyId: identity.keyId,
      algorithm: identity.algorithm,
      hash: identity.hash,
      publicEncryptionKey: identity.publicEncryptionKey
    };
  }

  async function getPublicEncryptionKey(walletAddress) {
    if (!window.KryptoVaultApi) {
      throw new Error("API client is required to retrieve public encryption keys.");
    }

    return window.KryptoVaultApi.get(`/api/users/${encodeURIComponent(walletAddress)}/public-key`);
  }

  async function generateDocumentAesKey() {
    requireWebCrypto();
    return crypto.subtle.generateKey(AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
  }

  function generateAesGcmIv() {
    requireWebCrypto();
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    return iv;
  }

  function generatePasswordSalt() {
    requireWebCrypto();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return salt;
  }

  async function derivePasswordKey(password, salt, iterations = getPasswordKdfIterations()) {
    requireWebCrypto();
    if (typeof password !== "string" || !password) {
      throw new Error("Password is required for this password-protected asset.");
    }

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
      },
      passwordKey,
      AES_GCM_PARAMS,
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function wrapDocumentAesKey(aesKey, publicEncryptionKey) {
    const wrappingKey = await importPublicKey(publicEncryptionKey);
    const wrapped = await crypto.subtle.wrapKey("raw", aesKey, wrappingKey, { name: "RSA-OAEP" });
    return arrayBufferToBase64(wrapped);
  }

  async function exportRawAesKey(aesKey) {
    requireWebCrypto();
    return crypto.subtle.exportKey("raw", aesKey);
  }

  async function importRawAesKey(rawKey) {
    requireWebCrypto();
    return crypto.subtle.importKey("raw", rawKey, AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
  }

  async function wrapDocumentAesKeyWithPassword(aesKey, password, options = {}) {
    const salt = options.salt || generatePasswordSalt();
    const iv = options.iv || generateAesGcmIv();
    const iterations = options.iterations || getPasswordKdfIterations();
    const passwordKey = await derivePasswordKey(password, salt, iterations);
    const rawAesKey = await exportRawAesKey(aesKey);
    const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, passwordKey, rawAesKey);

    return {
      wrappedAESKey: arrayBufferToBase64(wrapped),
      wrappingMetadata: {
        algorithm: "PBKDF2-SHA-256+A256GCM",
        kdf: {
          algorithm: "PBKDF2-SHA-256",
          iterations,
          salt: arrayBufferToBase64(salt.buffer)
        },
        keyEncryption: {
          algorithm: "AES-256-GCM",
          iv: arrayBufferToBase64(iv.buffer)
        }
      }
    };
  }

  async function unwrapPasswordWrappedDocumentAesKey(wrappedAESKey, password, wrappingMetadata) {
    if (wrappingMetadata?.algorithm !== "PBKDF2-SHA-256+A256GCM") {
      throw new Error("Password wrapping metadata is required.");
    }

    const salt = base64ToArrayBuffer(wrappingMetadata.kdf?.salt || "");
    const iv = base64ToArrayBuffer(wrappingMetadata.keyEncryption?.iv || "");
    const iterations = Number(wrappingMetadata.kdf?.iterations || 0);
    const passwordKey = await derivePasswordKey(password, salt, iterations);
    const rawAesKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      base64ToArrayBuffer(wrappedAESKey)
    );

    return importRawAesKey(rawAesKey);
  }

  async function encryptBytesWithAesGcm(plaintext, aesKey, iv = generateAesGcmIv()) {
    requireWebCrypto();
    const encryptedBytes = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);
    return {
      encryptedBytes,
      encryptionMetadata: {
        algorithm: "AES-256-GCM",
        iv: arrayBufferToBase64(iv.buffer),
        tag: "included-in-ciphertext"
      }
    };
  }

  async function decryptBytesWithAesGcm(ciphertext, aesKey, encryptionMetadata) {
    requireWebCrypto();
    if (encryptionMetadata?.algorithm !== "AES-256-GCM") {
      throw new Error("Unsupported encryption metadata.");
    }

    const iv = base64ToArrayBuffer(encryptionMetadata.iv || "");
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
  }

  async function unwrapDocumentAesKey(wrappedAESKey, walletAddress) {
    const identity = await getDocumentEncryptionIdentity(walletAddress);
    return crypto.subtle.unwrapKey(
      "raw",
      base64ToArrayBuffer(wrappedAESKey),
      identity.privateKey,
      { name: "RSA-OAEP" },
      AES_GCM_PARAMS,
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function recoverDocumentAesKey({ wrappedAESKey, wrappingMetadata, walletAddress, password }) {
    if (wrappingMetadata?.algorithm === "PBKDF2-SHA-256+A256GCM") {
      if (!password) {
        throw new Error("Password is required for this password-protected asset.");
      }
      return unwrapPasswordWrappedDocumentAesKey(wrappedAESKey, password, wrappingMetadata);
    }

    return unwrapDocumentAesKey(wrappedAESKey, walletAddress);
  }

  async function encryptFileWithPublicKey(file, publicEncryptionKey, keyId) {
    requireWebCrypto();
    if (!file?.arrayBuffer) {
      throw new Error("A browser File is required for encryption.");
    }

    const plaintext = await file.arrayBuffer();
    const sha256 = await sha256Hex(plaintext);
    const aesKey = await generateDocumentAesKey();
    const iv = generateAesGcmIv();
    const encrypted = await encryptBytesWithAesGcm(plaintext, aesKey, iv);
    const wrappedAESKey = await wrapDocumentAesKey(aesKey, publicEncryptionKey);

    return {
      encryptedBytes: encrypted.encryptedBytes,
      sha256,
      wrappedAESKey,
      encryptionMetadata: encrypted.encryptionMetadata,
      wrappingMetadata: {
        algorithm: "RSA-OAEP",
        keyId: keyId || "owner-document-encryption-key"
      }
    };
  }

  async function encryptFileForOwner(file, ownerWalletAddress) {
    const identity = await getDocumentEncryptionIdentity(ownerWalletAddress);
    return encryptFileWithPublicKey(file, identity.publicEncryptionKey, identity.keyId);
  }

  const api = {
    generateDocumentEncryptionIdentity,
    getDocumentEncryptionIdentity,
    ensureDocumentEncryptionIdentityRegistered,
    getPublicEncryptionKey,
    sha256Hex,
    generateDocumentAesKey,
    generateAesGcmIv,
    generatePasswordSalt,
    derivePasswordKey,
    encryptBytesWithAesGcm,
    decryptBytesWithAesGcm,
    wrapDocumentAesKey,
    wrapDocumentAesKeyWithPassword,
    unwrapDocumentAesKey,
    unwrapPasswordWrappedDocumentAesKey,
    recoverDocumentAesKey,
    encryptFileWithPublicKey,
    encryptFileForOwner,
    deleteStoredIdentity,
    test: {
      arrayBufferToBase64,
      base64ToArrayBuffer,
      arrayBufferToHex,
      sha256Base64Url,
      sha256Hex,
      normalizeWalletAddress,
      identityStoreKey,
      encryptBytesWithAesGcm,
      decryptBytesWithAesGcm,
      wrapDocumentAesKeyWithPassword,
      unwrapPasswordWrappedDocumentAesKey,
      encryptFileWithPublicKey
    }
  };

  window.KryptoVaultCrypto = api;
})();
