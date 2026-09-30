/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

/** An error with code ENOENT, so request handlers can answer 404 instead of 500. */
export function fileNotFoundError(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

export type FsFailureKind = "missing" | "permission" | "symlink-loop" | "not-a-directory" | "io";

/**
 * Classify a filesystem error by cause so logs never print the raw fs string
 * (syscall name plus absolute path) unless verbose.
 */
export function classifyFsError(err: unknown): FsFailureKind {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case "ENOENT":
      return "missing";
    case "EACCES":
    case "EPERM":
      return "permission";
    case "ELOOP":
      return "symlink-loop";
    case "ENOTDIR":
      return "not-a-directory";
    default:
      return "io";
  }
}
