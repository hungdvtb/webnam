import { getWebCategory } from '@/lib/api';
import { getServerPublicHost } from '@/lib/serverPublicHost';
import ProductsPage from '../../products/page';

export default async function CategoryPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;

  return <ProductsPage searchParams={{ ...resolvedSearchParams, category: slug }} />;
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const slug = resolvedParams?.slug || '';

  if (!slug) {
    return {
      title: 'Danh muc | GOM DAI THANH',
    };
  }

  try {
    const publicHost = await getServerPublicHost();
    const category = await getWebCategory(slug, { publicHost });
    const seoTitle = String(category?.meta_title || '').trim();
    const seoDescription = String(category?.meta_description || category?.description || '').trim();
    const seoKeywords = String(category?.meta_keywords || '').trim();

    return {
      title: `${seoTitle || category?.name || 'Danh muc'} | GOM DAI THANH`,
      description: seoDescription || `Kham pha bo suu tap ${slug.replace(/-/g, ' ')} tinh xao tu lang gom Bat Trang.`,
      keywords: seoKeywords || undefined,
      robots: category?.visibility === 'link_only'
        ? {
            index: false,
            follow: true,
          }
        : undefined,
    };
  } catch (error) {
    console.error(`Failed to load category metadata for slug "${slug}"`, error);
  }

  const formattedSlug = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');

  return {
    title: `${formattedSlug} | GOM DAI THANH`,
    description: `Kham pha bo suu tap ${slug.replace(/-/g, ' ')} tinh xao tu lang gom Bat Trang.`,
  };
}
