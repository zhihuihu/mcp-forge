#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { helpText, loadConfig, parseCliOptions } from './config.js';
import { ApiHttpClient } from './http-client.js';
import { createServer } from './server.js';
import { loadRawSpec } from './spec-loader.js';
import { parseApiSpec } from './spec-parser.js';

async function main(): Promise<void> {
  const cli = parseCliOptions();
  if (cli.help) {
    process.stdout.write(helpText);
    return;
  }

  const config = loadConfig();

  // Load raw specification
  const loaded = await loadRawSpec(config.spec, config.timeoutMs, config.defaultHeaders);

  // Parse and normalize specification
  const parsedSpec = parseApiSpec(loaded.rawSpec, loaded.source, loaded.isUrl, {
    ...(config.baseUrlOverride ? { baseUrlOverride: config.baseUrlOverride } : {}),
    ...(config.includeTags ? { includeTags: config.includeTags } : {}),
    ...(config.excludeTags ? { excludeTags: config.excludeTags } : {}),
    ...(config.includeOperations ? { includeOperations: config.includeOperations } : {})
  });

  // Create HTTP client
  const httpClient = new ApiHttpClient(
    parsedSpec.info.baseUrl,
    config.defaultHeaders,
    config.timeoutMs,
  );

  // Create MCP Server
  const server = createServer(config, parsedSpec, httpClient);
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(`mcp-api startup failed: ${message}\n`);
  process.exitCode = 1;
}
