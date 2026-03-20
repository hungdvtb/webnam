import React, { useState, useEffect, useCallback, useRef } from 'react';
import { shipmentApi } from '../../services/api';
import { useNavigate } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';

// ── Status Config ──
const SHIPMENT_STATUSES = [
    { code: 'created', label: 'Đã tạo', color: '#9ca3af', icon: 'add_circle' },
    { code: 'waiting_pickup', label: 'Chờ lấy hàng', color: '#6b7280', icon: 'schedule' },
    { code: 'picked_up', label: 'Đã lấy hàng', color: '#60a5fa', icon: 'inventory' },
    { code: 'in_transit', label: 'Đang trung chuyển', color: '#3b82f6', icon: 'local_shipping' },
    { code: 'out_for_delivery', label: 'Đang giao', color: '#1d4ed8', icon: 'delivery_dining' },
    { code: 'delivered', label: 'Giao thành công', color: '#16a34a', icon: 'check_circle' },
    { code: 'delivery_failed', label: 'Giao thất bại', color: '#f97316', icon: 'error' },
    { code: 'returning', label: 'Đang hoàn', color: '#eab308', icon: 'undo' },
    { code: 'returned', label: 'Đã hoàn', color: '#ef4444', icon: 'assignment_return' },
    { code: 'canceled', label: 'Đã hủy', color: '#dc2626', icon: 'cancel' },
];

const RECONCILIATION_STATUSES = [
    { code: 'pending', label: 'Chưa đối soát', color: '#9ca3af' },
    { code: 'reconciled', label: 'Đã đối soát', color: '#16a34a' },
    { code: 'mismatch', label: 'Lệch tiền', color: '#ef4444' },
];

const COD_STATUSES = [
    { code: 'unpaid', label: 'Chưa thu', color: '#9ca3af' },
    { code: 'collected', label: 'Đã thu', color: '#16a34a' },
    { code: 'failed', label: 'Thu thất bại', color: '#f97316' },
    { code: 'transferred', label: 'Đã chuyển', color: '#3b82f6' },
];

const DEFAULT_COLUMNS = [
    { id: 'shipment_number', label: 'Mã Vận Đơn', minWidth: '150px' },
    { id: 'order_code', label: 'Đơn Hàng', minWidth: '130px' },
    { id: 'carrier_name', label: 'Hãng VC', minWidth: '120px' },
    { id: 'customer_name', label: 'Khách Hàng', minWidth: '160px' },
    { id: 'customer_phone', label: 'SĐT', minWidth: '110px' },
    { id: 'shipment_status', label: 'Trạng Thái', minWidth: '130px', align: 'center' },
    { id: 'cod_amount', label: 'COD', minWidth: '110px', align: 'right' },
    { id: 'shipping_cost', label: 'Phí Ship', minWidth: '100px', align: 'right' },
    { id: 'actual_received_amount', label: 'Thực Nhận', minWidth: '100px', align: 'right' },
    { id: 'reconciliation_status', label: 'Đối Soát', minWidth: '100px', align: 'center' },
    { id: 'created_at', label: 'Ngày Tạo', minWidth: '100px' },
    { id: 'actions', label: 'Thao Tác', minWidth: '120px', align: 'right', fixed: true },
];

const getStatus = (code, list) => list.find(s => s.code === code) || { label: code || '-', color: '#9ca3af' };
const fmtMoney = (v) => v ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v) : '0 ₫';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '-';
const fmtDateTime = (d) => d ? `${new Date(d).toLocaleDateString('vi-VN')} ${new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : '-';

// ── Badge Component ──
const StatusBadge = ({ code, list }) => {
    const s = getStatus(code, list);
    return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider whitespace-nowrap border transition-all"
            style={{ backgroundColor: `${s.color}12`, color: s.color, borderColor: `${s.color}30` }}>
            {s.label}
        </span>
    );
};

// ── Stats Cards ──
const StatsCards = ({ stats, loading }) => {
    const cards = [
        { key: 'total', label: 'Tổng vận đơn', icon: 'package_2', color: '#6366f1', value: stats.total },
        { key: 'waiting_pickup', label: 'Chờ lấy hàng', icon: 'schedule', color: '#6b7280', value: stats.waiting_pickup },
        { key: 'in_transit', label: 'Đang giao', icon: 'local_shipping', color: '#3b82f6', value: stats.in_transit },
        { key: 'delivered', label: 'Giao thành công', icon: 'check_circle', color: '#16a34a', value: stats.delivered },
        { key: 'delivery_failed', label: 'Giao thất bại', icon: 'error', color: '#f97316', value: stats.delivery_failed },
        { key: 'returning', label: 'Đang hoàn', icon: 'undo', color: '#eab308', value: stats.returning },
        { key: 'total_cod', label: 'Tổng COD', icon: 'payments', color: '#ec4899', value: fmtMoney(stats.total_cod), isMoney: true },
        { key: 'pending_reconciliation', label: 'Chưa đối soát', icon: 'pending_actions', color: '#f59e0b', value: stats.pending_reconciliation },
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {cards.map(c => (
                <div key={c.key} className="bg-white border border-stone/10 p-3 rounded-lg shadow-sm hover:shadow-md transition-all group cursor-default">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="size-8 rounded-lg flex items-center justify-center transition-all" style={{ backgroundColor: `${c.color}12` }}>
                            <span className="material-symbols-outlined text-[18px]" style={{ color: c.color }}>{c.icon}</span>
                        </div>
                        <span className="text-[9px] font-black text-stone/40 uppercase tracking-widest leading-tight">{c.label}</span>
                    </div>
                    <p className={`font-black tracking-tight ${c.isMoney ? 'text-[13px]' : 'text-[20px]'}`} style={{ color: c.color }}>
                        {loading ? '...' : (c.isMoney ? c.value : (c.value ?? 0))}
                    </p>
                </div>
            ))}
        </div>
    );
};

// ── Main Component ──
const ShipmentList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [shipments, setShipments] = useState([]);
    const [stats, setStats] = useState({});
    const [carriers, setCarriers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [copiedText, setCopiedText] = useState(null);
    const [statusMenuId, setStatusMenuId] = useState(null);
    const [showFilters, setShowFilters] = useState(false);
    const [detailShipment, setDetailShipment] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [noteText, setNoteText] = useState('');
    const [drawerTab, setDrawerTab] = useState('overview');
    const [reconcileForm, setReconcileForm] = useState({ amount: '', note: '' });
    const [reconcileLoading, setReconcileLoading] = useState(false);

    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({
        search: '', shipment_status: '', reconciliation_status: '', carrier_code: '',
        created_from: '', created_to: '', cod_min: '', cod_max: '',
    });

    const [sortConfig, setSortConfig] = useState(() => {
        const saved = localStorage.getItem('shipment_list_sort');
        return saved ? JSON.parse(saved) : { key: 'created_at', direction: 'desc', phase: 1 };
    });

    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const columnSettingsRef = useRef(null);
    const [notification, setNotification] = useState(null);
    const [bulkReconciling, setBulkReconciling] = useState(false);
    const [bulkSyncing, setBulkSyncing] = useState(false);

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
        setAvailableColumns
    } = useTableColumns('shipment_list', DEFAULT_COLUMNS);

    const abortRef = useRef(null);
    const statusMenuRef = useRef(null);

    const handleCopy = (text, e) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedText(text);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const fetchShipments = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            if (abortRef.current) abortRef.current.abort();
            abortRef.current = new AbortController();
            const params = { page, per_page: pagination.per_page, sort_by: sortConfig.key, sort_order: sortConfig.direction };
            if (filters.search) params.search = filters.search;
            if (filters.shipment_status) params.shipment_status = filters.shipment_status;
            if (filters.reconciliation_status) params.reconciliation_status = filters.reconciliation_status;
            if (filters.carrier_code) params.carrier_code = filters.carrier_code;
            if (filters.created_from) params.created_from = filters.created_from;
            if (filters.created_to) params.created_to = filters.created_to;
            if (filters.cod_min) params.cod_min = filters.cod_min;
            if (filters.cod_max) params.cod_max = filters.cod_max;

            const res = await shipmentApi.getAll(params, abortRef.current.signal);
            setShipments(res.data.data || []);
            setPagination({ current_page: res.data.current_page, last_page: res.data.last_page, total: res.data.total, per_page: res.data.per_page });
        } catch (err) {
            if (err.name !== 'CanceledError') console.error(err);
        } finally {
            setLoading(false);
        }
    }, [filters, sortConfig, pagination.per_page]);

    const fetchStats = useCallback(async () => {
        try { const res = await shipmentApi.getStats(); setStats(res.data || {}); } catch (e) { console.error(e); }
    }, []);

    const fetchCarriers = useCallback(async () => {
        try { const res = await shipmentApi.getCarriers(); setCarriers(res.data || []); } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { fetchShipments(); fetchStats(); fetchCarriers(); }, []);
    useEffect(() => {
        const t = setTimeout(() => fetchShipments(1), 400);
        return () => clearTimeout(t);
    }, [filters, sortConfig]);
    useEffect(() => {
        if (!notification) return undefined;
        const timer = window.setTimeout(() => setNotification(null), 3500);
        return () => window.clearTimeout(timer);
    }, [notification]);

    useEffect(() => {
        const intervalId = window.setInterval(async () => {
            try {
                await shipmentApi.sync({ mode: 'active' });
                fetchShipments(pagination.current_page);
                fetchStats();
            } catch (error) {
                console.error('Shipment auto sync failed', error);
            }
        }, 30000);

        return () => window.clearInterval(intervalId);
    }, [fetchShipments, fetchStats, pagination.current_page]);

    const handleSort = (columnId) => {
        const validSortColumns = ['id', 'shipment_number', 'order_code', 'shipment_status', 'cod_amount', 'shipping_cost', 'actual_received_amount', 'created_at', 'carrier_name'];
        let key = columnId;

        if (key === 'actions') return;

        let newSort;
        if (sortConfig.key !== key) {
            newSort = { key, direction: 'desc', phase: 1 };
        } else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            if (nextPhase === 3) {
                newSort = { key: 'id', direction: 'desc', phase: 1 };
            } else {
                newSort = { key, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
            }
        }

        setSortConfig(newSort);
        localStorage.setItem('shipment_list_sort', JSON.stringify(newSort));
    };

    const handleStatusUpdate = async (id, newStatus) => {
        try {
            const res = await shipmentApi.updateStatus(id, { status: newStatus });
            setShipments(prev => prev.map(s => s.id === id ? { ...s, shipment_status: newStatus, status: newStatus } : s));
            setStatusMenuId(null);
            fetchStats();
            if (res.data?.order_synced) {
                // Order was auto-synced
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Lỗi khi cập nhật trạng thái!';
            const needsOverride = err.response?.data?.requires_override;
            if (needsOverride) {
                alert(`⚠️ ${msg}\n\nLiên hệ admin để override nếu cần.`);
            } else {
                alert(msg);
            }
            setStatusMenuId(null);
        }
    };

    const handleBulkStatus = async (newStatus) => {
        if (!selectedIds.length) return;
        if (!window.confirm(`Cập nhật ${selectedIds.length} vận đơn sang "${getStatus(newStatus, SHIPMENT_STATUSES).label}"?`)) return;
        try {
            await shipmentApi.bulkUpdateStatus({ ids: selectedIds, status: newStatus });
            setSelectedIds([]);
            fetchShipments(pagination.current_page);
            fetchStats();
        } catch { alert('Lỗi cập nhật hàng loạt!'); }
    };

    const handleBulkReconcileSelected = async () => {
        if (!selectedIds.length) return;
        setBulkReconciling(true);
        try {
            const response = await shipmentApi.bulkReconcile({ shipment_ids: selectedIds });
            setNotification({
                type: 'success',
                message: response.data?.message || `Đã đối soát ${response.data?.success_count || selectedIds.length} vận đơn.`,
            });
            setSelectedIds([]);
            fetchShipments(pagination.current_page);
            fetchStats();
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Không thể đối soát các vận đơn đã chọn.',
            });
        } finally {
            setBulkReconciling(false);
        }
    };

    const handleSyncShipments = async (mode = 'selected') => {
        const shipmentIds = mode === 'selected' ? selectedIds : [];
        if (mode === 'selected' && shipmentIds.length === 0) return;
        setBulkSyncing(true);
        try {
            const response = await shipmentApi.sync(mode === 'selected' ? { shipment_ids: shipmentIds, mode } : { mode });
            setNotification({
                type: 'success',
                message: response.data?.message || 'Đã đồng bộ trạng thái vận đơn.',
            });
            fetchShipments(mode === 'selected' ? pagination.current_page : 1);
            fetchStats();
        } catch (error) {
            setNotification({
                type: 'error',
                message: error.response?.data?.message || 'Không thể đồng bộ vận đơn.',
            });
        } finally {
            setBulkSyncing(false);
        }
    };

    const openDetail = async (id) => {
        setDetailLoading(true);
        setDetailShipment(null);
        setDrawerTab('overview');
        setReconcileForm({ amount: '', note: '' });
        try {
            const res = await shipmentApi.getOne(id);
            setDetailShipment(res.data);
        } catch { alert('Không thể tải chi tiết vận đơn'); }
        finally { setDetailLoading(false); }
    };

    const handleAddNote = async () => {
        if (!noteText.trim() || !detailShipment) return;
        try {
            await shipmentApi.addNote(detailShipment.id, { content: noteText });
            setNoteText('');
            openDetail(detailShipment.id);
        } catch { alert('Lỗi khi thêm ghi chú'); }
    };

    const handleReconcile = async () => {
        if (!reconcileForm.amount || !detailShipment) return;
        setReconcileLoading(true);
        try {
            await shipmentApi.markReconciled(detailShipment.id, { reconciled_amount: parseFloat(reconcileForm.amount), note: reconcileForm.note });
            setReconcileForm({ amount: '', note: '' });
            openDetail(detailShipment.id);
            fetchStats();
            fetchShipments(pagination.current_page);
        } catch { alert('Lỗi khi đối soát!'); }
        finally { setReconcileLoading(false); }
    };

    // Risk warnings computation
    const getRiskWarnings = (shp) => {
        const warnings = [];
        if (shp.cod_amount >= 5000000) warnings.push({ type: 'high_cod', label: 'COD cao', icon: 'payments', color: '#f59e0b' });
        if (shp.attempt_delivery_count >= 2) warnings.push({ type: 'multi_fail', label: `Giao thất bại ${shp.attempt_delivery_count} lần`, icon: 'warning', color: '#ef4444' });
        if (shp.shipment_status === 'in_transit' || shp.shipment_status === 'out_for_delivery') {
            const shipped = shp.shipped_at ? new Date(shp.shipped_at) : null;
            if (shipped && (Date.now() - shipped.getTime()) > 3 * 86400000) warnings.push({ type: 'stuck', label: 'Quá 3 ngày chưa giao', icon: 'schedule', color: '#f97316' });
        }
        if (shp.reconciliation_status === 'mismatch') warnings.push({ type: 'mismatch', label: 'Lệch đối soát', icon: 'error', color: '#dc2626' });
        if (shp.shipment_status === 'delivered' && shp.reconciliation_status === 'pending') warnings.push({ type: 'unreconciled', label: 'Chưa đối soát', icon: 'pending_actions', color: '#f59e0b' });
        return warnings;
    };

    const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    const toggleSelectAll = () => setSelectedIds(selectedIds.length === shipments.length ? [] : shipments.map(s => s.id));

    // Close menus on outside click
    useEffect(() => {
        const handler = (e) => {
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target) && !e.target.closest('[data-status-btn]')) setStatusMenuId(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') { setStatusMenuId(null); setDetailShipment(null); } };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            {notification && (
                <div className={`fixed top-6 right-6 z-[100] p-4 rounded-sm shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <span className="material-symbols-outlined">{notification.type === 'error' ? 'error' : 'check_circle'}</span>
                    <span className="font-bold">{notification.message}</span>
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            )}
            {/* Header */}
            <div className="flex-none pb-4 space-y-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-[22px] text-primary">local_shipping</span>
                        </div>
                        <div>
                            <h1 className="text-2xl font-display font-bold text-primary italic">Quản lý vận đơn</h1>
                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em]">Shipment Management • Theo dõi giao nhận & COD</p>
                        </div>
                    </div>
                    <div className="hidden md:block scale-90 origin-right"><AccountSelector user={user} /></div>
                </div>

                {/* Stats */}
                <StatsCards stats={stats} loading={loading} />

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5 items-center">
                            <button onClick={() => setShowFilters(!showFilters)}
                                className={`p-1.5 border transition-all flex items-center justify-center rounded-sm w-9 h-9 ${showFilters ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-gold/20 hover:bg-gold/5'}`}
                                title="Bộ lọc">
                                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                            </button>
                            <button onClick={() => { fetchShipments(1); fetchStats(); }}
                                className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                                title="Làm mới" disabled={loading}>
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                        </div>

                            <button
                                onClick={() => handleSyncShipments(selectedIds.length > 0 ? 'selected' : 'active')}
                                className={`p-1.5 border transition-all flex items-center justify-center rounded-sm w-9 h-9 ${(bulkSyncing || selectedIds.length > 0) ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15' : 'bg-white text-primary border-gold/20 hover:bg-gold/5'}`}
                                title={selectedIds.length > 0 ? 'Đồng bộ vận đơn đã chọn' : 'Đồng bộ vận đơn đang hoạt động'}
                                disabled={bulkSyncing}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${bulkSyncing ? 'animate-spin' : ''}`}>sync</span>
                            </button>
                            <button
                                onClick={handleBulkReconcileSelected}
                                className={`h-9 px-3 rounded-sm border flex items-center gap-2 text-[12px] font-black uppercase tracking-wide transition-all ${selectedIds.length > 0 ? 'bg-primary text-white border-primary hover:bg-primary/90' : 'bg-white text-primary/30 border-primary/10 cursor-not-allowed'}`}
                                title="Đối soát"
                                disabled={selectedIds.length === 0 || bulkReconciling}
                            >
                                <span className={`material-symbols-outlined text-[18px] ${bulkReconciling ? 'animate-spin' : ''}`}>account_balance</span>
                                Đối soát
                            </button>

                        {/* Bulk actions */}
                        {selectedIds.length > 0 && (
                            <div className="flex gap-1 items-center bg-gold/5 p-1 rounded-sm border border-gold/20">
                                <select onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value); e.target.value = ''; }}
                                    className="bg-white border border-gold/20 text-[11px] font-bold p-1.5 rounded-sm focus:outline-none" defaultValue="">
                                    <option value="" disabled>Đổi trạng thái ({selectedIds.length})</option>
                                    {SHIPMENT_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                                </select>
                                <button onClick={() => setSelectedIds([])} className="text-gold p-1 hover:bg-gold hover:text-white transition-all rounded-sm w-8 h-8 flex items-center justify-center" title="Bỏ chọn">
                                    <span className="material-symbols-outlined text-[18px]">cancel</span>
                                </button>
                                <span className="text-[12px] font-bold text-gold px-1">{selectedIds.length} đã chọn</span>
                            </div>
                        )}

                        {/* Search */}
                        <div className="flex-1 relative min-w-[200px]">
                            <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-gold text-[16px]">search</span>
                            <input type="text" placeholder="Mã vận đơn, tracking, tên, SĐT..."
                                className="w-full bg-stone/5 border border-gold/10 px-8 py-1.5 focus:outline-none focus:border-primary font-body text-[14px] rounded-sm"
                                value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))} />
                        </div>

                        <button
                            onClick={() => setShowColumnSettings(!showColumnSettings)}
                            className={`p-1.5 border transition-all flex items-center justify-center rounded-sm w-9 h-9 ${showColumnSettings ? 'bg-primary text-white border-primary' : 'bg-white text-primary border-gold/20 hover:bg-gold/5'}`}
                            title="Cấu hình cột"
                        >
                            <span className="material-symbols-outlined text-[18px]">view_column</span>
                        </button>
                    </div>
                </div>

                {/* Column Settings Panel */}
                {showColumnSettings && (
                    <div ref={columnSettingsRef}>
                        <TableColumnSettingsPanel
                            availableColumns={availableColumns}
                            visibleColumns={visibleColumns}
                            toggleColumn={toggleColumn}
                            setAvailableColumns={setAvailableColumns}
                            resetDefault={resetDefault}
                            saveAsDefault={saveAsDefault}
                            onClose={() => setShowColumnSettings(false)}
                            storageKey="shipment_list"
                        />
                    </div>
                )}

                {/* Filters Panel */}
                {showFilters && (
                    <div className="bg-white border border-gold/10 p-4 shadow-lg rounded-md animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-stone/60 uppercase tracking-wider">Trạng thái vận đơn</label>
                                <select className="w-full bg-stone/5 border border-stone/10 p-2 text-[13px] rounded-md" value={filters.shipment_status}
                                    onChange={(e) => setFilters(f => ({ ...f, shipment_status: e.target.value }))}>
                                    <option value="">Tất cả</option>
                                    {SHIPMENT_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-stone/60 uppercase tracking-wider">Đối soát</label>
                                <select className="w-full bg-stone/5 border border-stone/10 p-2 text-[13px] rounded-md" value={filters.reconciliation_status}
                                    onChange={(e) => setFilters(f => ({ ...f, reconciliation_status: e.target.value }))}>
                                    <option value="">Tất cả</option>
                                    {RECONCILIATION_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-stone/60 uppercase tracking-wider">Hãng vận chuyển</label>
                                <select className="w-full bg-stone/5 border border-stone/10 p-2 text-[13px] rounded-md" value={filters.carrier_code}
                                    onChange={(e) => setFilters(f => ({ ...f, carrier_code: e.target.value }))}>
                                    <option value="">Tất cả</option>
                                    {carriers.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-stone/60 uppercase tracking-wider">Ngày tạo từ</label>
                                <input type="date" className="w-full bg-stone/5 border border-stone/10 p-2 text-[13px] rounded-md" value={filters.created_from}
                                    onChange={(e) => setFilters(f => ({ ...f, created_from: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-bold text-stone/60 uppercase tracking-wider">Ngày tạo đến</label>
                                <input type="date" className="w-full bg-stone/5 border border-stone/10 p-2 text-[13px] rounded-md" value={filters.created_to}
                                    onChange={(e) => setFilters(f => ({ ...f, created_to: e.target.value }))} />
                            </div>
                            <div className="flex items-end">
                                <button onClick={() => setFilters({ search: '', shipment_status: '', reconciliation_status: '', carrier_code: '', created_from: '', created_to: '', cod_min: '', cod_max: '' })}
                                    className="text-[12px] font-bold text-brick hover:underline">Xóa lọc</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="flex-1 bg-white border border-stone/20 shadow-xl overflow-auto rounded-md relative table-scrollbar">
                <table
                    className="text-left border-collapse border-spacing-0 border border-stone/20 table-fixed min-w-full"
                    style={{ width: `${totalTableWidth}px` }}
                >
                    <thead className="bg-[#fcfcfa] font-ui text-[11px] font-black text-slate-500 uppercase tracking-[0.1em] sticky top-0 z-20 shadow-sm border-b border-stone/20">
                        <tr>
                            <th className="p-3 w-10 bg-[#fcfcfa] border border-stone/20 sticky left-0 z-30">
                                <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={shipments.length > 0 && selectedIds.length === shipments.length} onChange={toggleSelectAll} />
                            </th>
                            {renderedColumns.map((col, idx) => (
                                <th
                                    key={col.id}
                                    draggable={col.id !== 'actions'}
                                    onDragStart={(e) => handleHeaderDragStart(e, idx)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => handleHeaderDrop(e, idx)}
                                    onDoubleClick={() => handleSort(col.id)}
                                    className={`px-3 py-2.5 bg-[#fcfcfa] border border-stone/20 cursor-move hover:bg-gold/5 transition-colors relative group ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`}
                                    style={{
                                        width: columnWidths[col.id] || col.minWidth,
                                        minWidth: col.id === 'actions' ? col.minWidth : '10px'
                                    }}
                                >
                                    <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}>
                                        {col.id !== 'actions' && (
                                            <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 transition-opacity text-gold">drag_indicator</span>
                                        )}
                                        <span className="truncate">{col.label}</span>
                                        <div className="shrink-0 flex items-center">
                                            <SortIndicator colId={col.id} sortConfig={sortConfig} />
                                        </div>
                                    </div>
                                    {col.id !== 'actions' && (
                                        <div
                                            onMouseDown={(e) => handleColumnResize(col.id, e)}
                                            className="absolute right-0 top-0 bottom-0 w-6 cursor-col-resize hover:bg-primary/5 z-10 transition-colors group/resizer flex items-center justify-center translate-x-1/2"
                                            title="Kéo để chỉnh kích thước"
                                        >
                                            <div className="w-[3px] h-8 bg-stone/20 group-hover/resizer:bg-primary/50 transition-colors rounded-full" />
                                        </div>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="font-body text-sm">
                        {shipments.map(shp => {
                            const st = getStatus(shp.shipment_status, SHIPMENT_STATUSES);
                            return (
                                <tr key={shp.id} className={`transition-all group cursor-pointer ${selectedIds.includes(shp.id) ? 'bg-gold/10' : 'hover:bg-gold/5'}`}
                                    onClick={() => toggleSelect(shp.id)} onDoubleClick={(e) => { e.stopPropagation(); openDetail(shp.id); }}>
                                    <td className="p-3 border border-stone/20 sticky left-0 bg-inherit z-10">
                                        <input type="checkbox" className="size-4 cursor-pointer accent-primary" checked={selectedIds.includes(shp.id)} onChange={() => toggleSelect(shp.id)} />
                                    </td>
                                    {renderedColumns.map((col) => {
                                        const cellStyle = {
                                            width: columnWidths[col.id] || col.minWidth,
                                            minWidth: col.id === 'actions' ? col.minWidth : '10px'
                                        };

                                        if (col.id === 'shipment_number') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20">
                                                <div className="flex items-center gap-1 group/copy">
                                                    <span className="font-black text-primary text-[13px] tracking-tight truncate">{shp.shipment_number}</span>
                                                    <button onClick={(e) => handleCopy(shp.shipment_number, e)}
                                                        className={`shrink-0 transition-all ${copiedText === shp.shipment_number ? 'text-green-500' : 'text-stone/20 hover:text-gold opacity-0 group-hover/copy:opacity-100'}`}>
                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === shp.shipment_number ? 'check_circle' : 'content_copy'}</span>
                                                    </button>
                                                </div>
                                                {shp.tracking_number && <p className="text-[10px] font-mono text-stone/40 truncate mt-0.5" title={shp.tracking_number}>#{shp.tracking_number}</p>}
                                            </td>
                                        );

                                        if (col.id === 'order_code') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20">
                                                <span className="font-bold text-primary text-[12px] truncate">{shp.order_code || shp.order?.order_number || '-'}</span>
                                            </td>
                                        );

                                        if (col.id === 'carrier_name') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20">
                                                <span className="text-[12px] font-bold text-stone-700 truncate">{shp.carrier_name || shp.carrier?.name || '-'}</span>
                                            </td>
                                        );

                                        if (col.id === 'customer_name') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20">
                                                <span className="font-bold text-primary text-[13px] truncate block">{shp.customer_name || shp.order?.customer_name || '-'}</span>
                                            </td>
                                        );

                                        if (col.id === 'customer_phone') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20">
                                                <div className="flex items-center gap-1 group/phone">
                                                    <span className="text-[13px] font-bold text-stone/80 truncate">{shp.customer_phone || shp.order?.customer_phone || '-'}</span>
                                                    {(shp.customer_phone || shp.order?.customer_phone) && (
                                                        <button onClick={(e) => handleCopy(shp.customer_phone || shp.order?.customer_phone, e)}
                                                            className={`shrink-0 transition-all ${copiedText === (shp.customer_phone || shp.order?.customer_phone) ? 'text-green-500' : 'text-stone/20 hover:text-gold opacity-0 group-hover/phone:opacity-100'}`}>
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        );

                                        if (col.id === 'shipment_status') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-center relative">
                                                <button data-status-btn onClick={(e) => { e.stopPropagation(); setStatusMenuId(statusMenuId === shp.id ? null : shp.id); }}
                                                    className="inline-flex items-center gap-1 rounded-md transition-all hover:ring-2 hover:ring-offset-1 active:scale-95 cursor-pointer"
                                                    style={{ backgroundColor: `${st.color}12`, color: st.color, borderColor: `${st.color}30`, border: '1px solid' }}>
                                                    <span className="px-2 py-1 text-[10px] font-black tracking-wider whitespace-nowrap">{st.label}</span>
                                                    <span className={`material-symbols-outlined text-[14px] mr-1 transition-all ${statusMenuId === shp.id ? 'rotate-180' : 'opacity-40'}`}>expand_more</span>
                                                </button>
                                                {statusMenuId === shp.id && (
                                                    <div ref={statusMenuRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-stone/15 shadow-2xl rounded-xl py-1 w-52 animate-in fade-in zoom-in-95"
                                                        onClick={(e) => e.stopPropagation()}>
                                                        {SHIPMENT_STATUSES.map(s => (
                                                            <button key={s.code} onClick={() => handleStatusUpdate(shp.id, s.code)}
                                                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-bold transition-all hover:bg-stone/5 ${shp.shipment_status === s.code ? 'bg-primary/5 text-primary' : 'text-stone-700'}`}>
                                                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }}></div>
                                                                <span className="truncate">{s.label}</span>
                                                                {shp.shipment_status === s.code && <span className="material-symbols-outlined text-[16px] text-primary ml-auto">check</span>}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        );

                                        if (col.id === 'cod_amount') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-right font-black text-brick text-[13px] tracking-tight">{fmtMoney(shp.cod_amount)}</td>
                                        );

                                        if (col.id === 'shipping_cost') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-right text-[13px] text-stone-600 font-bold">{fmtMoney(shp.shipping_cost)}</td>
                                        );

                                        if (col.id === 'actual_received_amount') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-right font-black text-primary text-[13px]">{fmtMoney(shp.actual_received_amount)}</td>
                                        );

                                        if (col.id === 'reconciliation_status') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-center"><StatusBadge code={shp.reconciliation_status} list={RECONCILIATION_STATUSES} /></td>
                                        );

                                        if (col.id === 'created_at') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-stone text-[13px]">
                                                <div className="flex flex-col"><span>{fmtDate(shp.created_at)}</span></div>
                                            </td>
                                        );

                                        if (col.id === 'actions') return (
                                            <td key={col.id} style={cellStyle} className="px-3 py-2.5 border border-stone/20 text-right sticky right-0 bg-white group-hover:bg-gold/5 transition-all">
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all text-stone/30">
                                                    <button onClick={(e) => { e.stopPropagation(); openDetail(shp.id); }} className="hover:text-primary transition-colors p-1" title="Chi tiết">
                                                        <span className="material-symbols-outlined text-base">visibility</span>
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); handleCopy(shp.shipment_number, e); }} className="hover:text-gold transition-colors p-1" title="Copy mã VĐ">
                                                        <span className="material-symbols-outlined text-base">content_copy</span>
                                                    </button>
                                                    {shp.tracking_number && (
                                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(shp.tracking_number, e); }} className="hover:text-gold transition-colors p-1" title="Copy tracking">
                                                            <span className="material-symbols-outlined text-base">qr_code_2</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        );

                                        return <td key={col.id} className="border border-stone/20"></td>;
                                    })}
                                </tr>
                            );
                        })}
                        {!loading && shipments.length === 0 && (
                            <tr><td colSpan={renderedColumns.length + 1} className="py-20 text-center italic text-stone/30 text-xs tracking-widest uppercase">Không tìm thấy vận đơn nào...</td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="13" className="py-20 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div></td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex-none mt-4 pt-4 border-t-2 border-primary/20 flex flex-col sm:flex-row justify-between items-center text-[13px] text-stone">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="font-bold whitespace-nowrap hidden lg:block">Hiển thị</span>
                        <select className="bg-white border border-stone/20 rounded px-2 py-1.5 focus:outline-none focus:border-primary cursor-pointer font-bold text-primary"
                            value={pagination.per_page} onChange={(e) => { setPagination(p => ({ ...p, per_page: parseInt(e.target.value) })); fetchShipments(1); }}>
                            <option value="20">20</option><option value="50">50</option><option value="100">100</option>
                        </select>
                    </div>
                    <p className="hidden sm:block text-stone/80">
                        Tổng <span className="font-bold text-primary">{pagination.total}</span> vận đơn
                    </p>
                </div>
                <div className="scale-90 origin-right">
                    <Pagination pagination={pagination} onPageChange={(page) => fetchShipments(page)} />
                </div>
            </div>

            {/* ── Detail Drawer with Tabs (Phase 2+3) ── */}
            {(detailShipment || detailLoading) && (
                <div className="fixed inset-0 z-[9999] flex">
                    <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={() => setDetailShipment(null)}></div>
                    <div className="w-full max-w-[660px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-stone/20">
                        {detailLoading ? (
                            <div className="flex-1 flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div></div>
                        ) : detailShipment && (() => {
                            const warnings = getRiskWarnings(detailShipment);
                            const TABS = [
                                { id: 'overview', label: 'Tổng quan', icon: 'info' },
                                { id: 'tracking', label: 'Tracking', icon: 'timeline' },
                                { id: 'reconciliation', label: 'Đối soát', icon: 'account_balance' },
                                { id: 'notes', label: 'Ghi chú', icon: 'sticky_note_2' },
                                { id: 'logs', label: 'Log', icon: 'history' },
                            ];
                            return (
                                <>
                                    {/* Drawer Header */}
                                    <div className="flex-none p-5 border-b border-stone/10 bg-[#fcfcfa]">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] mb-1">Chi tiết vận đơn</p>
                                                <h2 className="text-xl font-black text-primary tracking-tight">{detailShipment.shipment_number}</h2>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <StatusBadge code={detailShipment.shipment_status} list={SHIPMENT_STATUSES} />
                                                    <StatusBadge code={detailShipment.reconciliation_status} list={RECONCILIATION_STATUSES} />
                                                    {detailShipment.carrier_name && <span className="text-[11px] font-bold text-stone/50 border border-stone/10 px-2 py-0.5 rounded-md">{detailShipment.carrier_name}</span>}
                                                </div>
                                            </div>
                                            <button onClick={() => setDetailShipment(null)} className="size-9 rounded-full hover:bg-stone/5 flex items-center justify-center text-stone/40 hover:text-stone-800">
                                                <span className="material-symbols-outlined text-[22px]">close</span>
                                            </button>
                                        </div>
                                        {/* Risk Warnings */}
                                        {warnings.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mb-3">
                                                {warnings.map((w, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider animate-pulse border"
                                                        style={{ backgroundColor: `${w.color}12`, color: w.color, borderColor: `${w.color}30` }}>
                                                        <span className="material-symbols-outlined text-[13px]">{w.icon}</span>{w.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {/* Tabs */}
                                        <div className="flex gap-1 bg-stone/5 p-1 rounded-lg">
                                            {TABS.map(tab => (
                                                <button key={tab.id} onClick={() => setDrawerTab(tab.id)}
                                                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-[11px] font-bold transition-all ${drawerTab === tab.id ? 'bg-white text-primary shadow-sm border border-stone/10' : 'text-stone/50 hover:text-stone-700 hover:bg-white/50'}`}>
                                                    <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
                                                    <span className="hidden sm:inline">{tab.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Drawer Body — Tab Content */}
                                    <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">

                                        {/* TAB: Overview */}
                                        {drawerTab === 'overview' && (
                                            <>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {[
                                                        ['Mã đơn hàng', detailShipment.order_code || detailShipment.order?.order_number],
                                                        ['Hãng vận chuyển', detailShipment.carrier_name],
                                                        ['Tracking', detailShipment.tracking_number],
                                                        ['Kênh tạo', ({ manual: 'Thủ công', api: 'API', import: 'Import' })[detailShipment.channel] || detailShipment.channel],
                                                        ['Người nhận', detailShipment.customer_name],
                                                        ['SĐT', detailShipment.customer_phone],
                                                        ['Địa chỉ', detailShipment.customer_address],
                                                        ['Khu vực', [detailShipment.customer_ward, detailShipment.customer_district, detailShipment.customer_province].filter(Boolean).join(', ')],
                                                        ['Số lần giao', `${detailShipment.attempt_delivery_count || 0} lần`],
                                                        ['Ưu tiên', ({ low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' })[detailShipment.priority_level] || 'Bình thường'],
                                                    ].map(([label, val], i) => (
                                                        <div key={i} className="space-y-0.5">
                                                            <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest">{label}</p>
                                                            <p className="text-[14px] font-bold text-primary truncate">{val || '-'}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                                {detailShipment.failed_reason && (
                                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                                        <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Lý do giao thất bại</p>
                                                        <p className="text-[13px] font-bold text-red-600">{detailShipment.failed_reason}</p>
                                                    </div>
                                                )}
                                                <div className="bg-stone/5 border border-stone/10 rounded-lg p-4">
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Tài chính</p>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        {[
                                                            ['COD', detailShipment.cod_amount, 'text-brick'],
                                                            ['Phí ship', detailShipment.shipping_cost, 'text-stone-600'],
                                                            ['Phí DV', detailShipment.service_fee, 'text-stone-600'],
                                                            ['Phí hoàn', detailShipment.return_fee, 'text-orange-500'],
                                                            ['Bảo hiểm', detailShipment.insurance_fee, 'text-stone-600'],
                                                            ['Thực nhận', detailShipment.actual_received_amount, 'text-primary'],
                                                        ].map(([label, val, cls], i) => (
                                                            <div key={i}>
                                                                <p className="text-[10px] font-bold text-stone/40 uppercase">{label}</p>
                                                                <p className={`text-[15px] font-black ${cls}`}>{fmtMoney(val)}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                {/* Carrier sync info (Phase 3) */}
                                                <div className="bg-stone/5 border border-stone/10 rounded-lg p-4">
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Tích hợp vận chuyển</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div><p className="text-[10px] font-bold text-stone/40">Tracking hãng VC</p><p className="text-[13px] font-bold text-primary">{detailShipment.carrier_tracking_code || '-'}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Đồng bộ lần cuối</p><p className="text-[13px] font-bold text-primary">{detailShipment.last_synced_at ? fmtDateTime(detailShipment.last_synced_at) : 'Chưa sync'}</p></div>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* TAB: Tracking Timeline (Phase 2) */}
                                        {drawerTab === 'tracking' && (
                                            <>
                                                <div className="bg-stone/5 border border-stone/10 rounded-lg p-4 mb-4">
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Dòng thời gian vận đơn</p>
                                                    <div className="relative pl-6">
                                                        {/* Main vertical line */}
                                                        <div className="absolute left-[9px] top-2 bottom-2 w-[2px] bg-stone/10"></div>
                                                        {[
                                                            { label: 'Tạo vận đơn', time: detailShipment.created_at, icon: 'add_circle', status: 'created' },
                                                            { label: 'Chờ lấy hàng', time: detailShipment.created_at, icon: 'schedule', status: 'waiting_pickup' },
                                                            { label: 'Đã lấy hàng', time: detailShipment.picked_at, icon: 'inventory', status: 'picked_up' },
                                                            { label: 'Xuất kho', time: detailShipment.shipped_at, icon: 'flight_takeoff', status: 'shipped' },
                                                            { label: 'Đang trung chuyển', time: detailShipment.in_transit_at, icon: 'local_shipping', status: 'in_transit' },
                                                            { label: 'Đang giao hàng', time: detailShipment.out_for_delivery_at, icon: 'delivery_dining', status: 'out_for_delivery' },
                                                            { label: 'Giao thành công', time: detailShipment.delivered_at, icon: 'check_circle', status: 'delivered' },
                                                            { label: 'Giao thất bại', time: detailShipment.delivery_failed_at, icon: 'error', status: 'delivery_failed' },
                                                            { label: 'Đang hoàn', time: detailShipment.returning_at, icon: 'undo', status: 'returning' },
                                                            { label: 'Đã hoàn', time: detailShipment.returned_at, icon: 'assignment_return', status: 'returned' },
                                                            { label: 'Đối soát COD', time: detailShipment.reconciled_at, icon: 'account_balance', status: 'reconciled' },
                                                        ].map(({ label, time, icon, status }, i) => {
                                                            const st = getStatus(status, SHIPMENT_STATUSES);
                                                            const isActive = !!time;
                                                            const isCurrent = detailShipment.shipment_status === status;
                                                            return (
                                                                <div key={i} className={`relative flex items-start gap-3 pb-5 ${isActive ? '' : 'opacity-30'}`}>
                                                                    <div className={`absolute left-[-15px] size-5 rounded-full flex items-center justify-center border-2 z-10 ${isCurrent ? 'border-primary bg-primary text-white scale-125 shadow-lg shadow-primary/30' : isActive ? 'border-green-500 bg-green-500 text-white' : 'border-stone/20 bg-white text-stone/30'}`}>
                                                                        <span className="material-symbols-outlined text-[11px]">{isActive ? 'check' : ''}</span>
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="material-symbols-outlined text-[16px]" style={{ color: isActive ? st.color : '#d1d5db' }}>{icon}</span>
                                                                            <span className={`text-[13px] font-bold ${isCurrent ? 'text-primary' : isActive ? 'text-stone-700' : 'text-stone/40'}`}>{label}</span>
                                                                        </div>
                                                                        {isActive && <p className="text-[11px] text-stone/50 font-mono mt-0.5 ml-6">{fmtDateTime(time)}</p>}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                {/* Tracking from carrier API (Phase 3) */}
                                                {detailShipment.tracking_histories?.length > 0 && (
                                                    <div className="bg-stone/5 border border-stone/10 rounded-lg p-4">
                                                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Tracking từ hãng vận chuyển</p>
                                                        <div className="space-y-2">
                                                            {detailShipment.tracking_histories.map((h, i) => (
                                                                <div key={i} className="flex items-start gap-3 p-2 bg-white border border-stone/10 rounded-md">
                                                                    <div className="size-2 rounded-full bg-primary mt-1.5 shrink-0"></div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-[12px] font-bold text-primary">{h.description || h.status}</p>
                                                                        <div className="flex items-center gap-2 mt-0.5">
                                                                            <span className="text-[10px] text-stone/40 font-mono">{fmtDateTime(h.event_time)}</span>
                                                                            {h.location && <span className="text-[10px] text-stone/40">• {h.location}</span>}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {(!detailShipment.tracking_histories || detailShipment.tracking_histories.length === 0) && (
                                                    <div className="text-center py-8">
                                                        <span className="material-symbols-outlined text-[40px] text-stone/15">cloud_off</span>
                                                        <p className="text-[12px] text-stone/30 font-bold mt-2">Chưa có dữ liệu tracking từ hãng vận chuyển</p>
                                                        <p className="text-[10px] text-stone/20 mt-1">Tích hợp API sẽ tự động đồng bộ khi được kích hoạt</p>
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* TAB: Reconciliation (Phase 2) */}
                                        {drawerTab === 'reconciliation' && (
                                            <>
                                                <div className="bg-stone/5 border border-stone/10 rounded-lg p-4">
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Thông tin đối soát</p>
                                                    <div className="grid grid-cols-2 gap-4 mb-4">
                                                        <div><p className="text-[10px] font-bold text-stone/40">COD dự kiến</p><p className="text-[18px] font-black text-brick">{fmtMoney(detailShipment.cod_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Thực nhận dự kiến</p><p className="text-[18px] font-black text-primary">{fmtMoney(detailShipment.actual_received_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Đã đối soát</p><p className="text-[18px] font-black text-green-600">{fmtMoney(detailShipment.reconciled_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Chênh lệch</p><p className={`text-[18px] font-black ${detailShipment.reconciliation_diff_amount != 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtMoney(detailShipment.reconciliation_diff_amount)}</p></div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <StatusBadge code={detailShipment.reconciliation_status} list={RECONCILIATION_STATUSES} />
                                                        {detailShipment.reconciled_at && <span className="text-[10px] text-stone/40">vào {fmtDateTime(detailShipment.reconciled_at)}</span>}
                                                    </div>
                                                </div>
                                                {/* Reconcile Form */}
                                                {detailShipment.shipment_status === 'delivered' && (
                                                    <div className="bg-white border-2 border-dashed border-gold/30 rounded-lg p-4">
                                                        <p className="text-[10px] font-black text-gold uppercase tracking-widest mb-3">Đối soát COD</p>
                                                        <div className="space-y-3">
                                                            <div>
                                                                <label className="text-[11px] font-bold text-stone/60 block mb-1">Số tiền đối soát thực tế (₫)</label>
                                                                <input type="number" value={reconcileForm.amount} onChange={(e) => setReconcileForm(f => ({ ...f, amount: e.target.value }))}
                                                                    placeholder={`Dự kiến: ${detailShipment.actual_received_amount}`}
                                                                    className="w-full bg-stone/5 border border-stone/10 px-3 py-2.5 text-[14px] font-bold rounded-md focus:outline-none focus:border-primary" />
                                                            </div>
                                                            <div>
                                                                <label className="text-[11px] font-bold text-stone/60 block mb-1">Ghi chú đối soát</label>
                                                                <input type="text" value={reconcileForm.note} onChange={(e) => setReconcileForm(f => ({ ...f, note: e.target.value }))}
                                                                    placeholder="Ghi chú..."
                                                                    className="w-full bg-stone/5 border border-stone/10 px-3 py-2 text-[13px] rounded-md focus:outline-none focus:border-primary" />
                                                            </div>
                                                            <button onClick={handleReconcile} disabled={!reconcileForm.amount || reconcileLoading}
                                                                className="w-full bg-primary text-white py-2.5 rounded-md text-[13px] font-bold hover:bg-umber disabled:opacity-30 transition-all flex items-center justify-center gap-2">
                                                                {reconcileLoading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <span className="material-symbols-outlined text-[18px]">account_balance</span>}
                                                                Xác nhận đối soát
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Reconciliation History */}
                                                {detailShipment.reconciliations?.length > 0 && (
                                                    <div>
                                                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Lịch sử đối soát</p>
                                                        {detailShipment.reconciliations.map((r, i) => (
                                                            <div key={i} className={`p-3 border rounded-md mb-2 ${r.status === 'mismatch' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                                                                <div className="flex justify-between">
                                                                    <span className="text-[12px] font-bold">{r.status === 'mismatch' ? '⚠️ Lệch tiền' : '✅ Khớp'}</span>
                                                                    <span className="text-[10px] text-stone/40">{fmtDateTime(r.reconciled_at)}</span>
                                                                </div>
                                                                <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                                                                    <div><span className="text-stone/40">Thực nhận:</span> <span className="font-bold">{fmtMoney(r.actual_received_amount)}</span></div>
                                                                    <div><span className="text-stone/40">Dự kiến:</span> <span className="font-bold">{fmtMoney(r.system_expected_amount)}</span></div>
                                                                    <div><span className="text-stone/40">Lệch:</span> <span className={`font-bold ${r.diff_amount != 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtMoney(r.diff_amount)}</span></div>
                                                                </div>
                                                                {r.note && <p className="text-[11px] text-stone/50 mt-1 italic">{r.note}</p>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* TAB: Notes */}
                                        {drawerTab === 'notes' && (
                                            <>
                                                {detailShipment.notes?.length > 0 ? detailShipment.notes.map((n, i) => (
                                                    <div key={i} className={`p-3 border rounded-md ${n.note_type === 'warning' ? 'bg-red-50 border-red-200' : 'bg-gold/5 border-gold/10'}`}>
                                                        {n.note_type === 'warning' && <span className="text-[9px] font-black text-red-400 uppercase tracking-widest">⚠️ Cảnh báo</span>}
                                                        <p className="text-[13px] text-primary font-bold">{n.content}</p>
                                                        <p className="text-[10px] text-stone/40 mt-1">{n.created_by_user?.name || 'Hệ thống'} • {fmtDateTime(n.created_at)}</p>
                                                    </div>
                                                )) : (
                                                    <div className="text-center py-8">
                                                        <span className="material-symbols-outlined text-[40px] text-stone/15">sticky_note_2</span>
                                                        <p className="text-[12px] text-stone/30 font-bold mt-2">Chưa có ghi chú nào</p>
                                                    </div>
                                                )}
                                                <div className="flex gap-2 mt-3 sticky bottom-0 bg-white py-2">
                                                    <input type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Thêm ghi chú..."
                                                        className="flex-1 bg-stone/5 border border-stone/10 px-3 py-2.5 text-[13px] rounded-md focus:outline-none focus:border-primary"
                                                        onKeyDown={(e) => e.key === 'Enter' && handleAddNote()} />
                                                    <button onClick={handleAddNote} disabled={!noteText.trim()}
                                                        className="bg-primary text-white px-4 py-2.5 rounded-md text-[12px] font-bold hover:bg-umber disabled:opacity-30 transition-all">
                                                        Gửi
                                                    </button>
                                                </div>
                                            </>
                                        )}

                                        {/* TAB: Logs (Phase 2+3) */}
                                        {drawerTab === 'logs' && (
                                            <>
                                                {/* Status change logs */}
                                                <div>
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">Lịch sử thay đổi trạng thái</p>
                                                    {detailShipment.status_logs?.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {detailShipment.status_logs.map((log, i) => (
                                                                <div key={i} className="flex items-center gap-2 text-[12px] p-2.5 bg-white border border-stone/10 rounded-md hover:bg-stone/5 transition-colors">
                                                                    <span className="text-stone/30 font-mono shrink-0 text-[10px]">{fmtDateTime(log.created_at)}</span>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="font-bold text-stone/40">{log.from_status ? getStatus(log.from_status, SHIPMENT_STATUSES).label : '—'}</span>
                                                                        <span className="material-symbols-outlined text-[14px] text-gold">arrow_forward</span>
                                                                        <span className="font-black" style={{ color: getStatus(log.to_status, SHIPMENT_STATUSES).color }}>{getStatus(log.to_status, SHIPMENT_STATUSES).label}</span>
                                                                    </div>
                                                                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                                                        <span className="text-[9px] font-bold text-stone/20 uppercase border border-stone/10 px-1.5 py-0.5 rounded">{log.change_source || 'manual'}</span>
                                                                        {log.changed_by_user && <span className="text-stone/30 text-[10px]">{log.changed_by_user.name}</span>}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="text-center text-stone/30 text-[12px] py-4">Chưa có log nào</p>
                                                    )}
                                                </div>
                                                {/* Webhook / API sync log (Phase 3) */}
                                                <div className="bg-stone/5 border border-stone/10 rounded-lg p-4">
                                                    <p className="text-[10px] font-black text-stone/40 uppercase tracking-widest mb-3">API / Webhook Sync</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div><p className="text-[10px] font-bold text-stone/40">Carrier Code</p><p className="text-[13px] font-bold text-primary font-mono">{detailShipment.carrier_code || '-'}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Last Synced</p><p className="text-[13px] font-bold text-primary">{detailShipment.last_synced_at ? fmtDateTime(detailShipment.last_synced_at) : 'N/A'}</p></div>
                                                    </div>
                                                    {detailShipment.raw_tracking_payload && (
                                                        <details className="mt-3">
                                                            <summary className="text-[10px] font-bold text-stone/40 cursor-pointer hover:text-primary">Raw Payload</summary>
                                                            <pre className="mt-2 p-2 bg-white border border-stone/10 rounded text-[10px] font-mono text-stone/60 overflow-x-auto max-h-40">{JSON.stringify(detailShipment.raw_tracking_payload, null, 2)}</pre>
                                                        </details>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShipmentList;
