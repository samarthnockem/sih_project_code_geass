import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { logSecurityEvent } from "../config/logger.js";

type RateLimiterConfig = {
  windowMs: number;
  max: number;
  securityEvent?: string;
};

const rateLimitResponse = {
  error: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later."
  }
};

export function createRateLimiter({ windowMs, max, securityEvent = "rate_limit_exceeded" }: RateLimiterConfig) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logSecurityEvent(securityEvent, {
        requestId: req.id,
        method: req.method,
        route: req.path,
        ip: req.ip
      });

      res.status(429).json(rateLimitResponse);
    }
  });
}

export const generalApiLimiter = createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  securityEvent: "general_api_rate_limit_exceeded"
});

export const authLimiter = createRateLimiter({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  securityEvent: "auth_rate_limit_exceeded"
});

export const sensitiveActionLimiter = createRateLimiter({
  windowMs: env.SENSITIVE_ACTION_RATE_LIMIT_WINDOW_MS,
  max: env.SENSITIVE_ACTION_RATE_LIMIT_MAX,
  securityEvent: "sensitive_action_rate_limit_exceeded"
});
