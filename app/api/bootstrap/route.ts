import { withErrorHandling } from '@/lib/api/errors';
import { json } from '@/lib/api/respond';
import { getBootstrap } from '@/lib/services/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => json(await getBootstrap()));
