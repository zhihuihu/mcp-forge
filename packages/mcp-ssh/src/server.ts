import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { resolveConnectionOptions, resolveExecutionLimits, type SshToolInput } from './config.js';
import { packageVersion } from './package-metadata.js';
import { executeSshCommand, testSshConnection } from './ssh-client.js';

const sshConnectionSchema = {
  host: z.string().min(1).optional().describe('SSH host; falls back to MCP_SSH_HOST.'),
  port: z.number().int().min(1).max(65_535).optional().describe('SSH port; defaults to 22.'),
  username: z.string().min(1).optional().describe('SSH username; falls back to MCP_SSH_USERNAME.'),
  password: z.string().optional().describe('Password authentication.'),
  privateKey: z.string().optional().describe('Private key contents for key authentication.'),
  passphrase: z.string().optional().describe('Passphrase for the private key.'),
  hostFingerprint: z
    .string()
    .min(1)
    .optional()
    .describe('Expected OpenSSH SHA256 host fingerprint; falls back to MCP_SSH_HOST_FINGERPRINT.'),
  hostKeyPolicy: z
    .enum(['strict', 'known_hosts', 'disabled'])
    .optional()
    .describe(
      'Host key verification policy: strict, known_hosts, or disabled (default). Falls back to MCP_SSH_HOST_KEY_POLICY.',
    ),
  knownHostsPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'SSH known_hosts file path for known_hosts policy; defaults to ~/.ssh/known_hosts or MCP_SSH_KNOWN_HOSTS_PATH.',
    ),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown SSH error.';
}

function outputText(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}): string {
  const sections = [`Exit code: ${result.exitCode}`];
  if (result.signal) {
    sections.push(`Signal: ${result.signal}`);
  }
  sections.push(`STDOUT:\n${result.stdout || '(empty)'}`);
  sections.push(`STDERR:\n${result.stderr || '(empty)'}`);
  return sections.join('\n\n');
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-ssh',
    version: packageVersion,
  });

  server.registerTool(
    'ssh_exec',
    {
      title: 'Execute an SSH command',
      description:
        'Connect to a remote host over SSH and execute one command. Connection credentials can be supplied per call or through MCP_SSH_* environment variables.',
      inputSchema: {
        ...sshConnectionSchema,
        command: z.string().min(1).describe('The shell command to execute remotely.'),
        cwd: z.string().min(1).optional().describe('Remote working directory.'),
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(120_000)
          .optional()
          .describe('Connection and command timeout in milliseconds.'),
        maxOutputBytes: z
          .number()
          .int()
          .min(1)
          .max(10_485_760)
          .optional()
          .describe('Maximum combined stdout and stderr size; defaults to 1 MiB.'),
      },
    },
    async (input) => {
      try {
        const args = input as SshToolInput & { command: string };
        const connection = resolveConnectionOptions(args);
        const limits = resolveExecutionLimits(args);
        const result = await executeSshCommand({
          connection,
          command: args.command,
          ...limits,
          ...(args.cwd ? { cwd: args.cwd } : {}),
        });

        return {
          content: [{ type: 'text' as const, text: outputText(result) }],
          isError: result.exitCode !== 0,
        };
      } catch (error) {
        return {
          content: [
            { type: 'text' as const, text: `SSH execution failed: ${errorMessage(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'ssh_test_connection',
    {
      title: 'Test an SSH connection',
      description: 'Verify SSH credentials and connectivity without executing a remote command.',
      inputSchema: {
        ...sshConnectionSchema,
        timeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(120_000)
          .optional()
          .describe('Connection timeout in milliseconds.'),
      },
    },
    async (input) => {
      try {
        const args = input as SshToolInput;
        const connection = resolveConnectionOptions(args);
        const { timeoutMs } = resolveExecutionLimits(args);
        await testSshConnection(connection, timeoutMs);
        return {
          content: [{ type: 'text' as const, text: 'SSH connection succeeded.' }],
        };
      } catch (error) {
        return {
          content: [
            { type: 'text' as const, text: `SSH connection failed: ${errorMessage(error)}` },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
