import { describe, expect, it } from 'vitest';

import { parseApiSpec, resolveRef } from './spec-parser.js';

describe('resolveRef', () => {
  it('resolves local component schemas', () => {
    const root = {
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      },
    };

    const target = {
      $ref: '#/components/schemas/User',
    };

    const resolved = resolveRef<{ type: string; properties: Record<string, unknown> }>(target, root);
    expect(resolved.type).toBe('object');
    expect(resolved.properties['id']).toEqual({ type: 'integer' });
  });

  it('handles circular references gracefully without stack overflow', () => {
    const root: Record<string, unknown> = {
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              next: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    };

    const target = { $ref: '#/components/schemas/Node' };
    const resolved = resolveRef<Record<string, unknown>>(target, root);
    expect(resolved['type']).toBe('object');
    const props = resolved['properties'] as Record<string, Record<string, unknown>>;
    expect(props['next']?.['circular']).toBe(true);
  });
});

describe('parseApiSpec - OpenAPI 3.0', () => {
  const openApiSpec = {
    openapi: '3.0.1',
    info: {
      title: 'Store API',
      version: '1.2.3',
      description: 'Test online store',
    },
    servers: [{ url: 'https://api.store.com/v1' }],
    paths: {
      '/products/{id}': {
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Product ID',
          },
        ],
        get: {
          operationId: 'getProductById',
          summary: 'Find product by ID',
          tags: ['products'],
          parameters: [
            {
              name: 'includeDetails',
              in: 'query',
              schema: { type: 'boolean' },
            },
          ],
          responses: {
            '200': {
              description: 'Product found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'integer' }, name: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        put: {
          operationId: 'updateProduct',
          summary: 'Update product',
          tags: ['products', 'admin'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, price: { type: 'number' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated' },
          },
        },
      },
      '/orders': {
        post: {
          summary: 'Create order',
          tags: ['orders'],
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  };

  it('normalizes endpoints and server info', () => {
    const parsed = parseApiSpec(openApiSpec, 'https://example.com/spec.json', true);
    expect(parsed.info.title).toBe('Store API');
    expect(parsed.info.version).toBe('1.2.3');
    expect(parsed.info.baseUrl).toBe('https://api.store.com/v1');
    expect(parsed.info.totalEndpoints).toBe(3);
    expect(parsed.info.tags).toEqual(['admin', 'orders', 'products']);

    const getEp = parsed.endpointsByOperationId.get('getProductById');
    expect(getEp).toBeDefined();
    expect(getEp?.method).toBe('GET');
    expect(getEp?.path).toBe('/products/{id}');
    expect(getEp?.parameters.length).toBe(2); // 1 path + 1 query
    expect(getEp?.parameters.find((p) => p.name === 'id')?.in).toBe('path');
    expect(getEp?.parameters.find((p) => p.name === 'includeDetails')?.in).toBe('query');

    const putEp = parsed.endpointsByOperationId.get('updateProduct');
    expect(putEp?.requestBody?.contentType).toBe('application/json');
    expect(putEp?.requestBody?.required).toBe(true);

    // Synthesized operationId for /orders POST
    const postEp = parsed.endpointsByPathAndMethod.get('POST /orders');
    expect(postEp).toBeDefined();
    expect(postEp?.operationId).toBe('postOrders');
  });

  it('honors baseUrlOverride', () => {
    const parsed = parseApiSpec(openApiSpec, 'https://example.com', true, {
      baseUrlOverride: 'http://custom-host:9090',
    });
    expect(parsed.info.baseUrl).toBe('http://custom-host:9090');
  });

  it('filters endpoints by includeTags and excludeTags', () => {
    const includedOnly = parseApiSpec(openApiSpec, 'https://example.com', true, {
      includeTags: ['orders'],
    });
    expect(includedOnly.endpoints.length).toBe(1);
    expect(includedOnly.endpoints[0]?.tags).toEqual(['orders']);

    const excluded = parseApiSpec(openApiSpec, 'https://example.com', true, {
      excludeTags: ['admin'],
    });
    expect(excluded.endpoints.find((ep) => ep.operationId === 'updateProduct')).toBeUndefined();
    expect(excluded.endpoints.length).toBe(2);
  });
});

describe('parseApiSpec - Swagger 2.0', () => {
  const swaggerSpec = {
    swagger: '2.0',
    info: {
      title: 'Legacy Swagger Service',
      version: '1.0.0',
    },
    host: 'petstore.swagger.io',
    basePath: '/v2',
    schemes: ['https'],
    paths: {
      '/pet': {
        post: {
          operationId: 'addPet',
          summary: 'Add pet',
          consumes: ['application/json'],
          parameters: [
            {
              in: 'body',
              name: 'body',
              description: 'Pet object',
              required: true,
              schema: {
                $ref: '#/definitions/Pet',
              },
            },
          ],
          responses: {
            '200': { description: 'Success' },
          },
        },
      },
    },
    definitions: {
      Pet: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    },
  };

  it('converts Swagger 2.0 body parameters into requestBody and extracts base URL', () => {
    const parsed = parseApiSpec(swaggerSpec, 'https://petstore.swagger.io/v2/swagger.json', true);
    expect(parsed.info.baseUrl).toBe('https://petstore.swagger.io/v2');
    expect(parsed.info.specFormat).toBe('Swagger 2.0');

    const addPetEp = parsed.endpointsByOperationId.get('addPet');
    expect(addPetEp).toBeDefined();
    expect(addPetEp?.requestBody).toBeDefined();
    expect(addPetEp?.requestBody?.contentType).toBe('application/json');
    expect(addPetEp?.requestBody?.required).toBe(true);

    const rbSchema = addPetEp?.requestBody?.schema as { type: string; properties: Record<string, unknown> };
    expect(rbSchema.type).toBe('object');
    expect(rbSchema.properties['name']).toEqual({ type: 'string' });
  });

  it('prepends http:// to baseUrlOverride if protocol is omitted', () => {
    const parsed = parseApiSpec(swaggerSpec, 'https://example.com/spec.json', true, {
      baseUrlOverride: 'api.internal.local:8080/api',
    });
    expect(parsed.info.baseUrl).toBe('http://api.internal.local:8080/api');
  });
});
