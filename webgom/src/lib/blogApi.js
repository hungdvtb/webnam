import config from './config';

export async function getBlogPosts(params = {}) {
  const urlParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      urlParams.append(key, value);
    }
  });
  const query = urlParams.toString();
  const res = await fetch(`${config.apiUrl}/blog${query ? `?${query}` : ''}`, {
    headers: { 'Accept': 'application/json', 'X-Site-Code': config.siteCode },
    next: { revalidate: 60 },
  });
  if (!res.ok) return { data: [], meta: null };
  return res.json();
}

export async function getBlogPost(id) {
  const slugOrId = encodeURIComponent(String(id ?? ''));
  if (!slugOrId) return null;

  const res = await fetch(`${config.apiUrl}/blog/${slugOrId}`, {
    headers: { 'Accept': 'application/json', 'X-Site-Code': config.siteCode },
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  return res.json();
}
