// Client-side persistence for the demo persona switcher. The cookie holds
// the same string the server parses with lib/domain/personas.ts, so a page
// reload (or a fresh server render) picks up the last persona chosen.
export const PERSONA_COOKIE = 'sc_persona';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function readPersonaCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${PERSONA_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function writePersonaCookie(value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
}
