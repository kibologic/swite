export interface PythonServiceConfig {
  /** Path to the Python entry file, relative to project root */
  entry: string;
  /** Port the Python service listens on */
  port: number;
  /** Whether swite dev should spawn the Python process automatically */
  autoStart: boolean;
  /** Health check endpoint polled before Node server starts */
  healthCheck: string;
  /** Additional environment variables passed to the Python process */
  env?: Record<string, string>;
}

export interface ServicesConfig {
  python?: PythonServiceConfig;
}

export interface ServerConfig {
  port?: number;
  host?: string;
  /** Port for the HMR WebSocket server. Defaults to 24678. */
  hmrPort?: number;
  /** Host for the HMR WebSocket server. Defaults to server.host. */
  hmrHost?: string;
}

export interface SwiteUserConfig {
  server?: ServerConfig;
  services?: ServicesConfig;
  /**
   * Directory to serve static assets from. Defaults to "public".
   * Path is relative to the project root.
   */
  publicDir?: string;
  /**
   * Application entry file for CSS extraction. Defaults to "src/index.ui".
   * Path is relative to the project root.
   */
  entry?: string;
  /**
   * Glob patterns to exclude from HMR watching in addition to the defaults
   * (node_modules, .git, dist). Useful for generated files or large assets.
   */
  excludeFromHmr?: string[];
  /**
   * Package scopes that should be treated as "internal" or "private".
   * These scopes prioritize local/monorepo resolution and are forbidden from CDN redirects.
   * e.g. ["@kibologic", "@alpine"]
   */
  internalScopes?: string[];
  /**
   * Names of sibling monorepos to search for framework packages.
   * Defaults to ['swiss-lib']. Override when your framework lives in a differently-named repo.
   */
  siblingRepositories?: string[];
}

/**
 * Define swite configuration with full TypeScript validation.
 * Unknown fields are rejected at compile time.
 */
export function defineConfig(config: SwiteUserConfig): SwiteUserConfig {
  return config;
}
