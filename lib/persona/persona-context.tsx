'use client';

/**
 * lib/persona/persona-context.tsx — the per-tab persona: React state seeded
 * once from the `sc_persona` cookie (via `initial`, resolved server-side by
 * `app/page.tsx`) and never re-read from the cookie afterwards. That is what
 * lets two browser tabs act as two different installers at once — each
 * tab's `PersonaSwitcher` only mutates its own state and the cookie it will
 * write for its *own* next reload.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Persona } from '@/lib/domain/types';
import { serialisePersona } from '@/lib/domain/personas';
import { writePersonaCookie } from './cookie';

interface PersonaContextValue {
  persona: Persona;
  setPersona: (p: Persona) => void;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

/** Wraps the dashboard; `initial` is the server-resolved persona for this render (see `resolvePersona`). */
export function PersonaProvider({ initial, children }: { initial: Persona; children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(initial);

  const setPersona = useCallback((next: Persona) => {
    writePersonaCookie(serialisePersona(next));
    setPersonaState(next);
  }, []);

  return <PersonaContext.Provider value={{ persona, setPersona }}>{children}</PersonaContext.Provider>;
}

/** Reads the current tab's persona and its setter; throws outside `PersonaProvider` so a missing provider fails loudly, not with an undefined persona. */
export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error('usePersona must be used within a PersonaProvider');
  return ctx;
}
