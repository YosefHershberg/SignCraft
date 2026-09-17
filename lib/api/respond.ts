/** Response helpers for route handlers. */

/** `JSON.stringify` throws on bigint; the DTO layer already converts, this is the safety net for anything that bypasses it. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** A JSON response with the given status; the only way handlers build bodies, so the content-type is always right. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, bigintReplacer), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 204 with no body — the `/progress` and `/abort` success response. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}
