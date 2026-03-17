import ProductsPage from '../../products/page';

export default async function CategoryPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;
  
  // Pass category slug via searchParams to the ProductsPage component
  return <ProductsPage searchParams={{ ...resolvedSearchParams, category: slug }} />;
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const slug = resolvedParams?.slug || '';
  
  if (!slug) {
    return {
      title: 'Danh mục | GỐM ĐẠI THÀNH'
    };
  }

  const formattedSlug = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');

  return {
    title: `${formattedSlug} | GỐM ĐẠI THÀNH`,
    description: `Khám phá bộ sưu tập ${slug.replace(/-/g, ' ')} tinh xảo từ làng gốm Bát Tràng.`
  };
}
