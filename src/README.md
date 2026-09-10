# KryptoVault

KryptoVault is a secure document access prototype for the SIH hackathon.

The final frontend lives in `frontend/` and is vanilla HTML, CSS, and
JavaScript. Preserve its current visual design, dark/light theme, pages, and
modals.

## Architecture

- Frontend: client-side Web Crypto file encryption/decryption, AES key
  generation, AES key wrapping, SHA-256 hashing, and MetaMask signing.
- Backend: Node.js, TypeScript, Express, MongoDB, Mongoose, Zod, Helmet,
  express-rate-limit, Pino, Vitest, and Supertest.
- Storage: encrypted file bytes are stored off-chain in MongoDB GridFS
  initially.
- Blockchain: authoritative ownership, hashes, READ/WRITE/NONE permissions,
  and audit events.

## Local Development

Sepolia is the primary blockchain target for real-mode integration. Keep
MongoDB Atlas in `backend/.env`, set `ETHEREUM_RPC_URL`,
`CONTRACT_ADDRESS`, and `EXPECTED_CHAIN_ID=11155111` for backend blockchain
verification, and set the matching frontend contract address in
`frontend/blockchain-config.js`.

Use the Windows Sepolia launcher after a PC restart:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-kryptovault.ps1
```

The launcher verifies `frontend/`, `backend/`, and `blockchain/`, checks
`backend/.env`, verifies the configured Sepolia RPC returns chain ID
`11155111`, verifies deployed bytecode exists at `CONTRACT_ADDRESS`, restarts
the KryptoVault backend on `http://localhost:4000` so the current environment
is loaded, waits for `http://localhost:4000/api/health` and Atlas-backed
readiness at `http://localhost:4000/api/ready`, and starts or reuses the
frontend on `http://localhost:8000`.

You can also run the same workflow through npm from the repository root:

```bash
npm run dev:all
```

Manual backend startup:

```bash
cd backend
npm install
npm run dev
```

Manual frontend startup:

```bash
cd frontend
npm run dev
```

Open `http://localhost:8000`.

Expected backend checks:

- `http://localhost:4000/api/health`
- `http://localhost:4000/api/ready`

For Sepolia integration, keep `backend/.env` set to `PORT=4000`,
`CORS_ORIGIN=http://localhost:8000`, the existing MongoDB Atlas `MONGODB_URI`,
`ETHEREUM_RPC_URL`, `CONTRACT_ADDRESS`, and `EXPECTED_CHAIN_ID=11155111`.

## Security Rules

- Plaintext files never reach the backend.
- Raw AES document keys never reach the backend.
- Private encryption keys remain client-side.
- Wallet private keys, seed phrases, plaintext passwords, and password-derived
  secrets never reach the backend.
- Backend blockchain access is read-only unless an endpoint is explicitly
  designed around user-signed MetaMask transactions. The backend does not create
  signing wallets or sign blockchain-changing actions.
- KYC remains a clearly labelled prototype-only mock.
- Folders are organizational only and are not blockchain-based access control.

## Docs

- Backend details: `backend/README.md`
- Frontend guide: `frontend/README.md`
- Local blockchain demo: `blockchain/README.md`
- Integration plan: `docs/FINAL_INTEGRATION_PLAN.md`
