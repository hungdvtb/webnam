import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { orderApi, orderStatusApi } from '../../services/api';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';

const DEFAULT_COLUMNS = [
    { id: 'order_number', label: 'Mã Đơn', minWidth: '140px', fixed: true },
    { id: 'customer', label: 'Khách Hàng', minWidth: '200px' },
    { id: 'created_at', label: 'Ngày Đặt', minWidth: '150px' },
    { id: 'total_price', label: 'Tổng Tiền', minWidth: '150px' },
    { id: 'status', label: 'Trạng Thái', minWidth: '150px', align: 'center' },
    { id: 'actions', label: 'Thao Tác', minWidth: '180px', align: 'right', fixed: true },
];

const PendingOrderList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc', phase: 1 });

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
    } = useTableColumns('pending_order_list', DEFAULT_COLUMNS);

    const fetchOrders = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const response = await orderApi.getAll({ 
                is_pending: 1, 
                page, 
                per_page: pagination.per_page,
                sort_by: sortConfig.direction === 'none' ? 'created_at' : sortConfig.key,
                sort_order: sortConfig.direction === 'none' ? 'desc' : sortConfig.direction
            });
            setOrders(response.data.data);
            setPagination({
                current_page: response.data.current_page,
                last_page: response.data.last_page,
                total: response.data.total,
                per_page: response.data.per_page
            });
        } catch (error) { console.error("Error fetching orders", error); } finally { setLoading(false); }
    }, [pagination.per_page, sortConfig]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const statusRes = await orderStatusApi.getAll();
                setOrderStatuses(statusRes.data || []);
                fetchOrders(1);
            } catch (error) { console.error("Error initial data", error); }
        };
        loadInitialData();
    }, [fetchOrders]);

    const handleSort = (columnId) => {
        if (columnId === 'actions') return;
        let newSort;
        if (sortConfig.key !== columnId) {
            newSort = { key: columnId, direction: 'desc', phase: 1 };
        } else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            if (nextPhase === 3) newSort = { key: 'created_at', direction: 'desc', phase: 1 };
            else newSort = { key: columnId, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
        }
        setSortConfig(newSort);
    };

    const handleUpdateStatus = async (id, status) => {
        const actionName = status === 'confirmed' ? 'Xác nhận' : 'Hủy';
        if (window.confirm(`Bạn có chắc muốn ${actionName} đơn hàng này?`)) {
            try {
                await orderApi.updateStatus(id, status);
                fetchOrders(pagination.current_page);
            } catch (error) { alert('Lỗi khi cập nhật!'); }
        }
    };

    const getStatusStyle = (status) => {
        const found = orderStatuses.find(s => s.code === status);
        return found ? { backgroundColor: `${found.color}15`, color: found.color, borderColor: `${found.color}30` } : {};
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 w-full h-full overflow-hidden animate-fade-in">
            <style>{`.sticky-col { position: sticky; left: 0; z-index: 10; background: #fcfcfa; }`}</style>
            
            <div className="flex-none mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Xử Lý Lead (Đơn Hàng Chờ)</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Các đơn hàng từ Website cần duyệt</p>
                </div>
                <AccountSelector user={user} />
            </div>

            <div className="flex-none bg-white p-2 border border-gold/10 shadow-sm flex items-center gap-2 mb-4">
                <button onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-2 border rounded-sm w-10 h-10 ${showColumnSettings ? 'bg-gold text-white' : 'bg-white text-gold border-gold/30'}`}><span className="material-symbols-outlined">settings_suggest</span></button>
                <button onClick={() => fetchOrders(1)} className="bg-primary text-white p-2 rounded-sm w-10 h-10"><span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`}>refresh</span></button>
            </div>

            {showColumnSettings && <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="pending_order_list" />}

            <div className="flex-1 bg-white border border-gold/10 shadow-2xl overflow-auto table-scrollbar relative rounded-md">
                <table className="text-left border-collapse table-fixed min-w-full" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="bg-[#fcfcfa] text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10 sticky top-0 z-20">
                        <tr>
                            {renderedColumns.map((col, idx) => (
                                <th key={col.id} draggable={col.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, idx)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, idx)} onDoubleClick={() => handleSort(col.id)} className={`p-4 border-r border-gold/5 cursor-move hover:bg-gold/5 relative ${col.fixed ? 'sticky-col' : ''}`} style={{ width: columnWidths[col.id] || col.minWidth }}>
                                    <div className="flex items-center gap-2">
                                        <span className="truncate">{col.label}</span>
                                        <SortIndicator colId={col.id} sortConfig={sortConfig} />
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                {renderedColumns.map(col => {
                                    const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                    if (col.id === 'order_number') return <td key={col.id} style={cellStyle} className="p-4 font-ui font-bold text-primary sticky-col">#{order.order_number}</td>;
                                    if (col.id === 'customer') return <td key={col.id} style={cellStyle} className="p-4"><div className="flex flex-col"><span className="font-bold text-sm">{order.customer_name}</span><span className="text-[10px] text-stone font-ui">{order.customer_phone}</span></div></td>;
                                    if (col.id === 'total_price') return <td key={col.id} style={cellStyle} className="p-4 font-bold text-brick">{new Intl.NumberFormat('vi-VN').format(Math.floor(order.total_price))}₫</td>;
                                    if (col.id === 'status') return <td key={col.id} style={cellStyle} className="p-4 text-center"><span style={getStatusStyle(order.status)} className="px-2 py-1 text-[9px] font-bold uppercase border">{orderStatuses.find(s=>s.code===order.status)?.name || order.status}</span></td>;
                                    if (col.id === 'actions') return <td key={col.id} style={cellStyle} className="p-4 text-right sticky-col right-0"><div className="flex items-center justify-end gap-3"><button onClick={() => handleUpdateStatus(order.id, 'confirmed')} className="text-green-600 font-bold text-[10px] uppercase hover:opacity-70">Xác nhận</button><button onClick={() => handleUpdateStatus(order.id, 'cancelled')} className="text-brick font-bold text-[10px] uppercase hover:opacity-70">Hủy</button></div></td>;
                                    if (col.id === 'created_at') return <td key={col.id} style={cellStyle} className="p-4 text-sm text-stone">{new Date(order.created_at).toLocaleDateString('vi-VN')}</td>;
                                    return <td key={col.id} style={cellStyle} className="p-4 text-sm text-stone">{order[col.id] || '-'}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex-none mt-4 flex justify-between items-center"><span className="text-[10px] font-bold text-stone uppercase">Hiển thị {orders.length} / {pagination.total}</span><Pagination pagination={pagination} onPageChange={(page) => fetchOrders(page)} /></div>
        </div>
    );
};

export default PendingOrderList;
