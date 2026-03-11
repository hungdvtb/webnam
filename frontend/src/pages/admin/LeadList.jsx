import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';
import Pagination from '../../components/Pagination';

const DEFAULT_COLUMNS = [
    { id: 'customer_name', label: 'Khách Hàng', minWidth: '200px', fixed: true },
    { id: 'product_name', label: 'Sản Phẩm Quan Tâm', minWidth: '180px' },
    { id: 'phone', label: 'Số Điện Thoại', minWidth: '130px' },
    { id: 'email', label: 'Email', minWidth: '180px' },
    { id: 'source', label: 'Nguồn', minWidth: '120px' },
    { id: 'status', label: 'Trạng Thái', minWidth: '140px', align: 'center' },
    { id: 'created_at', label: 'Ngày Tạo', minWidth: '150px' },
    { id: 'actions', label: 'Thao Tác', minWidth: '100px', align: 'right', fixed: true },
];

const STATUS_MAP = {
    'new': { label: 'Mới', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    'contacted': { label: 'Đã liên hệ', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    'qualified': { label: 'Tiềm năng', color: 'bg-purple-100 text-purple-700 border-purple-200' },
    'won': { label: 'Thành công', color: 'bg-green-100 text-green-700 border-green-200' },
    'lost': { label: 'Thất bại', color: 'bg-red-100 text-red-700 border-red-200' },
};

const LeadList = () => {
    const { token } = useAuth();
    const { showNotification } = useUI();
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showColumnSettings, setShowColumnSettings] = useState(false);
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
    } = useTableColumns('lead_list', DEFAULT_COLUMNS);

    const fetchLeads = useCallback(async (page = 1) => {
        setLoading(true);
        try {
            const params = {
                page,
                per_page: pagination.per_page,
                sort_by: sortConfig.direction === 'none' ? 'created_at' : sortConfig.key,
                sort_order: sortConfig.direction === 'none' ? 'desc' : sortConfig.direction
            };
            if (statusFilter !== 'all') params.status = statusFilter;
            if (searchQuery) params.search = searchQuery;

            const res = await api.get('/leads', { params });
            setLeads(res.data.data);
            setPagination({
                current_page: res.data.current_page,
                last_page: res.data.last_page,
                total: res.data.total,
                per_page: res.data.per_page
            });
        } catch (err) {
            showNotification('Lỗi khi tải danh sách', 'error');
        } finally {
            setLoading(false);
        }
    }, [statusFilter, searchQuery, sortConfig, pagination.per_page]);

    useEffect(() => { if (token) fetchLeads(); }, [token, statusFilter, sortConfig]);

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
        fetchLeads(1);
    };

    const handleUpdateStatus = async (id, newStatus) => {
        try {
            await api.put(`/leads/${id}`, { status: newStatus });
            showNotification('Đã cập nhật', 'success');
            setLeads(leads.map(l => l.id === id ? { ...l, status: newStatus } : l));
        } catch (e) { showNotification('Lỗi!', 'error'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Xóa?')) return;
        try {
            await api.delete(`/leads/${id}`);
            showNotification('Đã xóa', 'success');
            fetchLeads(pagination.current_page);
        } catch (e) { showNotification('Lỗi!', 'error'); }
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 w-full h-full overflow-hidden animate-fade-in">
            <style>{`.table-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; } .table-scrollbar::-webkit-scrollbar-thumb { background: rgba(182, 143, 84, 0.2); border-radius: 4px; } .sticky-col { position: sticky; left: 0; z-index: 10; background: #fcfcfa; }`}</style>
            
            <div className="flex-none mb-6">
                <h1 className="text-2xl font-black text-stone-800 uppercase tracking-tight">Khách Hàng Tư Vấn</h1>
                <p className="text-sm text-stone-500 font-medium">Quản lý lead từ website / form liên hệ</p>
            </div>

            <div className="flex-none bg-white p-2 rounded-sm border border-gold/10 shadow-sm flex items-center gap-4 mb-4">
                <div className="flex gap-1.5">
                    <button onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-2 border rounded-sm w-10 h-10 ${showColumnSettings ? 'bg-gold text-white' : 'bg-white text-gold border-gold/20'}`}><span className="material-symbols-outlined text-[20px]">settings_suggest</span></button>
                    <button onClick={() => fetchLeads(1)} className="bg-primary text-white p-2 rounded-sm w-10 h-10"><span className={`material-symbols-outlined text-[20px] ${loading ? 'animate-spin' : ''}`}>refresh</span></button>
                </div>
                <div className="flex-1 relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gold/40">search</span>
                    <input type="text" placeholder="Tìm kiếm..." className="w-full bg-stone-50 border border-stone-200 pl-10 pr-4 py-2 rounded-xl text-sm outline-none focus:border-primary" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && fetchLeads(1)} />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-stone-50 border border-stone-200 text-sm font-bold rounded-xl px-4 py-2 outline-none">
                    <option value="all">Tất cả trạng thái</option>
                    {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
            </div>

            {showColumnSettings && (
                <div className="mb-4">
                    <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="lead_list" />
                </div>
            )}

            <div className="flex-1 bg-white border border-stone-100 rounded-2xl shadow-sm overflow-auto table-scrollbar relative">
                <table className="text-left border-collapse table-fixed min-w-full" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="bg-stone-50 text-[11px] font-black text-stone-500 uppercase tracking-wider sticky top-0 z-20">
                        <tr>
                            {renderedColumns.map((col, idx) => (
                                <th key={col.id} draggable={col.id !== 'actions'} onDragStart={(e) => handleHeaderDragStart(e, idx)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleHeaderDrop(e, idx)} onDoubleClick={() => handleSort(col.id)} className={`p-4 border-b border-stone-100 cursor-move hover:bg-stone-100 relative ${col.fixed ? 'sticky-col' : ''}`} style={{ width: columnWidths[col.id] || col.minWidth }}>
                                    <div className="flex items-center gap-2">
                                        <span className="truncate">{col.label}</span>
                                        <SortIndicator colId={col.id} sortConfig={sortConfig} />
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                        {leads.map(lead => (
                            <tr key={lead.id} className="hover:bg-stone-50/50 transition-colors">
                                {renderedColumns.map(col => {
                                    const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                    if (col.id === 'customer_name') return <td key={col.id} style={cellStyle} className="p-4 font-bold text-stone-800 sticky-col">{lead.customer_name}</td>;
                                    if (col.id === 'product_name') return <td key={col.id} style={cellStyle} className="p-4"><span className="text-xs font-bold text-primary bg-primary/5 px-2 py-1 rounded-lg border border-primary/10">{lead.product_name || 'Tư vấn chung'}</span></td>;
                                    if (col.id === 'status') return <td key={col.id} style={cellStyle} className="p-4 text-center"><select value={lead.status} onChange={(e) => handleUpdateStatus(lead.id, e.target.value)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border outline-none ${STATUS_MAP[lead.status]?.color}`}>{Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></td>;
                                    if (col.id === 'actions') return <td key={col.id} style={cellStyle} className="p-4 text-right"><div className="flex justify-end gap-2"><a href={`tel:${lead.phone}`} className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">call</span></a><button onClick={() => handleDelete(lead.id)} className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">delete</span></button></div></td>;
                                    if (col.id === 'created_at') return <td key={col.id} style={cellStyle} className="p-4 text-xs text-stone-500">{new Date(lead.created_at).toLocaleString('vi-VN')}</td>;
                                    return <td key={col.id} style={cellStyle} className="p-4 text-sm text-stone-600 truncate">{lead[col.id] || '-'}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex-none mt-4 flex justify-between items-center"><span className="text-xs text-stone-500">Hiển thị {leads.length} / {pagination.total} khách</span><Pagination pagination={pagination} onPageChange={(page) => fetchLeads(page)} /></div>
        </div>
    );
};

export default LeadList;
