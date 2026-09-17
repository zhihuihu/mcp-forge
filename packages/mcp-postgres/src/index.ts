#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { parseCliOptions, helpText, loadConfig } from './config.js';
import { PgClient } from './pg-client.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const cli = parseCliOptions();
  if (cli.help) {
    process.stdout.write(helpText);
    return;
  }

  const config = loadConfig();
  const client = new PgClient(config);
  const server = createServer(config, client);
  const transport = new StdioServerTransport();

  const shutdown = async (): Promise<void> => {
    await client.close().catch(() => undefined);
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
  process.stderr.write(`mcp-postgres startup failed: ${message}\n`);
  process.exitCode = 1;
}
