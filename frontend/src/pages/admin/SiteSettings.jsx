import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cmsApi, mediaApi, quoteTemplateApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { createDefaultHeaderMenus, normalizeHeaderMenus } from '../../utils/headerSettings';
import { createDefaultFooterMenuGroups, normalizeFooterMenuGroups } from '../../utils/footerSettings';
import { useSearchParams } from 'react-router-dom';

const defaultSettings = {
    site_name: '',
    contact_phone: '',
    contact_email: '',
    facebook_link: '',
    zalo_link: '',
    messenger_link: '',
    tiktok_link: '',
    youtube_link: '',
    fb_pixel_id: '',
    fb_pixel_active: false,
    ga_id: '',
    ga_active: false,
    tt_pixel_id: '',
    tt_pixel_active: false,
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    bank_transfer_template: 'Thanh toan don hang {order_number}',
    bank_qr_code: '',
    quote_logo_url: '',
    quote_store_name: '',
    quote_store_address: '',
    quote_store_phone: '',
    header_logo_url: '',
    header_brand_text: '',
    header_notice_text: '',
    header_search_placeholder: '',
    header_menu_items: createDefaultHeaderMenus(),
    footer_logo_url: '',
    footer_brand_text: '',
    footer_description: '',
    footer_hotline: '',
    footer_email: '',
    footer_address: '',
    footer_copyright_text: '',
    footer_newsletter_placeholder: '',
    footer_menu_groups: createDefaultFooterMenuGroups(),
};

const createHeaderMenuItem = () => ({
    id: `header-menu-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    label: 'Menu mới',
    link: '/',
    enabled: true,
    order: 999,
});

const createFooterMenuGroup = () => ({
    id: `footer-group-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: 'Nhóm mới',
    enabled: true,
    order: 999,
    items: [],
});

const createFooterMenuItem = () => ({
    id: `footer-item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    label: 'Liên kết mới',
    link: '/',
    enabled: true,
    order: 999,
});

const inputClasses = 'w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20';
const textareaClasses = 'w-full min-h-[96px] bg-white border border-primary/20 rounded-sm px-3 py-2 text-[13px] font-bold text-primary focus:outline-none focus:border-primary transition-all placeholder:text-primary/20 resize-none';
const labelClasses = 'text-[11px] font-black uppercase text-primary/80 tracking-wider mb-2 block';

const HEADER_ROUTE_REFERENCE_ROWS = [
    { page: 'Trang chủ', route: '/', note: 'Storefront chính (đã tạo)', scope: 'Public', exists: true },
    { page: 'Sản phẩm', route: '/san-pham', note: 'Danh sách sản phẩm storefront (đã tạo)', scope: 'Public', exists: true },
    { page: 'Chi tiết sản phẩm', route: '/san-pham/:slugOrId', note: 'Route động chi tiết sản phẩm', scope: 'Public', exists: true },
    { page: 'Danh mục sản phẩm', route: '/danh-muc/:slug', note: 'Route động theo danh mục', scope: 'Public', exists: true },
    { page: 'Thanh toán (storefront mới)', route: '/dat-hang', note: 'Trang đặt hàng/checkout hiện tại (đã tạo)', scope: 'Public', exists: true },
    { page: 'Về chúng tôi', route: '/about', note: 'Trang giới thiệu (đã tạo)', scope: 'Public', exists: true },
    { page: 'Tin tức / Kiến thức gốm', route: '/blog', note: 'Danh sách bài viết (đã tạo)', scope: 'Public', exists: true },
    { page: 'Chi tiết bài viết', route: '/blog/:slug', note: 'Route động chi tiết blog', scope: 'Public', exists: true },
    { page: 'Cảm ơn đơn hàng', route: '/cam-on', note: 'Trang hoàn tất đơn (đã tạo)', scope: 'Public', exists: true },
    { page: 'Trang chủ (legacy)', route: '/old', note: 'Nhánh website cũ', scope: 'Legacy', exists: true },
    { page: 'Sản phẩm (legacy)', route: '/old/shop', note: 'Cửa hàng phiên bản cũ', scope: 'Legacy', exists: true },
    { page: 'Chi tiết sản phẩm (legacy)', route: '/old/details', note: 'Chi tiết sản phẩm cũ', scope: 'Legacy', exists: true },
    { page: 'Chi tiết sản phẩm theo id (legacy)', route: '/old/details/:id', note: 'Route động', scope: 'Legacy', exists: true },
    { page: 'Về chúng tôi (legacy)', route: '/old/about', note: 'Trang giới thiệu cũ', scope: 'Legacy', exists: true },
    { page: 'Giỏ hàng (legacy)', route: '/old/cart', note: 'Giỏ hàng cũ', scope: 'Legacy', exists: true },
    { page: 'Thanh toán (legacy)', route: '/old/checkout', note: 'Checkout cũ', scope: 'Legacy', exists: true },
    { page: 'Tin tức (legacy)', route: '/old/blog', note: 'Blog cũ', scope: 'Legacy', exists: true },
    { page: 'Chi tiết bài viết (legacy)', route: '/old/blog/:slug', note: 'Route động', scope: 'Legacy', exists: true },
    { page: 'Đăng nhập (legacy)', route: '/old/login', note: 'Trang đăng nhập cũ', scope: 'Legacy', exists: true },
    { page: 'Đăng ký (legacy)', route: '/old/register', note: 'Trang đăng ký cũ', scope: 'Legacy', exists: true },
    { page: 'Lịch sử đơn / Dashboard (legacy)', route: '/old/dashboard', note: 'Hiện đang dùng cho tài khoản người dùng cũ', scope: 'Legacy', exists: true },
    { page: 'Cảm ơn đơn hàng (legacy)', route: '/old/cam-on', note: 'Trang hoàn tất đơn ở nhánh cũ', scope: 'Legacy', exists: true },
    { page: 'Admin dashboard', route: '/admin', note: 'Trang quản trị', scope: 'Admin', exists: true },
    { page: 'Admin - Sản phẩm', route: '/admin/products', note: 'Quản trị sản phẩm', scope: 'Admin', exists: true },
    { page: 'Admin - Thêm sản phẩm', route: '/admin/products/new', note: 'Form tạo sản phẩm', scope: 'Admin', exists: true },
    { page: 'Admin - Sửa sản phẩm', route: '/admin/products/edit/:id', note: 'Route động', scope: 'Admin', exists: true },
    { page: 'Admin - Danh mục', route: '/admin/categories', note: 'Quản trị danh mục', scope: 'Admin', exists: true },
    { page: 'Admin - Thuộc tính', route: '/admin/attributes', note: 'Quản trị thuộc tính', scope: 'Admin', exists: true },
    { page: 'Admin - Menu', route: '/admin/menus', note: 'Quản trị menu hệ thống', scope: 'Admin', exists: true },
    { page: 'Admin - Accounts', route: '/admin/accounts', note: 'Quản lý account', scope: 'Admin', exists: true },
    { page: 'Admin - Kho', route: '/admin/warehouses', note: 'Quản lý kho', scope: 'Admin', exists: true },
    { page: 'Admin - Vận đơn', route: '/admin/shipments', note: 'Quản lý shipment', scope: 'Admin', exists: true },
    { page: 'Admin - Đơn chờ xử lý', route: '/admin/pending-orders', note: 'Danh sách đơn chờ', scope: 'Admin', exists: true },
    { page: 'Admin - Đơn hàng', route: '/admin/orders', note: 'Danh sách đơn hàng', scope: 'Admin', exists: true },
    { page: 'Admin - Tạo đơn hàng', route: '/admin/orders/new', note: 'Form tạo đơn', scope: 'Admin', exists: true },
    { page: 'Admin - Sửa đơn hàng', route: '/admin/orders/edit/:id', note: 'Route động', scope: 'Admin', exists: true },
    { page: 'Admin - Chi tiết đơn hàng', route: '/admin/orders/:id', note: 'Route động chi tiết', scope: 'Admin', exists: true },
    { page: 'Admin - Tồn kho', route: '/admin/inventory', note: 'Theo dõi nhập/xuất', scope: 'Admin', exists: true },
    { page: 'Admin - Khách hàng', route: '/admin/customers', note: 'Quản lý khách hàng', scope: 'Admin', exists: true },
    { page: 'Admin - Leads', route: '/admin/leads', note: 'Danh sách khách tiềm năng', scope: 'Admin', exists: true },
    { page: 'Admin - Blog', route: '/admin/blog', note: 'Danh sách bài viết', scope: 'Admin', exists: true },
    { page: 'Admin - Tạo bài viết', route: '/admin/blog/new', note: 'Form tạo bài', scope: 'Admin', exists: true },
    { page: 'Admin - Sửa bài viết', route: '/admin/blog/edit/:id', note: 'Route động', scope: 'Admin', exists: true },
    { page: 'Admin - Banner', route: '/admin/banners', note: 'Đã disable khỏi router/menu admin', scope: 'Placeholder', exists: false },
    { page: 'Admin - Tạo banner', route: '/admin/banners/new', note: 'Đã disable khỏi router/menu admin', scope: 'Placeholder', exists: false },
    { page: 'Admin - Sửa banner', route: '/admin/banners/edit/:id', note: 'Đã disable khỏi router/menu admin', scope: 'Placeholder', exists: false },
    { page: 'Admin - Cài đặt web', route: '/admin/settings', note: 'Trang bạn đang thao tác', scope: 'Admin', exists: true },
    { page: 'Admin - Users', route: '/admin/users', note: 'Quản lý người dùng', scope: 'Admin', exists: true },
    { page: 'Admin - Báo cáo', route: '/admin/reports', note: 'Báo cáo kinh doanh', scope: 'Admin', exists: true },
    { page: 'Admin - Cấu hình trạng thái đơn', route: '/admin/order-status-settings', note: 'Thiết lập trạng thái đơn', scope: 'Admin', exists: true },
    { page: 'Admin - Mapping hãng vận chuyển', route: '/admin/carrier-mappings', note: 'Thiết lập carrier mapping', scope: 'Admin', exists: true },
    { page: 'Hệ thống cửa hàng', route: '/he-thong-cua-hang', note: 'Chưa tạo trong router hiện tại (placeholder)', scope: 'Placeholder', exists: false },
    { page: 'Giỏ hàng (storefront mới)', route: '/cart', note: 'Chưa tạo trong storefront mới, đang có /old/cart', scope: 'Placeholder', exists: false },
    { page: 'Thanh toán (route mẫu)', route: '/checkout', note: 'Chưa tạo trong storefront mới, đang dùng /dat-hang', scope: 'Placeholder', exists: false },
    { page: 'Cảm ơn / hoàn tất đơn (route mẫu)', route: '/order-success', note: 'Chưa tạo, hiện dùng /cam-on', scope: 'Placeholder', exists: false },
    { page: 'Lịch sử đơn hàng (route mẫu)', route: '/order-history', note: 'Chưa tạo, gần nhất là /old/dashboard', scope: 'Placeholder', exists: false },
];

const SectionCard = ({ icon, title, children, rightSlot = null }) => (
    <div className="bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden">
        <div className="px-5 py-3 bg-primary/[0.02] border-b border-primary/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
                <h2 className="text-[13px] font-black text-primary uppercase">{title}</h2>
            </div>
            {rightSlot}
        </div>
        <div className="p-6">{children}</div>
    </div>
);

const ImageUploadCard = ({ imageUrl, onUpload, onRemove, emptyLabel, previewClassName = 'h-40' }) => (
    <div className="space-y-3">
        {imageUrl ? (
            <div className="relative group">
                <div className={`w-full ${previewClassName} bg-stone-50 border border-primary/10 rounded-sm overflow-hidden flex items-center justify-center`}>
                    <img src={imageUrl} alt="" className="w-full h-full object-contain" />
                </div>
                <div className="absolute inset-0 bg-primary/45 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all">
                    <label className="cursor-pointer h-10 px-4 rounded-sm bg-white text-primary text-[12px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg">
                        <span className="material-symbols-outlined text-[18px]">upload</span>
                        Đổi ảnh
                        <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
                    </label>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="h-10 px-4 rounded-sm bg-white text-brick text-[12px] font-black uppercase tracking-wider flex items-center gap-2 shadow-lg"
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                        Xóa
                    </button>
                </div>
            </div>
        ) : (
            <label className={`w-full ${previewClassName} border-2 border-dashed border-primary/20 rounded-sm flex flex-col items-center justify-center cursor-pointer hover:bg-primary/[0.02] hover:border-primary/40 transition-all group`}>
                <span className="material-symbols-outlined text-primary/30 text-[34px] group-hover:scale-110 transition-transform">add_photo_alternate</span>
                <span className="mt-2 text-[12px] font-black uppercase tracking-wider text-primary/60 text-center px-4">{emptyLabel}</span>
                <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
            </label>
        )}
    </div>
);

const SiteSettings = () => {
    const { showModal } = useUI();
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'shipping' ? 'contact' : (searchParams.get('tab') || 'contact'));
    const [settings, setSettings] = useState(defaultSettings);
    const [domains, setDomains] = useState([]);
    const [newDomain, setNewDomain] = useState('');
    const [quoteTemplates, setQuoteTemplates] = useState([]);
    const [quoteTemplateDraft, setQuoteTemplateDraft] = useState({ name: '', image_url: '' });
    const [savingQuoteTemplateId, setSavingQuoteTemplateId] = useState(null);
    const [headerMenus, setHeaderMenus] = useState(createDefaultHeaderMenus());
    const [footerMenuGroups, setFooterMenuGroups] = useState(createDefaultFooterMenuGroups());
    const [copiedRoute, setCopiedRoute] = useState('');

    const activeAccountId = localStorage.getItem('activeAccountId');

    const fetchDomains = useCallback(async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(response.data || []);
        } catch (error) {
            console.error('Error fetching domains', error);
        }
    }, []);

    const fetchQuoteTemplates = useCallback(async () => {
        try {
            const response = await quoteTemplateApi.getAll();
            setQuoteTemplates(response.data || []);
        } catch (error) {
            console.error('Error fetching quote templates', error);
        }
    }, []);

    const fetchSettings = useCallback(async () => {
        setLoading(true);
        try {
            const response = await cmsApi.settings.get();
            const incomingSettings = response.data || {};
            const normalizedHeaderMenus = normalizeHeaderMenus(incomingSettings.header_menu_items);
            const normalizedFooterMenuGroups = normalizeFooterMenuGroups(incomingSettings.footer_menu_groups);

            setHeaderMenus(normalizedHeaderMenus);
            setFooterMenuGroups(normalizedFooterMenuGroups);
            setSettings((prev) => ({
                ...prev,
                ...incomingSettings,
                header_brand_text: incomingSettings.header_brand_text || incomingSettings.site_name || prev.header_brand_text,
                header_notice_text: incomingSettings.header_notice_text || prev.header_notice_text,
                header_search_placeholder: incomingSettings.header_search_placeholder || prev.header_search_placeholder,
                header_menu_items: normalizedHeaderMenus,
                footer_brand_text: incomingSettings.footer_brand_text || incomingSettings.site_name || prev.footer_brand_text,
                footer_hotline: incomingSettings.footer_hotline || incomingSettings.contact_phone || prev.footer_hotline,
                footer_email: incomingSettings.footer_email || incomingSettings.contact_email || prev.footer_email,
                footer_menu_groups: normalizedFooterMenuGroups,
            }));
        } catch (error) {
            console.error('Error fetching settings', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
        fetchDomains();
        fetchQuoteTemplates();
    }, [fetchSettings, fetchDomains, fetchQuoteTemplates]);

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        next.set('tab', activeTab);
        next.delete('shippingTab');
        setSearchParams(next, { replace: true });
    }, [activeTab, searchParams, setSearchParams]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings((prev) => ({ ...prev, [name]: value }));
    };

    const withHeaderMenuOrder = (menus) => menus
        .map((menu, index) => ({ ...menu, order: index + 1 }))
        .sort((a, b) => a.order - b.order);

    const updateHeaderMenu = (menuId, patch) => {
        setHeaderMenus((prev) => withHeaderMenuOrder(prev.map((menu) => (
            menu.id === menuId ? { ...menu, ...patch } : menu
        ))));
    };

    const handleAddHeaderMenu = () => {
        setHeaderMenus((prev) => withHeaderMenuOrder([
            ...prev,
            createHeaderMenuItem(),
        ]));
    };

    const handleRemoveHeaderMenu = (menuId) => {
        setHeaderMenus((prev) => withHeaderMenuOrder(prev.filter((menu) => menu.id !== menuId)));
    };

    const handleMoveHeaderMenu = (menuId, direction) => {
        setHeaderMenus((prev) => {
            const currentIndex = prev.findIndex((menu) => menu.id === menuId);
            if (currentIndex === -1) return prev;

            const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;

            const next = [...prev];
            const [picked] = next.splice(currentIndex, 1);
            next.splice(nextIndex, 0, picked);
            return withHeaderMenuOrder(next);
        });
    };

    const withFooterMenuGroupOrder = (groups) => groups
        .map((group, index) => ({
            ...group,
            order: index + 1,
            items: (group.items || [])
                .map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
                .sort((a, b) => a.order - b.order),
        }))
        .sort((a, b) => a.order - b.order);

    const updateFooterMenuGroup = (groupId, patch) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.map((group) => (
            group.id === groupId ? { ...group, ...patch } : group
        ))));
    };

    const handleAddFooterMenuGroup = () => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder([
            ...prev,
            createFooterMenuGroup(),
        ]));
    };

    const handleRemoveFooterMenuGroup = (groupId) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.filter((group) => group.id !== groupId)));
    };

    const handleMoveFooterMenuGroup = (groupId, direction) => {
        setFooterMenuGroups((prev) => {
            const currentIndex = prev.findIndex((group) => group.id === groupId);
            if (currentIndex === -1) return prev;

            const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;

            const next = [...prev];
            const [picked] = next.splice(currentIndex, 1);
            next.splice(nextIndex, 0, picked);
            return withFooterMenuGroupOrder(next);
        });
    };

    const updateFooterMenuItem = (groupId, itemId, patch) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.map((group) => {
            if (group.id !== groupId) return group;

            return {
                ...group,
                items: (group.items || []).map((item) => (
                    item.id === itemId ? { ...item, ...patch } : item
                )),
            };
        })));
    };

    const handleAddFooterMenuItem = (groupId) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.map((group) => (
            group.id === groupId
                ? { ...group, items: [...(group.items || []), createFooterMenuItem()] }
                : group
        ))));
    };

    const handleRemoveFooterMenuItem = (groupId, itemId) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.map((group) => (
            group.id === groupId
                ? { ...group, items: (group.items || []).filter((item) => item.id !== itemId) }
                : group
        ))));
    };

    const handleMoveFooterMenuItem = (groupId, itemId, direction) => {
        setFooterMenuGroups((prev) => withFooterMenuGroupOrder(prev.map((group) => {
            if (group.id !== groupId) return group;

            const items = [...(group.items || [])];
            const currentIndex = items.findIndex((item) => item.id === itemId);
            if (currentIndex === -1) return group;

            const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (nextIndex < 0 || nextIndex >= items.length) return group;

            const [picked] = items.splice(currentIndex, 1);
            items.splice(nextIndex, 0, picked);

            return { ...group, items };
        })));
    };

    const handleCopyRoute = async (route) => {
        const value = String(route || '').trim();
        if (!value) return;

        const markCopied = () => {
            setCopiedRoute(value);
            window.setTimeout(() => setCopiedRoute((prev) => (prev === value ? '' : prev)), 1500);
        };

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                markCopied();
                return;
            }
        } catch (error) {
            console.warn('Clipboard API not available', error);
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            markCopied();
        } catch (error) {
            console.error('Copy route failed', error);
            showModal({ title: 'Lỗi', content: 'Không thể copy route. Vui lòng thử lại.', type: 'error' });
        }
    };

    const uploadImage = async (file) => {
        const uploadData = new FormData();
        uploadData.append('image', file);
        const response = await mediaApi.upload(uploadData);
        if (!response.data?.success || !response.data?.url) {
            throw new Error('UPLOAD_FAILED');
        }
        return response.data.url;
    };

    const handleImageUpload = async (e, onSuccess) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        try {
            const url = await uploadImage(file);
            onSuccess(url);
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể tải ảnh lên.', type: 'error' });
        }
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (!activeAccountId) {
            showModal({ title: 'Lỗi', content: 'Vui lòng chọn account trước khi lưu.', type: 'error' });
            return;
        }

        setSaving(true);
        try {
            const normalizedHeaderMenus = normalizeHeaderMenus(headerMenus);
            const normalizedFooterMenuGroups = normalizeFooterMenuGroups(footerMenuGroups);
            const payloadSettings = {
                ...settings,
                header_menu_items: normalizedHeaderMenus,
                footer_menu_groups: normalizedFooterMenuGroups,
            };

            await cmsApi.settings.update({
                account_id: activeAccountId,
                settings: payloadSettings,
            });
            setHeaderMenus(normalizedHeaderMenus);
            setFooterMenuGroups(normalizedFooterMenuGroups);
            setSettings((prev) => ({
                ...prev,
                header_menu_items: normalizedHeaderMenus,
                footer_menu_groups: normalizedFooterMenuGroups,
            }));
            showModal({ title: 'Thành công', content: 'Đã lưu cấu hình.', type: 'success' });
        } catch (error) {
            console.error('Error saving settings', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu cấu hình.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleAddDomain = async () => {
        if (!newDomain.trim()) return;
        try {
            await cmsApi.domains.store({ domain: newDomain.trim(), is_default: domains.length === 0 });
            setNewDomain('');
            fetchDomains();
            showModal({ title: 'Thành công', content: 'Đã thêm tên miền.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: error.response?.data?.message || 'Không thể thêm tên miền.', type: 'error' });
        }
    };

    const handleToggleActive = async (domain) => {
        if (domain.is_default && domain.is_active) {
            showModal({ title: 'Cảnh báo', content: 'Không thể tắt tên miền mặc định.', type: 'error' });
            return;
        }
        try {
            await cmsApi.domains.update(domain.id, { ...domain, is_active: !domain.is_active });
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái tên miền.', type: 'error' });
        }
    };

    const handleSetDefault = async (domainId) => {
        try {
            await cmsApi.domains.update(domainId, { is_default: true });
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể đặt mặc định.', type: 'error' });
        }
    };

    const handleDeleteDomain = async (domainId) => {
        if (!window.confirm('Bạn có chắc muốn xóa tên miền này?')) return;
        try {
            await cmsApi.domains.destroy(domainId);
            fetchDomains();
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa tên miền.', type: 'error' });
        }
    };

    const handleCreateQuoteTemplate = async () => {
        if (!quoteTemplateDraft.name.trim()) {
            showModal({ title: 'Thiếu dữ liệu', content: 'Nhập tên bộ/mẫu trước khi thêm.', type: 'error' });
            return;
        }

        setSavingQuoteTemplateId('draft');
        try {
            await quoteTemplateApi.store({
                name: quoteTemplateDraft.name.trim(),
                image_url: quoteTemplateDraft.image_url || '',
                is_active: true,
                sort_order: quoteTemplates.length,
            });
            setQuoteTemplateDraft({ name: '', image_url: '' });
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã thêm bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể thêm bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    const updateQuoteTemplateState = (templateId, patch) => {
        setQuoteTemplates((prev) => prev.map((template) => (
            template.id === templateId ? { ...template, ...patch } : template
        )));
    };

    const handleSaveQuoteTemplate = async (template) => {
        if (!template.name?.trim()) {
            showModal({ title: 'Thiếu dữ liệu', content: 'Tên bộ/mẫu không được để trống.', type: 'error' });
            return;
        }

        setSavingQuoteTemplateId(template.id);
        try {
            await quoteTemplateApi.update(template.id, {
                name: template.name.trim(),
                image_url: template.image_url || '',
                sort_order: Number(template.sort_order) || 0,
                is_active: Boolean(template.is_active),
            });
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã lưu bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể lưu bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    const handleDeleteQuoteTemplate = async (templateId) => {
        if (!window.confirm('Bạn có chắc muốn xóa bộ/mẫu báo giá này?')) return;

        setSavingQuoteTemplateId(templateId);
        try {
            await quoteTemplateApi.destroy(templateId);
            fetchQuoteTemplates();
            showModal({ title: 'Thành công', content: 'Đã xóa bộ/mẫu báo giá.', type: 'success' });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể xóa bộ/mẫu báo giá.', type: 'error' });
        } finally {
            setSavingQuoteTemplateId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const tabs = [
        { id: 'contact', title: 'Liên hệ & Mạng xã hội', icon: 'contact_support' },
        { id: 'header', title: 'Cài đặt Header', icon: 'web' },
        { id: 'footer', title: 'Cài đặt Footer', icon: 'bottom_panel_open' },
        { id: 'pixel', title: 'Pixel & Tracking', icon: 'analytics' },
        { id: 'domains', title: 'Quản lý tên miền', icon: 'language' },
        { id: 'bank', title: 'Cài đặt STK', icon: 'account_balance' },
        { id: 'quote', title: 'Báo giá', icon: 'image' },
        { id: 'shipping', title: 'CÃ i Ä‘áº·t váº­n chuyá»ƒn', icon: 'local_shipping' },
    ];

    const settingsTabs = [
        { id: 'contact', title: 'Liên hệ & Mạng xã hội', icon: 'contact_support' },
        { id: 'header', title: 'Cài đặt Header', icon: 'web' },
        { id: 'footer', title: 'Cài đặt Footer', icon: 'bottom_panel_open' },
        { id: 'pixel', title: 'Pixel & Tracking', icon: 'analytics' },
        { id: 'domains', title: 'Quản lý tên miền', icon: 'language' },
        { id: 'bank', title: 'Cài đặt STK', icon: 'account_balance' },
        { id: 'quote', title: 'Báo giá', icon: 'image' },
    ];

    return (
        <div className="flex flex-col bg-[#fcfcfa] animate-fade-in p-6 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                `}
            </style>

            <div className="flex justify-between items-center mb-8">
                <div className="flex flex-col">
                    <h1 className="text-2xl font-black text-primary uppercase tracking-tight italic">Cài đặt web</h1>
                    <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] mt-1 italic font-sans">Quản lý liên hệ, thanh toán và mẫu báo giá</p>
                </div>

                {activeTab !== 'domains' && (
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="bg-primary text-white px-8 py-2.5 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {saving ? (
                            <div className="animate-spin size-4 border-2 border-white/20 border-t-white rounded-full"></div>
                        ) : (
                            <span className="material-symbols-outlined text-[18px]">save</span>
                        )}
                        Lưu thay đổi
                    </button>
                )}
            </div>

            <div className="flex gap-8 mb-6 border-b border-primary/10">
                {settingsTabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`pb-3 text-[13px] font-black uppercase tracking-widest transition-all relative flex items-center gap-2 ${activeTab === tab.id ? 'text-primary' : 'text-primary/40 hover:text-primary/70'}`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        {tab.title}
                        {activeTab === tab.id && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-12">
                <div className="max-w-5xl space-y-6">
                    {activeTab === 'contact' && (
                        <div className="space-y-6">
                            <SectionCard icon="person_pin" title="Kênh liên hệ chính">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên website / Thương hiệu</label>
                                        <input type="text" name="site_name" value={settings.site_name} onChange={handleChange} className={inputClasses} placeholder="Gốm Đại Thành" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Hotline hỗ trợ</label>
                                        <input type="text" name="contact_phone" value={settings.contact_phone} onChange={handleChange} className={inputClasses} placeholder="0123 456 789" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>Email liên hệ</label>
                                        <input type="email" name="contact_email" value={settings.contact_email} onChange={handleChange} className={inputClasses} placeholder="contact@domain.com" />
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard icon="share" title="Liên kết mạng xã hội">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Zalo URL</label>
                                        <input type="text" name="zalo_link" value={settings.zalo_link} onChange={handleChange} className={inputClasses} placeholder="https://zalo.me/0123456789" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Facebook page URL</label>
                                        <input type="text" name="facebook_link" value={settings.facebook_link} onChange={handleChange} className={inputClasses} placeholder="https://facebook.com/yourpage" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Messenger URL</label>
                                        <input type="text" name="messenger_link" value={settings.messenger_link} onChange={handleChange} className={inputClasses} placeholder="https://m.me/yourpage" />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>TikTok URL</label>
                                        <input type="text" name="tiktok_link" value={settings.tiktok_link} onChange={handleChange} className={inputClasses} placeholder="https://tiktok.com/@yourid" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>YouTube URL</label>
                                        <input type="text" name="youtube_link" value={settings.youtube_link} onChange={handleChange} className={inputClasses} placeholder="https://youtube.com/@yourchannel" />
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'header' && (
                        <div className="space-y-6">
                            <SectionCard icon="branding_watermark" title="Nội dung header">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên thương hiệu / Logo text</label>
                                        <input
                                            type="text"
                                            name="header_brand_text"
                                            value={settings.header_brand_text}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="Gốm Đại Thành"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Placeholder ô tìm kiếm</label>
                                        <input
                                            type="text"
                                            name="header_search_placeholder"
                                            value={settings.header_search_placeholder}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="Bạn cần tìm kiếm sản phẩm gì?"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className={labelClasses}>Text thanh thông báo trên cùng</label>
                                        <input
                                            type="text"
                                            name="header_notice_text"
                                            value={settings.header_notice_text}
                                            onChange={handleChange}
                                            className={inputClasses}
                                            placeholder="Miễn phí vận chuyển toàn quốc cho đơn hàng từ 500.000đ"
                                        />
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard icon="image" title="Logo header">
                                <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
                                    <div>
                                        <label className={labelClasses}>Ảnh logo</label>
                                        <ImageUploadCard
                                            imageUrl={settings.header_logo_url}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, header_logo_url: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, header_logo_url: '' }))}
                                            emptyLabel="Tải logo header"
                                            previewClassName="h-44"
                                        />
                                    </div>
                                    <div className="space-y-4">
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.02] p-4">
                                            <p className="text-[12px] font-bold text-primary">Logo ảnh sẽ ưu tiên hiển thị ở frontend.</p>
                                            <p className="mt-2 text-[12px] leading-5 text-primary/60">
                                                Nếu chưa tải logo, hệ thống sẽ tự fallback về logo mặc định hiện tại. Logo text vẫn được giữ cạnh ảnh để đồng bộ bố cục header.
                                            </p>
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Đường dẫn logo</label>
                                            <input
                                                type="text"
                                                name="header_logo_url"
                                                value={settings.header_logo_url}
                                                onChange={handleChange}
                                                className={inputClasses}
                                                placeholder="https://domain.com/logo-header.png"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon="menu"
                                title="Menu header"
                                rightSlot={
                                    <button
                                        type="button"
                                        onClick={handleAddHeaderMenu}
                                        className="h-9 px-4 rounded-sm bg-primary text-white text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all inline-flex items-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">add</span>
                                        Thêm menu
                                    </button>
                                }
                            >
                                <div className="space-y-3">
                                    {headerMenus.length === 0 ? (
                                        <div className="border border-primary/10 rounded-sm p-5 text-center text-[12px] text-primary/40 italic">
                                            Chưa có menu nào. Bấm "Thêm menu" để tạo mới.
                                        </div>
                                    ) : (
                                        headerMenus.map((menu, index) => (
                                            <div key={menu.id} className="grid grid-cols-[40px_120px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-center border border-primary/10 rounded-sm p-3">
                                                <div className="text-[11px] font-black text-primary/40 text-center">{index + 1}</div>

                                                <button
                                                    type="button"
                                                    onClick={() => updateHeaderMenu(menu.id, { enabled: !menu.enabled })}
                                                    className={`h-8 rounded-sm border text-[10px] font-black uppercase tracking-wider transition-all ${menu.enabled ? 'border-green-200 bg-green-50 text-green-700' : 'border-stone-200 bg-stone-50 text-stone-500'}`}
                                                >
                                                    {menu.enabled ? 'Bật' : 'Tắt'}
                                                </button>

                                                <input
                                                    type="text"
                                                    value={menu.label}
                                                    onChange={(e) => updateHeaderMenu(menu.id, { label: e.target.value })}
                                                    className={inputClasses}
                                                    placeholder="Tên menu"
                                                />

                                                <input
                                                    type="text"
                                                    value={menu.link}
                                                    onChange={(e) => updateHeaderMenu(menu.id, { link: e.target.value })}
                                                    className={inputClasses}
                                                    placeholder="/duong-dan-menu"
                                                />

                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMoveHeaderMenu(menu.id, 'up')}
                                                        className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]"
                                                        title="Di chuyển lên"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleMoveHeaderMenu(menu.id, 'down')}
                                                        className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]"
                                                        title="Di chuyển xuống"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveHeaderMenu(menu.id)}
                                                        className="size-8 rounded-sm border border-brick/30 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all"
                                                        title="Xóa menu"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon="route"
                                title="Danh sách route / trang"
                                rightSlot={<span className="text-[10px] font-black uppercase tracking-wider text-primary/40">Tự quét từ frontend/src/App.jsx</span>}
                            >
                                <div className="space-y-4">
                                    <p className="text-[12px] text-primary/60 leading-5">
                                        Bảng này chỉ để tham khảo và copy nhanh route khi cấu hình menu header. Không ảnh hưởng logic website.
                                    </p>
                                    <div className="overflow-x-auto border border-primary/10 rounded-sm">
                                        <table className="w-full text-left border-collapse min-w-[880px]">
                                            <thead>
                                                <tr className="bg-primary/[0.03] border-b border-primary/10">
                                                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-primary/60">Tên trang</th>
                                                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-primary/60">Đường dẫn route</th>
                                                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-wider text-primary/60">Ghi chú</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-primary/5">
                                                {HEADER_ROUTE_REFERENCE_ROWS.map((item) => (
                                                    <tr key={`${item.route}-${item.page}`} className="hover:bg-primary/[0.015] transition-colors">
                                                        <td className="px-4 py-3 align-top">
                                                            <div className="space-y-1">
                                                                <p className="text-[13px] font-bold text-primary leading-tight">{item.page}</p>
                                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${item.scope === 'Public'
                                                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                                                    : item.scope === 'Legacy'
                                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                                        : item.scope === 'Admin'
                                                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                                            : 'bg-brick/10 text-brick border border-brick/30'
                                                                    }`}>
                                                                    {item.scope}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 align-top">
                                                            <div className="inline-flex items-center gap-2 rounded-sm border border-primary/15 bg-white px-2 py-1">
                                                                <code className="text-[12px] font-bold text-primary whitespace-nowrap">{item.route}</code>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopyRoute(item.route)}
                                                                    className={`size-7 rounded-sm border inline-flex items-center justify-center transition-all ${copiedRoute === item.route
                                                                        ? 'border-green-300 bg-green-50 text-green-700'
                                                                        : 'border-primary/20 text-primary hover:bg-primary/[0.04]'
                                                                        }`}
                                                                    title={`Copy route ${item.route}`}
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">
                                                                        {copiedRoute === item.route ? 'check' : 'content_copy'}
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 align-top">
                                                            <p className={`text-[12px] leading-5 ${item.exists ? 'text-primary/60' : 'text-brick font-bold'}`}>
                                                                {item.note}
                                                            </p>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[11px] text-primary/40 italic">
                                        Tổng cộng {HEADER_ROUTE_REFERENCE_ROWS.length} route đã tổng hợp. Route có nhãn Placeholder là chưa tạo trong router hiện tại.
                                    </p>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'footer' && (
                        <div className="space-y-6">
                            <SectionCard icon="view_agenda" title="Nội dung footer">
                                <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
                                    <div>
                                        <label className={labelClasses}>Logo footer</label>
                                        <ImageUploadCard
                                            imageUrl={settings.footer_logo_url}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, footer_logo_url: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, footer_logo_url: '' }))}
                                            emptyLabel="Tải logo footer"
                                            previewClassName="h-48"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="col-span-2">
                                            <label className={labelClasses}>Đường dẫn logo footer</label>
                                            <input
                                                type="text"
                                                name="footer_logo_url"
                                                value={settings.footer_logo_url}
                                                onChange={handleChange}
                                                className={inputClasses}
                                                placeholder="https://domain.com/logo-footer.png"
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Tên thương hiệu / logo text</label>
                                            <input type="text" name="footer_brand_text" value={settings.footer_brand_text} onChange={handleChange} className={inputClasses} placeholder="Gốm Đại Thành" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Hotline footer</label>
                                            <input type="text" name="footer_hotline" value={settings.footer_hotline} onChange={handleChange} className={inputClasses} placeholder="0123 456 789" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Email footer</label>
                                            <input type="email" name="footer_email" value={settings.footer_email} onChange={handleChange} className={inputClasses} placeholder="contact@domain.com" />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Placeholder nhận tin</label>
                                            <input type="text" name="footer_newsletter_placeholder" value={settings.footer_newsletter_placeholder} onChange={handleChange} className={inputClasses} placeholder="Email của bạn" />
                                        </div>
                                        <div className="col-span-2">
                                            <label className={labelClasses}>Mô tả ngắn footer</label>
                                            <textarea name="footer_description" value={settings.footer_description} onChange={handleChange} className={textareaClasses} placeholder="Giới thiệu ngắn hiển thị ở cột thương hiệu footer..." />
                                        </div>
                                        <div className="col-span-2">
                                            <label className={labelClasses}>Địa chỉ</label>
                                            <textarea name="footer_address" value={settings.footer_address} onChange={handleChange} className={textareaClasses} placeholder="Bát Tràng, Gia Lâm, Hà Nội" />
                                        </div>
                                        <div className="col-span-2">
                                            <label className={labelClasses}>Copyright text</label>
                                            <input type="text" name="footer_copyright_text" value={settings.footer_copyright_text} onChange={handleChange} className={inputClasses} placeholder="© 2026 Gốm Đại Thành. Bảo lưu mọi quyền." />
                                        </div>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon="table_rows"
                                title="Nhóm menu footer"
                                rightSlot={(
                                    <button
                                        type="button"
                                        onClick={handleAddFooterMenuGroup}
                                        className="h-9 px-4 rounded-sm bg-primary text-white text-[11px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all inline-flex items-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">add</span>
                                        Thêm nhóm
                                    </button>
                                )}
                            >
                                <div className="space-y-4">
                                    {footerMenuGroups.map((group, groupIndex) => (
                                        <div key={group.id} className="rounded-sm border border-primary/10 overflow-hidden">
                                            <div className="flex items-center gap-3 bg-primary/[0.02] border-b border-primary/10 px-4 py-3">
                                                <div className="text-[11px] font-black text-primary/40">{groupIndex + 1}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => updateFooterMenuGroup(group.id, { enabled: !group.enabled })}
                                                    className={`h-8 px-3 rounded-sm border text-[10px] font-black uppercase tracking-wider transition-all ${group.enabled ? 'border-green-200 bg-green-50 text-green-700' : 'border-stone-200 bg-stone-50 text-stone-500'}`}
                                                >
                                                    {group.enabled ? 'Bật' : 'Tắt'}
                                                </button>
                                                <input
                                                    type="text"
                                                    value={group.title}
                                                    onChange={(e) => updateFooterMenuGroup(group.id, { title: e.target.value })}
                                                    className={inputClasses}
                                                    placeholder="Tên nhóm footer"
                                                />
                                                <div className="flex items-center gap-1">
                                                    <button type="button" onClick={() => handleMoveFooterMenuGroup(group.id, 'up')} className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]">
                                                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                                                    </button>
                                                    <button type="button" onClick={() => handleMoveFooterMenuGroup(group.id, 'down')} className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]">
                                                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                                                    </button>
                                                    <button type="button" onClick={() => handleRemoveFooterMenuGroup(group.id)} className="size-8 rounded-sm border border-brick/30 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all">
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="p-4 space-y-3">
                                                {(group.items || []).length === 0 ? (
                                                    <div className="border border-dashed border-primary/15 rounded-sm p-4 text-[12px] text-primary/40 italic">
                                                        Nhóm này chưa có liên kết nào.
                                                    </div>
                                                ) : (
                                                    group.items.map((item, itemIndex) => (
                                                        <div key={item.id} className="grid grid-cols-[40px_100px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-center border border-primary/10 rounded-sm p-3">
                                                            <div className="text-[11px] font-black text-primary/40 text-center">{itemIndex + 1}</div>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateFooterMenuItem(group.id, item.id, { enabled: !item.enabled })}
                                                                className={`h-8 rounded-sm border text-[10px] font-black uppercase tracking-wider transition-all ${item.enabled ? 'border-green-200 bg-green-50 text-green-700' : 'border-stone-200 bg-stone-50 text-stone-500'}`}
                                                            >
                                                                {item.enabled ? 'Bật' : 'Tắt'}
                                                            </button>
                                                            <input
                                                                type="text"
                                                                value={item.label}
                                                                onChange={(e) => updateFooterMenuItem(group.id, item.id, { label: e.target.value })}
                                                                className={inputClasses}
                                                                placeholder="Tên liên kết"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={item.link}
                                                                onChange={(e) => updateFooterMenuItem(group.id, item.id, { link: e.target.value })}
                                                                className={inputClasses}
                                                                placeholder="/duong-dan"
                                                            />
                                                            <div className="flex items-center gap-1">
                                                                <button type="button" onClick={() => handleMoveFooterMenuItem(group.id, item.id, 'up')} className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]">
                                                                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                                                                </button>
                                                                <button type="button" onClick={() => handleMoveFooterMenuItem(group.id, item.id, 'down')} className="size-8 rounded-sm border border-primary/20 text-primary inline-flex items-center justify-center hover:bg-primary/[0.04]">
                                                                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                                                                </button>
                                                                <button type="button" onClick={() => handleRemoveFooterMenuItem(group.id, item.id)} className="size-8 rounded-sm border border-brick/30 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all">
                                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={() => handleAddFooterMenuItem(group.id)}
                                                    className="h-9 px-4 rounded-sm border border-primary/20 text-primary text-[11px] font-black uppercase tracking-wider hover:bg-primary/[0.04] transition-all inline-flex items-center gap-1"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                                    Thêm liên kết
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'pixel' && (
                        <div className="space-y-6">
                            {[
                                { key: 'fb', icon: 'ads_click', title: 'Facebook Pixel', idName: 'fb_pixel_id', activeName: 'fb_pixel_active', placeholder: 'VD: 123456789012345' },
                                { key: 'ga', icon: 'analytics', title: 'Google Analytics', idName: 'ga_id', activeName: 'ga_active', placeholder: 'VD: G-ABCDEFG123' },
                                { key: 'tt', icon: 'music_note', title: 'TikTok Pixel', idName: 'tt_pixel_id', activeName: 'tt_pixel_active', placeholder: 'VD: C1234567890ABCDE' },
                            ].map((item) => (
                                <SectionCard
                                    key={item.key}
                                    icon={item.icon}
                                    title={item.title}
                                    rightSlot={(
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] font-black uppercase ${settings[item.activeName] ? 'text-green-500' : 'text-primary/30'}`}>
                                                {settings[item.activeName] ? 'Đang bật' : 'Đang tắt'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setSettings((prev) => ({ ...prev, [item.activeName]: !prev[item.activeName] }))}
                                                className={`relative inline-flex h-5 w-10 rounded-full transition-colors ${settings[item.activeName] ? 'bg-green-500' : 'bg-stone-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 mt-0.5 ${settings[item.activeName] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                            </button>
                                        </div>
                                    )}
                                >
                                    <label className={labelClasses}>{item.title} ID</label>
                                    <input type="text" name={item.idName} value={settings[item.idName]} onChange={handleChange} className={inputClasses} placeholder={item.placeholder} />
                                </SectionCard>
                            ))}
                        </div>
                    )}

                    {activeTab === 'domains' && (
                        <div className="space-y-6">
                            <SectionCard icon="language" title="Thêm tên miền mới">
                                <div className="flex gap-4">
                                    <input
                                        type="text"
                                        value={newDomain}
                                        onChange={(e) => setNewDomain(e.target.value)}
                                        className={inputClasses}
                                        placeholder="VD: gomdaithanh.vn hoặc shop.gomdaithanh.com"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleAddDomain();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddDomain}
                                        className="bg-primary text-white px-6 rounded-sm font-bold text-[13px] hover:bg-primary/90 transition-colors flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                        Thêm
                                    </button>
                                </div>
                            </SectionCard>

                            <SectionCard icon="list" title="Danh sách tên miền">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-primary/[0.01] border-b border-primary/5">
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider">Tên miền</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-center">Trạng thái</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-center">Mặc định</th>
                                                <th className="px-6 py-4 text-[11px] font-black uppercase text-primary/40 tracking-wider text-right">Thao tác</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-primary/5">
                                            {domains.length === 0 ? (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center text-primary/30 text-[13px] italic">Chưa có tên miền nào được cấu hình.</td>
                                                </tr>
                                            ) : domains.map((domain) => (
                                                <tr key={domain.id} className="hover:bg-primary/[0.01] transition-colors">
                                                    <td className="px-6 py-4 text-[13px] font-bold text-primary">{domain.domain}</td>
                                                    <td className="px-6 py-4 text-center">
                                                        <div className="flex justify-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleActive(domain)}
                                                                className={`relative inline-flex h-5 w-10 rounded-full transition-colors ${domain.is_active ? 'bg-green-500' : 'bg-stone-300'}`}
                                                            >
                                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 mt-0.5 ${domain.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        {domain.is_default ? (
                                                            <span className="material-symbols-outlined text-gold text-[20px]">verified</span>
                                                        ) : (
                                                            <button type="button" onClick={() => handleSetDefault(domain.id)} className="text-[10px] font-black uppercase text-primary/30 hover:text-gold transition-colors underline underline-offset-4">
                                                                Đặt mặc định
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteDomain(domain.id)}
                                                            className="size-8 rounded-sm border border-brick/20 text-brick inline-flex items-center justify-center hover:bg-brick hover:text-white transition-all shadow-sm"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'bank' && (
                        <SectionCard icon="account_balance" title="Thông tin tài khoản nhận tiền">
                            <div className="space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClasses}>Tên ngân hàng</label>
                                        <input type="text" name="bank_name" value={settings.bank_name} onChange={handleChange} className={inputClasses} placeholder="Vietcombank, Techcombank..." />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Số tài khoản</label>
                                        <input type="text" name="bank_account_number" value={settings.bank_account_number} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Tên chủ tài khoản</label>
                                        <input type="text" name="bank_account_name" value={settings.bank_account_name} onChange={handleChange} className={inputClasses} />
                                    </div>
                                    <div>
                                        <label className={labelClasses}>Nội dung chuyển khoản mặc định</label>
                                        <input type="text" name="bank_transfer_template" value={settings.bank_transfer_template} onChange={handleChange} className={inputClasses} />
                                        <p className="text-[10px] text-primary/40 mt-1 italic font-medium">Biến tự động: {'{order_number}'}</p>
                                    </div>
                                </div>

                                <div className="border-t border-primary/5 pt-6">
                                    <label className={labelClasses}>Mã QR chuyển khoản</label>
                                    <div className="max-w-md">
                                        <ImageUploadCard
                                            imageUrl={settings.bank_qr_code}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, bank_qr_code: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, bank_qr_code: '' }))}
                                            emptyLabel="Tải ảnh QR ngân hàng"
                                            previewClassName="h-52"
                                        />
                                    </div>
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {activeTab === 'quote' && (
                        <div className="space-y-6">
                            <SectionCard icon="badge" title="Thông tin đầu trang báo giá">
                                <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6">
                                    <div>
                                        <label className={labelClasses}>Logo báo giá</label>
                                        <ImageUploadCard
                                            imageUrl={settings.quote_logo_url}
                                            onUpload={(e) => handleImageUpload(e, (url) => setSettings((prev) => ({ ...prev, quote_logo_url: url })))}
                                            onRemove={() => setSettings((prev) => ({ ...prev, quote_logo_url: '' }))}
                                            emptyLabel="Tải logo dùng chung"
                                            previewClassName="h-56"
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className={labelClasses}>Tên xưởng / cửa hàng</label>
                                            <input type="text" name="quote_store_name" value={settings.quote_store_name} onChange={handleChange} className={inputClasses} placeholder="Xưởng sản xuất gốm sứ..." />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Địa chỉ</label>
                                            <textarea name="quote_store_address" value={settings.quote_store_address} onChange={handleChange} className={textareaClasses} placeholder="Nhập địa chỉ hiển thị trên ảnh báo giá..." />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Số điện thoại</label>
                                            <input type="text" name="quote_store_phone" value={settings.quote_store_phone} onChange={handleChange} className={inputClasses} placeholder="0866..." />
                                        </div>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                icon="collections"
                                title="Ảnh đại diện theo bộ / mẫu"
                                rightSlot={<span className="text-[11px] font-bold text-primary/40">Dùng khi chụp ảnh báo giá từ đơn hàng</span>}
                            >
                                <div className="space-y-4">
                                    <div className="grid grid-cols-[minmax(0,1fr)_260px_auto] gap-4 items-end border border-dashed border-primary/20 rounded-sm p-4 bg-primary/[0.02]">
                                        <div>
                                            <label className={labelClasses}>Tên bộ / mẫu mới</label>
                                            <input
                                                type="text"
                                                value={quoteTemplateDraft.name}
                                                onChange={(e) => setQuoteTemplateDraft((prev) => ({ ...prev, name: e.target.value }))}
                                                className={inputClasses}
                                                placeholder="VD: Men rạn, Men lam, Vẽ vàng..."
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Ảnh đại diện</label>
                                            <div className="flex gap-2">
                                                <label className="h-10 px-4 rounded-sm border border-primary/20 bg-white text-primary text-[12px] font-black uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer hover:bg-primary/[0.02]">
                                                    <span className="material-symbols-outlined text-[18px]">upload</span>
                                                    Tải ảnh
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => handleImageUpload(e, (url) => setQuoteTemplateDraft((prev) => ({ ...prev, image_url: url })))}
                                                    />
                                                </label>
                                                {quoteTemplateDraft.image_url && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setQuoteTemplateDraft((prev) => ({ ...prev, image_url: '' }))}
                                                        className="h-10 px-4 rounded-sm border border-brick/20 bg-white text-brick text-[12px] font-black uppercase tracking-wider"
                                                    >
                                                        Xóa ảnh
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleCreateQuoteTemplate}
                                            disabled={savingQuoteTemplateId === 'draft'}
                                            className="h-10 px-5 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50"
                                        >
                                            {savingQuoteTemplateId === 'draft' ? 'Đang lưu...' : 'Thêm mẫu'}
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {quoteTemplates.length === 0 ? (
                                            <div className="border border-primary/10 rounded-sm px-4 py-10 text-center text-[13px] text-primary/35 italic">
                                                Chưa có bộ / mẫu báo giá nào.
                                            </div>
                                        ) : quoteTemplates.map((template) => (
                                            <div key={template.id} className="grid grid-cols-[240px_minmax(0,1fr)] gap-5 border border-primary/10 rounded-sm p-4">
                                                <ImageUploadCard
                                                    imageUrl={template.image_url}
                                                    onUpload={(e) => handleImageUpload(e, (url) => updateQuoteTemplateState(template.id, { image_url: url }))}
                                                    onRemove={() => updateQuoteTemplateState(template.id, { image_url: '' })}
                                                    emptyLabel="Tải ảnh đại diện bộ / mẫu"
                                                    previewClassName="h-44"
                                                />

                                                <div className="space-y-4">
                                                    <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-4">
                                                        <div>
                                                            <label className={labelClasses}>Tên bộ / mẫu</label>
                                                            <input
                                                                type="text"
                                                                value={template.name || ''}
                                                                onChange={(e) => updateQuoteTemplateState(template.id, { name: e.target.value })}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelClasses}>Thứ tự</label>
                                                            <input
                                                                type="number"
                                                                value={template.sort_order ?? 0}
                                                                onChange={(e) => updateQuoteTemplateState(template.id, { sort_order: e.target.value })}
                                                                className={inputClasses}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={labelClasses}>Trạng thái</label>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateQuoteTemplateState(template.id, { is_active: !template.is_active })}
                                                                className={`w-full h-10 rounded-sm border text-[12px] font-black uppercase tracking-wider transition-all ${template.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-stone-50 text-primary/40'}`}
                                                            >
                                                                {template.is_active ? 'Đang dùng' : 'Tạm tắt'}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-[12px] text-primary/45 leading-5">
                                                            Ảnh này sẽ được dùng làm ảnh đại diện bên trái trong ảnh báo giá khi chọn đúng bộ / mẫu ở màn hình đơn hàng.
                                                        </p>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteQuoteTemplate(template.id)}
                                                                disabled={savingQuoteTemplateId === template.id}
                                                                className="h-10 px-4 rounded-sm border border-brick/20 bg-white text-brick text-[12px] font-black uppercase tracking-wider hover:bg-brick hover:text-white transition-all disabled:opacity-50"
                                                            >
                                                                Xóa
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveQuoteTemplate(template)}
                                                                disabled={savingQuoteTemplateId === template.id}
                                                                className="h-10 px-4 rounded-sm bg-primary text-white text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
                                                            >
                                                                {savingQuoteTemplateId === template.id ? 'Đang lưu...' : 'Lưu mẫu'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </SectionCard>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default SiteSettings;
