/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import type { Express } from "express";
import type { RouteDefinition } from "@swissjs/core";
import { HMREngine } from "../hmr.js";

export interface HMRRoutesConfig {
  hmr: HMREngine;
  routes: RouteDefinition[];
}

/**
 * Setup HMR client endpoint and routes endpoint
 */
export function setupHMRRoutes(app: Express, config: HMRRoutesConfig): void {
  // HMR client injection
  app.get("/__swite_hmr_client", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(config.hmr.getClientScript());
  });

  // Routes endpoint - expose route definitions to client
  app.get("/__swite_routes", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    // Serialize routes for client - functions can't be serialized, so we include httpUrl in meta
    // The client will use httpUrl to dynamically import the component
    const serializedRoutes = config.routes.map((route) => ({
      path: route.path,
      meta: route.meta,
      // Include httpUrl from meta so client can import it
      componentUrl: route.meta?.httpUrl || null,
    }));
    res.json({ routes: serializedRoutes });
  });

  // Diagnostic endpoint - check what the server is actually serving
  app.get("/__swite_diagnose", async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      res.json({ error: "Missing url query parameter" });
      return;
    }

    try {
      // Try to fetch what we would serve
      const testRes = await fetch(
        `http://localhost:${req.socket.localPort}${url}`,
      );
      const content = await testRes.text();
      const hasBareImport =
        /(?:import|from|export).*['"](@[^'"]+\/[^'"]+)(?!\/)[^'"]*['"]/.test(
          content,
        );

      res.json({
        url,
        status: testRes.status,
        hasBareImport,
        contentPreview: content.substring(0, 500),
        imports: Array.from(
          content.matchAll(/(?:import|from|export).*['"]([^'"]+)['"]/g),
        )
          .slice(0, 10)
          .map((m) => m[1]),
      });
    } catch (error) {
      res.json({ error: String(error) });
    }
  });

  // Force cache clear endpoint - returns HTML with aggressive cache busting
  app.get("/__swite_clear_cache", async (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate, max-age=0",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cache Cleared</title>
          <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
          <meta http-equiv="Pragma" content="no-cache">
          <meta http-equiv="Expires" content="0">
          <script>
            // Clear all caches
            if ('caches' in window) {
              caches.keys().then(names => {
                names.forEach(name => caches.delete(name));
                console.log('All caches cleared');
              });
            }
            // Clear service workers
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(reg => reg.unregister());
                console.log('Service workers unregistered');
              });
            }
            // Redirect to home
            setTimeout(() => {
              window.location.href = '/?nocache=' + Date.now();
            }, 1000);
          </script>
        </head>
        <body>
          <h1>Clearing cache...</h1>
          <p>Redirecting in 1 second...</p>
        </body>
      </html>
    `);
  });
}
