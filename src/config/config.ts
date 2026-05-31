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
   * Module aliases resolved during bare import resolution.
   * e.g. { "@/": "src/" } maps @/ imports to the src/ directory.
   */
  aliases?: Record<string, string>;
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
