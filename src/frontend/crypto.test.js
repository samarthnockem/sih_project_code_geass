const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const cryptoSource = fs.readFileSync(path.join(__dirname, "crypto.js"), "utf8");

assert(!cryptoSource.includes("localStorage"), "crypto identity must not use localStorage");
assert(cryptoSource.includes("indexedDB.open"), "crypto identity must use IndexedDB");
assert(cryptoSource.includes("RSA-OAEP"), "crypto identity must use RSA-OAEP");
assert(cryptoSource.includes("SHA-256"), "crypto identity must use SHA-256");
assert(cryptoSource.includes("generateKey(RSA_OAEP_PARAMS, false"), "RSA private key must be generated non-extractable");
assert(!cryptoSource.includes("exportKey(\"pkcs8\""), "private key must not be exported as PKCS8");
assert(!cryptoSource.includes("exportKey('pkcs8'"), "private key must not be exported as PKCS8");
assert(!cryptoSource.includes("/api/auth"), "document encryption identity must not use MetaMask auth APIs directly");

const context = {
  window: {},
  crypto: webcrypto,
  indexedDB: {
    open() {
      throw new Error("IndexedDB should not be used by pure helper tests.");
    }
  },
  btoa(value) {
    return Buffer.from(value, "binary").toString("base64");
  },
  atob(value) {
    return Buffer.from(value, "base64").toString("binary");
  },
  TextEncoder,
  Uint8Array,
  ArrayBuffer,
  Error
};

vm.createContext(context);
vm.runInContext(cryptoSource, context);

const helpers = context.window.KryptoVaultCrypto.test;
const bytes = new Uint8Array([1, 2, 3, 250, 255]);
const encoded = helpers.arrayBufferToBase64(bytes.buffer);
assert.equal(encoded, "AQID+v8=");
assert.deepEqual(new Uint8Array(helpers.base64ToArrayBuffer(encoded)), bytes);
assert.equal(helpers.normalizeWalletAddress("0xA111111111111111111111111111111111111111"), "0xa111111111111111111111111111111111111111");
assert.throws(() => helpers.normalizeWalletAddress("not-a-wallet"), /valid wallet address/);
assert.equal(
  helpers.identityStoreKey("0xA111111111111111111111111111111111111111"),
  "document-encryption-identity:0xa111111111111111111111111111111111111111"
);

async function runAsyncTests() {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["wrapKey", "unwrapKey"]
  );
  const publicKeyBytes = await webcrypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicEncryptionKey = helpers.arrayBufferToBase64(publicKeyBytes);
  const plaintext = new TextEncoder().encode("hello");
  const file = {
    arrayBuffer: async () => plaintext.buffer
  };

  const encrypted = await helpers.encryptFileWithPublicKey(file, publicEncryptionKey, "owner-key-1");
  const encryptedAgain = await helpers.encryptFileWithPublicKey(file, publicEncryptionKey, "owner-key-1");

  assert.equal(encrypted.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assert.equal(encrypted.encryptionMetadata.algorithm, "AES-256-GCM");
  assert.equal(encrypted.encryptionMetadata.tag, "included-in-ciphertext");
  assert.equal(encrypted.wrappingMetadata.algorithm, "RSA-OAEP");
  assert.equal(encrypted.wrappingMetadata.keyId, "owner-key-1");
  assert(encrypted.encryptedBytes.byteLength > plaintext.byteLength);
  assert(encrypted.wrappedAESKey.length > 0);
  assert.notEqual(encrypted.encryptionMetadata.iv, encryptedAgain.encryptionMetadata.iv);

  const decrypted = await helpers.decryptBytesWithAesGcm(
    encrypted.encryptedBytes,
    await webcrypto.subtle.unwrapKey(
      "raw",
      Buffer.from(encrypted.wrappedAESKey, "base64"),
      keyPair.privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    ),
    encrypted.encryptionMetadata
  );
  assert.equal(await helpers.sha256Hex(decrypted), encrypted.sha256);
  assert.deepEqual(new Uint8Array(decrypted), plaintext);

  const aesKey = await context.window.KryptoVaultCrypto.generateDocumentAesKey();
  const passwordWrapped = await helpers.wrapDocumentAesKeyWithPassword(aesKey, "correct horse battery staple", {
    iterations: 210000
  });
  const recoveredKey = await helpers.unwrapPasswordWrappedDocumentAesKey(
    passwordWrapped.wrappedAESKey,
    "correct horse battery staple",
    passwordWrapped.wrappingMetadata
  );
  const originalRawKey = await webcrypto.subtle.exportKey("raw", aesKey);
  const recoveredRawKey = await webcrypto.subtle.exportKey("raw", recoveredKey);

  assert.equal(passwordWrapped.wrappingMetadata.algorithm, "PBKDF2-SHA-256+A256GCM");
  assert.equal(passwordWrapped.wrappingMetadata.kdf.algorithm, "PBKDF2-SHA-256");
  assert.equal(passwordWrapped.wrappingMetadata.kdf.iterations, 210000);
  assert.equal(passwordWrapped.wrappingMetadata.keyEncryption.algorithm, "AES-256-GCM");
  assert.deepEqual(new Uint8Array(recoveredRawKey), new Uint8Array(originalRawKey));
  await assert.rejects(
    () => helpers.unwrapPasswordWrappedDocumentAesKey(
      passwordWrapped.wrappedAESKey,
      "wrong password",
      passwordWrapped.wrappingMetadata
    ),
    /operation-specific/
  );
}

runAsyncTests()
  .then(() => {
    console.log("frontend crypto tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
