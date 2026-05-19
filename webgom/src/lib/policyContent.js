import { getBlogPost } from './blogApi';

export const POLICY_MENU_ITEMS = [
  {
    id: 'doi-tra',
    icon: 'assignment_return',
    label: 'Ch\u00ednh s\u00e1ch \u0111\u1ed5i tr\u1ea3 v\u00e0 ho\u00e0n ti\u1ec1n',
    postSlug: 'chinh-sach-doi-tra-hang-va-hoan-tien',
    legacyTabs: ['doi-tra'],
  },
  {
    id: 'kiem-hang',
    icon: 'rule',
    label: 'Ch\u00ednh s\u00e1ch ki\u1ec3m h\u00e0ng',
    postSlug: 'chinh-sach-kiem-hang',
    legacyTabs: ['kiem-hang'],
  },
  {
    id: 'giao-hang',
    icon: 'local_shipping',
    label: 'Ch\u00ednh s\u00e1ch giao h\u00e0ng',
    postSlug: 'chinh-sach-giao-hang',
    legacyTabs: ['giao-hang', 'van-chuyen'],
  },
  {
    id: 'bao-hanh',
    icon: 'workspace_premium',
    label: 'Ch\u00ednh s\u00e1ch b\u1ea3o h\u00e0nh',
    postSlug: 'chinh-sach-bao-hanh',
    legacyTabs: ['bao-hanh', 'ban-hang'],
  },
];

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getPolicyBySlug(postSlug) {
  const normalizedSlug = normalizeValue(postSlug);
  return POLICY_MENU_ITEMS.find((item) => item.postSlug === normalizedSlug) || null;
}

export function getPolicyByLegacyTab(tab) {
  const normalizedTab = normalizeValue(tab);
  return (
    POLICY_MENU_ITEMS.find(
      (item) => item.id === normalizedTab || item.legacyTabs?.includes(normalizedTab)
    ) || null
  );
}

export function resolveActivePolicy(searchParams) {
  const fromSlug = getPolicyBySlug(searchParams?.slug);
  if (fromSlug) {
    return fromSlug;
  }

  const fromLegacyTab = getPolicyByLegacyTab(searchParams?.tab);
  if (fromLegacyTab) {
    return fromLegacyTab;
  }

  return POLICY_MENU_ITEMS[0];
}

export function buildPolicyHref(item) {
  return `/policy?slug=${encodeURIComponent(item.postSlug)}`;
}

export function getPolicyContent(post) {
  const content = typeof post?.content === 'string' ? post.content : post?.body;
  return typeof content === 'string' ? content.trim() : '';
}

export function normalizePolicyPost(item, post) {
  return {
    id: item.id,
    icon: item.icon,
    label: item.label,
    postSlug: item.postSlug,
    title: item.label,
    postTitle: typeof post?.title === 'string' ? post.title.trim() : '',
    excerpt: typeof post?.excerpt === 'string' ? post.excerpt.trim() : '',
    content: getPolicyContent(post),
    hasPost: Boolean(post?.id),
  };
}

export async function getPolicyPosts() {
  const results = await Promise.allSettled(
    POLICY_MENU_ITEMS.map(async (item) => normalizePolicyPost(item, await getBlogPost(item.postSlug)))
  );

  return POLICY_MENU_ITEMS.map((item, index) => (
    results[index]?.status === 'fulfilled'
      ? results[index].value
      : normalizePolicyPost(item, null)
  ));
}
