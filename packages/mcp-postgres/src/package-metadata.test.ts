import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { packageVersion } from './package-metadata.js';

describe('package metadata', () => {
  it('exposes the version from package.json', () => {
    const packageManifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(packageVersion).toBe(packageManifest.version);
  });
});
