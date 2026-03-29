import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { financeApi } from '../../services/api';

const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const toolbarPanelClass = 'rounded-sm border border-primary/10 bg-white p-2 shadow-sm';
const dataPanelClass = 'overflow-hidden rounded-md border border-primary/10 bg-white shadow-xl';
const tableFrameClass = 'overflow-auto table-scrollbar relative';
const reportTableClass = 'border-collapse table-fixed text-left admin-text-13';
const stickyHeaderClass = 'admin-table-header sticky top-0 z-20 border-b border-primary/10 shadow-sm';
const headerCellClass = 'border border-primary/10 px-3 py-2.5 text-left text-[12px] font-black text-primary';
const bodyCellClass = 'border border-primary/20 px-3 py-2.5 text-[12px] text-[#0F172A]';
const numericBodyCellClass = 'border border-primary/20 px-3 py-2.5 text-right text-[12px] font-black text-primary';
const summaryCardClass = 'rounded-sm border border-primary/10 bg-white p-4 shadow-sm';
const infoChipClass = 'flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[13px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black text-primary transition hover:border-primary hover:bg-primary/5';
const iconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const todayValue = new Date().toISOString().slice(0, 10);
const pageTitle = 'Tính toán lợi nhuận theo ngày';

function shiftDate(baseDate, offsetDays) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().slice(0, 10);
}

function formatMoneyValue(value) {
    return new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 0,
    }).format(Number(value || 0));
}

function formatMoney(value) {
    return `${formatMoneyValue(value)} đ`;
}

function formatPercent(value) {
    return `${new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value || 0))}%`;
}

function formatPercentRatio(value) {
    return formatPercent(Number(value || 0) * 100);
}

function formatDate(value) {
    if (!value) return 'Chưa có version';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString('vi-VN');
}

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-2xl' }) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-primary/35 backdrop-blur-[2px]" onClick={onClose} />
            <div className={`relative w-full ${maxWidth} overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_24px_80px_-28px_rgba(27,54,93,0.55)]`}>
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <h3 className="text-[18px] font-black text-primary">{title}</h3>
                    <button type="button" onClick={onClose} className={iconButtonClass} title="Đóng">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="px-5 py-5">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-5 py-4">{footer}</div> : null}
            </div>
        </div>
    );
};

const defaultConfig = {
    id: null,
    effective_date: todayValue,
    return_rate: 0,
    packaging_cost_per_order: 0,
    shipping_calculation_mode: 'fixed_per_order',
    shipping_calculation_label: 'Số đơn x phí ship cố định',
    shipping_cost_per_order: 0,
    shipping_cost_rate: 0,
    tax_rate: 1.5,
    note: '',
};

export default function DailyProfitTracking() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);
    const [filters, setFilters] = useState({
        date_from: shiftDate(todayValue, -29),
        date_to: todayValue,
    });
    const [filterDraft, setFilterDraft] = useState({
        date_from: shiftDate(todayValue, -29),
        date_to: todayValue,
    });
    const [rows, setRows] = useState([]);
    const [totals, setTotals] = useState(null);
    const [currentConfig, setCurrentConfig] = useState(defaultConfig);
    const [configHistory, setConfigHistory] = useState([]);
    const [reloadKey, setReloadKey] = useState(0);
    const [configModal, setConfigModal] = useState({
        open: false,
        ...defaultConfig,
    });

    useEffect(() => {
        document.title = `${pageTitle} | Admin`;
    }, []);

    useEffect(() => {
        let ignore = false;

        async function loadTable() {
            setLoading(true);

            try {
                const response = await financeApi.getDailyProfitTable(filters);
                if (ignore) return;

                const payload = response.data || {};
                setRows(payload.rows || []);
                setTotals(payload.totals || null);
                setCurrentConfig({
                    ...defaultConfig,
                    ...(payload.current_config || {}),
                });
                setConfigHistory(payload.config_history || []);
            } catch (error) {
                if (!ignore) {
                    setNotice({
                        type: 'error',
                        message: error.response?.data?.message || 'Không thể tải bảng lợi nhuận theo ngày.',
                    });
                }
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        loadTable();

        return () => {
            ignore = true;
        };
    }, [filters, reloadKey]);

    const openConfigModal = () => {
        setConfigModal({
            open: true,
            effective_date: filters.date_to || todayValue,
            return_rate: currentConfig.return_rate ?? 0,
            packaging_cost_per_order: currentConfig.packaging_cost_per_order ?? 0,
            shipping_calculation_mode: currentConfig.shipping_calculation_mode || 'fixed_per_order',
            shipping_cost_per_order: currentConfig.shipping_cost_per_order ?? 0,
            shipping_cost_rate: currentConfig.shipping_cost_rate ?? 0,
            tax_rate: currentConfig.tax_rate ?? 1.5,
            note: '',
        });
    };

    const handleSaveConfig = async () => {
        if (!configModal.effective_date) {
            setNotice({ type: 'error', message: 'Bạn cần chọn ngày áp dụng cho version cấu hình.' });
            return;
        }

        setSaving(true);

        try {
            await financeApi.saveDailyProfitConfig({
                effective_date: configModal.effective_date,
                return_rate: Number(configModal.return_rate || 0),
                packaging_cost_per_order: Number(configModal.packaging_cost_per_order || 0),
                shipping_calculation_mode: configModal.shipping_calculation_mode,
                shipping_cost_per_order: Number(configModal.shipping_cost_per_order || 0),
                shipping_cost_rate: Number(configModal.shipping_cost_rate || 0),
                tax_rate: Number(configModal.tax_rate || 1.5),
                note: configModal.note,
            });

            setNotice({ type: 'success', message: 'Đã lưu version cấu hình lợi nhuận theo ngày.' });
            setConfigModal((previous) => ({ ...previous, open: false, note: '' }));
            setReloadKey((previous) => previous + 1);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể lưu cấu hình lợi nhuận theo ngày.',
            });
        } finally {
            setSaving(false);
        }
    };

    const applyFilters = () => {
        setFilters({ ...filterDraft });
    };

    const resetToRecent30Days = () => {
        const nextFilters = {
            date_from: shiftDate(todayValue, -29),
            date_to: todayValue,
        };
        setFilterDraft(nextFilters);
        setFilters(nextFilters);
    };

    const shippingPreview = currentConfig.shipping_calculation_mode === 'revenue_percent'
        ? `${formatPercent(currentConfig.shipping_cost_rate)} x doanh thu`
        : `${formatMoney(currentConfig.shipping_cost_per_order)} / đơn`;

    const totalsRow = totals || {
        label: 'Tổng',
        revenue: 0,
        revenue_actual: 0,
        order_count: 0,
        cost_goods: 0,
        cost_goods_actual: 0,
        shipping_cost: 0,
        packaging_cost: 0,
        salary_cost: 0,
        facebook_ads_cost: 0,
        tax_cost: 0,
        fixed_expense_cost: 0,
        profit: 0,
        profit_per_order: 0,
        cost_goods_ratio: 0,
        ads_ratio: 0,
        shipping_ratio: 0,
    };

    return (
        <div className="space-y-6">
            <div className={toolbarPanelClass}>
                <div className="flex flex-wrap gap-2">
                    <NavLink
                        to="/admin/finance"
                        end
                        className={({ isActive }) => `inline-flex h-11 items-center justify-center rounded-sm px-4 text-[13px] font-black transition ${isActive ? 'bg-primary text-white' : 'text-primary hover:bg-primary/5'}`}
                    >
                        Chi phí cố định
                    </NavLink>
                    <NavLink
                        to="/admin/finance/receipts"
                        className={({ isActive }) => `inline-flex h-11 items-center justify-center rounded-sm px-4 text-[13px] font-black transition ${isActive ? 'bg-primary text-white' : 'text-primary hover:bg-primary/5'}`}
                    >
                        Phiếu thu
                    </NavLink>
                    <NavLink
                        to="/admin/finance/daily-profit"
                        className={({ isActive }) => `inline-flex h-11 items-center justify-center rounded-sm px-4 text-[13px] font-black transition ${isActive ? 'bg-primary text-white' : 'text-primary hover:bg-primary/5'}`}
                    >
                        Tính toán lợi nhuận theo ngày
                    </NavLink>
                </div>
            </div>

            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">
                        <span>Tài chính</span>
                        <span>/</span>
                        <span className="text-primary">Tính toán lợi nhuận theo ngày</span>
                    </div>
                    <div>
                        <h1 className="text-[28px] font-black tracking-tight text-primary">{pageTitle}</h1>
                        <p className="mt-1 max-w-4xl text-[13px] text-primary/60">
                            Hệ thống tự lấy đơn hàng theo ngày, map đúng chi phí cố định/ngày và áp version cấu hình theo ngày hiệu lực để tính lợi nhuận thực tế.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <AccountSelector />
                    <button type="button" className={secondaryButtonClass} onClick={resetToRecent30Days}>
                        <span className="material-symbols-outlined text-[18px]">history</span>
                        <span>30 ngày gần nhất</span>
                    </button>
                    <button type="button" className={primaryButtonClass} onClick={openConfigModal}>
                        <span className="material-symbols-outlined text-[18px]">tune</span>
                        <span>Cấu hình theo ngày áp dụng</span>
                    </button>
                </div>
            </div>

            {notice ? (
                <div className={`rounded-sm border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/25 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {notice.message}
                </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-primary/5 p-2">
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Version</span>
                    <span className="text-[13px] font-black text-primary">{formatDate(currentConfig.effective_date)}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tỉ lệ hoàn</span>
                    <span className="text-[13px] font-black text-primary">{formatPercent(currentConfig.return_rate)}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ship</span>
                    <span className="text-[13px] font-black text-primary">{currentConfig.shipping_calculation_label}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Version đã lưu</span>
                    <span className="text-[13px] font-black text-primary">{configHistory.length}</span>
                </div>
            </div>

            <div className={panelClass}>
                <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <label className="space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Từ ngày</span>
                            <input
                                type="date"
                                value={filterDraft.date_from}
                                onChange={(event) => setFilterDraft((previous) => ({ ...previous, date_from: event.target.value }))}
                                className={`${inputClass} w-full`}
                            />
                        </label>
                        <label className="space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Đến ngày</span>
                            <input
                                type="date"
                                value={filterDraft.date_to}
                                onChange={(event) => setFilterDraft((previous) => ({ ...previous, date_to: event.target.value }))}
                                className={`${inputClass} w-full`}
                            />
                        </label>
                        <div className="space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Version cấu hình hiện tại</span>
                            <div className="flex h-10 items-center rounded-sm border border-primary/10 bg-[#f8fbff] px-3 text-[13px] font-black text-primary">
                                {formatDate(currentConfig.effective_date)}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={applyFilters}>
                            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                            <span>Áp dụng bộ lọc</span>
                        </button>
                        <button type="button" className={primaryButtonClass} onClick={openConfigModal}>
                            <span className="material-symbols-outlined text-[18px]">save</span>
                            <span>Lưu version cấu hình</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng hiện tại</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatDate(currentConfig.effective_date)}</p>
                </div>
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tỉ lệ hoàn</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatPercent(currentConfig.return_rate)}</p>
                </div>
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí gói/đơn</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatMoney(currentConfig.packaging_cost_per_order)}</p>
                </div>
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính ship hàng</p>
                    <p className="mt-3 text-[18px] font-black text-primary">{currentConfig.shipping_calculation_label}</p>
                    <p className="mt-2 text-[12px] text-primary/55">{shippingPreview}</p>
                </div>
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Thuế đang áp dụng</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatPercent(currentConfig.tax_rate)}</p>
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.5fr_0.9fr]">
                <div className={dataPanelClass}>
                    <div className="border-b border-primary/10 px-5 py-4">
                        <h2 className="text-[18px] font-black text-primary">Bảng tính lợi nhuận theo ngày</h2>
                        <p className="mt-1 text-[12px] text-primary/55">Bảng lấy dữ liệu đơn hàng từ 00:00 đến 24:00 của từng ngày, cộng thêm cấu hình hiệu lực theo ngày.</p>
                    </div>

                    <div className={tableFrameClass}>
                        <table className={`${reportTableClass} min-w-[1900px]`}>
                            <thead className={stickyHeaderClass}>
                                <tr>
                                    {[
                                        'Ngày',
                                        'Doanh thu',
                                        'Doanh thu thực',
                                        'Số đơn',
                                        'Tiền hàng',
                                        'Tiền hàng thực tế',
                                        'Chi phí ship hàng',
                                        'Chi phí gói hàng',
                                        'Chi phí lương',
                                        'QC trên fb',
                                        'Thuế',
                                        'Chi phí cố định',
                                        'Lợi nhuận',
                                        'Lợi nhuận / 1 đơn',
                                        '% Tiền hàng',
                                        '% Quảng cáo',
                                        '% Chi phí ship hàng',
                                    ].map((label) => (
                                        <th key={label} className={headerCellClass}>
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={17} className="px-5 py-10 text-center text-[13px] font-semibold text-primary/45">Đang tính toán lợi nhuận theo ngày...</td>
                                    </tr>
                                ) : rows.map((row) => (
                                    <tr key={row.date} className="transition-colors odd:bg-white even:bg-primary/[0.02] hover:bg-gold/5">
                                        <td className={bodyCellClass}>
                                            <p className="font-black text-primary">{row.label}</p>
                                            <p className="mt-1 text-[10px] text-primary/45">Config: {formatDate(row.config_effective_date)}</p>
                                            <p className="text-[10px] text-primary/45">CP cố định: {formatDate(row.fixed_expense_effective_date)}</p>
                                        </td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.revenue)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.revenue_actual)}</td>
                                        <td className={numericBodyCellClass}>{row.order_count}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.cost_goods)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.cost_goods_actual)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.shipping_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.packaging_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.salary_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.facebook_ads_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.tax_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.fixed_expense_cost)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.profit)}</td>
                                        <td className={numericBodyCellClass}>{formatMoney(row.profit_per_order)}</td>
                                        <td className={numericBodyCellClass}>{formatPercentRatio(row.cost_goods_ratio)}</td>
                                        <td className={numericBodyCellClass}>{formatPercentRatio(row.ads_ratio)}</td>
                                        <td className={numericBodyCellClass}>{formatPercentRatio(row.shipping_ratio)}</td>
                                    </tr>
                                ))}
                            </tbody>

                            <tfoot className="bg-[#fbfcfe]">
                                <tr>
                                    <td className={headerCellClass}>{totalsRow.label}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.revenue)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.revenue_actual)}</td>
                                    <td className={`${headerCellClass} text-right`}>{totalsRow.order_count}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.cost_goods)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.cost_goods_actual)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.shipping_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.packaging_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.salary_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.facebook_ads_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.tax_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.fixed_expense_cost)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.profit)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatMoney(totalsRow.profit_per_order)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatPercentRatio(totalsRow.cost_goods_ratio)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatPercentRatio(totalsRow.ads_ratio)}</td>
                                    <td className={`${headerCellClass} text-right`}>{formatPercentRatio(totalsRow.shipping_ratio)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                <div className="space-y-5">
                    <div className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <h2 className="text-[18px] font-black text-primary">Cấu hình hiện tại</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Version này sẽ được dùng cho toàn bộ ngày nằm sau mốc hiệu lực gần nhất.</p>
                        </div>

                        <div className="space-y-4 p-5">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fbff] p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng</p>
                                <p className="mt-2 text-[18px] font-black text-primary">{formatDate(currentConfig.effective_date)}</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tỉ lệ hoàn</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatPercent(currentConfig.return_rate)}</p>
                                </div>
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Gói hàng / đơn</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatMoney(currentConfig.packaging_cost_per_order)}</p>
                                </div>
                            </div>

                            <div className="rounded-sm border border-primary/10 p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính ship hàng</p>
                                <p className="mt-2 text-[14px] font-black text-primary">{currentConfig.shipping_calculation_label}</p>
                                <p className="mt-2 text-[12px] text-primary/55">{shippingPreview}</p>
                            </div>

                            <div className="rounded-sm border border-primary/10 p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Thuế áp dụng</p>
                                <p className="mt-2 text-[14px] font-black text-primary">{formatPercent(currentConfig.tax_rate)}</p>
                            </div>

                            {currentConfig.note ? (
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú</p>
                                    <p className="mt-2 text-[13px] leading-6 text-primary/70">{currentConfig.note}</p>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <h2 className="text-[18px] font-black text-primary">Lịch sử cấu hình theo ngày áp dụng</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Mỗi lần lưu sẽ tạo một version mới để xem báo cáo quá khứ không bị sai.</p>
                        </div>

                        <div className="space-y-3 p-5">
                            {configHistory.length ? configHistory.map((version) => (
                                <div key={`${version.id}-${version.effective_date}`} className={`rounded-sm border px-4 py-4 ${version.id === currentConfig.id ? 'border-primary bg-primary/[0.04]' : 'border-primary/10 bg-white'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-[14px] font-black text-primary">{formatDate(version.effective_date)}</p>
                                                {version.id === currentConfig.id ? <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">Đang áp dụng</span> : null}
                                            </div>
                                            <p className="mt-1 text-[12px] text-primary/55">Tỉ lệ hoàn {formatPercent(version.return_rate)}</p>
                                            <p className="mt-1 text-[12px] text-primary/55">{version.shipping_calculation_label}</p>
                                            {version.note ? <p className="mt-2 text-[12px] leading-5 text-primary/60">{version.note}</p> : null}
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[12px] font-black text-primary">{formatMoney(version.packaging_cost_per_order)}/đơn</p>
                                            <p className="mt-1 text-[12px] text-primary/55">{version.shipping_calculation_mode === 'revenue_percent' ? formatPercent(version.shipping_cost_rate) : formatMoney(version.shipping_cost_per_order)}</p>
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="px-4 py-6 text-center text-[13px] font-semibold text-primary/45">Chưa có lịch sử cấu hình.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ModalShell
                open={configModal.open}
                title="Áp dụng cấu hình lợi nhuận mới từ ngày nào?"
                onClose={() => setConfigModal((previous) => ({ ...previous, open: false }))}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={() => setConfigModal((previous) => ({ ...previous, open: false }))}>
                            Hủy
                        </button>
                        <button type="button" className={primaryButtonClass} onClick={handleSaveConfig} disabled={saving}>
                            <span className="material-symbols-outlined text-[18px]">{saving ? 'hourglass_top' : 'save'}</span>
                            <span>Lưu version mới</span>
                        </button>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="rounded-sm border border-primary/10 bg-[#f8fbff] px-4 py-4">
                        <p className="text-[12px] font-semibold leading-6 text-primary/65">
                            Từ ngày hiệu lực bạn chọn, toàn bộ báo cáo lợi nhuận theo ngày sẽ dùng bộ cấu hình mới để tính doanh thu thực, tiền hàng thực tế, ship, gói hàng và lợi nhuận.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng</span>
                            <input
                                type="date"
                                className={`${inputClass} w-full`}
                                value={configModal.effective_date}
                                onChange={(event) => setConfigModal((previous) => ({ ...previous, effective_date: event.target.value }))}
                            />
                        </label>

                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Tỉ lệ hoàn (%)</span>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className={`${inputClass} w-full`}
                                value={configModal.return_rate}
                                onChange={(event) => setConfigModal((previous) => ({ ...previous, return_rate: event.target.value }))}
                            />
                        </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí gói hàng / đơn</span>
                            <input
                                type="number"
                                min="0"
                                step="1000"
                                className={`${inputClass} w-full`}
                                value={configModal.packaging_cost_per_order}
                                onChange={(event) => setConfigModal((previous) => ({ ...previous, packaging_cost_per_order: event.target.value }))}
                            />
                        </label>

                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Thuế (%)</span>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className={`${inputClass} w-full`}
                                value={configModal.tax_rate}
                                onChange={(event) => setConfigModal((previous) => ({ ...previous, tax_rate: event.target.value }))}
                            />
                        </label>
                    </div>

                    <div className="space-y-3 rounded-sm border border-primary/10 p-4">
                        <p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính chi phí ship hàng</p>
                        <select
                            className={`${inputClass} w-full pr-8`}
                            value={configModal.shipping_calculation_mode}
                            onChange={(event) => setConfigModal((previous) => ({ ...previous, shipping_calculation_mode: event.target.value }))}
                        >
                            <option value="fixed_per_order">Số đơn x số tiền cố định/đơn</option>
                            <option value="revenue_percent">% x doanh thu</option>
                        </select>

                        {configModal.shipping_calculation_mode === 'revenue_percent' ? (
                            <label className="space-y-2">
                                <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Tỉ lệ ship trên doanh thu (%)</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    className={`${inputClass} w-full`}
                                    value={configModal.shipping_cost_rate}
                                    onChange={(event) => setConfigModal((previous) => ({ ...previous, shipping_cost_rate: event.target.value }))}
                                />
                            </label>
                        ) : (
                            <label className="space-y-2">
                                <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Phí ship cố định / đơn</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="1000"
                                    className={`${inputClass} w-full`}
                                    value={configModal.shipping_cost_per_order}
                                    onChange={(event) => setConfigModal((previous) => ({ ...previous, shipping_cost_per_order: event.target.value }))}
                                />
                            </label>
                        )}
                    </div>

                    <label className="space-y-2">
                        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú version</span>
                        <textarea
                            className="min-h-[110px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary"
                            placeholder="Ví dụ: từ ngày 30 đổi tỉ lệ hoàn và cách tính ship theo doanh thu..."
                            value={configModal.note}
                            onChange={(event) => setConfigModal((previous) => ({ ...previous, note: event.target.value }))}
                        />
                    </label>
                </div>
            </ModalShell>
        </div>
    );
}
