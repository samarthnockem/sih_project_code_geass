KryptoVault — Setup Guide
1. System Requirements

Before running KryptoVault, ensure the following are installed:

Windows 10 or Windows 11
Node.js 20 or later
npm
Git
Chrome, Edge, or Brave
MetaMask browser extension

Verify the required development tools using:

node -v
npm -v
git --version
2. MetaMask Configuration

MetaMask is required for wallet authentication and blockchain transactions.

Configure MetaMask to use:

Network: Ethereum Sepolia
Chain ID: 11155111
Hex Chain ID: 0xaa36a7

A MetaMask account must contain Sepolia test ETH for blockchain write operations such as:

Registering an asset
Granting access
Revoking access
Committing a new version

Read-only operations do not require gas fees.

3. Blockchain Configuration

KryptoVault uses Ethereum Sepolia as its blockchain network.

Deployed smart contract:

0x87becA5241e43607ce2983608B1D479f97cD9a05

Required blockchain configuration:

Network: Ethereum Sepolia
Chain ID: 11155111

The smart contract is already deployed. Normal application usage does not require redeployment.

4. MongoDB Atlas

KryptoVault uses MongoDB Atlas for backend database storage.

A local MongoDB installation is not required.

The backend must be configured with a valid MongoDB Atlas connection string:

MONGODB_URI=...

MongoDB Atlas stores application metadata, encrypted file data, wrapped keys, user information, and related records.

5. Backend Environment Configuration

Create a valid backend/.env file with the required runtime configuration:

MONGODB_URI=...
ETHEREUM_RPC_URL=...
CONTRACT_ADDRESS=0x87becA5241e43607ce2983608B1D479f97cD9a05
EXPECTED_CHAIN_ID=11155111
CORS_ORIGIN=http://localhost:8000
SESSION_SECRET=...

Real passwords, API keys, private keys, and secrets must never be committed to GitHub.

6. Install Project Dependencies

Clone the repository and move into the project directory:

git clone <repository-url>
cd <project-directory>

Install the required npm dependencies according to the repository structure.

Typical installation steps may include:

npm install

and, where applicable:

cd backend
npm install
cd ..

cd blockchain
npm install
cd ..

Only run installation commands in directories containing a package.json file.

7. Start KryptoVault

The preferred startup command is:

powershell -ExecutionPolicy Bypass -File .\start-kryptovault.ps1

The startup script verifies the required project configuration and starts the application services.

Expected runtime:

Frontend:
http://localhost:8000

Backend:
http://localhost:4000

Backend Ready:
http://localhost:4000/api/ready

Blockchain:
Ethereum Sepolia

Chain ID:
11155111
8. Open the Application

Open the following address in a browser:

http://localhost:8000

Then:

Open MetaMask.
Select Ethereum Sepolia.
Connect the wallet to KryptoVault.
Approve the authentication signature request.
Continue using the application.

Signing the login authentication message does not require Sepolia ETH.