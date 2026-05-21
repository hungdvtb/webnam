import config from './config';

export async function getBlogPosts(params = {}) {
  const urlParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      urlParams.append(key, value);
    }
  });
  const query = urlParams.toString();
  try {
    const res = await fetch(`${config.apiUrl}/blog${query ? `?${query}` : ''}`, {
      headers: { 'Accept': 'application/json', 'X-Site-Code': config.siteCode },
      cache: 'no-store',
    });

    if (!res.ok) {
      return { data: [], categories: [], meta: null, __ok: false };
    }

    const payload = await res.json();

    if (payload && typeof payload === 'object') {
      return { ...payload, __ok: true };
    }

    return { data: [], categories: [], meta: null, __ok: true };
  } catch {
    return { data: [], categories: [], meta: null, __ok: false };
  }
}

export async function getBlogCategories() {
  try {
    const res = await fetch(`${config.apiUrl}/blog/categories`, {
      headers: { 'Accept': 'application/json', 'X-Site-Code': config.siteCode },
      cache: 'no-store',
    });

    if (!res.ok) {
      return [];
    }

    const payload = await res.json();

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    if (Array.isArray(payload)) {
      return payload;
    }

    return [];
  } catch {
    return [];
  }
}

export async function getBlogPost(id) {
  const slugOrId = encodeURIComponent(String(id ?? ''));
  if (!slugOrId) return null;

  try {
    const res = await fetch(`${config.apiUrl}/blog/${slugOrId}`, {
      headers: { 'Accept': 'application/json', 'X-Site-Code': config.siteCode },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    return res.json();
  } catch {
    return null;
  }
}
