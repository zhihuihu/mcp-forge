import { describe, expect, it } from 'vitest';

import { appendChunk, commandWithWorkingDirectory, type OutputState } from './ssh-client.js';

describe('ssh-client helpers', () => {
  describe('commandWithWorkingDirectory', () => {
    it('returns command as-is when cwd is undefined', () => {
      expect(commandWithWorkingDirectory('ls -la', undefined)).toBe('ls -la');
    });

    it('wraps command in a subshell to prevent command escaping when cd fails', () => {
      const result = commandWithWorkingDirectory('cat file.txt; rm -rf *', '/tmp/app');
      expect(result).toBe("cd '/tmp/app' && (\ncat file.txt; rm -rf *\n)");
    });

    it('handles paths with quotes properly', () => {
      const result = commandWithWorkingDirectory('pwd', "/tmp/user's dir");
      expect(result).toBe("cd '/tmp/user'\\''s dir' && (\npwd\n)");
    });
  });

  describe('appendChunk smooth truncation', () => {
    it('appends chunks normally when within maxOutputBytes', () => {
      const chunks: Buffer[] = [];
      const state: OutputState = { bytes: 0, truncated: false };
      const chunk1 = Buffer.from('hello ');
      const chunk2 = Buffer.from('world');

      appendChunk(chunks, chunk1, state, 100);
      appendChunk(chunks, chunk2, state, 100);

      expect(state.bytes).toBe(11);
      expect(state.truncated).toBe(false);
      expect(Buffer.concat(chunks).toString('utf8')).toBe('hello world');
    });

    it('smoothly truncates and does not throw when exceeding maxOutputBytes', () => {
      const chunks: Buffer[] = [];
      const state: OutputState = { bytes: 0, truncated: false };

      appendChunk(chunks, Buffer.from('12345'), state, 10);
      expect(state.bytes).toBe(5);
      expect(state.truncated).toBe(false);

      // Next chunk of 10 bytes will exceed 10 max bytes (only 5 bytes fit)
      appendChunk(chunks, Buffer.from('67890ABCDE'), state, 10);
      expect(state.bytes).toBe(10);
      expect(state.truncated).toBe(true);
      expect(Buffer.concat(chunks).toString('utf8')).toBe('1234567890');

      // Subsequent chunks are silently ignored once truncated
      appendChunk(chunks, Buffer.from('FGHIJ'), state, 10);
      expect(state.bytes).toBe(10);
      expect(state.truncated).toBe(true);
      expect(Buffer.concat(chunks).toString('utf8')).toBe('1234567890');
    });
  });
});
