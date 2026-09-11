import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachSession, buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import type { BlockchainReadService, Permission } from "../services/blockchain-read.js";
import { createAssetAuthorizationHelpers } from "./asset-authorization.js";
import { requireAuth } from "./require-auth.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";

function mockBlockchain(overrides: Partial<BlockchainReadService> = {}): BlockchainReadService {
  return {
    getAssetOwner: vi.fn().mockResolvedValue(ownerWallet),
    getPermission: vi.fn().mockResolvedValue("NONE" satisfies Permission),
    getCurrentHash: vi.fn().mockResolvedValue(`0x${"a".repeat(64)}`),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    verifyAssetRegistration: vi.fn(),
    verifyAccessGrant: vi.fn(),
    ...overrides
  };
}

function authenticatedCookie(walletAddress = ownerWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function createProtectedApp(blockchain: BlockchainReadService) {
  const app = express();
  const helpers = createAssetAuthorizationHelpers({ blockchain });

  app.use(express.json());
  app.use(attachSession);
  app.get("/assets/:assetId/owner", requireAuth, helpers.requireAssetOwner, (_req, res) => {
    res.json({ authorized: true });
  });
  app.post("/assets/:assetId/read", requireAuth, helpers.requireAssetRead, (_req, res) => {
    res.json({ authorized: true });
  });
  app.post("/assets/:assetId/write", requireAuth, helpers.requireAssetWrite, (_req, res) => {
    res.json({ authorized: true });
  });

  return app;
}

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

describe("asset authorization helpers", () => {
  it("requires authentication before checking blockchain", async () => {
    const blockchain = mockBlockchain();

    const response = await request(createProtectedApp(blockchain)).post("/assets/1/read").expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
    expect(blockchain.getPermission).not.toHaveBeenCalled();
  });

  it("requires blockchain owner to match the authenticated wallet", async () => {
    const blockchain = mockBlockchain();

    await request(createProtectedApp(blockchain))
      .get("/assets/99/owner")
      .set("Cookie", authenticatedCookie(ownerWallet))
      .expect(200);

    expect(blockchain.getAssetOwner).toHaveBeenCalledWith("99");

    const denied = await request(createProtectedApp(blockchain))
      .get("/assets/99/owner")
      .set("Cookie", authenticatedCookie(otherWallet))
      .expect(403);

    expect(denied.body.error).toEqual({
      code: "ASSET_ACCESS_DENIED",
      message: "Asset access denied"
    });
  });

  it("allows READ when blockchain returns READ or WRITE", async () => {
    const blockchain = mockBlockchain({
      getPermission: vi.fn().mockResolvedValueOnce("READ").mockResolvedValueOnce("WRITE")
    });
    const app = createProtectedApp(blockchain);

    await request(app).post("/assets/7/read").set("Cookie", authenticatedCookie()).expect(200);
    await request(app).post("/assets/7/read").set("Cookie", authenticatedCookie()).expect(200);

    expect(blockchain.getPermission).toHaveBeenCalledWith("7", ownerWallet);
  });

  it("denies READ when blockchain returns NONE even if request body claims permission", async () => {
    const blockchain = mockBlockchain({
      getPermission: vi.fn().mockResolvedValue("NONE")
    });

    const response = await request(createProtectedApp(blockchain))
      .post("/assets/7/read")
      .set("Cookie", authenticatedCookie())
      .send({
        permission: "WRITE",
        mongoPermission: "WRITE"
      })
      .expect(403);

    expect(response.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(blockchain.getPermission).toHaveBeenCalledWith("7", ownerWallet);
  });

  it("allows WRITE only when blockchain returns WRITE", async () => {
    const writeBlockchain = mockBlockchain({
      getPermission: vi.fn().mockResolvedValue("WRITE")
    });
    await request(createProtectedApp(writeBlockchain))
      .post("/assets/8/write")
      .set("Cookie", authenticatedCookie())
      .expect(200);

    const readOnlyBlockchain = mockBlockchain({
      getPermission: vi.fn().mockResolvedValue("READ")
    });
    const readOnlyResponse = await request(createProtectedApp(readOnlyBlockchain))
      .post("/assets/8/write")
      .set("Cookie", authenticatedCookie())
      .expect(403);

    expect(readOnlyResponse.body.error.code).toBe("ASSET_ACCESS_DENIED");
  });

  it("fails closed when blockchain permission or ownership cannot be verified", async () => {
    const failingPermissionBlockchain = mockBlockchain({
      getPermission: vi.fn().mockRejectedValue(new Error("rpc unavailable"))
    });
    const readResponse = await request(createProtectedApp(failingPermissionBlockchain))
      .post("/assets/9/read")
      .set("Cookie", authenticatedCookie())
      .expect(403);

    const failingOwnerBlockchain = mockBlockchain({
      getAssetOwner: vi.fn().mockRejectedValue(new Error("rpc unavailable"))
    });
    const ownerResponse = await request(createProtectedApp(failingOwnerBlockchain))
      .get("/assets/9/owner")
      .set("Cookie", authenticatedCookie())
      .expect(403);

    expect(readResponse.body.error.code).toBe("ASSET_ACCESS_DENIED");
    expect(ownerResponse.body.error.code).toBe("ASSET_ACCESS_DENIED");
  });
});
