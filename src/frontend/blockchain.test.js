const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const blockchainSource = fs.readFileSync(path.join(__dirname, "blockchain.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

assert(blockchainSource.includes("wallet_switchEthereumChain"), "blockchain helper must switch MetaMask networks");
assert(blockchainSource.includes("wallet_addEthereumChain"), "blockchain helper must add unknown configured networks");
assert(blockchainSource.includes("expectedChainId: 11155111"), "Sepolia chain ID must be the default expected chain");
assert(blockchainSource.includes('abiUrl: "/KryptoVaultAccess.abi.json"'), "default ABI path must be deployable from the frontend static root");
assert(!blockchainSource.includes("/blockchain/exports/KryptoVaultAccess.abi.json"), "production runtime must not load ABI from repository blockchain exports");
assert(!blockchainSource.includes("http://127.0.0.1:8545"), "runtime blockchain helper must not depend on local RPC");
assert(blockchainSource.includes("https://rpc.sepolia.org"), "Sepolia add-network metadata must use a public RPC URL");
assert(appSource.includes("/integrity"), "Verify Integrity must call the backend integrity endpoint in real mode");
assert(appSource.includes("decryptEncryptedAsset(docId, d)"), "Verify Integrity must use locally decrypted plaintext");
assert(appSource.includes("const actualSha256 = decrypted.sha256"), "Verify Integrity must compare a browser-calculated plaintext hash");
assert(appSource.includes("MISMATCH: local plaintext hash does not match the blockchain record."), "Verify Integrity must show mismatch results");
assert(appSource.includes("VERIFIED: local plaintext hash matches the blockchain record."), "Verify Integrity must show verified results");
assert(appSource.includes("isDemoModeEnabled() ? `<button class=\"btn ghost\" onclick=\"simulateTamper"), "Simulate Tampering must be hidden outside demo mode");
assert(!appSource.includes("window.KryptoVaultApi.post(`/api/assets/${encodeURIComponent(docId)}/integrity`"), "Verify Integrity must not post plaintext or hashes to the backend");
assert(appSource.includes("window.KryptoVaultApi.get(\"/api/activity\")"), "Global Activity must load real audit events from the backend");
assert(appSource.includes("window.KryptoVaultApi.get(`/api/assets/${encodeURIComponent(doc.id)}/activity`)"), "Document Activity tab must load asset-specific audit events from the backend");
assert(appSource.includes("clearBtn.hidden = !isDemoModeEnabled()"), "Clear Demo Logs must be hidden outside demo mode");
assert(appSource.includes("Real audit activity cannot be cleared."), "Clear Demo Logs handler must fail closed outside demo mode");
assert(appSource.includes("window.KryptoVaultApi.post(`/api/assets/${encodeURIComponent(d.id)}/access/revoke-sync`"), "Revokes must be synchronized with the backend after MetaMask confirmation");
assert(appSource.includes("blockchainTransactionHash: tx.hash"), "Revoke sync must send the real blockchain transaction hash");
assert(appSource.includes("/access/strong-revoke/prepare"), "Strong revoke must prepare authorized recipients before key rotation");
assert(appSource.includes("/access/strong-revoke/finalize"), "Strong revoke must finalize the rotated current version with the backend");
assert(appSource.includes("window.KryptoVaultBlockchain.commitVersion"), "Strong revoke must commit the rotated version hash through MetaMask");
assert(appSource.includes("let accountStateGeneration = 0"), "Account-scoped loads must use a generation token");
assert(appSource.includes("function resetAccountScopedState"), "Account switch must clear user-specific frontend state");
assert(appSource.includes("currentDocId = null"), "Account switch must clear the selected document");
assert(appSource.includes("pendingRevoke = null"), "Account switch must clear pending permission state");
assert(appSource.includes("if (generation !== accountStateGeneration) return"), "Stale account-specific loads must not update the UI");
assert(appSource.includes("getSelectedMetaMaskAccount"), "Authentication must compare the selected MetaMask account");
assert(appSource.includes("assertAuthenticatedWalletMatches"), "Authentication must verify backend session and selected wallet match");
assert(appSource.includes("if (walletEventsRegistered) return"), "MetaMask account listeners must not be registered repeatedly");
assert(!appSource.includes("location.reload("), "Account switching must not use browser reload");
assert(appSource.includes("Registration Transaction"), "Document Blockchain tab must show the registration transaction");
assert(appSource.includes("Current Hash"), "Document Blockchain tab must show the current chain hash");
assert(appSource.includes("Latest Chain Action"), "Document Blockchain tab must show the latest known grant, revoke, or version action");
assert(appSource.includes("Confirmation"), "Document Blockchain tab must show confirmation state");

function createContext({ unknownChainOnce = false, contractCode = "0x60016001", initialChainId = "0x1", rpcUrls = [] } = {}) {
  const calls = [];
  let chainId = initialChainId;
  let switchAttempts = 0;

  const ethereum = {
    async request(payload) {
      calls.push(payload);

      if (payload.method === "wallet_switchEthereumChain") {
        switchAttempts += 1;
        if (unknownChainOnce && switchAttempts === 1) {
          const error = new Error("Unknown chain");
          error.code = 4902;
          throw error;
        }
        chainId = payload.params[0].chainId;
        return null;
      }

      if (payload.method === "wallet_addEthereumChain") {
        return null;
      }

      if (payload.method === "eth_chainId") {
        return chainId;
      }

      throw new Error(`Unexpected request ${payload.method}`);
    }
  };

  const context = {
    window: {
      ethereum,
      dispatchEvent() {},
      KRYPTO_BLOCKCHAIN_CONFIG: {
        CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
        EXPECTED_CHAIN_ID: 11155111,
        EXPECTED_CHAIN_NAME: "Sepolia",
        RPC_URLS: rpcUrls,
        BLOCK_EXPLORER_URLS: ["https://sepolia.etherscan.io"],
        ABI_URL: "/KryptoVaultAccess.abi.json"
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => [{ type: "function", name: "registerAsset" }]
    }),
    CustomEvent: function CustomEvent(type, options) {
      return { type, ...(options || {}) };
    },
    Error,
    Number,
    BigInt,
    Array,
    Object,
    String,
    RegExp,
    Promise
  };

  context.window.ethers = {
    isAddress: (value) => /^0x[a-fA-F0-9]{40}$/.test(value),
    BrowserProvider: class BrowserProvider {
      constructor() {}
      async getNetwork() {
        return { chainId: BigInt(chainId) };
      }
      async getCode() {
        return contractCode;
      }
      async getTransactionReceipt() {
        return null;
      }
    },
    Contract: class Contract {
      constructor(address, abi, provider) {
        this.address = address;
        this.abi = abi;
        this.provider = provider;
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(blockchainSource, context);
  return { context, calls };
}

async function run() {
  {
    const { context, calls } = createContext();
    const result = await context.window.KryptoVaultBlockchain.switchToExpectedChain();
    assert.equal(result.chainId, 11155111);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(calls[0]), JSON.stringify({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }]
    }));
  }

  {
    const { context, calls } = createContext({ unknownChainOnce: true, rpcUrls: ["https://sepolia.example.invalid"] });
    const result = await context.window.KryptoVaultBlockchain.switchToExpectedChain();
    assert.equal(result.chainId, 11155111);
    assert.equal(calls[0].method, "wallet_switchEthereumChain");
    assert.equal(calls[0].params[0].chainId, "0xaa36a7");
    assert.equal(calls[1].method, "wallet_addEthereumChain");
    assert.equal(JSON.stringify(calls[1].params[0]), JSON.stringify({
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      rpcUrls: ["https://sepolia.example.invalid"],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
      nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
      }
    }));
    assert.equal(calls[2].method, "wallet_switchEthereumChain");
    assert.equal(calls[2].params[0].chainId, "0xaa36a7");
  }

  {
    const { context } = createContext({ contractCode: "0x", initialChainId: "0xaa36a7" });
    await assert.rejects(
      () => context.window.KryptoVaultBlockchain.getTransactionReceipt(`0x${"1".repeat(64)}`),
      /KryptoVault contract is not deployed/
    );
  }

  {
    const { context } = createContext({ initialChainId: "0x1" });
    const status = await context.window.KryptoVaultBlockchain.getCurrentNetworkStatus();
    assert.equal(status.actualChainId, 1);
    assert.equal(status.expectedChainId, 11155111);
    assert.equal(status.expectedChainName, "Sepolia");
    assert.equal(status.isExpectedChain, false);
  }

  console.log("frontend blockchain tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
