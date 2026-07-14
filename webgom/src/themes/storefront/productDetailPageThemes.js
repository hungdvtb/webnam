import DoThoProductDetailPageTheme from './do-tho/ProductDetailPageTheme';

const PRODUCT_DETAIL_THEME_REGISTRY = {
  'do-tho': DoThoProductDetailPageTheme,
};

export function resolveProductDetailPageTheme(theme) {
  const code = String(theme?.code || theme || '').trim();

  return PRODUCT_DETAIL_THEME_REGISTRY[code] || DoThoProductDetailPageTheme;
}

export function isRegisteredProductDetailTheme(theme) {
  const code = String(theme?.code || theme || '').trim();

  return Boolean(PRODUCT_DETAIL_THEME_REGISTRY[code]);
}
