import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import { ApiHttpClient } from './http-client.js';
import { createServer } from './server.js';
import { parseApiSpec } from './spec-parser.js';
import type { ResolvedConfig } from './types.js';

describe('mcp-api McpServer tools', () => {
  const sampleSpec = {
    openapi: '3.0.0',
    info: {
      title: 'Pet Store',
      version: '1.0.0',
      description: 'Petstore API demo',
    },
    servers: [{ url: 'https://petstore.swagger.io/v2' }],
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          summary: 'List all pets',
          tags: ['pets'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': { description: 'A paged array of pets' },
          },
        },
        post: {
          operationId: 'createPet',
          summary: 'Create a pet',
          tags: ['pets'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPetById',
          summary: 'Info for a specific pet',
          tags: ['pets'],
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Expected response' } },
        },
      },
      '/users/login': {
        get: {
          operationId: 'loginUser',
          summary: 'Logs user into system',
          tags: ['users'],
          responses: { '200': { description: 'Success' } },
        },
      },
    },
  };

  const parsedSpec = parseApiSpec(sampleSpec, 'https://petstore.swagger.io', true);
  const config: ResolvedConfig = {
    spec: 'https://petstore.swagger.io',
    defaultHeaders: { 'X-Default': 'test' },
    timeoutMs: 5000,
    maxResultBytes: 1048576,
  };

  async function createConnectedClient() {
    const httpClient = new ApiHttpClient(parsedSpec.info.baseUrl, config.defaultHeaders, config.timeoutMs);
    const server = createServer(config, parsedSpec, httpClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-runner', version: '1.0.0' }, { capabilities: {} });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it('exposes exactly the 4 standard Gateway tools', async () => {
    const client = await createConnectedClient();
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'api_call',
      'api_get_endpoint_details',
      'api_get_spec_info',
      'api_list_endpoints',
    ]);
  });

  it('api_get_spec_info returns metadata and stats', async () => {
    const client = await createConnectedClient();
    const res = await client.callTool({ name: 'api_get_spec_info', arguments: {} });
    const content = JSON.parse((res.content as [{ text: string }])[0].text);
    expect(content.title).toBe('Pet Store');
    expect(content.version).toBe('1.0.0');
    expect(content.baseUrl).toBe('https://petstore.swagger.io/v2');
    expect(content.totalEndpoints).toBe(4);
    expect(content.tags).toEqual(['pets', 'users']);
  });

  it('api_list_endpoints supports search, tag, and method filtering', async () => {
    const client = await createConnectedClient();

    // 1. list all
    const all = await client.callTool({ name: 'api_list_endpoints', arguments: {} });
    const allParsed = JSON.parse((all.content as [{ text: string }])[0].text);
    expect(allParsed.totalMatched).toBe(4);

    // 2. filter by tag
    const petsOnly = await client.callTool({
      name: 'api_list_endpoints',
      arguments: { tag: 'users' },
    });
    const petsParsed = JSON.parse((petsOnly.content as [{ text: string }])[0].text);
    expect(petsParsed.totalMatched).toBe(1);
    expect(petsParsed.endpoints[0].operationId).toBe('loginUser');

    // 3. search query
    const searchRes = await client.callTool({
      name: 'api_list_endpoints',
      arguments: { search: 'petId' },
    });
    const searchParsed = JSON.parse((searchRes.content as [{ text: string }])[0].text);
    expect(searchParsed.totalMatched).toBe(1);
    expect(searchParsed.endpoints[0].operationId).toBe('getPetById');

    // 4. filter by method
    const postRes = await client.callTool({
      name: 'api_list_endpoints',
      arguments: { method: 'POST' },
    });
    const postParsed = JSON.parse((postRes.content as [{ text: string }])[0].text);
    expect(postParsed.totalMatched).toBe(1);
    expect(postParsed.endpoints[0].operationId).toBe('createPet');

    // 5. pagination (offset and limit)
    const pageRes = await client.callTool({
      name: 'api_list_endpoints',
      arguments: { offset: 1, limit: 2 },
    });
    const pageParsed = JSON.parse((pageRes.content as [{ text: string }])[0].text);
    expect(pageParsed.totalMatched).toBe(4);
    expect(pageParsed.offset).toBe(1);
    expect(pageParsed.limit).toBe(2);
    expect(pageParsed.returned).toBe(2);
    expect(pageParsed.hasMore).toBe(true);
  });

  it('api_get_endpoint_details returns parameter and schema details', async () => {
    const client = await createConnectedClient();

    // By operationId
    const res = await client.callTool({
      name: 'api_get_endpoint_details',
      arguments: { operationId: 'getPetById' },
    });
    const details = JSON.parse((res.content as [{ text: string }])[0].text);
    expect(details.operationId).toBe('getPetById');
    expect(details.method).toBe('GET');
    expect(details.path).toBe('/pets/{petId}');
    expect(details.parameters[0].name).toBe('petId');
    expect(details.parameters[0].in).toBe('path');

    // By method and path
    const resPath = await client.callTool({
      name: 'api_get_endpoint_details',
      arguments: { method: 'POST', path: '/pets' },
    });
    const detailsPath = JSON.parse((resPath.content as [{ text: string }])[0].text);
    expect(detailsPath.operationId).toBe('createPet');
    expect(detailsPath.requestBody.required).toBe(true);

    // By method and path with trailing slash tolerance
    const resSlash = await client.callTool({
      name: 'api_get_endpoint_details',
      arguments: { method: 'POST', path: '/pets/' },
    });
    const detailsSlash = JSON.parse((resSlash.content as [{ text: string }])[0].text);
    expect(detailsSlash.operationId).toBe('createPet');

    // Non-existent
    const missing = await client.callTool({
      name: 'api_get_endpoint_details',
      arguments: { operationId: 'unknownOp' },
    });
    expect(missing.isError).toBe(true);
  });

  it('api_call executes request via http client', async () => {
    let calledUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify({ id: 10, name: 'Doggie' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = await createConnectedClient();
    const callRes = await client.callTool({
      name: 'api_call',
      arguments: {
        operationId: 'getPetById',
        pathParams: { petId: '10' },
      },
    });

    expect(calledUrl).toBe('https://petstore.swagger.io/v2/pets/10');
    const parsed = JSON.parse((callRes.content as [{ text: string }])[0].text);
    expect(parsed.status).toBe(200);
    expect(parsed.data).toEqual({ id: 10, name: 'Doggie' });
  });
});
