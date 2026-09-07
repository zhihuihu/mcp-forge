import { readFileSync } from 'node:fs';

interface PackageManifest {
  version?: unknown;
}

const packageManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

if (typeof packageManifest.version !== 'string' || packageManifest.version.length === 0) {
  throw new Error('The package.json version is missing or invalid.');
}

export const packageVersion = packageManifest.version;
