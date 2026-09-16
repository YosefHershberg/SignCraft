/**
 * Lists the objects under `orders/` in the R2 bucket — the check that a
 * completed upload really landed in storage (the app never sees the bytes, so
 * nothing else in the repo can prove it).
 *
 *   pnpm tsx scripts/list-r2.ts [keyPrefix]
 *
 * Reads the same R2_* variables as the app; prints keys and sizes only, never
 * credentials.
 */
import { config } from 'dotenv';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { formatBytes } from '@/lib/domain/format';

config({ path: '.env' });

const prefix = process.argv[2] ?? 'orders/';

async function main(): Promise<void> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
    forcePathStyle: true,
  });

  let token: string | undefined;
  let count = 0;

  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const object of page.Contents ?? []) {
      count += 1;
      console.log(`${object.Key}  ${formatBytes(object.Size ?? 0)}  ${object.LastModified?.toISOString() ?? ''}`);
    }
    token = page.NextContinuationToken;
  } while (token);

  console.log(`${count} object(s) under ${prefix}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
