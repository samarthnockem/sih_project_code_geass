import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

async function main() {
  await connectDatabase();

  const app = createApp();
  const port = env.NODE_ENV === "production" ? Number(process.env.PORT ?? env.PORT) : 4000;
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Secure Vault backend listening");
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Shutting down backend");
    server.close(async (error) => {
      if (error) {
        logger.error({ errorName: error.name }, "Error while closing server");
        process.exit(1);
      }

      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  logger.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Backend failed to start");
  process.exit(1);
});
