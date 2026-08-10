import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/** Error carrying an HTTP status code — thrown by services, handled centrally. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg: string) => new ApiError(400, msg);
export const unauthorized = (msg = "Not authenticated") => new ApiError(401, msg);
export const forbidden = (msg = "Not allowed") => new ApiError(403, msg);
export const notFound = (msg = "Not found") => new ApiError(404, msg);

/** Wrap async route handlers so rejections reach the central error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

/** Central error handler — converts ApiError / ZodError / anything else into JSON. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", issues: err.issues.map((i) => i.message) });
    return;
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal server error" });
}

export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json(data);
