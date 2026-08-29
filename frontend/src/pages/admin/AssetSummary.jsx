import React, { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { financeApi } from '../../services/api';

const formatCurrency = (value) => (
    `${Math.round(Number(value) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`
);

const normalizeMoneyInput = (value) => String(value ?? '').replace(/\D/g, '');

const formatMoneyInput = (value) => {
    const digits = normalizeMoneyInput(value);
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const toNumber = (value) => Number(value) || 0;

const formatPercent = (value) => {
    const number = Number(value) || 0;
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const emptyAssetSummary = {
    summary: {
        net_assets: 0,
        gross_assets: 0,
        deductions: 0,
        fund_balance: 0,
        inventory_value: 0,
        delivered_unpaid_amount: 0,
        pending_orders_net_amount: 0,
        other_deductions_amount: 0,
        debt_payable: 0,
    },
    settings: {
        delivered_unpaid_amount: 0,
        other_deductions_amount: 0,
        note: '',
    },
    rows: [],
    pending_orders: {
        gross_cod_amount: 0,
        order_count: 0,
        order_ids: [],
        return_rate: 0,
        after_return_amount: 0,
        shipping_cost: 0,
        recorded_shipping_cost: 0,
        estimated_shipping_cost: 0,
        packaging_cost: 0,
        packaging_order_count: 0,
        tax_cost: 0,
        net_amount: 0,
        config: {},
    },
};

const assetRowToneMap = {
    plus: {
        pill: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        amount: 'text-emerald-700',
        icon: 'add',
        sign: '+',
        label: 'Cộng',
    },
    minus: {
        pill: 'bg-rose-50 text-rose-700 border-rose-100',
        amount: 'text-rose-700',
        icon: 'remove',
        sign: '-',
        label: 'Trừ',
    },
};

const assetSourceLabelMap = {
    auto: 'Tự động',
    manual: 'Nhập tay',
};

const assetSourceToneMap = {
    auto: 'bg-blue-50 text-blue-700 border-blue-100',
    manual: 'bg-amber-50 text-amber-700 border-amber-100',
};

const assetLabelMap = {
    fund_balance: 'Tiền trong sổ',
    inventory_value: 'Tồn kho',
    delivered_unpaid: 'VTP đã giao chưa trả',
    pending_orders: 'Đơn mới/đang giao dự kiến',
    other_deductions: 'Chi khác',
    debt_payable: 'Nợ phải trả',
};

const assetNoteMap = {
    fund_balance: 'Tiền mặt + ngân hàng trong sổ cái',
    inventory_value: 'Có thể bán * giá vốn/gia dự kiến',
    delivered_unpaid: 'Nhập tay theo số ViettelPost chưa đối soát',
    pending_orders: 'COD sau hoàn - ship - đóng gói - thuế',
    other_deductions: 'Khoản chi/dự phòng nhập tay',
    debt_payable: 'Nợ đầu kỳ + ghi nợ - trả gốc',
};

const assetFormulaLabel = 'Tiền trong sổ + Tồn kho + VTP đã giao chưa trả + Đơn mới/đang giao dự kiến - Chi khác - Nợ phải trả';

export default function AssetSummary() {
    const {
        isMobileSidebarOpen = false,
        isSidebarDrawerMode = false,
        toggleMobileSidebar,
    } = useOutletContext() || {};
    const [loading, setLoading] = useState(true);
    const [assetSummary, setAssetSummary] = useState(emptyAssetSummary);
    const [assetDraft, setAssetDraft] = useState({
        delivered_unpaid_amount: '',
        other_deductions_amount: '',
        note: '',
    });
    const [saving, setSaving] = useState(false);
    const [showPendingDetail, setShowPendingDetail] = useState(false);

    const applyAssetSummaryPayload = useCallback((payload) => {
        const nextAssetSummary = payload || emptyAssetSummary;
        const settings = nextAssetSummary.settings || emptyAssetSummary.settings;

        setAssetSummary({
            ...emptyAssetSummary,
            ...nextAssetSummary,
            summary: {
                ...emptyAssetSummary.summary,
                ...(nextAssetSummary.summary || {}),
            },
            settings: {
                ...emptyAssetSummary.settings,
                ...settings,
            },
            pending_orders: {
                ...emptyAssetSummary.pending_orders,
                ...(nextAssetSummary.pending_orders || {}),
                config: {
                    ...emptyAssetSummary.pending_orders.config,
                    ...(nextAssetSummary.pending_orders?.config || {}),
                },
            },
            rows: Array.isArray(nextAssetSummary.rows) ? nextAssetSummary.rows : [],
        });
        setAssetDraft({
            delivered_unpaid_amount: normalizeMoneyInput(Math.round(Number(settings.delivered_unpaid_amount || 0))),
            other_deductions_amount: normalizeMoneyInput(Math.round(Number(settings.other_deductions_amount || 0))),
            note: settings.note || '',
        });
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const response = await financeApi.getFundAssetSummary();
            if (response.data.status === 'success') {
                applyAssetSummaryPayload(response.data.data);
            }
        } catch (error) {
            console.error('Lỗi tải tổng tài sản', error);
            alert(error.response?.data?.message || 'Lỗi tải tổng tài sản');
        } finally {
            setLoading(false);
        }
    }, [applyAssetSummaryPayload]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSave = async (event) => {
        event.preventDefault();
        setSaving(true);

        try {
            const response = await financeApi.saveFundAssetSummarySettings({
                delivered_unpaid_amount: Number(assetDraft.delivered_unpaid_amount || 0),
                other_deductions_amount: Number(assetDraft.other_deductions_amount || 0),
                note: assetDraft.note || '',
            });

            if (response.data.status === 'success') {
                applyAssetSummaryPayload(response.data.data);
            }
        } catch (error) {
            alert(error.response?.data?.message || 'Lỗi lưu tổng tài sản');
        } finally {
            setSaving(false);
        }
    };

    const rows = Array.isArray(assetSummary.rows) ? assetSummary.rows : [];
    const asset = assetSummary.summary || emptyAssetSummary.summary;
    const pendingOrders = assetSummary.pending_orders || emptyAssetSummary.pending_orders;
    const pendingConfig = pendingOrders.config || {};
    const pendingOrderIds = Array.isArray(pendingOrders.order_ids)
        ? pendingOrders.order_ids
            .map((id) => Number.parseInt(id, 10))
            .filter((id) => Number.isInteger(id) && id > 0)
        : [];
    const pendingOrdersUrl = pendingOrderIds.length
        ? `/admin/orders?order_ids=${encodeURIComponent(pendingOrderIds.join(','))}`
        : '/admin/orders';
    const pendingReturnAmount = Math.max(0, toNumber(pendingOrders.gross_cod_amount) - toNumber(pendingOrders.after_return_amount));
    const pendingPackagingOrderCount = Number(pendingOrders.packaging_order_count || 0);
    const pendingPackagingCostPerOrder = toNumber(pendingConfig.packaging_cost_per_order);
    const pendingTaxRate = toNumber(pendingConfig.tax_rate);
    const pendingShippingRate = toNumber(pendingConfig.shipping_cost_rate);
    const pendingShippingPerOrder = toNumber(pendingConfig.shipping_cost_per_order);
    const pendingShippingFormula = pendingConfig.shipping_calculation_mode === 'revenue_percent'
        ? `Thiếu ship: ${formatPercent(pendingShippingRate)}% x COD đơn thiếu phí ship`
        : `Thiếu ship: ${formatCurrency(pendingShippingPerOrder)} x số đơn thiếu phí ship`;
    const pendingFormulaNote = [
        `COD ${formatCurrency(pendingOrders.gross_cod_amount)}`,
        `trừ hoàn ${formatCurrency(pendingReturnAmount)} (${formatPercent(pendingOrders.return_rate)}%)`,
        `trừ ship ${formatCurrency(pendingOrders.shipping_cost)} (ghi nhận ${formatCurrency(pendingOrders.recorded_shipping_cost)} + ước tính ${formatCurrency(pendingOrders.estimated_shipping_cost)})`,
        `trừ đóng gói ${formatCurrency(pendingOrders.packaging_cost)} (${pendingPackagingOrderCount} đơn chưa gửi x ${formatCurrency(pendingPackagingCostPerOrder)})`,
        `trừ thuế ${formatCurrency(pendingOrders.tax_cost)}`,
        `= ${formatCurrency(pendingOrders.net_amount)}`,
    ].join(' - ');
    const getAssetRowNote = (row) => (
        row.key === 'pending_orders'
            ? pendingFormulaNote
            : (assetNoteMap[row.key] || row.note)
    );
    const metricCards = [
        {
            label: 'Tài sản ròng',
            value: asset.net_assets,
            icon: 'account_balance_wallet',
            tone: 'border-blue-200 bg-blue-50 text-blue-700',
            valueClass: 'text-blue-800',
        },
        {
            label: 'Tổng khoản cộng',
            value: asset.gross_assets,
            icon: 'add_chart',
            tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            valueClass: 'text-emerald-700',
        },
        {
            label: 'Tổng khoản trừ',
            value: asset.deductions,
            icon: 'remove_circle',
            tone: 'border-rose-200 bg-rose-50 text-rose-700',
            valueClass: 'text-rose-700',
        },
        {
            label: 'Đơn đang giao',
            value: pendingOrders.net_amount,
            icon: 'local_shipping',
            tone: 'border-amber-200 bg-amber-50 text-amber-700',
            valueClass: 'text-amber-700',
            sub: `${pendingOrders.order_count || 0} đơn`,
        },
    ];
    const pendingBreakdown = [
        ['COD gốc', pendingOrders.gross_cod_amount, `${pendingOrders.order_count || 0} đơn đang tính tài sản`],
        [`Trừ hoàn (${formatPercent(pendingOrders.return_rate)}%)`, pendingReturnAmount, 'Theo cài đặt tham số kinh nghiệm'],
        ['COD sau hoàn', pendingOrders.after_return_amount, `${formatCurrency(pendingOrders.gross_cod_amount)} - ${formatCurrency(pendingReturnAmount)}`],
        ['Trừ ship tổng', pendingOrders.shipping_cost, `${formatCurrency(pendingOrders.recorded_shipping_cost)} đã ghi nhận + ${formatCurrency(pendingOrders.estimated_shipping_cost)} ước tính`],
        ['Ship đã ghi nhận', pendingOrders.recorded_shipping_cost, 'Lấy từ đơn/vận đơn đã có phí ship'],
        ['Ship ước tính', pendingOrders.estimated_shipping_cost, pendingShippingFormula],
        [`Trừ đóng gói (${pendingPackagingOrderCount} đơn chưa gửi)`, pendingOrders.packaging_cost, `${pendingPackagingOrderCount} đơn chưa gửi x ${formatCurrency(pendingPackagingCostPerOrder)}/đơn`],
        [`Trừ thuế (${formatPercent(pendingTaxRate)}%)`, pendingOrders.tax_cost, `(${formatCurrency(pendingOrders.after_return_amount)} - ${formatCurrency(pendingOrders.shipping_cost)}) x ${formatPercent(pendingTaxRate)}%`],
    ];
    const pendingNoteItems = [
        { label: 'COD gốc', value: pendingOrders.gross_cod_amount, tone: 'plus', note: `${pendingOrders.order_count || 0} đơn đang tính tài sản` },
        { label: `Trừ hoàn ${formatPercent(pendingOrders.return_rate)}%`, value: pendingReturnAmount, tone: 'minus', note: `Theo cài đặt tham số kinh nghiệm` },
        { label: 'COD sau hoàn', value: pendingOrders.after_return_amount, tone: 'plus', note: `${formatCurrency(pendingOrders.gross_cod_amount)} - ${formatCurrency(pendingReturnAmount)}` },
        { label: 'Trừ ship tổng', value: pendingOrders.shipping_cost, tone: 'minus', note: `${formatCurrency(pendingOrders.recorded_shipping_cost)} đã ghi nhận + ${formatCurrency(pendingOrders.estimated_shipping_cost)} ước tính` },
        { label: 'Ship đã ghi nhận', value: pendingOrders.recorded_shipping_cost, tone: 'muted', note: 'Lấy từ đơn/vận đơn đã có phí ship' },
        { label: 'Ship ước tính', value: pendingOrders.estimated_shipping_cost, tone: 'muted', note: pendingShippingFormula },
        { label: 'Trừ đóng gói', value: pendingOrders.packaging_cost, tone: 'minus', note: `${pendingPackagingOrderCount} đơn chưa gửi x ${formatCurrency(pendingPackagingCostPerOrder)}/đơn` },
        { label: `Trừ thuế ${formatPercent(pendingTaxRate)}%`, value: pendingOrders.tax_cost, tone: 'minus', note: `(${formatCurrency(pendingOrders.after_return_amount)} - ${formatCurrency(pendingOrders.shipping_cost)}) x ${formatPercent(pendingTaxRate)}%` },
    ];
    const pendingFormulaSummary = `Còn tính = COD sau hoàn ${formatCurrency(pendingOrders.after_return_amount)} - ship ${formatCurrency(pendingOrders.shipping_cost)} - đóng gói ${formatCurrency(pendingOrders.packaging_cost)} - thuế ${formatCurrency(pendingOrders.tax_cost)} = ${formatCurrency(pendingOrders.net_amount)}`;
    const pendingOrderFilterButtonClass = pendingOrderIds.length
        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
        : 'pointer-events-none border-gray-100 bg-gray-50 text-gray-400';
    const pendingNoteValueClass = (tone) => {
        if (tone === 'plus') return 'text-emerald-700';
        if (tone === 'minus') return 'text-rose-700';
        return 'text-gray-500';
    };
    const renderPendingOrdersNote = (compact = false) => (
        <div className={`${compact ? 'mt-2' : 'py-1'} space-y-2`}>
            <button
                type="button"
                onClick={() => setShowPendingDetail((current) => !current)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-2.5 text-[11px] font-extrabold text-blue-700 transition-colors hover:bg-blue-100"
                aria-expanded={showPendingDetail}
            >
                <span className="material-symbols-outlined text-[16px]">{showPendingDetail ? 'visibility_off' : 'visibility'}</span>
                {showPendingDetail ? 'Ẩn chi tiết' : 'Xem chi tiết'}
            </button>

            {showPendingDetail && (
                <div className="space-y-1.5">
                    <div className={`grid gap-x-3 gap-y-1 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        {pendingNoteItems.map((item) => (
                            <div key={item.label} className="min-w-0 rounded-md border border-gray-100 bg-white px-2 py-1 text-[11px] leading-4">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <span className="min-w-0 truncate font-semibold text-gray-500">{item.label}</span>
                                    <span className={`shrink-0 font-extrabold ${pendingNoteValueClass(item.tone)}`}>{formatCurrency(item.value)}</span>
                                </div>
                                <p className="mt-0.5 truncate text-[10px] font-semibold text-gray-400" title={item.note}>{item.note}</p>
                            </div>
                        ))}
                    </div>
                    <div className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-bold leading-4 text-emerald-700">
                        {pendingFormulaSummary}
                    </div>
                    <Link
                        to={pendingOrdersUrl}
                        className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[11px] font-extrabold transition-colors ${pendingOrderFilterButtonClass}`}
                        aria-disabled={!pendingOrderIds.length}
                        title={pendingOrderIds.length ? `Mở và lọc ${pendingOrderIds.length} đơn đang được tính vào tài sản` : 'Chưa có đơn đang giao để lọc'}
                    >
                        <span className="material-symbols-outlined text-[16px]">filter_alt</span>
                        Lọc {pendingOrderIds.length || 0} đơn
                    </Link>
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-[#f8f9fa] p-2 pt-1.5 font-sans sm:p-4 md:p-6">
            <div className="mb-2 flex min-w-0 items-center gap-1.5 lg:mb-4 lg:gap-4">
                {isSidebarDrawerMode && (
                    <button
                        type="button"
                        onClick={toggleMobileSidebar}
                        aria-expanded={isMobileSidebarOpen}
                        aria-controls="admin-mobile-sidebar"
                        className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-primary/10 bg-white px-2 text-primary shadow-[0_8px_22px_rgba(27,54,93,0.08)] transition-colors hover:bg-primary hover:text-white lg:hidden"
                    >
                        <span className="material-symbols-outlined text-[20px] leading-none">{isMobileSidebarOpen ? 'close' : 'menu'}</span>
                        <span className="hidden text-[11px] font-bold uppercase tracking-[0.08em] sm:inline">Menu</span>
                    </button>
                )}
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-[18px] font-extrabold tracking-tight text-gray-900 lg:text-[22px]">
                        Tổng tài sản
                    </h1>
                    <p className="mt-0.5 hidden truncate text-[12px] font-medium text-gray-500 sm:block">{assetFormulaLabel}</p>
                </div>
                <button
                    type="button"
                    onClick={loadData}
                    className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                    title="Làm mới"
                    aria-label="Làm mới tổng tài sản"
                >
                    <span className={`material-symbols-outlined text-[19px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                    <span className="hidden sm:inline">Làm mới</span>
                </button>
            </div>

            <div className="relative space-y-4">
                {loading && (
                    <div className="absolute inset-0 z-20 flex min-h-[320px] items-center justify-center rounded-lg bg-white/60 backdrop-blur-[1px]">
                        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
                    {metricCards.map((card) => (
                        <article key={card.label} className="relative min-w-0 overflow-hidden rounded-lg border border-gray-100 bg-white p-3 shadow-[0_2px_10px_rgba(0,0,0,0.04)] lg:p-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${card.tone}`}>
                                    <span className="material-symbols-outlined text-[20px]">{card.icon}</span>
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-[11px] font-bold uppercase text-gray-500">{card.label}</p>
                                    <p className={`break-words text-[15px] font-extrabold leading-tight lg:text-[18px] ${card.valueClass}`}>
                                        {formatCurrency(card.value)}
                                    </p>
                                    {card.sub && <p className="mt-0.5 text-[11px] font-semibold text-gray-400">{card.sub}</p>}
                                </div>
                            </div>
                        </article>
                    ))}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                    <section className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                        <div className="flex min-w-0 items-center justify-between gap-3 border-b border-gray-100 bg-slate-50 px-3 py-3 lg:px-4">
                            <div className="min-w-0">
                                <h2 className="truncate text-[15px] font-extrabold text-gray-900">Bảng tổng tài sản</h2>
                                <p className="mt-0.5 truncate text-[12px] font-medium text-gray-500">{assetFormulaLabel}</p>
                            </div>
                        </div>

                        <div className="hidden overflow-x-auto lg:block">
                            <table className="w-full table-fixed border-collapse text-[13px]">
                                <thead>
                                    <tr className="h-10 border-b border-gray-100 bg-white text-left text-[11px] font-bold uppercase text-gray-500">
                                        <th className="w-[28%] px-4">Khoản mục</th>
                                        <th className="w-[13%] px-3 text-center">Loại</th>
                                        <th className="w-[13%] px-3 text-center">Nguồn</th>
                                        <th className="w-[20%] px-3 text-right">Số tiền</th>
                                        <th className="px-4">Ghi chú</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const tone = assetRowToneMap[row.type] || assetRowToneMap.plus;
                                        const sourceTone = assetSourceToneMap[row.source] || assetSourceToneMap.auto;

                                        return (
                                            <tr key={row.key} className="h-14 border-b border-gray-100 last:border-0 hover:bg-slate-50">
                                                <td className="px-4 align-middle">
                                                    <span className="block truncate font-bold text-gray-900">{assetLabelMap[row.key] || row.label}</span>
                                                </td>
                                                <td className="px-3 text-center align-middle">
                                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${tone.pill}`}>
                                                        <span className="material-symbols-outlined text-[15px]">{tone.icon}</span>
                                                        {tone.label}
                                                    </span>
                                                </td>
                                                <td className="px-3 text-center align-middle">
                                                    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${sourceTone}`}>
                                                        {assetSourceLabelMap[row.source] || row.source}
                                                    </span>
                                                </td>
                                                <td className={`px-3 text-right align-middle text-[15px] font-extrabold ${tone.amount}`}>
                                                    {tone.sign}{formatCurrency(row.amount)}
                                                </td>
                                                <td className="px-4 align-middle">
                                                    {row.key === 'pending_orders' ? renderPendingOrdersNote() : (
                                                        <span
                                                            className="block truncate text-[12px] font-medium text-gray-500"
                                                            title={getAssetRowNote(row)}
                                                        >
                                                            {getAssetRowNote(row)}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="h-14 bg-slate-900 text-white">
                                        <td className="px-4 text-[14px] font-extrabold" colSpan={3}>Tổng tài sản ròng</td>
                                        <td className="px-3 text-right text-[18px] font-extrabold">{formatCurrency(asset.net_assets)}</td>
                                        <td className="px-4 text-[12px] font-semibold text-slate-300">Đã trừ chi khác và nợ phải trả</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div className="space-y-2 p-3 lg:hidden">
                            {rows.map((row) => {
                                const tone = assetRowToneMap[row.type] || assetRowToneMap.plus;
                                const sourceTone = assetSourceToneMap[row.source] || assetSourceToneMap.auto;

                                return (
                                    <article key={row.key} className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                                        <div className="flex min-w-0 items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] font-extrabold text-gray-900">{assetLabelMap[row.key] || row.label}</p>
                                                {row.key === 'pending_orders'
                                                    ? renderPendingOrdersNote(true)
                                                    : <p className="mt-1 line-clamp-2 text-[12px] text-gray-500">{getAssetRowNote(row)}</p>}
                                            </div>
                                            <p className={`shrink-0 text-right text-[14px] font-extrabold ${tone.amount}`}>
                                                {tone.sign}{formatCurrency(row.amount)}
                                            </p>
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone.pill}`}>
                                                <span className="material-symbols-outlined text-[14px]">{tone.icon}</span>
                                                {tone.label}
                                            </span>
                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${sourceTone}`}>
                                                {assetSourceLabelMap[row.source] || row.source}
                                            </span>
                                        </div>
                                    </article>
                                );
                            })}
                            <div className="rounded-lg bg-slate-900 p-3 text-white">
                                <p className="text-[11px] font-bold uppercase text-slate-300">Tổng tài sản ròng</p>
                                <p className="mt-1 break-words text-[20px] font-extrabold">{formatCurrency(asset.net_assets)}</p>
                            </div>
                        </div>
                    </section>

                    <aside className="min-w-0 space-y-4">
                        <form onSubmit={handleSave} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-[15px] font-extrabold text-gray-900">Khoản nhập tay</h2>
                                <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">Nhập tay</span>
                            </div>

                            <label className="mb-3 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">VTP đã giao chưa trả</span>
                                <div className="relative">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 pr-9 text-right text-[15px] font-bold text-gray-900 outline-none focus:border-blue-500"
                                        value={formatMoneyInput(assetDraft.delivered_unpaid_amount)}
                                        onChange={(event) => setAssetDraft(prev => ({
                                            ...prev,
                                            delivered_unpaid_amount: normalizeMoneyInput(event.target.value),
                                        }))}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-gray-400">đ</span>
                                </div>
                            </label>

                            <label className="mb-3 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Chi khác cần trừ</span>
                                <div className="relative">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 pr-9 text-right text-[15px] font-bold text-gray-900 outline-none focus:border-blue-500"
                                        value={formatMoneyInput(assetDraft.other_deductions_amount)}
                                        onChange={(event) => setAssetDraft(prev => ({
                                            ...prev,
                                            other_deductions_amount: normalizeMoneyInput(event.target.value),
                                        }))}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-gray-400">đ</span>
                                </div>
                            </label>

                            <label className="mb-4 block">
                                <span className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Ghi chú</span>
                                <textarea
                                    className="min-h-[88px] w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500"
                                    value={assetDraft.note}
                                    onChange={(event) => setAssetDraft(prev => ({ ...prev, note: event.target.value }))}
                                />
                            </label>

                            <button
                                type="submit"
                                disabled={saving}
                                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? (
                                    <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></span>
                                ) : (
                                    <span className="material-symbols-outlined text-[18px]">save</span>
                                )}
                                Lưu tổng tài sản
                            </button>
                        </form>

                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                                <h2 className="truncate text-[15px] font-extrabold text-gray-900">Chi tiết đơn đang giao</h2>
                                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-bold text-gray-600">{pendingOrders.order_count || 0} đơn</span>
                            </div>
                            <div className="space-y-2">
                                {pendingBreakdown.map(([label, value, note]) => (
                                    <div key={label} className="text-[13px]">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="min-w-0 truncate font-medium text-gray-500">{label}</span>
                                            <span className="shrink-0 font-bold text-gray-900">{formatCurrency(value)}</span>
                                        </div>
                                        {note ? <p className="mt-0.5 truncate text-[11px] font-medium text-gray-400" title={note}>{note}</p> : null}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-3 border-t border-gray-100 pt-3">
                                <div className="flex items-center justify-between gap-3 text-[13px]">
                                    <span className="font-bold text-gray-800">Còn tính vào tài sản</span>
                                    <span className="font-extrabold text-emerald-700">{formatCurrency(pendingOrders.net_amount)}</span>
                                </div>
                                <p className="mt-2 text-[12px] leading-5 text-gray-500">
                                    Hoàn/đóng gói/thuế theo tham số kinh nghiệm · Đóng gói: {pendingPackagingOrderCount} đơn chưa gửi x {formatCurrency(pendingPackagingCostPerOrder)}/đơn · Ship: {pendingConfig.shipping_calculation_label || 'Theo cấu hình'} · Thuế: {formatPercent(pendingTaxRate)}%
                                </p>
                                <Link
                                    to={pendingOrdersUrl}
                                    className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-[13px] font-bold transition-colors ${pendingOrderIds.length ? 'bg-amber-500 text-white hover:bg-amber-600' : 'pointer-events-none bg-gray-100 text-gray-400'}`}
                                    aria-disabled={!pendingOrderIds.length}
                                    title={pendingOrderIds.length ? `Mở ${pendingOrderIds.length} đơn đang được tính vào tài sản` : 'Chưa có đơn đang giao để lọc'}
                                >
                                    <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                                    Xem các đơn này
                                </Link>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}
