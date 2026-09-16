'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Persona } from '@/lib/domain/types';
import { serialisePersona } from '@/lib/domain/personas';
import { writePersonaCookie } from './cookie';

interface PersonaContextValue {
  persona: Persona;
  setPersona: (p: Persona) => void;
}

const PersonaContext = createContext<PersonaContextValue | null>(null);

export function PersonaProvider({ initial, children }: { initial: Persona; children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(initial);

  const setPersona = useCallback((next: Persona) => {
    writePersonaCookie(serialisePersona(next));
    setPersonaState(next);
  }, []);

  return <PersonaContext.Provider value={{ persona, setPersona }}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error('usePersona must be used within a PersonaProvider');
  return ctx;
}
