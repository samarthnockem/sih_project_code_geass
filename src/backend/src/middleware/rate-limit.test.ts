import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../config/logger.js";
import { createRateLimiter } from "./rate-limit.js";

function createRateLimitTestApp() {
  const app = express();

  app.use(
    createRateLimiter({
      windowMs: 60_000,
      max: 2
    })
  );
  app.get("/limited", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

describe("rate limiting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests below the configured limit", async () => {
    const app = createRateLimitTestApp();

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
  });

  it("returns a consistent 429 response after the configured limit", async () => {
    const app = createRateLimitTestApp();

    await request(app).get("/limited").expect(200);
    await request(app).get("/limited").expect(200);
    const response = await request(app).get("/limited").expect(429);

    expect(response.body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later."
      }
    });
  });

  it("does not log sensitive query values when requests are rate limited", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const app = createRateLimitTestApp();

    await request(app).get("/limited?privateKey=secret-private-key").expect(200);
    await request(app).get("/limited?privateKey=secret-private-key").expect(200);
    await request(app).get("/limited?privateKey=secret-private-key").expect(429);

    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret-private-key");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/limited"
      }),
      "security event"
    );
  });
});
