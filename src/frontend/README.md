KRYPTOVAULT - FRONTEND GUIDE
============================

This folder contains the final KryptoVault frontend for the hackathon demo.

Do not replace this UI with React and do not redesign it. The frontend is
vanilla HTML, CSS, and JavaScript:

1. index.html - screens, buttons, forms, and modals
2. styles.css - visual design, dark/light theme, responsive layout
3. api.js - small backend API client
4. crypto.js - client-side document encryption identity helpers
5. blockchain-config.js - blockchain config pointer
6. blockchain.js - MetaMask + ethers.js contract transaction helpers
7. app.js - current UI behavior and backend integration
8. KryptoVaultAccess.abi.json - deployable static contract ABI
9. README.md - this guide
10. server.js - local static development server
11. package.json - frontend npm scripts

HOW TO RUN THE FRONTEND DEMO
----------------------------
Start the local frontend server from this folder:

npm run dev

Then open:

http://localhost:8000

When the frontend is served locally, the API client uses:

http://localhost:4000

When deployed, it uses the production backend:

https://blockchain-project-sih.onrender.com

The `window.KRYPTO_API_BASE_URL` runtime override can still be used when a
different backend endpoint is required.

For Sepolia real mode, set the deployed contract address in
`blockchain-config.js` using:

CONTRACT_ADDRESS=<deployed Sepolia contract address>
EXPECTED_CHAIN_ID=11155111

The deployed and local frontend both load the contract ABI from:

http://localhost:8000/KryptoVaultAccess.abi.json

Keep it synchronized from the Hardhat artifact by running this after compiling
the contract:

npm run export:abi

from the `blockchain/` folder. This copies the generated ABI into the frontend
static root; Hardhat is not required at frontend runtime.

Hardhat Local remains available only as an optional development fallback. Run
`npm run deploy:local` in `blockchain/` after starting the Hardhat node if you
choose that fallback.

FINAL AGREED ARCHITECTURE
-------------------------
USER
  |
  v
FRONTEND
  |  - Web Crypto encrypts/decrypts files client-side
  |  - Web Crypto generates and wraps document AES keys client-side
  |  - MetaMask signs authentication and blockchain-changing actions
  v
BACKEND API
  |  - Express + TypeScript
  |  - MongoDB + Mongoose metadata
  |  - MongoDB GridFS encrypted-byte storage initially
  |  - read-only blockchain verification
  v
SMART CONTRACT
  - ownership
  - hashes
  - READ/WRITE/NONE permissions
  - access and audit events

SECURITY MODEL
--------------
- Plaintext files never reach the backend.
- Raw AES document keys never reach the backend.
- Private encryption keys remain client-side.
- Wallet private keys and seed phrases never reach the backend.
- Plaintext file passwords never reach the backend.
- The backend stores encrypted bytes only, treated as opaque data.
- Encrypted files are stored off-chain, using GridFS initially.
- The blockchain stores ownership, hashes, permissions, and events only.
- The backend reads blockchain state but does not sign blockchain transactions.
- Users sign blockchain-changing actions with MetaMask.
- Blockchain is authoritative for asset ownership and READ/WRITE/NONE access.

WHAT IS ACTUALLY WORKING IN THE FRONTEND DEMO
---------------------------------------------
- Sidebar navigation
- Dashboard statistics
- Upload modal
- Drag/drop file selection
- Real SHA-256 hashing with browser Web Crypto
- Document records saved in localStorage
- Document search
- Folder creation
- Clickable folder browser
- Move documents between folders
- Mock KYC flow
- Real MetaMask account connection if installed
- Clearly demo-only wallet fallback if MetaMask is unavailable
- Grant access UI
- Revoke access UI
- Standard and strong revocation demo states
- Activity/audit log screen
- Mock blockchain transaction hashes
- Mock block numbers
- Integrity verification demo
- Tampering simulation
- Shared With Me screen
- Settings and reset controls
- Live Security status panel and Security Health score
- Dark/light theme

DEMO-ONLY FRONTEND FEATURES
---------------------------
These are useful for presenting the hackathon prototype but are not authoritative
security behavior:

- localStorage document, folder, sharing, and activity data
- generated demo wallet fallback
- mock blockchain transaction hashes and block numbers
- mock KYC verification
- tampering simulation
- local activity log clearing
- restore demo data
- reset workspace
- frontend-only policy toggles until enforced by backend routes
- folder organization and folder movement

Folders are organizational only. Folder access control is not blockchain-based.

HOW UPLOAD SHOULD WORK AFTER INTEGRATION
----------------------------------------
Current function:
startEncryptedUpload()

Final flow:
1. Read the selected file in the browser.
2. Calculate SHA-256 in the browser.
3. Generate a random AES-256-GCM document key in the browser.
4. Encrypt the file in the browser.
5. Wrap the AES key for the owner in the browser.
6. Send only encrypted bytes, filename metadata, SHA-256, wrapped owner key,
   encryption metadata, and optional passwordProtectionEnabled metadata to:

POST /api/assets

7. Receive the application asset ID with status PENDING_BLOCKCHAIN.
8. Use MetaMask to call registerAsset with the deterministic on-chain
   reference to that asset ID and the SHA-256 hash.
9. Wait for transaction confirmation.
10. Send the transaction hash to:

POST /api/assets/:assetId/blockchain-sync

11. The backend verifies the transaction and AssetRegistered event before
    marking the asset ACTIVE and verified.

The backend must never receive plaintext file bytes, raw AES keys, private
encryption keys, wallet private keys, seed phrases, or plaintext passwords.

DOCUMENT ENCRYPTION IDENTITY
----------------------------
Current module:
crypto.js

The document encryption key pair is separate from MetaMask. MetaMask proves
wallet identity and signs blockchain actions; it is not used for file
encryption or key wrapping.

Hackathon implementation:
- Generate an RSA-OAEP key pair with SHA-256 using browser Web Crypto.
- Store the private CryptoKey in IndexedDB, scoped by wallet address.
- Generate the private key as non-extractable when browser support allows.
- Export only the public key.
- Upload the public key to PUT /api/users/me/encryption-key after wallet
  authentication.
- Retrieve other users' public keys through GET /api/users/:wallet/public-key.
- Wrap small AES-256 document keys with RSA-OAEP.

OPTIONAL FILE PASSWORD
----------------------
When the optional file password field is empty, the document AES key is wrapped
for the owner with the owner's document encryption public key.

When a password is provided, the browser derives a key-encryption key with
PBKDF2-SHA-256 using a random salt and a high iteration count, then encrypts the
document AES key with AES-256-GCM. The backend receives only
passwordProtectionEnabled, the salt, KDF algorithm and iteration count, wrapping
IV, password-wrapped AES key, ciphertext, and safe metadata.

The password and derived key never leave the browser. No second owner public-key
wrapping is stored for password-protected assets, so the owner must provide the
password later to recover the document AES key for opening or sharing.

Hackathon limitation: there is no password recovery, password change, strength
meter, or audited backup design yet. Losing the password means losing access to
that asset's AES key unless a future recovery design is added.

Prototype limitation:
If the browser profile is cleared, IndexedDB is deleted, or the device is lost,
the private document encryption key may be unrecoverable. Production recovery
needs a reviewed backup/recovery design before real user data is stored.

HOW WALLET AUTHENTICATION WORKS AFTER INTEGRATION
-------------------------------------------------
Current function:
connectWallet()

Real-mode flow:
1. Request the MetaMask account.
2. Request GET /api/auth/challenge from the backend.
3. Ask MetaMask to sign the challenge with personal_sign.
4. Send the signed challenge to POST /api/auth/verify.
5. Let the backend create the authenticated session cookie.
6. Fetch GET /api/auth/me.
7. Render the wallet returned by the verified backend session.

The selected wallet address alone is not authentication. The fake wallet
fallback exists only when explicit demo mode is enabled. In real mode,
MetaMask and the backend challenge/signature flow are required.

HOW OPEN SHOULD WORK AFTER INTEGRATION
--------------------------------------
Use:

GET /api/assets/:assetId/open

The backend authenticates the user, checks blockchain permission, loads the
encrypted file, and returns only this wallet's wrapped key. The frontend unwraps
the AES key and decrypts the file client-side.

Permission model:
- NONE - no access
- READ - can open/read
- WRITE - can modify/share according to product rules

Existing UI labels should map to this model:
- VIEW -> READ
- DOWNLOAD -> READ
- EDIT -> WRITE

HOW SHARING SHOULD WORK AFTER INTEGRATION
-----------------------------------------
Current function:
grantAccess()

Final behavior:
- Find the recipient's public encryption key through the backend.
- Wrap the document AES key for that recipient in the browser.
- Have the user sign the blockchain permission change with MetaMask.
- Store only the recipient's wrapped AES key and safe metadata in MongoDB.
- Never send the raw AES key to the backend.

HOW REVOCATION SHOULD WORK AFTER INTEGRATION
--------------------------------------------
Current function:
confirmRevoke()

Standard revocation should update blockchain permission and deactivate the
recipient's wrapped key after the signed blockchain action is confirmed.

Strong revocation requires client-side re-encryption:
1. Generate a new AES key in the browser.
2. Re-encrypt the file in the browser.
3. Wrap the new AES key for remaining authorized users in the browser.
4. Store a new encrypted asset version off-chain.
5. Register the new hash/version through a MetaMask-signed blockchain action.

BACKEND AND STORAGE
-------------------
The backend stack is Node.js, TypeScript, Express, MongoDB, Mongoose, Zod,
Helmet, express-rate-limit, Pino, Vitest, and Supertest.

Use the existing backend APIs and models where possible:
- GET /api/auth/challenge
- POST /api/auth/verify
- POST /api/auth/logout
- GET /api/auth/me
- PUT /api/users/me/encryption-key
- GET /api/users/:wallet/public-key
- GET /api/folders
- POST /api/folders
- GET /api/assets
- GET /api/assets/my
- GET /api/assets/my?search=:search
- GET /api/assets/my?folderId=:folderId
- GET /api/assets?folderId=:folderId
- POST /api/assets
- PATCH /api/assets/:assetId/folder
- GET /api/assets/:assetId/open

MongoDB stores users, asset metadata, asset versions, and wrapped keys.
GridFS stores encrypted file bytes initially.

Do not introduce PostgreSQL or Prisma for this project.

KYC
---
KYC remains a clearly labelled prototype-only mock for the hackathon. Do not
send real identity documents or sensitive identity details to the backend unless
a separate secure KYC design is approved.

GOOD FUNCTIONS TO INSPECT FIRST
-------------------------------
- renderAll()
- renderDashboard()
- renderDocuments()
- startSecureUpload()
- connectWallet()
- grantAccess()
- confirmRevoke()
- renderDocumentModal()

PRESENTATION FLOW
-----------------
1. Open Dashboard.
2. Go to Account.
3. Run the mock KYC flow.
4. Connect MetaMask or use the labelled demo wallet fallback.
5. Upload a document in demo mode.
6. Show SHA-256.
7. Open the document modal.
8. Share it with another user in demo mode.
9. Show the permission record.
10. Revoke access.
11. Show the activity log.
12. Simulate tampering.
13. Click Verify Integrity.
14. Explain that the integrated product stores encrypted files off-chain and
    uses blockchain ownership, hashes, permissions, and events as the
    authoritative access and integrity record.
