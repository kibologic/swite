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
}

export interface SwiteUserConfig {
  server?: ServerConfig;
  services?: ServicesConfig;
  /**
   * Package scopes that should be treated as "internal" or "private".
   * These scopes prioritize local/monorepo resolution and are forbidden from CDN redirects.
   * e.g. ["@kibologic", "@alpine"]
   */
  internalScopes?: string[];
  /**
   * Manual override for sibling repository lookup.
   * Swite will search these directories for local package source code.
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
