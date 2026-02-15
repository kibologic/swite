#!/usr/bin/env node
/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * CLI tool to generate import maps
 * Licensed under the MIT License.
 */

import { generateImportMap, saveImportMap } from "./generate-import-map.js";
import { findWorkspaceRoot } from "./workspace.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Find app root (where swite is running from)
  // This script is typically run from the app directory
  const appRoot = process.cwd();
  const workspaceRoot = await findWorkspaceRoot(appRoot);

  console.log(`[ImportMap] App root: ${appRoot}`);
  console.log(`[ImportMap] Workspace root: ${workspaceRoot || "none"}`);

  // Generate import map
  const importMap = await generateImportMap(appRoot, workspaceRoot);

  // Save to .swite/import-map.json in app root
  const outputPath = path.join(appRoot, ".swite", "import-map.json");
  await saveImportMap(importMap, outputPath);

  console.log(`[ImportMap] ✅ Import map generated successfully`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[ImportMap] Error:", error);
  process.exit(1);
});
