# Technical Architecture: KryptoVault

## 1. Executive Summary & Design Principles

The KryptoVault is designed to solve the critical vulnerabilities of centralized data repositories: single points of failure, administrative backdoors, third-party data exploitation, and high costs associated with storing large data blobs directly on public blockchains. 

By decoupling data ownership, identity verification, access governance, and physical file storage into modular cryptographic layers, the system achieves a Zero-Trust architecture. Raw personal data, unencrypted files, and private keys never leave the client device in plaintext.

```
+-----------------------------------------------------------------------+
|                             USER DEVICE                               |
|   +-----------------------+               +-----------------------+   |
|   | Wallet (MetaMask)     |               | Encryption Module     |   |
|   | - Signature Auth      |               | - AES-256-GCM Encrypt |   |
|   | - Tx Signing          |               | - Key Wrapping/Unwrap |   |
|   | - No private-key read |               | - SHA-256 Hashing     |   |
|   +-----------+-----------+               +-----------+-----------+   |
+---------------+---------------------------------------+---------------+
                |                                       |
                v                                       v
+---------------+-----------+               +-----------+---------------+
|   BLOCKCHAIN LAYER        |               |   OFF-CHAIN STORAGE       |
|   (EVM / Sepolia)         |               |   (MongoDB GridFS / Object Storage) |
|   - Asset Provenance      |               | - Encrypted File Blobs    |
|   - Permission Rules      |               | - Wrapped AES Keys        |
|   - SHA-256 Hashes        |               | - Public Encryption Keys  |
|   - Immutable Audit Log   |               | - Metadata Records        |
+---------------------------+               +---------------------------+
```

---

## 2. Layered Architecture Deep Dive

### 2.1 Identity Layer (Wallet-Based Identity & Authentication)
The identity framework uses wallet-anchored authentication while keeping blockchain signing separate from file-encryption keys.
* **Wallet-Based Authentication:** Account ownership is proven through challenge-response signatures using MetaMask.
* **Blockchain Signing:** MetaMask is used for wallet identity, authentication, and signing blockchain transactions; the application never accesses wallet private keys.
* **Application Encryption Keys:** File-key wrapping uses a separate public/private encryption key pair managed by the application or user device.
* **KYC / Verification Metadata:** Optional profile and KYC-status metadata can be associated with a wallet address without placing raw identity documents on-chain.

> **Future Scope:** Verifiable Credentials and selective-disclosure / zero-knowledge proof workflows may be added later for privacy-preserving attribute verification.

### 2.2 Access Control Layer (Smart Contracts)
Access governance is executed by Solidity smart contracts deployed on an EVM-compatible chain (Ethereum Sepolia Testnet).
* **Automated Bouncer Pattern:** Smart contracts act as decentralized permission gatekeepers. Server administrators cannot override contract-defined permission checks.
* **Permission Types:**
  * `READ`: Grants permission to view the decrypted file within a constrained, read-only UI container.
  * `WRITE`: Grants permission to download, extract, edit locally, and commit a new version to the blockchain ledger.
  * `NONE`: Explicitly flags access removal (used during revocation).
* **Temporal Governance:** Access entries include a `validUntil` timestamp enforcing time-bounded permission windows.
* **Per-User MVP Permissions:** The current MVP focuses on per-file, per-user access control.
* **Future Scope:** Group, folder, and role-based permission classes can extend the same model for enterprise and government workflows.

### 2.3 Cryptographic & Digital Asset Layer
All security guarantees stem from client-side cryptography using standard Web Crypto API primitives.
* **Symmetric File Encryption:** Files are encrypted client-side using `AES-256-GCM` with random initialisation vectors (IVs). Large files use chunked processing to manage browser memory efficiently.
* **Asymmetric Key Wrapping:** Document AES keys are wrapped (encrypted) using the recipient’s RSA/ECC public encryption key before being transferred or stored.
* **Integrity Fingerprinting:** A `SHA-256` hash is calculated over the encrypted payload and pinned directly to the smart contract upon registration or commit.

### 2.4 Off-Chain Storage Layer
Due to high gas costs and execution constraints of on-chain storage, data blobs reside off-chain in MongoDB GridFS or object storage.
* **Storage Contents:** Encrypted asset payloads, wrapped AES keys, public encryption keys, user profile metadata, and version commit logs.
* **Zero-Plaintext Server Stance:** Storage servers function as untrusted persistence nodes holding no plaintext files, raw AES keys, wallet private keys, or private encryption keys.

---

## 3. Core Cryptographic Workflows

### 3.1 Asset Upload & Registration

```
[Owner Device]                             [Storage (MongoDB/Object Storage)]         [Smart Contract]
      |                                                |                            |
      |-- 1. Generate random AES-256 key ------------->|                            |
      |-- 2. Encrypt asset (AES-256-GCM) ------------->|                            |
      |-- 3. Compute SHA-256 hash of ciphertext ----->|                            |
      |-- 4. Wrap AES key with Owner Public Key ------>|                            |
      |                                                |                            |
      |-- 5. Upload Encrypted Asset + Wrapped Key ---->|                            |
      |                                                |                            |
      |-- 6. Register Asset (ID, Hash, Version) ----------------------------------->|
```

1. **Local Key Generation:** Client generates a cryptographically random 256-bit AES symmetric key.
2. **Client-Side Encryption:** File is encrypted locally using AES-256-GCM.
3. **Integrity Hash:** Client computes `SHA-256(EncryptedBlob)`.
4. **Self Key Wrapping:** AES key is wrapped using the owner's public key.
5. **Payload Upload:** Encrypted file blob and wrapped AES key are sent to MongoDB GridFS / Object Storage.
6. **On-Chain Pinning:** Owner invokes `registerAsset(assetId, sha256Hash)` on the smart contract, recording ownership and initial version metadata.

---

### 3.2 Access Granting & Delivery

```
[Owner Device]               [Backend / DB]             [Recipient Device]             [Smart Contract]
      |                            |                            |                             |
      |-- 1. Fetch Recipient ---->|                            |                             |
      |      Public Key            |                            |                             |
      |-- 2. Wrap AES Key -------->|                            |                             |
      |      for Recipient         |                            |                             |
      |                            |                            |                             |
      |-- 3. Grant Permission (Wallet, Permission, TimeWindow) ------------------------------>|
      |                            |                            |                             |
      |                            |<-- 4. Request Asset ------|                             |
      |                            |                            |-- 5. Check Authorization -->|
      |                            |                            |<-- Permission Valid --------|
      |                            |-- 6. Deliver Payload ----->|                             |
      |                            |    + Wrapped Key           |                             |
      |                            |                            |-- 7. Unwrap AES Key         |
      |                            |                            |-- 8. Decrypt File           |
      |                            |                            |-- 9. Verify SHA-256 Hash    |
```

1. **Key Re-Wrapping:** Owner fetches recipient's public key from the database and wraps the existing document AES key.
2. **Off-Chain Key Storage:** Recipient's wrapped AES key is saved to off-chain storage.
3. **On-Chain Policy Update:** Owner calls `grantAccess(assetId, recipientWallet, permissionType, duration, reason)` on the smart contract.
4. **Access Request:** Recipient signs a challenge with their wallet to request asset payload.
5. **Contract Verification:** Backend queries smart contract `checkAccess(assetId, recipientWallet)`.
6. **Payload Delivery:** If verified, backend returns encrypted file and wrapped AES key.
7. **Local Decryption & Integrity Check:** Recipient unwraps the AES key using their private key, decrypts the file in browser memory, calculates the SHA-256 hash, and matches it against the on-chain hash.

---

## 4. Revocation Protocols

```
                          REVOCATION PROTOCOLS
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
   WEAK REVOCATION                                   STRONG REVOCATION
   (Permission Update)                               (Key Rotation & Re-encryption)
   - Contract sets state to NONE                     - Generate new AES key locally
   - API blocks future file requests                 - Re-encrypt current version locally
   - Simple & zero storage re-write                  - Issue new wrapped keys for active users
   - Used for routine permission removal             - Update on-chain hash & version bump
                                                     - Prevents old keys from decrypting newly re-encrypted/current asset states
```

### 4.1 Weak Revocation Protocol
* **Mechanism:** Owner executes `revokeAccess(assetId, targetWallet)` on the smart contract, setting permission status to `NONE`.
* **Effect:** Backend API immediately rejects subsequent file payload requests for the target user.
* **Trade-off:** Fast and low-cost, but does not invalidate prior local copies or cached AES keys if the user previously decrypted the payload.

### 4.2 Strong Revocation Protocol (Key Rotation)
* **Trigger:** Required for high-security assets or when a compromised user must be fully isolated from current data states.
* **Workflow:**
  1. Owner removes target user on-chain.
  2. Owner generates a fresh AES-256 key client-side.
  3. Owner downloads and re-encrypts the current asset payload with the new key.
  4. Owner wraps the new AES key exclusively for remaining authorized users.
  5. Updated ciphertext replaces old blob in off-chain storage.
  6. Owner commits new SHA-256 hash and increments version number on the smart contract via `strongRevokeAndCommit()`.
* **Result:** A revoked user holding the old AES key cannot decrypt the newly re-encrypted/current asset state. Strong revocation cannot erase plaintext or historical ciphertext already legitimately obtained before revocation.

---

## 5. Security & Threat Mitigations

| Threat Vector | Severity | Vulnerability Mechanism | Vault Mitigation Strategy |
| :--- | :---: | :--- | :--- |
| **Storage DB Breach** | High | Unauthenticated access to database records | Attacker obtains only AES-256 encrypted blobs and wrapped keys. Without user private keys, data remains completely unreadable. |
| **RAM Key Extraction** | Medium | AES key lingering in browser memory post-decryption | AES keys exist in RAM for the minimum required execution window. Memory references are cleared immediately after render. Strong revocation forces new key generation. |
| **Data Tampering** | High | Malicious modification of encrypted file in storage | SHA-256 ciphertext hash is verified against on-chain hash before decryption. Any mismatch triggers an immediate integrity alarm. |
| **Unauthorized Exfiltration** | Medium | User downloading, copying, or screenshotting sensitive files | `READ` mode can restrict normal application export/edit actions, but client-side plaintext capture cannot be fully prevented. Sensitive data policies should account for this residual risk. |
| **Private Key Loss/Theft** | High | Compromise of user encryption keys | Current design keeps private encryption keys client-side and never stores them on the server. Hardware-backed/WebAuthn protection can be added as a future enhancement. |

---

## 6. Smart Contract Data Specification

### Data Structures

```solidity
enum PermissionType { NONE, READ, WRITE }

struct AccessPermission {
    PermissionType permission;
    uint256 validFrom;
    uint256 validUntil;
    string reason;
}

struct VersionCommit {
    uint256 versionNumber;
    bytes32 sha256Hash;
    uint256 timestamp;
    string commitMessage;
    address committedBy;
}

struct AssetRecord {
    string assetId;
    address owner;
    uint256 currentVersion;
    bytes32 latestHash;
    uint256 createdAt;
    uint256 updatedAt;
}
```

### Immutable Audit Events
The smart contract emits EVM logs for every lifecycle action, creating an unalterable audit trail:
* `event AssetRegistered(string indexed assetId, address indexed owner, bytes32 initialHash, uint256 timestamp);`
* `event AccessGranted(string indexed assetId, address indexed recipient, PermissionType permission, uint256 validFrom, uint256 validUntil, string reason);`
* `event AccessRevoked(string indexed assetId, address indexed recipient, string reason, uint256 timestamp);`
* `event StrongRevocationExecuted(string indexed assetId, uint256 newVersion, bytes32 newHash);`
* `event VersionCommitted(string indexed assetId, uint256 versionNumber, bytes32 sha256Hash, address indexed committer);`


---

## 7. Future Technical Extensions

The following capabilities are intentionally treated as future scope rather than current MVP guarantees:

* IPFS-based decentralized file storage.
* Verifiable Credentials and privacy-preserving selective disclosure.
* Zero-knowledge proof workflows for identity attributes.
* Group, folder, and role-based permission management.
* Hardware-backed/WebAuthn protection for application encryption keys.
* Advanced screenshot/export mitigation on managed native clients.
