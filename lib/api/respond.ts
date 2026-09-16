function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, bigintReplacer), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
