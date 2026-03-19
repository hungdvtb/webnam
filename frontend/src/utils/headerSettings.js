export const DEFAULT_HEADER_MENU_ITEMS = [
    { id: 'header-menu-products', label: 'Sản phẩm', link: '/san-pham', enabled: true, order: 1 },
    { id: 'header-menu-about', label: 'Về chúng tôi', link: '/about', enabled: true, order: 2 },
    { id: 'header-menu-knowledge', label: 'Kiến thức gốm', link: '/blog', enabled: true, order: 3 },
    { id: 'header-menu-store', label: 'Hệ thống cửa hàng', link: '/he-thong-cua-hang', enabled: true, order: 4 },
];

const parseMaybeJson = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

export const normalizeHeaderMenus = (value) => {
    const parsed = parseMaybeJson(value) || DEFAULT_HEADER_MENU_ITEMS;

    const normalized = parsed.map((item, index) => {
        const fallback = DEFAULT_HEADER_MENU_ITEMS[index] || DEFAULT_HEADER_MENU_ITEMS[0];
        const label = String(item?.label || item?.title || fallback.label || '').trim();
        const link = String(item?.link || item?.url || fallback.link || '/').trim() || '/';
        const enabled = item?.enabled === undefined ? true : Boolean(item.enabled);
        const rawOrder = Number(item?.order ?? item?.sort_order ?? (index + 1));
        const order = Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : (index + 1);

        return {
            id: String(item?.id || `header-menu-${index + 1}`),
            label: label || fallback.label,
            link,
            enabled,
            order,
        };
    });

    return normalized
        .sort((a, b) => a.order - b.order)
        .map((item, index) => ({ ...item, order: index + 1 }));
};

export const createDefaultHeaderMenus = () => DEFAULT_HEADER_MENU_ITEMS.map((item) => ({ ...item }));

export const buildHeaderConfig = (settings = {}) => {
    const allMenus = normalizeHeaderMenus(settings.header_menu_items);
    const activeMenus = allMenus.filter((menu) => menu.enabled);

    return {
        brandText: settings.header_brand_text || settings.site_name || 'Gốm Đại Thành',
        topNoticeText: settings.header_notice_text || '',
        searchPlaceholder: settings.header_search_placeholder || 'Bạn cần tìm kiếm sản phẩm gì?',
        allMenus,
        activeMenus,
    };
};

