export const DEFAULT_FOOTER_MENU_GROUPS = [
    {
        id: 'footer-group-products',
        title: 'Sản phẩm',
        enabled: true,
        order: 1,
        items: [
            { id: 'footer-item-products-1', label: 'Gốm men lam', link: '/san-pham', enabled: true, order: 1 },
            { id: 'footer-item-products-2', label: 'Bộ trà nghệ nhân', link: '/san-pham', enabled: true, order: 2 },
        ],
    },
    {
        id: 'footer-group-support',
        title: 'Hỗ trợ',
        enabled: true,
        order: 2,
        items: [
            { id: 'footer-item-support-1', label: 'Chính sách vận chuyển', link: '/policy', enabled: true, order: 1 },
            { id: 'footer-item-support-2', label: 'Hướng dẫn mua hàng', link: '/dat-hang', enabled: true, order: 2 },
        ],
    },
    {
        id: 'footer-group-about',
        title: 'Về chúng tôi',
        enabled: true,
        order: 3,
        items: [
            { id: 'footer-item-about-1', label: 'Giới thiệu', link: '/about', enabled: true, order: 1 },
            { id: 'footer-item-about-2', label: 'Kiến thức gốm', link: '/blog', enabled: true, order: 2 },
        ],
    },
    {
        id: 'footer-group-contact',
        title: 'Liên hệ',
        enabled: true,
        order: 4,
        items: [
            { id: 'footer-item-contact-1', label: 'Hotline', link: 'tel:0123456789', enabled: true, order: 1 },
            { id: 'footer-item-contact-2', label: 'Email', link: 'mailto:contact@example.com', enabled: true, order: 2 },
        ],
    },
];

const DEFAULT_FOOTER_DESCRIPTION = 'Tôn vinh nét đẹp văn hóa truyền thống qua từng đường nét gốm sứ thủ công tinh xảo.';
const DEFAULT_FOOTER_COPYRIGHT = `© ${new Date().getFullYear()} Gốm Đại Thành. Bảo lưu mọi quyền.`;
const DEFAULT_FOOTER_NEWSLETTER_PLACEHOLDER = 'Email của bạn';

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

const normalizeFooterItems = (items = [], fallbackItems = []) => items
    .map((item, index) => {
        const fallback = fallbackItems[index] || fallbackItems[0] || { label: 'Liên kết', link: '/' };
        const rawOrder = Number(item?.order ?? item?.sort_order ?? (index + 1));

        return {
            id: String(item?.id || `footer-item-${index + 1}`),
            label: String(item?.label || item?.title || fallback.label || '').trim() || fallback.label || 'Liên kết',
            link: String(item?.link || item?.url || fallback.link || '/').trim() || '/',
            enabled: item?.enabled === undefined ? true : Boolean(item.enabled),
            order: Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : (index + 1),
        };
    })
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));

export const normalizeFooterMenuGroups = (value) => {
    const parsed = parseMaybeJson(value) || DEFAULT_FOOTER_MENU_GROUPS;

    return parsed
        .map((group, index) => {
            const fallback = DEFAULT_FOOTER_MENU_GROUPS[index] || DEFAULT_FOOTER_MENU_GROUPS[0];
            const rawOrder = Number(group?.order ?? group?.sort_order ?? (index + 1));

            return {
                id: String(group?.id || `footer-group-${index + 1}`),
                title: String(group?.title || group?.label || fallback.title || '').trim() || fallback.title,
                enabled: group?.enabled === undefined ? true : Boolean(group.enabled),
                order: Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : (index + 1),
                items: normalizeFooterItems(group?.items || [], fallback.items || []),
            };
        })
        .sort((a, b) => a.order - b.order)
        .map((group, index) => ({ ...group, order: index + 1 }));
};

export const createDefaultFooterMenuGroups = () => DEFAULT_FOOTER_MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
}));

export const buildFooterConfig = (settings = {}) => {
    const allGroups = normalizeFooterMenuGroups(settings.footer_menu_groups);
    const activeGroups = allGroups
        .filter((group) => group.enabled)
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => item.enabled),
        }))
        .filter((group) => group.items.length > 0);

    return {
        logoUrl: settings.footer_logo_url || '',
        brandText: settings.footer_brand_text || settings.site_name || 'Gốm Đại Thành',
        description: settings.footer_description || DEFAULT_FOOTER_DESCRIPTION,
        hotline: settings.footer_hotline || settings.contact_phone || '',
        email: settings.footer_email || settings.contact_email || '',
        address: settings.footer_address || '',
        copyrightText: settings.footer_copyright_text || DEFAULT_FOOTER_COPYRIGHT,
        newsletterPlaceholder: settings.footer_newsletter_placeholder || DEFAULT_FOOTER_NEWSLETTER_PLACEHOLDER,
        allGroups,
        activeGroups,
    };
};
