# KryptoVault Decentralized Architecture Flowcharts

This comprehensive document outlines the complete secure file storage ecosystem, detailing user uploads, cryptographic key management, granular smart contract access controls, and robust dynamic revocation mechanisms.

```text
+-----------------------------------------------------------------------+
| 1. USER UPLOADS FILE                                                  |
+-----------------------------------------------------------------------+
|   +---------------+     +---------------+     +---------------+       |
|   | Owner Selects | --> | Optional KDF  | --> | Generate AES  |       |
|   | File & Hashes |     | (if password) |     | Key (K1)      |       |
|   +-------+-------+     +---------------+     +-------+-------+       |
|           |                                           |               |
|           v                                           v               |
|   +---------------+     +---------------+     +-------+-------+       |
|   | Smart Contract|     | Wrap K1 with  | <-- | Encrypt File  |       |
|   | - Create ID   |     | Owner Pub Key |     | (AES-256-GCM) |       |
|   | - Store Hash  |     | (EK_Owner)    |     +-------+-------+       |
|   | - Perm: WRITE |     +-------+-------+             |               |
|   +---------------+             |                     |               |
|                                 v                     v               |
|                         +-------------------------------------+       |
|                         | DATABASE / OFF-CHAIN STORAGE        |       |
|                         | - Store Encrypted File              |       |
|                         | - Store EK_Owner & Metadata         |       |
|                         +-------------------------------------+       |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 2. OWNER GIVES ACCESS                                                 |
+-----------------------------------------------------------------------+
|   +---------------+     +---------------+     +---------------+       |
|   | Select Recip. | --> | Fetch Alice's | --> | Owner unwraps |       |
|   | (Alice) + Perm|     | Pub Enc Key   |     | K1 from DB    |       |
|   +-------+-------+     +---------------+     +-------+-------+       |
|           |                                           |               |
|           v                                           v               |
|   +---------------+                           +-------+-------+       |
|   | Smart Contract|                           | Wrap K1 with  |       |
|   | - Call Grant  |                           | Alice Pub Key |       |
|   | - Store READ/ |                           | (EK_Alice)    |       |
|   |   WRITE Perms |                           +-------+-------+       |
|   +---------------+                                   |               |
|                                                       v               |
|                                               +---------------+       |
|                                               | DB Storage    |       |
|                                               | - Store       |       |
|                                               |   EK_Alice    |       |
|                                               +---------------+       |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 3. USER ACCESSES FILE (Alice)                                         |
+-----------------------------------------------------------------------+
|   +---------------+     +---------------+     +---------------+       |
|   | Request File  | --> | Smart Contract| --> | Fetch File &  |       |
|   | (Auth Wallet) |     | Check Perms   |     | EK_Alice (DB) |       |
|   +---------------+     +---------------+     +-------+-------+       |
|                                                       |               |
|                                                       v               |
|   +---------------+     +---------------+     +-------+-------+       |
|   | Decrypt File  | <-- | Optional KDF  | <-- | Unwrap K1     |       |
|   | Locally (View)|     | (if password) |     | (Priv Key)    |       |
|   +-------+-------+     +---------------+     +---------------+       |
|           |                                                           |
|           v (If WRITE Perm & Modifications Made)                      |
|   +---------------+     +---------------+     +---------------+       |
|   | Save Changes  | --> | DB Stores New | --> | Smart Contract|       |
|   | Gen New Hash  |     | Encrypted File|     | Commit Vers 2 |       |
|   +---------------+     +---------------+     +---------------+       |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 4. WEAK & STRONG REVOKE                                               |
+-----------------------------------------------------------------------+
| WEAK REVOKE:                                                          |
|   +---------------+     +---------------+     +---------------+       |
|   | Call Revoke   | --> | Smart Contract| --> | Backend Stops |       |
|   | on Alice      |     | Sets Perm NONE|     | Sending File  |       |
|   +---------------+     +---------------+     | & EK_Alice    |       |
|                                               +---------------+       |
|                                                                       |
| STRONG REVOKE:                                                        |
|   +---------------+     +---------------+     +---------------+       |
|   | Decrypt File  | --> | Re-encrypt    | --> | Smart Contract|       |
|   | with K1       |     | with NEW Key  |     | Records New   |       |
|   |               |     | (K2)          |     | Hash (H_new)  |       |
|   +---------------+     +-------+-------+     +---------------+       |
|                                 |                                     |
|                                 v                                     |
|                         +---------------+                             |
|                         | Wrap K2 ONLY  |                             |
|                         | for Remaining |                             |
|                         | Auth Users DB |                             |
|                         +---------------+                             |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 5. STRONG REVOKE                                                      |
+-----------------------------------------------------------------------+
|   +---------------+     +---------------+     +---------------+       |
|   | Owner Selects | --> | Call Revoke   | --> | Smart Contract|       |
|   | Strong Revoke |     | Access (Alice)|     | Sets Perm NONE|       |
|   +---------------+     +---------------+     +-------+-------+       |
|                                                       |               |
|                                                       v               |
|                         +---------------+     +---------------+       |
|                         | Decrypt File  | <-- | Generate NEW  |       |
|                         | using Old K1  |     | AES Key (K2)  |       |
|                         +-------+-------+     +-------+-------+       |
|                                 |                     |               |
|                                 v                     v               |
|   +---------------+     +---------------+     +---------------+       |
|   | DB Stores New | <-- | Re-encrypt    |     | Find Remaining|       |
|   | Encrypted     |     | File with NEW |     | Auth Users &  |       |
|   | Version       |     | Key (K2)      |     | Wrap K2       |       |
|   +---------------+     +-------+-------+     +-------+-------+       |
|                                 |                     |               |
|                                 v                     v               |
|   +---------------+     +---------------+     +---------------+       |
|   | Smart Contract| <-- | Generate NEW  |     | DB Stores New |       |
|   | Commits New   |     | SHA-256 Hash  |     | Wrapped Keys  |       |
|   | Hash (H_new)  |     | (H_new)       |     | (No EK_Alice) |       |
|   +-------+-------+     +---------------+     +---------------+       |
|           |                                                           |
|           v                                                           |
|   +---------------+                                                   |
|   | Alice Only    |                                                   |
|   | Has K1 (Cannot|                                                   |
|   | Decrypt File) |                                                   |
|   +---------------+                                                   |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 6. SMART CONTRACT / BLOCKCHAIN STORAGE                                |
+-----------------------------------------------------------------------+
|   [AssetRegistry Contract]                                            |
|                                                                       |
|   +-----------------------+   +-----------------------+               |
|   | Asset Records         |   | Access Permissions    |               |
|   | - Asset ID            |   | - User Wallet         |               |
|   | - Owner Wallet        |   | - READ/WRITE/NONE     |               |
|   | - Current SHA-256     |   | - Valid From/Until    |               |
|   | - Current Version     |   | - Reason / Message    |               |
|   | - Creation Timestamp  |   +-----------------------+               |
|   +-----------------------+                                           |
|                                                                       |
|   +-----------------------+   +-----------------------+               |
|   | Version History       |   | Immutable Events      |               |
|   | - Version Number      |   | - FileRegistered      |               |
|   | - Hash & Timestamp    |   | - AccessGranted       |               |
|   | - Updated By          |   | - FileAccessed        |               |
|   | - Commit Message      |   | - AccessRevoked       |               |
|   +-----------------------+   | - StrongRevoke        |               |
|                               | - VersionCommitted    |               |
|                               +-----------------------+               |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 7. DATABASE / OFF-CHAIN STORAGE                                       |
+-----------------------------------------------------------------------+
|   +-----------------------+   +-----------------------+               |
|   | Users                 |   | Assets                |               |
|   | - Wallet Address      |   | - Encrypted File      |               |
|   | - Public Enc Key      |   | - Filename & Version  |               |
|   | - Profile Metadata    |   | - Blockchain Asset ID |               |
|   | - KYC References      |   | - Storage Metadata    |               |
|   +-----------------------+   +-----------------------+               |
|                                                                       |
|   +-----------------------+   +-----------------------+               |
|   | Wrapped Keys          |   | Optional Password Meta|               |
|   | - Asset ID & User     |   | - Salt                |               |
|   | - EK_User             |   | - KDF Parameters      |               |
|   | - Wrapping Metadata   |   | - Protection Enabled  |               |
|   +-----------------------+   +-----------------------+               |
|                                                                       |
|   +---------------------------------------------------------------+   |
|   | NEVER STORE                                                   |   |
|   | - Plaintext File / Raw AES Key / Plaintext File Password      |   |
|   | - Raw Private Encryption Key / Wallet Private Key             |   |
|   +---------------------------------------------------------------+   |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 8. USER SIDE (Device / Browser)                                       |
+-----------------------------------------------------------------------+
|   +-----------------------+   +-----------------------+               |
|   | MetaMask / Wallet     |   | Encryption Identity   |               |
|   | - Wallet Address      |   | - Public Enc Key      |               |
|   | - Wallet Private Key  |   | - Private Enc Key --> |               |
|   | - Digital Signatures  |   |   IndexedDB Storage   |               |
|   +-----------------------+   +-----------------------+               |
|                                                                       |
|   +-----------------------+   +-----------------------+               |
|   | Crypto Engine         |   | Temp Working Area     |               |
|   | - AES-256-GCM & KDF   |   | - Plaintext in Mem    |               |
|   | - SHA-256 Hashing     |   | - AES Key in Mem      |               |
|   | - Wrap/Unwrap Keys    |   | - Cleared on Save     |               |
|   +-----------------------+   +-----------------------+               |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| 9. HIGH-LEVEL SYSTEM ARCHITECTURE                                     |
+-----------------------------------------------------------------------+
|                                                                       |
|   +---------------+     Wallet Auth       +---------------+           |
|   |               | --------------------> |               |           |
|   |   USER SIDE   |   Auth Data Delivery  |    BACKEND    |           |
|   |               | <-------------------- |               |           |
|   +-------+-------+                       +-------+-------+           |
|           |   |                               ^       |               |
|           |   | Encrypted File + EK_User      |       | Check Perms   |
|           |   +-------------------------------+       |               |
|           |                                           v               |
|           | Encrypted File Upload             +---------------+       |
|           v                                   | SMART CONTRACT|       |
|   +---------------+                           | BLOCKCHAIN    |       |
|   | DATABASE /    |   READ / WRITE / NONE     +-------+-------+       |
|   | STORAGE       | <---------------------------------+               |
|   +---------------+                                   |               |
|                                                       |               |
|           ^                                           | Immutable Logs|
|           |      SHA-256 + Version Commit             v               |
|           +-------------------------------------------+               |
|                                                                       |
+-----------------------------------------------------------------------+

'''
