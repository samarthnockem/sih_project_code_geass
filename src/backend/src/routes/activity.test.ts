import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { AssetModel } from "../models/asset.js";
import { AuditEventModel } from "../models/audit-event.js";
import { WrappedKeyModel } from "../models/wrapped-key.js";
import * as blockchainRead from "../services/blockchain-read.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const readerWallet = "0x2222222222222222222222222222222222222222";

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = ownerWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function selectQueryResult<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value)
    })
  };
}

function eventQueryResult<T>(value: T) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(value)
        })
      })
    })
  };
}

function mockBlockchainPermission(permission: "NONE" | "READ" | "WRITE") {
  return vi.spyOn(blockchainRead, "createBlockchainReadService").mockReturnValue({
    getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue(permission),
    getCurrentHash: vi.fn().mockResolvedValue(`0x${"a".repeat(64)}`),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    verifyAssetRegistration: vi.fn(),
    verifyAccessGrant: vi.fn()
  });
}

describe("activity routes", () => {
  it("requires authentication for global activity", async () => {
    const eventFindSpy = vi.spyOn(AuditEventModel, "find");

    await request(createApp()).get("/api/activity").expect(401);

    expect(eventFindSpy).not.toHaveBeenCalled();
  });

  it("returns safe product activity visible to the authenticated wallet", async () => {
    const assetId = new mongoose.Types.ObjectId();
    const sharedAssetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(selectQueryResult([{ assetId: sharedAssetId }]) as never);
    vi.spyOn(AssetModel, "find")
      .mockReturnValueOnce(selectQueryResult([{ _id: assetId }]) as never)
      .mockReturnValueOnce(selectQueryResult([{ _id: sharedAssetId, blockchainAssetId: "200" }]) as never);
    const blockchain = mockBlockchainPermission("READ");
    const eventFindSpy = vi.spyOn(AuditEventModel, "find").mockReturnValue(
      eventQueryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          walletAddress: ownerWallet,
          assetId,
          action: "ASSET_UPLOADED",
          detail: "owned.pdf uploaded as encrypted asset",
          blockchainTxHash: null,
          timestamp: new Date("2026-09-10T00:00:00.000Z")
        }
      ]) as never
    );

    const response = await request(createApp()).get("/api/activity").set("Cookie", authenticatedCookie()).expect(200);

    expect(eventFindSpy).toHaveBeenCalledWith({
      $or: [{ walletAddress: ownerWallet }, { assetId: { $in: [assetId, sharedAssetId] } }]
    });
    expect(blockchain.mock.results[0].value.getPermission).toHaveBeenCalledWith("200", ownerWallet);
    expect(response.body.activity[0]).toMatchObject({
      walletAddress: ownerWallet,
      assetId: assetId.toString(),
      action: "ASSET_UPLOADED",
      detail: "owned.pdf uploaded as encrypted asset",
      blockchainTxHash: null,
      timestamp: "2026-09-10T00:00:00.000Z"
    });
    expect(JSON.stringify(response.body)).not.toContain("wrappedAESKey");
    expect(JSON.stringify(response.body)).not.toContain("session");
  });

  it("returns asset activity to an authorized reader", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      selectQueryResult({
        _id: assetId,
        ownerWallet,
        blockchainAssetId: "100",
        blockchainVerificationStatus: "verified",
        status: "ACTIVE"
      }) as never
    );
    mockBlockchainPermission("READ");
    vi.spyOn(AuditEventModel, "find").mockReturnValue(
      eventQueryResult([
        {
          _id: new mongoose.Types.ObjectId(),
          walletAddress: ownerWallet,
          assetId,
          action: "ACCESS_GRANTED",
          detail: "owned.pdf access granted to reader",
          blockchainTxHash: `0x${"c".repeat(64)}`,
          timestamp: new Date("2026-09-10T01:00:00.000Z")
        }
      ]) as never
    );

    const response = await request(createApp())
      .get(`/api/activity/assets/${assetId.toString()}`)
      .set("Cookie", authenticatedCookie(readerWallet))
      .expect(200);

    expect(response.body.activity).toHaveLength(1);
    expect(response.body.activity[0]).toMatchObject({
      assetId: assetId.toString(),
      action: "ACCESS_GRANTED",
      blockchainTxHash: `0x${"c".repeat(64)}`
    });
  });

  it("denies asset activity when blockchain permission is NONE", async () => {
    const assetId = new mongoose.Types.ObjectId();
    vi.spyOn(AssetModel, "findOne").mockReturnValue(
      selectQueryResult({
        _id: assetId,
        ownerWallet,
        blockchainAssetId: "100",
        blockchainVerificationStatus: "verified",
        status: "ACTIVE"
      }) as never
    );
    mockBlockchainPermission("NONE");
    const eventFindSpy = vi.spyOn(AuditEventModel, "find");

    const response = await request(createApp())
      .get(`/api/activity/assets/${assetId.toString()}`)
      .set("Cookie", authenticatedCookie(readerWallet))
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(eventFindSpy).not.toHaveBeenCalled();
  });

  it("does not include shared asset events in global activity when chain permission is NONE", async () => {
    const sharedAssetId = new mongoose.Types.ObjectId();
    vi.spyOn(WrappedKeyModel, "find").mockReturnValue(selectQueryResult([{ assetId: sharedAssetId }]) as never);
    vi.spyOn(AssetModel, "find")
      .mockReturnValueOnce(selectQueryResult([]) as never)
      .mockReturnValueOnce(selectQueryResult([{ _id: sharedAssetId, blockchainAssetId: "200" }]) as never);
    mockBlockchainPermission("NONE");
    const eventFindSpy = vi.spyOn(AuditEventModel, "find").mockReturnValue(eventQueryResult([]) as never);

    await request(createApp()).get("/api/activity").set("Cookie", authenticatedCookie()).expect(200);

    expect(eventFindSpy).toHaveBeenCalledWith({
      $or: [{ walletAddress: ownerWallet }, { assetId: { $in: [] } }]
    });
  });
});
