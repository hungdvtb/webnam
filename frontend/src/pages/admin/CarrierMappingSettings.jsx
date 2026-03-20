import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { motion, Reorder, AnimatePresence } from 'framer-motion';

/* ── Trạng thái vận chuyển nội bộ ── */
const SHIPMENT_STATUSES = [
    { code: 'created', label: 'Mới tạo', color: '#64748b' },
    { code: 'waiting_pickup', label: 'Chờ lấy hàng', color: '#d97706' },
    { code: 'picked_up', label: 'Đã lấy hàng', color: '#7c3aed' },
    { code: 'shipped', label: 'Đã gửi', color: '#4f46e5' },
    { code: 'in_transit', label: 'Đang trung chuyển', color: '#2563eb' },
    { code: 'out_for_delivery', label: 'Đang giao', color: '#0284c7' },
    { code: 'delivered', label: 'Giao thành công', color: '#16a34a' },
    { code: 'delivery_failed', label: 'Giao thất bại', color: '#dc2626' },
    { code: 'returning', label: 'Đang hoàn', color: '#ea580c' },
    { code: 'returned', label: 'Đã hoàn', color: '#57534e' },
    { code: 'canceled', label: 'Đã hủy', color: '#b91c1c' },
];

const CARRIER_ICONS = {
    ghn: '🟠', ghtk: '🟢', viettel_post: '🔴', jt: '🟡', shopee_express: '🟤',
};

const CarrierMappingSettings = ({ embedded = false }) => {
    const [allMappings, setAllMappings] = useState([]);
    const [carriers, setCarriers] = useState([]);
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [discoveredStatuses, setDiscoveredStatuses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editData, setEditData] = useState({});
    const [showAddForm, setShowAddForm] = useState(false);
    const [showManagementModal, setShowManagementModal] = useState(false);
    const [isSavingSort, setIsSavingSort] = useState(false);
    
    /* ── State cho form thêm mới ── */
    const [newMapping, setNewMapping] = useState({
        carrier_code: '', carrier_raw_status: '', internal_shipment_status: '',
        mapped_order_status: '', is_terminal: false, sort_order: 0, is_active: true, description: ''
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/carrier-mappings');
            setAllMappings(res.data.mappings || []);
            setCarriers(res.data.carriers || []);
            setOrderStatuses(res.data.order_statuses || []);
            setDiscoveredStatuses(res.data.discovered_statuses || []);
            
            const fetchedCarriers = res.data.carriers || [];
            const visibleCarriers = fetchedCarriers.filter(c => c.is_visible);
            
            if (!activeTab || !visibleCarriers.find(c => c.code === activeTab)) {
                if (visibleCarriers.length > 0) {
                    setActiveTab(visibleCarriers[0].code);
                } else if (fetchedCarriers.length > 0) {
                    setActiveTab(fetchedCarriers[0].code);
                }
            }
        } catch (error) {
            console.error('Error fetching data:', error);
        }
        setLoading(false);
    }, [activeTab]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const visibleCarriers = useMemo(() => carriers.filter(c => c.is_visible), [carriers]);
    
    const filteredMappings = useMemo(() => {
        if (!activeTab) return [];
        return allMappings.filter(m => m.carrier_code === activeTab)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }, [allMappings, activeTab]);

    /* ── Xử lý sự kiện ── */
    const handleCarrierReorder = async (newOrder) => {
        setCarriers(newOrder);
        setIsSavingSort(true);
        try {
            await api.post('/carrier-mappings/carriers/reorder', {
                order: newOrder.map(c => c.code)
            });
        } catch (error) {
            console.error('Error saving order:', error);
        }
        setIsSavingSort(false);
    };

    const handleUpdateCarrier = async (code, data) => {
        try {
            const res = await api.put(`/carrier-mappings/carriers/${code}`, data);
            setCarriers(prev => prev.map(c => c.code === code ? { ...c, ...res.data } : c));
            if (activeTab === code && data.is_visible === false) {
                const remainingVisible = carriers.filter(c => c.code !== code && c.is_visible);
                if (remainingVisible.length > 0) setActiveTab(remainingVisible[0].code);
            }
        } catch (error) {
            console.error('Error updating carrier:', error);
        }
    };

    const handleSaveMapping = async (id, overrideData = null) => {
        try {
            const data = overrideData || editData;
            await api.put(`/carrier-mappings/${id}`, data);
            setEditingId(null);
            fetchData();
        } catch (err) {
            alert(err.response?.data?.message || 'Lỗi khi cập nhật');
        }
    };

    const handleDeleteMapping = async (id) => {
        if (!window.confirm('Xóa quy tắc mapping này?')) return;
        try {
            await api.delete(`/carrier-mappings/${id}`);
            fetchData();
        } catch {
            alert('Lỗi khi xóa');
        }
    };

    const handleAddMappingFromDiscovery = async (carrierCode, rawStatus) => {
        setActiveTab(carrierCode);
        setShowAddForm(true);
        setNewMapping(v => ({ ...v, carrier_raw_status: rawStatus }));
        setShowManagementModal(false);
        document.getElementById('add-mapping-form')?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleAddMapping = async () => {
        const data = { ...newMapping, carrier_code: activeTab };
        if (!data.carrier_raw_status || !data.internal_shipment_status) {
            alert('Vui lòng điền đầy đủ: Trạng thái từ hãng và Trạng thái vận chuyển');
            return;
        }
        try {
            await api.post('/carrier-mappings', data);
            setShowAddForm(false);
            setNewMapping({ 
                carrier_code: '', carrier_raw_status: '', internal_shipment_status: '', 
                mapped_order_status: '', is_terminal: false, sort_order: 0, is_active: true, description: '' 
            });
            fetchData();
        } catch (err) {
            alert(err.response?.data?.message || 'Lỗi khi thêm');
        }
    };

    if (loading && carriers.length === 0) return (
        <div className={`${embedded ? 'flex min-h-[320px] items-center justify-center rounded-2xl bg-[#fcfcfa]' : 'absolute inset-0 flex items-center justify-center bg-[#fcfcfa] z-20'}`}>
            <div className="text-center space-y-4">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-[11px] font-bold text-stone-600 uppercase tracking-widest">Đang tải dữ liệu...</p>
            </div>
        </div>
    );

    return (
        <div className={`${embedded ? 'flex min-h-full flex-col bg-transparent animate-fade-in w-full' : 'absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-4 z-10 w-full h-full overflow-hidden'}`}>
            {/* ═══ Header ═══ */}
            <div className="flex items-center justify-between mb-4 shrink-0 px-2">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-2xl">sync_alt</span>
                        <h1 className="text-xl font-display font-bold text-stone-900 border-none">Mapping Trạng Thái</h1>
                    </div>
                    <p className="text-[11px] text-stone-600 font-bold uppercase tracking-wide mt-0.5">Cấu hình đồng bộ trạng thái từ hãng vận chuyển sang nội bộ</p>
                </div>

                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setShowManagementModal(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white text-stone-800 border border-stone-300 rounded-lg text-xs font-bold hover:bg-stone-50 transition-all shadow-sm"
                    >
                        <span className="material-symbols-outlined text-[16px]">settings_suggest</span>
                        HÃNG VẬN CHUYỂN
                    </button>
                    <button 
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-xs font-black hover:brightness-95 transition-all shadow-md active:scale-95"
                    >
                        <span className="material-symbols-outlined text-[16px]">add_circle</span>
                        THÊM QUY TẮC
                    </button>
                </div>
            </div>

            {/* ═══ Chọn Đơn Vị Vận Chuyển ═══ */}
            <div className="mb-4 shrink-0 px-2">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-[9px] font-bold text-stone-700 uppercase tracking-widest flex items-center gap-2">
                        CHỌN ĐƠN VỊ VẬN CHUYỂN
                        {isSavingSort && <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse"></span>}
                    </h2>
                </div>
                
                <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
                    {visibleCarriers.map(carrier => {
                        const isActive = activeTab === carrier.code;
                        const count = carrier.mappings_count || 0;
                        const hasDiscovery = carrier.unmapped_count > 0;

                        return (
                            <button
                                key={carrier.code}
                                onClick={() => setActiveTab(carrier.code)}
                                className={`flex items-center gap-2.5 px-4 py-2 rounded-xl text-[12px] font-bold border transition-all min-w-[130px] relative ${
                                    isActive
                                        ? 'bg-primary/5 border-primary text-primary shadow-sm'
                                        : 'bg-white border-stone-200 text-stone-700 hover:border-stone-400'
                                }`}
                            >
                                <span className="text-base">{CARRIER_ICONS[carrier.code] || '📦'}</span>
                                <span className="truncate flex-1 text-left">{carrier.name}</span>
                                <span className={`text-[9px] min-w-[18px] h-4.5 flex items-center justify-center rounded-md font-black ${isActive ? 'bg-primary/10 text-primary' : 'bg-stone-100 text-stone-500'}`}>
                                    {count}
                                </span>
                                {hasDiscovery && (
                                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-white"></div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ═══ Bảng Danh Sách Mapping ═══ */}
            <div className="flex-1 min-h-0 bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                {/* Header hãng đang chọn */}
                <div className="px-6 py-3 border-b border-stone-100 bg-[#f9f9f8] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white border border-stone-200 shadow-sm flex items-center justify-center text-lg">
                            {CARRIER_ICONS[activeTab] || '📦'}
                        </div>
                        <div>
                            <h3 className="font-bold text-[14px] text-stone-900 uppercase tracking-tight">
                                {carriers.find(c => c.code === activeTab)?.name}
                            </h3>
                            <p className="text-[9px] font-bold text-stone-500 uppercase tracking-widest">Quy tắc mapping hiện tại</p>
                        </div>
                    </div>
                    {filteredMappings.length > 0 && (
                         <span className="text-[10px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded uppercase tracking-tighter">
                            {filteredMappings.length} QUY TẮC
                         </span>
                    )}
                </div>

                {/* Nội dung bảng */}
                <div className="flex-1 overflow-auto custom-scrollbar">
                    {/* Form thêm nhanh */}
                    <AnimatePresence>
                        {showAddForm && (
                            <motion.div 
                                id="add-mapping-form"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden border-b border-stone-200 bg-primary/[0.02]"
                            >
                                <div className="p-5 grid grid-cols-12 gap-4 items-end">
                                    <div className="col-span-3">
                                        <label className="text-[9px] font-bold text-stone-800 uppercase tracking-widest block mb-1.5 px-0.5">TRẠNG THÁI TỪ HÃNG (RAW)</label>
                                        <input 
                                            type="text" 
                                            value={newMapping.carrier_raw_status}
                                            onChange={e => setNewMapping(v => ({ ...v, carrier_raw_status: e.target.value }))}
                                            placeholder="Ví dụ: delivering, returned..."
                                            className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-[13px] font-medium focus:border-primary outline-none shadow-sm"
                                        />
                                    </div>
                                    <div className="col-span-3">
                                        <label className="text-[9px] font-bold text-stone-800 uppercase tracking-widest block mb-1.5 px-0.5">TRẠNG THÁI VẬN ĐƠN</label>
                                        <select 
                                            value={newMapping.internal_shipment_status}
                                            onChange={e => setNewMapping(v => ({ ...v, internal_shipment_status: e.target.value }))}
                                            className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-[13px] font-medium focus:border-primary outline-none shadow-sm"
                                        >
                                            <option value="">— Chọn trạng thái —</option>
                                            {SHIPMENT_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <label className="text-[9px] font-bold text-stone-800 uppercase tracking-widest block mb-1.5 px-0.5">ĐỒNG BỘ ĐƠN HÀNG</label>
                                        <select 
                                            value={newMapping.mapped_order_status}
                                            onChange={e => setNewMapping(v => ({ ...v, mapped_order_status: e.target.value }))}
                                            className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-[13px] font-medium focus:border-primary outline-none shadow-sm"
                                        >
                                            <option value="">— Không thay đổi —</option>
                                            {orderStatuses.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="col-span-3 flex justify-end gap-2 pb-0.5">
                                        <button onClick={() => setShowAddForm(false)} className="px-3 py-2 text-stone-600 hover:text-stone-900 text-[10px] font-bold uppercase tracking-widest transition-colors">HỦY</button>
                                        <button onClick={handleAddMapping} className="px-4 py-2 bg-primary text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md">LƯU QUY TẮC</button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {filteredMappings.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center opacity-40 select-none">
                            <span className="material-symbols-outlined text-6xl mb-2 text-stone-300">account_tree</span>
                            <p className="font-bold text-lg text-stone-700 italic">Chưa có mapping quy tắc</p>
                        </div>
                    ) : (
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-[10px] font-bold text-stone-800 uppercase tracking-wider border-b border-stone-200 sticky top-0 bg-white/95 backdrop-blur-md z-10">
                                    <th className="pl-6 py-3 text-left w-12 text-stone-500">STT</th>
                                    <th className="px-4 py-3 text-left">TRẠNG THÁI TỪ HÃNG</th>
                                    <th className="px-4 py-3 text-left">TRẠNG THÁI VẬN ĐƠN</th>
                                    <th className="px-4 py-3 text-left">ĐỒNG BỘ ĐƠN HÀNG</th>
                                    <th className="px-4 py-3 text-center w-24">HOẠT ĐỘNG</th>
                                    <th className="px-4 py-3 text-center w-24">KẾT THÚC</th>
                                    <th className="pr-6 py-3 text-right w-24">THAO TÁC</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredMappings.map((m, idx) => {
                                    const isEditing = editingId === m.id;
                                    const currentShipmentStatus = SHIPMENT_STATUSES.find(s => s.code === (isEditing ? editData.internal_shipment_status ?? m.internal_shipment_status : m.internal_shipment_status));
                                    const currentOrderStatus = orderStatuses.find(s => s.code === (isEditing ? editData.mapped_order_status ?? m.mapped_order_status : m.mapped_order_status));

                                    return (
                                        <tr key={m.id} className={`group border-b border-stone-100 transition-all ${!m.is_active ? 'bg-stone-50 opacity-60' : 'hover:bg-primary/[0.02]'}`}>
                                            <td className="pl-6 py-4 font-mono text-[11px] text-stone-400">{idx + 1}</td>

                                            <td className="px-4 py-4">
                                                {isEditing ? (
                                                    <input 
                                                        type="text" 
                                                        value={editData.carrier_raw_status ?? m.carrier_raw_status}
                                                        onChange={e => setEditData(d => ({ ...d, carrier_raw_status: e.target.value }))}
                                                        className="w-full bg-white border border-stone-400 rounded-lg px-3 py-1.5 text-[13px] font-bold outline-none focus:ring-1 focus:ring-primary shadow-inner"
                                                    />
                                                ) : (
                                                    <div>
                                                        <span className="font-mono text-[12px] font-bold text-stone-800 bg-stone-100 px-2 py-1 rounded border border-stone-200">{m.carrier_raw_status}</span>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-4 py-4 font-bold">
                                                {isEditing ? (
                                                    <select 
                                                        value={editData.internal_shipment_status ?? m.internal_shipment_status}
                                                        onChange={e => setEditData(d => ({ ...d, internal_shipment_status: e.target.value }))}
                                                        className="w-full bg-white border border-stone-400 rounded-lg px-2 py-1.5 text-[13px] font-bold outline-none"
                                                    >
                                                        {SHIPMENT_STATUSES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentShipmentStatus?.color }}></span>
                                                        <span className="text-[13px] font-bold uppercase tracking-tighter" style={{ color: currentShipmentStatus?.color }}>
                                                            {currentShipmentStatus?.label}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-4 py-4">
                                                {isEditing ? (
                                                    <select 
                                                        value={editData.mapped_order_status ?? m.mapped_order_status ?? ''}
                                                        onChange={e => setEditData(d => ({ ...d, mapped_order_status: e.target.value }))}
                                                        className="w-full bg-white border border-stone-400 rounded-lg px-2 py-1.5 text-[13px] font-bold outline-none"
                                                    >
                                                        <option value="">— Không thay đổi —</option>
                                                        {orderStatuses.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                                                    </select>
                                                ) : (
                                                    m.mapped_order_status ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="px-2 py-1 rounded-md text-[10px] font-bold border uppercase tracking-tight" 
                                                                 style={{ borderColor: currentOrderStatus?.color + '50', color: currentOrderStatus?.color, backgroundColor: currentOrderStatus?.color + '10' }}>
                                                                {currentOrderStatus?.name}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-stone-400 tracking-tight uppercase italic">—</span>
                                                    )
                                                )}
                                            </td>

                                            <td className="px-4 py-4">
                                                <div className="flex justify-center">
                                                    <button 
                                                        onClick={() => !isEditing && handleSaveMapping(m.id, { is_active: !m.is_active })}
                                                        className={`w-9 h-4.5 rounded-full relative transition-all duration-300 ${m.is_active ? 'bg-green-600' : 'bg-stone-300'}`}
                                                    >
                                                        <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-300 ${m.is_active ? 'translate-x-4.5' : 'translate-x-0.5'}`}></div>
                                                    </button>
                                                </div>
                                            </td>

                                            <td className="px-4 py-4">
                                                <div className="flex justify-center">
                                                {isEditing ? (
                                                    <input 
                                                        type="checkbox" 
                                                        checked={editData.is_terminal ?? m.is_terminal}
                                                        onChange={e => setEditData(d => ({ ...d, is_terminal: e.target.checked }))}
                                                        className="w-4 h-4 accent-orange-600"
                                                    />
                                                ) : (
                                                    m.is_terminal ? (
                                                        <span className="material-symbols-outlined text-orange-600/80 text-lg">flag</span>
                                                    ) : null
                                                )}
                                                </div>
                                            </td>

                                            <td className="pr-6 py-4 text-right">
                                                {isEditing ? (
                                                    <div className="flex justify-end gap-1.5">
                                                        <button onClick={() => setEditingId(null)} className="p-1.5 text-stone-500 hover:text-stone-900 transition-colors" title="Hủy"><span className="material-symbols-outlined text-base">close</span></button>
                                                        <button onClick={() => handleSaveMapping(m.id)} className="p-1.5 bg-green-600 text-white rounded-md shadow hover:bg-green-700 transition-colors" title="Lưu"><span className="material-symbols-outlined text-base">check</span></button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setEditingId(m.id); setEditData(m); }}
                                                            className="p-1.5 text-stone-500 hover:text-primary transition-colors"
                                                            title="Sửa"
                                                        >
                                                            <span className="material-symbols-outlined text-base">edit</span>
                                                        </button>
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteMapping(m.id); }}
                                                            className="p-1.5 text-stone-400 hover:text-red-600 transition-colors"
                                                            title="Xóa"
                                                        >
                                                            <span className="material-symbols-outlined text-base">delete</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* ═══ Modal Quản Lý Hãng Vận Chuyển ═══ */}
            <CarrierManagementModal 
                show={showManagementModal} 
                onClose={() => { setShowManagementModal(false); fetchData(); }}
                carriers={carriers}
                onReorder={handleCarrierReorder}
                onUpdate={handleUpdateCarrier}
                discoveredStatuses={discoveredStatuses}
                onMapDiscovery={handleAddMappingFromDiscovery}
            />
            
            <style>{`
                .hide-scrollbar::-webkit-scrollbar { display: none; }
                .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
            `}</style>
        </div>
    );
};

/* ── COMPONENT: Modal quản lý hãng vận chuyển ── */
const CarrierManagementModal = ({ show, onClose, carriers, onReorder, onUpdate, discoveredStatuses, onMapDiscovery }) => {
    const [tab, setTab] = useState('carriers');

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/70 backdrop-blur-sm p-4 animate-fade-in">
            <motion.div 
                initial={{ scale: 0.98, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden border border-stone-200"
            >
                {/* Modal Header */}
                <div className="px-8 py-5 border-b border-stone-200 flex items-center justify-between shrink-0 bg-stone-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-xl">local_shipping</span>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-stone-900 uppercase">Cấu hình đơn vị vận chuyển</h2>
                            <p className="text-[10px] font-bold text-stone-600 uppercase tracking-widest mt-0.5">Quản lý các hãng vận chuyển và trạng thái mới phát hiện</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-stone-200 flex items-center justify-center text-stone-600 transition-colors">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {/* Sub-tabs */}
                <div className="px-8 flex items-center gap-6 border-b border-stone-100 bg-white shrink-0">
                    <button 
                        onClick={() => setTab('carriers')}
                        className={`text-[11px] font-black uppercase tracking-widest py-4 border-b-2 transition-all ${tab === 'carriers' ? 'border-primary text-primary' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
                    >
                        HÃNG VẬN CHUYỂN ({carriers.length})
                    </button>
                    <button 
                        onClick={() => setTab('discovery')}
                        className={`text-[11px] font-black uppercase tracking-widest py-4 border-b-2 transition-all flex items-center gap-2 ${tab === 'discovery' ? 'border-amber-600 text-amber-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
                    >
                        PHÁT HIỆN TỪ API
                        {discoveredStatuses.length > 0 && <span className="px-1.5 py-0.5 bg-amber-600 text-white text-[9px] rounded-md shadow-sm">{discoveredStatuses.length}</span>}
                    </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-auto custom-scrollbar p-8 bg-white">
                    {tab === 'carriers' ? (
                        <div className="border border-stone-200 rounded-2xl overflow-hidden shadow-sm">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="text-[10px] font-black text-stone-800 uppercase tracking-widest bg-stone-50 border-b border-stone-200 text-left">
                                        <th className="px-5 py-4 w-12 text-stone-500">STT</th>
                                        <th className="px-5 py-4">Tên Hãng</th>
                                        <th className="px-5 py-4">Mã Hãng</th>
                                        <th className="px-5 py-4 text-center">Số Quy Tắc</th>
                                        <th className="px-5 py-4 text-center">Trạng Thái API</th>
                                        <th className="px-5 py-4 text-center">Hiển Thị Tab</th>
                                        <th className="px-5 py-4 text-center">Hoạt Động</th>
                                        <th className="pr-8 py-4 text-right">Sắp Xếp</th>
                                    </tr>
                                </thead>
                                <Reorder.Group as="tbody" axis="y" values={carriers} onReorder={onReorder}>
                                    {carriers.map((c, i) => (
                                        <Reorder.Item 
                                            as="tr" 
                                            key={c.code} 
                                            value={c}
                                            className={`border-b border-stone-100 bg-white hover:bg-stone-50/50 transition-colors cursor-move ${!c.is_visible ? 'bg-stone-50/80 grayscale-[50%]' : ''}`}
                                        >
                                            <td className="px-5 py-4 text-stone-400 font-mono text-[11px]">{i + 1}</td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xl">{CARRIER_ICONS[c.code] || '📦'}</span>
                                                    <span className={`text-[13px] font-black ${!c.is_active ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{c.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4 font-mono text-[11px] text-stone-600 font-bold uppercase">{c.code}</td>
                                            <td className="px-5 py-4 text-center">
                                                <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-[11px] font-bold text-stone-700">{c.mappings_count || 0}</span>
                                            </td>
                                            <td className="px-5 py-4 text-center">
                                                {c.unmapped_count > 0 ? (
                                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded text-[11px] font-black">
                                                        {c.unmapped_count} mới
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-stone-300 uppercase font-black">OK</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex justify-center">
                                                    <button 
                                                        onClick={() => onUpdate(c.code, { is_visible: !c.is_visible })}
                                                        className={`w-9 h-4.5 rounded-full relative transition-all duration-300 ${c.is_visible ? 'bg-primary' : 'bg-stone-300'}`}
                                                    >
                                                        <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-300 ${c.is_visible ? 'translate-x-4.5' : 'translate-x-0.5'}`}></div>
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex justify-center">
                                                    <button 
                                                        onClick={() => onUpdate(c.code, { is_active: !c.is_active })}
                                                        className={`w-9 h-4.5 rounded-full relative transition-all duration-300 ${c.is_active ? 'bg-green-600' : 'bg-stone-300'}`}
                                                    >
                                                        <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-all duration-300 ${c.is_active ? 'translate-x-4.5' : 'translate-x-0.5'}`}></div>
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="pr-8 py-4 text-right">
                                                <span className="material-symbols-outlined text-stone-400 group-hover:text-stone-800">drag_indicator</span>
                                            </td>
                                        </Reorder.Item>
                                    ))}
                                </Reorder.Group>
                            </table>
                        </div>
                    ) : (
                        <div>
                            {discoveredStatuses.length === 0 ? (
                                <div className="py-20 text-center opacity-40 select-none">
                                    <span className="material-symbols-outlined text-6xl mb-3 text-stone-200">notifications_active</span>
                                    <p className="font-bold text-xl text-stone-800 italic">Không có trạng thái mới</p>
                                    <p className="text-[11px] mt-1 text-stone-600 font-medium">Tất cả trạng thái từ API đã được mapping chính xác</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-5">
                                    {discoveredStatuses.map(ds => {
                                        const carrier = carriers.find(c => c.code === ds.carrier_code);
                                        const carrierDisplayName = carrier ? `${carrier.name} (${carrier.code.toUpperCase()})` : ds.carrier_code;
                                        
                                        return (
                                            <div key={ds.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all relative group flex flex-col justify-between">
                                                <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500/30"></div>
                                                <div className="flex-1">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="px-2 py-1 bg-stone-900 text-white rounded text-[10px] font-black uppercase tracking-widest shadow-sm">
                                                                {carrierDisplayName}
                                                            </div>
                                                        </div>
                                                        <span className="text-[9px] text-stone-500 font-bold uppercase tracking-widest">
                                                            Phát hiện: {new Date(ds.last_seen_at).toLocaleDateString()} {new Date(ds.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1">
                                                            <p className="text-[9px] font-black text-stone-500 uppercase tracking-[0.2em] mb-1">TRẠNG THÁI TỪ API (RAW)</p>
                                                            <h4 className="font-mono text-lg font-black text-stone-900 break-all leading-tight">{ds.raw_status}</h4>
                                                        </div>
                                                        <button 
                                                            onClick={() => onMapDiscovery(ds.carrier_code, ds.raw_status)}
                                                            className="shrink-0 px-5 py-3 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-amber-600/20 hover:scale-[1.05] active:scale-[0.95] transition-all"
                                                        >
                                                            THIẾT LẬP NGAY
                                                        </button>
                                                    </div>
                                                </div>
                                                
                                                {ds.sample_payload && (
                                                    <div className="mt-4 bg-stone-900 rounded-xl p-3 max-h-24 overflow-auto scrollbar-hide">
                                                        <code className="text-[9px] text-green-400 font-mono leading-tight whitespace-pre-wrap">
                                                            {JSON.stringify(ds.sample_payload, null, 2)}
                                                        </code>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Modal Footer */}
                <div className="px-8 py-5 border-t border-stone-200 bg-stone-50 flex justify-end shrink-0">
                    <button 
                        onClick={onClose}
                        className="px-8 py-3 bg-stone-900 text-white rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg hover:brightness-125 transition-all active:scale-95"
                    >
                        ĐÓNG VÀ HOÀN TẤT
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

export default CarrierMappingSettings;
