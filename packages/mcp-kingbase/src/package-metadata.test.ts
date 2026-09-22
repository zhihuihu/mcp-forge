import { describe, expect, it } from 'vitest';

import { packageName, packageVersion } from './package-metadata.js';

describe('package-metadata', () => {
  it('loads package metadata', () => {
    expect(packageName).toBe('@huzhihui_c/mcp-kingbase');
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
