/**
 * Child process for lifecycle.test.ts: installs the process error handlers,
 * then lets a promise rejection go unhandled. Prints "STILL ALIVE" if the
 * process survives it (development mode).
 */
import { installProcessErrorHandlers } from "../../src/dev-engine/lifecycle.js";
import { configureLogger } from "../../src/internal/logger.js";

configureLogger({ color: false, timestamps: false, level: "info" });
installProcessErrorHandlers();

void Promise.reject(new Error("backend exploded"));

setTimeout(() => {
  console.log("STILL ALIVE");
  process.exit(0);
}, 300);
