import { headers } from 'next/headers';

export async function getServerPublicHost() {
  try {
    const headerStore = await headers();
    const forwardedHost = headerStore.get('x-forwarded-host');
    const host = headerStore.get('host');

    return String(forwardedHost || host || '').split(',')[0].trim();
  } catch {
    return '';
  }
}
