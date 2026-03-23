const floatingContactConfig = {
    // Fallback config used when Site Settings has not been filled yet.
    // You can also override these with Vite env vars if needed.
    phone: import.meta.env.VITE_FLOATING_CONTACT_PHONE || '0326250356',
    zalo: import.meta.env.VITE_FLOATING_CONTACT_ZALO || '',
    messenger: import.meta.env.VITE_FLOATING_CONTACT_MESSENGER || 'https://m.me/',
};

export default floatingContactConfig;
