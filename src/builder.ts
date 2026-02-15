/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Production Builder
 * Licensed under the MIT License.
 */

import { build as esbuild, type Plugin } from "esbuild";
import type { BuildOptions } from "esbuild";
import { UiCompiler } from "@swissjs/compiler";
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { ModuleResolver } from "./resolver.js";

export interface BuildConfig {
  root: string;
  entry: string;
  outDir: string;
  publicDir?: string;
  minify?: boolean;
  sourcemap?: boolean;
  format?: "esm" | "cjs" | "iife";
  target?: string;
  external?: string[];
}

export class SwiteBuilder {
  private compiler = new UiCompiler();
  private config: Required<BuildConfig>;
  private resolver: ModuleResolver;

  constructor(config: BuildConfig) {
    this.config = {
      root: config.root,
      entry: config.entry,
      outDir: config.outDir,
      publicDir: config.publicDir || "public",
      minify: config.minify ?? true,
      sourcemap: config.sourcemap ?? false,
      format: config.format || "esm",
      target: config.target || "es2020",
      external: config.external || [],
    };
    this.resolver = new ModuleResolver(config.root);
  }

  async build(): Promise<void> {
    const startTime = Date.now();
    console.log(chalk.cyan("\n⚡ SWITE - Production Build\n"));

    try {
      // Step 1: Clean output directory
      await this.cleanOutputDir();

      // Step 2: Compile Swiss files to temp directory
      const tempDir = path.join(this.config.root, ".swite-build");
      await this.compileSwissFiles(tempDir);

      // Step 3: Bundle with esbuild
      await this.bundle(tempDir);

      // Step 4: Copy public assets
      await this.copyPublicAssets();

      // Step 5: Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });

      const duration = Date.now() - startTime;
      console.log(chalk.green(`\n✅ Build completed in ${duration}ms\n`));
    } catch (error) {
      console.error(chalk.red("\n❌ Build failed:"), error);
      throw error;
    }
  }

  private async cleanOutputDir(): Promise<void> {
    console.log(chalk.blue("🧹 Cleaning output directory..."));
    await fs.rm(this.config.outDir, { recursive: true, force: true });
    await fs.mkdir(this.config.outDir, { recursive: true });
  }

  private async compileSwissFiles(tempDir: string): Promise<void> {
    console.log(chalk.blue("🔨 Compiling Swiss files..."));
    await fs.mkdir(tempDir, { recursive: true });

    const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
    const appRelativeToWorkspace = workspaceRoot
      ? path.relative(workspaceRoot, this.config.root)
      : "";

    // Step 1: Compile app's own files
    const srcDir = path.join(this.config.root, "src");
    const appTempDir = appRelativeToWorkspace
      ? path.join(tempDir, appRelativeToWorkspace, "src")
      : path.join(tempDir, "src");
    await this.compileDirectory(srcDir, appTempDir, "app");

    // Step 2: Discover and compile workspace dependencies
    const workspaceDeps = await this.discoverWorkspaceDependencies();
    for (const dep of workspaceDeps) {
      console.log(chalk.blue(`📦 Compiling dependency: ${dep.name}`));
      // Preserve workspace structure: libraries/skltn/src or packages/cart/src or modules/cart/src
      const depRelativeToWorkspace = workspaceRoot
        ? path.relative(workspaceRoot, dep.pkgDir)
        : "";
      const depTempDir = depRelativeToWorkspace
        ? path.join(tempDir, depRelativeToWorkspace, "src")
        : path.join(tempDir, "src");
      await this.compileDirectory(dep.srcDir, depTempDir, dep.name);
    }
  }

  private async compileDirectory(
    srcDir: string,
    tempDir: string,
    label: string,
  ): Promise<void> {
    // Find all .ui and .uix files
    const files = await this.findSwissFiles(srcDir);

    for (const file of files) {
      const relativePath = path.relative(srcDir, file);
      const outputPath = path.join(
        tempDir,
        relativePath.replace(/\.(ui|uix)$/, ".tsx"),
      );

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Compile file
      const source = await fs.readFile(file, "utf-8");
      let compiled = await this.compiler.compileAsync(source, file);

      // Rewrite .ui/.uix imports to .tsx in compiled output (esbuild needs .tsx for JSX)
      compiled = compiled.replace(
        /from\s+['"]([^'"]*\.)(ui|uix)['"]/g,
        "from '$1tsx'",
      );
      compiled = compiled.replace(
        /import\s+['"]([^'"]*\.)(ui|uix)['"]/g,
        "import '$1tsx'",
      );

      await fs.writeFile(outputPath, compiled, "utf-8");

      console.log(chalk.gray(`  ✓ [${label}] ${relativePath}`));
    }

    // Copy .ts files and rewrite .ui/.uix imports to .tsx
    const tsFiles = await this.findFiles(srcDir, /\.ts$/);
    for (const file of tsFiles) {
      const relativePath = path.relative(srcDir, file);
      const outputPath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Read source and rewrite imports
      const source = await fs.readFile(file, "utf-8");
      // Replace .ui and .uix imports with .tsx (compiled Swiss files are emitted as .tsx)
      const rewritten = source.replace(
        /from\s+['"](\.\/[^'"]*\.)(ui|uix)['"]/g,
        "from '$1tsx'",
      );
      await fs.writeFile(outputPath, rewritten, "utf-8");
    }

    // Copy .css and other static assets so imports resolve
    const cssFiles = await this.findFiles(srcDir, /\.css$/);
    for (const file of cssFiles) {
      const relativePath = path.relative(srcDir, file);
      const outputPath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.copyFile(file, outputPath);
    }
  }

  private async discoverWorkspaceDependencies(): Promise<
    Array<{ name: string; srcDir: string; pkgDir: string }>
  > {
    const deps: Array<{ name: string; srcDir: string; pkgDir: string }> = [];

    try {
      const packageJsonPath = path.join(this.config.root, "package.json");
      const packageJson = JSON.parse(
        await fs.readFile(packageJsonPath, "utf-8"),
      );

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.peerDependencies,
        ...packageJson.devDependencies,
      };

      const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
      if (!workspaceRoot) {
        return deps;
      }

      // Also discover packages imported in source files (for transitive dependencies)
      const discoveredPackages = new Set<string>();
      const srcDir = path.join(this.config.root, "src");

      // Scan source files for workspace package imports
      const scanForImports = async (dir: string) => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await scanForImports(fullPath);
            } else if (
              entry.name.endsWith(".ts") ||
              entry.name.endsWith(".ui") ||
              entry.name.endsWith(".uix")
            ) {
              const content = await fs.readFile(fullPath, "utf-8");
              // Match imports like: import ... from '@swiss-enterprise/cart/...' or '@alpine/skltn/...'
              const importMatches = content.matchAll(
                /from\s+['"](@[\w-]+\/[\w-]+)/g,
              );
              for (const match of importMatches) {
                const pkgName = match[1];
                if (pkgName && !discoveredPackages.has(pkgName)) {
                  discoveredPackages.add(pkgName);
                }
              }
            }
          }
        } catch {
          // Ignore errors
        }
      };

      if (await this.fileExists(srcDir)) {
        await scanForImports(srcDir);
      }

      for (const [depName, depVersion] of Object.entries(allDeps)) {
        // Only process workspace dependencies
        if (
          typeof depVersion === "string" &&
          depVersion.startsWith("workspace:")
        ) {
          // Extract package name (handle scoped packages)
          const pkgName = depName.startsWith("@")
            ? depName.split("/")[1]
            : depName;

          // Try common package locations
          const possibleDirs = [
            path.join(workspaceRoot, "lib", pkgName),
            path.join(workspaceRoot, "packages", pkgName),
            path.join(workspaceRoot, "packages", "runtime", pkgName),
            path.join(workspaceRoot, "packages", "plugins", pkgName),
            path.join(workspaceRoot, "packages", "domain", pkgName),
          ];

          for (const pkgDir of possibleDirs) {
            const pkgJsonPath = path.join(pkgDir, "package.json");
            if (await this.fileExists(pkgJsonPath)) {
              const pkgJson = JSON.parse(
                await fs.readFile(pkgJsonPath, "utf-8"),
              );
              // Verify it's the right package
              if (pkgJson.name === depName) {
                const srcDir = path.join(pkgDir, "src");
                if (await this.fileExists(srcDir)) {
                  deps.push({
                    name: depName,
                    srcDir,
                    pkgDir,
                  });
                  console.log(
                    chalk.gray(`  📦 Found workspace dependency: ${depName}`),
                  );
                  break;
                }
              }
            }
          }
        }
      }

      // Also process discovered packages from source files
      for (const pkgName of discoveredPackages) {
        // Skip if already in deps
        if (deps.some((d) => d.name === pkgName)) {
          continue;
        }

        // Extract package name (handle scoped packages)
        const pkgNameOnly = pkgName.startsWith("@")
          ? pkgName.split("/")[1]
          : pkgName;

        // Try common package locations
        const possibleDirs = [
          path.join(workspaceRoot, "lib", pkgNameOnly),
          path.join(workspaceRoot, "packages", pkgNameOnly),
          path.join(workspaceRoot, "packages", "runtime", pkgNameOnly),
          path.join(workspaceRoot, "packages", "plugins", pkgNameOnly),
          path.join(workspaceRoot, "packages", "domain", pkgNameOnly),
        ];

        for (const pkgDir of possibleDirs) {
          const pkgJsonPath = path.join(pkgDir, "package.json");
          if (await this.fileExists(pkgJsonPath)) {
            const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));
            // Verify it's the right package
            if (pkgJson.name === pkgName) {
              const srcDir = path.join(pkgDir, "src");
              if (await this.fileExists(srcDir)) {
                deps.push({
                  name: pkgName,
                  srcDir,
                  pkgDir,
                });
                console.log(
                  chalk.gray(
                    `  📦 Discovered transitive dependency: ${pkgName}`,
                  ),
                );
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(chalk.yellow("⚠️  Could not discover dependencies:"), error);
    }

    return deps;
  }

  private async bundle(tempDir: string): Promise<void> {
    console.log(chalk.blue("📦 Bundling with esbuild..."));

    const workspaceRoot = await this.findWorkspaceRoot(this.config.root);
    const appRelativeToWorkspace = workspaceRoot
      ? path.relative(workspaceRoot, this.config.root)
      : "";

    // Determine entry point - look for compiled version in temp
    // const entryBasename = path.basename(this.config.entry, path.extname(this.config.entry)); // Unused
    const entryExt = path.extname(this.config.entry);

    let entryPoint: string;
    // Entry point is always relative to src directory
    const entryRelativeToSrc = path.relative(
      path.join(this.config.root, "src"),
      this.config.entry,
    );

    if (entryExt === ".ui" || entryExt === ".uix") {
      // Entry was a Swiss file, use compiled .tsx version
      const entryTsx = entryRelativeToSrc.replace(/\.(ui|uix)$/, ".tsx");
      entryPoint = appRelativeToWorkspace
        ? path.join(tempDir, appRelativeToWorkspace, "src", entryTsx)
        : path.join(tempDir, "src", entryTsx);
    } else {
      // Entry is .ts or .js, use from temp
      entryPoint = appRelativeToWorkspace
        ? path.join(tempDir, appRelativeToWorkspace, "src", entryRelativeToSrc)
        : path.join(tempDir, "src", entryRelativeToSrc);
    }

    // Verify entry point exists
    if (!(await this.fileExists(entryPoint))) {
      throw new Error(
        `Entry point not found: ${entryPoint} (from ${this.config.entry})`,
      );
    }

    // Configure esbuild to resolve workspace packages from temp directory
    const absWorkingDir = workspaceRoot || this.config.root;
    // const aliases = workspaceRoot ? await this.createAliases(workspaceRoot, tempDir) : {}; // Unused

    // Mark Node.js built-ins and build-time-only deps as external
    const nodeBuiltins = [
      "@swissjs/swite",
      "fs",
      "path",
      "os",
      "crypto",
      "http",
      "https",
      "net",
      "stream",
      "util",
      "events",
      "child_process",
      "url",
      "querystring",
      "zlib",
      "assert",
      "constants",
      "tty",
      "node:fs",
      "node:path",
      "node:os",
      "node:crypto",
      "node:http",
      "node:https",
      "node:net",
      "node:stream",
      "node:util",
      "node:events",
      "node:child_process",
      "node:url",
      "node:querystring",
      "node:zlib",
      "node:assert",
      "node:constants",
      "node:tty",
      "fs/promises",
      "node:fs/promises",
    ];

    // Stub .css imports so they resolve (build output may copy CSS separately)
    const cssStubPlugin: Plugin = {
      name: "css-stub",
      setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
          contents: "export {};",
          loader: "js",
        }));
      },
    };

    // Create plugin to resolve workspace packages to compiled files
    const workspaceDeps = await this.discoverWorkspaceDependencies();
    const fileExists = this.fileExists.bind(this);
    const findWorkspaceRoot = this.findWorkspaceRoot.bind(this);
    const appRoot = this.config.root;
    const wsRoot = await findWorkspaceRoot(appRoot);
    const tempDirForPlugin = tempDir; // Capture tempDir for plugin

    // Helper function to safely join paths - filters out invalid values
    const safePathJoin = (
      ...parts: (string | undefined | null)[]
    ): string | null => {
      const validParts = parts.filter(
        (p): p is string => p != null && typeof p === "string" && p.length > 0,
      );
      if (validParts.length === 0) return null;
      try {
        return path.join(...validParts);
      } catch {
        return null;
      }
    };

    const workspaceResolverPlugin: Plugin = {
      name: "workspace-resolver",
      setup(build) {
        // Resolve workspace packages
        build.onResolve({ filter: /^@/ }, async (args) => {
          // Early return if tempDirForPlugin is invalid
          if (
            !tempDirForPlugin ||
            typeof tempDirForPlugin !== "string" ||
            tempDirForPlugin.length === 0
          ) {
            return undefined;
          }
          // Check if this is a workspace package (from dependencies or try to find it)
          let matchingDep = workspaceDeps.find((d: { name: string }) =>
            args.path.startsWith(d.name),
          );

          // If not in dependencies, try to find it in workspace
          if (!matchingDep && wsRoot) {
            const pkgName = args.path.split("/")[0];
            const pkgNameOnly = pkgName.startsWith("@")
              ? pkgName.split("/")[1]
              : pkgName;
            if (
              !wsRoot ||
              typeof wsRoot !== "string" ||
              !pkgNameOnly ||
              typeof pkgNameOnly !== "string"
            ) {
              return undefined;
            }

            const possibleDirs = [
              safePathJoin(wsRoot, "lib", pkgNameOnly),
              safePathJoin(wsRoot, "packages", pkgNameOnly),
            ].filter((p): p is string => p !== null);

            for (const pkgDir of possibleDirs) {
              const pkgJsonPath = safePathJoin(pkgDir, "package.json");
              if (pkgJsonPath && (await fileExists(pkgJsonPath))) {
                const pkgJson = JSON.parse(
                  await fs.readFile(pkgJsonPath, "utf-8"),
                );
                if (pkgJson.name === pkgName) {
                  const srcDir = safePathJoin(pkgDir, "src");
                  if (srcDir && (await fileExists(srcDir))) {
                    matchingDep = {
                      name: pkgName,
                      srcDir: srcDir,
                      pkgDir: pkgDir,
                    };
                    break;
                  }
                }
              }
            }
          }

          if (matchingDep && wsRoot && matchingDep.pkgDir) {
            try {
              // Resolve to compiled file in temp directory
              let depRelativeToWorkspace: string = "";
              try {
                if (
                  wsRoot &&
                  matchingDep.pkgDir &&
                  typeof wsRoot === "string" &&
                  typeof matchingDep.pkgDir === "string"
                ) {
                  const rel = path.relative(wsRoot, matchingDep.pkgDir);
                  if (
                    rel &&
                    typeof rel === "string" &&
                    rel !== "." &&
                    rel.length > 0
                  ) {
                    depRelativeToWorkspace = rel;
                  }
                }
              } catch (err) {
                console.warn(
                  `[SWITE] Error calculating relative path for ${matchingDep.name}:`,
                  err,
                );
                depRelativeToWorkspace = "";
              }

              // Extract subpath (e.g., "@alpine/skltn/shell" -> "shell")
              const subPath = args.path.replace(matchingDep.name + "/", "");

              // Log for debugging
              console.log(
                `[SWITE] Resolving ${args.path} -> subPath: ${subPath} from ${matchingDep.name} (${depRelativeToWorkspace || "root"})`,
              );

              // Try to resolve the subpath
              let resolvedPath: string | null = null;
              if (subPath) {
                // Check package.json exports
                if (
                  !matchingDep.pkgDir ||
                  typeof matchingDep.pkgDir !== "string"
                ) {
                  return undefined;
                }
                const pkgJsonPath = safePathJoin(
                  matchingDep.pkgDir,
                  "package.json",
                );
                if (!pkgJsonPath) {
                  return undefined;
                }
                if (await fileExists(pkgJsonPath)) {
                  try {
                    const pkgJson = JSON.parse(
                      await fs.readFile(pkgJsonPath, "utf-8"),
                    );
                    if (pkgJson.exports) {
                      const exportKey = `./${subPath}`;
                      let exportValue = pkgJson.exports[exportKey];

                      // Try directory-based matching
                      if (!exportValue && subPath.includes("/")) {
                        const dirPath = subPath.split("/")[0];
                        exportValue = pkgJson.exports[`./${dirPath}`];
                      }

                      if (exportValue) {
                        const exportPath =
                          typeof exportValue === "string"
                            ? exportValue
                            : exportValue.import || exportValue.default;

                        if (exportPath && typeof exportPath === "string") {
                          // Convert export path to compiled path
                          const srcRelative = exportPath.replace(
                            /^\.\/src\//,
                            "",
                          );
                          const compiledPath = srcRelative.replace(
                            /\.(ui|uix)$/,
                            ".tsx",
                          );

                          // Validate compiledPath is a valid string
                          if (
                            !compiledPath ||
                            typeof compiledPath !== "string" ||
                            compiledPath.length === 0
                          ) {
                            return undefined;
                          }

                          const parts: string[] = [];
                          // Validate tempDirForPlugin is a valid string
                          if (
                            tempDirForPlugin &&
                            typeof tempDirForPlugin === "string" &&
                            tempDirForPlugin.length > 0
                          ) {
                            parts.push(tempDirForPlugin);
                          } else {
                            // Skip this resolution if tempDir is invalid
                            return undefined;
                          }
                          if (
                            depRelativeToWorkspace &&
                            typeof depRelativeToWorkspace === "string" &&
                            depRelativeToWorkspace.length > 0
                          ) {
                            parts.push(depRelativeToWorkspace);
                          }
                          // Validate compiledPath before adding
                          if (
                            compiledPath &&
                            typeof compiledPath === "string" &&
                            compiledPath.length > 0
                          ) {
                            const joined = safePathJoin(
                              tempDirForPlugin,
                              depRelativeToWorkspace || undefined,
                              "src",
                              compiledPath,
                            );
                            if (joined) {
                              resolvedPath = joined;
                            }
                          }
                        }
                      }
                    }
                  } catch (err) {
                    // Fallback to index
                    console.warn(
                      `[SWITE] Error reading exports for ${matchingDep.name}:`,
                      err,
                    );
                  }
                }
              }

              // Fallback: try index.js
              if (!resolvedPath || !(await fileExists(resolvedPath))) {
                const fallbackParts: string[] = [];
                // Validate tempDirForPlugin is a valid string
                if (
                  tempDirForPlugin &&
                  typeof tempDirForPlugin === "string" &&
                  tempDirForPlugin.length > 0
                ) {
                  fallbackParts.push(tempDirForPlugin);
                } else {
                  // Cannot build without valid tempDir
                  return undefined;
                }
                if (
                  depRelativeToWorkspace &&
                  typeof depRelativeToWorkspace === "string" &&
                  depRelativeToWorkspace.length > 0
                ) {
                  fallbackParts.push(depRelativeToWorkspace);
                }
                // Use safe path join helper
                const joined = safePathJoin(
                  tempDirForPlugin,
                  depRelativeToWorkspace || undefined,
                  "src",
                  "index.js",
                );
                if (joined) {
                  resolvedPath = joined;
                }
              }

              // Final check - ensure path is valid string and exists
              if (
                resolvedPath &&
                typeof resolvedPath === "string" &&
                resolvedPath.length > 0
              ) {
                try {
                  if (await fileExists(resolvedPath)) {
                    return { path: resolvedPath };
                  }
                } catch {
                  // Ignore file check errors
                }
              }
            } catch (err) {
              console.warn(`[SWITE] Error resolving ${args.path}:`, err);
            }
          }

          // Let esbuild handle it normally (return undefined, not null)
          return undefined;
        });

        // Also resolve relative imports in compiled workspace packages
        build.onResolve(
          { filter: /^\.\.?\/.*\.(js|ts|ui|uix)$/ },
          async (args) => {
            // Only handle if it's in a workspace package directory
            if (args.importer && args.importer.includes(".swite-build")) {
              // Check if the importer is in a workspace package
              const importerPath = args.importer;
              const match = importerPath.match(
                /\.swite-build[/\\]([^/\\]+[/\\][^/\\]+)[/\\]src/,
              );
              if (match) {
                // Try to resolve relative to the importer
                const importerDir = path.dirname(importerPath);
                const resolved = safePathJoin(importerDir, args.path);
                if (resolved && (await fileExists(resolved))) {
                  return { path: resolved };
                }

                // Try with .tsx extension if original had .ui/.uix
                const pathWithoutExt = args.path.replace(/\.(ui|uix)$/, "");
                const resolvedTsx = safePathJoin(
                  importerDir,
                  pathWithoutExt + ".tsx",
                );
                if (resolvedTsx && (await fileExists(resolvedTsx))) {
                  return { path: resolvedTsx };
                }
              }
            }
            return undefined;
          },
        );
      },
    };

    const buildOptions: BuildOptions = {
      entryPoints: [entryPoint],
      bundle: true,
      outdir: this.config.outDir,
      format: this.config.format,
      target: this.config.target,
      minify: this.config.minify,
      sourcemap: this.config.sourcemap,
      external: [...this.config.external, ...nodeBuiltins],
      platform: "node", // Keep as node for now - browser apps will need different strategy
      splitting: this.config.format === "esm",
      metafile: true,
      logLevel: "info",
      absWorkingDir, // Help esbuild resolve modules from workspace root
      plugins: [cssStubPlugin, workspaceResolverPlugin],
    };

    // Add aliases via plugins if esbuild version supports it
    // For now, we'll rely on the compiled files being in the right structure

    const result = await esbuild(buildOptions);

    // Log bundle stats (metafile paths can be relative to absWorkingDir)
    if (result.metafile) {
      const outputs = Object.keys(result.metafile.outputs);
      console.log(chalk.green(`\n  Generated ${outputs.length} file(s):`));
      for (const output of outputs) {
        const resolvedPath = path.isAbsolute(output)
          ? output
          : path.join(absWorkingDir, output);
        const stats = await fs.stat(resolvedPath);
        const size = this.formatBytes(stats.size);
        console.log(chalk.gray(`    ${path.basename(output)}: ${size}`));
      }
    }
  }

  private async copyPublicAssets(): Promise<void> {
    const publicPath = path.join(this.config.root, this.config.publicDir);

    try {
      await fs.access(publicPath);
    } catch {
      // Public directory doesn't exist, skip
      return;
    }

    console.log(chalk.blue("📁 Copying public assets..."));
    await this.copyDir(publicPath, this.config.outDir);
  }

  private async findSwissFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...(await this.findSwissFiles(fullPath)));
        } else if (entry.name.endsWith(".ui") || entry.name.endsWith(".uix")) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return files;
  }

  private async findFiles(dir: string, pattern: RegExp): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...(await this.findFiles(fullPath, pattern)));
        } else if (pattern.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return files;
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }

  private async findWorkspaceRoot(startDir: string): Promise<string | null> {
    let current = startDir;
    for (let i = 0; i < 5; i++) {
      const workspaceFile = path.join(current, "pnpm-workspace.yaml");
      const packageJson = path.join(current, "package.json");
      try {
        if (await this.fileExists(workspaceFile)) {
          return current;
        }
        if (await this.fileExists(packageJson)) {
          const pkg = JSON.parse(await fs.readFile(packageJson, "utf-8"));
          if (pkg.workspaces) {
            return current;
          }
        }
      } catch {
        // Continue searching
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async createAliases(
    workspaceRoot: string,
    tempDir: string,
  ): Promise<Record<string, string>> {
    const aliases: Record<string, string> = {};
    const deps = await this.discoverWorkspaceDependencies();

    for (const dep of deps) {
      const depRelativeToWorkspace = path.relative(workspaceRoot, dep.pkgDir);
      const aliasPath = path.join(tempDir, depRelativeToWorkspace, "src");
      aliases[dep.name] = aliasPath;
      // Also add subpath exports
      const pkgJsonPath = path.join(dep.pkgDir, "package.json");
      try {
        const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));
        if (pkgJson.exports) {
          for (const [exportKey, exportValue] of Object.entries(
            pkgJson.exports,
          )) {
            if (exportKey !== "." && typeof exportValue === "string") {
              const fullAlias = `${dep.name}${exportKey}`;
              const exportPath = exportValue.replace(/^\.\/src\//, "");
              aliases[fullAlias] = path.join(aliasPath, exportPath);
            }
          }
        }
      } catch {
        // Skip if can't read package.json
      }
    }

    return aliases;
  }
}

/**
 * Convenience function to build a project
 */
export async function build(config: BuildConfig): Promise<void> {
  const builder = new SwiteBuilder(config);
  await builder.build();
}
