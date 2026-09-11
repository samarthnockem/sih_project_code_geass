import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../config/logger.js";
import { errorHandler } from "./error-handler.js";

function mockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };

  return res as unknown as Response & typeof res;
}

describe("errorHandler logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log secret-bearing unhandled error messages or stacks", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const error = new Error("rawAESKey=raw-aes-secret password=plaintext-password seedPhrase=seed phrase");
    const res = mockResponse();

    errorHandler(error, {} as Request, res, (() => undefined) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("raw-aes-secret");
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("plaintext-password");
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("seed phrase");
    expect(errorSpy).toHaveBeenCalledWith(
      {
        errorName: "Error"
      },
      "Unhandled request error"
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("raw-aes-secret");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("plaintext-password");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("seed phrase");
  });
});
