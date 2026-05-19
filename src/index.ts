/*
 * SWITE - SWISS Development Server
 * Main exports
 */

export { SwiteServer } from "./dev-engine/server.js";
export type { SwiteConfig } from "./dev-engine/server.js";
export { SwiteBuilder, build } from "./build-engine/builder.js";
export type { BuildConfig } from "./build-engine/builder.js";
export { ModuleResolver } from "./resolution/resolver.js";
export { HMREngine } from "./dev-engine/hmr/hmr.js";
export { defineConfig } from "./config/config.js";
export type {
  SwiteUserConfig,
  ServerConfig,
  ServicesConfig,
  PythonServiceConfig,
} from "./config/config.js";
export { proxyToPython, initPythonProxy, setProductionMode } from "./adapters/proxy/proxyToPython.js";
export type { ProxyOptions } from "./adapters/proxy/proxyToPython.js";
export { SwiteProxyError } from "./adapters/proxy/SwiteProxyError.js";
export { loadUserConfig } from "./config/config-loader.js";
export {
  startPythonDevService,
  stopPythonDevService,
} from "./dev-engine/pythonDevManager.js";
