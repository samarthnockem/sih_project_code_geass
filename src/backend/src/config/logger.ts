import pino from "pino";
import { env } from "./env.js";
import { logRedaction } from "./log-redaction.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: logRedaction
});

export function logSecurityEvent(event: string, details: Record<string, unknown> = {}) {
  logger.warn({ securityEvent: event, ...details }, "security event");
}
