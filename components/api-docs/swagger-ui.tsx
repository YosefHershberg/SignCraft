'use client';

/**
 * The Swagger UI client island behind `/api-docs`.
 *
 * Why it exists: the reviewer's checklist is three behaviours (the order state
 * machine, the claim race, the direct-to-cloud upload) and all three are
 * server-authoritative — the UI only ever offers what the API allows. Rendering
 * `public/openapi.yaml` with "Try it out" enabled lets the reviewer drive those
 * endpoints by hand: set `x-persona` once via the Authorize button
 * (`persistAuthorization` keeps it), then POST an illegal transition to see the
 * 400 with its `allowed` list, or fire two claims from two browsers.
 *
 * Why swagger-ui-dist from a CDN rather than `swagger-ui-react`: that package
 * has unresolved React 19 peer conflicts, and this page is documentation, not
 * product — it must not add a dependency to the app bundle. `next/script` with
 * `afterInteractive` keeps the bundle untouched, and its `onLoad` (a client-only
 * callback) is the reason this is a client component at all.
 */

import Script from 'next/script';

declare global {
  interface Window {
    SwaggerUIBundle?: (opts: Record<string, unknown>) => unknown;
  }
}

/** Mounts Swagger UI over `/openapi.yaml` into its own `#swagger-ui` container. */
export function SwaggerUi() {
  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
        strategy="afterInteractive"
        onLoad={() => {
          window.SwaggerUIBundle?.({
            url: '/openapi.yaml',
            dom_id: '#swagger-ui',
            deepLinking: true,
            tryItOutEnabled: true,
            persistAuthorization: true,
          });
        }}
      />
      <div id="swagger-ui" />
    </>
  );
}
