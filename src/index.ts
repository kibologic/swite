/*
 * SWITE - SWISS Development Server
 * Main exports
 */

export { SwiteServer } from "./server.js";
export type { SwiteConfig } from "./server.js";
export { SwiteBuilder, build } from "./builder.js";
export type { BuildConfig } from "./builder.js";
export { ModuleResolver } from "./resolver.js";
export { HMREngine } from "./hmr.js";
export { defineConfig } from "./config.js";
export type {
  SwiteUserConfig,
  ServerConfig,
  ServicesConfig,
  PythonServiceConfig,
} from "./config.js";
export { proxyToPython, initPythonProxy } from "./proxy/proxyToPython.js";
export type { ProxyOptions } from "./proxy/proxyToPython.js";
export { SwiteProxyError } from "./proxy/SwiteProxyError.js";
