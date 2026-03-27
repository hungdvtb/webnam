import React, { useEffect, useMemo } from 'react';
import OriginOrderLookupField from './OriginOrderLookupField';
import ReturnItemTable from './ReturnItemTable';
import { formatReturnOrderCurrency, resolveProfitLossMeta } from '../../config/returnOrderStatus';

const panelClass = 'rounded-sm border border-gold/10 bg-white shadow-sm';
const inputClass = 'h-11 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';
const textareaClass = 'min-h-[104px] w-full rounded-sm border border-primary/10 bg-white px-3 py-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-primary transition-all hover:border-primary/35 hover:bg-primary/5';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-white transition-all hover:bg-umber disabled:cursor-not-allowed disabled:opacity-50';

const ReturnOrderCreateModal = ({
    open,
    form,
    saving,
    feedback,
    onClose,
    onFormChange,
    onOriginOrderSelect,
    onItemChange,
    onAddItemRow,
    onRemoveItemRow,
    onSubmit,
}) => {
    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [open]);

    const returnedSummary = useMemo(() => form.returnedItems.reduce((accumulator, row) => {
        const quantity = Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0);
        return accumulator + (quantity * Number(row.product?.price || 0));
    }, 0), [form.returnedItems]);

    const resentSummary = useMemo(() => form.resentItems.reduce((accumulator, row) => {
        const quantity = Math.max(0, Number.parseInt(row.quantity || '0', 10) || 0);
        return accumulator + (quantity * Number(row.product?.price || 0));
    }, 0), [form.resentItems]);

    const profitLoss = returnedSummary - resentSummary;
    const profitLossMeta = resolveProfitLossMeta(profitLoss);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-primary/25 px-4 py-6 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={saving ? undefined : onClose} />
            <div className="relative flex h-full max-h-[96vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-sm border border-primary/10 bg-[#fcfcfa] shadow-[0_25px_80px_rgba(15,23,42,0.28)]">
                <div className="flex items-center justify-between border-b border-gold/10 bg-white px-6 py-5">
                    <div>
                        <h2 className="text-xl font-display font-bold italic text-primary">Tao don doi tra</h2>
                        <p className="mt-1 text-[11px] font-black uppercase tracking-[0.24em] text-stone-500">Tao record doc lap va sinh phieu kho moi.</p>
                    </div>
                    <button
                        type="button"
                        onClick={saving ? undefined : onClose}
                        className="flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/55 transition-all hover:border-primary/30 hover:text-primary"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 xl:grid-cols-[minmax(0,1.8fr)_360px]">
                    <div className="space-y-6">
                        <section className={`${panelClass} p-5`}>
                            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_200px]">
                                <div className="space-y-2">
                                    <label className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/75">Lien ket don goc (optional)</label>
                                    <OriginOrderLookupField value={form.originOrder} onSelect={onOriginOrderSelect} />
                                    {form.originOrder ? (
                                        <div className="rounded-sm border border-primary/10 bg-primary/5 px-4 py-3 text-[12px] text-stone-600">
                                            <div className="font-bold text-primary">#{form.originOrder.order_number}</div>
                                            <div className="mt-1">{form.originOrder.customer_name || 'Khach chua ro'} {form.originOrder.customer_phone ? `- ${form.originOrder.customer_phone}` : ''}</div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/75">Ngay doi tra</label>
                                    <input
                                        type="date"
                                        value={form.exchangeDate}
                                        onChange={(event) => onFormChange({ exchangeDate: event.target.value })}
                                        className={inputClass}
                                    />
                                </div>
                            </div>

                            <div className="mt-5 space-y-2">
                                <label className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/75">Ghi chu</label>
                                <textarea
                                    value={form.notes}
                                    onChange={(event) => onFormChange({ notes: event.target.value })}
                                    className={textareaClass}
                                    placeholder="Mo ta nhanh tinh huong doi tra, luu y xu ly, ghi chu kho..."
                                />
                            </div>

                            {feedback ? (
                                <div className={`mt-4 rounded-sm border px-4 py-3 text-[12px] font-semibold ${feedback.type === 'error' ? 'border-brick/25 bg-brick/5 text-brick' : 'border-green-600/25 bg-green-50 text-green-700'}`}>
                                    {feedback.message}
                                </div>
                            ) : null}
                        </section>

                        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
                            <ReturnItemTable
                                title="Hang khach tra ve"
                                rows={form.returnedItems}
                                onAddRow={() => onAddItemRow('returned')}
                                onRemoveRow={(index) => onRemoveItemRow('returned', index)}
                                onRowChange={(index, patch) => onItemChange('returned', index, patch)}
                            />
                            <ReturnItemTable
                                title="Hang gui lai khach"
                                rows={form.resentItems}
                                onAddRow={() => onAddItemRow('resent')}
                                onRemoveRow={(index) => onRemoveItemRow('resent', index)}
                                onRowChange={(index, patch) => onItemChange('resent', index, patch)}
                            />
                        </div>
                    </div>

                    <aside className="space-y-5">
                        <section className={`${panelClass} p-5`}>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Tong hop gia tri</h3>
                            <div className="mt-5 space-y-4">
                                <div className="rounded-sm border border-primary/10 bg-primary/5 px-4 py-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60">Hang tra ve</p>
                                    <p className="mt-2 text-2xl font-display font-bold italic text-primary">{formatReturnOrderCurrency(returnedSummary)}d</p>
                                </div>
                                <div className="rounded-sm border border-brick/15 bg-brick/5 px-4 py-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brick/70">Hang gui lai</p>
                                    <p className="mt-2 text-2xl font-display font-bold italic text-brick">{formatReturnOrderCurrency(resentSummary)}d</p>
                                </div>
                                <div className="rounded-sm border px-4 py-4" style={{ borderColor: `${profitLossMeta.color}30`, backgroundColor: `${profitLossMeta.color}10` }}>
                                    <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: profitLossMeta.color }}>Chenh lech</p>
                                    <p className="mt-2 text-3xl font-display font-bold italic" style={{ color: profitLossMeta.color }}>
                                        {profitLoss > 0 ? '+' : ''}{formatReturnOrderCurrency(profitLoss)}d
                                    </p>
                                    <p className="mt-2 text-[12px] font-semibold" style={{ color: profitLossMeta.color }}>{profitLossMeta.label}</p>
                                </div>
                            </div>
                        </section>

                        <section className={`${panelClass} p-5`}>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Khi luu se tao</h3>
                            <div className="mt-4 space-y-3 text-[12px] text-stone-600">
                                <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                    <div className="font-bold text-primary">1. Phieu nhap hoan</div>
                                    <p className="mt-1">Tang ton kho theo bang hang khach tra ve.</p>
                                </div>
                                <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                    <div className="font-bold text-primary">2. Phieu xuat</div>
                                    <p className="mt-1">Tru ton kho theo bang hang gui lai khach.</p>
                                </div>
                                <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                    <div className="font-bold text-primary">3. Lai lo rieng</div>
                                    <p className="mt-1">Khong cong vao doanh thu cua module don hang hien tai.</p>
                                </div>
                            </div>
                        </section>
                    </aside>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-gold/10 bg-white px-6 py-5">
                    <button type="button" onClick={onClose} disabled={saving} className={secondaryButton}>Dong</button>
                    <button type="button" onClick={onSubmit} disabled={saving} className={primaryButton}>
                        <span className="material-symbols-outlined text-[16px]">{saving ? 'progress_activity' : 'save'}</span>
                        {saving ? 'Dang luu...' : 'Luu don doi tra'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReturnOrderCreateModal;
