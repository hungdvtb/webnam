import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { orderApi, attributeApi, orderStatusApi, default as api } from '../../services/api';
import { useNavigate, Link } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';

const DEFAULT_COLUMNS = [
    { id: 'order_number', label: 'Mã Đơn', minWidth: '140px', fixed: true },
    { id: 'customer', label: 'Khách Hàng', minWidth: '180px' },
    { id: 'province', label: 'Thành phố', minWidth: '130px' },
    { id: 'ward', label: 'Phường', minWidth: '130px' },
    { id: 'shipping_address', label: 'Địa Chỉ', minWidth: '220px' },
    { id: 'items', label: 'Sản Phẩm', minWidth: '250px' },
    { id: 'total_price', label: 'Tổng Tiền', minWidth: '130px' },
    { id: 'created_at', label: 'Ngày Đặt', minWidth: '120px' },
    { id: 'notes', label: 'Ghi Chú Đơn', minWidth: '180px' },
    { id: 'status', label: 'Trạng Thái', minWidth: '120px', align: 'left' },
    { id: 'actions', label: 'Thao Tác', minWidth: '100px', align: 'right', fixed: true },
];

/**
 * Hover card that shows full product list for an order.
 * Stays open while mouse moves between trigger and card.
 * Uses Portal for unconstrained positioning and smart repositioning.
 */
const OrderProductsPortal = ({
    items,
    copiedText,
    onCopy,
    anchorRef,
    visible,
    onClose
}) => {
    const [position, setPosition] = useState(null);
    const portalRef = useRef(null);

    const updatePosition = useCallback(() => {
        if (!anchorRef.current) return;

        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const cardWidth = 600;

        // Start below the main header area (approx 120px from top)
        let top = 120;
        let left = viewportWidth / 2 - cardWidth / 2;

        // Ensure it doesn't overflow bottom
        const maxHeight = viewportHeight - 160;

        setPosition({ top, left, width: cardWidth, maxHeight });
    }, [items.length]);

    useEffect(() => {
        if (visible) {
            updatePosition();
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true);
            return () => {
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('scroll', updatePosition, true);
            };
        }
    }, [visible, updatePosition]);

    if (!visible || !items?.length) return null;

    return createPortal(
        <div className="fixed inset-0 z-[99998] flex items-start justify-start pointer-events-none">
            {/* Backdrop for focus */}
            <div
                className="absolute inset-0 bg-primary/5 backdrop-blur-[2px] pointer-events-auto animate-in fade-in duration-300"
                onClick={onClose}
            />

            <div
                ref={portalRef}
                style={{
                    position: 'fixed',
                    top: position?.top || 120,
                    left: position?.left || 0,
                    width: position?.width || 600,
                    maxHeight: position?.maxHeight || '75vh',
                    zIndex: 99999,
                    visibility: position ? 'visible' : 'hidden'
                }}
                className="bg-white border border-primary/20 shadow-[0_25px_70px_-15px_rgba(27,54,93,0.4)] rounded-sm flex flex-col pointer-events-auto animate-in fade-in zoom-in-95 slide-in-from-top-8 duration-500 origin-top"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-primary/10 flex items-center justify-between bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-sm bg-primary/5 flex items-center justify-center border border-primary/10">
                            <span className="material-symbols-outlined text-primary text-[24px]">shopping_cart_checkout</span>
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-primary/40 uppercase tracking-[0.2em] leading-tight mb-0.5">Danh sách đầy đủ</p>
                            <h3 className="text-[16px] font-extrabold text-primary tracking-tight">Chi tiết {items.length} sản phẩm</h3>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-brick/10 hover:text-brick text-primary/30 transition-all flex items-center justify-center">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Sub-header columns */}
                <div className="px-6 py-2.5 bg-primary/5 flex items-center gap-4 border-b border-primary/10">
                    <div className="w-12 text-center text-[10px] font-black text-primary/40 uppercase tracking-widest">SL</div>
                    <div className="flex-1 text-[10px] font-black text-primary/40 uppercase tracking-widest text-left">Thông tin sản phẩm</div>
                    <div className="w-32 text-right text-[10px] font-black text-primary/40 uppercase tracking-widest px-4">Đơn giá</div>
                </div>

                {/* Items List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1 bg-[#FCFDFF]">
                    {items.map((item, idx) => {
                        const name = item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`;
                        const sku = item.product?.sku || item.product_sku_snapshot || null;
                        const price = item.price ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price) : null;

                        return (
                            <div key={idx} className="flex items-center gap-4 px-4 py-3 rounded-sm hover:bg-primary/5 border border-transparent hover:border-primary/10 transition-all group/item">
                                <div className="w-12 shrink-0 flex justify-center">
                                    <div className="text-[13px] font-black text-orange-600 bg-orange-50 w-10 h-10 flex items-center justify-center rounded-sm border border-orange-200 shadow-sm">
                                        {item.quantity}x
                                    </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 group/name_p">
                                        <span className="text-[14px] font-bold text-primary truncate block" title={name}>{name}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onCopy(name, e); }}
                                            className={`p-1 rounded-sm hover:bg-primary/10 opacity-0 group-hover/name_p:opacity-100 transition-all ${copiedText === name ? 'text-green-500 opacity-100' : 'text-primary/30'}`}
                                            title="Sao chép tên"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">{copiedText === name ? 'check_circle' : 'content_copy'}</span>
                                        </button>
                                    </div>
                                    {sku && (
                                        <div className="flex items-center gap-2 group/sku_p mt-0.5">
                                            <span className="text-[12px] font-mono font-black text-orange-600/70 tracking-tight">#{sku}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onCopy(sku, e); }}
                                                className={`p-0.5 rounded-sm hover:bg-primary/10 opacity-0 group-hover/sku_p:opacity-100 transition-all ${copiedText === sku ? 'text-green-500 opacity-100' : 'text-primary/30'}`}
                                                title="Sao chép mã"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">{copiedText === sku ? 'check_circle' : 'content_copy'}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="w-32 shrink-0 text-right px-4">
                                    {price ? (
                                        <span className="text-[15px] text-brick font-black tracking-tighter">{price}</span>
                                    ) : (
                                        <span className="text-[12px] text-primary/30 italic">Liên hệ</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-primary/10 bg-primary/5 flex justify-between items-center rounded-b-sm">
                    <span className="text-[10px] text-primary/40 font-black uppercase tracking-[0.1em]">Nhấn ESC hoặc Click vùng xám để đóng</span>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-primary/40 font-black uppercase">Tổng sản phẩm:</span>
                        <span className="text-[13px] text-primary font-black px-2 py-0.5 bg-white border border-primary/20 rounded-sm">{items.length}</span>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const StatusDropdownPortal = ({ order, orderStatuses, onUpdate, anchorRef, visible, onClose, statusMenuRef }) => {
    const [position, setPosition] = useState(null);
    useEffect(() => {
        if (visible && anchorRef.current) {
            const updatePosition = () => {
                const rect = anchorRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const dropdownWidth = 260;
                const estimatedHeight = Math.min(orderStatuses.length * 48 + 50, viewportHeight * 0.6);
                let top = rect.bottom + 6;
                let left = rect.left + (rect.width / 2) - (dropdownWidth / 2);
                let placement = 'bottom';
                if (viewportHeight - rect.bottom < (estimatedHeight + 10) && rect.top > viewportHeight - rect.bottom) { top = rect.top - 6; placement = 'top'; }
                left = Math.max(10, Math.min(left, window.innerWidth - dropdownWidth - 20));
                setPosition({ top, left, placement });
            };
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
            return () => { window.removeEventListener('scroll', updatePosition, true); window.removeEventListener('resize', updatePosition); };
        }
    }, [visible, anchorRef, orderStatuses]);

    if (!visible) return null;

    return createPortal(
        <div ref={statusMenuRef} style={{ position: 'fixed', top: position?.top || 0, left: position?.left || 0, transform: position?.placement === 'top' ? 'translateY(-100%)' : 'none', zIndex: 999999, width: 260, opacity: position ? 1 : 0 }} className={`bg-white border border-primary/10 shadow-22xl rounded-sm py-2 overflow-hidden ${position?.placement === 'top' ? 'origin-bottom' : 'origin-top'}`} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-2.5 border-b border-primary/5 mb-1 flex items-center gap-2.5 opacity-40"><span className="material-symbols-outlined text-[16px]">swap_vert</span><p className="text-[10px] font-black uppercase tracking-[0.2em]">Cập nhật trạng thái</p></div>
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                {orderStatuses.map(s => (
                    <button key={s.id} onClick={() => { onUpdate(order.id, s.code); onClose(); }} className={`w-full flex items-center justify-between px-5 py-3.5 text-sm transition-all hover:bg-primary/5 relative ${order.status === s.code ? 'bg-primary/5 text-primary font-bold' : 'text-primary'}`}>
                        <div className="flex items-center gap-4"><div className="w-4 h-4 rounded-full border-2 border-white ring-1 ring-primary/10" style={{ backgroundColor: s.color }}></div><span className="truncate text-[14px] font-bold">{s.name}</span></div>
                        {order.status === s.code && <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-primary font-bold">check</span></div>}
                    </button>
                ))}
            </div>
        </div>,
        document.body
    );
};

const OrderList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [orders, setOrders] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [productAttributes, setProductAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [isTrashView, setIsTrashView] = useState(false);
    const [copiedText, setCopiedText] = useState(null);
    const [statusMenuOrderId, setStatusMenuOrderId] = useState(null);
    const [productPopupOrderId, setProductPopupOrderId] = useState(null);
    const productPopupAnchorRef = useRef(null);
    const statusMenuAnchorRef = useRef(null);
    const statusMenuRef = useRef(null);

    const [notification, setNotification] = useState(null);
    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('order_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const [openAttrId, setOpenAttrId] = useState(null);
    const searchContainerRef = useRef(null);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({
        search: '',
        status: [],
        customer_name: '',
        order_number: '',
        created_at_from: '',
        created_at_to: '',
        customer_phone: '',
        shipping_address: '',
        attributes: {}
    });

    const [sortConfig, setSortConfig] = useState(() => {
        const saved = localStorage.getItem('order_list_sort');
        return saved ? JSON.parse(saved) : { key: 'created_at', direction: 'desc', phase: 1 };
    });

    const {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
        setVisibleColumns
    } = useTableColumns('order_list', DEFAULT_COLUMNS);

    const fetchInitialData = async () => {
        try {
            const [statusRes, orderAttrRes, prodAttrRes] = await Promise.all([
                orderStatusApi.getAll(),
                attributeApi.getAll({ entity_type: 'order', active_only: true }),
                attributeApi.getAll({ entity_type: 'product', active_only: true })
            ]);
            setOrderStatuses(statusRes.data || []);
            setAllAttributes(orderAttrRes.data || []);
            setProductAttributes(prodAttrRes.data || []);

            const attrColumns = (orderAttrRes.data || []).map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '150px',
                isAttribute: true,
                attrId: attr.id
            }));

            const combinedColumns = [...DEFAULT_COLUMNS.slice(0, -1), ...attrColumns, DEFAULT_COLUMNS[DEFAULT_COLUMNS.length - 1]];

            const savedOrder = localStorage.getItem('order_list_column_order');
            let sortedColumns = [...combinedColumns];
            if (savedOrder) {
                const orderIds = JSON.parse(savedOrder);
                sortedColumns = [...combinedColumns].sort((a, b) => {
                    const idxA = orderIds.indexOf(a.id);
                    const idxB = orderIds.indexOf(b.id);
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }
            setAvailableColumns(sortedColumns);

            const savedVisible = localStorage.getItem('order_list_columns');
            if (savedVisible) setVisibleColumns(JSON.parse(savedVisible));
            else setVisibleColumns(sortedColumns.map(c => c.id));

            const currentSearch = localStorage.getItem('order_list_search_current');
            if (currentSearch) setFilters(prev => ({ ...prev, search: currentSearch }));
        } catch (error) { console.error("Error initial data", error); }
    };

    const addToSearchHistory = (term) => {
        if (!term?.trim() || term.length < 2) return;
        setSearchHistory(prev => {
            const updated = [term, ...prev.filter(h => h !== term)].slice(0, 10);
            localStorage.setItem('order_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    const fetchOrders = useCallback(async (page = 1, currentFilters = filters, perPage = pagination.per_page, currentSort = sortConfig) => {
        setLoading(true);
        try {
            const params = {
                page, per_page: perPage, trashed: isTrashView ? 1 : 0,
                sort_by: currentSort.direction === 'none' ? 'created_at' : currentSort.key,
                sort_order: currentSort.direction === 'none' ? 'desc' : currentSort.direction
            };

            if (currentFilters.search?.trim()) params.search = currentFilters.search.trim();
            if (currentFilters.status?.length) params.status = currentFilters.status.join(',');
            if (currentFilters.customer_name?.trim()) params.customer_name = currentFilters.customer_name.trim();
            if (currentFilters.order_number) params.order_number = currentFilters.order_number;
            if (currentFilters.customer_phone) params.customer_phone = currentFilters.customer_phone;
            if (currentFilters.shipping_address) params.shipping_address = currentFilters.shipping_address;
            if (currentFilters.created_at_from) params.created_at_from = currentFilters.created_at_from;
            if (currentFilters.created_at_to) params.created_at_to = currentFilters.created_at_to;

            if (currentFilters.attributes) {
                Object.entries(currentFilters.attributes).forEach(([id, val]) => {
                    if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
                        params[`attr_order_${id}`] = Array.isArray(val) ? val.join(',') : val;
                    }
                });
            }

            const response = await orderApi.getAll(params);
            setOrders(response.data.data);
            setPagination({ current_page: response.data.current_page, last_page: response.data.last_page, total: response.data.total, per_page: response.data.per_page });
        } catch (error) {
            console.error("Error fetching orders", error);
            setNotification({ type: 'error', message: 'Không thể tải danh sách đơn hàng' });
        } finally { setLoading(false); }
    }, [isTrashView, pagination.per_page, sortConfig, filters]);

    useEffect(() => { fetchInitialData(); }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (filters.search !== localStorage.getItem('order_list_search_current')) {
                if (filters.search) {
                    localStorage.setItem('order_list_search_current', filters.search);
                    fetchOrders(1);
                    addToSearchHistory(filters.search);
                } else if (localStorage.getItem('order_list_search_current')) {
                    localStorage.removeItem('order_list_search_current');
                    fetchOrders(1);
                }
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [filters.search]);

    useEffect(() => { fetchOrders(1); }, [isTrashView]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (filterRef.current && !filterRef.current.contains(e.target) && !e.target.closest('[data-filter-btn]')) setShowFilters(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target) && !e.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target) && !e.target.closest('[data-status-edit-btn]')) setStatusMenuOrderId(null);
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) setShowSearchHistory(false);
            if (!e.target.closest('[data-attr-dropdown]')) setOpenAttrId(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleTempFilterChange = (e) => {
        const { name, value } = e.target;
        setTempFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleTempAttributeFilterChange = (attrId, value) => {
        setTempFilters(prev => {
            const current = (prev.attributes?.[attrId] || []);
            const currentArray = Array.isArray(current) ? current : (current ? [current] : []);
            const updated = currentArray.includes(value) ? currentArray.filter(v => v !== value) : [...currentArray, value];
            return { ...prev, attributes: { ...prev.attributes, [attrId]: updated } };
        });
    };

    const applyFilters = () => {
        setFilters(tempFilters);
        setShowFilters(false);
        fetchOrders(1, tempFilters);
    };

    const removeFilter = (key, value = null) => {
        setFilters(prev => {
            let nf = { ...prev };
            if (key === 'attributes') { nf.attributes = { ...prev.attributes }; delete nf.attributes[value.attrId]; }
            else if (key === 'status') { nf.status = []; }
            else if (key === 'date') { nf.created_at_from = ''; nf.created_at_to = ''; }
            else { nf[key] = ''; }
            fetchOrders(1, nf);
            return nf;
        });
    };

    const handleReset = () => {
        const rf = { search: '', status: [], customer_name: '', order_number: '', created_at_from: '', created_at_to: '', customer_phone: '', shipping_address: '', attributes: {} };
        setFilters(rf);
        setSortConfig({ key: 'created_at', direction: 'desc', phase: 1 });
        fetchOrders(1, rf);
    };

    const handleRefresh = () => fetchOrders(1);

    const handleSort = (colId) => {
        let key = colId === 'customer' ? 'customer_name' : colId;
        const valid = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'status'];
        if (colId === 'actions' || !valid.includes(key)) return;
        let ns;
        if (sortConfig.key !== key) ns = { key, direction: 'desc', phase: 1 };
        else {
            const np = ((sortConfig.phase || 1) % 3) + 1;
            if (np === 3) ns = { key: 'created_at', direction: 'desc', phase: 1 };
            else ns = { key, direction: np === 2 ? 'asc' : 'desc', phase: np };
        }
        setSortConfig(ns);
        localStorage.setItem('order_list_sort', JSON.stringify(ns));
        fetchOrders(1, filters, pagination.per_page, ns);
    };

    const handleQuickStatusUpdate = async (id, s) => {
        try {
            const response = await orderApi.updateStatus(id, s);
            // Updating the exact order in the list with the new data from backend
            setOrders(prev => prev.map(o => o.id === id ? { ...o, ...response.data } : o));
            setStatusMenuOrderId(null);
            setNotification({ type: 'success', message: 'Đã cập nhật trạng thái đơn hàng' });
        } catch (e) {
            console.error("Status update error", e);
            const errorMsg = e.response?.data?.message || 'Lỗi cập nhật trạng thái';
            setNotification({ type: 'error', message: errorMsg });
        }
    };

    const handleBulkDuplicate = async () => {
        if (!selectedIds.length) return;
        try {
            setLoading(true);
            await orderApi.bulkDuplicate(selectedIds);
            setNotification({ type: 'success', message: `Đã nhân bản ${selectedIds.length} đơn` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'Lỗi nhân bản' }); } finally { setLoading(false); }
    };

    const handleBulkDelete = async () => {
        if (!selectedIds.length) return;
        if (!window.confirm("Xóa đơn hàng đã chọn?")) return;
        try {
            setLoading(true);
            await orderApi.bulkDelete(selectedIds, false);
            setNotification({ type: 'success', message: `Đã xóa ${selectedIds.length} đơn` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'Lỗi xóa' }); } finally { setLoading(false); }
    };

    const handleBulkRestore = async () => {
        if (!selectedIds.length) return;
        try {
            setLoading(true);
            await orderApi.bulkRestore(selectedIds);
            setNotification({ type: 'success', message: `Đã khôi phục ${selectedIds.length} đơn` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'Lỗi khôi phục' }); } finally { setLoading(false); }
    };

    const handleBulkForceDelete = async () => {
        if (!selectedIds.length) return;
        if (!window.confirm("Xóa vĩnh viễn?")) return;
        try {
            setLoading(true);
            await orderApi.bulkDelete(selectedIds, true);
            setNotification({ type: 'success', message: `Đã xóa vĩnh viễn ${selectedIds.length} đơn` });
            setSelectedIds([]);
            fetchOrders(1);
        } catch (e) { setNotification({ type: 'error', message: 'Lỗi xóa' }); } finally { setLoading(false); }
    };

    const handleCopy = (t, e) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(t);
        setCopiedText(t);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const getStatusStyle = (s) => {
        const f = orderStatuses.find(st => st.code === s);
        return f ? { backgroundColor: `${f.color}15`, color: f.color, borderColor: `${f.color}30` } : {};
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === orders.length && orders.length > 0) setSelectedIds([]);
        else setSelectedIds(orders.map(o => o.id));
    };

    const toggleSelectOrder = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

    const activeCount = () => {
        let c = 0;
        if (filters.status?.length) c++;
        if (filters.customer_name) c++;
        if (filters.order_number) c++;
        if (filters.customer_phone) c++;
        if (filters.created_at_from || filters.created_at_to) c++;
        if (filters.attributes) c += Object.keys(filters.attributes).length;
        return c;
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-page-container { font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100%; background-color: #F8FAFC; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-text-13 { font-size: 13px !important; color: #0F172A !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .sticky-col-0 { position: sticky; left: 0; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                .sticky-col-1 { position: sticky; left: 40px; z-index: 10; background: #FCFEFF; border-right: 1px solid #E2E8F0 !important; }
                tr:hover .sticky-col-0, tr:hover .sticky-col-1 { background-color: #F1F5F9 !important; }
                tr.bg-primary\/5 .sticky-col-0, tr.bg-primary\/5 .sticky-col-1 { background-color: #E2E8F0 !important; }
                .table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>

            {notification && (
                <div className={`fixed top-6 right-6 z-[100] p-4 rounded-sm shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <span className="material-symbols-outlined">{notification.type === 'error' ? 'report' : 'check_circle'}</span>
                    <span className="font-bold">{notification.message}</span>
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100"><span className="material-symbols-outlined">close</span></button>
                </div>
            )}

            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center"><h1 className="admin-header-title italic">Quản lý đơn hàng</h1><AccountSelector user={user} /></div>

                <div className="bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex items-center gap-2">
                    <div className="flex gap-1 items-center">
                        {!isTrashView ? (
                            <>
                                <button onClick={() => navigate('/admin/orders/new')} title="Tạo mới" className="bg-brick text-white p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all hover:bg-umber"><span className="material-symbols-outlined text-[18px]">add</span></button>
                                <button onClick={handleBulkDuplicate} disabled={selectedIds.length === 0} title="Nhân bản" className={`p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white shadow-sm' : 'text-primary/30 grayscale opacity-50 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">content_copy</span></button>
                                <button onClick={handleBulkDelete} disabled={selectedIds.length === 0} title="Xóa" className={`p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm' : 'text-primary/30 grayscale opacity-50 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">delete</span></button>
                            </>
                        ) : (
                            <>
                                <button onClick={() => setIsTrashView(false)} title="Về danh sách" className="bg-primary text-white p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all hover:bg-primary-800"><span className="material-symbols-outlined text-[18px]">arrow_back</span></button>
                                <button onClick={handleBulkRestore} disabled={selectedIds.length === 0} title="Khôi phục" className={`p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-green-600/10 text-green-600 hover:bg-green-600 hover:text-white shadow-sm' : 'text-primary/30 grayscale opacity-50 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">restore_from_trash</span></button>
                                <button onClick={handleBulkForceDelete} disabled={selectedIds.length === 0} title="Xóa vĩnh viễn" className={`p-1.5 rounded-sm w-9 h-9 flex items-center justify-center transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm' : 'text-primary/30 grayscale opacity-50 cursor-not-allowed'}`}><span className="material-symbols-outlined text-[18px]">delete_forever</span></button>
                            </>
                        )}
                        <div className="w-[1px] h-6 bg-primary/20 mx-1"></div>
                        <button data-filter-btn onClick={() => { if (!showFilters) setTempFilters({ ...filters }); setShowFilters(!showFilters); }} className={`p-1.5 border transition-all rounded-sm w-9 h-9 flex items-center justify-center ${showFilters || activeCount() > 0 ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary border-primary/20 hover:bg-primary/5'}`} title="Bộ lọc nâng cao"><span className="material-symbols-outlined text-[18px]">filter_alt</span></button>
                        <button onClick={handleRefresh} disabled={loading} title="Làm mới" className="bg-white text-primary border border-primary/20 p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center hover:bg-primary/5"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 flex items-center justify-center transition-all ${showColumnSettings ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/30 hover:bg-primary/5'}`} title="Cấu hình hiển thị cột"><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>
                        {!isTrashView && <button onClick={() => setIsTrashView(true)} title="Thùng rác" className="bg-white text-primary/60 border border-primary/20 p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center hover:text-primary hover:border-primary"><span className="material-symbols-outlined text-[18px]">inventory_2</span></button>}

                        {selectedIds.length > 0 && (
                            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-primary/10">
                                <span className="text-[11px] font-bold text-primary/40 whitespace-nowrap">{selectedIds.length} chọn</span>
                                <button onClick={() => setSelectedIds([])} className="p-1 text-primary/40 hover:text-brick" title="Hủy chọn"><span className="material-symbols-outlined text-[16px]">close</span></button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 relative" ref={searchContainerRef}>
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-primary/40 text-[16px] pointer-events-none z-10">search</span>
                        <input type="text" autoComplete="off" placeholder="Tìm tên, mã, SĐT khách..." className="w-full bg-primary/5 border border-primary/10 px-8 py-1.5 rounded-sm text-[14px] focus:outline-none focus:border-primary/30 transition-all relative z-0" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onFocus={() => setShowSearchHistory(true)} onKeyDown={(e) => { if (e.key === 'Enter') { setShowSearchHistory(false); addToSearchHistory(filters.search); } }} />
                        {filters.search && (
                            <button onClick={() => { setFilters(prev => ({ ...prev, search: '' })); setShowSearchHistory(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors">
                                <span className="material-symbols-outlined text-[16px]">cancel</span>
                            </button>
                        )}
                        {showSearchHistory && searchHistory.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[60] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1"><span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span><button onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('order_search_history'); }} className="text-[10px] text-brick hover:underline font-bold">Xóa tất cả</button></div>
                                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                    {searchHistory.map((h, i) => (
                                        <div key={i} className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors" onClick={() => { setFilters({ ...filters, search: h }); setShowSearchHistory(false); }}>
                                            <div className="flex items-center gap-2 overflow-hidden"><span className="material-symbols-outlined text-[16px] text-primary/30">history</span><span className="text-[13px] text-[#0F172A] truncate font-medium">{h}</span></div>
                                            <button onClick={(e) => { e.stopPropagation(); const updated = searchHistory.filter(x => x !== h); setSearchHistory(updated); localStorage.setItem('order_search_history', JSON.stringify(updated)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5"><span className="material-symbols-outlined text-[14px]">close</span></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showFilters && tempFilters && (
                <div ref={filterRef} className="bg-white border border-primary/20 p-5 shadow-2xl mb-4 rounded-sm animate-in slide-in-from-top-4 duration-300 relative z-50 text-[#0F172A]">
                    <div className="flex justify-between items-center mb-6 pb-3 border-b border-primary/10">
                        <h4 className="font-bold text-primary flex items-center gap-2 text-[15px]"><span className="material-symbols-outlined text-[20px]">tune</span> Cấu hình bộ lọc đơn hàng</h4>
                        <div className="flex gap-4">
                            <button onClick={handleReset} className="text-[13px] font-bold text-primary/40 hover:text-brick transition-colors">Thiết lập lại</button>
                            <button onClick={applyFilters} className="bg-primary text-white px-8 py-2 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all">Áp dụng bộ lọc</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm overflow-hidden mb-6 bg-primary/[0.02]">
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Tên khách</label>
                            <input name="customer_name" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.customer_name} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Mã đơn</label>
                            <input name="order_number" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.order_number} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">SĐT khách</label>
                            <input name="customer_phone" type="text" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.customer_phone} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Trạng thái</label>
                            <div className="relative">
                                <select name="status" className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer appearance-none" value={tempFilters.status[0] || ''} onChange={(e) => setTempFilters({ ...tempFilters, status: e.target.value ? [e.target.value] : [] })}>
                                    <option value="">Tất cả</option>
                                    {orderStatuses.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}
                                </select>
                                <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 pointer-events-none text-[18px]">
                                    expand_more
                                </span>
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày đặt</label>
                            <div className="flex gap-2 items-center h-10">
                                <input name="created_at_from" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.created_at_from} onChange={handleTempFilterChange} />
                                <span className="text-primary/20">-</span>
                                <input name="created_at_to" type="date" className="flex-1 h-full bg-white border border-primary/10 rounded-sm px-2 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.created_at_to} onChange={handleTempFilterChange} />
                            </div>
                        </div>
                    </div>
                    {allAttributes.length > 0 && (
                        <div className="mt-8 pt-6 border-t border-primary/10">
                            <h5 className="text-[15px] font-bold text-[#0F172A] mb-4">Lọc theo thuộc tính</h5>
                            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm bg-primary/[0.02]">
                                {allAttributes.map((a) => (
                                    <div key={a.id} className="p-4 space-y-2.5 border-r border-b border-primary/10 relative">
                                        <label className="text-[11px] font-bold text-stone-500 uppercase tracking-[0.15em]">{a.name}</label>
                                        <div className="relative" data-attr-dropdown>
                                            <button 
                                                onClick={() => setOpenAttrId(openAttrId === a.id ? null : a.id)}
                                                className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === a.id ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                            >
                                                <span className="truncate text-[13px] font-bold text-primary">
                                                    {(tempFilters.attributes[a.id] || []).length > 0 
                                                        ? `${a.name}: ${(tempFilters.attributes[a.id] || []).length}` 
                                                        : `Chọn ${a.name}...`}
                                                </span>
                                                <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === a.id ? 'rotate-180' : ''}`}>
                                                    expand_more
                                                </span>
                                            </button>

                                            {openAttrId === a.id && (
                                                <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                        {(tempFilters.attributes[a.id] || []).length > 0 && (
                                                            <button 
                                                                className="w-full px-3 py-2 text-left text-[11px] font-black text-brick hover:bg-brick/5 border-b border-primary/5 mb-1 uppercase tracking-widest flex items-center gap-2"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTempFilters(prev => ({
                                                                        ...prev,
                                                                        attributes: { ...prev.attributes, [a.id]: [] }
                                                                    }));
                                                                }}
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">backspace</span>
                                                                Xóa các mục đã chọn
                                                            </button>
                                                        )}
                                                        {a.options?.length > 0 ? (
                                                            a.options.map(opt => (
                                                                <label 
                                                                    key={opt.id}
                                                                    className="px-3 py-2.5 hover:bg-primary/5 cursor-pointer flex items-center gap-3 group transition-colors select-none"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <div className="relative flex items-center">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={(tempFilters.attributes[a.id] || []).includes(opt.value)}
                                                                            onChange={() => handleTempAttributeFilterChange(a.id, opt.value)}
                                                                            className="w-4 h-4 accent-primary cursor-pointer rounded-sm border-2 border-primary/20"
                                                                        />
                                                                    </div>
                                                                    <span className={`text-[13px] transition-all ${(tempFilters.attributes[a.id] || []).includes(opt.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                                        {opt.value}
                                                                    </span>
                                                                </label>
                                                            ))
                                                        ) : (
                                                            <div className="px-4 py-6 text-center text-stone-400 italic text-[12px]">Không có dữ liệu</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeCount() > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-primary/5 p-2 border border-primary/10 rounded-sm animate-in fade-in duration-300">
                    <span className="text-[13px] font-bold text-primary px-1 mr-1 border-r border-primary/20 flex items-center gap-1.5"><span className="material-symbols-outlined text-[16px]">filter_list</span>Đang lọc:</span>
                    {filters.status?.length > 0 && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Trạng thái:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.status.map(s => orderStatuses.find(st => st.code === s)?.name).join(', ')}</span>
                            <button onClick={() => removeFilter('status')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {filters.customer_name && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Khách:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.customer_name}</span>
                            <button onClick={() => removeFilter('customer_name')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {(filters.created_at_from || filters.created_at_to) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ngày:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.created_at_from || '?'} → {filters.created_at_to || '?'}</span>
                            <button onClick={() => removeFilter('date')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}
                    {filters.attributes && Object.entries(filters.attributes).map(([id, v]) => {
                        if (!v) return null;
                        const a = allAttributes.find(x => x.id === parseInt(id));
                        return (
                            <div key={id} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                                <span className="text-[11px] text-primary/40">{a?.name}:</span>
                                <span className="text-[13px] font-bold text-[#0F172A]">{v}</span>
                                <button onClick={() => removeFilter('attributes', { attrId: id })} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            </div>
                        );
                    })}
                    <button onClick={handleReset} className="ml-auto text-[13px] font-bold text-brick hover:underline px-2 pr-1 border-primary/20">Xóa tất cả bộ lọc</button>
                </div>
            )}

            {showColumnSettings && <div ref={columnSettingsRef}><TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="order_list" /></div>}

            <div className="flex-1 bg-white border border-primary/10 shadow-xl overflow-auto table-scrollbar relative rounded-sm">
                <table className="text-left border-collapse table-fixed min-w-full admin-text-13" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="admin-table-header sticky top-0 z-20 shadow-sm border-b border-primary/10">
                        <tr>
                            <th className="p-3 w-10 admin-table-header border border-primary/20 sticky-col-0"><input type="checkbox" checked={orders.length > 0 && selectedIds.length === orders.length} onChange={toggleSelectAll} className="size-4 accent-primary" /></th>
                            {renderedColumns.map((c, i) => (
                                <th key={c.id} draggable={c.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, i)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, i)} onDoubleClick={() => handleSort(c.id)} className={`px-3 py-2.5 border border-primary/10 cursor-move hover:bg-primary/5 relative group ${c.id === 'order_number' ? 'sticky-col-1' : ''}`} style={{ width: columnWidths[c.id] || c.minWidth }}>
                                    <div className={`flex items-center gap-1.5 ${c.align === 'center' ? 'justify-center' : c.align === 'right' ? 'justify-end' : ''}`}>{c.id !== 'actions' && <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-primary">drag_indicator</span>}<span className="truncate text-primary font-black">{c.label}</span><SortIndicator colId={c.id === 'customer' ? 'customer_name' : c.id} sortConfig={sortConfig} /></div>
                                    {c.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(c.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 && !loading ? (
                            <tr>
                                <td colSpan={renderedColumns.length + 1} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-primary/40">
                                        <span className="material-symbols-outlined text-[48px]">inventory_2</span>
                                        <p className="font-bold text-[15px]">Không tìm thấy đơn hàng nào</p>
                                        <p className="text-[13px]">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            orders.map(o => (
                                <tr key={o.id} onDoubleClick={() => navigate(`/admin/orders/edit/${o.id}`)} onClick={() => toggleSelectOrder(o.id)} className={`transition-all group cursor-pointer ${selectedIds.includes(o.id) ? 'bg-primary/10' : 'hover:bg-primary/5'}`}>
                                    <td className="p-3 border border-primary/20 sticky-col-0 group-hover:bg-primary/5 transition-colors"><input type="checkbox" checked={selectedIds.includes(o.id)} readOnly className="size-4 accent-primary" /></td>
                                    {renderedColumns.map(c => {
                                        const cs = { width: columnWidths[c.id] || c.minWidth };
                                        if (c.id === 'order_number') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 sticky-col-1 font-mono font-bold text-primary group transition-colors">
                                                <div className="flex items-center justify-between"><span className="truncate">{o.order_number}</span><button onClick={(e) => handleCopy(o.order_number, e)} className={`opacity-0 group-hover:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.order_number ? 'text-green-500 opacity-100' : 'text-primary/20'}`}><span className="material-symbols-outlined text-[14px]">{copiedText === o.order_number ? 'check' : 'content_copy'}</span></button></div>
                                            </td>
                                        );
                                        if (c.id === 'customer') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/customer_cell relative">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center justify-between group/name_c">
                                                        <span className="font-bold text-[#111] truncate">{o.customer_name}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(o.customer_name, e); }} className={`opacity-0 group-hover/name_c:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.customer_name ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">{copiedText === o.customer_name ? 'check' : 'content_copy'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center justify-between group/phone_c">
                                                        <span className="text-[11px] text-orange-600 font-black truncate">{o.customer_phone}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(o.customer_phone, e); }} className={`opacity-0 group-hover/phone_c:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.customer_phone ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[12px]">{copiedText === o.customer_phone ? 'check' : 'content_copy'}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'province') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/province_cell relative text-primary font-bold">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{o.province || '-'}</span>
                                                    {o.province && <button onClick={(e) => { e.stopPropagation(); handleCopy(o.province, e); }} className={`opacity-0 group-hover/province_cell:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.province ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'ward') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 group/ward_cell relative text-primary font-bold">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{o.ward || '-'}</span>
                                                    {o.ward && <button onClick={(e) => { e.stopPropagation(); handleCopy(o.ward, e); }} className={`opacity-0 group-hover/ward_cell:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === o.ward ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                        if (c.id === 'items') {
                                            const rawItems = o.items || [];
                                            const hasMany = rawItems.length > 2;

                                            // Smart re-ordering based on search query
                                            let itemsToShow = [...rawItems];
                                            if (filters.search && filters.search.trim()) {
                                                const query = filters.search.toLowerCase().trim();
                                                const matches = itemsToShow.filter(item => {
                                                    const name = (item.product?.name || item.product_name_snapshot || '').toLowerCase();
                                                    const sku = (item.product?.sku || item.product_sku_snapshot || '').toLowerCase();
                                                    return name.includes(query) || sku.includes(query);
                                                });
                                                const nonMatches = itemsToShow.filter(item => {
                                                    const name = (item.product?.name || item.product_name_snapshot || '').toLowerCase();
                                                    const sku = (item.product?.sku || item.product_sku_snapshot || '').toLowerCase();
                                                    return !name.includes(query) && !sku.includes(query);
                                                });
                                                itemsToShow = [...matches, ...nonMatches];
                                            }

                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 align-top relative group/item_cell">
                                                    <div className="flex flex-col h-full">
                                                        <div className={`max-h-[110px] overflow-y-auto custom-scrollbar space-y-3 flex-1 ${hasMany ? 'pr-8' : 'pr-1'}`}>
                                                            {itemsToShow.map((item, idx) => {
                                                                const itemName = item.product?.name || item.product_name_snapshot || '...';
                                                                const itemSku = item.product?.sku || item.product_sku_snapshot || '';

                                                                // Check if this item is a match to highlight
                                                                const isMatch = filters.search && (
                                                                    itemName.toLowerCase().includes(filters.search.toLowerCase().trim()) ||
                                                                    itemSku.toLowerCase().includes(filters.search.toLowerCase().trim())
                                                                );

                                                                return (
                                                                    <div key={idx} className={`flex items-start gap-2.5 relative p-1 rounded-sm transition-colors ${isMatch ? 'bg-primary/5 ring-1 ring-primary/10' : ''}`}>
                                                                        <div className="shrink-0 mt-0.5">
                                                                            <div className={`text-[12px] font-black px-1.5 py-0.5 rounded-sm border flex items-center justify-center min-w-[28px] ${isMatch ? 'text-white bg-primary border-primary shadow-sm' : 'text-orange-600 bg-orange-50 border-orange-200'}`}>
                                                                                {item.quantity}x
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex items-center gap-1.5 group/name">
                                                                                <span className={`truncate font-bold text-[13px] block ${isMatch ? 'text-primary underline decoration-primary/30 underline-offset-2' : 'text-primary'}`} title={itemName}>{itemName}</span>
                                                                                <button onClick={(e) => { e.stopPropagation(); handleCopy(itemName, e); }} className="opacity-0 group-hover/name:opacity-100 p-0.5 hover:text-primary transition-all text-primary/30 flex shrink-0"><span className="material-symbols-outlined text-[14px]">content_copy</span></button>
                                                                            </div>
                                                                            {itemSku && (
                                                                                <div className="flex items-center gap-1.5 group/sku mt-0.5">
                                                                                    <span className={`truncate font-black text-[13px] block ${isMatch ? 'text-orange-600' : 'text-orange-600/60'}`} title={itemSku}>{itemSku}</span>
                                                                                    <button onClick={(e) => { e.stopPropagation(); handleCopy(itemSku, e); }} className="opacity-0 group-hover/sku:opacity-100 p-0.5 hover:text-primary transition-all text-primary/30 flex shrink-0"><span className="material-symbols-outlined text-[14px]">content_copy</span></button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                        {hasMany && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    productPopupAnchorRef.current = e.currentTarget;
                                                                    setProductPopupOrderId(o.id);
                                                                }}
                                                                className="absolute right-1 bottom-1 w-7 h-7 bg-primary text-white rounded-sm flex items-center justify-center hover:bg-primary-700 transition-all shadow-md z-10 opacity-0 group-hover/item_cell:opacity-100"
                                                                title="Xem đầy đủ danh sách"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">visibility</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'total_price') {
                                            const formattedPrice = new Intl.NumberFormat('vi-VN').format(Math.floor(o.total_price));
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 font-black text-brick group/price relative">
                                                    <div className="flex items-center justify-between">
                                                        <span>{formattedPrice}₫</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(formattedPrice.replace(/\./g, ''), e); }} className={`opacity-0 group-hover/price:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === formattedPrice.replace(/\./g, '') ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'status') {
                                            const statusName = orderStatuses.find(s => s.code === o.status)?.name || o.status;
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-left group/status relative">
                                                    <div className="flex items-center justify-start gap-1">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                statusMenuAnchorRef.current = e.currentTarget;
                                                                setStatusMenuOrderId(o.id);
                                                            }}
                                                            data-status-edit-btn
                                                            className="px-2 py-1 rounded-sm text-[11px] font-black border transition-all hover:scale-105 active:scale-95 shadow-sm group/status-btn flex items-center gap-1.5"
                                                            style={getStatusStyle(o.status)}
                                                        >
                                                            <span className="truncate">{statusName}</span>
                                                            <span className="material-symbols-outlined text-[16px] leading-none opacity-40 group-hover/status-btn:opacity-100 transition-opacity">expand_more</span>
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(statusName, e); }} className={`opacity-0 group-hover/status:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === statusName ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'actions') return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-right sticky right-0 bg-white group-hover:bg-primary/5"><div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button onClick={(e) => { e.stopPropagation(); navigate(`/admin/orders/edit/${o.id}`); }} className="p-1 hover:text-primary"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                                                <button onClick={(e) => { e.stopPropagation(); if (window.confirm("Xóa?")) orderApi.destroy(o.id).then(() => { handleRefresh(); setNotification({ type: 'success', message: 'Đã xóa' }); }); }} className="p-1 hover:text-brick"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                                            </div></td>
                                        );
                                        if (c.isAttribute) {
                                            const attrVal = (o.attribute_values?.find(av => av.attribute_id === c.attrId)?.value || '-');
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 truncate text-primary font-black group/attr relative">
                                                    <div className="flex items-center justify-between">
                                                        <span className="truncate">{attrVal}</span>
                                                        {attrVal !== '-' && <button onClick={(e) => { e.stopPropagation(); handleCopy(attrVal, e); }} className={`opacity-0 group-hover/attr:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === attrVal ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>}
                                                    </div>
                                                </td>
                                            );
                                        }
                                        if (c.id === 'created_at') {
                                            const dateText = `${new Date(o.created_at).toLocaleDateString('vi-VN')} ${new Date(o.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
                                            return (
                                                <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 text-primary font-black italic group/date relative">
                                                    <div className="flex items-center justify-between">
                                                        <span className="truncate">{dateText}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(dateText, e); }} className={`opacity-0 group-hover/date:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === dateText ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            );
                                        }
                                        const cellVal = o[c.id] || '-';
                                        return (
                                            <td key={c.id} style={cs} className="px-3 py-2 border border-primary/20 truncate text-primary font-black italic group/gen relative">
                                                <div className="flex items-center justify-between">
                                                    <span className="truncate">{cellVal}</span>
                                                    {cellVal !== '-' && <button onClick={(e) => { e.stopPropagation(); handleCopy(cellVal, e); }} className={`opacity-0 group-hover/gen:opacity-100 p-0.5 hover:text-primary transition-all ${copiedText === cellVal ? 'text-green-500 opacity-100' : 'text-primary/20'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                    </button>}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
                {loading && <div className="absolute inset-0 bg-white/40 flex items-center justify-center z-50"><div className="w-8 h-8 border-4 border-gold/10 border-t-gold rounded-full animate-refresh-spin"></div></div>}
            </div>

            <div className="flex-none mt-4 flex justify-between items-center text-[13px] font-bold text-primary/40 border-t border-primary/10 pt-4">
                <div className="flex items-center gap-4"><span>Hiển thị {orders.length} / {pagination.total}</span><div className="flex items-center gap-2"><span>Số dòng:</span><select value={pagination.per_page} onChange={(e) => fetchOrders(1, filters, parseInt(e.target.value))} className="bg-transparent border-none outline-none font-black text-primary cursor-pointer">{[20, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}</select></div></div>
                <Pagination pagination={pagination} onPageChange={(page) => fetchOrders(page)} />
            </div>

            <StatusDropdownPortal
                order={orders.find(o => String(o.id) === String(statusMenuOrderId))}
                orderStatuses={orderStatuses}
                onUpdate={handleQuickStatusUpdate}
                anchorRef={statusMenuAnchorRef}
                visible={!!statusMenuOrderId}
                onClose={() => setStatusMenuOrderId(null)}
                statusMenuRef={statusMenuRef}
            />
            <OrderProductsPortal items={orders.find(o => o.id === productPopupOrderId)?.items || []} copiedText={copiedText} onCopy={handleCopy} anchorRef={productPopupAnchorRef} visible={!!productPopupOrderId} onClose={() => setProductPopupOrderId(null)} />
        </div>
    );
};

export default OrderList;
