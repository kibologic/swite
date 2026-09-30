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
export {
  SwiteProxyUnreachableError,
  SwiteProxyTimeoutError,
} from "./adapters/proxy/SwiteProxyError.js";
export { sendProxyError, describeProxyFailure } from "./adapters/proxy/gateway.js";
export type { GatewayErrorBody, GatewayFailure } from "./adapters/proxy/gateway.js";
export type { SwiteServerInfo, FrameworkSource } from "./dev-engine/server-info.js";
export { SwitePortInUseError, SwiteListenError } from "./dev-engine/listen-errors.js";
export {
  installProcessErrorHandlers,
  installGracefulShutdown,
} from "./dev-engine/lifecycle.js";
export type { StopSummary } from "./dev-engine/lifecycle.js";
export {
  configureLogger,
  configureLoggerFromProcess,
  getLogger,
  logger,
} from "./internal/logger.js";
export type { LogLevel, LogSink, Logger } from "./internal/logger.js";
