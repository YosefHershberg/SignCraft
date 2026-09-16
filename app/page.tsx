import { cookies } from 'next/headers';
import { getBootstrap } from '@/lib/services/bootstrap';
import { parsePersona } from '@/lib/domain/personas';
import { Dashboard } from '@/components/dashboard';
import { PERSONA_COOKIE } from '@/lib/persona/cookie';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [data, jar] = await Promise.all([getBootstrap(), cookies()]);
  const persona = parsePersona(jar.get(PERSONA_COOKIE)?.value) ?? { kind: 'ops' as const };
  return <Dashboard initialData={data} initialPersona={persona} />;
}
