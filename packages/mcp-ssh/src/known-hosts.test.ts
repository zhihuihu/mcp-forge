import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { matchesKnownHosts } from './ssh-client.js';

describe('matchesKnownHosts', () => {
  const key = Buffer.from('test-host-key');
  const keyBase64 = key.toString('base64');

  it('matches a plain hostname and rejects a different key', () => {
    const content = `example.com ssh-ed25519 ${keyBase64}`;

    expect(matchesKnownHosts(content, 'example.com', 22, key)).toBe(true);
    expect(matchesKnownHosts(content, 'example.com', 22, Buffer.from('other-key'))).toBe(false);
    expect(matchesKnownHosts(content, 'other.example.com', 22, key)).toBe(false);
  });

  it('matches non-default ports and hashed hostnames', () => {
    const portEntry = `[example.com]:2222 ssh-ed25519 ${keyBase64}`;
    const salt = Buffer.from('known-host-salt');
    const hash = createHmac('sha1', salt).update('example.com').digest('base64');
    const hashedEntry = `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${keyBase64}`;

    expect(matchesKnownHosts(portEntry, 'example.com', 2222, key)).toBe(true);
    expect(matchesKnownHosts(hashedEntry, 'example.com', 22, key)).toBe(true);
  });

  it('does not trust revoked or certificate-authority entries', () => {
    const revoked = `@revoked example.com ssh-ed25519 ${keyBase64}`;
    const certificateAuthority = `@cert-authority example.com ssh-ed25519 ${keyBase64}`;

    expect(matchesKnownHosts(revoked, 'example.com', 22, key)).toBe(false);
    expect(matchesKnownHosts(certificateAuthority, 'example.com', 22, key)).toBe(false);
  });
});
