import { readFile } from "node:fs/promises";

interface PackageJson {
  readonly version?: unknown;
}

export async function readPackageVersion(): Promise<string> {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const raw = await readFile(packageUrl, "utf8");
  const parsed = JSON.parse(raw) as PackageJson;

  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    return "0.0.0";
  }

  return parsed.version;
}
