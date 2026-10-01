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
    'Cache-Control': 'public, max-age=300',
    'Content-Disposition': `inline; filename="meta-feed.${normalizedFormat}"`,
    'Access-Control-Allow-Origin': '*',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    headers.set('Content-Length', String(new TextEncoder().encode(errorBody).byteLength));

    return new Response(errorBody, {
      status: response.status,
      headers,
    });
  }

  const body = await response.arrayBuffer();
  headers.set('Content-Length', String(body.byteLength));

  return new Response(body, {
    status: 200,
    headers,
  });
}
