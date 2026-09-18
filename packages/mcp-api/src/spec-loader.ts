import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

export class SpecLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecLoaderError';
  }
}

export interface LoadedSpec {
  rawSpec: Record<string, unknown>;
  source: string;
  isUrl: boolean;
}

export async function loadRawSpec(
  source: string,
  timeoutMs: number = 15000,
  headers?: Record<string, string>,
): Promise<LoadedSpec> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new SpecLoaderError('Spec source path or URL cannot be empty.');
  }

  const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');
  let content: string;

  if (isUrl) {
    try {
      const fetchHeaders: Record<string, string> = {
        Accept: 'application/json, application/yaml, text/yaml, text/x-yaml, application/x-yaml, */*',
        ...(headers ?? {}),
      };

      const response = await fetch(trimmed, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new SpecLoaderError(
          `Failed to fetch OpenAPI spec from ${trimmed}: HTTP ${response.status} ${response.statusText}`,
        );
      }

      content = await response.text();
    } catch (error) {
      if (error instanceof SpecLoaderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SpecLoaderError(`Unable to fetch OpenAPI spec from ${trimmed}: ${message}`);
    }
  } else {
    const resolvedPath = resolve(process.cwd(), trimmed);
    if (!existsSync(resolvedPath)) {
      throw new SpecLoaderError(`Local OpenAPI spec file not found: ${resolvedPath}`);
    }

    try {
      content = readFileSync(resolvedPath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SpecLoaderError(`Unable to read OpenAPI spec file at ${resolvedPath}: ${message}`);
    }
  }

  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SpecLoaderError(
        `Invalid OpenAPI specification content from ${trimmed}: root must be a valid JSON/YAML object.`,
      );
    }
    return {
      rawSpec: parsed as Record<string, unknown>,
      source: trimmed,
      isUrl,
    };
  } catch (error) {
    if (error instanceof SpecLoaderError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SpecLoaderError(`Failed to parse OpenAPI document (YAML/JSON) from ${trimmed}: ${message}`);
  }
}
