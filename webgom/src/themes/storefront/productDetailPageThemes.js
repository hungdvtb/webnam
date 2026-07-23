import DoThoProductDetailPageTheme from './do-tho/ProductDetailPageTheme';
import GiaoDienSo2ProductDetailPageTheme from './giao-dien-so-2/ProductDetailPageTheme';

const PRODUCT_DETAIL_THEME_REGISTRY = {
  'do-tho': DoThoProductDetailPageTheme,
  'giao-dien-so-2': GiaoDienSo2ProductDetailPageTheme,
};

export function resolveProductDetailPageTheme(theme) {
  const code = String(theme?.code || theme || '').trim();

  return PRODUCT_DETAIL_THEME_REGISTRY[code] || DoThoProductDetailPageTheme;
}

export function isRegisteredProductDetailTheme(theme) {
  const code = String(theme?.code || theme || '').trim();

  return Boolean(PRODUCT_DETAIL_THEME_REGISTRY[code]);
}
