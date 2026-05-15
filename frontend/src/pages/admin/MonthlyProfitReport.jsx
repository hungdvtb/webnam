import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { financeApi } from '../../services/api';
import { saveOrderReportDrilldownScope } from '../../utils/orderReportDrilldown';

const formatNumber = (value) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0));

const padNumber = (value) => String(value).padStart(2, '0');

const formatInputDate = (date) =>
    `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const MONTHLY_PROFIT_COST_FIELDS = [
    'cost_actual',
    'shipping_fee',
    'damaged_goods',
    'salary',
    'packaging_fee',
    'ads_spend',
    'tax',
    'fixed_cost',
];
const getNumericValue = (row, field) => Number(row?.[field] || 0);
const calculateMonthlyTotalProfit = (row) =>
    roundMoney(
        getNumericValue(row, 'revenue')
        - MONTHLY_PROFIT_COST_FIELDS.reduce((sum, field) => sum + getNumericValue(row, field), 0)
        + getNumericValue(row, 'exchange_profit_loss')
        + getNumericValue(row, 'partial_delivery_profit_loss')
    );
const normalizeMonthlyProfitRow = (row = {}) => {
    const totalProfit = calculateMonthlyTotalProfit(row);

    return {
        ...row,
        total_profit: totalProfit,
        profit_per_house: roundMoney(totalProfit / 2),
    };
};
const hasAdsSpendBreakdown = (taxedValue, rawValue) =>
    Math.abs(Number(taxedValue || 0) - Number(rawValue || 0)) > 1;
const renderAdsSpendBreakdown = (taxedValue, rawValue, rawClassName) => (
    <div className="flex flex-col items-center">
        <span>{formatNumber(taxedValue)}</span>
        {hasAdsSpendBreakdown(taxedValue, rawValue) ? (
            <span className={`mt-0.5 text-[12px] font-normal ${rawClassName}`}>
                ({formatNumber(rawValue)})
            </span>
        ) : null}
    </div>
);
const MONTHLY_REPORT_DRILLDOWN_COLUMNS = new Set([
    'order_count',
    'revenue',
    'cost_actual',
    'shipping_fee',
    'exchange_profit_loss',
    'partial_delivery_profit_loss',
]);
const AD_CHANNEL_OPTIONS = [
    { value: 'all', label: 'Tất cả kênh' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'google', label: 'Google' },
];

const getReportRange = (year) => {
    const today = new Date();
    const currentYear = today.getFullYear();

    return {
        start_date: `${year}-01-01`,
        end_date: year >= currentYear ? formatInputDate(today) : `${year}-12-31`,
    };
};

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

const MonthlyProfitReport = () => {
    const navigate = useNavigate();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [quickFilter, setQuickFilter] = useState('year'); // 'year', '3months', '6months', 'custom'
    const [customRange, setCustomRange] = useState({
        start: formatInputDate(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1)),
        end: formatInputDate(new Date())
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [reportData, setReportData] = useState([]);
    const [reportSummary, setReportSummary] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [drilldownCellKey, setDrilldownCellKey] = useState('');
    const [adChannel, setAdChannel] = useState('all');

    const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - index);

    const getQueryRange = () => {
        if (quickFilter === '3months') {
            const end = new Date();
            const start = new Date();
            start.setMonth(end.getMonth() - 2);
            start.setDate(1);
            return { start_date: formatInputDate(start), end_date: formatInputDate(end) };
        }
        if (quickFilter === '6months') {
            const end = new Date();
            const start = new Date();
            start.setMonth(end.getMonth() - 5);
            start.setDate(1);
            return { start_date: formatInputDate(start), end_date: formatInputDate(end) };
        }
        if (quickFilter === 'custom') {
            return { start_date: customRange.start, end_date: customRange.end };
        }
        // Fallback to year
        return getReportRange(selectedYear);
    };

    const defaultCols = [
        'month',
        'order_count',
        'revenue',
        'cost_actual',
        'shipping_fee',
        'damaged_goods',
        'salary',
        'packaging_fee',
        'fb_ads_spend',
        'google_ads_spend',
        'ads_spend',
        'tax',
        'fixed_cost',
        'exchange_profit_loss',
        'partial_delivery_profit_loss',
        'total_profit',
        'profit_per_house',
    ];

    const columnFormulas = {
        month: 'Tháng báo cáo, tổng hợp từ dữ liệu báo cáo ngày thực tế.',
        order_count: 'Tổng số đơn gửi đi trong tháng, đếm theo ngày gửi đi thực tế (shipping_dispatched_at).',
        revenue: 'Tổng doanh thu gốc trong tháng, chỉ tính đơn thường có trạng thái Giao hàng thành công; loại bỏ đơn đổi trả và giao hàng 1 phần.',
        cost_actual: 'Tổng tiền hàng thực tế trong tháng, là tổng giá vốn của các đơn thường có trạng thái Giao hàng thành công; loại bỏ đơn đổi trả và giao hàng 1 phần.',
        shipping_fee: 'Tổng phí ship của tất cả đơn trong tháng, ưu tiên phí ship thực tế của đơn; nếu chưa có thì lấy 5% x tổng tiền đơn.',
        damaged_goods: 'Chi phí hàng hỏng. Hiện chỉ cộng được khi backend trả riêng trường này.',
        exchange_profit_loss: 'Tổng lãi/lỗ đổi trả trong tháng.',
        partial_delivery_profit_loss: 'Tổng lãi/lỗ giao hàng 1 phần trong tháng.',
        salary: 'Chi phí lương. Hiện chỉ cộng được khi backend trả riêng trường này.',
        packaging_fee: 'Tổng số đơn của tháng x Phí đóng gói/đơn lấy từ phần cấu hình của báo cáo lãi lỗ ngày.',
        fb_ads_spend: 'Tổng QC Facebook trong tháng. Số chính là sau thuế, số trong ngoặc là trước thuế khi có chênh lệch.',
        google_ads_spend: 'Tổng QC Google trong tháng. Số chính là sau thuế, số trong ngoặc là trước thuế khi có chênh lệch.',
        ads_spend: 'Tổng QC thực tế trong tháng, bằng QC FB + QC GG. Số này được dùng để tính lãi lỗ.',
        tax: 'Tổng thuế tạm tính trong tháng.',
        fixed_cost: 'Tổng chi phí cố định trong tháng.',
        total_profit: 'Lợi nhuận tổng = Doanh thu - Tiền hàng thực tế - Tiền ship hàng - Hàng hỏng - Chi phí lương - Chi phí gói hàng - QC - Thuế - Chi phí cố định + Lãi lỗ đổi trả + Lãi lỗ giao 1 phần.',
        profit_per_house: 'Lợi nhuận tổng chia 2.',
    };

    columnFormulas.shipping_fee = 'Tổng phí ship của tất cả đơn hợp lệ trong tháng, gồm đơn thường, đơn đổi trả và giao hàng 1 phần; ưu tiên phí ship thực tế, nếu chưa có thì lấy 5% x doanh số đơn.';
    columnFormulas.tax = 'Thuế tháng hiện vẫn tính riêng trên các đơn thành công trong tháng: (Doanh thu các đơn thành công - tiền ship của chính tập đơn thành công đó) x 1.5%.';

    useEffect(() => {
        let ignore = false;

        const loadData = async () => {
            setLoading(true);
            setError('');

            try {
                const range = getQueryRange();
                const reportParams = {
                    ...range,
                    ad_channel: adChannel,
                };

                await financeApi.syncFbAdSpend(range).catch(() => null);

                const response = await financeApi.getMonthlyPnlReport(reportParams);
                if (ignore) return;

                setReportData(response?.data?.data || []);
                setReportSummary(response?.data?.summary || null);
            } catch (requestError) {
                if (!ignore) {
                    setReportData([]);
                    setReportSummary(null);
                    setError(requestError.response?.data?.message || 'Không thể tải báo cáo lãi lỗ tháng.');
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        };

        loadData();

        return () => {
            ignore = true;
        };
    }, [reloadKey, selectedYear, quickFilter, customRange, adChannel]);

    const normalizedReportData = reportData.map((row) => normalizeMonthlyProfitRow(row));
    const normalizedReportSummary = reportSummary ? normalizeMonthlyProfitRow(reportSummary) : null;

    const totals = normalizedReportData.reduce((acc, row) => ({
        order_count: acc.order_count + Number(row.order_count || 0),
        revenue: acc.revenue + Number(row.revenue || 0),
        cost_actual: acc.cost_actual + Number(row.cost_actual || 0),
        shipping_fee: acc.shipping_fee + Number(row.shipping_fee || 0),
        damaged_goods: acc.damaged_goods + Number(row.damaged_goods || 0),
        exchange_profit_loss: acc.exchange_profit_loss + Number(row.exchange_profit_loss || 0),
        partial_delivery_profit_loss: acc.partial_delivery_profit_loss + Number(row.partial_delivery_profit_loss || 0),
        salary: acc.salary + Number(row.salary || 0),
        packaging_fee: acc.packaging_fee + Number(row.packaging_fee || 0),
        fb_ads_spend_raw: acc.fb_ads_spend_raw + Number(row.fb_ads_spend_raw || 0),
        fb_ads_spend: acc.fb_ads_spend + Number(row.fb_ads_spend || 0),
        google_ads_spend_raw: acc.google_ads_spend_raw + Number(row.google_ads_spend_raw || 0),
        google_ads_spend: acc.google_ads_spend + Number(row.google_ads_spend || 0),
        ads_spend_raw: acc.ads_spend_raw + Number(row.ads_spend_raw || 0),
        ads_spend: acc.ads_spend + Number(row.ads_spend || 0),
        tax: acc.tax + Number(row.tax || 0),
        fixed_cost: acc.fixed_cost + Number(row.fixed_cost || 0),
        total_profit: acc.total_profit + Number(row.total_profit || 0),
    }), {
        order_count: 0,
        revenue: 0,
        cost_actual: 0,
        shipping_fee: 0,
        damaged_goods: 0,
        exchange_profit_loss: 0,
        partial_delivery_profit_loss: 0,
        salary: 0,
        packaging_fee: 0,
        fb_ads_spend_raw: 0,
        fb_ads_spend: 0,
        google_ads_spend_raw: 0,
        google_ads_spend: 0,
        ads_spend_raw: 0,
        ads_spend: 0,
        tax: 0,
        fixed_cost: 0,
        total_profit: 0,
    });

    const totalValue = (field, fallbackField = field) => {
        if (normalizedReportSummary && normalizedReportSummary[field] !== undefined && normalizedReportSummary[field] !== null) {
            return Number(normalizedReportSummary[field] || 0);
        }

        if (normalizedReportSummary && fallbackField !== field && normalizedReportSummary[fallbackField] !== undefined && normalizedReportSummary[fallbackField] !== null) {
            return Number(normalizedReportSummary[fallbackField] || 0);
        }

        return Number(totals[field] || 0);
    };

    const totalRow = normalizeMonthlyProfitRow({
        order_count: totalValue('order_count', 'total_orders'),
        revenue: roundMoney(totalValue('revenue', 'total_revenue')),
        cost_actual: roundMoney(totalValue('cost_actual')),
        shipping_fee: roundMoney(totalValue('shipping_fee')),
        damaged_goods: roundMoney(totalValue('damaged_goods')),
        exchange_profit_loss: roundMoney(totalValue('exchange_profit_loss')),
        partial_delivery_profit_loss: roundMoney(totalValue('partial_delivery_profit_loss')),
        salary: roundMoney(totalValue('salary')),
        packaging_fee: roundMoney(totalValue('packaging_fee')),
        fb_ads_spend_raw: roundMoney(totalValue('fb_ads_spend_raw')),
        fb_ads_spend: roundMoney(totalValue('fb_ads_spend')),
        google_ads_spend_raw: roundMoney(totalValue('google_ads_spend_raw')),
        google_ads_spend: roundMoney(totalValue('google_ads_spend')),
        ads_spend_raw: roundMoney(totalValue('ads_spend_raw')),
        ads_spend: roundMoney(totalValue('ads_spend')),
        tax: roundMoney(totalValue('tax', 'total_tax')),
        fixed_cost: roundMoney(totalValue('fixed_cost')),
    });

    const sortedReportData = [...normalizedReportData].sort((left, right) => {
        const leftKey = String(left.key || '');
        const rightKey = String(right.key || '');

        return rightKey.localeCompare(leftKey);
    });

    const handleMonthlyMetricDrilldown = useCallback(async (row, metric) => {
        if (!row?.key || !MONTHLY_REPORT_DRILLDOWN_COLUMNS.has(metric)) {
            return;
        }

        if (Number(row?.[metric] || 0) === 0) {
            return;
        }

        const cellKey = `${row.key}:${metric}`;
        setDrilldownCellKey(cellKey);

        try {
            const range = getQueryRange();
            const response = await financeApi.getMonthlyPnlReportDrilldown({
                metric,
                month: row.key,
                ...range,
                ad_channel: adChannel,
            });
            const scope = response?.data?.data || null;
            const scopeKey = saveOrderReportDrilldownScope(scope);

            if (!scopeKey) {
                throw new Error('Không thể lưu bộ lọc drilldown.');
            }

            navigate(`/admin/orders?report_scope_key=${encodeURIComponent(scopeKey)}`);
        } catch (requestError) {
            setError(requestError.response?.data?.message || requestError.message || 'Không thể mở danh sách đơn hàng cho số liệu này.');
        } finally {
            setDrilldownCellKey((current) => (current === cellKey ? '' : current));
        }
    }, [adChannel, customRange, navigate, quickFilter, selectedYear]);

    const renderMetricCellContent = (metric, row, content) => {
        const value = Number(row?.[metric] || 0);
        const cellKey = `${row?.key || row?.month || 'unknown'}:${metric}`;
        const isActive = drilldownCellKey === cellKey;

        if (!MONTHLY_REPORT_DRILLDOWN_COLUMNS.has(metric) || value === 0) {
            return content;
        }

        return (
            <button
                type="button"
                onClick={() => handleMonthlyMetricDrilldown(row, metric)}
                disabled={isActive}
                title="Mở bảng quản lí đơn hàng theo số liệu này"
                className="group/drilldown inline-flex items-center justify-center rounded-sm px-1 transition hover:underline hover:decoration-dotted hover:underline-offset-4 disabled:cursor-wait disabled:opacity-70"
            >
                <span>{content}</span>
                <span
                    className={`material-symbols-outlined overflow-hidden text-[15px] transition-all duration-150 ${
                        isActive
                            ? 'ml-1 w-[15px] opacity-100 animate-pulse'
                            : 'ml-0 w-0 opacity-0 group-hover/drilldown:ml-1 group-hover/drilldown:w-[15px] group-hover/drilldown:opacity-100 group-focus-visible/drilldown:ml-1 group-focus-visible/drilldown:w-[15px] group-focus-visible/drilldown:opacity-100'
                    }`}
                >
                    {isActive ? 'sync' : 'open_in_new'}
                </span>
            </button>
        );
    };

    const renderHeader = (id) => {
        const tooltip = columnFormulas[id];
        const renderTH = (className, content) => (
            <th key={id} className={`group/header relative ${className}`}>
                <div className="flex cursor-help flex-col items-center justify-center">
                    {content}
                </div>
                {tooltip ? (
                    <div className="pointer-events-none absolute left-1/2 top-full z-[100] mt-1 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 opacity-0 shadow-xl transition-opacity duration-200 group-hover/header:opacity-100">
                        <p className="text-left text-[12px] font-medium leading-relaxed text-gray-700 normal-case">
                            {tooltip}
                        </p>
                        <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-gray-200 bg-white" />
                    </div>
                ) : null}
            </th>
        );

        switch (id) {
            case 'month':
                return renderTH('bg-gray-100 px-3 py-4 text-center align-middle text-[13px] font-bold text-gray-700', <>Tháng</>);
            case 'order_count':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Đơn hàng</>);
            case 'revenue':
                return renderTH('bg-yellow-50 px-3 py-4 text-center align-middle text-[13px] font-bold text-gray-700', <>Doanh thu</>);
            case 'cost_actual':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Tiền hàng<br />thực tế</>);
            case 'shipping_fee':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Tiền ship<br />hàng</>);
            case 'damaged_goods':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Hàng hỏng</>);
            case 'exchange_profit_loss':
                return renderTH('bg-gray-50 px-3 py-4 text-center align-middle text-[12px] font-bold text-red-600', <>Lãi lỗ<br />đổi trả</>);
            case 'partial_delivery_profit_loss':
                return renderTH('bg-gray-50 px-3 py-4 text-center align-middle text-[12px] font-bold text-red-600', <>Lãi lỗ<br />giao 1 phần</>);
            case 'salary':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Chi phí<br />lương</>);
            case 'packaging_fee':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Chi phí<br />gói hàng</>);
            case 'fb_ads_spend':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>QC FB</>);
            case 'google_ads_spend':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>QC GG</>);
            case 'ads_spend':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Tổng QC</>);
            case 'tax':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Thuế</>);
            case 'fixed_cost':
                return renderTH('px-3 py-4 text-center align-middle text-[12px] font-bold text-gray-700', <>Chi phí<br />cố định</>);
            case 'total_profit':
                return renderTH('bg-gray-50 px-3 py-4 text-center align-middle text-[13px] font-bold text-red-600', <>Lợi nhuận<br />tổng</>);
            case 'profit_per_house':
                return renderTH('bg-gray-50 px-3 py-4 text-center align-middle text-[13px] font-bold text-red-600', <>Lợi nhuận<br />mỗi nhà</>);
            default:
                return null;
        }
    };

    const renderTotal = (id) => {
        switch (id) {
            case 'month':
                return <td key="month" className="px-3 py-3 text-center text-[13px] font-bold uppercase tracking-wider">TỔNG CỘNG</td>;
            case 'order_count':
                return <td key="order_count" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.order_count)}</td>;
            case 'revenue':
                return <td key="revenue" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.revenue)}</td>;
            case 'cost_actual':
                return <td key="cost_actual" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.cost_actual)}</td>;
            case 'shipping_fee':
                return <td key="shipping_fee" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.shipping_fee)}</td>;
            case 'damaged_goods':
                return <td key="damaged_goods" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.damaged_goods)}</td>;
            case 'exchange_profit_loss':
                return <td key="exchange_profit_loss" className="bg-white/10 px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.exchange_profit_loss)}</td>;
            case 'partial_delivery_profit_loss':
                return <td key="partial_delivery_profit_loss" className="bg-white/10 px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.partial_delivery_profit_loss)}</td>;
            case 'salary':
                return <td key="salary" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.salary)}</td>;
            case 'packaging_fee':
                return <td key="packaging_fee" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.packaging_fee)}</td>;
            case 'fb_ads_spend':
                return (
                    <td key="fb_ads_spend" className="px-3 py-3 text-center text-[13px] font-bold">
                        {renderAdsSpendBreakdown(totalRow.fb_ads_spend, totalRow.fb_ads_spend_raw, 'text-white/70')}
                    </td>
                );
            case 'google_ads_spend':
                return (
                    <td key="google_ads_spend" className="px-3 py-3 text-center text-[13px] font-bold">
                        {renderAdsSpendBreakdown(totalRow.google_ads_spend, totalRow.google_ads_spend_raw, 'text-white/70')}
                    </td>
                );
            case 'ads_spend':
                return (
                    <td key="ads_spend" className="px-3 py-3 text-center text-[13px] font-bold">
                        {renderAdsSpendBreakdown(totalRow.ads_spend, totalRow.ads_spend_raw, 'text-white/70')}
                    </td>
                );
            case 'tax':
                return <td key="tax" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.tax)}</td>;
            case 'fixed_cost':
                return <td key="fixed_cost" className="px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.fixed_cost)}</td>;
            case 'total_profit':
                return <td key="total_profit" className="bg-white/10 px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.total_profit)}</td>;
            case 'profit_per_house':
                return <td key="profit_per_house" className="bg-white/10 px-3 py-3 text-center text-[13px] font-bold">{formatNumber(totalRow.profit_per_house)}</td>;
            default:
                return null;
        }
    };

    const renderRow = (id, row) => {
        switch (id) {
            case 'month':
                return <td key="month" className="border-r border-gray-50 px-3 py-3 text-center text-[13px] font-bold text-gray-700">{row.month}</td>;
            case 'order_count':
                return (
                    <td key="order_count" className="px-3 py-3 text-center text-[13px] font-bold text-gray-700">
                        {renderMetricCellContent('order_count', row, formatNumber(row.order_count))}
                    </td>
                );
            case 'revenue':
                return (
                    <td key="revenue" className="bg-yellow-50/30 px-3 py-3 text-center text-[13px] font-bold text-gray-800">
                        {row.revenue !== 0 ? renderMetricCellContent('revenue', row, formatNumber(row.revenue)) : '-'}
                    </td>
                );
            case 'cost_actual':
                return (
                    <td key="cost_actual" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">
                        {row.cost_actual !== 0 ? renderMetricCellContent('cost_actual', row, formatNumber(row.cost_actual)) : '-'}
                    </td>
                );
            case 'shipping_fee':
                return (
                    <td key="shipping_fee" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">
                        {row.shipping_fee !== 0 ? renderMetricCellContent('shipping_fee', row, formatNumber(row.shipping_fee)) : '-'}
                    </td>
                );
            case 'damaged_goods':
                return <td key="damaged_goods" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">{row.damaged_goods !== 0 ? formatNumber(row.damaged_goods) : '-'}</td>;
            case 'exchange_profit_loss':
                return (
                    <td
                        key="exchange_profit_loss"
                        className={`bg-gray-50 px-3 py-3 text-center text-[13px] font-bold ${row.exchange_profit_loss < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                    >
                        {row.exchange_profit_loss !== 0 ? renderMetricCellContent('exchange_profit_loss', row, formatNumber(row.exchange_profit_loss)) : '-'}
                    </td>
                );
            case 'partial_delivery_profit_loss':
                return (
                    <td
                        key="partial_delivery_profit_loss"
                        className={`bg-gray-50 px-3 py-3 text-center text-[13px] font-bold ${row.partial_delivery_profit_loss < 0 ? 'text-red-600' : 'text-emerald-600'}`}
                    >
                        {row.partial_delivery_profit_loss !== 0 ? renderMetricCellContent('partial_delivery_profit_loss', row, formatNumber(row.partial_delivery_profit_loss)) : '-'}
                    </td>
                );
            case 'salary':
                return <td key="salary" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">{row.salary !== 0 ? formatNumber(row.salary) : '-'}</td>;
            case 'packaging_fee':
                return <td key="packaging_fee" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">{row.packaging_fee !== 0 ? formatNumber(row.packaging_fee) : '-'}</td>;
            case 'fb_ads_spend':
                return (
                    <td key="fb_ads_spend" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">
                        {Number(row.fb_ads_spend || 0) !== 0
                            ? renderAdsSpendBreakdown(row.fb_ads_spend, row.fb_ads_spend_raw, 'text-gray-400')
                            : '-'}
                    </td>
                );
            case 'google_ads_spend':
                return (
                    <td key="google_ads_spend" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">
                        {Number(row.google_ads_spend || 0) !== 0
                            ? renderAdsSpendBreakdown(row.google_ads_spend, row.google_ads_spend_raw, 'text-gray-400')
                            : '-'}
                    </td>
                );
            case 'ads_spend':
                return (
                    <td key="ads_spend" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">
                        {Number(row.ads_spend || 0) !== 0
                            ? renderAdsSpendBreakdown(row.ads_spend, row.ads_spend_raw, 'text-gray-400')
                            : '-'}
                    </td>
                );
            case 'tax':
                return <td key="tax" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">{row.tax !== 0 ? formatNumber(row.tax) : '-'}</td>;
            case 'fixed_cost':
                return <td key="fixed_cost" className="bg-pink-50/10 px-3 py-3 text-center text-[13px] text-gray-600">{row.fixed_cost !== 0 ? formatNumber(row.fixed_cost) : '-'}</td>;
            case 'total_profit':
                return (
                    <td
                        key="total_profit"
                        className={`bg-gray-50 px-3 py-3 text-center text-[13px] font-bold ${row.total_profit < 0 ? 'text-red-500' : 'text-red-600'}`}
                    >
                        {row.total_profit !== 0 ? formatNumber(row.total_profit) : '-'}
                    </td>
                );
            case 'profit_per_house':
                return (
                    <td
                        key="profit_per_house"
                        className={`bg-gray-50 px-3 py-3 text-center text-[13px] font-bold ${row.profit_per_house < 0 ? 'text-red-500' : 'text-red-600'}`}
                    >
                        {row.profit_per_house !== 0 ? formatNumber(row.profit_per_house) : '-'}
                    </td>
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-4">
                    <h1 className="whitespace-nowrap text-xl font-bold text-gray-800">Báo cáo lãi lỗ tháng</h1>
                    <div className="hidden h-6 w-px bg-gray-200 md:block" />

                    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-100 p-1">
                        <button
                            type="button"
                            onClick={() => { setQuickFilter('3months'); setSelectedYear(currentYear); }}
                            className={`rounded-md px-3 py-1 text-[13px] font-bold transition-all ${quickFilter === '3months' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            3 tháng gần nhất
                        </button>
                        <button
                            type="button"
                            onClick={() => { setQuickFilter('6months'); setSelectedYear(currentYear); }}
                            className={`rounded-md px-3 py-1 text-[13px] font-bold transition-all ${quickFilter === '6months' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            6 tháng gần nhất
                        </button>
                        <button
                            type="button"
                            onClick={() => { setQuickFilter('year'); setSelectedYear(currentYear); }}
                            className={`rounded-md px-3 py-1 text-[13px] font-bold transition-all ${quickFilter === 'year' && selectedYear === currentYear ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Năm nay
                        </button>
                        <button
                            type="button"
                            onClick={() => { setQuickFilter('year'); setSelectedYear(currentYear - 1); }}
                            className={`rounded-md px-3 py-1 text-[13px] font-bold transition-all ${quickFilter === 'year' && selectedYear === currentYear - 1 ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Năm trước
                        </button>
                    </div>

                    <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                        <Filter size={14} className="text-gray-400" />
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={customRange.start}
                                onChange={(e) => { setCustomRange({ ...customRange, start: e.target.value }); setQuickFilter('custom'); }}
                                className="rounded-md border border-gray-200 p-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <span className="text-gray-400">→</span>
                            <input
                                type="date"
                                value={customRange.end}
                                onChange={(e) => { setCustomRange({ ...customRange, end: e.target.value }); setQuickFilter('custom'); }}
                                className="rounded-md border border-gray-200 p-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                        <span className="text-[12px] font-bold uppercase tracking-wide text-gray-400">Kênh</span>
                        <select
                            value={adChannel}
                            onChange={(e) => setAdChannel(e.target.value)}
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
                        type="button"
                        onClick={() => setReloadKey((value) => value + 1)}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-[13px] font-medium text-white transition-all hover:bg-gray-900 active:scale-95 disabled:opacity-70"
                    >
                        <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
                        {loading ? 'Đang tải...' : 'Làm mới'}
                    </button>
                </div>
            </div>

            {error ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="min-h-[460px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:min-h-[560px]">
                <div className="min-h-[460px] max-h-[75vh] overflow-auto md:min-h-[560px]">
                    <table className="min-w-[1420px] w-full border-collapse text-left [&_td]:border [&_td]:border-gray-200 [&_th]:border [&_th]:border-gray-200">
                        <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                            <tr>
                                {defaultCols.map((id) => renderHeader(id))}
                            </tr>
                            <tr className="sticky top-[53px] z-20 border-b border-emerald-700 bg-emerald-600 text-white">
                                {defaultCols.map((id) => renderTotal(id))}
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {!loading && normalizedReportData.length === 0 ? (
                                <tr>
                                    <td colSpan={defaultCols.length} className="px-4 py-12 text-center text-[13px] text-gray-400">
                                        Không có dữ liệu phát sinh cho năm {selectedYear}.
                                    </td>
                                </tr>
                            ) : (
                                sortedReportData.map((row) => (
                                    <tr key={row.key || row.month} className="group transition-colors hover:bg-gray-50">
                                        {defaultCols.map((id) => renderRow(id, row))}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="mt-4 flex flex-col items-start justify-between gap-2 text-[12px] italic text-gray-400 md:flex-row md:items-center">
                <p>* Dữ liệu tháng đã lấy từ backend thật, không còn dùng dữ liệu mẫu.</p>
                <p>* Cột Đơn hàng hiện đếm theo ngày gửi đi thực tế của đơn.</p>
            </div>
        </div>
    );
};

export default MonthlyProfitReport;
