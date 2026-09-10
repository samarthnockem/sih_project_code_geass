# Secure Vault Repository Instructions

These instructions are permanent architecture, security, and coding rules for this repository. Read this file before making implementation changes.

## Project Context

Secure Vault is a hackathon project. Prefer clear, simple implementations that can be demonstrated reliably. Avoid unnecessary frameworks, broad rewrites, and over-engineered abstractions.

## Architecture

### Frontend

- Use React with Vite.
- Use Tailwind CSS for styling.
- Use MetaMask for wallet connection and signing.
- Use `ethers.js` for Web3 interactions.
- Perform file encryption and decryption client-side.
- Never send plaintext files, raw AES document keys, wallet private keys, or document encryption private keys to the backend.

### Backend

- Use Node.js with TypeScript.
- Use Express for HTTP APIs.
- Use MongoDB with Mongoose for persistence.
- Use Zod for validating external input.
- Use Helmet for security headers.
- Use `express-rate-limit` for rate limiting.
- Use Pino for structured logging.
- Use Vitest and Supertest for backend tests.
- Use `ethers.js` later only for blockchain reads and verification.
- Backend APIs coordinate authentication, validate requests, store encrypted files, store metadata, store wrapped keys, access the database, verify blockchain permissions, and return secure API responses.
- The backend must not perform file encryption, file decryption, AES key generation, public/private encryption-key operations, or MetaMask interactions.
- The backend must not receive, store, or log plaintext files, raw document AES keys, wallet private keys, users' document encryption private keys, seed phrases, plaintext file passwords, or password-derived secret keys.
- The database may store encrypted files, wrapped AES keys, user public encryption keys, wallet addresses, asset metadata, blockchain references, and SHA-256 hashes.
- Wallet authentication must verify user signatures against server-issued, single-use, expiring nonces.

### Blockchain

- Use Solidity smart contracts.
- Use Hardhat for development, testing, and deployment scripts.
- Use the local Hardhat network during development.
- Use Sepolia for the final demo.
- Smart contracts store ownership, hashes, permissions, and audit events.
- Encrypted files stay off-chain.
- Never place sensitive identity information on-chain.

### Web3

- Use MetaMask as the wallet provider.
- Use `ethers.js` for contract calls, wallet signatures, and provider interactions.

### Cryptography

- Use AES-256-GCM for asset encryption.
- Use SHA-256 for file fingerprinting.
- Each user has a separate public/private encryption key pair.
- Store wrapped AES keys per authorized user.
- Encryption and decryption happen client-side.
- Raw document AES keys must never be stored.

### Identity

- Use wallet authentication.
- Support verifiable credentials.
- Support trusted credential issuers.
- Use mock KYC initially for the hackathon implementation.
- Do not put sensitive identity details on-chain.

## Permanent Security Rules

- Never store plaintext files.
- Never store raw document AES keys.
- Never store wallet private keys.
- Never store seed phrases.
- Never store plaintext file passwords.
- Never store password-derived secret keys.
- Never log plaintext files, raw AES keys, document encryption private keys, wallet private keys, seed phrases, plaintext file passwords, or password-derived secret keys.
- Never send document encryption private keys to the backend.
- Never place sensitive identity information on-chain.
- Smart contracts store ownership, hashes, permissions, and audit events only.
- Encrypted files stay off-chain.
- Treat frontend clients as untrusted for authorization decisions.
- Enforce authorization in backend routes and smart contracts where applicable.
- Keep secrets, private keys, mnemonics, RPC credentials, and production environment files out of git.
- Validate every external input with explicit schemas.
- Reject unknown fields unless a route has a documented reason to accept them.
- Never directly pass `req.body` into database operations.
- Never pass user-controlled MongoDB filter or update objects directly into Mongoose.
- Use explicit allowed fields for create and update operations.
- Centralize error handling.
- Never expose production stack traces.
- Use request-size limits.
- Enforce upload size limits and accept only encrypted file payloads.
- Add rate limiting.
- Use Helmet security headers.
- Use strict configurable CORS.
- Normalize and validate wallet addresses before storing or comparing them.
- Store secrets only through environment variables.
- Never commit `.env`.
- Apply least-privilege principles to database access, API behavior, and operational secrets.
- Every asset-specific route must support authorization checks before production use.
- Blockchain is authoritative for ownership and `READ`/`WRITE`/`NONE` permissions.
- Backend must never sign blockchain actions on behalf of users.
- Backend should only read or verify blockchain state and transactions.
- Configure logs to redact authorization headers, cookies, signatures, nonces, request bodies, response bodies, and file payloads.

## Development Rules

- This is a hackathon project; optimize for a working, understandable demo.
- Prefer simple implementations.
- Do not introduce unnecessary frameworks.
- Do not add unnecessary dependencies.
- Make small changes.
- Do not modify unrelated files.
- Do not modify frontend or blockchain folders while working on backend-only tasks.
- Keep frontend, backend, blockchain, and docs responsibilities separate.
- Read relevant Markdown files before editing.
- Update Markdown files when architecture, setup, behavior, or security assumptions change.
- Run relevant tests after implementation when tests exist.
- Add tests for security-critical backend logic.
- Briefly summarize changed files after each implementation.

## Documentation Rules

- `README.md` explains project purpose, setup, run commands, and demo flow.
- `docs/` contains architecture, security notes, decisions, and setup details.
- Record important technical decisions before adding major dependencies or changing architecture.
- Keep documentation practical and current enough for hackathon teammates to follow.
