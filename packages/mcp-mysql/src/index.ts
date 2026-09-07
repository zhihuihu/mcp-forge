#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { parseCliOptions, helpText, loadConfig } from './config.js';
import { MysqlClient } from './mysql-client.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const cli = parseCliOptions();
  if (cli.help) {
    process.stdout.write(helpText);
    return;
  }

  const config = loadConfig();
  const client = new MysqlClient(config);
  const server = createServer(config, client);
  const transport = new StdioServerTransport();

  const shutdown = async (): Promise<void> => {
    await client.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // StdioServerTransport keeps the process alive after connect() returns. Do not close
  // the pool here; it must remain available for subsequent tools/calls.
  await server.connect(transport);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(`mcp-mysql startup failed: ${message}\n`);
  process.exitCode = 1;
}
