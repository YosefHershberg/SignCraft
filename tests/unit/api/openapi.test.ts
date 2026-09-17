/**
 * Keeps `public/openapi.yaml` honest: the document is hand-authored, so nothing
 * but this test stops it drifting from the routes it claims to describe. It
 * reads the route files and `lib/api/errors.ts` as *source*, so adding a route,
 * a method or an error code fails here until the spec catches up.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ORDER_STATUSES, SIGN_TYPES } from '@/lib/domain/types';

interface Operation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
}

interface Spec {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, { type?: string; in?: string; name?: string }>;
    schemas: Record<string, { enum?: string[] }>;
  };
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const spec = parse(readFileSync(path.join(repoRoot, 'public/openapi.yaml'), 'utf8')) as Spec;

/** Every `app/api/**\/route.ts`, absolute. */
function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (entry.name === 'route.ts') found.push(full);
  }
  return found.sort();
}

/** `app/api/assets/[id]/parts/route.ts` -> `/api/assets/{id}/parts`. */
function specPathFor(routeFile: string): string {
  const rel = path.relative(path.join(repoRoot, 'app'), path.dirname(routeFile));
  return `/${rel.split(path.sep).join('/')}`.replace(/\[(\w+)\]/g, '{$1}');
}

/** The HTTP verbs a route file exports, lower-cased, in spec order. */
function exportedMethods(routeFile: string): string[] {
  const source = readFileSync(routeFile, 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/export\s+const\s+([A-Z]+)\b/g)) {
    const method = match[1].toLowerCase();
    if ((HTTP_METHODS as readonly string[]).includes(method)) found.add(method);
  }
  return [...found].sort();
}

function declaredMethods(specPath: string): string[] {
  const item = spec.paths[specPath] ?? {};
  return Object.keys(item)
    .filter((key) => (HTTP_METHODS as readonly string[]).includes(key))
    .sort();
}

function operations(): { id: string; op: Operation }[] {
  const all: { id: string; op: Operation }[] = [];
  for (const [specPath, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method] as Operation | undefined;
      if (op) all.push({ id: `${method.toUpperCase()} ${specPath}`, op });
    }
  }
  return all;
}

const files = routeFiles(path.join(repoRoot, 'app/api'));

describe('openapi.yaml document', () => {
  it('is OpenAPI 3.1', () => {
    expect(spec.openapi.startsWith('3.1')).toBe(true);
  });

  it('declares both servers and the persona security scheme', () => {
    expect(spec.servers.map((server) => server.url)).toEqual([
      'http://localhost:3000',
      'https://signcraft-blond.vercel.app',
    ]);
    expect(spec.components.securitySchemes.persona).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'x-persona',
    });
  });
});

describe('every route is documented', () => {
  it.each(files.map((file) => [specPathFor(file), file] as const))('%s has a path item', (specPath) => {
    expect(Object.keys(spec.paths)).toContain(specPath);
  });

  it('documents no path that has no route handler', () => {
    const real = files.map(specPathFor).sort();
    expect(Object.keys(spec.paths).sort()).toEqual(real);
  });

  it.each(files.map((file) => [specPathFor(file), file] as const))(
    '%s declares exactly the methods the handler exports',
    (specPath, file) => {
      expect(declaredMethods(specPath)).toEqual(exportedMethods(file));
    }
  );
});

describe('enums mirror the code', () => {
  it('ErrorCode matches the union in lib/api/errors.ts', () => {
    const source = readFileSync(path.join(repoRoot, 'lib/api/errors.ts'), 'utf8');
    const block = source.match(/export type ErrorCode =([\s\S]*?);/)?.[1];
    expect(block).toBeDefined();
    const codes = [...(block ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect([...(spec.components.schemas.ErrorCode.enum ?? [])].sort()).toEqual([...codes].sort());
  });

  it('OrderStatus matches ORDER_STATUSES', () => {
    expect(spec.components.schemas.OrderStatus.enum).toEqual([...ORDER_STATUSES]);
  });

  it('SignType matches SIGN_TYPES', () => {
    expect(spec.components.schemas.SignType.enum).toEqual([...SIGN_TYPES]);
  });

  it('JobStatus and AssetStatus match the literal unions in lib/domain/types.ts', () => {
    expect(spec.components.schemas.JobStatus.enum).toEqual(['OPEN', 'CLAIMED', 'ASSIGNED']);
    expect(spec.components.schemas.AssetStatus.enum).toEqual([
      'PENDING',
      'UPLOADING',
      'UPLOADED',
      'FAILED',
      'ABORTED',
    ]);
  });
});

describe('every operation is usable', () => {
  it.each(operations().map(({ id, op }) => [id, op] as const))('%s is fully described', (_id, op) => {
    expect(op.operationId).toBeTruthy();
    expect(op.summary).toBeTruthy();
    expect(op.tags?.length).toBeGreaterThan(0);
    const statuses = Object.keys(op.responses ?? {});
    expect(statuses.some((status) => status.startsWith('2'))).toBe(true);
  });

  it('gives every operation a unique operationId', () => {
    const ids = operations().map(({ op }) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
