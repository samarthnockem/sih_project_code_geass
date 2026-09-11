import mongoose from "mongoose";
import { env } from "./env.js";
import { logSecurityEvent, logger } from "./logger.js";

function sanitizeMongoMessage(message: string) {
  return message.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/?#]+):([^@/?#]+)@/gi, "$1[redacted]:[redacted]@");
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export function resolveMongoDatabaseName(
  mongodbUri: string,
  configuredDatabaseName: string | undefined,
  nodeEnv: string
) {
  if (configuredDatabaseName?.trim()) {
    return configuredDatabaseName.trim();
  }

  const parsed = new URL(mongodbUri);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim();

  if (databaseName) {
    return databaseName;
  }

  return nodeEnv === "test" ? "secure-vault-test" : "secure-vault";
}

export async function connectDatabase() {
  try {
    const dbName = resolveMongoDatabaseName(env.MONGODB_URI, env.MONGODB_DATABASE, env.NODE_ENV);
    await mongoose.connect(env.MONGODB_URI, {
      autoIndex: env.NODE_ENV !== "production",
      dbName
    });
    logger.info({ database: mongoose.connection.db?.databaseName ?? dbName }, "MongoDB connected");
  } catch (error) {
    const message = error instanceof Error ? sanitizeMongoMessage(error.message) : "Unknown MongoDB error";
    logSecurityEvent("database_connection_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message
    });
    throw new Error("MongoDB connection failed");
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected");
  }
}
