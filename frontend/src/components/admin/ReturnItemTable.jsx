import React, { useMemo } from 'react';
import ProductLookupField from './ProductLookupField';
import { formatReturnOrderCurrency } from '../../config/returnOrderStatus';

const panelClass = 'overflow-hidden rounded-sm border border-gold/10 bg-white shadow-sm';
const inputClass = 'h-11 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-primary transition-all hover:border-primary/35 hover:bg-primary/5';

const ReturnItemTable = ({ title, rows, onAddRow, onRemoveRow, onRowChange }) => {
    const summary = useMemo(() => rows.reduce((accumulator, row) => {
        const quantity = Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0);
        const lineValue = quantity * Number(row.product?.price || 0);

        return {
            lines: accumulator.lines + (row.product ? 1 : 0),
            quantity: accumulator.quantity + quantity,
            total: accumulator.total + lineValue,
        };
    }, { lines: 0, quantity: 0, total: 0 }), [rows]);

    return (
        <section className={panelClass}>
            <div className="flex items-center justify-between border-b border-gold/10 px-5 py-4">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-[0.24em] text-primary">{title}</h3>
                    <p className="mt-1 text-[11px] text-stone-500">Tu do them san pham, khong phu thuoc don goc.</p>
                </div>
                <button type="button" onClick={onAddRow} className={secondaryButton}>
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Them dong
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse">
                    <thead className="bg-[#fcfcfa] text-left text-[10px] font-black uppercase tracking-[0.24em] text-stone-500">
                        <tr>
                            <th className="border-b border-primary/10 px-4 py-3">San pham</th>
                            <th className="border-b border-primary/10 px-4 py-3">Ton</th>
                            <th className="border-b border-primary/10 px-4 py-3">So luong</th>
                            <th className="border-b border-primary/10 px-4 py-3">Gia tri</th>
                            <th className="border-b border-primary/10 px-4 py-3">Ghi chu</th>
                            <th className="border-b border-primary/10 px-4 py-3 text-right">Tac vu</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => {
                            const quantity = Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0);
                            const lineValue = quantity * Number(row.product?.price || 0);

                            return (
                                <tr key={row.key} className="border-b border-primary/5 align-top">
                                    <td className="px-4 py-4">
                                        <ProductLookupField
                                            value={row.product}
                                            onSelect={(product) => onRowChange(index, { product })}
                                        />
                                    </td>
                                    <td className="px-4 py-4 text-[12px] font-bold text-stone-600">
                                        {row.product ? row.product.stock_quantity ?? 0 : '-'}
                                    </td>
                                    <td className="px-4 py-4">
                                        <input
                                            type="number"
                                            min="1"
                                            value={row.quantity}
                                            onChange={(event) => onRowChange(index, { quantity: event.target.value })}
                                            className={`${inputClass} max-w-[110px]`}
                                        />
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-[13px] font-black text-brick">{formatReturnOrderCurrency(lineValue)}d</span>
                                            <span className="text-[11px] text-stone-500">{row.product ? `${formatReturnOrderCurrency(row.product.price)}d / sp` : '-'}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <input
                                            type="text"
                                            value={row.notes}
                                            onChange={(event) => onRowChange(index, { notes: event.target.value })}
                                            className={inputClass}
                                            placeholder="Ghi chu dong hang"
                                        />
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <button
                                            type="button"
                                            onClick={() => onRemoveRow(index)}
                                            className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-brick/20 bg-brick/5 text-brick transition-all hover:border-brick/40 hover:bg-brick/10"
                                            title="Xoa dong"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/5 bg-[#fcfcfa] px-5 py-4">
                <span className="text-[11px] font-black uppercase tracking-[0.2em] text-stone-500">
                    {summary.lines} dong hop le / {summary.quantity} san pham
                </span>
                <span className="text-[13px] font-black text-primary">Tong gia tri {formatReturnOrderCurrency(summary.total)}d</span>
            </div>
        </section>
    );
};

export default ReturnItemTable;
