const config = {
    apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8003/api',
    siteCode: process.env.NEXT_PUBLIC_SITE_CODE || 'GSDT',
    publicHost: process.env.NEXT_PUBLIC_PUBLIC_HOST || '',
    storageUrl: process.env.NEXT_PUBLIC_STORAGE_URL || 'http://localhost:8003/storage',
    metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID || '2786270608428787',
};

export default config;
