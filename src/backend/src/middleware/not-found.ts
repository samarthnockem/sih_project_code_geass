import type { RequestHandler } from "express";
import { HttpError } from "../errors/http-error.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
};
