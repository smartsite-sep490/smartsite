import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { WorkerAssignmentController } from '../src/modules/workforce/directory/worker-assignment.controller.js';
import { MainAssignmentCommandService } from '../src/modules/zones/main-assignment-command.service.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';

// -----------------------------------------------------------------------------
// Test Harness: Inert local Nest module for OpenAPI document generation
// -----------------------------------------------------------------------------

async function generateOpenApiDocument(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({
    controllers: [WorkerAssignmentController],
    providers: [
      {
        provide: MainAssignmentCommandService,
        useValue: {},
      },
      {
        provide: UserAuthGuard,
        useValue: { canActivate: () => true },
      },
    ],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  try {
    const config = new DocumentBuilder()
      .setTitle('Worker Assignment API')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'user-token')
      .build();

    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

function getOperation(document: OpenAPIObject, pathPattern: string, method = 'post') {
  const normalizedPath = pathPattern.startsWith('/') ? pathPattern : `/${pathPattern}`;
  const pathItem = document.paths[normalizedPath];
  assert.ok(pathItem, `Path ${normalizedPath} must exist in generated OpenAPI paths`);

  const operation = (pathItem as Record<string, unknown>)[method] as
    | {
        responses?: Record<string, unknown>;
        tags?: string[];
        security?: Record<string, unknown>[];
      }
    | undefined;

  assert.ok(operation, `Method ${method.toUpperCase()} must exist on path ${normalizedPath}`);
  assert.ok(
    operation.responses,
    `Responses must exist on ${method.toUpperCase()} ${normalizedPath}`,
  );
  return operation;
}

// -----------------------------------------------------------------------------
// Test Suite: WorkerAssignmentController OpenAPI Regression
// -----------------------------------------------------------------------------

const TARGET_POST_ROUTES = [
  '/workers/{workerId}/site-zone-assignment-requests',
  '/site-zone-assignment-requests/{requestId}/safety-review',
  '/site-zone-assignment-requests/{requestId}/site-manager-decision',
  '/site-zone-assignment-requests/{requestId}/revoke',
] as const;

test('1. all four assignment POST routes are present in OpenAPI document', async () => {
  const document = await generateOpenApiDocument();
  for (const route of TARGET_POST_ROUTES) {
    const operation = getOperation(document, route, 'post');
    assert.ok(operation, `Route ${route} must have a POST operation`);
  }
});

test('2. requestAssignment POST documents 201 Created and no erroneous 200 OK', async () => {
  const document = await generateOpenApiDocument();
  const operation = getOperation(
    document,
    '/workers/{workerId}/site-zone-assignment-requests',
    'post',
  );

  assert.ok(
    operation.responses?.['201'],
    'requestAssignment must document HTTP 201 Created response',
  );
  assert.strictEqual(
    operation.responses?.['200'],
    undefined,
    'requestAssignment must not document HTTP 200 OK response',
  );
});

test('3. safetyReview POST documents 201 Created and no erroneous 200 OK', async () => {
  const document = await generateOpenApiDocument();
  const operation = getOperation(
    document,
    '/site-zone-assignment-requests/{requestId}/safety-review',
    'post',
  );

  assert.ok(
    operation.responses?.['201'],
    'safetyReview must document HTTP 201 Created response (actual Nest @Post default)',
  );
  assert.strictEqual(
    operation.responses?.['200'],
    undefined,
    'safetyReview must not document HTTP 200 OK response',
  );
});

test('4. siteManagerDecision POST documents 201 Created and no erroneous 200 OK', async () => {
  const document = await generateOpenApiDocument();
  const operation = getOperation(
    document,
    '/site-zone-assignment-requests/{requestId}/site-manager-decision',
    'post',
  );

  assert.ok(
    operation.responses?.['201'],
    'siteManagerDecision must document HTTP 201 Created response (actual Nest @Post default)',
  );
  assert.strictEqual(
    operation.responses?.['200'],
    undefined,
    'siteManagerDecision must not document HTTP 200 OK response',
  );
});

test('5. revoke POST documents 201 Created response and no erroneous 200 OK', async () => {
  const document = await generateOpenApiDocument();
  const operation = getOperation(
    document,
    '/site-zone-assignment-requests/{requestId}/revoke',
    'post',
  );

  assert.ok(operation.responses?.['201'], 'revoke must document HTTP 201 Created response');
  assert.strictEqual(
    operation.responses?.['200'],
    undefined,
    'revoke must not document HTTP 200 OK response',
  );
});

test('6. all four POST routes preserve shared controller error responses', async () => {
  const document = await generateOpenApiDocument();
  const expectedErrorCodes = ['400', '401', '403', '404', '409', '429', '503'];

  for (const route of TARGET_POST_ROUTES) {
    const operation = getOperation(document, route, 'post');
    for (const code of expectedErrorCodes) {
      assert.ok(
        operation.responses?.[code],
        `Route ${route} must preserve HTTP ${code} error response from controller decorator`,
      );
    }
  }
});

test('7. all four POST routes preserve tags and user-token bearer security requirement', async () => {
  const document = await generateOpenApiDocument();

  for (const route of TARGET_POST_ROUTES) {
    const operation = getOperation(document, route, 'post');

    assert.deepEqual(
      operation.tags,
      ['worker-site-zone-assignments'],
      `Route ${route} must have tag 'worker-site-zone-assignments'`,
    );

    assert.ok(
      operation.security && operation.security.length > 0,
      `Route ${route} must specify security requirement`,
    );

    const hasUserToken = operation.security.some((sec) => 'user-token' in sec);
    assert.ok(hasUserToken, `Route ${route} must specify 'user-token' bearer authentication`);
  }
});
