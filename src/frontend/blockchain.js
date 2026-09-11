(function () {
  "use strict";

  const Permission = Object.freeze({
    NONE: 0,
    READ: 1,
    WRITE: 2
  });

  const defaultConfig = Object.freeze({
    expectedChainId: 11155111,
    expectedChainName: "Sepolia",
    deploymentUrl: "",
    abiUrl: "/KryptoVaultAccess.abi.json",
    rpcUrls: ["https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18
    }
  });

  let cachedConfig = null;

  class BlockchainError extends Error {
    constructor(message, code, details = {}) {
      super(message);
      this.name = "BlockchainError";
      this.code = code;
      this.details = details;
    }
  }

  class WrongNetworkError extends BlockchainError {
    constructor(expectedChainId, actualChainId, expectedChainName) {
      super(
        `Wrong network. Switch MetaMask to ${expectedChainName} (chain ID ${expectedChainId}). Current chain ID: ${actualChainId}.`,
        "WRONG_NETWORK",
        { expectedChainId, actualChainId, expectedChainName }
      );
      this.name = "WrongNetworkError";
    }
  }

  function requireEthers() {
    if (!window.ethers) {
      throw new BlockchainError("ethers.js is not loaded. Run npm install in frontend/ and restart the frontend server.", "ETHERS_NOT_LOADED");
    }
    return window.ethers;
  }

  function requireMetaMask() {
    if (!window.ethereum) {
      throw new BlockchainError("MetaMask is not available. Install MetaMask and open KryptoVault in that browser.", "METAMASK_NOT_AVAILABLE");
    }
    return window.ethereum;
  }

  async function loadConfig() {
    if (cachedConfig) return cachedConfig;

    const configSource = { ...defaultConfig, ...(window.KRYPTO_BLOCKCHAIN_CONFIG || {}) };
    const deploymentUrl = configSource.DEPLOYMENT_URL || configSource.deploymentUrl;
    const abiUrl = configSource.ABI_URL || configSource.abiUrl;
    let deployment = {};
    let abi = configSource.ABI || configSource.abi;

    if (deploymentUrl) {
      const response = await fetch(deploymentUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new BlockchainError(
          `Unable to load blockchain deployment config from ${deploymentUrl}. Check the configured deployment export.`,
          "BLOCKCHAIN_CONFIG_NOT_FOUND",
          { deploymentUrl, status: response.status }
        );
      }
      deployment = await response.json();
      abi = abi || deployment.abi;
    }

    if (!abi && abiUrl) {
      const response = await fetch(abiUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new BlockchainError(
          `Unable to load blockchain ABI from ${abiUrl}. Run npm run compile and npm run export:abi in blockchain/.`,
          "BLOCKCHAIN_ABI_NOT_FOUND",
          { abiUrl, status: response.status }
        );
      }
      abi = await response.json();
    }

    const ethers = requireEthers();
    const expectedChainId = Number(configSource.EXPECTED_CHAIN_ID || configSource.expectedChainId || deployment.chainId);
    const contractAddress = configSource.CONTRACT_ADDRESS || configSource.contractAddress || deployment.contractAddress;
    const rpcUrls = configSource.RPC_URLS || configSource.rpcUrls || deployment.rpcUrls || [];
    const blockExplorerUrls = configSource.BLOCK_EXPLORER_URLS || configSource.blockExplorerUrls || deployment.blockExplorerUrls || [];

    if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
      throw new BlockchainError("Blockchain config is missing a valid expected chain ID.", "INVALID_BLOCKCHAIN_CONFIG");
    }
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      throw new BlockchainError("Blockchain config is missing a valid contract address.", "INVALID_BLOCKCHAIN_CONFIG");
    }
    if (!Array.isArray(abi) || abi.length === 0) {
      throw new BlockchainError("Blockchain config is missing the contract ABI.", "INVALID_BLOCKCHAIN_CONFIG");
    }

    cachedConfig = {
      ...configSource,
      ...deployment,
      expectedChainId,
      expectedChainName: configSource.EXPECTED_CHAIN_NAME || configSource.expectedChainName || deployment.network || `chain ${expectedChainId}`,
      contractAddress,
      abi,
      rpcUrls,
      blockExplorerUrls
    };
    return cachedConfig;
  }

  function parseChainId(chainId) {
    if (typeof chainId === "number") return chainId;
    if (typeof chainId === "bigint") return Number(chainId);
    if (typeof chainId === "string" && chainId.startsWith("0x")) return Number.parseInt(chainId, 16);
    return Number(chainId);
  }

  async function getCurrentNetworkStatus() {
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    const chainId = await ethereum.request({ method: "eth_chainId" });
    const actualChainId = parseChainId(chainId);

    return {
      actualChainId,
      expectedChainId: config.expectedChainId,
      expectedChainName: config.expectedChainName,
      isExpectedChain: actualChainId === config.expectedChainId
    };
  }

  async function assertExpectedWalletChain(ethereum, config) {
    const chainId = await ethereum.request({ method: "eth_chainId" });
    const actualChainId = parseChainId(chainId);
    if (actualChainId !== config.expectedChainId) {
      throw new WrongNetworkError(config.expectedChainId, actualChainId, config.expectedChainName);
    }
    return actualChainId;
  }

  async function assertExpectedChain(provider, config) {
    const network = await provider.getNetwork();
    const actualChainId = Number(network.chainId);
    if (actualChainId !== config.expectedChainId) {
      throw new WrongNetworkError(config.expectedChainId, actualChainId, config.expectedChainName);
    }
    return actualChainId;
  }

  async function assertContractDeployed(provider, config) {
    const code = await provider.getCode(config.contractAddress);
    if (!code || code === "0x") {
      throw new BlockchainError(
        `KryptoVault contract is not deployed at ${config.contractAddress} on ${config.expectedChainName}. Check the configured deployment address.`,
        "CONTRACT_NOT_DEPLOYED",
        { contractAddress: config.contractAddress, expectedChainId: config.expectedChainId }
      );
    }
  }

  function chainIdToHex(chainId) {
    return `0x${Number(chainId).toString(16)}`;
  }

  function isUnknownChainError(error) {
    return error?.code === 4902 || error?.data?.originalError?.code === 4902;
  }

  async function switchToExpectedChain() {
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    const chainId = chainIdToHex(config.expectedChainId);

    async function switchChain() {
      return ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
    }

    try {
      await switchChain();
    } catch (error) {
      if (!isUnknownChainError(error)) {
        throw error;
      }

      if (!Array.isArray(config.rpcUrls) || config.rpcUrls.length === 0) {
        throw new BlockchainError(
          `MetaMask does not know ${config.expectedChainName}. Add the network in MetaMask or configure RPC_URLS for wallet_addEthereumChain.`,
          "CHAIN_RPC_URLS_REQUIRED",
          { expectedChainId: config.expectedChainId, expectedChainName: config.expectedChainName }
        );
      }

      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: config.expectedChainName,
            rpcUrls: config.rpcUrls,
            blockExplorerUrls: config.blockExplorerUrls,
            nativeCurrency: config.nativeCurrency || defaultConfig.nativeCurrency
          }
        ]
      });
      await switchChain();
    }

    const ethers = requireEthers();
    const provider = new ethers.BrowserProvider(ethereum);
    const actualChainId = await assertExpectedChain(provider, config);
    await assertContractDeployed(provider, config);
    const contract = new ethers.Contract(config.contractAddress, config.abi, provider);
    window.dispatchEvent(new CustomEvent("kryptovault:blockchain-network-changed", {
      detail: { chainId: actualChainId, expectedChainName: config.expectedChainName }
    }));
    return { provider, contract, chainId: actualChainId, config };
  }

  function normalizeSha256Hash(sha256Hash) {
    if (typeof sha256Hash !== "string") {
      throw new BlockchainError("SHA-256 hash must be a hex string.", "INVALID_SHA256_HASH");
    }

    const cleanHash = sha256Hash.startsWith("0x") ? sha256Hash.slice(2) : sha256Hash;
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHash)) {
      throw new BlockchainError("SHA-256 hash must be 32 bytes encoded as 64 hex characters.", "INVALID_SHA256_HASH");
    }

    return `0x${cleanHash.toLowerCase()}`;
  }

  function toContractAssetId(assetId) {
    const ethers = requireEthers();
    if (typeof assetId === "bigint") return assetId;
    if (typeof assetId === "number") {
      if (!Number.isSafeInteger(assetId) || assetId < 0) {
        throw new BlockchainError("Numeric asset ID must be a safe non-negative integer.", "INVALID_ASSET_ID");
      }
      return BigInt(assetId);
    }
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new BlockchainError("Asset ID is required.", "INVALID_ASSET_ID");
    }

    const trimmed = assetId.trim();
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);

    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(trimmed)));
  }

  function normalizePermission(permission) {
    if (typeof permission === "string") {
      const value = Permission[permission.trim().toUpperCase()];
      if (value === Permission.READ || value === Permission.WRITE) return value;
    }
    if (permission === Permission.READ || permission === Permission.WRITE) return permission;

    throw new BlockchainError("Permission must be READ or WRITE.", "INVALID_PERMISSION");
  }

  function normalizeAddress(address, fieldName) {
    const ethers = requireEthers();
    if (!address || !ethers.isAddress(address)) {
      throw new BlockchainError(`${fieldName} must be a valid wallet address.`, "INVALID_ADDRESS", { fieldName });
    }
    return ethers.getAddress(address);
  }

  function normalizeTimestamp(value, fieldName) {
    const timestamp = Number(value || 0);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new BlockchainError(`${fieldName} must be a non-negative Unix timestamp.`, "INVALID_TIMESTAMP", { fieldName });
    }
    return timestamp;
  }

  async function connectProvider() {
    const ethers = requireEthers();
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    await assertExpectedWalletChain(ethereum, config);
    const provider = new ethers.BrowserProvider(ethereum);

    await provider.send("eth_requestAccounts", []);
    const chainId = await assertExpectedChain(provider, config);
    await assertContractDeployed(provider, config);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const contract = new ethers.Contract(config.contractAddress, config.abi, signer);

    return { provider, signer, contract, address, chainId, config };
  }

  async function connectReadProvider() {
    const ethers = requireEthers();
    const ethereum = requireMetaMask();
    const config = await loadConfig();
    await assertExpectedWalletChain(ethereum, config);
    const provider = new ethers.BrowserProvider(ethereum);
    const chainId = await assertExpectedChain(provider, config);
    await assertContractDeployed(provider, config);
    return { provider, chainId, config };
  }

  async function registerAsset(assetId, sha256Hash) {
    const { contract } = await connectProvider();
    return contract.registerAsset(toContractAssetId(assetId), normalizeSha256Hash(sha256Hash));
  }

  async function grantAccess(assetId, grantee, permission, validFrom = 0, validUntil = 0) {
    const { contract } = await connectProvider();
    return contract.grantAccess(
      toContractAssetId(assetId),
      normalizeAddress(grantee, "grantee"),
      normalizePermission(permission),
      normalizeTimestamp(validFrom, "validFrom"),
      normalizeTimestamp(validUntil, "validUntil")
    );
  }

  async function revokeAccess(assetId, grantee) {
    const { contract } = await connectProvider();
    return contract.revokeAccess(toContractAssetId(assetId), normalizeAddress(grantee, "grantee"));
  }

  async function commitVersion(assetId, sha256Hash) {
    const { contract } = await connectProvider();
    return contract.commitVersion(toContractAssetId(assetId), normalizeSha256Hash(sha256Hash));
  }

  async function getTransactionReceipt(transactionHash) {
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new BlockchainError("Transaction hash must be a 32-byte hex string.", "INVALID_TRANSACTION_HASH");
    }
    const { provider } = await connectReadProvider();
    return provider.getTransactionReceipt(transactionHash);
  }

  window.KryptoVaultBlockchain = Object.freeze({
    Permission,
    BlockchainError,
    WrongNetworkError,
    loadConfig,
    getCurrentNetworkStatus,
    connectProvider,
    switchToExpectedChain,
    registerAsset,
    grantAccess,
    revokeAccess,
    commitVersion,
    getTransactionReceipt,
    normalizeSha256Hash,
    toContractAssetId
  });
})();
