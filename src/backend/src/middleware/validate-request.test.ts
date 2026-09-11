import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "./error-handler.js";
import { validateRequest } from "./validate-request.js";

function createValidationTestApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.post(
    "/test-validation/:assetId",
    validateRequest({
      params: z
        .object({
          assetId: z.string().regex(/^[a-fA-F0-9]{24}$/)
        })
        .strict(),
      query: z
        .object({
          dryRun: z.enum(["true", "false"]).optional()
        })
        .strict(),
      body: z
        .object({
          filename: z.string().trim().min(1).max(120),
          sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
        })
        .strict()
    }),
    (req, res) => {
      res.status(200).json({
        params: req.params,
        query: req.query,
        body: req.body
      });
    }
  );
  app.use(errorHandler);

  return app;
}

describe("validateRequest middleware", () => {
  it("passes allow-listed body, params, and query fields", async () => {
    const response = await request(createValidationTestApp())
      .post("/test-validation/507f1f77bcf86cd799439011?dryRun=true")
      .send({
        filename: "document.enc",
        sha256: "a".repeat(64)
      })
      .expect(200);

    expect(response.body.body).toEqual({
      filename: "document.enc",
      sha256: "a".repeat(64)
    });
  });

  it("rejects missing fields", async () => {
    const response = await request(createValidationTestApp())
      .post("/test-validation/507f1f77bcf86cd799439011")
      .send({
        sha256: "a".repeat(64)
      })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request input"
      }
    });
  });

  it("rejects wrong types", async () => {
    const response = await request(createValidationTestApp())
      .post("/test-validation/507f1f77bcf86cd799439011")
      .send({
        filename: 123,
        sha256: "a".repeat(64)
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unexpected malformed data", async () => {
    const response = await request(createValidationTestApp())
      .post("/test-validation/507f1f77bcf86cd799439011?dryRun=true&admin=true")
      .send({
        filename: "document.enc",
        sha256: "a".repeat(64),
        privateKey: "must-not-be-accepted"
      })
      .expect(400);

    expect(response.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request input"
    });
  });

  it("rejects oversized fields", async () => {
    const response = await request(createValidationTestApp())
      .post("/test-validation/507f1f77bcf86cd799439011")
      .send({
        filename: "x".repeat(121),
        sha256: "a".repeat(64)
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
