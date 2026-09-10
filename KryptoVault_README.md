# KryptoVault 🔐

> **SIH Problem Statement ID:** SIH26125  
> **PS Title:** Blockchain-Based Secure Platform for Identity, Access Control, and Digital Asset Management  
> **Category:** Software  
> **Theme:** Blockchain & Cybersecurity  

---

## 1. Project Information

| Field | Details |
| :--- | :--- |
| **Project Name** | KryptoVault |
| **Problem Statement ID** | SIH26125 |
| **Problem Statement Title** | Blockchain-Based Secure Platform for Identity, Access Control, and Digital Asset Management |
| **Category** | Software |
| **Team Placeholders** | Manit Shukla, Samarth Bhatia, Daivik Verma, Munaf, Aanya Srivastava, Kavish Kumar |

---

## 2. Problem Statement

Centralized storage architectures store sensitive personal credentials, documents, and identity data in monolithic databases. This model creates critical single points of failure, exposing organizations and individuals to catastrophic database breaches.

At the same time, direct on-chain file storage on standard blockchains is cost-prohibitive and computationally inefficient. Standard decentralized approaches also face technical challenges:

* **File Size & Cryptographic Overhead:** Encrypting and processing large files on client devices without UI degradation.
* **Key Lifecycle & Storage Breaches:** Protecting files if server infrastructure or database layers are compromised.
* **Client-Side Extraction Risk:** Minimizing local risks such as screenshot leaks, unauthorized downloads, or key retention in memory during decryption.
* **Inflexible Revocation:** Weak revocation leaves previously downloaded keys functional, requiring an active key-rotation and re-encryption protocol for high-security environments.

---

## 3. Proposed Solution

The **KryptoVault** separates identity, access control rules, encrypted asset storage, and blockchain immutability into distinct architectural layers:

1. **Identity Layer (Wallet-Based Authentication):** MetaMask signatures prove wallet ownership and authorize blockchain actions. File encryption uses a separate application encryption key pair; wallet private keys are never exposed to the application.
2. **Access Control Layer (Smart Contracts):** Solidity smart contracts deployed on the Ethereum Sepolia testnet serve as an immutable gatekeeper. Access decisions (**READ**, **WRITE**, or **NONE**) are evaluated on-chain alongside time duration windows and commit reasons.
3. **Digital Asset Layer (Client-Side Cryptography):** Files are encrypted locally in the user's browser using AES-256-GCM before transmission. The file's AES key is wrapped individually for each authorized recipient using their public encryption key.
4. **Off-Chain Storage Layer:** Encrypted assets, metadata, and wrapped key blocks reside in MongoDB / GridFS or other object storage. Raw plaintext files, raw AES keys, private encryption keys, and wallet private keys are never stored on the server or database.
5. **Revocation Protocols:** The platform implements both **Weak Revocation** (smart contract permission removal) and **Strong Revocation** (generating a fresh AES key, re-encrypting the asset, and issuing wrapped keys exclusively to active authorized recipients).

---

## 4. Key Features

* **Client-Side Zero-Knowledge Encryption:** AES-256-GCM asset encryption performed locally in browser memory using Web Crypto API.
* **Blockchain Asset Fingerprinting:** SHA-256 asset hashes stored immutably on-chain to detect any off-chain database tampering.
* **Smart Contract Gatekeeping:** Granular permission levels (**READ**, **WRITE**, **NONE**) enforced by contract logic, including valid duration windows and version histories.
* **Per-User Access Control:** The MVP focuses on per-file, per-user READ/WRITE permissions with time windows.
* **Dual-Tier Revocation:** Support for instantaneous smart contract revocation (Weak) and key-rotation re-encryption (Strong).
* **Client Exposure Minimization:** Decryption is performed only when needed and sensitive key material is kept client-side for the shortest practical execution window.
* **Immutable Audit Logs:** Blockchain event logging for asset registration, access grants, revocations, and version updates, including relevant validity windows and reasons where defined.

---

## 5. System Architecture

```text
+-------------------------------------------------------------------------------+
|                                USER DEVICE                                    |
|  +---------------------+   +---------------------+   +---------------------+  |
|  | MetaMask Sign/Auth  |   | AES-256-GCM Encrypt |   | Encryption Key Pair |  |
|  +----------+----------+   +----------+----------+   +----------+----------+  |
+-------------|-------------------------|-------------------------|-------------+
              |                         |                         |
              v                         v                         v
+-------------------------------------------------------------------------------+
|                            BLOCKCHAIN LAYER (EVM)                             |
|  +-------------------------------------------------------------------------+  |
|  | Smart Contract Gatekeeper (Permissions: READ / WRITE / NONE)             |  |
|  | SHA-256 Fingerprints | Version Commit Log | Immutable Event Trail    |  |
|  +-------------------------------------------------------------------------+  |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                           OFF-CHAIN STORAGE LAYER                             |
|  +-------------------------------------------------------------------------+  |
|  | MongoDB / GridFS / Object Storage                                                 |  |
|  | Encrypted Ciphertext | Wrapped Key Blocks | Public Encryption Keys       |  |
|  | (Zero Plaintext | Zero Private Keys)                                   |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 6. Technology Stack

* **Frontend:** React.js, Vite, Tailwind CSS
* **Backend & API:** Node.js, Express.js
* **Database & Off-Chain Storage:** MongoDB Atlas, GridFS / object storage
* **Blockchain & Smart Contracts:** Solidity, Hardhat, Ethereum Sepolia Testnet
* **Web3 Integration:** Ethers.js, MetaMask
* **Security & Cryptography:** AES-256-GCM, SHA-256, Web Crypto API, asymmetric key wrapping
* **Version Control & Dev Tools:** Git, GitHub, VS Code

---

## 7. Repository Structure

```text
SOVEREIGN-DIGITAL-VAULT/
├── README.md                  # Main repository overview and architecture documentation
├── submission/
│   ├── PRESENTATION.md        # Pitch deck links and slide breakdown
│   └── DEMO.md                # Demonstration video links and key walkthrough timestamp
├── docs/
│   └── architecture.md        # Deep dive on cryptography, key wrapping, and smart contracts
├── src/
│   ├── frontend/              # React.js client interface
│   ├── backend/               # Express API and off-chain storage connectors
│   └── contracts/             # Solidity smart contracts and Hardhat deployment scripts
├── assets/
│   └── screenshots/           # Architecture diagrams, smart contract audits, and UI flow
├── requirements.txt / package.json
├── .gitignore
└── LICENSE
```

---

## 8. Team Members

* Manit Shukla
* Samarth Bhatia
* Daivik Verma
* Munaf
* Aanya Srivastava
* Kavish Kumar

---

## 9. Developer Setup & Installation

Developers working on this project can follow standard deployment workflows:

### Smart Contracts (Hardhat)
```bash
# Install dependencies
npm install

# Compile Solidity contracts
npx hardhat compile

# Deploy to Sepolia Testnet
npx hardhat run scripts/deploy.js --network sepolia
```

### Backend API
```bash
cd src/backend
npm install
npm start
```

### Frontend Client
```bash
cd src/frontend
npm install
npm run dev
```

---

## 10. Future Scope

* **IPFS Integration:** Optional decentralized content-addressed storage for encrypted asset blobs.
* **Verifiable Credentials:** Trusted issuers could provide privacy-preserving digital credentials linked to wallet identities.
* **Selective Disclosure / Zero-Knowledge Proofs:** Future identity workflows may prove specific attributes without exposing complete credentials.
* **Group, Folder & Role-Based Access:** Extend per-user permissions to teams, folders, departments, and reusable role classes.
* **Massive Asset Chunking:** Client-side chunked encryption pipelines and background web workers for multi-gigabyte files.
* **Hardware-Backed Key Protection:** Integration with WebAuthn, secure hardware, and biometric-backed device authentication.
* **Enhanced System Boundaries:** Native-client controls may reduce casual screenshots or exports, while acknowledging that plaintext capture can never be eliminated completely.
