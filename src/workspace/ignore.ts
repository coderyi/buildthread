const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache"
]);

const CONTENT_SKIPPED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export function isIgnoredDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

export function isIgnoredRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.some((segment) => IGNORED_DIRECTORIES.has(segment));
}

export function shouldSkipFileContent(relativePath: string): boolean {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return CONTENT_SKIPPED_FILES.has(name);
}
