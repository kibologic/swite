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
   * Names of sibling monorepos to search for framework packages.
   * Defaults to ['swiss-lib']. Override when your framework lives in a differently-named repo.
   */
  siblingRepositories?: string[];
  /**
   * Control the compiler path fixup that rewrites `/swiss-lib/` → `/swiss-packages/`.
   * Disable entirely or supply custom from/to pairs when your project uses different paths.
   */
  compilerPathFixup?: {
    /** When false, no path fixup is applied. Defaults to true for backward compatibility. */
    enabled?: boolean;
    /** Custom replacement patterns. Defaults to the built-in swiss-lib → swiss-packages pairs. */
    patterns?: Array<{ from: string; to: string }>;
  };
}

/**
 * Define swite configuration with full TypeScript validation.
 * Unknown fields are rejected at compile time.
 */
export function defineConfig(config: SwiteUserConfig): SwiteUserConfig {
  return config;
}
