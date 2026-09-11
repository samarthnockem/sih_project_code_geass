# KryptoVault Final Integration Plan

This plan maps the final vanilla frontend in `frontend/` to the current backend in `backend/`.

Important project decisions:

- Preserve the existing vanilla HTML, CSS, and JavaScript frontend. Do not replace it with React.
- Preserve the current dark/light theme, page structure, modals, and visual design.
- Replace mock/localStorage behavior incrementally with real backend, blockchain, and client-side crypto behavior.
- MongoDB with Mongoose is the database stack.
- File encryption/decryption and AES key wrapping happen client-side.
- Backend never receives plaintext files, raw AES keys, encryption private keys, wallet private keys, seed phrases, or plaintext passwords.
- MetaMask signs authentication messages and blockchain-changing transactions.
- Blockchain is authoritative for ownership and `READ`/`WRITE`/`NONE` access.
- KYC remains a clearly labelled hackathon mock.
- Folder access control is not blockchain-based; folders are organizational only.

## Current Repository Summary

### Frontend

Files:

- `frontend/index (1).html`: final KryptoVault page structure, screens, and modals.
- `frontend/styles (1).css`: final KryptoVault visual design, dark/light theme, layout, cards, tables, modals, and responsive behavior.
- `frontend/app (1).js`: current UI behavior, demo/localStorage state, and integration boundaries.
- `frontend/api.js`: reusable backend API client.
- `frontend/crypto.js`: client-side document encryption identity helpers using Web Crypto RSA-OAEP/SHA-256 and IndexedDB.
- `frontend/README (1).txt`: concise guide for the final vanilla frontend and agreed MongoDB/GridFS/client-side crypto architecture.

Current frontend persistence:

- `localStorage` key: `kryptovault-demo-v1`
- Main state object: `user`, `settings`, `folders`, `documents`, `shared`, `activities`

### Backend

Existing HTTP routes:

- `GET /api/health`
- `GET /api/ready`
- `GET /api/auth/challenge`
- `POST /api/auth/verify`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PUT /api/users/me/encryption-key`
- `GET /api/users/:wallet/public-key`
- `POST /api/assets`
- `GET /api/assets/:assetId/open`

Existing models:

- `UserModel`: wallet address, public encryption key, display name, KYC status.
- `AssetModel`: owner wallet, filename, optional blockchain asset id, current version, SHA-256, status, password protection flag.
- `AssetVersionModel`: asset id, version, encrypted storage reference, strict AES-256-GCM encryption metadata, SHA-256, creator wallet, optional blockchain tx hash.
- `WrappedKeyModel`: asset id, user wallet, wrapped AES key, version, strict RSA-OAEP wrapping metadata, active flag.

Existing services/helpers:

- `storeEncryptedAsset()`, `getEncryptedAsset()`, `deleteEncryptedAsset()` using MongoDB GridFS.
- `createBlockchainReadService()` with read-only ethers provider/contract methods:
  - `getAssetOwner(assetId)`
  - `getPermission(assetId, wallet)`
  - `getCurrentHash(assetId)`
  - `getCurrentVersion(assetId)`
- `requireAssetOwner`, `requireAssetRead`, `requireAssetWrite` reusable authorization helpers.

No smart contract files exist yet in `blockchain/`.

## Feature Integration Matrix

| Frontend feature | Current frontend function/mock | Existing backend support | Missing backend support | Backend endpoint/model/service to use | Remain frontend-only? |
|---|---|---|---|---|---|
| App shell, sidebar navigation, page switching | `switchPage()`, HTML `data-page` buttons | Not needed | None | None | Yes. Pure UI state. |
| Dark/light theme toggle | `applyTheme()`, `themeToggle` listener, `state.settings.theme` | Not needed | Optional user preference persistence if desired | Future user settings route if needed | Yes for hackathon. Theme can remain local. |
| Toast notifications | `toast()` | Not needed | None | None | Yes. Pure UI. |
| Modal open/close behavior | `openModal()`, `closeModal()`, modal click handlers | Not needed | None | None | Yes. Pure UI. |
| Dashboard document count | `renderDashboard()`, `state.documents.length` | Partial: `AssetModel` exists | Authenticated list endpoint for owned assets | Future `GET /api/assets` using `AssetModel` and blockchain-aware metadata | No. Should use backend asset list. |
| Dashboard shared count | `renderDashboard()`, `state.shared.length` | Partial: blockchain read service can check permission for known asset ids | Endpoint to list assets shared with current wallet | Future `GET /api/assets/shared` using blockchain permission source plus `WrappedKeyModel`/asset metadata | No. Should use backend. |
| Dashboard blockchain verified count | `renderDashboard()`, `d.verified` | Partial: `getCurrentHash()` and `getCurrentVersion()` exist | Endpoint to compare backend asset versions with blockchain hashes for lists | Future `GET /api/assets` and/or `GET /api/assets/:assetId/verify` | No. Should be backend/blockchain-derived. |
| Dashboard storage used | `renderDashboard()`, sums `state.documents[].size` | Partial: GridFS stores encrypted byte length; `AssetVersion` has storage ref | Persist and expose encrypted byte sizes in asset metadata/list | Future `GET /api/assets` using `AssetModel`/`AssetVersionModel` and storage metadata | No, except UI formatting. |
| Recent documents table | `renderDashboard()`, `documentsTable()` | Partial: `AssetModel` exists | Owned asset listing endpoint with safe metadata | Future `GET /api/assets` | No. |
| Protection pipeline panel | Static HTML | Not needed | None | None | Yes. Explanatory UI. |
| Demo notes panel | Static HTML | Not needed | Text should be updated as integration progresses | None | Yes. |
| My Documents page | `renderDocuments()`, `documentsTable()` | Partial: `AssetModel` exists | Authenticated owned asset listing, pagination/search | Future `GET /api/assets?search=` | No. |
| Document search | `renderDocuments()` filters local state | None | Backend search/filter for owned assets | Future `GET /api/assets?search=` | No, but input state remains frontend-only. |
| Document row open | `window.openDocument()`, `renderDocumentModal()` | Existing secure open: `GET /api/assets/:assetId/open` | Frontend must map document id to blockchain asset id and decrypt client-side after response | `GET /api/assets/:assetId/open`, `getEncryptedAsset()`, `WrappedKeyModel`, `AssetVersionModel`, blockchain read service | No. |
| Document overview modal | `renderDocumentModal()` overview tab | Partial: open route returns encrypted file, wrapped key, metadata, permission, current version, expected SHA-256 | Safe metadata detail endpoint that does not return file/key unless opening | Future `GET /api/assets/:assetId` | No. |
| Document access tab | `renderDocumentModal()` access tab reads `d.permissions` | Partial: `WrappedKeyModel`; blockchain read service; authorization helpers | Endpoint to list current permission state from blockchain and associated wrapped-key recipients | Future `GET /api/assets/:assetId/access` plus blockchain reads | No. |
| Document activity tab | `renderDocumentModal()` filters local `state.activities` | None | Audit log model and endpoints | Future `ActivityLogModel`, `GET /api/activity`, `GET /api/assets/:assetId/activity` | No. |
| Document blockchain tab | `renderDocumentModal()` uses mock `txHash`, `blockNumber`, `hash` | Partial: blockchain read service can read owner, permission, hash, version | Contract deployment and endpoint exposing safe blockchain record | Future `GET /api/assets/:assetId/blockchain`; blockchain contract | No. |
| Verify integrity | `window.verifyIntegrity()` checks mock `d.tampered` | Partial: `getCurrentHash()` exists; open route returns `expectedSha256` | Backend verification endpoint and frontend client-side decrypted-file hash comparison | Future `POST /api/assets/:assetId/verify` or client compares decrypted SHA-256 with `expectedSha256` from `GET /open` | Mostly no. Hash calculation remains client-side; authoritative hash comes from backend/blockchain. |
| Simulate tampering | `window.simulateTamper()` toggles `d.tampered` | Not needed | None for demo | None | Yes. Must remain labelled as demo-only. |
| Upload modal and drag/drop file selection | DOM handlers for `uploadFile`, `dropZone`, `selectedUploadFile` | Upload endpoint exists | Frontend must perform real AES-256-GCM encryption and key wrapping before upload | `POST /api/assets`; client Web Crypto APIs | File selection UI yes; upload persistence no. |
| SHA-256 hashing | `sha256File(file)` uses `crypto.subtle.digest` | Backend stores SHA-256 in `AssetModel`/`AssetVersionModel`; blockchain read returns current hash | Need blockchain write/registration flow after or before backend upload | `POST /api/assets`; future smart contract write from MetaMask; `AssetVersionModel.sha256` | Hash computation remains client-side. |
| Mock AES encryption upload step | `startSecureUpload()` progress step only | Backend accepts only encrypted bytes and AES-256-GCM metadata | Real client-side encryption using Web Crypto AES-GCM, upload encrypted blob only | `POST /api/assets`; `storeEncryptedAsset()` | No. Crypto operation must be real frontend-only, persistence backend. |
| Document encryption identity | `frontend/crypto.js`, `window.KryptoVaultCrypto` | Existing: `PUT /api/users/me/encryption-key`, `GET /api/users/:wallet/public-key`, `UserModel.publicEncryptionKey` | Upload/open flows still need to call wrapping helpers for real encrypted assets | `PUT /api/users/me/encryption-key`, `GET /api/users/:wallet/public-key` | Private key generation/storage and key wrapping remain frontend-only. Public key storage uses backend. |
| Mock owner key wrapping | `frontend/crypto.js` provides real RSA-OAEP wrapping helpers, but upload still uses mock flow | Backend requires `wrappedAESKey` plus RSA-OAEP wrapping metadata | Wire upload to generate AES key, encrypt bytes, wrap owner key, and POST encrypted payload | `PUT /api/users/me/encryption-key`, `GET /api/users/:wallet/public-key`, `POST /api/assets` | Key generation/wrapping remains frontend-only; public key and wrapped key storage use backend. |
| Optional file password field | Upload modal `uploadPassword`, reset in `resetUploadModal()` | Backend intentionally rejects plaintext passwords and password-derived secret keys | If retained, derive key client-side and never send password/derived secret to backend; backend may only store non-secret flag | `POST /api/assets` `passwordProtectionEnabled` only | Password entry and derivation must remain frontend-only. Backend receives only boolean metadata. |
| Upload access private/team selector | `uploadAccess`, saved as `accessType` | No team concept; blockchain permission model is wallet-based | Decide whether to keep as visual/demo metadata or implement team mapping off-chain | Future asset metadata field if needed; no blockchain folder/team ACL unless explicit wallet grants | Maybe. Current selector can remain frontend-only until real sharing workflow. |
| Upload folder selector | `populateFolderSelect()`, `uploadFolder` | No folder backend support yet | Folder model and endpoints | Future `FolderModel`, `GET/POST /api/folders`, asset folder metadata update | No for persistence; folder ACL remains frontend-only/organizational. |
| Upload success hash display | `startSecureUpload()`, `successHash` | Backend stores SHA-256; blockchain read service returns current hash | Frontend should display hash returned from upload/chain registration | `POST /api/assets`; future contract tx result | UI yes; data no. |
| Shared With Me screen | `renderShared()`, `state.shared` seed data | Partial: `GET /api/assets/:assetId/open` supports authorized open if asset id known | Endpoint to list assets where current wallet has READ/WRITE and wrapped key | Future `GET /api/assets/shared`; blockchain permission reads; `WrappedKeyModel` | No. |
| Shared document open simulation | `window.simulateSharedOpen()` | Existing `GET /api/assets/:assetId/open` | Frontend must call open endpoint, unwrap AES key client-side, decrypt client-side, verify hash | `GET /api/assets/:assetId/open`; client Web Crypto unwrap/decrypt | No. Decryption remains frontend-only. |
| Folders page | `renderFolders()`, `window.openFolder()` | None | Folder persistence endpoints and Mongoose model | Future `FolderModel`, `GET /api/folders`, `POST /api/folders` | No for data; yes for UI state. Folder permissions remain organizational only. |
| Create folder modal | `createFolder()` | None | Folder create endpoint, name validation, owner wallet from session | Future `POST /api/folders` | No. |
| Open folder modal | `window.openFolder()` | None | Folder detail/list endpoint scoped to owner | Future `GET /api/folders/:folderId` or client filters result from `GET /api/assets` | No. |
| Move document between folders | `window.moveDocument()`, `confirmMoveDocument()` | None | Asset folder update endpoint; folder ownership checks; not blockchain-based | Future `PATCH /api/assets/:assetId/folder` | No. |
| Activity page | `renderActivity()`, `addActivity()`, `clearActivityBtn` | Pino logs exist but not user-facing audit model | Activity/audit log model and list endpoint | Future `ActivityLogModel`, `GET /api/activity` | No for real audit; UI-only clear button may remain demo-only. |
| Blockchain Records page | `renderBlockchain()`, mock document fields `txHash`, `blockNumber`, `hash` | Partial: blockchain read service; `AssetVersionModel.blockchainTransactionHash` | Smart contract, write tx capture, block number persistence/query | Future `GET /api/assets/:assetId/blockchain`, `AssetVersionModel`, blockchain contract | No. |
| Account profile display/edit | `renderAccount()`, save profile button updates `state.user.name/email` | Partial: `UserModel` has `displayName`; no email field | Profile endpoints and user schema decision for email; avoid plaintext passwords | Future `GET /api/auth/me`, `PATCH /api/users/me` | No if profile must persist across devices. |
| Wallet display | `renderHeader()`, `renderAccount()` | Existing auth session returns wallet with `GET /api/auth/me` | Frontend must replace local wallet state after server auth | `GET /api/auth/me` | No. |
| MetaMask connection | `connectWallet()` uses `eth_requestAccounts`; demo fallback if absent | Backend auth challenge/verify exists | Frontend must request challenge, sign message, verify signature, store cookie session | `GET /api/auth/challenge`, `POST /api/auth/verify`, MetaMask `personal_sign`/ethers signer | Wallet interaction remains frontend-only; session verification uses backend. |
| Demo wallet fallback | `connectWallet()` `randomHex(20)` fallback | Backend requires real signed wallet auth | For final integrated flows, fallback must not authenticate to backend | None | Yes only for clearly labelled UI demo mode, not real API calls. |
| KYC mock | `verifyKyc()`, `kycFile`, `kycType`, `state.user.kycStatus` | Existing: `GET /api/kyc/status`, `POST /api/kyc/mock-verify`, `UserModel.kycStatus`, `verificationMethod`, `verifiedAt` | Frontend integration to call mock KYC route; no production KYC provider yet | `GET /api/kyc/status`, `POST /api/kyc/mock-verify` | No for status persistence; uploaded KYC document should remain demo-only and must not be sent to backend. |
| KYC status pill | `renderHeader()` | Partial: `UserModel.kycStatus`, `GET /api/auth/me` lacks KYC fields | Return safe user profile/status | Future `GET /api/users/me` | No. |
| Security Health score | `calculateSecurityScore()`, `renderSecurity()` | Partial: auth, KYC status model, asset metadata, blockchain read | Endpoint(s) for real counts/status if score should be authoritative | Future `GET /api/users/me`, `GET /api/assets`, `GET /api/assets/shared` | Mostly frontend-only scoring formula; inputs should come from backend. |
| Live Security Status panel | `renderSecurity()` | Partial backend support for auth, KYC model field, assets, blockchain reads | Aggregated status endpoint optional | Future `GET /api/users/me`, `GET /api/assets`, `GET /api/ready` | Mostly frontend-only presentation. |
| Security policy toggles | `renderSettings()`, change handlers for `requireKyc`, `requireWallet`, `showProgress` | No backend policy enforcement for KYC-before-sharing yet | If made real, backend must enforce server-side KYC requirement before grant/share | Future policy settings endpoint plus grant access endpoint | For hackathon, can remain frontend-only demo policy until backend sharing exists. |
| Security architecture panel | Static HTML | Not needed | None | None | Yes. Explanatory UI. |
| Grant access modal | `window.openShare()`, `grantAccess()` | Partial: `WrappedKeyModel`, public key endpoint, blockchain read-only service | Blockchain write flow, access grant endpoint/storage for recipient wrapped key, permission mapping | Future `POST /api/assets/:assetId/access`; `GET /api/users/:wallet/public-key`; `WrappedKeyModel`; MetaMask contract tx | No. UI remains, behavior must be real. |
| Share policy: require KYC before sharing | `window.openShare()` checks `state.settings.requireKyc` and `state.user.kycStatus` | Partial: `UserModel.kycStatus` | Backend enforcement before recording/wrapping/granting access | Future grant access endpoint checks KYC if policy enabled | No if policy is security-relevant. |
| Share policy: require wallet before blockchain actions | `window.openShare()` checks `state.user.walletAddress` | Existing auth requires wallet signature | Frontend must require authenticated backend session, not only local wallet string | `GET /api/auth/me`; future grant access endpoint | No. |
| Permission roles VIEW/DOWNLOAD/EDIT | `shareRole`, `grantAccess()` stores role | Backend/blockchain permission enum is `NONE`/`READ`/`WRITE` | Map UI roles to blockchain permissions: `VIEW` and `DOWNLOAD` likely `READ`; `EDIT` likely `WRITE`. Download is not distinct on-chain unless contract expands. | Future grant access endpoint and smart contract | No. |
| Access expiry | `shareDuration`, `grantAccess()` `expiresAt` | No expiry model/contract support | Decide off-chain expiry enforcement or contract expiry; backend must deny expired access even if using off-chain expiry | Future permission metadata model/contract extension | No if real sharing needs expiry. |
| Share recipient name/email | `shareName`, `shareRecipient` | User public key lookup is by wallet only | Recipient resolution by wallet, optional non-sensitive contact metadata | `GET /api/users/:wallet/public-key`; future user/profile model | Mostly backend if persisted; email should not go on-chain. |
| Revoke access modal | `window.openRevoke()`, `confirmRevoke()` | Partial: `WrappedKeyModel.active`; blockchain read-only service | Blockchain write revoke flow; backend endpoint to deactivate wrapped key after confirmed tx | Future `DELETE /api/assets/:assetId/access/:wallet` or `POST /api/assets/:assetId/revoke`; smart contract | No. |
| Strong revocation/key rotation simulation | `confirmRevoke()` when mode is `strong` | Partial: `AssetVersionModel` supports versions; `WrappedKeyModel` versioned keys; storage service supports storing new encrypted bytes | Client-side re-encryption, new AES key generation/wrapping, new version upload, blockchain version/hash update | Future `POST /api/assets/:assetId/versions`; `AssetVersionModel`; `WrappedKeyModel`; storage service | Crypto remains frontend-only; persistence/backend verification needed. |
| Clear demo activity logs | `clearActivityBtn` handler | No user-facing activity logs yet | Future audit log clear should probably not exist for immutable/security audit; demo-only clear can remain local | None for production audit | Yes as demo-only setting, not real audit. |
| Restore demo data | `seedDemoBtn` handler | Not needed | None | None | Yes. Demo-only. |
| Reset entire workspace | `resetAllBtn` handler | Not needed for real backend | Real account data deletion would need a separate destructive endpoint and confirmations; not currently required | None now | Yes as demo-only/local reset. |
| Escaped UI rendering | `escapeHtml()` | Not needed | Continue using for client-rendered data from backend | None | Yes. UI safety helper. |
| File size formatting | `fmtSize()` | Backend can return byte lengths | None | Use backend byte lengths from future list/detail/open endpoints | Yes. UI formatting. |
| Date formatting | `fmtDate()` | Backend returns ISO timestamps in some responses | List/detail endpoints should return timestamps consistently | `AssetModel` timestamps; future folder/activity models | Yes. UI formatting. |
| Short hash/wallet display | `shortHash()` | Backend returns wallet/hash values | None | All relevant endpoints | Yes. UI formatting. |

## Backend Support Already Present

Use these existing pieces instead of creating duplicates:

- Wallet authentication:
  - `GET /api/auth/challenge`
  - `POST /api/auth/verify`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Public encryption key storage/lookup:
  - `PUT /api/users/me/encryption-key`
  - `GET /api/users/:wallet/public-key`
  - `UserModel.publicEncryptionKey`
- Initial encrypted upload:
  - `POST /api/assets`
  - `AssetModel`
  - `AssetVersionModel`
  - `WrappedKeyModel`
  - `storeEncryptedAsset()`
- Authorized encrypted open:
  - `GET /api/assets/:assetId/open`
  - `getEncryptedAsset()`
  - `WrappedKeyModel` lookup scoped to authenticated wallet
  - blockchain `getPermission()`, `getCurrentVersion()`, `getCurrentHash()`
- Blockchain read-only verification:
  - `createBlockchainReadService()`
  - `requireAssetOwner`
  - `requireAssetRead`
  - `requireAssetWrite`
- Security middleware:
  - Helmet
  - strict configured CORS
  - JSON size limit
  - upload size limit
  - rate limits
  - centralized error handling
  - Pino redaction

## Missing Backend Work By Priority

### Required To Replace Mock Upload

1. Frontend client-side crypto module:
   - Generate AES-256-GCM key.
   - Encrypt selected file client-side.
   - Calculate SHA-256 for expected integrity model.
   - Wrap AES key for owner using owner public encryption key.
   - Send only encrypted bytes, SHA-256, wrapped owner key, encryption metadata, and wrapping metadata.

2. Backend or frontend blockchain registration flow:
   - MetaMask must sign blockchain-changing transactions.
   - Backend must not sign transactions.
   - Need smart contract and frontend contract-write calls or a backend-prepared unsigned transaction pattern.
   - Backend `POST /api/assets` currently creates Mongo asset metadata but does not bind a `blockchainAssetId`.

3. Asset listing/detail endpoints:
   - `GET /api/assets`
   - `GET /api/assets/:assetId`
   - Must return safe metadata only.
   - Must not return encrypted bytes or wrapped keys except through `GET /api/assets/:assetId/open`.

### Required To Replace Mock Sharing

1. Access grant endpoint:
   - `POST /api/assets/:assetId/access`
   - Must require owner or write permission according to product rules.
   - Must use blockchain as authoritative permission record.
   - Must store only recipient wrapped AES key, never raw AES key.
   - Must not perform key wrapping server-side.

2. Access revoke endpoint:
   - `DELETE /api/assets/:assetId/access/:wallet` or equivalent.
   - Must require blockchain owner/write authority.
   - Must coordinate with MetaMask-signed revoke transaction.
   - Strong revocation requires client-side re-encryption and new wrapped keys for remaining users.

3. Access list endpoint:
   - `GET /api/assets/:assetId/access`
   - Must not expose wrapped AES key values.
   - Should return recipients/permissions/status only.

### Required To Replace Mock Shared With Me

1. Shared asset listing:
   - `GET /api/assets/shared`
   - Must list only assets where blockchain returns `READ` or `WRITE` for authenticated wallet.
   - Must not include other users' wrapped keys.

### Required To Replace Mock Folders

1. Folder model and endpoints:
   - `FolderModel`
   - `GET /api/folders`
   - `POST /api/folders`
   - `PATCH /api/assets/:assetId/folder`
   - Optional `DELETE /api/folders/:folderId`

Folders are organizational only. Do not put folder access control on-chain unless the architecture changes.

### Required To Replace Mock KYC

1. Frontend KYC integration:
   - Call `GET /api/kyc/status`.
   - Call demo-only `POST /api/kyc/mock-verify`.
   - Store only non-sensitive status metadata.
   - Do not upload/store identity document contents or identity document numbers unless a separate secure design is approved.

### Required To Replace Mock Activity/Blockchain Screens

1. User-facing audit/activity model:
   - `ActivityLogModel`
   - `GET /api/activity`
   - `GET /api/assets/:assetId/activity`

2. Blockchain record endpoint:
   - `GET /api/assets/:assetId/blockchain`
   - Uses read-only blockchain service plus stored transaction metadata.

## Frontend-Only Features To Preserve

These should stay in the vanilla frontend:

- Existing visual design, dark/light theme, responsive CSS, modals, tabs, sidebar, and page switching.
- Toasts and transient UI progress states.
- File picker and drag/drop interactions.
- Client-side SHA-256 calculation.
- Client-side AES encryption/decryption.
- Client-side AES key generation.
- Client-side public-key wrapping/unwrapping operations.
- Client-side document encryption private key storage in IndexedDB.
- MetaMask account connection and signing.
- Display formatting helpers: dates, sizes, short hashes/wallets.
- Demo-only tampering simulation.
- Demo-only restore/reset controls, as long as they affect only local demo state.

## Integration Notes

- The frontend currently uses document ids like `doc-1001`. The backend open route uses `:assetId` as the blockchain asset id. The integrated frontend must track both Mongo asset ids and blockchain asset ids clearly.
- The backend `POST /api/assets` currently returns a Mongo asset id but does not assign `blockchainAssetId`. Before real open/list flows work end-to-end, upload must be connected to a MetaMask-signed smart contract registration that yields or confirms the blockchain asset id.
- The frontend role names need a deliberate mapping:
  - `VIEW` -> `READ`
  - `DOWNLOAD` -> `READ` unless download is made a distinct permission later
  - `EDIT` -> `WRITE`
- Backend authorization must continue to use blockchain state, not localStorage, frontend policy toggles, or MongoDB permission-like fields.
- The frontend README now reflects MongoDB + Mongoose, GridFS encrypted-byte storage, client-side crypto, MetaMask-signed blockchain writes, READ/WRITE/NONE permissions, and prototype-only mock KYC.
