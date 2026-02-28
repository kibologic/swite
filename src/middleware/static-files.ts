/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import express from "express";
import type { Express } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { findWorkspaceRoot } from "../utils/workspace.js";

export interface StaticFilesConfig {
  root: string;
  publicDir: string;
}

/**
 * Setup static file serving for public directory, node_modules, and workspace packages
 */
export async function setupStaticFiles(
  app: Express,
  config: StaticFilesConfig,
): Promise<void> {
  console.log(chalk.magenta(`[static-files] ⚡ setupStaticFiles called with root: ${config.root}`));
  
  // Static file serving - ONLY serve public directory
  // Do NOT serve dist/ folder - it contains old build artifacts with bare imports
  const publicPath = path.join(config.root, config.publicDir);
  
  // Serve static files from public/ directory
  // IMPORTANT: Skip source files (.ui, .uix, .ts, .js) - they should be handled by module transformation middleware
  // Wrap express.static to prevent it from serving source files
  const publicStaticMiddleware = express.static(publicPath, {
    // Exclude dist folder and other build artifacts
    dotfiles: "ignore",
    index: false, // Don't serve index files from static middleware
    setHeaders: (res, filePath) => {
      // Add cache-busting headers for all static files in dev mode
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  });
  
  app.use((req, res, next) => {
    const url = req.url.split("?")[0];
    // Skip source files - let module transformation middleware handle them
    // DO NOT call express.static for source files - it will serve them with wrong MIME type
    if (
      url.endsWith(".ui") ||
      url.endsWith(".uix") ||
      url.endsWith(".ts") ||
      (url.endsWith(".js") && !url.includes("node_modules")) ||
      url.endsWith(".mjs")
    ) {
      // Skip express.static for source files - pass to next middleware instead
      return next();
    }
    // For non-source files, use express.static
    publicStaticMiddleware(req, res, next);
  });
  
  // NOTE: We do NOT serve /src as static files here anymore
  // The module transformation middleware in middleware-setup.ts handles ALL /src requests first
  // This ensures .ui, .uix, .ts files are processed correctly before static middleware can interfere
  // Only non-source files (CSS, images, etc.) will pass through to be served as static
  // But they should be handled by the module transformation middleware's next() call

  // Serve node_modules as static files from multiple locations
  // 1. App root node_modules
  // Wrap to skip source files
  const nodeModulesStatic = express.static(path.join(config.root, "node_modules"));
  app.use("/node_modules", (req, res, next) => {
    const url = req.url.split("?")[0];
    // Skip source files in node_modules - they should be handled by module transformation
    if (
      url.endsWith(".ui") ||
      url.endsWith(".uix") ||
      url.endsWith(".ts") ||
      (url.endsWith(".js") && !url.includes("/dist/") && !url.includes("/lib/")) ||
      url.endsWith(".mjs")
    ) {
      return next();
    }
    nodeModulesStatic(req, res, next);
  });

  // 2. Workspace root node_modules (if different from app root)
  const workspaceRootForNodeModules = await findWorkspaceRoot(config.root);
  if (
    workspaceRootForNodeModules &&
    workspaceRootForNodeModules !== config.root
  ) {
    const workspaceNodeModules = path.join(
      workspaceRootForNodeModules,
      "node_modules",
    );
    try {
      await fs.access(workspaceNodeModules);
      // Serve workspace node_modules with a different path to avoid conflicts
      // But also check if package exists in app node_modules first
      app.use("/node_modules", (req, res, next) => {
        const url = req.url.split("?")[0];
        // Skip source files in node_modules - they should be handled by module transformation
        if (
          url.endsWith(".ui") ||
          url.endsWith(".uix") ||
          url.endsWith(".ts") ||
          (url.endsWith(".js") && !url.includes("/dist/") && !url.includes("/lib/")) ||
          url.endsWith(".mjs")
        ) {
          return next();
        }
        
        // Try app node_modules first, then workspace
        const appPath = path.join(config.root, "node_modules", req.path);
        const workspacePath = path.join(workspaceNodeModules, req.path);

        // Check if file exists in app node_modules first
        fs.access(appPath)
          .then(() => {
            // File exists in app node_modules, serve it
            express.static(path.join(config.root, "node_modules"))(
              req,
              res,
              next,
            );
          })
          .catch(() => {
            // File doesn't exist in app node_modules, try workspace
            fs.access(workspacePath)
              .then(() => {
                // File exists in workspace node_modules, serve it
                express.static(workspaceNodeModules)(req, res, next);
              })
              .catch(() => {
                // File doesn't exist in either, continue to next middleware
                next();
              });
          });
      });
      console.log(
        chalk.gray(
          `  📦 Serving workspace node_modules from ${workspaceNodeModules}`,
        ),
      );
    } catch {
      // Workspace node_modules doesn't exist, skip
    }
  }

  // Serve workspace packages (lib/, libraries/, packages/, modules/, etc.)
  // This allows workspace packages to be served via HTTP
  // Reuse workspaceRoot from above if it exists, otherwise find it
  const workspaceRoot =
    workspaceRootForNodeModules || (await findWorkspaceRoot(config.root));
  
  console.log(
    chalk.blue(`[static-files] Workspace root: ${workspaceRoot}`),
  );
  console.log(
    chalk.blue(`[static-files] App root: ${config.root}`),
  );
  
  // Try to serve lib/ directory - check both workspace root and app root parent
  let libPath: string | null = null;
  
  console.log(
    chalk.blue(`[static-files] Determining lib/ path... workspaceRoot: ${workspaceRoot}, config.root: ${config.root}`),
  );
  
  // First, try workspace root
  if (workspaceRoot && workspaceRoot !== config.root) {
    libPath = path.join(workspaceRoot, "lib");
    console.log(
      chalk.blue(`[static-files] Trying workspace root lib/: ${libPath}`),
    );
  } else {
    console.log(
      chalk.yellow(`[static-files] Workspace root equals app root, trying parent directories...`),
    );
    // If workspace root equals app root, try going up from app root
    const parentDir = path.dirname(config.root);
    const parentLibPath = path.join(parentDir, "lib");
    console.log(
      chalk.blue(`[static-files] Trying parent lib/: ${parentLibPath}`),
    );
    try {
      await fs.access(parentLibPath);
      libPath = parentLibPath;
      console.log(
        chalk.blue(`[static-files] Using parent directory lib/: ${libPath}`),
      );
    } catch (error) {
      console.log(
        chalk.yellow(`[static-files] Parent lib/ not found: ${error instanceof Error ? error.message : String(error)}`),
      );
      // Parent lib/ doesn't exist, try grandparent
      const grandparentDir = path.dirname(parentDir);
      const grandparentLibPath = path.join(grandparentDir, "lib");
      console.log(
        chalk.blue(`[static-files] Trying grandparent lib/: ${grandparentLibPath}`),
      );
      try {
        await fs.access(grandparentLibPath);
        libPath = grandparentLibPath;
        console.log(
          chalk.blue(`[static-files] Using grandparent directory lib/: ${libPath}`),
        );
      } catch (error2) {
        console.log(
          chalk.yellow(`[static-files] Grandparent lib/ not found: ${error2 instanceof Error ? error2.message : String(error2)}`),
        );
      }
    }
  }
  
  // Serve lib/ directory if found
  console.log(
    chalk.blue(`[static-files] Checking for lib/ directory... libPath: ${libPath}`),
  );
  
  // ALWAYS try to register /lib/ static serving
  // Calculate the lib path - prefer workspace root, fallback to parent of app root
  let finalLibPath: string;
  if (libPath) {
    finalLibPath = libPath;
  } else if (workspaceRoot && workspaceRoot !== config.root) {
    finalLibPath = path.join(workspaceRoot, "lib");
  } else {
    // Go up from app root to find lib/
    const parentDir = path.dirname(config.root);
    finalLibPath = path.join(parentDir, "lib");
  }
  
  console.log(
    chalk.blue(`[static-files] Final lib path to check: ${finalLibPath}`),
  );
  console.log(
    chalk.blue(`[static-files] workspaceRoot: ${workspaceRoot}, config.root: ${config.root}`),
  );
  
  // Try to access the directory
  let libPathExists = false;
  try {
    await fs.access(finalLibPath);
    libPathExists = true;
    console.log(
      chalk.green(`[static-files] ✅ Found lib/ directory at: ${finalLibPath}`),
    );
    
    // Verify the CSS file exists
    const testCssPath = path.join(finalLibPath, "skltn", "src", "css", "index.css");
    try {
      await fs.access(testCssPath);
      console.log(
        chalk.green(`[static-files] ✅ Test CSS file exists: ${testCssPath}`),
      );
    } catch (error) {
      console.error(
        chalk.yellow(`[static-files] ⚠️  Test CSS file NOT found: ${testCssPath}`),
      );
    }
  } catch (error) {
    console.error(
      chalk.red(`[static-files] ❌ lib/ directory not found at: ${finalLibPath}`),
    );
    console.error(
      chalk.red(`[static-files] Error: ${error instanceof Error ? error.message : String(error)}`),
    );
    console.error(
      chalk.red(`[static-files] ⚠️  /lib middleware will NOT be registered - CSS files will 404!`),
    );
  }
  
  // Register static file middleware ONLY if directory exists
  if (libPathExists) {
    console.log(chalk.green(`[static-files] ✅ Registering /lib middleware with finalLibPath: ${finalLibPath}`));
    
    // CRITICAL: First middleware to block source files BEFORE any express.static can serve them
    // This MUST run before express.static to prevent wrong MIME types
    app.use("/lib", (req, res, next) => {
      const url = req.url.split("?")[0];
      const path = req.path.split("?")[0];
      
      // CRITICAL: Block source files immediately - check both url and path
      // When express.static is mounted at /lib, req.path is stripped of /lib prefix
      const isSourceFile = 
        url.endsWith(".ui") || url.endsWith(".uix") || url.endsWith(".ts") || 
        (url.endsWith(".js") && !url.includes("node_modules")) || url.endsWith(".mjs") ||
        path.endsWith(".ui") || path.endsWith(".uix") || path.endsWith(".ts") ||
        (path.endsWith(".js") && !path.includes("node_modules")) || path.endsWith(".mjs");
      
      if (isSourceFile) {
        console.log(
          chalk.red(
            `[static-files] ⚠️  FIRST BLOCK: Skipping source file: url=${url}, path=${path} - should be handled by module middleware`
          )
        );
        return next(); // Let module transformation middleware handle it
      }
      
      console.log(
        chalk.cyan(`[static-files] Request for /lib${path} (static file)`),
      );
      next();
    });
    
    // REMOVED: Logging middleware - it was just adding noise
    // The blocking middleware above already handles source files
    
    // CRITICAL: Add express.static for /lib/ but wrap it to skip source files
    // Source files should be handled by module transformation middleware (registered before this)
    const libStatic = express.static(finalLibPath, {
      setHeaders: (res, filePath) => {
        try {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        } catch (error) {
          console.error(chalk.red(`[static-files] Error setting headers for ${filePath}:`), error);
        }
      },
    });
    
    // CRITICAL: Wrap express.static to prevent serving source files
    // Check BOTH req.url (full path) and req.path (stripped path) to catch all cases
    app.use("/lib", (req, res, next) => {
      const url = req.url.split("?")[0];
      const path = req.path.split("?")[0];
      
      // CRITICAL: Skip source files - they should be handled by module transformation middleware
      // Check both url and path because express.static strips the mount path
      const isSourceFile = 
        url.endsWith(".ui") || url.endsWith(".uix") || url.endsWith(".ts") || 
        (url.endsWith(".js") && !url.includes("node_modules")) || url.endsWith(".mjs") ||
        path.endsWith(".ui") || path.endsWith(".uix") || path.endsWith(".ts") ||
        (path.endsWith(".js") && !path.includes("node_modules")) || path.endsWith(".mjs");
      
      if (isSourceFile) {
        console.log(
          chalk.red(
            `[static-files /lib express.static] ⚠️  BLOCKING source file: url=${url}, path=${path} - should be handled by module transformation middleware`
          )
        );
        // CRITICAL: Don't call libStatic - return next() to skip it
        return next(); // Let module transformation middleware handle it
      }
      // For static files (CSS, images), use express.static
      libStatic(req, res, next);
    });
    // This was serving source files with wrong MIME type (application/octet-stream)
    // Source files should be handled by module transformation middleware (registered before this)
    // Only static files (CSS, images) should be served, and they're handled by the custom handler above
    // If a file isn't found, let it 404 rather than serving with wrong MIME type
    console.log(
      chalk.gray(`  📦 Serving workspace lib/ from ${finalLibPath}`),
    );
  }
  
  // Continue with other workspace directories if workspaceRoot is different from app root
  if (workspaceRoot && workspaceRoot !== config.root) {

    // Serve libraries/ directory (legacy support)
    const librariesPath = path.join(workspaceRoot, "libraries");
    try {
      await fs.access(librariesPath);
      app.use("/libraries", express.static(librariesPath));
      console.log(
        chalk.gray(`  📦 Serving workspace libraries/ from ${librariesPath}`),
      );
    } catch {
      // libraries/ doesn't exist, skip
    }

    // NOTE: Do NOT serve /packages/ as static files
    // Workspace packages contain source files (.ts, .ui, .uix) that need to be processed
    // by handlers (TSHandler, UIHandler, etc.) to rewrite imports and compile them
    // Static file serving would bypass this processing, causing bare imports to fail
    // Only serve /packages/ if they're already compiled assets (handled by handlers)

    // Serve modules/ directory (for CSS, assets, etc.)
    const modulesPath = path.join(workspaceRoot, "modules");
    try {
      await fs.access(modulesPath);
      app.use("/modules", express.static(modulesPath));
      console.log(
        chalk.gray(`  📦 Serving workspace modules/ from ${modulesPath}`),
      );
    } catch {
      // modules/ doesn't exist, skip
    }
  }

  // NOTE: SWISS packages are NOT served as static files
  // They are processed by the middleware (TS/JS handlers) to rewrite imports
  // This ensures all bare imports in SWISS packages are rewritten correctly
  // The /swiss-packages/ URLs are handled by the middleware in middleware-setup.ts
}

/**
 * Setup SPA fallback - serves index.html for all unmatched routes
 */
export async function setupSPAFallback(
  app: Express,
  config: StaticFilesConfig,
): Promise<void> {
  console.log(chalk.magenta(`[SWITE] setupSPAFallback loaded - VERSION 3.0.0 (NO HARDCODED CSS)`));
  // Use app.all() to catch ALL HTTP methods, but only for non-source files
  app.all("*", async (req, res, next) => {
    const url = req.url.split("?")[0];
    const fullUrl = req.url;
    
    // DEBUG: Verify handler is being called
    process.stderr.write(`[SPA FALLBACK] Handler called for: ${req.method} ${fullUrl}\n`);
    console.error(`[SWITE CSS DEBUG] ========== SPA FALLBACK HANDLER START ==========`);
    console.error(`[SWITE CSS DEBUG] URL: ${url}, Full URL: ${fullUrl}`);
    
    // --- CRITICAL SAFETY CHECK ---
    // NEVER serve HTML for /src/* requests - these are source files that must be handled by middleware
    // Even if middleware fails, we should return 404, not HTML
    if (req.path?.startsWith("/src/") || url.startsWith("/src/")) {
      console.error(chalk.red(`[SPA FALLBACK] ⚠️  BLOCKED: Attempt to serve HTML for source path: ${req.method} ${fullUrl}`));
      console.error(chalk.red(`[SPA FALLBACK] This should have been handled by /src middleware! Returning 404.`));
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${url}`);
      return;
    }
    
    // --- CRITICAL SAFETY CHECK ---
    // NEVER serve HTML for /swiss-packages/* requests - these are SWISS framework packages
    // They should be handled by TS/JS handlers to rewrite imports
    if (req.path?.startsWith("/swiss-packages/") || url.startsWith("/swiss-packages/")) {
      console.error(chalk.red(`[SPA FALLBACK] ⚠️  BLOCKED: Attempt to serve HTML for SWISS package: ${req.method} ${fullUrl}`));
      console.error(chalk.red(`[SPA FALLBACK] This should have been handled by module transformation middleware! Returning 404.`));
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${url}`);
      return;
    }
    
    // --- CRITICAL SAFETY CHECK ---
    // NEVER serve HTML for /lib/* requests - these are workspace library files
    // They should be handled by static file middleware
    if (req.path?.startsWith("/lib/") || url.startsWith("/lib/")) {
      console.error(chalk.red(`[SPA FALLBACK] ⚠️  BLOCKED: Attempt to serve HTML for /lib/ path: ${req.method} ${fullUrl}`));
      console.error(chalk.red(`[SPA FALLBACK] This should have been handled by static file middleware! Returning 404.`));
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${url}`);
      return;
    }
    
    // Log every request that hits the fallback (for diagnostics)
    console.log(chalk.gray(`[SPA FALLBACK] Serving HTML for: ${req.method} ${fullUrl}`));
    process.stderr.write(`[SPA FALLBACK] About to read HTML file...\n`);
    
    // Log if SPA fallback is being hit for .ui files (this should NOT happen after /src check)
    if (url.endsWith(".ui")) {
      console.error(chalk.red(`[SPA FALLBACK] ⚠️  WARNING: SPA fallback intercepted .ui file: ${fullUrl}`));
      console.error(chalk.red(`[SPA FALLBACK] This should have been handled by module transformation middleware!`));
    }
    
    // DO NOT serve HTML for source files - they should be handled by handlers
    // This prevents the SPA fallback from catching .ui, .uix, .ts, .js, .mjs files
    // If we reach here, it means the middleware handlers didn't process it
    if (
      url.endsWith(".ui") ||
      url.endsWith(".uix") ||
      url.endsWith(".ts") ||
      url.endsWith(".js") ||
      url.endsWith(".mjs") ||
      url.endsWith(".css") ||
      url.endsWith(".json")
    ) {
      // These should have been handled by middleware handlers
      // If we reach here, the file wasn't found, return 404 with proper content type
      console.error(chalk.red(`[SPA FALLBACK] Returning 404 for ${url} - should have been handled earlier`));
      res.status(404).setHeader("Content-Type", "text/plain");
      res.send(`File not found: ${url}`);
      return;
    }
    
    // Add cache-busting headers for HTML files during development
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Inject timestamp into script tag to force fresh load
    const htmlPath = path.join(config.root, config.publicDir, "index.html");
    let html = await fs.readFile(htmlPath, "utf-8");
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    // More aggressive cache busting - replace ALL script src attributes
    html = html.replace(/src="([^"]*index\.ui[^"]*)"/g, (match, src) => {
      // Remove any existing cache-busting params
      const cleanSrc = src.split("?")[0].split("&")[0];
      return `src="${cleanSrc}?v=dev&t=${timestamp}&r=${random}"`;
    });
    // Also replace any script tags with type="module" that have src attributes
    html = html.replace(
      /<script\s+type=["']module["'][^>]*src=["']([^"']*index\.ui[^"']*)["'][^>]*>/g,
      (match, src) => {
        const cleanSrc = src.split("?")[0].split("&")[0];
        return match.replace(
          src,
          `${cleanSrc}?v=dev&t=${timestamp}&r=${random}`,
        );
      },
    );

    // Add cache-busting meta tags to prevent browser caching
    if (!html.includes('<meta http-equiv="Cache-Control"')) {
      html = html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n    <meta http-equiv="Pragma" content="no-cache">\n    <meta http-equiv="Expires" content="0">`,
      );
    }

    // Extract CSS imports from entry point and inject as <link> tags
    // This dynamically discovers CSS files from the app's entry point
    // CRITICAL: This MUST run before import map injection
    // IMPORTANT: Only inject CSS files that actually exist in the app's directory
    console.log(chalk.magenta(`[SWITE CSS] ========== CSS EXTRACTION START (VERSION 3.0.0) ==========`));
    console.log(chalk.magenta(`[SWITE CSS] App root: ${config.root}`));
    try {
      const entryPointPath = path.join(config.root, "src", "index.ui");
      console.log(chalk.blue(`[SWITE CSS] Checking entry point: ${entryPointPath}`));
      const entryPointContent = await fs.readFile(entryPointPath, "utf-8");
      
      // Extract CSS imports using regex
      const cssImportPattern = /import\s+['"](.*?\.css)['"];?/g;
      const cssImports = new Set<string>();
      let match;
      
      // Check entry point
      while ((match = cssImportPattern.exec(entryPointContent)) !== null) {
        cssImports.add(match[1]);
      }
      
      // Also check imported files (like App.uix) for CSS imports
      const importPattern = /import\s+.*?from\s+['"](.*?)['"];?/g;
      const importedFiles: string[] = [];
      let importMatch;
      cssImportPattern.lastIndex = 0; // Reset regex
      while ((importMatch = importPattern.exec(entryPointContent)) !== null) {
        const importPath = importMatch[1];
        // Skip node_modules and absolute imports
        if (!importPath.startsWith("@") && !importPath.startsWith("/") && !importPath.startsWith(".")) {
          continue;
        }
        // Resolve relative imports
        if (importPath.startsWith(".")) {
          importedFiles.push(importPath);
        }
      }
      
      // Check imported files for CSS
      for (const importedFile of importedFiles) {
        try {
          const importedFilePath = path.resolve(path.dirname(entryPointPath), importedFile);
          // Try different extensions
          const extensions = [".uix", ".ui", ".ts", ".js"];
          let found = false;
          for (const ext of extensions) {
            const testPath = importedFilePath.endsWith(ext) ? importedFilePath : importedFilePath + ext;
            try {
              const importedContent = await fs.readFile(testPath, "utf-8");
              found = true;
              // Extract CSS imports from this file
              cssImportPattern.lastIndex = 0; // Reset regex
              let cssMatch2;
              while ((cssMatch2 = cssImportPattern.exec(importedContent)) !== null) {
                // Resolve relative CSS path
                const cssPath = cssMatch2[1];
                if (cssPath.startsWith(".")) {
                  const resolvedCssPath = path.resolve(path.dirname(testPath), cssPath);
                  const relativeCssPath = path.relative(path.join(config.root, "src"), resolvedCssPath);
                  const normalizedPath = relativeCssPath.replace(/\\/g, "/");
                  cssImports.add(normalizedPath);
                } else {
                  cssImports.add(cssPath);
                }
              }
              break;
            } catch (err) {
              // File doesn't exist with this extension, try next
            }
          }
        } catch (error) {
          // Could not read imported file, skip
        }
      }
      
      console.log(chalk.blue(`[SWITE CSS] Found ${cssImports.size} CSS import(s) in code`));
      if (cssImports.size > 0) {
        const cssArray = Array.from(cssImports);
        console.log(chalk.blue(`[SWITE CSS] CSS imports found: ${cssArray.join(", ")}`));
        
        // Verify CSS files exist before injecting them
        const existingCssFiles: string[] = [];
        for (const cssPath of cssArray) {
          // Convert to file system path
          const url = cssPath.startsWith("/") ? cssPath : `/src/${cssPath}`;
          const filePath = url.startsWith("/src/") 
            ? path.join(config.root, url.substring(1)) // Remove leading /
            : path.join(config.root, "src", cssPath);
          
          console.log(chalk.blue(`[SWITE CSS] Checking if CSS file exists: ${filePath} (url: ${url})`));
          try {
            await fs.access(filePath);
            console.log(chalk.green(`[SWITE CSS] ✅ CSS file exists: ${filePath}`));
            existingCssFiles.push(url);
          } catch {
            // CSS file doesn't exist, skip it
            // This allows different apps/websites to have different CSS files
            console.log(chalk.yellow(`[SWITE CSS] ⚠️  CSS file NOT found: ${filePath}, skipping`));
          }
        }
        
        // Only inject CSS files that actually exist
        console.log(chalk.blue(`[SWITE CSS] ${existingCssFiles.length} CSS file(s) exist out of ${cssArray.length} found`));
        if (existingCssFiles.length === 0) {
          console.log(chalk.yellow(`[SWITE CSS] ⚠️  No CSS files exist, skipping injection`));
        } else if (existingCssFiles.length > 0) {
          const cssLinks = existingCssFiles
            .map(url => `    <link rel="stylesheet" href="${url}">`)
            .join("\n");
          
          // Check if CSS links are already in HTML (to avoid duplicates)
          const alreadyInjected = existingCssFiles.some(url => 
            html.includes(`href="${url}"`) || html.includes(`href='${url}'`)
          );
          
          if (!alreadyInjected) {
            // Inject CSS links before </head> - MUST happen before import map injection
            const beforeReplace = html;
            html = html.replace(/\s*<\/head>/i, `${cssLinks}\n  </head>`);
            if (html === beforeReplace) {
              console.warn(chalk.yellow("[SWITE] Failed to inject CSS links - </head> not found"));
            } else {
              console.log(chalk.green(`[SWITE] ✅ Injected ${existingCssFiles.length} CSS link(s): ${existingCssFiles.join(", ")}`));
            }
          } else {
            console.log(chalk.blue(`[SWITE CSS] CSS links already in HTML, skipping injection`));
          }
        }
      }
    } catch (error) {
      // If entry point doesn't exist or can't be read, continue without CSS injection
      // Silently continue - CSS injection is optional
      console.log(chalk.yellow(`[SWITE CSS] Could not extract CSS imports: ${error instanceof Error ? error.message : String(error)}`));
    }

    // Add import map to help browser resolve bare module specifiers
    if (!html.includes('type="importmap"')) {
      let importsObj: Record<string, string> = {};
      const cachedMapPath = path.join(config.root, ".swite", "import-map.json");
      try {
        const raw = await fs.readFile(cachedMapPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.imports && typeof parsed.imports === "object") {
          importsObj = parsed.imports;
          console.log(`[SWITE] Loaded import map from cache: ${Object.keys(importsObj).length} entries`);
        }
      } catch {
        console.log("[SWITE] No cached import map found, using empty importmap");
      }
      const importMap = `\n    <script type="importmap">\n    ${JSON.stringify({ imports: importsObj }, null, 2).replace(/\n/g, "\n    ")}\n    </script>`;
      const beforeReplace = html;
      html = html.replace(/\s*<\/head>/i, `${importMap}\n  </head>`);
      if (html === beforeReplace) {
        console.warn("[SWITE] Failed to add import map - </head> not found or already replaced");
      } else {
        console.log("[SWITE] Added import map for @swissjs/core");
      }
    } else {
      console.log("[SWITE] Import map already exists in HTML");
    }

    res.send(html);
  });
}
