import { proxyMetaFeed } from '@/lib/metaFeedProxy';

export const dynamic = 'force-dynamic';

export async function GET() {
  return proxyMetaFeed('csv');
}
