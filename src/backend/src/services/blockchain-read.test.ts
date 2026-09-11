import { describe, expect, it, vi } from "vitest";
import { Interface, id } from "ethers";
import { BlockchainVerificationError, createBlockchainReadService, deriveBlockchainAssetId } from "./blockchain-read.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const readerWallet = "0x2222222222222222222222222222222222222222";
const validHash = `0x${"a".repeat(64)}`;
const contractAddress = "0x3333333333333333333333333333333333333333";
const transactionHash = `0x${"c".repeat(64)}`;
const appAssetId = "64f000000000000000000001";
const assetRegisteredInterface = new Interface([
  "event AssetRegistered(uint256 indexed assetId, address indexed owner, bytes32 sha256Hash, uint256 version)"
]);
const accessGrantedInterface = new Interface([
  "event AccessGranted(uint256 indexed assetId, address indexed owner, address indexed grantee, uint8 permission, uint64 validFrom, uint64 validUntil)"
]);
const accessRevokedInterface = new Interface([
  "event AccessRevoked(uint256 indexed assetId, address indexed owner, address indexed grantee)"
]);
const versionCommittedInterface = new Interface([
  "event VersionCommitted(uint256 indexed assetId, address indexed committer, bytes32 sha256Hash, uint256 version)"
]);

function fakeProvider(chainId = 31337n, receipt: unknown = null) {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId }),
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt)
  };
}

function fakeProviderWithCode(chainId = 31337n, receipt: unknown = null, code = "0x60016001") {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId }),
    getCode: vi.fn().mockResolvedValue(code),
    getTransactionReceipt: vi.fn().mockResolvedValue(receipt)
  };
}

function fakeContract(overrides: Partial<ReturnType<typeof defaultFakeContract>> = {}) {
  return {
    ...defaultFakeContract(),
    ...overrides
  };
}

function defaultFakeContract() {
  return {
    ownerOf: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue(1n),
    currentHashOf: vi.fn().mockResolvedValue(validHash),
    currentVersionOf: vi.fn().mockResolvedValue(3n)
  };
}

function assetRegisteredReceipt(overrides: {
  assetId?: bigint;
  owner?: string;
  sha256Hash?: string;
  version?: number;
  status?: number;
  from?: string;
  to?: string;
  address?: string;
} = {}) {
  const assetId = overrides.assetId ?? deriveBlockchainAssetId(appAssetId);
  const owner = overrides.owner ?? ownerWallet;
  const sha256Hash = overrides.sha256Hash ?? validHash;
  const version = overrides.version ?? 1;
  const event = assetRegisteredInterface.encodeEventLog(
    assetRegisteredInterface.getEvent("AssetRegistered"),
    [assetId, owner, sha256Hash, version]
  );

  return {
    status: overrides.status ?? 1,
    from: overrides.from ?? ownerWallet,
    to: overrides.to ?? contractAddress,
    blockNumber: 12345,
    logs: [
      {
        address: overrides.address ?? contractAddress,
        topics: event.topics,
        data: event.data
      }
    ]
  };
}

function accessGrantedReceipt(overrides: {
  assetId?: bigint;
  owner?: string;
  grantee?: string;
  permission?: number;
  validFrom?: number;
  validUntil?: number;
  status?: number;
  from?: string;
  to?: string;
  address?: string;
} = {}) {
  const event = accessGrantedInterface.encodeEventLog(
    accessGrantedInterface.getEvent("AccessGranted"),
    [
      overrides.assetId ?? 100n,
      overrides.owner ?? ownerWallet,
      overrides.grantee ?? readerWallet,
      overrides.permission ?? 1,
      overrides.validFrom ?? 0,
      overrides.validUntil ?? 0
    ]
  );

  return {
    status: overrides.status ?? 1,
    from: overrides.from ?? ownerWallet,
    to: overrides.to ?? contractAddress,
    blockNumber: 12346,
    logs: [
      {
        address: overrides.address ?? contractAddress,
        topics: event.topics,
        data: event.data
      }
    ]
  };
}

function accessRevokedReceipt(overrides: {
  assetId?: bigint;
  owner?: string;
  grantee?: string;
  status?: number;
  from?: string;
  to?: string;
  address?: string;
} = {}) {
  const event = accessRevokedInterface.encodeEventLog(
    accessRevokedInterface.getEvent("AccessRevoked"),
    [
      overrides.assetId ?? 100n,
      overrides.owner ?? ownerWallet,
      overrides.grantee ?? readerWallet
    ]
  );

  return {
    status: overrides.status ?? 1,
    from: overrides.from ?? ownerWallet,
    to: overrides.to ?? contractAddress,
    blockNumber: 12347,
    logs: [
      {
        address: overrides.address ?? contractAddress,
        topics: event.topics,
        data: event.data
      }
    ]
  };
}

function versionCommittedReceipt(overrides: {
  assetId?: bigint;
  committer?: string;
  sha256Hash?: string;
  version?: number;
  status?: number;
  from?: string;
  to?: string;
  address?: string;
} = {}) {
  const event = versionCommittedInterface.encodeEventLog(
    versionCommittedInterface.getEvent("VersionCommitted"),
    [
      overrides.assetId ?? 100n,
      overrides.committer ?? ownerWallet,
      overrides.sha256Hash ?? validHash,
      overrides.version ?? 3
    ]
  );

  return {
    status: overrides.status ?? 1,
    from: overrides.from ?? ownerWallet,
    to: overrides.to ?? contractAddress,
    blockNumber: 12348,
    logs: [
      {
        address: overrides.address ?? contractAddress,
        topics: event.topics,
        data: event.data
      }
    ]
  };
}

describe("blockchain read service", () => {
  it("reads owner from the configured read-only contract", async () => {
    const provider = fakeProvider();
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getAssetOwner(12)).resolves.toBe(ownerWallet);

    expect(provider.getNetwork).toHaveBeenCalledOnce();
    expect(contract.ownerOf).toHaveBeenCalledWith(12n);
  });

  it("normalizes permissions to NONE READ WRITE", async () => {
    const provider = fakeProvider();
    const contract = fakeContract({
      getPermission: vi.fn().mockResolvedValueOnce(0n).mockResolvedValueOnce(1n).mockResolvedValueOnce(2n)
    });
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getPermission(1, readerWallet)).resolves.toBe("NONE");
    await expect(service.getPermission(1, readerWallet)).resolves.toBe("READ");
    await expect(service.getPermission(1, readerWallet)).resolves.toBe("WRITE");

    expect(contract.getPermission).toHaveBeenCalledWith(1n, "0x2222222222222222222222222222222222222222");
  });

  it("reads current hash and version", async () => {
    const provider = fakeProvider();
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getCurrentHash("7")).resolves.toBe(validHash);
    await expect(service.getCurrentVersion(7n)).resolves.toBe(3);

    expect(contract.currentHashOf).toHaveBeenCalledWith(7n);
    expect(contract.currentVersionOf).toHaveBeenCalledWith(7n);
  });

  it("fails closed when the provider is on the wrong chain", async () => {
    const provider = fakeProvider(11155111n);
    const contract = fakeContract();
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getAssetOwner(1)).rejects.toBeInstanceOf(BlockchainVerificationError);
    expect(contract.ownerOf).not.toHaveBeenCalled();
  });

  it("fails closed when blockchain reads fail", async () => {
    const provider = fakeProvider();
    const contract = fakeContract({
      currentVersionOf: vi.fn().mockRejectedValue(new Error("rpc unavailable"))
    });
    const service = createBlockchainReadService({ provider, contract, chainId: 31337 });

    await expect(service.getCurrentVersion(1)).rejects.toMatchObject({
      code: "BLOCKCHAIN_VERIFICATION_FAILED"
    });
  });

  it("fails clearly when the configured contract address has no deployed bytecode", async () => {
    const provider = fakeProviderWithCode(31337n, assetRegisteredReceipt(), "0x");
    const service = createBlockchainReadService({
      provider,
      contract: fakeContract(),
      contractAddress,
      chainId: 31337
    });

    await expect(
      service.verifyAssetRegistration({
        transactionHash,
        applicationAssetId: appAssetId,
        expectedOwnerWallet: ownerWallet,
        expectedSha256: "a".repeat(64)
      })
    ).rejects.toThrow(`Configured KryptoVault contract is not deployed at ${contractAddress}`);
  });

  it("fails closed for invalid wallet, hash, permission, version, and asset id values", async () => {
    const provider = fakeProvider();

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ ownerOf: vi.fn().mockResolvedValue("not-a-wallet") }),
        chainId: 31337
      }).getAssetOwner(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ currentHashOf: vi.fn().mockResolvedValue("not-a-hash") }),
        chainId: 31337
      }).getCurrentHash(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ getPermission: vi.fn().mockResolvedValue(99n) }),
        chainId: 31337
      }).getPermission(1, readerWallet)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract({ currentVersionOf: vi.fn().mockResolvedValue(-1n) }),
        chainId: 31337
      }).getCurrentVersion(1)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);

    await expect(
      createBlockchainReadService({
        provider,
        contract: fakeContract(),
        chainId: 31337
      }).getPermission(-1, readerWallet)
    ).rejects.toBeInstanceOf(BlockchainVerificationError);
  });

  it("verifies an AssetRegistered transaction for the expected owner, asset reference, and hash", async () => {
    const receipt = assetRegisteredReceipt();
    const provider = fakeProvider(31337n, receipt);
    const service = createBlockchainReadService({
      provider,
      contract: fakeContract(),
      contractAddress,
      chainId: 31337
    });

    await expect(
      service.verifyAssetRegistration({
        transactionHash,
        applicationAssetId: appAssetId,
        expectedOwnerWallet: ownerWallet,
        expectedSha256: "a".repeat(64)
      })
    ).resolves.toEqual({
      blockchainAssetId: deriveBlockchainAssetId(appAssetId).toString(),
      transactionHash,
      blockNumber: 12345,
      ownerWallet,
      sha256: "a".repeat(64)
    });

    expect(provider.getTransactionReceipt).toHaveBeenCalledWith(transactionHash);
  });

  it("rejects failed or unrelated registration receipts", async () => {
    const cases = [
      assetRegisteredReceipt({ status: 0 }),
      assetRegisteredReceipt({ from: readerWallet }),
      assetRegisteredReceipt({ owner: readerWallet }),
      assetRegisteredReceipt({ assetId: 123n }),
      assetRegisteredReceipt({ sha256Hash: `0x${"b".repeat(64)}` }),
      assetRegisteredReceipt({ to: readerWallet }),
      assetRegisteredReceipt({ address: readerWallet }),
      { ...assetRegisteredReceipt(), logs: [] }
    ];

    for (const receipt of cases) {
      const service = createBlockchainReadService({
        provider: fakeProvider(31337n, receipt),
        contract: fakeContract(),
        contractAddress,
        chainId: 31337
      });

      await expect(
        service.verifyAssetRegistration({
          transactionHash,
          applicationAssetId: appAssetId,
          expectedOwnerWallet: ownerWallet,
          expectedSha256: "a".repeat(64)
        })
      ).rejects.toBeInstanceOf(BlockchainVerificationError);
    }
  });

  it("verifies an AccessGranted transaction for expected asset, owner, grantee, permission, and validity", async () => {
    const receipt = accessGrantedReceipt({ assetId: 100n, permission: 2, validFrom: 10, validUntil: 20 });
    const provider = fakeProvider(31337n, receipt);
    const service = createBlockchainReadService({
      provider,
      contract: fakeContract(),
      contractAddress,
      chainId: 31337
    });

    await expect(
      service.verifyAccessGrant({
        transactionHash,
        blockchainAssetId: "100",
        expectedOwnerWallet: ownerWallet,
        expectedGranteeWallet: readerWallet,
        expectedAccessType: "WRITE",
        expectedValidFrom: 10,
        expectedValidUntil: 20
      })
    ).resolves.toEqual({
      blockchainAssetId: "100",
      transactionHash,
      blockNumber: 12346,
      ownerWallet,
      granteeWallet: readerWallet,
      accessType: "WRITE",
      validFrom: 10,
      validUntil: 20
    });
  });

  it("rejects failed or unrelated access grant receipts", async () => {
    const cases = [
      accessGrantedReceipt({ status: 0 }),
      accessGrantedReceipt({ from: readerWallet }),
      accessGrantedReceipt({ owner: readerWallet }),
      accessGrantedReceipt({ grantee: ownerWallet }),
      accessGrantedReceipt({ assetId: 101n }),
      accessGrantedReceipt({ permission: 2 }),
      accessGrantedReceipt({ validFrom: 1 }),
      accessGrantedReceipt({ validUntil: 99 }),
      accessGrantedReceipt({ to: readerWallet }),
      accessGrantedReceipt({ address: readerWallet }),
      { ...accessGrantedReceipt(), logs: [] }
    ];

    for (const receipt of cases) {
      const service = createBlockchainReadService({
        provider: fakeProvider(31337n, receipt),
        contract: fakeContract(),
        contractAddress,
        chainId: 31337
      });

      await expect(
        service.verifyAccessGrant({
          transactionHash,
          blockchainAssetId: "100",
          expectedOwnerWallet: ownerWallet,
          expectedGranteeWallet: readerWallet,
          expectedAccessType: "READ",
          expectedValidFrom: 0,
          expectedValidUntil: 0
        })
      ).rejects.toBeInstanceOf(BlockchainVerificationError);
    }
  });

  it("verifies an AccessRevoked transaction for expected asset, owner, and grantee", async () => {
    const receipt = accessRevokedReceipt({ assetId: 100n });
    const provider = fakeProvider(31337n, receipt);
    const service = createBlockchainReadService({
      provider,
      contract: fakeContract(),
      contractAddress,
      chainId: 31337
    });

    await expect(
      service.verifyAccessRevoke({
        transactionHash,
        blockchainAssetId: "100",
        expectedOwnerWallet: ownerWallet,
        expectedGranteeWallet: readerWallet
      })
    ).resolves.toEqual({
      blockchainAssetId: "100",
      transactionHash,
      blockNumber: 12347,
      ownerWallet,
      granteeWallet: readerWallet
    });
  });

  it("rejects failed or unrelated access revoke receipts", async () => {
    const cases = [
      accessRevokedReceipt({ status: 0 }),
      accessRevokedReceipt({ from: readerWallet }),
      accessRevokedReceipt({ owner: readerWallet }),
      accessRevokedReceipt({ grantee: ownerWallet }),
      accessRevokedReceipt({ assetId: 101n }),
      accessRevokedReceipt({ to: readerWallet }),
      accessRevokedReceipt({ address: readerWallet }),
      { ...accessRevokedReceipt(), logs: [] }
    ];

    for (const receipt of cases) {
      const service = createBlockchainReadService({
        provider: fakeProvider(31337n, receipt),
        contract: fakeContract(),
        contractAddress,
        chainId: 31337
      });

      await expect(
        service.verifyAccessRevoke({
          transactionHash,
          blockchainAssetId: "100",
          expectedOwnerWallet: ownerWallet,
          expectedGranteeWallet: readerWallet
        })
      ).rejects.toBeInstanceOf(BlockchainVerificationError);
    }
  });

  it("verifies a VersionCommitted transaction for expected asset, committer, hash, and version", async () => {
    const receipt = versionCommittedReceipt({ assetId: 100n, version: 3 });
    const provider = fakeProvider(31337n, receipt);
    const service = createBlockchainReadService({
      provider,
      contract: fakeContract(),
      contractAddress,
      chainId: 31337
    });

    await expect(
      service.verifyVersionCommit({
        transactionHash,
        blockchainAssetId: "100",
        expectedCommitterWallet: ownerWallet,
        expectedSha256: "a".repeat(64),
        expectedVersion: 3
      })
    ).resolves.toEqual({
      blockchainAssetId: "100",
      transactionHash,
      blockNumber: 12348,
      committerWallet: ownerWallet,
      sha256: "a".repeat(64),
      version: 3
    });
  });

  it("rejects failed or unrelated version commit receipts", async () => {
    const cases = [
      versionCommittedReceipt({ status: 0 }),
      versionCommittedReceipt({ from: readerWallet }),
      versionCommittedReceipt({ committer: readerWallet }),
      versionCommittedReceipt({ assetId: 101n }),
      versionCommittedReceipt({ sha256Hash: `0x${"b".repeat(64)}` }),
      versionCommittedReceipt({ version: 4 }),
      versionCommittedReceipt({ to: readerWallet }),
      versionCommittedReceipt({ address: readerWallet }),
      { ...versionCommittedReceipt(), logs: [] }
    ];

    for (const receipt of cases) {
      const service = createBlockchainReadService({
        provider: fakeProvider(31337n, receipt),
        contract: fakeContract(),
        contractAddress,
        chainId: 31337
      });

      await expect(
        service.verifyVersionCommit({
          transactionHash,
          blockchainAssetId: "100",
          expectedCommitterWallet: ownerWallet,
          expectedSha256: "a".repeat(64),
          expectedVersion: 3
        })
      ).rejects.toBeInstanceOf(BlockchainVerificationError);
    }
  });
});
