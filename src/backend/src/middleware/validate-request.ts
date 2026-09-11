import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";

type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export class RequestValidationError extends Error {
  constructor() {
    super("Invalid request input");
    this.name = "RequestValidationError";
  }
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = parseAllowedFields(schemas.body, req.body);
      }

      if (schemas.params) {
        req.params = parseAllowedFields(schemas.params, req.params);
      }

      if (schemas.query) {
        parseAllowedFields(schemas.query, req.query);
      }

      next();
    } catch {
      next(new RequestValidationError());
    }
  };
}

function parseAllowedFields(schema: ZodTypeAny, value: unknown) {
  return schema.parse(value);
}
