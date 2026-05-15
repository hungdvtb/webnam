import React, { useState, useEffect, useCallback } from 'react';
import { financeApi } from '../../services/api';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0));
const padNumber = (value) => String(value).padStart(2, '0');
const formatInputDate = (date) => `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
const getMonthStartInputDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${padNumber(now.getMonth() + 1)}-01`;
};
const getStartOfWeek = (date) => {
    const start = new Date(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return start;
};
const formatDisplayDate = (value) => {
    if (!value) return '-';

    if (typeof value === 'string') {
        const parts = value.slice(0, 10).split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            if (year && month && day) {
                return `${day}/${month}/${year}`;
            }
        }
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${padNumber(date.getDate())}/${padNumber(date.getMonth() + 1)}/${date.getFullYear()}`;
};

const AD_CHANNEL_OPTIONS = [
    { value: 'all', label: 'Tất cả kênh' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'google', label: 'Google' },
];

const IconBase = ({ size = 20, className = '', children }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        {children}
    </svg>
);

const TrendingUp = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M3 17l6-6 4 4 7-7" />
        <path d="M14 8h6v6" />
    </IconBase>
);

const DollarSign = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M12 2v20" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14.5a3.5 3.5 0 0 1 0 7H6" />
    </IconBase>
);

const Package = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M21 8.5L12 13 3 8.5" />
        <path d="M3 8.5L12 4l9 4.5v7L12 20l-9-4.5z" />
        <path d="M12 13v7" />
    </IconBase>
);

const Settings = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.4 1z" />
    </IconBase>
);

const BarChart3 = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M3 3v18h18" />
        <path d="M8 15V9" />
        <path d="M12 15V5" />
        <path d="M16 15v-3" />
    </IconBase>
);

const Filter = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M4 5h16" />
        <path d="M7 12h10" />
        <path d="M10 19h4" />
    </IconBase>
);

const RefreshCw = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
    </IconBase>
);

const EyeOff = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
    </IconBase>
);

const Eye = ({ size, className }) => (
    <IconBase size={size} className={className}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </IconBase>
);

const DailyProfitReport = () => {
    const [loading, setLoading] = useState(false);
    const [hideZeroRevenue, setHideZeroRevenue] = useState(false);

    const defaultCols = [
        { id: 'date', label: 'Ngày' },
        { id: 'order_count', label: 'Đơn hàng' },
        { id: 'revenue_raw', label: 'Doanh thu gốc' },
        { id: 'revenue_actual', label: 'Doanh thu thực' },
        { id: 'cost_raw', label: 'Giá vốn gốc' },
        { id: 'cost_actual', label: 'Giá vốn thực' },
        { id: 'shipping_fee', label: 'Chi phí vận chuyển' },
        { id: 'packaging_fee', label: 'Chi phí gói hàng' },
        { id: 'fb_ads_spend', label: 'QC FB' },
        { id: 'google_ads_spend', label: 'QC Google' },
        { id: 'ads_spend', label: 'Tổng Ads' },
        { id: 'tax', label: 'Thuế tạm tính' },
        { id: 'fixed_cost', label: 'Chi phí cố định' },
        { id: 'extra_profit', label: 'Lãi/lỗ Đổi trả' },
        { id: 'profit', label: 'Lợi nhuận tạm tính' },
        { id: 'efficiency', label: 'Hiệu quả (%)' },
    ];

    const columnFormulas = {
        'date': 'Ngày chính thức ghi nhận đơn hàng (Dựa trên ngày Officialized).',
        'order_count': 'Tổng số đơn hàng phát sinh trong ngày (Trừ đơn đã hủy).',
        'revenue_raw': 'Tổng tiền khách thanh toán trên các đơn hàng mới (Trừ đơn đổi trả/giao 1 phần).',
        'revenue_actual': 'Doanh thu gốc - Dự phòng rủi ro hoàn (Dựa theo % Tỉ lệ hoàn cài đặt).',
        'cost_raw': 'Tổng giá vốn nhập hàng của các đơn hàng mới trong ngày.',
        'cost_actual': 'Giá vốn gốc x (1 - Tỉ lệ hoàn). Phản ánh giá vốn thực tế của hàng đã bán đi.',
        'shipping_fee': 'Tổng ship của các đơn trong ngày theo đúng bảng quản lí đơn hàng: đơn có ship > 0 lấy ship thật, đơn chưa có ship lấy 5% x tổng tiền đơn.',
        'packaging_fee': 'Tổng số đơn hàng x Phí gói hàng định mức (VNĐ/đơn).',
        'ads_spend': 'Chi phí quảng cáo Facebook từ tài khoản quảng cáo liên kết.',
        'tax': 'Tỉ lệ thuế % x (Doanh thu thực - Chi phí vận chuyển).',
        'fixed_cost': 'Chi phí cố định hàng ngày (Mặt bằng, lương, điện nước...) đã phân bổ.',
        'extra_profit': 'Tổng lợi nhuận/thua lỗ phát sinh từ các đơn Đổi trả và đơn Giao 1 phần.',
        'profit': '(Doanh thu thực - Giá vốn thực - Ship - Gói hàng - Thuế - Ads - CP cố định) + Lãi/lỗ Đổi trả.',
        'efficiency': '(Lợi nhuận tạm tính / Doanh thu thực) x 100%.'
    };

    // Read from localStorage if available
    const [columnConfig, setColumnConfig] = useState(() => {
        try {
            const saved = localStorage.getItem('dailyProfitCols2');
            if (saved) {
                const parsed = JSON.parse(saved);
                const knownIds = defaultCols.map(c => c.id);
                const merged = Array.isArray(parsed)
                    ? parsed.filter(id => knownIds.includes(id))
                    : [];
                defaultCols.forEach(col => {
                    if (!merged.includes(col.id)) merged.push(col.id);
                });
                return merged;
            }
        } catch(e) {}
        return defaultCols.map(c => c.id);
    });

    const [showColMenu, setShowColMenu] = useState(false);

    const toggleCol = (id) => {
        setColumnConfig(prev => {
            let next = [...prev];
            if (next.includes(id)) {
                next = next.filter(c => c !== id);
            } else {
                next.push(id);
            }
            localStorage.setItem('dailyProfitCols2', JSON.stringify(next));
            return next;
        });
    };

    const moveCol = (id, dir) => {
        setColumnConfig(prev => {
            const index = prev.indexOf(id);
            if (index < 0) return prev;
            const next = [...prev];
            if (dir === 'up' && index > 0) {
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
            } else if (dir === 'down' && index < next.length - 1) {
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
            }
            localStorage.setItem('dailyProfitCols2', JSON.stringify(next));
            return next;
        });
    };

    const renderHeader = (id) => {
        const tooltip = columnFormulas[id];

        const renderTH = (className, content) => (
            <th key={id} className={`group/header relative ${className}`}>
                <div className="flex flex-col items-center justify-center cursor-help">
                    {content}
                </div>
                {tooltip && (
                    <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 z-[100] mt-1 w-64 p-3 bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 group-hover/header:opacity-100 transition-opacity duration-200">
                        <p className="text-[12px] font-medium text-gray-700 leading-relaxed text-left normal-case">
                            {tooltip}
                        </p>
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-gray-200 rotate-45"></div>
                    </div>
                )}
            </th>
        );

        switch(id) {
            case 'date': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 leading-tight align-middle text-center bg-gray-100",
                <>Ngày<br/><span className="text-[11px] font-normal text-gray-400">(Date)</span></>
            );
            case 'order_count': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 leading-tight align-middle text-center bg-gray-100",
                <>Đơn hàng<br/><span className="text-[11px] font-normal text-gray-400">(Orders)</span></>
            );
            case 'revenue_raw': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Doanh thu<br/>gốc</>
            );
            case 'revenue_actual': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center bg-blue-50/30",
                <>Doanh thu<br/>thực</>
            );
            case 'cost_raw': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Giá vốn<br/>gốc</>
            );
            case 'cost_actual': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center text-orange-600",
                <>Giá vốn<br/>thực</>
            );
            case 'shipping_fee': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Chi phí<br/>vận chuyển</>
            );
            case 'packaging_fee': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Chi phí<br/>gói hàng</>
            );
            case 'fb_ads_spend': return renderTH("px-1 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1 justify-center">
                        <span>QC FB</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleSyncFB(); }}
                            title="Đồng bộ thủ công từ Facebook"
                            className={`p-1 rounded-full hover:bg-gray-100 transition-colors text-blue-600 ${loading ? 'animate-spin' : ''}`}
                        >
                            <RefreshCw size={13} />
                        </button>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleFetchFbSplit(); }}
                        title="Xem chi tiết từng tài khoản"
                        className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-blue-100 transition-colors mt-1"
                    >
                        {fetchingSplit ? <RefreshCw size={10} className="animate-spin" /> : "Chi tiết"}
                    </button>
                </div>
            );
            case 'google_ads_spend': return renderTH("px-1 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1 justify-center">
                        <span>QC Google</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleSyncGoogle(); }}
                            title="Đồng bộ thủ công từ Google Ads"
                            className={`p-1 rounded-full hover:bg-gray-100 transition-colors text-emerald-600 ${loading ? 'animate-spin' : ''}`}
                        >
                            <RefreshCw size={13} />
                        </button>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleFetchGoogleSplit(); }}
                        title="Xem chi tiết từng tài khoản Google Ads"
                        className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-emerald-100 transition-colors mt-1"
                    >
                        {fetchingGoogleSplit ? <RefreshCw size={10} className="animate-spin" /> : "Chi tiết"}
                    </button>
                </div>
            );
            case 'ads_spend': return renderTH("px-1 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Tổng<br/>Ads</>
            );
            case 'tax': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Thuế<br/>tạm tính</>
            );
            case 'fixed_cost': return renderTH("px-3 py-4 text-[15px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center",
                <>Chi phí<br/>cố định</>
            );
            case 'extra_profit': return renderTH("px-3 py-4 text-[14px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center text-orange-700 bg-orange-50/20",
                <>Lãi/lỗ<br/>Đổi trả</>
            );
            case 'profit': return renderTH("px-3 py-4 text-[15px] font-bold text-emerald-700 border-b border-gray-200 leading-tight align-middle text-center bg-emerald-50/30",
                <>Lợi nhuận<br/>tạm tính</>
            );
            case 'efficiency': return renderTH("px-3 py-4 text-[15px] font-bold text-indigo-700 border-b border-gray-200 leading-tight align-middle text-center bg-indigo-50/20 last:pr-6 whitespace-nowrap",
                <>Hiệu quả<br/>(%)</>
            );
            default: return null;
        }
    };

    const renderExtraProfitOrderMeta = ({
        totalCount = 0,
        exchangeCount = 0,
        partialCount = 0,
        textClassName = 'text-gray-400',
    }) => (
        <span className={`group/extra-profit relative inline-flex cursor-help items-center ${textClassName}`}>
            <span className="text-[11px] font-medium leading-none underline decoration-dotted underline-offset-2">
                ({totalCount} đơn)
            </span>
            <span className="pointer-events-none absolute top-full left-1/2 z-[90] mt-1 w-max min-w-[170px] -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-gray-700 shadow-xl opacity-0 transition-opacity duration-200 group-hover/extra-profit:opacity-100">
                <span className="block">Đơn đổi trả: {exchangeCount} đơn</span>
                <span className="mt-1 block">Đơn giao hàng 1 phần: {partialCount} đơn</span>
                <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-gray-200 bg-white"></span>
            </span>
        </span>
    );

    const renderExtraProfitValue = ({
        amount = 0,
        totalCount = 0,
        exchangeCount = 0,
        partialCount = 0,
        amountClassName = '',
        countClassName = 'text-gray-400',
    }) => (
        <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 leading-tight">
            <span className={amountClassName}>{formatNumber(amount)}</span>
            {renderExtraProfitOrderMeta({
                totalCount,
                exchangeCount,
                partialCount,
                textClassName: countClassName,
            })}
        </div>
    );

    const renderAdTotalCell = (id, valueField, rawField, textClassName = '') => {
        const taxed = aggregatedTotal[valueField] || 0;
        const raw = aggregatedTotal[rawField] || 0;
        return (
            <td key={id} className={`px-3 py-3 text-[13px] font-bold text-center ${textClassName}`}>
                <div className="flex flex-col items-center">
                    <span>{formatNumber(taxed)}</span>
                    {Math.abs(taxed - raw) > 1 && (
                        <span className="text-[13px] text-white/70 font-normal mt-0.5">
                            ({formatNumber(raw)})
                        </span>
                    )}
                </div>
                <span className="text-[13px] font-normal opacity-80 mt-0.5 inline-block">
                    {(aggregatedTotal.revenue_raw > 0 ? (taxed / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%
                </span>
            </td>
        );
    };

    const renderAdRowCell = (id, row, valueField, rawField, textClassName = 'text-blue-600') => {
        const taxed = row[valueField] || 0;
        const raw = row[rawField] || 0;
        return (
            <td key={id} className={`px-3 py-3 text-[13px] ${textClassName} text-center`}>
                <div className="flex flex-col items-center">
                    <span className="font-bold">{formatNumber(taxed)}</span>
                    {Math.abs(taxed - raw) > 1 && (
                        <span className="text-[13px] text-gray-400/80 font-normal mt-0.5">
                            ({formatNumber(raw)})
                        </span>
                    )}
                </div>
                <span className="text-[13px] text-gray-400 font-normal mt-0.5 inline-block">
                    {(row.revenue_raw > 0 ? (taxed / row.revenue_raw * 100) : 0).toFixed(1)}%
                </span>
            </td>
        );
    };

    const renderTotal = (id) => {
        switch(id) {
            case 'date': return (
<td  key='date' className="px-3 py-3 text-[13px] font-bold text-center uppercase tracking-wider">TỔNG CỘNG</td>
);
            case 'order_count': return (
<td  key='order_count' className="px-3 py-3 text-[13px] font-bold text-center">{aggregatedTotal.order_count}</td>
);
            case 'revenue_raw': return (
<td  key='revenue_raw' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggregatedTotal.revenue_raw)}</td>
);
            case 'revenue_actual': return (
<td  key='revenue_actual' className="px-3 py-3 text-[13px] font-bold text-center bg-white/10">
                                     {formatNumber(aggregatedTotal.revenue_actual)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.revenue_actual / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'cost_raw': return (
<td  key='cost_raw' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.cost_raw)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.cost_raw / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'cost_actual': return (
<td  key='cost_actual' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.cost_actual)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.cost_actual / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'shipping_fee': return (
<td  key='shipping_fee' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.shipping_fee)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.shipping_fee / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'packaging_fee': return (
<td  key='packaging_fee' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.packaging_fee)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.packaging_fee / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'fb_ads_spend':
                return renderAdTotalCell('fb_ads_spend', 'fb_ads_spend', 'fb_ads_spend_raw');
            case 'google_ads_spend':
                return renderAdTotalCell('google_ads_spend', 'google_ads_spend', 'google_ads_spend_raw');
            case 'ads_spend': return (
<td  key='ads_spend' className="px-3 py-3 text-[13px] font-bold text-center">
                                     <div className="flex flex-col items-center">
                                         <span>{formatNumber(aggregatedTotal.ads_spend)}</span>
                                         {Math.abs(aggregatedTotal.ads_spend - aggregatedTotal.ads_spend_raw) > 1 && (
                                             <span className="text-[13px] text-white/70 font-normal mt-0.5">
                                                 ({formatNumber(aggregatedTotal.ads_spend_raw)})
                                             </span>
                                         )}
                                     </div>
                                     <span className="text-[13px] font-normal opacity-80 mt-0.5 inline-block">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.ads_spend / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'tax': return (
<td  key='tax' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.tax)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.tax / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'fixed_cost': return (
<td  key='fixed_cost' className="px-3 py-3 text-[13px] font-bold text-center">
                                     {formatNumber(aggregatedTotal.fixed_cost)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.fixed_cost / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'extra_profit': return (
<td  key='extra_profit' className={`px-3 py-3 text-[13px] font-bold text-center bg-white/10 ${aggregatedTotal.extra_profit < 0 ? 'text-red-200' : 'text-orange-200'}`}>
                                     {renderExtraProfitValue({
                                         amount: aggregatedTotal.extra_profit,
                                         totalCount: aggregatedTotal.extra_profit_order_count,
                                         exchangeCount: aggregatedTotal.exchange_return_order_count,
                                         partialCount: aggregatedTotal.partial_delivery_order_count,
                                         countClassName: 'text-white/70',
                                     })}
                                 </td>
);
            case 'profit': return (
<td  key='profit' className={`px-3 py-3 text-[13px] font-bold text-center bg-white/10 ${aggregatedTotal.profit < 0 ? 'text-red-200' : ''}`}>
                                     {formatNumber(aggregatedTotal.profit)}<br/>
                                     <span className="text-[13px] font-normal opacity-80">{(aggregatedTotal.revenue_raw > 0 ? (aggregatedTotal.profit / aggregatedTotal.revenue_raw * 100) : 0).toFixed(1)}%</span>
                                 </td>
);
            case 'efficiency': return (
<td  key='efficiency' className="px-3 py-3 text-center last:pr-6 border-l border-white/20">
                                     <div className="bg-white/20 px-2 py-1 rounded inline-block text-[13px] font-black">
                                         {totalPercentProfit.toFixed(1)}%
                                     </div>
                                 </td>
);
            default: return null;
        }
    };
    const renderRow = (id, row) => {
        switch(id) {
            case 'date': return (
<td  key='date' className="px-3 py-3 text-[13px] font-medium text-gray-600 text-center border-r border-gray-50">
                                             {formatDisplayDate(row.date)}
                                         </td>
);
            case 'order_count': return (
<td  key='order_count' className="px-3 py-3 text-[13px] font-bold text-gray-700 text-center">
                                             {row.order_count}
                                         </td>
);
            case 'revenue_raw': return (
<td  key='revenue_raw' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.revenue_raw)}
                                         </td>
);
            case 'revenue_actual': return (
<td  key='revenue_actual' className="px-3 py-3 text-[13px] font-bold text-blue-700 text-center bg-blue-50/10">
                                             {formatNumber(row.revenue_actual)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_revenue_actual || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'cost_raw': return (
<td  key='cost_raw' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.cost_raw)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_cost_raw || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'cost_actual': return (
<td  key='cost_actual' className="px-3 py-3 text-[13px] text-orange-600 text-center">
                                             {formatNumber(row.cost_actual)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_cost || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'shipping_fee': return (
<td  key='shipping_fee' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.shipping_fee)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_ship || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'packaging_fee': return (
<td  key='packaging_fee' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.packaging_fee)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_pack || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'fb_ads_spend':
                return renderAdRowCell('fb_ads_spend', row, 'fb_ads_spend', 'fb_ads_spend_raw', 'text-blue-600');
            case 'google_ads_spend':
                return renderAdRowCell('google_ads_spend', row, 'google_ads_spend', 'google_ads_spend_raw', 'text-emerald-600');
            case 'ads_spend': return (
<td  key='ads_spend' className="px-3 py-3 text-[13px] text-blue-600 text-center">
                                             <div className="flex flex-col items-center">
                                                 <span className="font-bold">{formatNumber(row.ads_spend)}</span>
                                                 {Math.abs(row.ads_spend - (row.ads_spend_raw || 0)) > 1 && (
                                                     <span className="text-[13px] text-gray-400/80 font-normal mt-0.5">
                                                         ({formatNumber(row.ads_spend_raw || 0)})
                                                     </span>
                                                 )}
                                             </div>
                                             <span className="text-[13px] text-gray-400 font-normal mt-0.5 inline-block">{(row.percent_ads || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'tax': return (
<td  key='tax' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.tax)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{(row.percent_tax || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'fixed_cost': return (
<td  key='fixed_cost' className="px-3 py-3 text-[13px] text-gray-600 text-center">
                                             {formatNumber(row.fixed_cost)}<br/>
                                             <span className="text-[13px] text-gray-400 font-normal">{row.revenue_raw > 0 ? (row.fixed_cost / row.revenue_raw * 100).toFixed(1) : 0}%</span>
                                         </td>
);
            case 'extra_profit': return (
<td  key='extra_profit' className={`px-3 py-3 text-[13px] font-bold text-center bg-orange-50/10 ${row.extra_profit < 0 ? 'text-red-500' : 'text-orange-600'}`}>
                                             {renderExtraProfitValue({
                                                 amount: row.extra_profit,
                                                 totalCount: row.extra_profit_order_count,
                                                 exchangeCount: row.exchange_return_order_count,
                                                 partialCount: row.partial_delivery_order_count,
                                             })}
                                         </td>
);
            case 'profit': return (
<td  key='profit' className={`px-3 py-3 text-[13px] font-bold text-center bg-emerald-50/20 ${row.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                             {formatNumber(row.profit)}<br/>
                                             <span className={`text-[13px] font-normal ${row.profit < 0 ? 'text-red-400' : 'text-gray-400'}`}>{(row.percent_profit || 0).toFixed(1)}%</span>
                                         </td>
);
            case 'efficiency': return (
<td  key='efficiency' className="px-3 py-3 text-center last:pr-6 bg-indigo-50/10 border-l border-gray-50">
                                             <div className={`text-[13px] font-bold px-2 py-1 rounded-full inline-block ${row.percent_profit >= 25 ? 'bg-emerald-100 text-emerald-700' : row.percent_profit >= 15 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                                 {row.percent_profit.toFixed(1)}%
                                             </div>
                                         </td>
);
            default: return null;
        }
    };
    const [reportData, setReportData] = useState([]);
    const [summary, setSummary] = useState({ total_profit: 0, total_revenue: 0, total_orders: 0 });
    const [config, setConfig] = useState({
        return_rate: 2,
        packaging_fee: 2000,
        shipping_estimate_rate: 10,
        shipping_fee_type: '%',
        tax_rate: 1.5,
        fb_access_token: '',
        fb_ad_account_ids: '',
        fb_tax_rate: 0,
        google_developer_token: '',
        google_client_id: '',
        google_client_secret: '',
        google_refresh_token: '',
        google_login_customer_id: '',
        google_customer_ids: '',
        google_tax_rate: 0
    });

    const [filters, setFilters] = useState({
        start_date: getMonthStartInputDate(),
        end_date: formatInputDate(new Date()),
        ad_channel: 'all',
    });

    const [showConfig, setShowConfig] = useState(false);
    const [tokenGroups, setTokenGroups] = useState([{ token: '', account_ids: '', accounts: [], fetching: false, showList: false }]);
    const [showFbSplit, setShowFbSplit] = useState(false);
    const [fbSplitData, setFbSplitData] = useState(null);
    const [fetchingSplit, setFetchingSplit] = useState(false);
    const [hideZeroFbSpend, setHideZeroFbSpend] = useState(false);
    const [googleAccounts, setGoogleAccounts] = useState([]);
    const [fetchingGoogleAccounts, setFetchingGoogleAccounts] = useState(false);
    const [showGoogleAccounts, setShowGoogleAccounts] = useState(false);
    const [showGoogleSplit, setShowGoogleSplit] = useState(false);
    const [googleSplitData, setGoogleSplitData] = useState(null);
    const [fetchingGoogleSplit, setFetchingGoogleSplit] = useState(false);
    const [hideZeroGoogleSpend, setHideZeroGoogleSpend] = useState(false);

    const addTokenGroup = () => {
        setTokenGroups([...tokenGroups, { token: '', account_ids: '', accounts: [], fetching: false, showList: false }]);
    };

    const removeTokenGroup = (index) => {
        if (tokenGroups.length <= 1) {
            setTokenGroups([{ token: '', account_ids: '', accounts: [], fetching: false, showList: false }]);
            return;
        }
        const updated = [...tokenGroups];
        updated.splice(index, 1);
        setTokenGroups(updated);
    };

    const updateTokenGroup = (index, field, value) => {
        const updated = [...tokenGroups];
        updated[index][field] = value;
        setTokenGroups(updated);
    };

    const handleFetchAccounts = async (index) => {
        const group = tokenGroups[index];
        if (!group.token) {
            alert("Vui lòng dán Access Token trước khi lấy danh sách");
            return;
        }
        updateTokenGroup(index, 'fetching', true);
        try {
            const res = await financeApi.getFbAdAccounts(group.token);
            if (res.data.status === 'success') {
                const accounts = res.data.data;
                const updated = [...tokenGroups];
                updated[index].accounts = accounts;
                updated[index].showList = true;
                setTokenGroups(updated);
                if (accounts.length === 0) {
                    alert("Không tìm thấy tài khoản quảng cáo nào liên kết với Token này.");
                } else {
                    setTimeout(() => {
                        const list = document.getElementById(`fb-account-list-${index}`);
                        if (list) list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 100);
                }
            } else {
                alert(res.data.message || "Lỗi lấy danh sách tài khoản");
            }
        } catch (error) {
            console.error(error);
            alert("Không thể kết nối API Facebook. Vui lòng kiểm tra lại Token.");
        } finally {
            updateTokenGroup(index, 'fetching', false);
        }
    };

    const toggleAdAccount = (index, accId) => {
        if (!accId) return;
        const group = tokenGroups[index];
        const currentIds = group.account_ids ? group.account_ids.split(',').map(id => id.trim()).filter(id => id) : [];
        let nextIds;
        if (currentIds.includes(accId)) {
            nextIds = currentIds.filter(id => id !== accId);
        } else {
            nextIds = [...currentIds, accId];
        }
        updateTokenGroup(index, 'account_ids', nextIds.join(', '));
    };

    const handleSaveFBConfig = async () => {
        setLoading(true);
        try {
            const fb_tokens_configs = tokenGroups.map(g => ({
                token: g.token,
                account_ids: g.account_ids
            })).filter(g => g.token && g.account_ids);

            const payload = {
                ...config,
                fb_access_token: fb_tokens_configs.length > 0 ? fb_tokens_configs[0].token : '',
                fb_ad_account_ids: fb_tokens_configs.length > 0 ? fb_tokens_configs[0].account_ids : '',
                fb_tokens_configs: fb_tokens_configs
            };
            await financeApi.updateDailyPnlConfig(payload);
            await loadData();
            alert("Đã lưu cấu hình Facebook Ads thành công!");
        } catch (error) {
            alert("Lỗi lưu cấu hình Facebook");
        } finally {
            setLoading(false);
        }
    };

    const handleClearFBConfig = async (index) => {
        if (!window.confirm("Anh có chắc muốn xóa/cài lại vùng Token này không?")) return;
        updateTokenGroup(index, 'token', '');
        updateTokenGroup(index, 'account_ids', '');
        updateTokenGroup(index, 'accounts', []);
        updateTokenGroup(index, 'showList', false);
    };

    const handleSyncFB = async () => {
        setLoading(true);
        try {
            await financeApi.syncFbAdSpend({
                start_date: filters.start_date,
                end_date: filters.end_date
            });
            await loadData();
            alert("Đã đồng bộ xong tiền quảng cáo Facebook!");
        } catch (error) {
            console.error(error);
            alert("Lỗi khi đồng bộ dữ liệu Facebook.");
        } finally {
            setLoading(false);
        }
    };

    const handleFetchFbSplit = async () => {
        setFetchingSplit(true);
        try {
            const res = await financeApi.getFbAdSpendSplit({
                start_date: filters.start_date,
                end_date: filters.end_date
            });
            if(res.data.status === 'success') {
                setFbSplitData(res.data.data);
                setShowFbSplit(true);
            } else {
                alert(res.data.message || "Lỗi lấy dữ liệu Facebook");
            }
        } catch (error) {
            console.error(error);
            alert("Lỗi khi kết nối đến API.");
        } finally {
            setFetchingSplit(false);
        }
    };

    const handleFetchGoogleAccounts = async () => {
        if (!config.google_developer_token || !config.google_client_id || !config.google_client_secret || !config.google_refresh_token) {
            alert("Vui lòng nhập đủ Developer Token, Client ID, Client Secret và Refresh Token của Google Ads.");
            return;
        }

        setFetchingGoogleAccounts(true);
        try {
            const res = await financeApi.getGoogleAdAccounts({
                google_developer_token: config.google_developer_token,
                google_client_id: config.google_client_id,
                google_client_secret: config.google_client_secret,
                google_refresh_token: config.google_refresh_token,
                google_login_customer_id: config.google_login_customer_id,
            });

            if (res.data.status === 'success') {
                setGoogleAccounts(res.data.data || []);
                setShowGoogleAccounts(true);
                if ((res.data.data || []).length === 0) {
                    alert("Không tìm thấy tài khoản Google Ads nào với bộ thông tin này.");
                }
            } else {
                alert(res.data.message || "Lỗi lấy danh sách tài khoản Google Ads");
            }
        } catch (error) {
            console.error(error);
            alert("Không thể kết nối Google Ads API. Vui lòng kiểm tra lại cấu hình.");
        } finally {
            setFetchingGoogleAccounts(false);
        }
    };

    const toggleGoogleCustomer = (customerId) => {
        if (!customerId) return;
        const currentIds = config.google_customer_ids
            ? config.google_customer_ids.split(',').map(id => id.trim()).filter(Boolean)
            : [];
        const normalized = String(customerId).replace(/\D+/g, '');
        const nextIds = currentIds.includes(normalized)
            ? currentIds.filter(id => id !== normalized)
            : [...currentIds, normalized];

        setConfig({...config, google_customer_ids: nextIds.join(', ')});
    };

    const handleSaveGoogleConfig = async () => {
        setLoading(true);
        try {
            await financeApi.updateDailyPnlConfig(config);
            await loadData();
            alert("Đã lưu cấu hình Google Ads thành công!");
        } catch (error) {
            console.error(error);
            alert("Lỗi lưu cấu hình Google Ads");
        } finally {
            setLoading(false);
        }
    };

    const handleSyncGoogle = async () => {
        setLoading(true);
        try {
            const res = await financeApi.syncGoogleAdSpend({
                start_date: filters.start_date,
                end_date: filters.end_date
            });
            if (res.data.status !== 'success') {
                alert(res.data.message || "Lỗi khi đồng bộ dữ liệu Google Ads.");
                return;
            }
            await loadData();
            alert("Đã đồng bộ xong tiền quảng cáo Google Ads!");
        } catch (error) {
            console.error(error);
            alert(error?.response?.data?.message || "Lỗi khi đồng bộ dữ liệu Google Ads.");
        } finally {
            setLoading(false);
        }
    };

    const handleFetchGoogleSplit = async () => {
        setFetchingGoogleSplit(true);
        try {
            const res = await financeApi.getGoogleAdSpendSplit({
                start_date: filters.start_date,
                end_date: filters.end_date
            });
            if (res.data.status === 'success') {
                setGoogleSplitData(res.data.data);
                setShowGoogleSplit(true);
            } else {
                alert(res.data.message || "Lỗi lấy dữ liệu Google Ads");
            }
        } catch (error) {
            console.error(error);
            alert(error?.response?.data?.message || "Lỗi khi kết nối đến Google Ads API.");
        } finally {
            setFetchingGoogleSplit(false);
        }
    };

    const getQuickFilterRange = (type) => {
        const now = new Date();
        let start;
        let end;

        switch(type) {
            case 'this_month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = now;
                break;
            case 'last_month':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'this_week':
                start = getStartOfWeek(now);
                end = now;
                break;
            case 'last_week':
                end = new Date(getStartOfWeek(now));
                end.setDate(end.getDate() - 1);
                start = getStartOfWeek(end);
                break;
            case 'last_30_days':
                start = new Date(now);
                start.setDate(now.getDate() - 30);
                end = now;
                break;
            default:
                return null;
        }

        return { start, end };
    };

    const isQuickFilterActive = (type) => {
        const range = getQuickFilterRange(type);
        return range
            ? filters.start_date === formatInputDate(range.start) && filters.end_date === formatInputDate(range.end)
            : false;
    };

    const getQuickFilterButtonClass = (type) => (
        `px-3 py-1 text-[13px] font-bold rounded-md transition-all ${
            isQuickFilterActive(type) ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`
    );

    const setQuickFilter = (type) => {
        const range = getQuickFilterRange(type);
        if (!range) return;

        setFilters((previous) => ({
            ...previous,
            start_date: formatInputDate(range.start),
            end_date: formatInputDate(range.end)
        }));
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [reportRes, configRes] = await Promise.all([
                financeApi.getDailyPnlReport({
                    start_date: filters.start_date,
                    end_date: filters.end_date,
                    ad_channel: filters.ad_channel,
                }),
                financeApi.getDailyPnlConfig()
            ]);

            if (reportRes.data.status === 'success') {
                setReportData(reportRes.data.data);
                setSummary(reportRes.data.summary);
            }
            if (configRes.data.status === 'success') {
                const configData = configRes.data.data;
                setConfig(configData);

                let tokens = configData.fb_tokens_configs || [];
                if (!tokens.length) {
                    if (configData.fb_access_token) {
                        tokens = [{ token: configData.fb_access_token, account_ids: configData.fb_ad_account_ids, accounts: [], fetching: false, showList: false }];
                    } else {
                        tokens = [{ token: '', account_ids: '', accounts: [], fetching: false, showList: false }];
                    }
                } else {
                    tokens = tokens.map(t => ({ ...t, accounts: [], fetching: false, showList: false }));
                }
                setTokenGroups(tokens);
            }
        } catch (error) {
            console.error("Lỗi tải báo cáo lãi lỗ:", error);
        } finally {
            // Artificial delay to make animation visible and show off the effect
            setTimeout(() => setLoading(false), 600);
        }
    }, [filters]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleUpdateConfig = async () => {
        setLoading(true);
        try {
            const fb_tokens_configs = tokenGroups.map(g => ({
                token: g.token,
                account_ids: g.account_ids
            })).filter(g => g.token && g.account_ids);

            const payload = {
                ...config,
                fb_access_token: fb_tokens_configs.length > 0 ? fb_tokens_configs[0].token : '',
                fb_ad_account_ids: fb_tokens_configs.length > 0 ? fb_tokens_configs[0].account_ids : '',
                fb_tokens_configs: fb_tokens_configs
            };

            await financeApi.updateDailyPnlConfig(payload);
            await loadData();
            setShowConfig(false);
        } catch (error) {
            alert("Lỗi cập nhật cấu hình");
        } finally {
            setLoading(false);
        }
    };

    const aggregatedTotal = reportData.reduce((acc, row) => ({
        order_count: acc.order_count + (row.order_count || 0),
        revenue_raw: acc.revenue_raw + (row.revenue_raw || 0),
        revenue_actual: acc.revenue_actual + (row.revenue_actual || 0),
        cost_raw: acc.cost_raw + (row.cost_raw || 0),
        cost_actual: acc.cost_actual + (row.cost_actual || 0),
        shipping_fee: acc.shipping_fee + (row.shipping_fee || 0),
        packaging_fee: acc.packaging_fee + (row.packaging_fee || 0),
        fb_ads_spend: acc.fb_ads_spend + (row.fb_ads_spend || 0),
        fb_ads_spend_raw: acc.fb_ads_spend_raw + (row.fb_ads_spend_raw || 0),
        google_ads_spend: acc.google_ads_spend + (row.google_ads_spend || 0),
        google_ads_spend_raw: acc.google_ads_spend_raw + (row.google_ads_spend_raw || 0),
        ads_spend: acc.ads_spend + (row.ads_spend || 0),
        ads_spend_raw: (acc.ads_spend_raw || 0) + (row.ads_spend_raw || 0),
        tax: acc.tax + (row.tax || 0),
        fixed_cost: acc.fixed_cost + (row.fixed_cost || 0),
        exchange_return_order_count: acc.exchange_return_order_count + (row.exchange_return_order_count || 0),
        partial_delivery_order_count: acc.partial_delivery_order_count + (row.partial_delivery_order_count || 0),
        extra_profit_order_count: acc.extra_profit_order_count + (row.extra_profit_order_count || 0),
        extra_profit: acc.extra_profit + (row.extra_profit || 0),
        profit: acc.profit + (row.profit || 0),
    }), {
        order_count: 0, revenue_raw: 0, revenue_actual: 0, cost_raw: 0, cost_actual: 0,
        shipping_fee: 0, packaging_fee: 0,
        fb_ads_spend: 0, fb_ads_spend_raw: 0, google_ads_spend: 0, google_ads_spend_raw: 0,
        ads_spend: 0, ads_spend_raw: 0, tax: 0, fixed_cost: 0,
        exchange_return_order_count: 0, partial_delivery_order_count: 0, extra_profit_order_count: 0, extra_profit: 0, profit: 0
    });

    const totalPercentProfit = aggregatedTotal.revenue_actual > 0
        ? (aggregatedTotal.profit / aggregatedTotal.revenue_actual) * 100
        : 0;

    return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
            <div className="bg-white p-3 rounded-xl shadow-sm mb-4 border border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-gray-800 whitespace-nowrap">Báo cáo lãi lỗ ngày</h1>
                    <div className="h-6 w-px bg-gray-200 hidden md:block"></div>

                    {/* Quick Filters */}
                    <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setQuickFilter('this_month')}
                            className={getQuickFilterButtonClass('this_month')}
                        >
                            Tháng này
                        </button>
                        <button
                            onClick={() => setQuickFilter('last_month')}
                            className={getQuickFilterButtonClass('last_month')}
                        >
                            Tháng trước
                        </button>
                        <button
                            onClick={() => setQuickFilter('this_week')}
                            className={getQuickFilterButtonClass('this_week')}
                        >
                            Tuần này
                        </button>
                        <button
                            onClick={() => setQuickFilter('last_week')}
                            className={getQuickFilterButtonClass('last_week')}
                        >
                            Tuần trước
                        </button>
                        <button
                            onClick={() => setQuickFilter('last_30_days')}
                            className={getQuickFilterButtonClass('last_30_days')}
                        >
                            30 ngày qua
                        </button>
                    </div>

                     <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                         <Filter size={14} className="text-gray-400" />
                         <div className="flex items-center gap-1">
                            <input
                                type="date"
                                value={filters.start_date}
                                onChange={(e) => setFilters({...filters, start_date: e.target.value})}
                                className="text-[13px] border border-gray-200 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-32"
                            />
                            <span className="text-gray-400 text-[13px]">-</span>
                            <input
                                type="date"
                                value={filters.end_date}
                                onChange={(e) => setFilters({...filters, end_date: e.target.value})}
                                className="text-[13px] border border-gray-200 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-32"
                             />
                          </div>
                      </div>

                      <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                          <span className="text-[12px] font-bold uppercase tracking-wide text-gray-400">Kênh</span>
                          <select
                              value={filters.ad_channel}
                              onChange={(e) => setFilters({...filters, ad_channel: e.target.value})}
                              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-[13px] font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                              {AD_CHANNEL_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                          </select>
                      </div>

                  </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setHideZeroRevenue(!hideZeroRevenue)}
                        title="Ẩn/hiện những ngày không có đơn hàng"
                        className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-all ${hideZeroRevenue ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >
                        {hideZeroRevenue ? <EyeOff size={16} /> : <Eye size={16} />}
                        <span className="text-[13px] font-medium hidden sm:block">{hideZeroRevenue ? 'Hiển thị đủ ngày' : 'Ẩn ngày không bán được'}</span>
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setShowColMenu(!showColMenu)}
                            title="Tùy chỉnh cột"
                            className="px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-all bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M19 3h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M9 15H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"/><path d="M19 15h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"/></svg>
                            <span className="text-[13px] font-medium hidden sm:block">Hiển thị cột</span>
                        </button>
                        {showColMenu && (
                            <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowColMenu(false)}></div>

                            <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-100 z-50 overflow-hidden">
                                <div className="p-2 border-b bg-gray-50 flex justify-between items-center">
                                    <span className="text-[13px] font-bold text-gray-700">Tùy chỉnh cột</span>
                                    <button onClick={() => setColumnConfig(defaultCols.map(c => c.id))} className="text-[11px] text-blue-600 hover:underline">Khôi phục</button>
                                </div>
                                <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                                    {defaultCols.map(col => {
                                        const isVisible = columnConfig.includes(col.id);
                                        return (
                                            <div key={col.id} className="flex items-center justify-between p-1.5 hover:bg-gray-50 rounded group">
                                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                                    <input type="checkbox" checked={isVisible} onChange={() => toggleCol(col.id)} className="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5" />
                                                    <span className="text-[13px] text-gray-700 select-none">{col.label}</span>
                                                </label>
                                                {isVisible && col.id !== 'date' && (
                                                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100">
                                                        <button onClick={() => moveCol(col.id, 'up')} className="text-gray-400 hover:text-emerald-600"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg></button>
                                                        <button onClick={() => moveCol(col.id, 'down')} className="text-gray-400 hover:text-emerald-600"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg></button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            </>
                        )}
                    </div>

<button
                        onClick={() => setShowConfig(!showConfig)}
                        title="Cài đặt định mức"
                        className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-all ${showConfig ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >
                        <Settings size={16} />
                        <span className="text-[13px] font-medium">Cài đặt định mức</span>
                    </button>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-[13px] font-medium hover:bg-gray-900 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-70"
                    >
                        <RefreshCw className={`${loading ? 'animate-spin' : ''}`} size={14} />
                        {loading ? 'Đang tải...' : 'Làm mới'}
                    </button>
                </div>
            </div>

            {/* Panel Cài đặt định mức (Collapsible) */}
            {showConfig && (
                <div className="bg-white p-6 rounded-xl shadow-sm mb-6 border border-blue-100 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                            <Settings className="text-blue-600" size={20} />
                            Cài đặt tham số kinh nghiệm
                        </h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-600">Tỉ lệ hoàn hàng (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={config.return_rate}
                                    onChange={(e) => setConfig({...config, return_rate: e.target.value})}
                                    className="w-full border border-gray-200 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <span className="absolute right-3 top-2.5 text-gray-400">%</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-600">Phí đóng gói (đ/đơn)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={config.packaging_fee}
                                    onChange={(e) => setConfig({...config, packaging_fee: e.target.value})}
                                    className="w-full border border-gray-200 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <span className="absolute right-3 top-2.5 text-gray-400">đ</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-600">Công thức phí Ship ngày</label>
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50/80 px-3 py-3 text-[13px] leading-relaxed text-emerald-700">
                                Đơn có ship &gt; 0 lấy ship thật. Đơn chưa có ship hoặc ship = 0 lấy 5% x tổng tiền đơn.
                            </div>
                            <p className="text-[12px] text-gray-500">Cột này đã đồng bộ theo đúng logic Tổng ship của bảng quản lí đơn hàng.</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-600">Thuế suất định mức (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={config.tax_rate}
                                    onChange={(e) => setConfig({...config, tax_rate: e.target.value})}
                                    className="w-full border border-gray-200 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <span className="absolute right-3 top-2.5 text-gray-400">%</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-blue-600 flex items-center justify-between">Thuế FB (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={config.fb_tax_rate || ''}
                                    onChange={(e) => setConfig({...config, fb_tax_rate: e.target.value})}
                                    title="Thuế phí tính thêm của nền tảng quảng cáo lúc cắn tiền."
                                    placeholder="5"
                                    className="w-full border border-blue-200 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none pr-8 bg-blue-50/50"
                                />
                                <span className="absolute right-3 top-2.5 text-blue-400 font-bold">%</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-emerald-600 flex items-center justify-between">Thuế Google (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={config.google_tax_rate || ''}
                                    onChange={(e) => setConfig({...config, google_tax_rate: e.target.value})}
                                    title="Thuế/phí cộng thêm cho chi phí Google Ads khi tính lãi lỗ."
                                    placeholder="0"
                                    className="w-full border border-emerald-200 rounded-lg p-2.5 focus:ring-2 focus:ring-emerald-500 outline-none pr-8 bg-emerald-50/50"
                                />
                                <span className="absolute right-3 top-2.5 text-emerald-500 font-bold">%</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 bg-blue-50/50 rounded-xl p-5 border border-blue-100 space-y-5">
                        <div className="flex items-center justify-between">
                            <h4 className="flex items-center gap-2 text-blue-700 font-bold">
                                <span className="bg-blue-600 text-white rounded-full p-1.5 flex items-center justify-center">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                                </span>
                                Kết nối Facebook Ads tự động
                            </h4>
                            <button onClick={addTokenGroup} className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                                Thêm Token
                            </button>
                        </div>

                        {tokenGroups.map((group, index) => (
                            <div key={index} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm relative group overflow-visible">
                                {tokenGroups.length > 1 && (
                                    <button
                                        onClick={() => removeTokenGroup(index)}
                                        className="absolute -top-3 -right-3 text-red-500 bg-white border border-red-200 hover:bg-red-50 rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-all z-10"
                                        title="Xóa cụm token này"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                )}

                                <div className="space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                        <label className="text-sm font-semibold text-gray-700 shrink-0">Cụm {index + 1}: Facebook Access Token</label>
                                        <div className="flex items-center gap-2">
                                            {group.token && (
                                                <button
                                                    onClick={() => handleClearFBConfig(index)}
                                                    className="text-[11px] text-red-500 hover:text-red-700 font-bold transition-colors"
                                                >
                                                    Xóa trắng
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleFetchAccounts(index)}
                                                disabled={group.fetching || !group.token}
                                                className={`text-[11px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm ${
                                                    !group.token
                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                                }`}
                                            >
                                                {group.fetching ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                                Kiểm tra & Lấy TK
                                            </button>
                                        </div>
                                    </div>
                                    <div className="relative group/input">
                                        <input
                                            type="text"
                                            value={group.token}
                                            onChange={(e) => updateTokenGroup(index, 'token', e.target.value)}
                                            placeholder="Dán mã Token anh vừa lấy vào đây..."
                                            className="w-full border border-gray-200 rounded-xl p-3 pr-10 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 group-hover/input:text-emerald-400 transition-colors">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 11v5M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <label className="text-sm font-semibold text-gray-700 mb-2 block border-t border-gray-50 pt-4">Danh sách ID tài khoản đang chọn</label>
                                        <textarea
                                            rows="2"
                                            value={group.account_ids}
                                            onChange={(e) => updateTokenGroup(index, 'account_ids', e.target.value)}
                                            placeholder="act_xxxx, act_yyyy"
                                            className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                                        />

                                        {group.showList && group.accounts && group.accounts.length > 0 && (
                                            <div id={`fb-account-list-${index}`} className="mt-4 bg-white border border-blue-100 rounded-xl overflow-hidden shadow-sm">
                                                <div className="bg-blue-50 px-3 py-2 border-b border-blue-100 flex items-center justify-between">
                                                    <p className="text-[11px] font-bold text-blue-600 tracking-wider">CHỌN TÀI KHOẢN MUỐN THEO DÕI:</p>
                                                    <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-md font-bold">
                                                        {group.accounts.length} TK
                                                    </span>
                                                </div>
                                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 bg-white">
                                                    {group.accounts.map(acc => {
                                                        const isChecked = (group.account_ids || '').includes(acc.id);
                                                        return (
                                                            <div
                                                                key={acc.id}
                                                                onClick={() => toggleAdAccount(index, acc.id)}
                                                                className={`flex items-center gap-3 p-3 cursor-pointer transition-all ${
                                                                    isChecked ? 'bg-blue-50/40' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                                                    isChecked ? 'bg-blue-600 border-blue-600 shadow-sm' : 'bg-white border-gray-200'
                                                                }`}>
                                                                    {isChecked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5"/></svg>}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className={`text-[13px] font-bold truncate ${isChecked ? 'text-blue-700' : 'text-gray-700'}`}>
                                                                        {acc.name}
                                                                    </p>
                                                                    <p className="text-[11px] text-gray-400 font-medium">ID: {acc.id}</p>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3 border-t border-blue-100 pt-5">
                            <button
                                onClick={handleSaveFBConfig}
                                disabled={loading}
                                className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.02] active:scale-95`}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                                Lưu cấu hình Facebook Ads
                            </button>
                            <p className="text-[11px] text-indigo-600 font-medium italic">
                                * Lút này sẽ lưu cấu hình của tất cả các cụm Token ở trên.
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 bg-emerald-50/50 rounded-xl p-5 border border-emerald-100 space-y-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <h4 className="flex items-center gap-2 text-emerald-700 font-bold">
                                <span className="bg-emerald-600 text-white rounded-full p-1.5 flex items-center justify-center">
                                    <BarChart3 size={14} />
                                </span>
                                Kết nối Google Ads tự động
                            </h4>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleFetchGoogleAccounts}
                                    disabled={fetchingGoogleAccounts}
                                    className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-emerald-600 px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
                                >
                                    <RefreshCw size={13} className={fetchingGoogleAccounts ? 'animate-spin' : ''} />
                                    Kiểm tra & Lấy TK
                                </button>
                                <button
                                    onClick={handleSaveGoogleConfig}
                                    disabled={loading}
                                    className="flex items-center gap-1.5 text-[12px] font-bold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-60"
                                >
                                    Lưu Google Ads
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700">Developer Token</label>
                                <input
                                    type="text"
                                    value={config.google_developer_token || ''}
                                    onChange={(e) => setConfig({...config, google_developer_token: e.target.value})}
                                    placeholder="Google Ads developer token"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700">Login Customer ID (MCC nếu có)</label>
                                <input
                                    type="text"
                                    value={config.google_login_customer_id || ''}
                                    onChange={(e) => setConfig({...config, google_login_customer_id: e.target.value})}
                                    placeholder="1234567890"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700">OAuth Client ID</label>
                                <input
                                    type="text"
                                    value={config.google_client_id || ''}
                                    onChange={(e) => setConfig({...config, google_client_id: e.target.value})}
                                    placeholder="xxx.apps.googleusercontent.com"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-gray-700">OAuth Client Secret</label>
                                <input
                                    type="password"
                                    value={config.google_client_secret || ''}
                                    onChange={(e) => setConfig({...config, google_client_secret: e.target.value})}
                                    placeholder="Client secret"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-semibold text-gray-700">Refresh Token</label>
                                <input
                                    type="password"
                                    value={config.google_refresh_token || ''}
                                    onChange={(e) => setConfig({...config, google_refresh_token: e.target.value})}
                                    placeholder="Refresh token có scope https://www.googleapis.com/auth/adwords"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-semibold text-gray-700">Customer ID đang chọn</label>
                                <textarea
                                    rows="2"
                                    value={config.google_customer_ids || ''}
                                    onChange={(e) => setConfig({...config, google_customer_ids: e.target.value})}
                                    placeholder="1234567890, 9876543210"
                                    className="w-full border border-emerald-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                                />
                            </div>
                        </div>

                        {showGoogleAccounts && googleAccounts.length > 0 && (
                            <div className="bg-white border border-emerald-100 rounded-xl overflow-hidden shadow-sm">
                                <div className="bg-emerald-50 px-3 py-2 border-b border-emerald-100 flex items-center justify-between">
                                    <p className="text-[11px] font-bold text-emerald-700 tracking-wider">CHỌN TÀI KHOẢN GOOGLE ADS MUỐN THEO DÕI:</p>
                                    <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-md font-bold">
                                        {googleAccounts.length} TK
                                    </span>
                                </div>
                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 bg-white">
                                    {googleAccounts.map(acc => {
                                        const normalizedId = String(acc.id || '').replace(/\D+/g, '');
                                        const isChecked = (config.google_customer_ids || '').split(',').map(id => id.trim()).includes(normalizedId);
                                        return (
                                            <div
                                                key={normalizedId}
                                                onClick={() => toggleGoogleCustomer(normalizedId)}
                                                className={`flex items-center gap-3 p-3 cursor-pointer transition-all ${isChecked ? 'bg-emerald-50/60' : 'hover:bg-gray-50'}`}
                                            >
                                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${
                                                    isChecked ? 'bg-emerald-600 border-emerald-600 shadow-sm' : 'bg-white border-gray-200'
                                                }`}>
                                                    {isChecked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5"/></svg>}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-[13px] font-bold truncate ${isChecked ? 'text-emerald-700' : 'text-gray-700'}`}>
                                                        {acc.name || normalizedId}
                                                    </p>
                                                    <p className="text-[11px] text-gray-400 font-medium">
                                                        ID: {normalizedId}{acc.currency_code ? ` · ${acc.currency_code}` : ''}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-6 flex justify-end">
                        <button
                            onClick={handleUpdateConfig}
                            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            Lưu cấu hình & Tính toán lại
                        </button>
                    </div>
                </div>
            )}

            {/* Bảng báo cáo chi tiết */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[75vh]">
                    <table className="w-full text-left border-collapse min-w-[1250px] [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200">
                        <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                            <tr>
                                {columnConfig.map(id => renderHeader(id))}
                            </tr>
                             {/* Sticky Total Row */}
                             <tr className="bg-emerald-600 text-white border-b border-emerald-700 sticky top-[72px] z-20">
                                 {columnConfig.map(id => renderTotal(id))}
                                 </tr>
                         </thead>
                         <tbody className="bg-white">
                             {reportData.filter(row => !hideZeroRevenue || row.revenue_raw > 0).length === 0 ? (
                                 <tr>
                                     <td colSpan={columnConfig.length || 1} className="py-20 text-center text-gray-400">
                                         Không có dữ liệu trong khoảng thời gian này
                                     </td>
                                 </tr>
                             ) : (
                                 reportData.filter(row => !hideZeroRevenue || row.revenue_raw > 0).map((row, index) => (
                                     <tr key={index} className="hover:bg-gray-50 transition-colors group">
                                         {columnConfig.map(id => renderRow(id, row))}
                                         </tr>
                                 ))
                             )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Ghi chú chân trang */}
            <div className="mt-4 flex flex-col md:flex-row justify-between items-start md:items-center text-[12px] text-gray-400 italic">
                <p>* Dữ liệu Lợi nhuận tạm tính = (Doanh thu thực - Giá vốn thực - Phí ship - Gói hàng - Thuế - Ads) + Chênh lệch đơn đổi trả.</p>
                <div className="flex gap-4 mt-2 md:mt-0">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> {'> 25% (Rất tốt)'}</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> 15-25% (Ổn định)</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500"></div> {'< 15% (Cần tối ưu)'}</span>
                </div>
            </div>

            {/* Chi tiết từng tài khoản Quảng cáo Modal */}
            {showFbSplit && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-[90vw] lg:max-w-5xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                </div>
                                Thống kê chi tiêu theo Tài khoản
                            </h3>
                            <button onClick={() => setShowFbSplit(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-5">
                            <div className="mb-4 text-[13px] text-gray-500 bg-blue-50 border border-blue-100 p-3 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <span className="font-medium">Thời gian lọc:</span> {filters.start_date} đến {filters.end_date}
                                </div>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={hideZeroFbSpend}
                                            onChange={(e) => setHideZeroFbSpend(e.target.checked)}
                                            className="w-3.5 h-3.5 text-blue-600 rounded bg-gray-100 border-gray-300 focus:ring-blue-500 focus:ring-2"
                                        />
                                        <span className="text-[12px] font-medium">Ẩn TK 0đ</span>
                                    </label>
                                    <div className="font-bold text-blue-600">
                                        VAT áp dụng: +{fbSplitData?.tax_rate}%
                                    </div>
                                </div>
                            </div>

                            {(() => {
                                const displayAccounts = (fbSplitData?.accounts || []).filter(acc => !hideZeroFbSpend || acc.total_taxed > 0);
                                return (
                            <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-sm custom-scrollbar max-h-[60vh]">
                                <table className="w-full text-left border-collapse [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200 relative">
                                    <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm">
                                        <tr>
                                            <th className="p-3 text-[12px] font-bold text-gray-500 uppercase sticky left-0 bg-gray-50 z-30 min-w-[100px] text-center border-r border-gray-200">
                                                Ngày
                                            </th>
                                            {(displayAccounts || []).map(acc => (
                                                <th key={acc.account_id} className="p-3 text-center bg-gray-50 min-w-[150px]">
                                                    <div className="font-semibold text-blue-700 text-[13px]">{acc.account_name}</div>
                                                    <div className="text-[12px] text-emerald-600 font-bold mt-1">
                                                        Tổng: {new Intl.NumberFormat('vi-VN').format(Math.round(acc.total_taxed))}đ
                                                    </div>
                                                </th>
                                            ))}
                                            <th className="p-3 text-[12px] font-bold text-emerald-700 uppercase bg-emerald-50 text-center min-w-[130px]">
                                                Cộng Ngày
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 bg-white">
                                        {Object.entries(fbSplitData?.daily_matrix || {}).length === 0 ? (
                                            <tr>
                                                <td colSpan={(displayAccounts?.length || 0) + 2} className="py-10 text-center text-gray-400">
                                                    Không có dữ liệu chi tiêu trong khoảng thời gian này
                                                </td>
                                            </tr>
                                        ) : (
                                            Object.entries(fbSplitData?.daily_matrix || {}).map(([dateStr, accData]) => {
                                                const totalTaxedInDay = Object.values(accData).reduce((sum, item) => sum + (item.spend_taxed || 0), 0);
                                                return (
                                                    <tr key={dateStr} className="hover:bg-gray-50 transition-colors group">
                                                        <td className="p-3 font-semibold text-gray-700 sticky left-0 bg-white z-10 text-[13px] text-center border-r border-gray-200 group-hover:bg-gray-50">
                                                            {dateStr}
                                                        </td>
                                                        {(displayAccounts || []).map(acc => {
                                                            const spendObj = accData[acc.account_id];
                                                            return (
                                                                <td key={acc.account_id} className="p-3 text-center align-middle">
                                                                    {spendObj && spendObj.spend_raw > 0 ? (
                                                                        <div className="font-medium text-[13px]">
                                                                            <div className="text-emerald-600 font-bold">{new Intl.NumberFormat('vi-VN').format(Math.round(spendObj.spend_taxed))}đ</div>
                                                                            <div className="text-[11px] text-gray-400 mt-0.5">({new Intl.NumberFormat('vi-VN').format(Math.round(spendObj.spend_raw))}đ)</div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="font-medium text-[13px] text-gray-400">0đ</div>
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="p-3 text-center bg-emerald-50/30 font-bold text-emerald-700 text-[13px]">
                                                            {new Intl.NumberFormat('vi-VN').format(Math.round(totalTaxedInDay))}đ
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    <tfoot className="bg-emerald-50 border-t-2 border-emerald-200 sticky bottom-0 z-20 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                                        <tr>
                                            <td className="p-3 font-bold text-emerald-800 sticky left-0 bg-emerald-50 border-r border-emerald-100 text-[12px] text-center uppercase z-30">
                                                TỔNG:
                                            </td>
                                            {(displayAccounts || []).map(acc => (
                                                <td key={acc.account_id} className="p-3 text-center font-bold text-emerald-600 text-[14px]">
                                                    {new Intl.NumberFormat('vi-VN').format(Math.round(acc.total_taxed))}đ
                                                </td>
                                            ))}
                                            <td className="p-3 text-center font-black text-emerald-700 text-[15px] bg-emerald-100/50">
                                                {new Intl.NumberFormat('vi-VN').format(Math.round(fbSplitData?.total_taxed || 0))}đ
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {showGoogleSplit && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-[90vw] lg:max-w-5xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                                    <BarChart3 size={18} />
                                </div>
                                Thống kê chi tiêu Google Ads theo tài khoản
                            </h3>
                            <button onClick={() => setShowGoogleSplit(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="p-5">
                            <div className="mb-4 text-[13px] text-gray-500 bg-emerald-50 border border-emerald-100 p-3 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div>
                                    <span className="font-medium">Thời gian lọc:</span> {filters.start_date} đến {filters.end_date}
                                </div>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer select-none text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-sm hover:bg-gray-50 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={hideZeroGoogleSpend}
                                            onChange={(e) => setHideZeroGoogleSpend(e.target.checked)}
                                            className="w-3.5 h-3.5 text-emerald-600 rounded bg-gray-100 border-gray-300 focus:ring-emerald-500 focus:ring-2"
                                        />
                                        <span className="text-[12px] font-medium">Ẩn TK 0đ</span>
                                    </label>
                                    <div className="font-bold text-emerald-700">
                                        Thuế/phí áp dụng: +{googleSplitData?.tax_rate}%
                                    </div>
                                </div>
                            </div>

                            {(() => {
                                const displayAccounts = (googleSplitData?.accounts || []).filter(acc => !hideZeroGoogleSpend || acc.total_taxed > 0);
                                return (
                                    <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-sm custom-scrollbar max-h-[60vh]">
                                        <table className="w-full text-left border-collapse [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200 relative">
                                            <thead className="bg-gray-50 sticky top-0 z-20 shadow-sm">
                                                <tr>
                                                    <th className="p-3 text-[12px] font-bold text-gray-500 uppercase sticky left-0 bg-gray-50 z-30 min-w-[100px] text-center border-r border-gray-200">
                                                        Ngày
                                                    </th>
                                                    {(displayAccounts || []).map(acc => (
                                                        <th key={acc.account_id} className="p-3 text-center bg-gray-50 min-w-[150px]">
                                                            <div className="font-semibold text-emerald-700 text-[13px]">{acc.account_name}</div>
                                                            <div className="text-[12px] text-emerald-600 font-bold mt-1">
                                                                Tổng: {new Intl.NumberFormat('vi-VN').format(Math.round(acc.total_taxed))}đ
                                                            </div>
                                                        </th>
                                                    ))}
                                                    <th className="p-3 text-[12px] font-bold text-emerald-700 uppercase bg-emerald-50 text-center min-w-[130px]">
                                                        Cộng Ngày
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 bg-white">
                                                {Object.entries(googleSplitData?.daily_matrix || {}).length === 0 ? (
                                                    <tr>
                                                        <td colSpan={(displayAccounts?.length || 0) + 2} className="py-10 text-center text-gray-400">
                                                            Không có dữ liệu chi tiêu Google Ads trong khoảng thời gian này
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    Object.entries(googleSplitData?.daily_matrix || {}).map(([dateStr, accData]) => {
                                                        const totalTaxedInDay = Object.values(accData).reduce((sum, item) => sum + (item.spend_taxed || 0), 0);
                                                        return (
                                                            <tr key={dateStr} className="hover:bg-gray-50 transition-colors group">
                                                                <td className="p-3 font-semibold text-gray-700 sticky left-0 bg-white z-10 text-[13px] text-center border-r border-gray-200 group-hover:bg-gray-50">
                                                                    {dateStr}
                                                                </td>
                                                                {(displayAccounts || []).map(acc => {
                                                                    const spendObj = accData[acc.account_id];
                                                                    return (
                                                                        <td key={acc.account_id} className="p-3 text-center align-middle">
                                                                            {spendObj && spendObj.spend_raw > 0 ? (
                                                                                <div className="font-medium text-[13px]">
                                                                                    <div className="text-emerald-600 font-bold">{new Intl.NumberFormat('vi-VN').format(Math.round(spendObj.spend_taxed))}đ</div>
                                                                                    <div className="text-[11px] text-gray-400 mt-0.5">({new Intl.NumberFormat('vi-VN').format(Math.round(spendObj.spend_raw))}đ)</div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="font-medium text-[13px] text-gray-400">0đ</div>
                                                                            )}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="p-3 text-center bg-emerald-50/30 font-bold text-emerald-700 text-[13px]">
                                                                    {new Intl.NumberFormat('vi-VN').format(Math.round(totalTaxedInDay))}đ
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                            <tfoot className="bg-emerald-50 border-t-2 border-emerald-200 sticky bottom-0 z-20 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                                                <tr>
                                                    <td className="p-3 font-bold text-emerald-800 sticky left-0 bg-emerald-50 border-r border-emerald-100 text-[12px] text-center uppercase z-30">
                                                        TỔNG:
                                                    </td>
                                                    {(displayAccounts || []).map(acc => (
                                                        <td key={acc.account_id} className="p-3 text-center font-bold text-emerald-600 text-[14px]">
                                                            {new Intl.NumberFormat('vi-VN').format(Math.round(acc.total_taxed))}đ
                                                        </td>
                                                    ))}
                                                    <td className="p-3 text-center font-black text-emerald-700 text-[15px] bg-emerald-100/50">
                                                        {new Intl.NumberFormat('vi-VN').format(Math.round(googleSplitData?.total_taxed || 0))}đ
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DailyProfitReport;
