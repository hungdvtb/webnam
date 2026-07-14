import { headers } from 'next/headers';
import config from './config';

const LOOPBACK_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)(?::\d+)?$/i;

export async function getServerPublicHost() {
  try {
    const headerStore = await headers();
    const forwardedHost = headerStore.get('x-forwarded-host');
    const host = headerStore.get('host');

    const publicHost = String(forwardedHost || host || '').split(',')[0].trim();

    if (publicHost && !LOOPBACK_HOST_PATTERN.test(publicHost)) {
      return publicHost;
    }

    return String(config.publicHost || publicHost || '').trim();
  } catch {
    return String(config.publicHost || '').trim();
  }
}
