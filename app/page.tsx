import { cookies } from 'next/headers';
import { getBootstrap } from '@/lib/services/bootstrap';
import { parsePersona, resolvePersona } from '@/lib/domain/personas';
import { Dashboard } from '@/components/dashboard';
import { PERSONA_COOKIE } from '@/lib/persona/cookie';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [data, jar] = await Promise.all([getBootstrap(), cookies()]);
  // Checked against this database's people, not just parsed: a cookie written
  // against an older seed would otherwise restore a vendor who no longer
  // exists and hand back an empty board (see `resolvePersona`).
  const persona = resolvePersona(parsePersona(jar.get(PERSONA_COOKIE)?.value), data.vendors, data.installers);
  return <Dashboard initialData={data} initialPersona={persona} />;
}
