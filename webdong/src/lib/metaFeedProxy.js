const FALLBACK_BACKEND_BASE_URL = 'https://api.gomdaithanh.com';

const contentTypes = {
  csv: 'text/csv; charset=UTF-8',
  xml: 'application/xml; charset=UTF-8',
};

function resolveBackendBaseUrl() {
  const configuredUrl = String(
    process.env.META_FEED_BACKEND_URL
    || process.env.NEXT_PUBLIC_API_URL
    || FALLBACK_BACKEND_BASE_URL,
  ).trim();

  if (!configuredUrl || configuredUrl.startsWith('/')) {
    return FALLBACK_BACKEND_BASE_URL;
  }

  try {
    const url = new URL(configuredUrl);
    url.pathname = url.pathname.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
    url.search = '';
    url.hash = '';

    return url.toString().replace(/\/+$/, '');
  } catch {
    return FALLBACK_BACKEND_BASE_URL;
  }
}

export async function proxyMetaFeed(format) {
  const normalizedFormat = format === 'xml' ? 'xml' : 'csv';
  const backendUrl = `${resolveBackendBaseUrl()}/meta-feed.${normalizedFormat}`;
  const response = await fetch(backendUrl, {
    cache: 'no-store',
    headers: {
      Accept: contentTypes[normalizedFormat],
    },
  });
  const headers = new Headers({
    'Content-Type': response.headers.get('content-type') || contentTypes[normalizedFormat],
    'Cache-Control': 'no-store, max-age=0',
  });

  if (!response.ok) {
    return new Response(await response.text(), {
      status: response.status,
      headers,
    });
  }

  return new Response(response.body, {
    status: 200,
    headers,
  });
}
