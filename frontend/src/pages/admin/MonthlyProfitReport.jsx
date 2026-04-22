import React, { useState } from 'react';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0));

const MonthlyProfitReport = () => {
    // Dummy data to simulate the spreadsheet
    const [reportData] = useState([
        {
            month: 'Lãi trước 16/1',
            revenue: 62185008,
            cost_actual: 33141000,
            shipping_fee: 4815000,
            return_fee: 0,
            damaged_goods: 380000,
            exchange_cost: 0,
            salary: 0,
            packaging_fee: 1360000,
            ads_spend: 7248585,
            ads_tax: 7973444, // assuming QC cộng thuế is QC + 10% or similar
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
        },
        {
            month: 'Tháng 3/2026',
            revenue: 0,
            cost_actual: 0,
            shipping_fee: 0,
            return_fee: 0,
            damaged_goods: 0,
            exchange_cost: 0,
            salary: 0,
            packaging_fee: 0,
            ads_spend: 0,
            ads_tax: 0,
            tax: 0,
            fixed_cost: 0,
            total_profit: 0,
            profit_per_house: 0,
            notes: 'tính tất cả đơn từ 16/1 đổ lại, từ 17/1 tính mới',
            pct_cost: 0,
            pct_shipping: 0,
            pct_ads: 0
        }
    ]);

    return (
        <div className="p-4 md:p-6 bg-gray-50 min-h-screen">
            <div className="bg-white p-4 rounded-xl shadow-sm mb-4 border border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-600 text-2xl">request_quote</span>
                        <h1 className="text-xl font-bold text-gray-800 uppercase tracking-tight">Bảng khái toán doanh thu - chi phí - lợi nhuận</h1>
                    </div>
                    <p className="text-[12px] text-gray-500 font-medium mt-1">
                        Báo cáo lãi lỗ theo tháng. <span className="text-orange-600 font-bold">* Lưu ý: Chỉ tính khi tất cả đơn hàng trong tháng đã giao thành công (không còn đơn đang giao).</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-[13px] font-bold flex items-center gap-2 shadow hover:bg-emerald-700 transition-colors">
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        Xuất Excel
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse min-w-max">
                        <thead>
                            {/* Main Header Row */}
                            <tr>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-100 px-3 py-3 text-[13px] font-black text-gray-700 text-center uppercase">Tháng</th>
                                <th rowSpan={2} className="border border-gray-200 bg-yellow-300/60 px-3 py-3 text-[13px] font-black text-gray-800 text-center uppercase">Doanh thu</th>
                                <th colSpan={11} className="border border-gray-200 bg-pink-100/60 px-3 py-2 text-[13px] font-black text-gray-800 text-center uppercase tracking-wider">Chi phí</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-red-600 text-center uppercase">Lợi nhuận<br/>tổng</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-red-600 text-center uppercase">Lợi nhuận<br/>mỗi nhà</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-red-600 text-center uppercase">Ghi chú</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-gray-700 text-center">% Tiền<br/>hàng</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-gray-700 text-center">% Tiền<br/>ship</th>
                                <th rowSpan={2} className="border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-black text-gray-700 text-center">% Quảng<br/>cáo</th>
                            </tr>
                            {/* Sub Header Row for Costs */}
                            <tr>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Tiền hàng<br/>thực tế</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Tiền ship<br/>hàng</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Phí hoàn<br/>hàng</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Hàng hỏng</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Chi phí<br/>đổi trả</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Chi phí<br/>Lương</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Chi phí<br/>thùng xốp + nổ</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">QC</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">QC cộng<br/>thuế</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Thuế</th>
                                <th className="border border-gray-200 bg-pink-50/50 px-2 py-2 text-[12px] font-bold text-gray-700 text-center">Chi phí<br/>cố định</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((row, idx) => (
                                <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                    <td className="border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 text-center bg-gray-50">{row.month}</td>
                                    <td className="border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-800 text-center">{row.revenue > 0 ? formatNumber(row.revenue) : ''}</td>
                                    
                                    {/* Costs */}
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.cost_actual > 0 ? formatNumber(row.cost_actual) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.shipping_fee > 0 ? formatNumber(row.shipping_fee) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.return_fee > 0 ? formatNumber(row.return_fee) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.damaged_goods > 0 ? formatNumber(row.damaged_goods) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.exchange_cost > 0 ? formatNumber(row.exchange_cost) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.salary > 0 ? formatNumber(row.salary) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.packaging_fee > 0 ? formatNumber(row.packaging_fee) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.ads_spend > 0 ? formatNumber(row.ads_spend) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.ads_tax > 0 ? formatNumber(row.ads_tax) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.tax > 0 ? formatNumber(row.tax) : ''}</td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-2 text-[13px] text-gray-700 text-center">{row.fixed_cost > 0 ? formatNumber(row.fixed_cost) : ''}</td>

                                    {/* Profit */}
                                    <td className="border border-gray-200 px-3 py-2 text-[13px] font-bold text-red-500 text-center bg-gray-50/50">{row.total_profit > 0 ? formatNumber(row.total_profit) : ''}</td>
                                    <td className="border border-gray-200 px-3 py-2 text-[13px] font-bold text-red-500 text-center bg-gray-50/50">{row.profit_per_house > 0 ? formatNumber(row.profit_per_house) : ''}</td>
                                    
                                    <td className="border border-gray-200 px-3 py-2 text-[12px] text-orange-600 font-medium text-center">{row.notes}</td>
                                    
                                    {/* Percentages */}
                                    <td className="border border-gray-200 px-2 py-2 text-[13px] font-medium text-gray-600 text-center">{row.revenue > 0 ? row.pct_cost.toFixed(2) + '%' : '#DIV/0!'}</td>
                                    <td className="border border-gray-200 px-2 py-2 text-[13px] font-medium text-gray-600 text-center">{row.revenue > 0 ? row.pct_shipping.toFixed(2) + '%' : '#DIV/0!'}</td>
                                    <td className="border border-gray-200 px-2 py-2 text-[13px] font-medium text-gray-600 text-center">{row.revenue > 0 ? row.pct_ads.toFixed(2) + '%' : '#DIV/0!'}</td>
                                </tr>
                            ))}
                            {/* Empty rows to mimic excel */}
                            {Array.from({length: 5}).map((_, i) => (
                                <tr key={`empty-${i}`} className="hover:bg-gray-50 transition-colors">
                                    <td className="border border-gray-200 px-3 py-4 bg-gray-50"></td>
                                    <td className="border border-gray-200 px-3 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-pink-50/10 px-2 py-4"></td>
                                    <td className="border border-gray-200 bg-gray-50/50 px-3 py-4"></td>
                                    <td className="border border-gray-200 bg-gray-50/50 px-3 py-4"></td>
                                    <td className="border border-gray-200 px-3 py-4"></td>
                                    <td className="border border-gray-200 px-2 py-4 text-[13px] text-gray-400 text-center">#DIV/0!</td>
                                    <td className="border border-gray-200 px-2 py-4 text-[13px] text-gray-400 text-center">#DIV/0!</td>
                                    <td className="border border-gray-200 px-2 py-4 text-[13px] text-gray-400 text-center">#DIV/0!</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default MonthlyProfitReport;
