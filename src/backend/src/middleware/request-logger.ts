import type { RequestHandler } from "express";
import { logger } from "../config/logger.js";

function getRouteLabel(req: Parameters<RequestHandler>[0]) {
  if (!req.route?.path) {
    return "unmatched";
  }

  const routePath = Array.isArray(req.route.path) ? req.route.path[0] : req.route.path;
  return `${req.baseUrl}${routePath}`.replace(/\/$/, "") || "/";
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info(
      {
        requestId: req.id,
        method: req.method,
        route: getRouteLabel(req),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      },
      "request completed"
    );
  });

  next();
};
