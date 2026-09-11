import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSessionCookie, clearSessionsForTests, createSession } from "../auth/session.js";
import { createApp } from "../app.js";
import { UserModel } from "../models/user.js";

const sessionWallet = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  clearSessionsForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function authenticatedCookie(walletAddress = sessionWallet) {
  return buildSessionCookie(createSession(walletAddress));
}

function mockKycUpdate(profile?: Partial<{ kycStatus: string; verificationMethod: string; verifiedAt: Date }>) {
  return vi.spyOn(UserModel, "findOneAndUpdate").mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        walletAddress: sessionWallet,
        kycStatus: profile?.kycStatus ?? "PENDING",
        verificationMethod: profile?.verificationMethod,
        verifiedAt: profile?.verifiedAt
      })
    })
  } as never);
}

describe("mock KYC routes", () => {
  it("requires authentication to read KYC status", async () => {
    const response = await request(createApp()).get("/api/kyc/status").expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });

  it("returns safe KYC status for the authenticated session wallet", async () => {
    const updateSpy = mockKycUpdate();

    const response = await request(createApp()).get("/api/kyc/status").set("Cookie", authenticatedCookie()).expect(200);

    expect(response.body).toEqual({
      walletAddress: sessionWallet,
      kycStatus: "PENDING",
      verificationMethod: null,
      verifiedAt: null
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

  it("requires authentication to run mock verification", async () => {
    const response = await request(createApp()).post("/api/kyc/mock-verify").send({}).expect(401);

    expect(response.body.error).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  });

  it("marks the authenticated session wallet as mock verified by default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T00:00:00.000Z"));
    const verifiedAt = new Date();
    const updateSpy = mockKycUpdate({
      kycStatus: "VERIFIED",
      verificationMethod: "MOCK",
      verifiedAt
    });

    const response = await request(createApp())
      .post("/api/kyc/mock-verify")
      .set("Cookie", authenticatedCookie())
      .send({})
      .expect(200);

    expect(response.body).toEqual({
      walletAddress: sessionWallet,
      kycStatus: "VERIFIED",
      verificationMethod: "MOCK",
      verifiedAt: verifiedAt.toISOString(),
      demoOnly: true,
      message: "Mock KYC verification is demo-only and is not production identity verification."
    });
    expect(updateSpy).toHaveBeenCalledWith(
      { walletAddress: sessionWallet },
      {
        $set: {
          kycStatus: "VERIFIED",
          verificationMethod: "MOCK",
          verifiedAt
        },
        $setOnInsert: {
          walletAddress: sessionWallet
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

  it("allows mock verification with no request body", async () => {
    const updateSpy = mockKycUpdate({
      kycStatus: "VERIFIED",
      verificationMethod: "MOCK",
      verifiedAt: new Date("2026-09-09T00:00:00.000Z")
    });

    const response = await request(createApp())
      .post("/api/kyc/mock-verify")
      .set("Cookie", authenticatedCookie())
      .expect(200);

    expect(response.body.kycStatus).toBe("VERIFIED");
    expect(response.body.demoOnly).toBe(true);
    expect(updateSpy).toHaveBeenCalledOnce();
  });

  it("accepts only allowed mock KYC statuses", async () => {
    for (const kycStatus of ["PENDING", "VERIFIED", "REJECTED"]) {
      mockKycUpdate({ kycStatus, verificationMethod: "MOCK" });

      const response = await request(createApp())
        .post("/api/kyc/mock-verify")
        .set("Cookie", authenticatedCookie())
        .send({ kycStatus })
        .expect(200);

      expect(response.body.kycStatus).toBe(kycStatus);
      vi.restoreAllMocks();
    }
  });

  it("rejects identity document contents, identity numbers, wallet spoofing, and secrets", async () => {
    const updateSpy = mockKycUpdate();
    const forbiddenBodies = [
      { kycStatus: "VERIFIED", aadhaarNumber: "123412341234" },
      { kycStatus: "VERIFIED", panNumber: "ABCDE1234F" },
      { kycStatus: "VERIFIED", passportNumber: "P1234567" },
      { kycStatus: "VERIFIED", drivingLicenceNumber: "DL123456789" },
      { kycStatus: "VERIFIED", documentContents: "base64-document" },
      { kycStatus: "VERIFIED", walletAddress: "0x2222222222222222222222222222222222222222" },
      { kycStatus: "VERIFIED", privateKey: "must-not-be-accepted" },
      { kycStatus: "VERIFIED", seedPhrase: "must not be accepted" }
    ];

    for (const body of forbiddenBodies) {
      const response = await request(createApp())
        .post("/api/kyc/mock-verify")
        .set("Cookie", authenticatedCookie())
        .send(body)
        .expect(400);

      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects unsupported KYC statuses", async () => {
    const updateSpy = mockKycUpdate();

    const response = await request(createApp())
      .post("/api/kyc/mock-verify")
      .set("Cookie", authenticatedCookie())
      .send({ kycStatus: "APPROVED" })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
