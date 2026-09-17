/**
 * lib/persona/cookie.ts — client-side persistence for the demo persona
 * switcher. The cookie holds the same string `lib/domain/personas.ts`
 * parses on the server, so a page reload (or a fresh server render, via
 * `app/page.tsx#resolvePersona`) picks up the last persona chosen. It only
 * seeds a tab's first render; `PersonaProvider` then holds the persona in
 * React state, which is what lets two tabs run two different personas
 * (CLAUDE.md's two-tab QA recipe).
 */
export const PERSONA_COOKIE = 'sc_persona';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** The raw cookie value (a serialised `Persona`, see `lib/domain/personas.ts`), or null server-side/when absent. */
export function readPersonaCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${PERSONA_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Persists a serialised persona for one year; a no-op on the server (no `document`). */
export function writePersonaCookie(value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
}
