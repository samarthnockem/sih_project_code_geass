import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { AssetModel } from "../models/asset.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import * as blockchainRead from "../services/blockchain-read.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const readerWallet = "0x2222222222222222222222222222222222222222";
const validSha256 = "a".repeat(64);

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = ownerWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function sortedQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(value)
      })
    })
  };
}

function selectQueryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function mockBlockchain(overrides: Partial<ReturnType<typeof defaultBlockchain>> = {}) {
  const blockchain = {
    ...defaultBlockchain(),
    ...overrides
  };
  vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue(blockchain);
  return blockchain;
}

function defaultBlockchain() {
  return {
    getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue("WRITE"),
    getCurrentHash: vi.fn().mockResolvedValue(`0x${validSha256}`),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    verifyAssetRegistration: vi.fn(),
    verifyAccessGrant: vi.fn()
  };
}

describe("blockchain records route", () => {
  it("requires authentication", async () => {
    const assetFindSpy = vi.spyOn(AssetModel, "find");

    await request(createApp()).get("/api/blockchain/records").expect(401);

    expect(assetFindSpy).not.toHaveBeenCalled();
  });

  it("returns safe blockchain display data for owned and wrapped-key assets", async () => {
    const ownedAssetId = new mongoose.Types.ObjectId();
    const sharedAssetId = new mongoose.Types.ObjectId();
    const wrappedFindSpy = vi.spyOn(WrappedKeyModel, "find").mockReturnValue(
      selectQueryResult([
        {
          assetId: sharedAssetId
        }
      ]) as never
    );
    const assetFindSpy = vi.spyOn(AssetModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          _id: ownedAssetId,
          ownerWallet,
          filename: "owned.pdf.enc",
          sha256: validSha256,
          currentVersion: 1,
          status: "ACTIVE",
          blockchainAssetId: "100",
          registrationTransactionHash: `0x${"c".repeat(64)}`,
          registrationBlockNumber: 7,
          blockchainVerificationStatus: "verified"
        },
        {
          _id: sharedAssetId,
          ownerWallet,
          filename: "shared.pdf.enc",
          sha256: validSha256,
          currentVersion: 1,
          status: "PENDING_BLOCKCHAIN",
          blockchainAssetId: null,
          registrationTransactionHash: null,
          registrationBlockNumber: null,
          blockchainVerificationStatus: "pending"
        }
      ]) as never
    );
    const blockchain = mockBlockchain();

    const response = await request(createApp())
      .get("/api/blockchain/records")
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(wrappedFindSpy).toHaveBeenCalledWith({ userWallet: ownerWallet, active: true });
    expect(assetFindSpy).toHaveBeenCalledWith({
      $or: [{ ownerWallet }, { _id: { $in: [sharedAssetId] } }]
    });
    expect(blockchain.getPermission).toHaveBeenCalledWith("100", ownerWallet);
    expect(response.body.records).toEqual([
      {
        assetId: ownedAssetId.toString(),
        filename: "owned.pdf.enc",
        ownerWallet,
        currentHash: `0x${validSha256}`,
        currentVersion: 1,
        registrationTxHash: `0x${"c".repeat(64)}`,
        blockNumber: 7,
        status: "VERIFIED"
      },
      {
        assetId: sharedAssetId.toString(),
        filename: "shared.pdf.enc",
        ownerWallet,
        currentHash: `0x${validSha256}`,
        currentVersion: 1,
        registrationTxHash: null,
        blockNumber: null,
        status: "PENDING_BLOCKCHAIN"
      }
    ]);
  });

  it("does not return wrapped-key assets when blockchain permission resolves to NONE", async () => {
    const sharedAssetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(selectQueryResult([{ assetId: sharedAssetId }]) as never);
    vi.spyOn(AssetModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          _id: sharedAssetId,
          ownerWallet,
          filename: "shared.pdf.enc",
          sha256: validSha256,
          currentVersion: 1,
          status: "ACTIVE",
          blockchainAssetId: "100",
          registrationTransactionHash: `0x${"c".repeat(64)}`,
          registrationBlockNumber: 7,
          blockchainVerificationStatus: "verified"
        }
      ]) as never
    );
    mockBlockchain({
      getPermission: vi.fn().mockResolvedValue("NONE")
    });

    const response = await request(createApp())
      .get("/api/blockchain/records")
      .set("Cookie", authenticatedCookie(readerWallet))
      .expect(200);

    expect(response.body.records).toEqual([]);
  });

  it("marks records as failed when configured blockchain verification fails", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(selectQueryResult([]) as never);
    vi.spyOn(AssetModel, "find").mockReturnValue(
      sortedQueryResult([
        {
          _id: assetId,
          ownerWallet,
          filename: "owned.pdf.enc",
          sha256: validSha256,
          currentVersion: 1,
          status: "ACTIVE",
          blockchainAssetId: "100",
          registrationTransactionHash: `0x${"c".repeat(64)}`,
          registrationBlockNumber: 7,
          blockchainVerificationStatus: "verified"
        }
      ]) as never
    );
    mockBlockchain({
      getPermission: vi.fn().mockRejectedValue(new Error("rpc unavailable"))
    });

    const response = await request(createApp())
      .get("/api/blockchain/records")
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(response.body.records[0]).toMatchObject({
      assetId: assetId.toString(),
      status: "BLOCKCHAIN_VERIFICATION_FAILED"
    });
  });
});
