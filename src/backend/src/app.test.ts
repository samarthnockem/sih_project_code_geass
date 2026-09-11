import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import * as database from "./config/database.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend security baseline", () => {
  it("returns health status", async () => {
    const response = await request(createApp()).get("/api/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      service: "secure-vault-backend"
    });
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("uses centralized 404 responses", async () => {
    const response = await request(createApp()).get("/missing").expect(404);

    expect(response.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Route not found: GET /missing"
    });
  });

  it("uses centralized malformed JSON responses", async () => {
    const response = await request(createApp())
      .post("/api/health")
      .set("content-type", "application/json")
      .send("{ bad json")
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "MALFORMED_JSON",
      message: "Request body contains malformed JSON"
    });
  });

  it("rejects oversized JSON requests without stack traces", async () => {
    const response = await request(createApp())
      .post("/api/auth/verify")
      .set("content-type", "application/json")
      .send({
        message: "x".repeat(1024 * 1024 + 1),
        nonce: "a".repeat(64),
        signature: "signature"
      })
      .expect(413);

    expect(response.body).toEqual({
      error: {
        code: "REQUEST_TOO_LARGE",
        message: "Request body exceeds the configured size limit"
      }
    });
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("reports database readiness", async () => {
    vi.spyOn(database, "isDatabaseReady").mockReturnValue(true);

    const response = await request(createApp()).get("/api/ready").expect(200);

    expect(response.body).toEqual({
      status: "ready",
      database: "connected"
    });
  });

  it("reports when database is not ready", async () => {
    vi.spyOn(database, "isDatabaseReady").mockReturnValue(false);

    const response = await request(createApp()).get("/api/ready").expect(503);

    expect(response.body).toEqual({
      status: "not_ready",
      database: "disconnected"
    });
  });
});
