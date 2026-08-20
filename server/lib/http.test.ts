import { describe, it, expect, vi } from "vitest";
import { ApiError, badRequest, unauthorized, forbidden, notFound, ok } from "./http.js";

describe("ApiError", () => {
  it("creates an error with status and message", () => {
    const err = new ApiError(404, "Not found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err).toBeInstanceOf(Error);
  });

  it("inherits Error name", () => {
    const err = new ApiError(400, "Bad");
    expect(err.name).toBe("Error");
  });
});

describe("error factories", () => {
  it("badRequest returns 400", () => {
    expect(badRequest("invalid").status).toBe(400);
  });

  it("unauthorized returns 401 with default message", () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.message).toBe("Not authenticated");
  });

  it("unauthorized accepts custom message", () => {
    expect(unauthorized("no token").message).toBe("no token");
  });

  it("forbidden returns 403 with default message", () => {
    const err = forbidden();
    expect(err.status).toBe(403);
    expect(err.message).toBe("Not allowed");
  });

  it("notFound returns 404", () => {
    expect(notFound().status).toBe(404);
  });
});

describe("ok", () => {
  it("sends JSON with 200 by default", () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    ok(res, { hello: "world" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ hello: "world" });
  });

  it("sends with custom status", () => {
    const json = vi.fn();
    const res = { status: vi.fn().mockReturnValue({ json }) } as any;
    ok(res, { created: true }, 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
