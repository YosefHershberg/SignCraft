/**
 * `/api-docs` — the REST + SSE reference for the SignCraft API, rendered from
 * `public/openapi.yaml` by Swagger UI. A thin server component: it owns the
 * page metadata and the header, and delegates the browser-only Swagger bootstrap
 * to the `'use client'` island in `components/api-docs/swagger-ui.tsx`.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { SwaggerUi } from '@/components/api-docs/swagger-ui';

export const metadata: Metadata = {
  title: 'SignCraft API docs',
  description: 'Interactive OpenAPI 3.1 reference for the SignCraft REST and SSE API.',
};

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 text-sm">
        <span className="font-semibold">SignCraft API</span>
        <span className="text-muted-foreground">
          Set <code>x-persona</code> with Authorize, then use Try it out.
        </span>
        <span className="ml-auto flex gap-3">
          <Link href="/" className="underline underline-offset-4">
            Dashboard
          </Link>
          <a href="/openapi.yaml" className="underline underline-offset-4">
            openapi.yaml
          </a>
        </span>
      </header>
      <SwaggerUi />
    </main>
  );
}
