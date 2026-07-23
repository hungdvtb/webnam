import BundleProductDetailPageTheme from './BundleProductDetailPageTheme';
import ConfigurableProductDetailPageTheme from './ConfigurableProductDetailPageTheme';
import SimpleProductDetailPageTheme from './SimpleProductDetailPageTheme';

const PRODUCT_TYPE_THEME_COMPONENTS = {
  bundle: BundleProductDetailPageTheme,
  configurable: ConfigurableProductDetailPageTheme,
  simple: SimpleProductDetailPageTheme,
};

export default function ProductDetailPageTheme(props) {
  const productType = String(props.product?.type || 'simple').trim();
  const ProductTypeTheme = PRODUCT_TYPE_THEME_COMPONENTS[productType] || SimpleProductDetailPageTheme;

  return <ProductTypeTheme {...props} />;
}
