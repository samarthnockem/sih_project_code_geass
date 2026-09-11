import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { attachSession } from "./auth/session.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { generalApiLimiter } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRouter } from "./routes/health.js";
import { activityRouter } from "./routes/activity.js";
import { authRouter } from "./routes/auth.js";
import { readyRouter } from "./routes/ready.js";
import { usersRouter } from "./routes/users.js";
import { assetsRouter } from "./routes/assets.js";
import { foldersRouter } from "./routes/folders.js";
import { kycRouter } from "./routes/kyc.js";
import { blockchainRouter } from "./routes/blockchain.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(attachSession);
  app.use(requestLogger);

  app.use("/api", generalApiLimiter);
  app.use("/api/activity", activityRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/folders", foldersRouter);
  app.use("/api/blockchain", blockchainRouter);
  app.use("/api/kyc", kycRouter);
  app.use("/api/health", healthRouter);
  app.use("/api/ready", readyRouter);
  app.use("/api/users", usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
