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
    { id: 'shipping_address', label: 'Địa Chỉ', minWidth: '220px' },
    { id: 'items', label: 'Sản Phẩm', minWidth: '250px' },
    { id: 'total_price', label: 'Tổng Tiền', minWidth: '130px' },
    { id: 'created_at', label: 'Ngày Đặt', minWidth: '120px' },
    { id: 'notes', label: 'Ghi Chú Đơn', minWidth: '180px' },
    { id: 'status', label: 'Trạng Thái', minWidth: '120px', align: 'center' },
    { id: 'actions', label: 'Thao Tác', minWidth: '125px', align: 'right', fixed: true },
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

    useEffect(() => {
        if (visible && anchorRef.current) {
            const updatePosition = () => {
                const rect = anchorRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const viewportWidth = window.innerWidth;
                const cardWidth = 620;

                // Estimate height (compact rows are ~42px)
                const maxAllowedHeight = viewportHeight * 0.65;
                const estimatedHeight = Math.min(items.length * 42 + 100, maxAllowedHeight);

                let top = rect.bottom + 8;
                let left = rect.left + (rect.width / 2) - (cardWidth / 2);
                let placement = 'bottom';

                // Check vertical space
                const spaceBelow = viewportHeight - rect.bottom;
                const spaceAbove = rect.top;

                if (spaceBelow < (estimatedHeight + 20) && spaceAbove > spaceBelow) {
                    top = rect.top - 8;
                    placement = 'top';
                }

                // Boundary adjustment
                if (left + cardWidth > viewportWidth - 20) left = viewportWidth - cardWidth - 20;
                left = Math.max(20, left);

                setPosition({ top, left, placement });
            };

            updatePosition();

            const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
            const handleClickOutside = (e) => {
                if (portalRef.current && !portalRef.current.contains(e.target) && !anchorRef.current.contains(e.target)) {
                    onClose();
                }
            };

            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', updatePosition);
            window.addEventListener('keydown', handleKeyDown);
            document.addEventListener('mousedown', handleClickOutside);

            return () => {
                window.removeEventListener('scroll', updatePosition, true);
                window.removeEventListener('resize', updatePosition);
                window.removeEventListener('keydown', handleKeyDown);
                document.removeEventListener('mousedown', handleClickOutside);
            };
        } else {
            setPosition(null);
        }
    }, [visible, anchorRef, items, onClose]);

    if (!visible || !items?.length) return null;

    return createPortal(
        <div
            ref={portalRef}
            style={{
                position: 'fixed',
                top: position?.top || 0,
                left: position?.left || 0,
                transform: position?.placement === 'top' ? 'translateY(-100%)' : 'none',
                zIndex: 99999,
                width: 620,
                visibility: position ? 'visible' : 'hidden',
                opacity: position ? 1 : 0
            }}
            className={`bg-white/95 backdrop-blur-2xl border border-stone/15 shadow-[0_30px_80px_rgba(0,0,0,0.3)] rounded-2xl py-4 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto overflow-hidden ${position?.placement === 'top' ? 'origin-bottom' : 'origin-top'}`}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="px-6 pb-3 border-b border-stone/10 flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gold/10 flex items-center justify-center shadow-inner">
                        <span className="material-symbols-outlined text-[20px] text-gold">inventory_2</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mb-0.5">Chi tiết sản phẩm</span>
                        <span className="text-[15px] font-extrabold text-primary tracking-tight">{items.length} Sản phẩm trong đơn hàng</span>
                    </div>
                </div>
                <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-stone/5 flex items-center justify-center text-stone/40 hover:text-stone-800 transition-colors">
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>

            <div className="px-7 py-2 flex items-center gap-4 text-[10px] font-black text-stone/40 uppercase tracking-widest border-b border-stone/5 mb-1 bg-stone/5">
                <div className="w-8 text-center">SL</div>
                <div className="flex-1">Tên Sản Phẩm & Mã SKU</div>
                <div className="w-24 text-right">Đơn Giá</div>
                <div className="w-16"></div>
            </div>

            <div className="max-h-[55vh] overflow-y-auto custom-scrollbar px-2.5 pt-1 space-y-1">
                {items.map((item, idx) => {
                    const name = item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`;
                    const sku = item.product?.sku || item.product_sku_snapshot || null;
                    const price = item.price ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price) : null;
                    return (
                        <div key={idx} className="flex items-center gap-4 px-5 py-2.5 rounded-xl hover:bg-gold/5 transition-all border border-transparent hover:border-gold/15 relative">
                            <div className="w-8 shrink-0 flex justify-center"><span className="font-black text-[13px] text-gold-700 bg-gold/10 w-8 h-8 flex items-center justify-center rounded-xl border border-gold/20">{item.quantity}</span></div>
                            <div className="flex-1 min-w-0 flex items-center gap-2.5">
                                <span className="text-[14px] font-bold text-stone-800 truncate" title={name}>{name}</span>
                                {sku && <span className="text-[11px] font-mono font-black text-stone/40 bg-stone/5 px-2 py-1 rounded-md border border-stone/10 tracking-tight">#{sku}</span>}
                            </div>
                            <div className="w-24 shrink-0 text-right">{price ? <span className="text-[14px] text-brick font-black">{price}</span> : <span className="text-[11px] text-stone/30 italic">N/A</span>}</div>
                            <div className="w-16 shrink-0 flex items-center justify-end gap-1"><button onClick={(e) => { e.stopPropagation(); onCopy(name, e); }} className={`p-1.5 rounded-lg hover:bg-gold/20 ${copiedText === name ? 'text-green-500' : 'text-stone/30'}`}><span className="material-symbols-outlined text-[18px]">{copiedText === name ? 'check_circle' : 'content_copy'}</span></button></div>
                        </div>
                    );
                })}
            </div>
            <div className="px-6 mt-3.5 pt-3.5 border-t border-stone/10 flex justify-between items-center bg-stone/5 -mb-4 py-3"><span className="text-[10px] text-stone/40 font-bold uppercase tracking-[0.1em]">Bấm ESC hoặc Click ra ngoài để đóng</span></div>
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
        <div ref={statusMenuRef} style={{ position: 'fixed', top: position?.top || 0, left: position?.left || 0, transform: position?.placement === 'top' ? 'translateY(-100%)' : 'none', zIndex: 999999, width: 260, opacity: position ? 1 : 0 }} className={`bg-white border border-stone/15 shadow-2xl rounded-2xl py-2 overflow-hidden ${position?.placement === 'top' ? 'origin-bottom' : 'origin-top'}`} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-2.5 border-b border-stone/5 mb-1 flex items-center gap-2.5 opacity-40"><span className="material-symbols-outlined text-[16px]">swap_vert</span><p className="text-[10px] font-black uppercase tracking-[0.2em]">Cập nhật trạng thái</p></div>
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                {orderStatuses.map(s => (
                    <button key={s.id} onClick={() => { onUpdate(order.id, s.code); onClose(); }} className={`w-full flex items-center justify-between px-5 py-3.5 text-sm transition-all hover:bg-stone/5 relative ${order.status === s.code ? 'bg-primary/5 text-primary font-bold' : 'text-stone-700'}`}>
                        <div className="flex items-center gap-4"><div className="w-4 h-4 rounded-full border-2 border-white ring-1 ring-stone/10" style={{ backgroundColor: s.color }}></div><span className="truncate text-[14px] font-bold">{s.name}</span></div>
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
    const statusMenuRef = useRef(null);
    const [showBulkAttrUpdate, setShowBulkAttrUpdate] = useState(false);
    const [bulkAttrUpdateValues, setBulkAttrUpdateValues] = useState({});
    const [bulkStatusUpdateValue, setBulkStatusUpdateValue] = useState("");
    const bulkAttrUpdateRef = useRef(null);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({ search: '', status: [], customer_name: '', order_number: '', created_at_from: '', created_at_to: '', shipped_at_from: '', shipped_at_to: '', customer_phone: '', shipping_address: '' });
    const [attributeFilters, setAttributeFilters] = useState({});
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

    const fetchOrders = useCallback(async (page = 1, currentFilters = filters, currentAttrFilters = attributeFilters, perPage = pagination.per_page, currentSort = sortConfig) => {
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
            Object.keys(currentAttrFilters).forEach(k => { if (currentAttrFilters[k]) params[`attr_${k}`] = currentAttrFilters[k]; });

            const response = await orderApi.getAll(params);
            setOrders(response.data.data);
            setPagination({ current_page: response.data.current_page, last_page: response.data.last_page, total: response.data.total, per_page: response.data.per_page });
        } catch (error) { console.error("Error fetching orders", error); } finally { setLoading(false); }
    }, [filters, attributeFilters, pagination.per_page, sortConfig, isTrashView]);

    useEffect(() => { fetchInitialData(); fetchOrders(1); }, []);
    useEffect(() => { fetchOrders(1); }, [isTrashView]);
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (filterRef.current && !filterRef.current.contains(e.target) && !e.target.closest('[data-filter-btn]')) setShowFilters(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target) && !e.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target) && !e.target.closest('[data-status-edit-btn]')) setStatusMenuOrderId(null);
            if (bulkAttrUpdateRef.current && !bulkAttrUpdateRef.current.contains(e.target) && !e.target.closest('[data-bulk-attr-btn]')) setShowBulkAttrUpdate(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchInitialData = async () => {
        try {
            const [statusRes, orderAttrRes, prodAttrRes] = await Promise.all([orderStatusApi.getAll(), attributeApi.getAll({ entity_type: 'order' }), attributeApi.getAll({ entity_type: 'product' })]);
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
        } catch (error) { console.error("Error initial data", error); }
    };

    const handleSort = (columnId) => {
        let key = columnId === 'customer' ? 'customer_name' : columnId;
        const validSortParams = ['id', 'order_number', 'customer_name', 'created_at', 'total_price', 'status'];
        if (key === 'actions' || !validSortParams.includes(key)) return;

        let newSort;
        if (sortConfig.key !== key) {
            newSort = { key, direction: 'desc', phase: 1 };
        } else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            if (nextPhase === 3) newSort = { key: 'created_at', direction: 'desc', phase: 1 };
            else newSort = { key, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
        }
        setSortConfig(newSort);
        localStorage.setItem('order_list_sort', JSON.stringify(newSort));
        fetchOrders(1, filters, attributeFilters, pagination.per_page, newSort);
    };

    const handleQuickStatusUpdate = async (orderId, newStatus) => {
        try {
            await api.put(`/orders/${orderId}/status`, { status: newStatus });
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
            setStatusMenuOrderId(null);
        } catch (error) { alert(error.response?.data?.message || "Lỗi!"); }
    };

    const handleBulkAttrUpdate = async () => {
        if (!selectedIds.length) return;
        try {
            setLoading(true);
            const customPayload = {};
            Object.entries(bulkAttrUpdateValues).forEach(([k, v]) => { if (v.trim()) customPayload[k] = v; });
            const payload = { ids: selectedIds, custom_attributes: customPayload };
            if (bulkStatusUpdateValue) payload.status = bulkStatusUpdateValue;
            await orderApi.bulkUpdate(payload);
            setShowBulkAttrUpdate(false);
            setBulkAttrUpdateValues({});
            setBulkStatusUpdateValue("");
            fetchOrders(pagination.current_page);
            setSelectedIds([]);
        } catch (error) { alert("Lỗi cập nhật!"); } finally { setLoading(false); }
    };

    const handleCopy = (text, e) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedText(text);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const getStatusStyle = (status) => {
        const found = orderStatuses.find(s => s.code === status);
        return found ? { backgroundColor: `${found.color}15`, color: found.color, borderColor: `${found.color}30` } : {};
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === orders.length) setSelectedIds([]);
        else setSelectedIds(orders.map(o => o.id));
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            <style>{`.animate-refresh-spin { animation: spin 0.8s linear infinite; } @keyframes spin { from {transform:rotate(0deg)} to {transform:rotate(360deg)}} .sticky-col-0{position:sticky;left:0;z-index:10;background:#fcfcfa} .sticky-actions{position:sticky;right:0;z-index:10;background:#fcfcfa}`}</style>

            <div className="flex-none bg-[#fcfcfa] pb-4 space-y-2">
                <div className="flex justify-between items-center"><h1 className="text-2xl font-display font-bold text-primary italic">Quản lý đơn hàng</h1><AccountSelector user={user} /></div>
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center gap-2">
                    <div className="flex gap-1.5 items-center">
                        {!isTrashView && <button onClick={() => navigate('/admin/orders/new')} className="bg-brick text-white p-1.5 rounded-sm w-9 h-9"><span className="material-symbols-outlined text-[18px]">add</span></button>}
                        <button data-filter-btn onClick={() => setShowFilters(!showFilters)} className={`p-1.5 border rounded-sm w-9 h-9 ${showFilters ? 'bg-primary text-white' : 'bg-white text-primary border-gold/20'}`}><span className="material-symbols-outlined text-[18px]">filter_alt</span></button>
                        <button disabled={selectedIds.length === 0} onClick={() => setShowBulkAttrUpdate(!showBulkAttrUpdate)} data-bulk-attr-btn className={`p-1.5 border rounded-sm w-9 h-9 ${selectedIds.length > 0 ? 'bg-indigo-600 text-white' : 'bg-stone/10 text-stone/40'}`}><span className="material-symbols-outlined text-[18px]">auto_fix_high</span></button>
                        <button onClick={() => fetchOrders(1)} className="bg-primary text-white p-1.5 rounded-sm w-9 h-9"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 ${showColumnSettings ? 'bg-gold text-white' : 'bg-white text-gold border-gold/30'}`}><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>
                        <button onClick={() => setIsTrashView(!isTrashView)} className={`p-1.5 border rounded-sm w-9 h-9 ${isTrashView ? 'bg-stone text-white' : 'bg-white text-stone'}`}><span className="material-symbols-outlined text-[18px]">{isTrashView ? 'arrow_back' : 'delete'}</span></button>
                    </div>

                    {selectedIds.length > 0 && (
                        <div className="flex gap-1 items-center bg-gold/5 p-1 rounded-sm border border-gold/20">
                            <button onClick={() => { if (window.confirm("Xóa hàng loạt?")) orderApi.bulkDelete(selectedIds, isTrashView).then(() => { setSelectedIds([]); fetchOrders(1); }) }} className="text-brick p-1 rounded-sm w-8 h-8"><span className="material-symbols-outlined text-[18px]">delete_sweep</span></button>
                            <button onClick={() => setSelectedIds([])} className="text-gold p-1 rounded-sm w-8 h-8"><span className="material-symbols-outlined text-[18px]">cancel</span></button>
                            <span className="text-[12px] font-bold text-gold px-1">{selectedIds.length} đã chọn</span>
                        </div>
                    )}

                    <div className="flex-1 relative">
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gold text-[16px]">search</span>
                        <input type="text" placeholder="Tìm kiếm đơn hàng..." className="w-full bg-stone/5 border border-gold/10 px-8 py-1.5 rounded-sm text-[14px]" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyPress={(e) => e.key === 'Enter' && fetchOrders(1)} />
                    </div>
                </div>
            </div>

            {showFilters && (
                <div ref={filterRef} className="bg-white border-b-2 border-primary/20 p-4 shadow-lg mb-4 rounded-b-md">
                    <div className="flex justify-between items-center mb-4">
                        <h4 className="font-bold text-primary flex items-center gap-2"><span className="material-symbols-outlined">tune</span>Bộ lọc nâng cao</h4>
                        <div className="flex gap-4">
                            <button onClick={() => { setFilters({ search: '', status: [], customer_name: '', order_number: '', created_at_from: '', created_at_to: '', shipped_at_from: '', shipped_at_to: '', customer_phone: '', shipping_address: '' }); setAttributeFilters({}); fetchOrders(1); }} className="text-sm font-bold text-stone-400">Xóa tất cả</button>
                            <button onClick={() => { fetchOrders(1); setShowFilters(false); }} className="bg-primary text-white px-6 py-1.5 rounded font-bold text-sm">Xác nhận</button>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <input type="text" placeholder="Tên khách..." className="border p-2 rounded text-sm" value={filters.customer_name} onChange={(e) => setFilters({ ...filters, customer_name: e.target.value })} />
                        <input type="text" placeholder="Số điện thoại..." className="border p-2 rounded text-sm" value={filters.customer_phone} onChange={(e) => setFilters({ ...filters, customer_phone: e.target.value })} />
                        <select className="border p-2 rounded text-sm" value={filters.status[0] || ''} onChange={(e) => setFilters({ ...filters, status: e.target.value ? [e.target.value] : [] })}><option value="">-- Trạng thái --</option>{orderStatuses.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}</select>
                        <input type="date" className="border p-2 rounded text-sm" value={filters.created_at_from} onChange={(e) => setFilters({ ...filters, created_at_from: e.target.value })} />
                        <input type="date" className="border p-2 rounded text-sm" value={filters.created_at_to} onChange={(e) => setFilters({ ...filters, created_at_to: e.target.value })} />
                    </div>
                </div>
            )}

            {showBulkAttrUpdate && (
                <div ref={bulkAttrUpdateRef} className="bg-indigo-50 border-2 border-indigo-200 p-4 rounded-lg mb-4 shadow-xl animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div className="space-y-1"><label className="text-xs font-bold text-indigo-700">Trạng thái mới</label><select className="w-full border p-2 rounded text-sm font-bold bg-white" value={bulkStatusUpdateValue} onChange={(e) => setBulkStatusUpdateValue(e.target.value)}><option value="">-- Giữ nguyên --</option>{orderStatuses.map(s => <option key={s.id} value={s.code}>{s.name}</option>)}</select></div>
                        {allAttributes.map(attr => (
                            <div key={attr.id} className="space-y-1"><label className="text-xs font-bold text-indigo-700">{attr.name}</label><input type="text" className="w-full border p-2 rounded text-sm bg-white" placeholder="Nhập..." value={bulkAttrUpdateValues[attr.id] || ''} onChange={(e) => setBulkAttrUpdateValues({ ...bulkAttrUpdateValues, [attr.id]: e.target.value })} /></div>
                        ))}
                        <button onClick={handleBulkAttrUpdate} className="bg-indigo-600 text-white font-bold py-2 px-4 rounded hover:bg-indigo-700 shadow-md">Cập nhật {selectedIds.length} đơn</button>
                    </div>
                </div>
            )}

            {showColumnSettings && (
                <div ref={columnSettingsRef}>
                    <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="order_list" />
                </div>
            )}

            <div className="flex-1 bg-white border border-stone/20 shadow-xl overflow-auto table-scrollbar relative rounded-md">
                <table className="text-left border-collapse table-fixed min-w-full" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="bg-[#fcfcfa] text-[11px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 shadow-sm border-b border-stone/20">
                        <tr>
                            <th className="p-3 w-10 bg-[#fcfcfa] border border-stone/20 sticky-col-0"><input type="checkbox" checked={orders.length > 0 && selectedIds.length === orders.length} onChange={toggleSelectAll} className="size-4 accent-primary" /></th>
                            {renderedColumns.map((col, idx) => (
                                <th key={col.id} draggable={col.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, idx)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, idx)} onDoubleClick={() => handleSort(col.id)} className={`px-3 py-2.5 border border-stone/20 cursor-move hover:bg-gold/5 relative group ${col.id === 'order_number' ? 'sticky-col-0' : ''}`} style={{ width: columnWidths[col.id] || col.minWidth }}>
                                    <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}>
                                        {col.id !== 'actions' && <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-gold">drag_indicator</span>}
                                        <span className="truncate">{col.label}</span>
                                        <SortIndicator colId={col.id === 'customer' ? 'customer_name' : col.id} sortConfig={sortConfig} />
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.id} onClick={() => toggleSelectProduct(order.id)} className={`transition-all group cursor-pointer ${selectedIds.includes(order.id) ? 'bg-gold/10' : 'hover:bg-gold/5'}`}>
                                <td className="p-3 border border-stone/20 sticky-col-0"><input type="checkbox" checked={selectedIds.includes(order.id)} readOnly className="size-4 accent-primary" /></td>
                                {renderedColumns.map(col => {
                                    const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                    if (col.id === 'order_number') return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 font-mono font-bold text-primary">{order.order_number}</td>;
                                    if (col.id === 'customer') return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20"><div className="flex flex-col"><span className="font-bold text-primary">{order.customer_name}</span><span className="text-xs text-stone/60">{order.customer_phone}</span></div></td>;
                                    if (col.id === 'items') {
                                        const count = order.items?.length || 0;
                                        return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20"><div className="flex items-center gap-2" onMouseEnter={(e) => { if (count > 1) { /* Logic to show portal - usually via ref or state */ } }}><span className="text-[13px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">{count} SP</span><span className="truncate text-stone-600 italic text-xs">{order.items?.[0]?.product?.name || '...'}</span></div></td>;
                                    }
                                    if (col.id === 'total_price') return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 font-black text-brick">{new Intl.NumberFormat('vi-VN').format(Math.floor(order.total_price))}₫</td>;
                                    if (col.id === 'status') {
                                        const style = getStatusStyle(order.status);
                                        return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-center"><button onClick={(e) => { e.stopPropagation(); setStatusMenuOrderId(order.id); }} data-status-edit-btn className="px-3 py-1 rounded-full text-[11px] font-bold border shadow-sm transition-all" style={style}>{orderStatuses.find(s => s.code === order.status)?.name || order.status}</button></td>;
                                    }
                                    if (col.id === 'actions') return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-right"><div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all"><button onClick={(e) => { e.stopPropagation(); navigate(`/admin/orders/edit/${order.id}`); }} className="p-1 hover:text-indigo-600"><span className="material-symbols-outlined text-[18px]">edit</span></button><button onClick={(e) => { e.stopPropagation(); if (window.confirm("Xóa đơn hàng?")) orderApi.destroy(order.id).then(() => fetchOrders()); }} className="p-1 hover:text-brick"><span className="material-symbols-outlined text-[18px]">delete</span></button></div></td>;
                                    if (col.isAttribute) return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 truncate text-xs text-stone-600 font-bold">{order.attribute_values?.find(av => av.attribute_id === col.attrId)?.value || '-'}</td>;
                                    return <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 truncate text-xs text-stone-600">{order[col.id] || '-'}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <StatusDropdownPortal order={orders.find(o => o.id === statusMenuOrderId)} orderStatuses={orderStatuses} onUpdate={handleQuickStatusUpdate} anchorRef={{ current: document.querySelector(`[data-status-edit-btn]`) }} visible={!!statusMenuOrderId} onClose={() => setStatusMenuOrderId(null)} statusMenuRef={statusMenuRef} />

            <div className="flex-none mt-4 flex justify-between items-center text-xs text-stone border-t-2 border-primary/20 pt-4"><span>Hiển thị {orders.length} / {pagination.total}</span><Pagination pagination={pagination} onPageChange={(page) => fetchOrders(page)} /></div>
        </div>
    );
};

export default OrderList;
