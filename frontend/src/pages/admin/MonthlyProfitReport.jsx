import React, { useState } from 'react';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0));

const IconBase = ({ size = 20, className = '', children }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        {children}
    </svg>
);

const Filter = ({ size, className }) => <IconBase size={size} className={className}><path d="M4 5h16" /><path d="M7 12h10" /><path d="M10 19h4" /></IconBase>;
const RefreshCw = ({ size, className }) => <IconBase size={size} className={className}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></IconBase>;

const MonthlyProfitReport = () => {
    const [loading, setLoading] = useState(false);
    
    // Dummy Data
    const [reportData] = useState([
        {
            month: 'Tháng 1/2026',
            revenue: 62185008,
            cost_actual: 33141000,
            shipping_fee: 4815000,
            return_fee: 0,
            damaged_goods: 380000,
            exchange_cost: 0,
            salary: 0,
            packaging_fee: 1360000,
            ads_spend: 7248585,
            ads_tax: 7973444, 
            tax: 860550,
            fixed_cost: 0,
            total_profit: 13655014,
            profit_per_house: 6827507,
            notes: 'Đã chia 2/2/2026',
            pct_cost: 53.29,
            pct_shipping: 7.74,
            pct_ads: 11.66
        },
        {
            month: 'Tháng 2/2026',
            revenue: 120500000,
            cost_actual: 60250000,
            shipping_fee: 10500000,
            return_fee: 1200000,
            damaged_goods: 500000,
            exchange_cost: 300000,
            salary: 15000000,
            packaging_fee: 2500000,
            ads_spend: 15000000,
            ads_tax: 16500000,
            tax: 1800000,
            fixed_cost: 5000000,
            total_profit: 6950000,
            profit_per_house: 3475000,
            notes: '',
            pct_cost: 50.00,
            pct_shipping: 8.71,
            pct_ads: 12.45
        }
    ]);

    const defaultCols = [
        'month', 'revenue', 'cost_actual', 'shipping_fee', 'return_fee', 'damaged_goods', 
        'exchange_cost', 'salary', 'packaging_fee', 'ads_spend', 'ads_tax', 'tax', 
        'fixed_cost', 'total_profit', 'profit_per_house', 'notes', 'pct_cost', 'pct_shipping', 'pct_ads'
    ];

    const columnFormulas = {
        'month': 'Tháng báo cáo',
        'revenue': 'Tổng doanh thu trong tháng của các đơn hàng đã giao thành công',
        'cost_actual': 'Tiền hàng thực tế',
        'shipping_fee': 'Tổng tiền cước vận chuyển',
        'return_fee': 'Phí hoàn hàng',
        'damaged_goods': 'Chi phí hàng hỏng',
        'exchange_cost': 'Chi phí đổi trả',
        'salary': 'Chi phí lương nhân viên',
        'packaging_fee': 'Chi phí thùng xốp và xốp nổ',
        'ads_spend': 'Chi phí quảng cáo (QC)',
        'ads_tax': 'Chi phí quảng cáo + Thuế',
        'tax': 'Thuế đóng cho nhà nước',
        'fixed_cost': 'Các chi phí cố định khác (Mặt bằng, điện, nước...)',
        'total_profit': 'Lợi nhuận tổng',
        'profit_per_house': 'Lợi nhuận chia mỗi nhà (chia đôi)',
        'notes': 'Ghi chú thêm',
        'pct_cost': '% Tiền hàng / Doanh thu',
        'pct_shipping': '% Tiền ship / Doanh thu',
        'pct_ads': '% Tiền quảng cáo / Doanh thu'
    };

    const renderHeader = (id) => {
        const tooltip = columnFormulas[id];
        const renderTH = (className, content) => (
            <th key={id} className={`group/header relative ${className}`}>
                <div className="flex flex-col items-center justify-center cursor-help">
                    {content}
                </div>
                {tooltip && (
                    <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 z-[100] mt-1 w-48 p-3 bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 group-hover/header:opacity-100 transition-opacity duration-200">
                        <p className="text-[12px] font-medium text-gray-700 leading-relaxed text-left normal-case">
                            {tooltip}
                        </p>
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-t border-l border-gray-200 rotate-45"></div>
                    </div>
                )}
            </th>
        );

        switch(id) {
            case 'month': return renderTH("px-3 py-4 text-[13px] font-bold text-gray-700 leading-tight align-middle text-center bg-gray-100", <>Tháng</>);
            case 'revenue': return renderTH("px-3 py-4 text-[13px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center bg-yellow-50", <>Doanh thu</>);
            case 'cost_actual': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Tiền hàng<br/>thực tế</>);
            case 'shipping_fee': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Tiền ship<br/>hàng</>);
            case 'return_fee': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Phí hoàn<br/>hàng</>);
            case 'damaged_goods': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Hàng hỏng</>);
            case 'exchange_cost': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Chi phí<br/>đổi trả</>);
            case 'salary': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Chi phí<br/>Lương</>);
            case 'packaging_fee': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Chi phí<br/>xốp + nổ</>);
            case 'ads_spend': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>QC</>);
            case 'ads_tax': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>QC cộng<br/>thuế</>);
            case 'tax': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Thuế</>);
            case 'fixed_cost': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Chi phí<br/>cố định</>);
            case 'total_profit': return renderTH("px-3 py-4 text-[13px] font-bold text-red-600 border-b border-gray-200 leading-tight align-middle text-center bg-gray-50", <>Lợi nhuận<br/>tổng</>);
            case 'profit_per_house': return renderTH("px-3 py-4 text-[13px] font-bold text-red-600 border-b border-gray-200 leading-tight align-middle text-center bg-gray-50", <>Lợi nhuận<br/>mỗi nhà</>);
            case 'notes': return renderTH("px-3 py-4 text-[13px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>Ghi chú</>);
            case 'pct_cost': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>% Tiền<br/>hàng</>);
            case 'pct_shipping': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>% Tiền<br/>ship</>);
            case 'pct_ads': return renderTH("px-3 py-4 text-[12px] font-bold text-gray-700 border-b border-gray-200 leading-tight align-middle text-center", <>% Quảng<br/>cáo</>);
            default: return null;
        }
    };

    const renderTotal = (id) => {
        const aggr = reportData.reduce((acc, row) => {
            Object.keys(row).forEach(k => {
                if (typeof row[k] === 'number') {
                    acc[k] = (acc[k] || 0) + row[k];
                }
            });
            return acc;
        }, {});

        switch(id) {
            case 'month': return <td key='month' className="px-3 py-3 text-[13px] font-bold text-center uppercase tracking-wider">TỔNG CỘNG</td>;
            case 'revenue': return <td key='revenue' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.revenue)}</td>;
            case 'cost_actual': return <td key='cost_actual' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.cost_actual)}</td>;
            case 'shipping_fee': return <td key='shipping_fee' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.shipping_fee)}</td>;
            case 'return_fee': return <td key='return_fee' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.return_fee)}</td>;
            case 'damaged_goods': return <td key='damaged_goods' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.damaged_goods)}</td>;
            case 'exchange_cost': return <td key='exchange_cost' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.exchange_cost)}</td>;
            case 'salary': return <td key='salary' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.salary)}</td>;
            case 'packaging_fee': return <td key='packaging_fee' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.packaging_fee)}</td>;
            case 'ads_spend': return <td key='ads_spend' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.ads_spend)}</td>;
            case 'ads_tax': return <td key='ads_tax' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.ads_tax)}</td>;
            case 'tax': return <td key='tax' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.tax)}</td>;
            case 'fixed_cost': return <td key='fixed_cost' className="px-3 py-3 text-[13px] font-bold text-center">{formatNumber(aggr.fixed_cost)}</td>;
            case 'total_profit': return <td key='total_profit' className="px-3 py-3 text-[13px] font-bold text-center bg-white/10">{formatNumber(aggr.total_profit)}</td>;
            case 'profit_per_house': return <td key='profit_per_house' className="px-3 py-3 text-[13px] font-bold text-center bg-white/10">{formatNumber(aggr.profit_per_house)}</td>;
            case 'notes': return <td key='notes' className="px-3 py-3"></td>;
            case 'pct_cost': return <td key='pct_cost' className="px-3 py-3 text-[13px] font-bold text-center">{(aggr.revenue > 0 ? (aggr.cost_actual / aggr.revenue * 100) : 0).toFixed(2)}%</td>;
            case 'pct_shipping': return <td key='pct_shipping' className="px-3 py-3 text-[13px] font-bold text-center">{(aggr.revenue > 0 ? (aggr.shipping_fee / aggr.revenue * 100) : 0).toFixed(2)}%</td>;
            case 'pct_ads': return <td key='pct_ads' className="px-3 py-3 text-[13px] font-bold text-center">{(aggr.revenue > 0 ? (aggr.ads_spend / aggr.revenue * 100) : 0).toFixed(2)}%</td>;
            default: return null;
        }
    };

    const renderRow = (id, row) => {
        switch(id) {
            case 'month': return <td key='month' className="px-3 py-3 text-[13px] font-bold text-gray-700 text-center border-r border-gray-50">{row.month}</td>;
            case 'revenue': return <td key='revenue' className="px-3 py-3 text-[13px] font-bold text-gray-800 text-center bg-yellow-50/30">{row.revenue > 0 ? formatNumber(row.revenue) : '-'}</td>;
            case 'cost_actual': return <td key='cost_actual' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.cost_actual > 0 ? formatNumber(row.cost_actual) : '-'}</td>;
            case 'shipping_fee': return <td key='shipping_fee' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.shipping_fee > 0 ? formatNumber(row.shipping_fee) : '-'}</td>;
            case 'return_fee': return <td key='return_fee' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.return_fee > 0 ? formatNumber(row.return_fee) : '-'}</td>;
            case 'damaged_goods': return <td key='damaged_goods' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.damaged_goods > 0 ? formatNumber(row.damaged_goods) : '-'}</td>;
            case 'exchange_cost': return <td key='exchange_cost' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.exchange_cost > 0 ? formatNumber(row.exchange_cost) : '-'}</td>;
            case 'salary': return <td key='salary' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.salary > 0 ? formatNumber(row.salary) : '-'}</td>;
            case 'packaging_fee': return <td key='packaging_fee' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.packaging_fee > 0 ? formatNumber(row.packaging_fee) : '-'}</td>;
            case 'ads_spend': return <td key='ads_spend' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.ads_spend > 0 ? formatNumber(row.ads_spend) : '-'}</td>;
            case 'ads_tax': return <td key='ads_tax' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.ads_tax > 0 ? formatNumber(row.ads_tax) : '-'}</td>;
            case 'tax': return <td key='tax' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.tax > 0 ? formatNumber(row.tax) : '-'}</td>;
            case 'fixed_cost': return <td key='fixed_cost' className="px-3 py-3 text-[13px] text-gray-600 text-center bg-pink-50/10">{row.fixed_cost > 0 ? formatNumber(row.fixed_cost) : '-'}</td>;
            case 'total_profit': return <td key='total_profit' className={`px-3 py-3 text-[13px] font-bold text-center bg-gray-50 ${row.total_profit < 0 ? 'text-red-500' : 'text-red-600'}`}>{row.total_profit > 0 || row.total_profit < 0 ? formatNumber(row.total_profit) : '-'}</td>;
            case 'profit_per_house': return <td key='profit_per_house' className={`px-3 py-3 text-[13px] font-bold text-center bg-gray-50 ${row.profit_per_house < 0 ? 'text-red-500' : 'text-red-600'}`}>{row.profit_per_house > 0 || row.profit_per_house < 0 ? formatNumber(row.profit_per_house) : '-'}</td>;
            case 'notes': return <td key='notes' className="px-3 py-3 text-[12px] text-orange-600 font-medium text-center">{row.notes}</td>;
            case 'pct_cost': return <td key='pct_cost' className="px-3 py-3 text-[13px] text-gray-600 text-center">{row.revenue > 0 ? row.pct_cost.toFixed(2) + '%' : '#DIV/0!'}</td>;
            case 'pct_shipping': return <td key='pct_shipping' className="px-3 py-3 text-[13px] text-gray-600 text-center">{row.revenue > 0 ? row.pct_shipping.toFixed(2) + '%' : '#DIV/0!'}</td>;
            case 'pct_ads': return <td key='pct_ads' className="px-3 py-3 text-[13px] text-gray-600 text-center">{row.revenue > 0 ? row.pct_ads.toFixed(2) + '%' : '#DIV/0!'}</td>;
            default: return null;
        }
    };

    const loadData = async () => {
        setLoading(true);
        setTimeout(() => setLoading(false), 500);
    };

    return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
            <div className="bg-white p-3 rounded-xl shadow-sm mb-4 border border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-gray-800 whitespace-nowrap">Báo cáo lãi lỗ tháng</h1>
                    <div className="h-6 w-px bg-gray-200 hidden md:block"></div>

                    <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                        <button className="px-3 py-1 text-[13px] font-bold rounded-md transition-all bg-white text-emerald-700 shadow-sm">
                            Năm nay
                        </button>
                        <button className="px-3 py-1 text-[13px] font-bold text-gray-500 hover:text-gray-700 rounded-md transition-all">
                            Năm trước
                        </button>
                    </div>

                    <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                        <Filter size={14} className="text-gray-400" />
                        <select className="text-[13px] border border-gray-200 rounded-md p-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                            <option value="2026">2026</option>
                            <option value="2025">2025</option>
                        </select>
                    </div>
                </div>

                <div className="flex items-center gap-2">
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

            <div className="bg-white p-4 rounded-xl shadow-sm mb-4 border border-blue-100">
                <p className="text-[13px] text-blue-800 font-medium flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">info</span>
                    Báo cáo lãi lỗ theo tháng chỉ được tính toán và chốt sổ khi <strong>tất cả đơn hàng phát sinh trong tháng đã giao thành công</strong> (không còn đơn đang vận chuyển).
                </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[75vh]">
                    <table className="w-full text-left border-collapse min-w-[1500px] [&_th]:border [&_th]:border-gray-200 [&_td]:border [&_td]:border-gray-200">
                        <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                            <tr>
                                {defaultCols.map(id => renderHeader(id))}
                            </tr>
                            <tr className="bg-emerald-600 text-white border-b border-emerald-700 sticky top-[53px] z-20">
                                {defaultCols.map(id => renderTotal(id))}
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {reportData.map((row, index) => (
                                <tr key={index} className="hover:bg-gray-50 transition-colors group">
                                    {defaultCols.map(id => renderRow(id, row))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Ghi chú chân trang */}
            <div className="mt-4 flex flex-col md:flex-row justify-between items-start md:items-center text-[12px] text-gray-400 italic">
                <p>* Dữ liệu dựa trên báo cáo chi tiết theo ngày nhưng được nhóm lại thành từng tháng.</p>
            </div>
        </div>
    );
};

export default MonthlyProfitReport;
