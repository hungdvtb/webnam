/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Header settings aliases (admin currently uses these paths)
      { source: '/san-pham', destination: '/products', permanent: false },
      { source: '/san-pham/:slugOrId', destination: '/product/:slugOrId', permanent: false },
      { source: '/danh-muc/:slug', destination: '/category/:slug', permanent: false },
      { source: '/he-thong-cua-hang', destination: '/stores', permanent: false },
      { source: '/dat-hang', destination: '/cart', permanent: false },
      { source: '/checkout', destination: '/cart', permanent: false },
      { source: '/about', destination: '/policy', permanent: false },
      { source: '/cam-on', destination: '/cart', permanent: false },
      { source: '/order-success', destination: '/cart', permanent: false },
      { source: '/order-history', destination: '/cart', permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8003',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '8003',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'placehold.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
