import { Contract, Interface, JsonRpcProvider, getAddress, id, isAddress, type BigNumberish } from "ethers";
import { env } from "../config/env.js";

export const permissionValues = ["NONE", "READ", "WRITE"] as const;
export type Permission = (typeof permissionValues)[number];

const assetRegistryAbi = [
  "event AssetRegistered(uint256 indexed assetId, address indexed owner, bytes32 sha256Hash, uint256 version)",
  "event AccessGranted(uint256 indexed assetId, address indexed owner, address indexed grantee, uint8 permission, uint64 validFrom, uint64 validUntil)",
  "event AccessRevoked(uint256 indexed assetId, address indexed owner, address indexed grantee)",
  "event VersionCommitted(uint256 indexed assetId, address indexed committer, bytes32 sha256Hash, uint256 version)",
  "function ownerOf(uint256 assetId) view returns (address)",
  "function getPermission(uint256 assetId, address wallet) view returns (uint8)",
  "function currentHashOf(uint256 assetId) view returns (bytes32)",
  "function currentVersionOf(uint256 assetId) view returns (uint256)"
] as const;

type BlockchainProvider = {
  getNetwork(): Promise<{
    chainId: bigint;
  }>;
  getCode?(address: string): Promise<string>;
  getTransactionReceipt?(transactionHash: string): Promise<BlockchainTransactionReceipt | null>;
};

type AssetRegistryContract = {
  ownerOf(assetId: bigint): Promise<string>;
  getPermission(assetId: bigint, wallet: string): Promise<bigint | number | string>;
  currentHashOf(assetId: bigint): Promise<string>;
  currentVersionOf(assetId: bigint): Promise<bigint | number | string>;
};

type BlockchainLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

type BlockchainTransactionReceipt = {
  status?: number | bigint | null;
  from: string;
  to?: string | null;
  blockNumber: number;
  logs: readonly BlockchainLog[];
};

export type BlockchainReadServiceOptions = {
  provider?: BlockchainProvider;
  contract?: AssetRegistryContract;
  contractAddress?: string;
  chainId?: number;
};

export type BlockchainReadService = {
  getAssetOwner(assetId: BigNumberish): Promise<string>;
  getPermission(assetId: BigNumberish, wallet: string): Promise<Permission>;
  getCurrentHash(assetId: BigNumberish): Promise<string>;
  getCurrentVersion(assetId: BigNumberish): Promise<number>;
  verifyAssetRegistration(input: VerifyAssetRegistrationInput): Promise<VerifiedAssetRegistration>;
  verifyAccessGrant(input: VerifyAccessGrantInput): Promise<VerifiedAccessGrant>;
  verifyAccessRevoke(input: VerifyAccessRevokeInput): Promise<VerifiedAccessRevoke>;
  verifyVersionCommit(input: VerifyVersionCommitInput): Promise<VerifiedVersionCommit>;
};

export type VerifyAssetRegistrationInput = {
  transactionHash: string;
  applicationAssetId: string;
  expectedOwnerWallet: string;
  expectedSha256: string;
};

export type VerifiedAssetRegistration = {
  blockchainAssetId: string;
  transactionHash: string;
  blockNumber: number;
  ownerWallet: string;
  sha256: string;
};

export type VerifyAccessGrantInput = {
  transactionHash: string;
  blockchainAssetId: string;
  expectedOwnerWallet: string;
  expectedGranteeWallet: string;
  expectedAccessType: "READ" | "WRITE";
  expectedValidFrom: number;
  expectedValidUntil: number;
};

export type VerifiedAccessGrant = {
  blockchainAssetId: string;
  transactionHash: string;
  blockNumber: number;
  ownerWallet: string;
  granteeWallet: string;
  accessType: "READ" | "WRITE";
  validFrom: number;
  validUntil: number;
};

export type VerifyAccessRevokeInput = {
  transactionHash: string;
  blockchainAssetId: string;
  expectedOwnerWallet: string;
  expectedGranteeWallet: string;
};

export type VerifiedAccessRevoke = {
  blockchainAssetId: string;
  transactionHash: string;
  blockNumber: number;
  ownerWallet: string;
  granteeWallet: string;
};

export type VerifyVersionCommitInput = {
  transactionHash: string;
  blockchainAssetId: string;
  expectedCommitterWallet: string;
  expectedSha256: string;
  expectedVersion: number;
};

export type VerifiedVersionCommit = {
  blockchainAssetId: string;
  transactionHash: string;
  blockNumber: number;
  committerWallet: string;
  sha256: string;
  version: number;
};

export class BlockchainVerificationError extends Error {
  readonly code = "BLOCKCHAIN_VERIFICATION_FAILED";

  constructor(message = "Blockchain verification failed") {
    super(message);
    this.name = "BlockchainVerificationError";
  }
}

function normalizeAssetId(assetId: BigNumberish) {
  try {
    const normalized = BigInt(assetId);
    if (normalized < 0n) {
      throw new Error("negative asset id");
    }

    return normalized;
  } catch {
    throw new BlockchainVerificationError();
  }
}

export function deriveBlockchainAssetId(applicationAssetId: string) {
  if (typeof applicationAssetId !== "string" || !applicationAssetId.trim()) {
    throw new BlockchainVerificationError();
  }

  return BigInt(id(applicationAssetId.trim()));
}

function normalizeWallet(wallet: string) {
  if (!isAddress(wallet)) {
    throw new BlockchainVerificationError();
  }

  return getAddress(wallet);
}

function normalizeTransactionHash(transactionHash: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
    throw new BlockchainVerificationError();
  }

  return transactionHash.toLowerCase();
}

function normalizeHash(hash: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new BlockchainVerificationError();
  }

  return hash.toLowerCase();
}

function normalizeExpectedSha256(sha256: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new BlockchainVerificationError();
  }

  return `0x${sha256.toLowerCase()}`;
}

function normalizePermission(permission: bigint | number | string): Permission {
  if (typeof permission === "string") {
    const upper = permission.toUpperCase();
    if (permissionValues.includes(upper as Permission)) {
      return upper as Permission;
    }
  }

  const numeric = Number(permission);
  if (numeric === 0) {
    return "NONE";
  }

  if (numeric === 1) {
    return "READ";
  }

  if (numeric === 2) {
    return "WRITE";
  }

  throw new BlockchainVerificationError();
}

function permissionToContractValue(accessType: "READ" | "WRITE") {
  return accessType === "READ" ? 1 : 2;
}

function normalizeVersion(version: bigint | number | string) {
  try {
    const normalized = BigInt(version);
    if (normalized < 0n || normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("invalid version");
    }

    return Number(normalized);
  } catch {
    throw new BlockchainVerificationError();
  }
}

async function assertExpectedChain(provider: BlockchainProvider, expectedChainId: number) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(expectedChainId)) {
    throw new BlockchainVerificationError(`Blockchain provider is on chain ID ${network.chainId.toString()}, expected ${expectedChainId}`);
  }
}

async function assertContractDeployed(provider: BlockchainProvider, contractAddress: string) {
  if (!provider.getCode) {
    return;
  }

  const code = await provider.getCode(normalizeWallet(contractAddress));
  if (!code || code === "0x") {
    throw new BlockchainVerificationError(`Configured KryptoVault contract is not deployed at ${contractAddress}`);
  }
}

function createDefaultProvider(): BlockchainProvider {
  return new JsonRpcProvider(env.ETHEREUM_RPC_URL, env.EXPECTED_CHAIN_ID);
}

function createDefaultContract(provider: BlockchainProvider): AssetRegistryContract {
  return new Contract(env.CONTRACT_ADDRESS, assetRegistryAbi, provider as never) as unknown as AssetRegistryContract;
}

async function verifiedCall<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BlockchainVerificationError) {
      throw error;
    }

    throw new BlockchainVerificationError();
  }
}

export function createBlockchainReadService(options: BlockchainReadServiceOptions = {}): BlockchainReadService {
  const provider = options.provider ?? createDefaultProvider();
  const contractAddress = options.contractAddress ?? env.CONTRACT_ADDRESS;
  const chainId = options.chainId ?? env.EXPECTED_CHAIN_ID;

  if (!isAddress(contractAddress)) {
    throw new BlockchainVerificationError();
  }

  const contract = options.contract ?? createDefaultContract(provider);

  return {
    async getAssetOwner(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        const owner = await contract.ownerOf(normalizeAssetId(assetId));
        return normalizeWallet(owner).toLowerCase();
      });
    },

    async getPermission(assetId: BigNumberish, wallet: string) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        const permission = await contract.getPermission(normalizeAssetId(assetId), normalizeWallet(wallet));
        return normalizePermission(permission);
      });
    },

    async getCurrentHash(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        const hash = await contract.currentHashOf(normalizeAssetId(assetId));
        return normalizeHash(hash);
      });
    },

    async getCurrentVersion(assetId: BigNumberish) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        const version = await contract.currentVersionOf(normalizeAssetId(assetId));
        return normalizeVersion(version);
      });
    },

    async verifyAssetRegistration(input: VerifyAssetRegistrationInput) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        if (!provider.getTransactionReceipt) {
          throw new BlockchainVerificationError();
        }

        const expectedAssetId = deriveBlockchainAssetId(input.applicationAssetId);
        const expectedOwner = normalizeWallet(input.expectedOwnerWallet).toLowerCase();
        const expectedHash = normalizeExpectedSha256(input.expectedSha256);
        const transactionHash = normalizeTransactionHash(input.transactionHash);
        const receipt = await provider.getTransactionReceipt(transactionHash);

        if (!receipt || Number(receipt.status) !== 1) {
          throw new BlockchainVerificationError("Asset registration transaction failed or was not found");
        }

        if (normalizeWallet(receipt.from).toLowerCase() !== expectedOwner) {
          throw new BlockchainVerificationError("Asset registration transaction was not sent by the asset owner");
        }

        if (!receipt.to || normalizeWallet(receipt.to).toLowerCase() !== normalizeWallet(contractAddress).toLowerCase()) {
          throw new BlockchainVerificationError("Asset registration transaction did not target the configured contract");
        }

        const contractInterface = new Interface(assetRegistryAbi);
        const registeredEvent = receipt.logs
          .filter((log) => normalizeWallet(log.address).toLowerCase() === normalizeWallet(contractAddress).toLowerCase())
          .map((log) => {
            try {
              return contractInterface.parseLog({
                topics: [...log.topics],
                data: log.data
              });
            } catch {
              return null;
            }
          })
          .find((event) => event?.name === "AssetRegistered");

        if (!registeredEvent) {
          throw new BlockchainVerificationError("Asset registration event was not found");
        }

        const eventAssetId = normalizeAssetId(registeredEvent.args.assetId);
        const eventOwner = normalizeWallet(registeredEvent.args.owner).toLowerCase();
        const eventHash = normalizeHash(registeredEvent.args.sha256Hash);
        const eventVersion = normalizeVersion(registeredEvent.args.version);

        if (eventAssetId !== expectedAssetId) {
          throw new BlockchainVerificationError("Asset registration event used the wrong asset reference");
        }
        if (eventOwner !== expectedOwner) {
          throw new BlockchainVerificationError("Asset registration event used the wrong owner");
        }
        if (eventHash !== expectedHash) {
          throw new BlockchainVerificationError("Asset registration event used the wrong SHA-256 hash");
        }
        if (eventVersion !== 1) {
          throw new BlockchainVerificationError("Asset registration event used the wrong initial version");
        }

        return {
          blockchainAssetId: expectedAssetId.toString(),
          transactionHash,
          blockNumber: receipt.blockNumber,
          ownerWallet: eventOwner,
          sha256: expectedHash.slice(2)
        };
      });
    },

    async verifyAccessGrant(input: VerifyAccessGrantInput) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        if (!provider.getTransactionReceipt) {
          throw new BlockchainVerificationError();
        }

        const expectedAssetId = normalizeAssetId(input.blockchainAssetId);
        const expectedOwner = normalizeWallet(input.expectedOwnerWallet).toLowerCase();
        const expectedGrantee = normalizeWallet(input.expectedGranteeWallet).toLowerCase();
        const expectedPermission = permissionToContractValue(input.expectedAccessType);
        const transactionHash = normalizeTransactionHash(input.transactionHash);
        const receipt = await provider.getTransactionReceipt(transactionHash);

        if (!receipt || Number(receipt.status) !== 1) {
          throw new BlockchainVerificationError("Access grant transaction failed or was not found");
        }

        if (normalizeWallet(receipt.from).toLowerCase() !== expectedOwner) {
          throw new BlockchainVerificationError("Access grant transaction was not sent by the asset owner");
        }

        if (!receipt.to || normalizeWallet(receipt.to).toLowerCase() !== normalizeWallet(contractAddress).toLowerCase()) {
          throw new BlockchainVerificationError("Access grant transaction did not target the configured contract");
        }

        const contractInterface = new Interface(assetRegistryAbi);
        const grantedEvent = receipt.logs
          .filter((log) => normalizeWallet(log.address).toLowerCase() === normalizeWallet(contractAddress).toLowerCase())
          .map((log) => {
            try {
              return contractInterface.parseLog({
                topics: [...log.topics],
                data: log.data
              });
            } catch {
              return null;
            }
          })
          .find((event) => event?.name === "AccessGranted");

        if (!grantedEvent) {
          throw new BlockchainVerificationError("AccessGranted event was not found");
        }

        const eventAssetId = normalizeAssetId(grantedEvent.args.assetId);
        const eventOwner = normalizeWallet(grantedEvent.args.owner).toLowerCase();
        const eventGrantee = normalizeWallet(grantedEvent.args.grantee).toLowerCase();
        const eventPermission = Number(grantedEvent.args.permission);
        const eventValidFrom = Number(grantedEvent.args.validFrom);
        const eventValidUntil = Number(grantedEvent.args.validUntil);

        if (eventAssetId !== expectedAssetId) {
          throw new BlockchainVerificationError("AccessGranted event used the wrong asset reference");
        }
        if (eventOwner !== expectedOwner) {
          throw new BlockchainVerificationError("AccessGranted event used the wrong owner");
        }
        if (eventGrantee !== expectedGrantee) {
          throw new BlockchainVerificationError("AccessGranted event used the wrong grantee");
        }
        if (eventPermission !== expectedPermission) {
          throw new BlockchainVerificationError("AccessGranted event used the wrong permission");
        }
        if (eventValidFrom !== input.expectedValidFrom || eventValidUntil !== input.expectedValidUntil) {
          throw new BlockchainVerificationError("AccessGranted event used the wrong validity window");
        }

        return {
          blockchainAssetId: expectedAssetId.toString(),
          transactionHash,
          blockNumber: receipt.blockNumber,
          ownerWallet: eventOwner,
          granteeWallet: eventGrantee,
          accessType: input.expectedAccessType,
          validFrom: eventValidFrom,
          validUntil: eventValidUntil
        };
      });
    },

    async verifyAccessRevoke(input: VerifyAccessRevokeInput) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        if (!provider.getTransactionReceipt) {
          throw new BlockchainVerificationError();
        }

        const expectedAssetId = normalizeAssetId(input.blockchainAssetId);
        const expectedOwner = normalizeWallet(input.expectedOwnerWallet).toLowerCase();
        const expectedGrantee = normalizeWallet(input.expectedGranteeWallet).toLowerCase();
        const transactionHash = normalizeTransactionHash(input.transactionHash);
        const receipt = await provider.getTransactionReceipt(transactionHash);

        if (!receipt || Number(receipt.status) !== 1) {
          throw new BlockchainVerificationError("Access revoke transaction failed or was not found");
        }

        if (normalizeWallet(receipt.from).toLowerCase() !== expectedOwner) {
          throw new BlockchainVerificationError("Access revoke transaction was not sent by the asset owner");
        }

        if (!receipt.to || normalizeWallet(receipt.to).toLowerCase() !== normalizeWallet(contractAddress).toLowerCase()) {
          throw new BlockchainVerificationError("Access revoke transaction did not target the configured contract");
        }

        const contractInterface = new Interface(assetRegistryAbi);
        const revokedEvent = receipt.logs
          .filter((log) => normalizeWallet(log.address).toLowerCase() === normalizeWallet(contractAddress).toLowerCase())
          .map((log) => {
            try {
              return contractInterface.parseLog({
                topics: [...log.topics],
                data: log.data
              });
            } catch {
              return null;
            }
          })
          .find((event) => event?.name === "AccessRevoked");

        if (!revokedEvent) {
          throw new BlockchainVerificationError("AccessRevoked event was not found");
        }

        const eventAssetId = normalizeAssetId(revokedEvent.args.assetId);
        const eventOwner = normalizeWallet(revokedEvent.args.owner).toLowerCase();
        const eventGrantee = normalizeWallet(revokedEvent.args.grantee).toLowerCase();

        if (eventAssetId !== expectedAssetId) {
          throw new BlockchainVerificationError("AccessRevoked event used the wrong asset reference");
        }
        if (eventOwner !== expectedOwner) {
          throw new BlockchainVerificationError("AccessRevoked event used the wrong owner");
        }
        if (eventGrantee !== expectedGrantee) {
          throw new BlockchainVerificationError("AccessRevoked event used the wrong grantee");
        }

        return {
          blockchainAssetId: expectedAssetId.toString(),
          transactionHash,
          blockNumber: receipt.blockNumber,
          ownerWallet: eventOwner,
          granteeWallet: eventGrantee
        };
      });
    },

    async verifyVersionCommit(input: VerifyVersionCommitInput) {
      return verifiedCall(async () => {
        await assertExpectedChain(provider, chainId);
        await assertContractDeployed(provider, contractAddress);
        if (!provider.getTransactionReceipt) {
          throw new BlockchainVerificationError();
        }

        const expectedAssetId = normalizeAssetId(input.blockchainAssetId);
        const expectedCommitter = normalizeWallet(input.expectedCommitterWallet).toLowerCase();
        const expectedHash = normalizeExpectedSha256(input.expectedSha256);
        const expectedVersion = normalizeVersion(input.expectedVersion);
        const transactionHash = normalizeTransactionHash(input.transactionHash);
        const receipt = await provider.getTransactionReceipt(transactionHash);

        if (!receipt || Number(receipt.status) !== 1) {
          throw new BlockchainVerificationError("Version commit transaction failed or was not found");
        }

        if (normalizeWallet(receipt.from).toLowerCase() !== expectedCommitter) {
          throw new BlockchainVerificationError("Version commit transaction was not sent by the expected wallet");
        }

        if (!receipt.to || normalizeWallet(receipt.to).toLowerCase() !== normalizeWallet(contractAddress).toLowerCase()) {
          throw new BlockchainVerificationError("Version commit transaction did not target the configured contract");
        }

        const contractInterface = new Interface(assetRegistryAbi);
        const committedEvent = receipt.logs
          .filter((log) => normalizeWallet(log.address).toLowerCase() === normalizeWallet(contractAddress).toLowerCase())
          .map((log) => {
            try {
              return contractInterface.parseLog({
                topics: [...log.topics],
                data: log.data
              });
            } catch {
              return null;
            }
          })
          .find((event) => event?.name === "VersionCommitted");

        if (!committedEvent) {
          throw new BlockchainVerificationError("VersionCommitted event was not found");
        }

        const eventAssetId = normalizeAssetId(committedEvent.args.assetId);
        const eventCommitter = normalizeWallet(committedEvent.args.committer).toLowerCase();
        const eventHash = normalizeHash(committedEvent.args.sha256Hash);
        const eventVersion = normalizeVersion(committedEvent.args.version);

        if (eventAssetId !== expectedAssetId) {
          throw new BlockchainVerificationError("VersionCommitted event used the wrong asset reference");
        }
        if (eventCommitter !== expectedCommitter) {
          throw new BlockchainVerificationError("VersionCommitted event used the wrong committer");
        }
        if (eventHash !== expectedHash) {
          throw new BlockchainVerificationError("VersionCommitted event used the wrong SHA-256 hash");
        }
        if (eventVersion !== expectedVersion) {
          throw new BlockchainVerificationError("VersionCommitted event used the wrong version");
        }

        return {
          blockchainAssetId: expectedAssetId.toString(),
          transactionHash,
          blockNumber: receipt.blockNumber,
          committerWallet: eventCommitter,
          sha256: expectedHash.slice(2),
          version: eventVersion
        };
      });
    }
  };
}

export const blockchainReadService = createBlockchainReadService;
