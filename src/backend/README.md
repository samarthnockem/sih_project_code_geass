# Secure Vault Backend

Minimal Node.js, TypeScript, and Express backend for the Secure Vault SIH hackathon demo.

## Stack

- Node.js
- TypeScript
- Express
- `ethers.js`
- MongoDB with Mongoose
- Zod
- Helmet
- `express-rate-limit`
- Pino
- Vitest and Supertest

## Commands

```bash
npm install
npm run dev
npm run build
npm test
```

Copy `.env.example` to `.env` for local development. Do not commit `.env`.

`MONGODB_URI` must be set in the environment before the server starts.

## Routes

- `GET /api/health` returns basic service health.
- `GET /api/ready` returns whether the backend is connected to MongoDB.
- `GET /api/auth/challenge` returns a MetaMask-compatible message and nonce to sign.
- `POST /api/auth/verify` verifies the signature and creates a server-side session.
- `POST /api/auth/logout` clears the current session.
- `GET /api/auth/me` returns the authenticated wallet for the current session.
- `GET /api/assets` lists active asset metadata owned by the authenticated wallet, optionally filtered by `folderId`.
- `GET /api/assets/my` returns safe frontend asset metadata for the authenticated wallet, optionally filtered by `search` and `folderId`.
- `POST /api/assets` accepts an authenticated multipart upload containing encrypted file bytes plus safe metadata, then creates asset metadata, an encrypted storage reference, and the owner's wrapped key.
- `POST /api/assets/:assetId/access/grant-sync` verifies a user-signed `grantAccess` transaction and stores non-authoritative access metadata plus the grantee wrapped key.
- `GET /api/assets/:assetId/open` returns encrypted asset bytes and only the authenticated wallet's wrapped key after blockchain permission verification.
- `PATCH /api/assets/:assetId/folder` moves an owned asset to an owned folder or to Unfiled with `folderId: null`, and records an asset audit event.
- `GET /api/folders` lists organizational folders owned by the authenticated wallet.
- `POST /api/folders` creates an organizational folder owned by the authenticated wallet.
- `GET /api/folders/:folderId` returns only an owned organizational folder.
- `DELETE /api/folders/:folderId` deletes only an owned empty folder.
- `GET /api/users/me` returns the authenticated user's safe profile using the verified session wallet.
- `PATCH /api/users/me` updates only `displayName` and `email` for the authenticated session wallet.
- `PUT /api/users/me/encryption-key` stores the authenticated user's public encryption key.
- `GET /api/users/:wallet/public-key` returns a user's public encryption key.
- `GET /api/kyc/status` returns safe mock KYC metadata for the authenticated session wallet.
- `POST /api/kyc/mock-verify` is demo-only mock KYC. It stores status metadata only and does not accept identity documents or identity numbers.

## Current Scope

This backend currently includes the Express app, server startup, MongoDB connection lifecycle, readiness checks, security headers, strict CORS, JSON parsing with a configurable size limit, request IDs, Pino logging, centralized 404/error handling, environment validation, graceful shutdown, wallet authentication, safe user profile metadata, public encryption key metadata, encrypted asset upload/open flows, GridFS encrypted-byte storage, read-only blockchain verification, and tests.

API rate limits are configurable with `RATE_LIMIT_*` environment variables. Stricter authentication and sensitive-action limiters are available for future routes.

Wallet authentication uses a MetaMask-compatible challenge/signature flow. The backend never asks for or receives wallet private keys, seed phrases, plaintext passwords, raw AES keys, plaintext files, identity document contents, identity document numbers, or private document encryption keys.

Mock KYC is prototype-only. It stores only the authenticated `walletAddress`, `kycStatus` (`PENDING`, `VERIFIED`, or `REJECTED`), `verificationMethod: "MOCK"`, and `verifiedAt` when applicable.

Encrypted asset storage stores opaque encrypted bytes in MongoDB GridFS using server-generated storage identifiers, keeps original filenames only as metadata, enforces `ENCRYPTED_ASSET_MAX_BYTES`, and never decrypts or parses file contents. `POST /api/assets` requires authentication and accepts the encrypted file in multipart field `encryptedFile`; uploads must use `application/octet-stream`, declared `AES-256-GCM` encryption metadata, and either owner `RSA-OAEP` wrapping metadata or password-derived wrapping metadata. Raw AES keys, plaintext file fields, file passwords, private keys, seed phrases, mnemonic/passphrase aliases, and owner wallet overrides are rejected.

The encrypted upload contract accepts only safe fields: `filename`, `mimeType`, `originalSize`, `sha256`, `wrappedAESKey`, `encryptionMetadata`, `wrappingMetadata`, optional `folderId`, optional `passwordProtectionEnabled`, and multipart file field `encryptedFile` containing ciphertext. `ownerWallet` always comes from the authenticated session. Upload creates asset metadata with status `PENDING_BLOCKCHAIN`, asset version `1`, GridFS ciphertext storage, one owner key-protection record, and an `ASSET_UPLOADED` activity event. The frontend then signs `registerAsset` with MetaMask, waits for confirmation, and calls `POST /api/assets/:assetId/blockchain-sync` with the transaction hash. The backend verifies the transaction and `AssetRegistered` event before storing `blockchainAssetId`, transaction hash, block number, status `ACTIVE`, and blockchain verification status `verified`.

Password-protected uploads use client-side PBKDF2-SHA-256 plus AES-256-GCM to wrap the document AES key. The backend stores only the password-wrapped AES key, salt, KDF algorithm and iteration count, wrapping IV, and `passwordProtectionEnabled`; it never receives the password or derived key. Password-protected uploads do not store a second owner public-key wrapping that would bypass the password requirement.

Blockchain reads are available through a backend service abstraction configured by `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS`, and `CHAIN_ID`. The service creates a read-only ethers provider/contract, never creates a signing wallet, never signs transactions, and fails closed when ownership, permission, hash, or version verification cannot be completed. Blockchain-changing actions must be signed by the user with MetaMask.

Access grant sync is metadata-only. The frontend signs `grantAccess` with MetaMask, wraps the document AES key for the grantee locally, and then sends the transaction hash plus wrapped grantee key to `POST /api/assets/:assetId/access/grant-sync`. The backend verifies the on-chain owner and `AccessGranted` event before storing `AccessGrant`, `WrappedKey`, and an activity event. `AccessGrant` is not authoritative for access decisions; blockchain permissions remain authoritative.

Reusable asset authorization helpers enforce owner, read, and write checks from blockchain state only. MongoDB permission fields are not trusted for authorization decisions.

Folders are organizational metadata only, not blockchain permission containers. Folder routes always scope database lookups by the authenticated wallet so a folder ID cannot access another user's folder. Deleting a folder does not delete blockchain assets or encrypted asset bytes; the backend rejects deletion with `FOLDER_NOT_EMPTY` while owned assets still reference the folder. Move assets to Unfiled before deleting the folder.

Broader asset business logic is intentionally not implemented yet.
