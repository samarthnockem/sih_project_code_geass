import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { HttpError } from "../errors/http-error.js";
import { RequestValidationError } from "./validate-request.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
    return res.status(413).json({
      error: {
        code: "REQUEST_TOO_LARGE",
        message: "Request body exceeds the configured size limit"
      }
    });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: {
        code: "MALFORMED_JSON",
        message: "Request body contains malformed JSON"
      }
    });
  }

  if (error instanceof RequestValidationError || error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request input"
      }
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: {
        code: error.code === "LIMIT_FILE_SIZE" ? "ENCRYPTED_ASSET_TOO_LARGE" : "UPLOAD_VALIDATION_ERROR",
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Encrypted asset exceeds the configured size limit"
            : "Invalid encrypted asset upload"
      }
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  logger.error(
    {
      errorName: error instanceof Error ? error.name : "UnknownError"
    },
    "Unhandled request error"
  );

  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error"
    }
  });
};
