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
}

/**
 * Define swite configuration with full TypeScript validation.
 * Unknown fields are rejected at compile time.
 */
export function defineConfig(config: SwiteUserConfig): SwiteUserConfig {
  return config;
}
