import { Router } from "express";
import { isDatabaseReady } from "../config/database.js";

export const readyRouter = Router();

readyRouter.get("/", (_req, res) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({
      status: "not_ready",
      database: "disconnected"
    });
  }

  return res.json({
    status: "ready",
    database: "connected"
  });
});
