import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { UserModel } from "../models/user.js";

const sessionWallet = "0x1111111111111111111111111111111111111111";
const suppliedWallet = "0x2222222222222222222222222222222222222222";
const publicEncryptionKey = "base64-public-encryption-key-value-1234567890";

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
});

function authenticatedCookie(walletAddress = sessionWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function mockFindOne(publicKey: string | null = publicEncryptionKey) {
  return vi.spyOn(UserModel, "findOne").mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        publicKey !== null
          ? {
              walletAddress: sessionWallet,
              publicEncryptionKey: publicKey
            }
          : null
      )
    })
  } as never);
}

function mockProfileUpdate(profile?: Partial<{ displayName: string; email: string; kycStatus: string; publicEncryptionKey: string }>) {
  return vi.spyOn(UserModel, "findOneAndUpdate").mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        walletAddress: sessionWallet,
        displayName: profile?.displayName ?? "Rohit Sharma",
        email: profile?.email ?? "rohit@example.com",
        kycStatus: profile?.kycStatus ?? "PENDING",
        publicEncryptionKey: profile?.publicEncryptionKey
      })
    })
  } as never);
}

describe("current user profile routes", () => {
  it("requires authentication to read current user's profile", async () => {
    const response = await request(createApp()).get("/api/users/me").expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });

  it("returns the profile for the authenticated session wallet", async () => {
    const updateSpy = mockProfileUpdate({ publicEncryptionKey });

    const response = await request(createApp()).get("/api/users/me").set("Cookie", authenticatedCookie()).expect(200);

    expect(response.body).toEqual({
      walletAddress: sessionWallet,
      displayName: "Rohit Sharma",
      email: "rohit@example.com",
      kycStatus: "PENDING",
      publicEncryptionKey
    });
    expect(updateSpy).toHaveBeenCalledWith(
      { walletAddress: sessionWallet },
      {
        $setOnInsert: {
          walletAddress: sessionWallet,
          kycStatus: "PENDING"
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );
  });

  it("requires authentication to update current user's profile", async () => {
    const response = await request(createApp())
      .patch("/api/users/me")
      .send({ displayName: "New Name" })
      .expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });

  it("updates only displayName and email for the authenticated session wallet", async () => {
    const updateSpy = mockProfileUpdate({ displayName: "New Name", email: "new@example.com" });

    const response = await request(createApp())
      .patch("/api/users/me")
      .set("Cookie", authenticatedCookie())
      .send({
        displayName: " New Name ",
        email: "NEW@EXAMPLE.COM"
      })
      .expect(200);

    expect(response.body).toEqual({
      walletAddress: sessionWallet,
      displayName: "New Name",
      email: "new@example.com",
      kycStatus: "PENDING",
      publicEncryptionKey: null
    });
    expect(updateSpy).toHaveBeenCalledWith(
      { walletAddress: sessionWallet },
      {
        $set: {
          displayName: "New Name",
          email: "new@example.com"
        },
        $setOnInsert: {
          walletAddress: sessionWallet,
          kycStatus: "PENDING"
        }
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );
  });

  it("rejects profile mass assignment and protected field overwrites", async () => {
    const updateSpy = mockProfileUpdate();

    const forbiddenBodies = [
      { displayName: "Mallory", walletAddress: suppliedWallet },
      { displayName: "Mallory", kycStatus: "verified" },
      { displayName: "Mallory", publicEncryptionKey },
      { displayName: "Mallory", privateKey: "must-not-be-accepted" },
      { displayName: "Mallory", rawAESKey: "must-not-be-accepted" }
    ];

    for (const body of forbiddenBodies) {
      const response = await request(createApp())
        .patch("/api/users/me")
        .set("Cookie", authenticatedCookie())
        .send(body)
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("validates profile displayName and email", async () => {
    const updateSpy = mockProfileUpdate();

    await request(createApp())
      .patch("/api/users/me")
      .set("Cookie", authenticatedCookie())
      .send({})
      .expect(400);

    await request(createApp())
      .patch("/api/users/me")
      .set("Cookie", authenticatedCookie())
      .send({ displayName: "" })
      .expect(400);

    await request(createApp())
      .patch("/api/users/me")
      .set("Cookie", authenticatedCookie())
      .send({ displayName: "a".repeat(101) })
      .expect(400);

    await request(createApp())
      .patch("/api/users/me")
      .set("Cookie", authenticatedCookie())
      .send({ email: "not-an-email" })
      .expect(400);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("public encryption key routes", () => {
  it("requires authentication to update current user's public encryption key", async () => {
    const response = await request(createApp())
      .put("/api/users/me/encryption-key")
      .send({ publicEncryptionKey })
      .expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });

  it("updates only the authenticated user's public encryption key", async () => {
    const updateSpy = vi.spyOn(UserModel, "findOneAndUpdate").mockResolvedValue({} as never);

    const response = await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({
        walletAddress: suppliedWallet,
        publicEncryptionKey
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(updateSpy).not.toHaveBeenCalled();

    await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({ publicEncryptionKey })
      .expect(200);

    expect(updateSpy).toHaveBeenCalledWith(
      { walletAddress: sessionWallet },
      {
        $set: {
          walletAddress: sessionWallet,
          publicEncryptionKey
        }
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true
      }
    );
  });

  it("rejects private encryption keys and other sensitive fields", async () => {
    const updateSpy = vi.spyOn(UserModel, "findOneAndUpdate").mockResolvedValue({} as never);

    const response = await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({
        publicEncryptionKey,
        privateEncryptionKey: "must-not-be-accepted",
        privateKey: "must-not-be-accepted"
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("validates public encryption key encoding and size", async () => {
    const updateSpy = vi.spyOn(UserModel, "findOneAndUpdate").mockResolvedValue({} as never);

    await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({ publicEncryptionKey: "too-short" })
      .expect(400);

    await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({ publicEncryptionKey: "!".repeat(64) })
      .expect(400);

    await request(createApp())
      .put("/api/users/me/encryption-key")
      .set("Cookie", authenticatedCookie())
      .send({ publicEncryptionKey: "a".repeat(4097) })
      .expect(400);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("returns a user's public encryption key", async () => {
    const findSpy = mockFindOne();

    const response = await request(createApp()).get(`/api/users/${sessionWallet}/public-key`).expect(200);

    expect(response.body).toEqual({
      walletAddress: sessionWallet,
      publicEncryptionKey
    });
    expect(findSpy).toHaveBeenCalledWith({ walletAddress: sessionWallet });
  });

  it("returns 404 when a public encryption key is missing", async () => {
    mockFindOne(null);

    const response = await request(createApp()).get(`/api/users/${sessionWallet}/public-key`).expect(404);

    expect(response.body.error).toEqual({
      code: "PUBLIC_KEY_NOT_FOUND",
      message: "Public encryption key not found"
    });
  });

  it("validates public-key lookup wallet params", async () => {
    const findSpy = mockFindOne();

    const response = await request(createApp()).get("/api/users/not-a-wallet/public-key").expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(findSpy).not.toHaveBeenCalled();
  });
});
