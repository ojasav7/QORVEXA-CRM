// Structured logger — JSON output in production, human-readable in development.
// No external dependencies; wraps console with log levels and context fields.
//
// Usage:
//   import { logger } from "./logger.js";
//   logger.info({ userId: "u1", action: "login" }, "User logged in");
//   logger.error({ err, requestId: "r1" }, "Request failed");
//
// The logger respects LOG_LEVEL env var (debug | info | warn | error, default: info).
// In production (NODE_ENV=production), output is JSON for log aggregators.
// In development, output is human-readable with colors.

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

const isProduction = process.env.NODE_ENV === "production";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatMessage(level: LogLevel, msg: string, fields?: Record<string, unknown>): string {
  if (isProduction) {
    // JSON lines for log aggregators (Datadog, CloudWatch, etc.)
    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      msg,
    };
    if (fields) Object.assign(entry, fields);
    return JSON.stringify(entry);
  }

  // Human-readable for local dev
  const color = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" }[level];
  const reset = "\x1b[0m";
  const ts = new Date().toISOString().slice(11, 19);
  const fieldsStr = fields && Object.keys(fields).length > 0
    ? " " + JSON.stringify(fields)
    : "";
  return `${color}${ts} ${level.toUpperCase().padEnd(5)}${reset} ${msg}${fieldsStr}`;
}

function log(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const formatted = formatMessage(level, msg, fields);
  if (level === "error") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
  child: (context: Record<string, unknown>) => ({
    debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, { ...context, ...fields }),
    info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, { ...context, ...fields }),
    warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, { ...context, ...fields }),
    error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, { ...context, ...fields }),
  }),
};
