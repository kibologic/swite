/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Compilation Cache for .ui, .uix, .ts files
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";

interface CacheEntry {
  compiled: string;
  rewritten: string;
  mtime: number;
  dependencies: string[];
  timestamp: number;
}

/**
 * Compilation cache with dependency tracking
 * Invalidates when source file or dependencies change
 */
export class CompilationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize = 1000; // Prevent memory leaks

  /**
   * Get cached compilation result if valid
   */
  async get(
    filePath: string,
    getDependencies: (compiled: string) => Promise<string[]>,
  ): Promise<string | null> {
    const entry = this.cache.get(filePath);
    if (!entry) {
      return null;
    }

    // Check if source file changed
    try {
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs !== entry.mtime) {
        console.log(
          chalk.yellow(`[Cache] Invalidating ${filePath}: file modified`),
        );
        this.cache.delete(filePath);
        return null;
      }
    } catch (error) {
      // File deleted or inaccessible
      this.cache.delete(filePath);
      return null;
    }

    // Check if dependencies changed
    const currentDeps = await getDependencies(entry.compiled);
    const depsChanged =
      currentDeps.length !== entry.dependencies.length ||
      currentDeps.some((dep, i) => dep !== entry.dependencies[i]);

    if (depsChanged) {
      console.log(
        chalk.yellow(
          `[Cache] Invalidating ${filePath}: dependencies changed`,
        ),
      );
      this.cache.delete(filePath);
      return null;
    }

    // Check if dependencies still exist and haven't changed
    for (const dep of entry.dependencies) {
      try {
        const depStats = await fs.stat(dep);
        // If dependency was modified after cache entry, invalidate
        if (depStats.mtimeMs > entry.timestamp) {
          console.log(
            chalk.yellow(
              `[Cache] Invalidating ${filePath}: dependency ${dep} modified`,
            ),
          );
          this.cache.delete(filePath);
          return null;
        }
      } catch {
        // Dependency deleted or inaccessible
        console.log(
          chalk.yellow(
            `[Cache] Invalidating ${filePath}: dependency ${dep} not found`,
          ),
        );
        this.cache.delete(filePath);
        return null;
      }
    }

    console.log(chalk.green(`[Cache] ✅ Cache hit for ${filePath}`));
    return entry.rewritten;
  }

  /**
   * Store compilation result in cache
   */
  async set(
    filePath: string,
    compiled: string,
    rewritten: string,
    getDependencies: (compiled: string) => Promise<string[]>,
  ): Promise<void> {
    // Enforce max size (LRU eviction)
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        console.log(chalk.gray(`[Cache] Evicted ${firstKey} (cache full)`));
      }
    }

    try {
      const stats = await fs.stat(filePath);
      const dependencies = await getDependencies(compiled);

      this.cache.set(filePath, {
        compiled,
        rewritten,
        mtime: stats.mtimeMs,
        dependencies,
        timestamp: Date.now(),
      });

      console.log(
        chalk.green(
          `[Cache] ✅ Cached ${filePath} (${dependencies.length} deps)`,
        ),
      );
    } catch (error) {
      console.warn(chalk.yellow(`[Cache] Failed to cache ${filePath}:`, error));
    }
  }

  /**
   * Clear cache for a specific file
   */
  clear(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear entire cache
   */
  clearAll(): void {
    this.cache.clear();
    console.log(chalk.gray("[Cache] Cleared all entries"));
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

// Singleton instance
export const compilationCache = new CompilationCache();
