import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import ReturnOrderCreateModal from '../../components/admin/ReturnOrderCreateModal';
import { useAuth } from '../../context/AuthContext';
import {
    RETURN_ORDER_STATUS_OPTIONS,
    formatReturnOrderCurrency,
    formatReturnOrderDate,
    resolveProfitLossMeta,
    resolveReturnOrderStatus,
} from '../../config/returnOrderStatus';
import { returnOrderApi } from '../../services/api';

const shellClass = 'absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 w-full h-full overflow-hidden animate-fade-in';
const panelClass = 'rounded-sm border border-gold/10 bg-white shadow-sm';
const inputClass = 'h-11 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-primary transition-all hover:border-primary/35 hover:bg-primary/5';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-white transition-all hover:bg-umber disabled:cursor-not-allowed disabled:opacity-50';

const createItemRow = () => ({
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    product: null,
    quantity: '1',
    notes: '',
});

const createInitialForm = () => ({
    originOrder: null,
    exchangeDate: new Date().toISOString().slice(0, 10),
    notes: '',
    returnedItems: [createItemRow()],
    resentItems: [createItemRow()],
});

const ReturnOrderList = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState({ search: '', status: '', date_from: '', date_to: '' });
    const [statusOptions, setStatusOptions] = useState(RETURN_ORDER_STATUS_OPTIONS);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createForm, setCreateForm] = useState(createInitialForm);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const loadedOnceRef = useRef(false);

    const fetchRows = useCallback(async (page = 1, nextFilters = filters) => {
        setLoading(true);
        try {
            const response = await returnOrderApi.getAll({
                page,
                per_page: pagination.per_page,
                search: nextFilters.search || undefined,
                status: nextFilters.status || undefined,
                date_from: nextFilters.date_from || undefined,
                date_to: nextFilters.date_to || undefined,
            });

            setRows(response.data?.data || []);
            setPagination({
                current_page: response.data?.current_page || 1,
                last_page: response.data?.last_page || 1,
                total: response.data?.total || 0,
                per_page: response.data?.per_page || 20,
            });
            setStatusOptions(response.data?.status_options || RETURN_ORDER_STATUS_OPTIONS);
            setFeedback(null);
        } catch (error) {
            setFeedback({
                type: 'error',
                message: 'Khong the tai danh sach don doi tra.',
            });
        } finally {
            setLoading(false);
        }
    }, [filters, pagination.per_page]);

    useEffect(() => {
        if (loadedOnceRef.current) return;
        loadedOnceRef.current = true;
        fetchRows(1);
    }, [fetchRows]);

    const summary = useMemo(() => rows.reduce((accumulator, row) => ({
        returned: accumulator.returned + Number(row.returned_total_amount || 0),
        resent: accumulator.resent + Number(row.resent_total_amount || 0),
    }), { returned: 0, resent: 0 }), [rows]);

    const handleFilterChange = (patch) => {
        setFilters((current) => ({ ...current, ...patch }));
    };

    const updateCreateForm = (patch) => {
        setCreateForm((current) => ({ ...current, ...patch }));
    };

    const handleItemChange = (group, index, patch) => {
        setCreateForm((current) => {
            const field = group === 'returned' ? 'returnedItems' : 'resentItems';
            const nextRows = [...current[field]];
            nextRows[index] = { ...nextRows[index], ...patch };

            return {
                ...current,
                [field]: nextRows,
            };
        });
    };

    const handleAddItemRow = (group) => {
        setCreateForm((current) => {
            const field = group === 'returned' ? 'returnedItems' : 'resentItems';
            return {
                ...current,
                [field]: [...current[field], createItemRow()],
            };
        });
    };

    const handleRemoveItemRow = (group, index) => {
        setCreateForm((current) => {
            const field = group === 'returned' ? 'returnedItems' : 'resentItems';
            const nextRows = current[field].filter((_, rowIndex) => rowIndex !== index);

            return {
                ...current,
                [field]: nextRows.length > 0 ? nextRows : [createItemRow()],
            };
        });
    };

    const handleOpenCreateModal = () => {
        setFeedback(null);
        setCreateForm(createInitialForm());
        setShowCreateModal(true);
    };

    const handleSubmitCreate = async () => {
        setSaving(true);
        setFeedback(null);

        try {
            const payload = {
                origin_order_id: createForm.originOrder?.id || null,
                exchange_date: createForm.exchangeDate,
                notes: createForm.notes || null,
                returned_items: createForm.returnedItems.map((row) => ({
                    product_id: row.product?.id || null,
                    quantity: Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0),
                    notes: row.notes || null,
                })),
                resent_items: createForm.resentItems.map((row) => ({
                    product_id: row.product?.id || null,
                    quantity: Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0),
                    notes: row.notes || null,
                })),
            };

            const response = await returnOrderApi.store(payload);
            setShowCreateModal(false);
            await fetchRows(1);
            navigate(`/admin/return-orders/${response.data?.id}`);
        } catch (error) {
            const validation = error?.response?.data?.errors;
            const firstError = validation
                ? Object.values(validation).flat().find(Boolean)
                : null;

            setFeedback({
                type: 'error',
                message: firstError || 'Khong the luu don doi tra. Vui long kiem tra du lieu vua nhap.',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={shellClass}>
            <div className="mb-6 flex flex-none items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold italic text-primary">Quan ly don doi tra</h1>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.34em] text-gold">Module doc lap cho xu ly doi tra thuc te</p>
                </div>
                <div className="flex items-center gap-3">
                    <AccountSelector user={user} />
                    <button type="button" onClick={handleOpenCreateModal} className={primaryButton}>
                        <span className="material-symbols-outlined text-[16px]">add</span>
                        Tao don doi tra
                    </button>
                </div>
            </div>

            <div className={`${panelClass} mb-4 flex flex-none flex-wrap items-end gap-3 p-4`}>
                <div className="min-w-[240px] flex-1">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Tim kiem</label>
                    <input
                        type="text"
                        value={filters.search}
                        onChange={(event) => handleFilterChange({ search: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') fetchRows(1, filters);
                        }}
                        className={inputClass}
                        placeholder="Ma doi tra, don goc, khach hang, san pham..."
                    />
                </div>

                <div className="min-w-[220px]">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Trang thai</label>
                    <select
                        value={filters.status}
                        onChange={(event) => handleFilterChange({ status: event.target.value })}
                        className={inputClass}
                    >
                        <option value="">Tat ca trang thai</option>
                        {statusOptions.map((status) => (
                            <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                    </select>
                </div>

                <div className="min-w-[180px]">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Tu ngay</label>
                    <input type="date" value={filters.date_from} onChange={(event) => handleFilterChange({ date_from: event.target.value })} className={inputClass} />
                </div>

                <div className="min-w-[180px]">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Den ngay</label>
                    <input type="date" value={filters.date_to} onChange={(event) => handleFilterChange({ date_to: event.target.value })} className={inputClass} />
                </div>

                <div className="flex gap-2">
                    <button type="button" onClick={() => fetchRows(1, filters)} className={primaryButton}>Loc</button>
                    <button type="button" onClick={() => fetchRows(pagination.current_page || 1, filters)} className={secondaryButton}>Tai lai</button>
                </div>
            </div>

            <div className="mb-4 grid flex-none grid-cols-1 gap-4 lg:grid-cols-3">
                <div className={`${panelClass} p-4`}>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Tong don hien thi</div>
                    <div className="mt-2 text-2xl font-display font-bold italic text-primary">{pagination.total}</div>
                </div>
                <div className={`${panelClass} p-4`}>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Gia tri hang tra ve</div>
                    <div className="mt-2 text-2xl font-display font-bold italic text-primary">{formatReturnOrderCurrency(summary.returned)}d</div>
                </div>
                <div className={`${panelClass} p-4`}>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Gia tri hang gui lai</div>
                    <div className="mt-2 text-2xl font-display font-bold italic text-brick">{formatReturnOrderCurrency(summary.resent)}d</div>
                </div>
            </div>

            {feedback ? (
                <div className={`mb-4 flex-none rounded-sm border px-4 py-3 text-[12px] font-semibold ${feedback.type === 'error' ? 'border-brick/25 bg-brick/5 text-brick' : 'border-green-600/25 bg-green-50 text-green-700'}`}>
                    {feedback.message}
                </div>
            ) : null}

            <div className={`${panelClass} flex-1 overflow-hidden`}>
                <div className="h-full overflow-auto">
                    <table className="min-w-full border-collapse text-left">
                        <thead className="sticky top-0 z-10 bg-[#fcfcfa] text-[10px] font-black uppercase tracking-[0.24em] text-stone-500">
                            <tr>
                                <th className="border-b border-primary/10 px-4 py-3">Ma doi tra</th>
                                <th className="border-b border-primary/10 px-4 py-3">Don goc</th>
                                <th className="border-b border-primary/10 px-4 py-3">Khach hang</th>
                                <th className="border-b border-primary/10 px-4 py-3">Hang tra / gui</th>
                                <th className="border-b border-primary/10 px-4 py-3">Gia tri tra ve</th>
                                <th className="border-b border-primary/10 px-4 py-3">Gia tri gui lai</th>
                                <th className="border-b border-primary/10 px-4 py-3">Chenh lech</th>
                                <th className="border-b border-primary/10 px-4 py-3">Trang thai</th>
                                <th className="border-b border-primary/10 px-4 py-3">Ngay tao</th>
                                <th className="border-b border-primary/10 px-4 py-3 text-right">Tac vu</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="10" className="px-4 py-16 text-center text-[12px] font-semibold text-primary/45">Dang tai du lieu don doi tra...</td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan="10" className="px-4 py-16 text-center text-[12px] font-semibold text-primary/35">Chua co don doi tra phu hop bo loc hien tai.</td>
                                </tr>
                            ) : rows.map((row) => {
                                const statusMeta = resolveReturnOrderStatus(row.status);
                                const profitLossMeta = resolveProfitLossMeta(row.profit_loss_amount);
                                const customerName = row.customer_name || row.origin_order?.customer_name || '-';
                                const customerPhone = row.customer_phone || row.origin_order?.customer_phone || '';

                                return (
                                    <tr
                                        key={row.id}
                                        onClick={() => navigate(`/admin/return-orders/${row.id}`)}
                                        className="cursor-pointer border-b border-primary/5 transition-all hover:bg-gold/5"
                                    >
                                        <td className="px-4 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-[13px] font-black text-primary">{row.return_number}</span>
                                                <span className="mt-1 text-[11px] text-stone-500">Nhap hoan {row.return_document?.document_number || '-'} / Xuat {row.export_document?.document_number || '-'}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-[12px] text-stone-600">
                                            {row.origin_order ? (
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-primary">#{row.origin_order.order_number}</span>
                                                    <span className="mt-1 text-[11px] text-stone-500">{row.origin_order.status || '-'}</span>
                                                </div>
                                            ) : (
                                                <span className="font-semibold text-stone-400">Khong lien ket</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-[13px] font-bold text-[#0F172A]">{customerName}</span>
                                                <span className="mt-1 text-[11px] text-stone-500">{customerPhone || 'Khong co SDT'}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-[12px] font-semibold text-stone-600">
                                            <div>{row.returned_total_quantity} nhap</div>
                                            <div className="mt-1">{row.resent_total_quantity} xuat</div>
                                        </td>
                                        <td className="px-4 py-4 text-[13px] font-black text-primary">{formatReturnOrderCurrency(row.returned_total_amount)}d</td>
                                        <td className="px-4 py-4 text-[13px] font-black text-brick">{formatReturnOrderCurrency(row.resent_total_amount)}d</td>
                                        <td className="px-4 py-4">
                                            <span
                                                className="inline-flex rounded-sm border px-3 py-2 text-[12px] font-black"
                                                style={{ color: profitLossMeta.color, borderColor: `${profitLossMeta.color}40`, backgroundColor: `${profitLossMeta.color}12` }}
                                            >
                                                {row.profit_loss_amount > 0 ? '+' : ''}{formatReturnOrderCurrency(row.profit_loss_amount)}d
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span
                                                className="inline-flex rounded-sm border px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em]"
                                                style={{ color: statusMeta.color, borderColor: `${statusMeta.color}40`, backgroundColor: `${statusMeta.color}12` }}
                                            >
                                                {statusMeta.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 text-[12px] text-stone-600">{formatReturnOrderDate(row.created_at)}</td>
                                        <td className="px-4 py-4 text-right">
                                            <button type="button" className={secondaryButton} onClick={(event) => {
                                                event.stopPropagation();
                                                navigate(`/admin/return-orders/${row.id}`);
                                            }}>
                                                Xem chi tiet
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="mt-4 flex flex-none items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Hien thi {rows.length} / {pagination.total}</span>
                <Pagination pagination={pagination} onPageChange={(page) => fetchRows(page, filters)} />
            </div>

            <ReturnOrderCreateModal
                open={showCreateModal}
                form={createForm}
                saving={saving}
                feedback={feedback}
                onClose={() => setShowCreateModal(false)}
                onFormChange={updateCreateForm}
                onOriginOrderSelect={(originOrder) => updateCreateForm({ originOrder })}
                onItemChange={handleItemChange}
                onAddItemRow={handleAddItemRow}
                onRemoveItemRow={handleRemoveItemRow}
                onSubmit={handleSubmitCreate}
            />
        </div>
    );
};

export default ReturnOrderList;
