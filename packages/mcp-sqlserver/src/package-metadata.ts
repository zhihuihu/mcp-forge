import { readFileSync } from 'node:fs';

interface PackageJson {
  name?: string;
  version?: string;
}

function loadPackageJson(): PackageJson {
  try {
    const url = new URL('../package.json', import.meta.url);
    const content = readFileSync(url, 'utf8');
    return JSON.parse(content) as PackageJson;
  } catch {
    return {};
  }
}

const metadata = loadPackageJson();

export const packageName = metadata.name ?? '@huzhihui_c/mcp-sqlserver';
export const packageVersion = metadata.version ?? '1.0.0';
