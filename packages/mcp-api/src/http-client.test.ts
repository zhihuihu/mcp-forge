import { describe, expect, it, vi } from 'vitest';

import { ApiHttpClient, HttpClientError } from './http-client.js';
import type { ApiEndpoint } from './types.js';

describe('ApiHttpClient', () => {
  const dummyEndpoint: ApiEndpoint = {
    operationId: 'getUserOrder',
    method: 'GET',
    path: '/users/{userId}/orders/{orderId}',
    tags: ['users'],
    deprecated: false,
    parameters: [
      { name: 'userId', in: 'path', required: true },
      { name: 'orderId', in: 'path', required: true },
    ],
    responses: {},
  };

  it('substitutes path parameters into URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ order: 123 }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ApiHttpClient('http://api.test/v1', { 'X-Default': 'val' }, 5000);
    const result = await client.execute(dummyEndpoint, {
      pathParams: { userId: 'alice', orderId: 99 },
      queryParams: { status: 'active' },
      headers: { 'X-Call': 'custom' },
    });

    expect(capturedUrl).toBe('http://api.test/v1/users/alice/orders/99?status=active');
    expect(capturedHeaders['X-Default']).toBe('val');
    expect(capturedHeaders['X-Call']).toBe('custom');
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ order: 123 });
  });

  it('throws when required path parameter is missing', async () => {
    const client = new ApiHttpClient('http://api.test', {}, 5000);
    await expect(
      client.execute(dummyEndpoint, { pathParams: { userId: 'bob' } }),
    ).rejects.toThrow('Missing required path parameter: "orderId"');
  });

  it('serializes JSON request body for POST methods', async () => {
    let capturedBody = '';
    let capturedContentType = '';

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedBody = init?.body?.toString() ?? '';
      const h = init?.headers as Record<string, string>;
      capturedContentType = h['Content-Type'] ?? '';
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const postEndpoint: ApiEndpoint = {
      operationId: 'createItem',
      method: 'POST',
      path: '/items',
      tags: ['items'],
      deprecated: false,
      parameters: [],
      requestBody: {
        required: true,
        contentType: 'application/json',
      },
      responses: {},
    };

    const client = new ApiHttpClient('http://api.test', {}, 5000);
    await client.execute(postEndpoint, {
      body: { name: 'Widget', qty: 5 },
    });

    expect(capturedContentType).toBe('application/json');
    expect(JSON.parse(capturedBody)).toEqual({ name: 'Widget', qty: 5 });
  });

  it('injects default Accept header and handles repeated path params', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response('ok', { status: 200 });
    });

    const multiParamEndpoint: ApiEndpoint = {
      operationId: 'repeatParam',
      method: 'GET',
      path: '/groups/{gid}/subgroups/{gid}',
      tags: ['groups'],
      deprecated: false,
      parameters: [],
      responses: {},
    };

    const client = new ApiHttpClient('http://api.test', {}, 5000);
    await client.execute(multiParamEndpoint, { pathParams: { gid: '42' } });

    expect(capturedUrl).toBe('http://api.test/groups/42/subgroups/42');
    expect(capturedHeaders['Accept']).toBe('application/json, text/plain, */*');
  });

  it('generates reproducible curl command on success and includes curl in failure', async () => {
    // 1. Success case
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ApiHttpClient('http://api.test', { 'Authorization': 'Bearer test-token' }, 5000);
    const postEndpoint: ApiEndpoint = {
      operationId: 'createItem',
      method: 'POST',
      path: '/items',
      tags: ['items'],
      deprecated: false,
      parameters: [],
      responses: {},
    };

    const res = await client.execute(postEndpoint, {
      queryParams: { dryRun: true },
      body: { title: 'Book' },
    });

    expect(res.curl).toBeDefined();
    expect(res.curl).toContain("curl -X POST 'http://api.test/items?dryRun=true'");
    expect(res.curl).toContain("-H 'Authorization: Bearer test-token'");
    expect(res.curl).toContain("-H 'Content-Type: application/json'");
    expect(res.curl).toContain("-d '{\"title\":\"Book\"}'");

    // 2. Failure case
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      throw new Error('Connection refused');
    });

    await expect(client.execute(postEndpoint, { body: { title: 'Book' } })).rejects.toThrow(
      /Generated cURL:\s+curl -X POST/,
    );
  });
});
