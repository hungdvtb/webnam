import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import { productReplacementApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const emptyPagination = { current_page: 1, last_page: 1, total: 0, per_page: 30 };
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const primaryButton = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-brick px-4 text-[13px] font-bold text-white transition hover:bg-umber disabled:cursor-not-allowed disabled:opacity-60';
const ghostButton = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-brick/20 bg-white px-3 text-[12px] font-bold text-brick transition hover:bg-brick hover:text-white disabled:cursor-not-allowed disabled:opacity-60';
const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(value) || 0);
const formatMoney = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value) || 0);

const resolveErrorMessage = (error, fallback) => {
    const errors = error?.response?.data?.errors;
    if (errors && typeof errors === 'object') {
        const first = Object.values(errors).flat().find(Boolean);
        if (first) return String(first);
    }

    return error?.response?.data?.message || fallback;
};

const normalizeExpression = (items = []) => items
    .map((item) => String(item?.sku || item?.display_sku || '').trim())
    .filter(Boolean)
    .join(' = ');

const stockTextClass = (value) => {
    const numeric = Number(value || 0);
    if (numeric <= 0) return 'text-brick';
    if (numeric <= 2) return 'text-amber-600';
    return 'text-emerald-700';
};

const locationText = (item) => {
    const locations = Array.isArray(item?.warehouse_locations) ? item.warehouse_locations : [];
    if (locations.length === 0) return 'Chưa có vị trí kho';

    return locations
        .slice(0, 2)
        .map((location) => `${location.warehouse_code || location.warehouse_name || 'Kho'}: ${formatNumber(location.quantity)}`)
        .join(' • ');
};

const ReplacementItemChips = ({ items = [] }) => (
    <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
            <span
                key={item.product_id || item.id || item.sku}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.03] px-2.5 py-1 text-[11px] font-black text-primary/65"
                title={`${item.name || 'Sản phẩm'} • Tồn ${formatNumber(item.available_to_sell ?? item.stock_quantity ?? 0)}`}
            >
                <span className="max-w-[220px] truncate">{item.sku || 'N/A'}</span>
                <span className={stockTextClass(item.available_to_sell ?? item.stock_quantity ?? 0)}>
                    {formatNumber(item.available_to_sell ?? item.stock_quantity ?? 0)}
                </span>
            </span>
        ))}
    </div>
);

const ReplacementFinancialBlock = ({ item, compact = false }) => {
    const profit = Number(item?.replacement_profit_total || 0);
    const profitClass = profit < 0 ? 'text-brick' : profit === 0 ? 'text-amber-600' : 'text-emerald-700';

    return (
        <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2' : 'md:grid-cols-4'}`}>
            <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Giá niêm yết</div>
                <div className="mt-1 text-[13px] font-black text-primary">{formatMoney(item?.list_price ?? item?.price)}đ</div>
            </div>
            <div className="rounded-sm border border-sky-200 bg-sky-50 px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-sky-700/60">Giá giữ theo đơn</div>
                <div className="mt-1 text-[13px] font-black text-sky-800">{formatMoney(item?.locked_price ?? item?.effective_selling_price)}đ</div>
            </div>
            <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Giá vốn mã lấy</div>
                <div className="mt-1 text-[13px] font-black text-primary">{formatMoney(item?.cost_price)}đ</div>
            </div>
            <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Lãi sau đổi</div>
                <div className={`mt-1 text-[13px] font-black ${profitClass}`}>{formatMoney(profit)}đ</div>
            </div>
        </div>
    );
};

const ProductReplacementManager = ({ mode = 'manage' }) => {
    const { showToast } = useUI();
    const isLookupMode = mode === 'lookup';
    const [groups, setGroups] = useState([]);
    const [pagination, setPagination] = useState(emptyPagination);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ id: null, name: '', expression: '', notes: '' });
    const [lookupSku, setLookupSku] = useState('');
    const [lookupPrice, setLookupPrice] = useState('');
    const [lookupQuantity, setLookupQuantity] = useState('1');
    const [lookupResult, setLookupResult] = useState(null);
    const [lookupLoading, setLookupLoading] = useState(false);

    const fetchGroups = useCallback(async (page = 1) => {
        if (isLookupMode) return;
        setLoading(true);
        try {
            const response = await productReplacementApi.getAll({
                page,
                per_page: pagination.per_page || 30,
                search: search.trim() || undefined,
            });
            setGroups(Array.isArray(response.data?.data) ? response.data.data : []);
            setPagination({
                current_page: response.data?.current_page || 1,
                last_page: response.data?.last_page || 1,
                per_page: response.data?.per_page || 30,
                total: response.data?.total || 0,
            });
        } catch (error) {
            showToast({ type: 'error', message: resolveErrorMessage(error, 'Không thể tải nhóm mã thay thế.') });
        } finally {
            setLoading(false);
        }
    }, [isLookupMode, pagination.per_page, search, showToast]);

    useEffect(() => {
        fetchGroups(1);
    }, [fetchGroups]);

    const resetForm = () => setForm({ id: null, name: '', expression: '', notes: '' });

    const saveGroup = async (event) => {
        event.preventDefault();
        if (!form.expression.trim()) {
            showToast({ type: 'warning', message: 'Nhập ít nhất 2 mã sản phẩm, ví dụ MR70 = MR71.' });
            return;
        }

        setSaving(true);
        try {
            const payload = {
                expression: form.expression,
                name: form.name.trim() || null,
                notes: form.notes.trim() || null,
            };
            if (form.id) {
                await productReplacementApi.update(form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật nhóm mã thay thế.' });
            } else {
                await productReplacementApi.create(payload);
                showToast({ type: 'success', message: 'Đã lưu nhóm mã thay thế.' });
            }
            resetForm();
            fetchGroups(1);
        } catch (error) {
            showToast({ type: 'error', message: resolveErrorMessage(error, 'Không thể lưu nhóm mã thay thế.') });
        } finally {
            setSaving(false);
        }
    };

    const editGroup = (group) => {
        setForm({
            id: group.id,
            name: group.name || '',
            expression: group.expression || normalizeExpression(group.items),
            notes: group.notes || '',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteGroup = async (group) => {
        if (!window.confirm(`Xóa nhóm mã thay thế ${group.expression || group.name || `#${group.id}`}?`)) {
            return;
        }

        try {
            await productReplacementApi.destroy(group.id);
            showToast({ type: 'success', message: 'Đã xóa nhóm mã thay thế.' });
            fetchGroups(pagination.current_page || 1);
        } catch (error) {
            showToast({ type: 'error', message: resolveErrorMessage(error, 'Không thể xóa nhóm mã thay thế.') });
        }
    };

    const runLookup = async (event) => {
        event?.preventDefault?.();
        const sku = lookupSku.trim();
        if (!sku) {
            showToast({ type: 'warning', message: 'Nhập hoặc quét mã sản phẩm cần tra.' });
            return;
        }

        setLookupLoading(true);
        try {
            const response = await productReplacementApi.lookup({
                sku,
                locked_price: lookupPrice.trim() || undefined,
                quantity: lookupQuantity || 1,
            });
            setLookupResult(response.data?.data || null);
        } catch (error) {
            showToast({ type: 'error', message: resolveErrorMessage(error, 'Không thể tra mã thay thế.') });
        } finally {
            setLookupLoading(false);
        }
    };

    const lookupAlternatives = useMemo(
        () => Array.isArray(lookupResult?.alternatives) ? lookupResult.alternatives : [],
        [lookupResult]
    );

    if (isLookupMode) {
        return (
            <div className="flex h-full min-h-0 flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/45">Kho lấy hàng</div>
                        <h1 className="mt-1 text-2xl font-black text-primary">Tra nhanh mã thay thế</h1>
                    </div>
                    <Link to="/admin/inventory/ma-thay-the" className={ghostButton}>
                        <span className="material-symbols-outlined text-[18px]">rule</span>
                        Khai báo mã
                    </Link>
                </div>

                <form onSubmit={runLookup} className={`${panelClass} p-4`}>
                    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_120px_auto]">
                        <div>
                            <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Mã cần lấy</label>
                            <div className="relative">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                <input
                                    value={lookupSku}
                                    onChange={(event) => setLookupSku(event.target.value)}
                                    placeholder="Nhập hoặc quét mã sản phẩm"
                                    className={`w-full pl-10 ${inputClass}`}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div>
                            <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Giá khách chốt</label>
                            <input
                                value={lookupPrice}
                                onChange={(event) => setLookupPrice(event.target.value.replace(/[^\d.]/g, ''))}
                                placeholder="VD: 300000"
                                inputMode="numeric"
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Số lượng</label>
                            <input
                                value={lookupQuantity}
                                onChange={(event) => setLookupQuantity(event.target.value.replace(/[^\d.]/g, '') || '1')}
                                inputMode="decimal"
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div className="flex items-end">
                            <button type="submit" disabled={lookupLoading} className={primaryButton}>
                                <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
                                {lookupLoading ? 'Đang tra' : 'Tra mã'}
                            </button>
                        </div>
                    </div>
                </form>

                {lookupResult ? (
                    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div className={`${panelClass} min-h-0`}>
                            <div className="border-b border-primary/10 bg-primary/[0.03] px-4 py-3">
                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Mã khách chốt / mã đang cần lấy</div>
                                {lookupResult.product ? (
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="text-[15px] font-black text-primary">{lookupResult.product.name}</span>
                                        <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[11px] font-black text-primary/55">{lookupResult.product.sku}</span>
                                        <span className={`rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[11px] font-black ${stockTextClass(lookupResult.product.available_to_sell)}`}>
                                            Tồn {formatNumber(lookupResult.product.available_to_sell)}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="mt-1 text-[14px] font-bold text-brick">Không tìm thấy mã sản phẩm.</div>
                                )}
                            </div>

                            <div className="divide-y divide-primary/10">
                                {lookupAlternatives.length > 0 ? lookupAlternatives.map((item, index) => (
                                    <div key={item.product_id || item.sku} className="grid gap-3 px-4 py-4 lg:grid-cols-[42px_minmax(0,1fr)]">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-[13px] font-black text-emerald-700">{index + 1}</div>
                                        <div className="min-w-0 space-y-3">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-[15px] font-black text-primary">{item.name}</div>
                                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                                        <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[11px] font-black text-primary/55">{item.sku}</span>
                                                        <span className={`rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[11px] font-black ${stockTextClass(item.available_to_sell)}`}>Còn {formatNumber(item.available_to_sell)}</span>
                                                        <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[11px] font-black text-primary/45">{locationText(item)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <ReplacementFinancialBlock item={item} />
                                        </div>
                                    </div>
                                )) : (
                                    <div className="px-4 py-10 text-center text-[13px] font-bold text-primary/45">
                                        {lookupResult.product ? 'Mã này chưa được khai báo nhóm thay thế.' : 'Nhập mã khác để tra tiếp.'}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={`${panelClass} self-start p-4`}>
                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">Nhóm mã tương đương</div>
                            <div className="mt-3">
                                {lookupResult.group?.items?.length ? (
                                    <ReplacementItemChips items={lookupResult.group.items} />
                                ) : (
                                    <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] px-3 py-4 text-[12px] font-semibold text-primary/40">
                                        Chưa có nhóm thay thế cho mã này.
                                    </div>
                                )}
                            </div>
                            {lookupResult.group?.notes ? (
                                <div className="mt-4 rounded-sm border border-primary/10 bg-primary/[0.02] px-3 py-3 text-[12px] font-semibold leading-relaxed text-primary/60">
                                    {lookupResult.group.notes}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <div className={`${panelClass} px-4 py-10 text-center text-[13px] font-bold text-primary/40`}>
                        Nhập mã sản phẩm để xem mã nào có thể lấy thay.
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/45">Khai báo kho</div>
                    <h1 className="mt-1 text-2xl font-black text-primary">Mã sản phẩm thay thế</h1>
                </div>
                <Link to="/admin/inventory/tra-ma-kho" className={ghostButton}>
                    <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
                    Tra nhanh cho kho
                </Link>
            </div>

            <form onSubmit={saveGroup} className={`${panelClass} p-4`}>
                <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_220px_260px_auto]">
                    <div>
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Nhập nhanh theo mã</label>
                        <input
                            value={form.expression}
                            onChange={(event) => setForm((prev) => ({ ...prev, expression: event.target.value }))}
                            placeholder="MR70-DEBATHUONG-RONG-30 = MR71-DEBATHUONG-25"
                            className={`w-full font-mono ${inputClass}`}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Tên nhóm</label>
                        <input
                            value={form.name}
                            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                            placeholder="Không bắt buộc"
                            className={`w-full ${inputClass}`}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ghi chú kho</label>
                        <input
                            value={form.notes}
                            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                            placeholder="VD: dùng khi hết Phi 30"
                            className={`w-full ${inputClass}`}
                        />
                    </div>
                    <div className="flex items-end gap-2">
                        <button type="submit" disabled={saving} className={primaryButton}>
                            <span className="material-symbols-outlined text-[18px]">{form.id ? 'save' : 'add'}</span>
                            {saving ? 'Đang lưu' : form.id ? 'Cập nhật' : 'Lưu nhóm'}
                        </button>
                        {form.id ? (
                            <button type="button" onClick={resetForm} className={ghostButton}>Hủy</button>
                        ) : null}
                    </div>
                </div>
            </form>

            <div className={`${panelClass} flex min-h-0 flex-1 flex-col`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 px-4 py-3">
                    <div className="text-[13px] font-black text-primary">{formatNumber(pagination.total)} nhóm mã</div>
                    <div className="relative w-full max-w-md">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Tìm theo mã hoặc tên sản phẩm"
                            className={`w-full pl-10 ${inputClass}`}
                        />
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full min-w-[960px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                            <tr>
                                <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Nhóm</th>
                                <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Các mã thay qua lại</th>
                                <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Tồn / vị trí</th>
                                <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ghi chú</th>
                                <th className="border-b border-primary/10 px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-[13px] font-bold text-primary/45">Đang tải nhóm mã thay thế...</td>
                                </tr>
                            ) : groups.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-[13px] font-bold text-primary/45">Chưa có nhóm mã thay thế.</td>
                                </tr>
                            ) : groups.map((group) => (
                                <tr key={group.id} className="border-b border-primary/10 last:border-b-0">
                                    <td className="px-4 py-3 align-top">
                                        <div className="text-[13px] font-black text-primary">{group.name || `Nhóm #${group.id}`}</div>
                                        <div className="mt-1 text-[11px] font-semibold text-primary/40">{group.items_count || 0} mã tương đương</div>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <ReplacementItemChips items={group.items} />
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="space-y-1.5">
                                            {(group.items || []).slice(0, 4).map((item) => (
                                                <div key={item.product_id || item.sku} className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-primary/55">
                                                    <span className="font-mono text-primary/70">{item.sku || 'N/A'}</span>
                                                    <span className={stockTextClass(item.available_to_sell ?? item.stock_quantity ?? 0)}>còn {formatNumber(item.available_to_sell ?? item.stock_quantity ?? 0)}</span>
                                                    <span className="text-primary/35">{locationText(item)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="max-w-[260px] px-4 py-3 align-top text-[12px] font-semibold leading-relaxed text-primary/55">
                                        {group.notes || '-'}
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={() => editGroup(group)} className={ghostButton}>
                                                <span className="material-symbols-outlined text-[16px]">edit</span>
                                                Sửa
                                            </button>
                                            <button type="button" onClick={() => deleteGroup(group)} className={dangerButton}>
                                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                                Xóa
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="border-t border-primary/10 px-4 py-3">
                    <Pagination pagination={pagination} onPageChange={(page) => fetchGroups(page)} />
                </div>
            </div>
        </div>
    );
};

export default ProductReplacementManager;
