import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRawSpec, SpecLoaderError } from './spec-loader.js';

const tempJsonFile = resolve(process.cwd(), 'temp-test-spec.json');
const tempYamlFile = resolve(process.cwd(), 'temp-test-spec.yaml');
const tempInvalidFile = resolve(process.cwd(), 'temp-test-invalid.txt');

beforeAll(() => {
  writeFileSync(
    tempJsonFile,
    JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'JSON Test API', version: '1.0.0' },
      paths: {},
    }),
    'utf8',
  );

  writeFileSync(
    tempYamlFile,
    `openapi: "3.0.0"
info:
  title: "YAML Test API"
  version: "2.0.0"
paths: {}
`,
    'utf8',
  );

  writeFileSync(tempInvalidFile, 'just a plain string', 'utf8');
});

afterAll(() => {
  try {
    unlinkSync(tempJsonFile);
  } catch {}
  try {
    unlinkSync(tempYamlFile);
  } catch {}
  try {
    unlinkSync(tempInvalidFile);
  } catch {}
});

describe('loadRawSpec', () => {
  it('loads and parses a local JSON spec', async () => {
    const loaded = await loadRawSpec(tempJsonFile);
    expect(loaded.isUrl).toBe(false);
    expect(loaded.rawSpec['openapi']).toBe('3.0.0');
    expect((loaded.rawSpec['info'] as { title: string }).title).toBe('JSON Test API');
  });

  it('loads and parses a local YAML spec', async () => {
    const loaded = await loadRawSpec(tempYamlFile);
    expect(loaded.isUrl).toBe(false);
    expect(loaded.rawSpec['openapi']).toBe('3.0.0');
    expect((loaded.rawSpec['info'] as { title: string }).title).toBe('YAML Test API');
  });

  it('throws when local file does not exist', async () => {
    await expect(loadRawSpec('./non-existent-file.yaml')).rejects.toThrow(SpecLoaderError);
  });

  it('throws when spec content is not an object', async () => {
    await expect(loadRawSpec(tempInvalidFile)).rejects.toThrow(SpecLoaderError);
  });

  it('throws when source is empty', async () => {
    await expect(loadRawSpec('   ')).rejects.toThrow('cannot be empty');
  });
});
