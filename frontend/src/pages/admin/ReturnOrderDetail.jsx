import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import {
    RETURN_ORDER_STATUS_OPTIONS,
    formatReturnOrderCurrency,
    formatReturnOrderDate,
    formatReturnOrderDateTime,
    resolveProfitLossMeta,
    resolveReturnOrderStatus,
} from '../../config/returnOrderStatus';
import { returnOrderApi } from '../../services/api';

const shellClass = 'absolute inset-0 flex flex-col bg-[#fcfcfa] p-6 w-full h-full overflow-hidden animate-fade-in';
const panelClass = 'rounded-sm border border-gold/10 bg-white shadow-sm';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-primary transition-all hover:border-primary/35 hover:bg-primary/5';

const ReturnOrderDetail = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { id } = useParams();
    const [row, setRow] = useState(null);
    const [loading, setLoading] = useState(true);
    const [statusSaving, setStatusSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const fetchDetail = async () => {
        setLoading(true);
        try {
            const response = await returnOrderApi.getOne(id);
            setRow(response.data);
        } catch (error) {
            setFeedback({
                type: 'error',
                message: 'Khong the tai chi tiet don doi tra.',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDetail();
    }, [id]);

    const statusOptions = row?.status_options || RETURN_ORDER_STATUS_OPTIONS;
    const statusMeta = resolveReturnOrderStatus(row?.status);
    const profitLossMeta = resolveProfitLossMeta(row?.profit_loss_amount);

    const itemCards = useMemo(() => ([
        {
            key: 'returned',
            title: 'Hang khach tra ve',
            rows: row?.returned_items || [],
            total: row?.returned_total_amount || 0,
            quantity: row?.returned_total_quantity || 0,
            tone: 'text-primary',
        },
        {
            key: 'resent',
            title: 'Hang gui lai khach',
            rows: row?.resent_items || [],
            total: row?.resent_total_amount || 0,
            quantity: row?.resent_total_quantity || 0,
            tone: 'text-brick',
        },
    ]), [row]);

    const handleStatusUpdate = async (nextStatus) => {
        if (!row || nextStatus === row.status) return;

        setStatusSaving(true);
        setFeedback(null);

        try {
            const response = await returnOrderApi.updateStatus(row.id, { status: nextStatus });
            setRow(response.data);
        } catch (error) {
            const validation = error?.response?.data?.errors;
            const firstError = validation
                ? Object.values(validation).flat().find(Boolean)
                : null;

            setFeedback({
                type: 'error',
                message: firstError || 'Khong the cap nhat trang thai don doi tra.',
            });
        } finally {
            setStatusSaving(false);
        }
    };

    return (
        <div className={shellClass}>
            <div className="mb-6 flex flex-none items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => navigate('/admin/return-orders')} className={secondaryButton}>
                        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                        Quay lai
                    </button>
                    <div>
                        <h1 className="text-3xl font-display font-bold italic text-primary">Chi tiet don doi tra</h1>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.34em] text-gold">{row?.return_number || 'Dang tai...'}</p>
                    </div>
                </div>
                <AccountSelector user={user} />
            </div>

            {feedback ? (
                <div className={`mb-4 flex-none rounded-sm border px-4 py-3 text-[12px] font-semibold ${feedback.type === 'error' ? 'border-brick/25 bg-brick/5 text-brick' : 'border-green-600/25 bg-green-50 text-green-700'}`}>
                    {feedback.message}
                </div>
            ) : null}

            {loading ? (
                <div className={`${panelClass} flex flex-1 items-center justify-center text-[12px] font-semibold text-primary/45`}>
                    Dang tai chi tiet don doi tra...
                </div>
            ) : !row ? (
                <div className={`${panelClass} flex flex-1 items-center justify-center text-[12px] font-semibold text-primary/35`}>
                    Khong tim thay don doi tra.
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_380px]">
                        <div className="space-y-4">
                            <section className={`${panelClass} p-5`}>
                                <div className="flex flex-wrap items-center justify-between gap-4">
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-stone-500">Ma doi tra</div>
                                        <div className="mt-2 text-2xl font-display font-bold italic text-primary">{row.return_number}</div>
                                    </div>
                                    <span
                                        className="inline-flex rounded-sm border px-4 py-3 text-[12px] font-black uppercase tracking-[0.2em]"
                                        style={{ color: statusMeta.color, borderColor: `${statusMeta.color}40`, backgroundColor: `${statusMeta.color}12` }}
                                    >
                                        {statusMeta.label}
                                    </span>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                                    {statusOptions.map((status) => (
                                        <button
                                            key={status.value}
                                            type="button"
                                            disabled={statusSaving || status.value === row.status}
                                            onClick={() => handleStatusUpdate(status.value)}
                                            className="rounded-sm border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-all disabled:cursor-not-allowed disabled:opacity-45"
                                            style={{
                                                color: status.color,
                                                borderColor: status.value === row.status ? `${status.color}45` : '#D6D3D1',
                                                backgroundColor: status.value === row.status ? `${status.color}14` : '#FFFFFF',
                                            }}
                                        >
                                            {status.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                <div className={`${panelClass} p-5`}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Hang tra ve</div>
                                    <div className="mt-2 text-2xl font-display font-bold italic text-primary">{formatReturnOrderCurrency(row.returned_total_amount)}d</div>
                                    <div className="mt-2 text-[12px] text-stone-500">{row.returned_total_quantity} san pham</div>
                                </div>
                                <div className={`${panelClass} p-5`}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Hang gui lai</div>
                                    <div className="mt-2 text-2xl font-display font-bold italic text-brick">{formatReturnOrderCurrency(row.resent_total_amount)}d</div>
                                    <div className="mt-2 text-[12px] text-stone-500">{row.resent_total_quantity} san pham</div>
                                </div>
                                <div className={`${panelClass} p-5`} style={{ borderColor: `${profitLossMeta.color}30`, backgroundColor: `${profitLossMeta.color}10` }}>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: profitLossMeta.color }}>Chenh lech</div>
                                    <div className="mt-2 text-2xl font-display font-bold italic" style={{ color: profitLossMeta.color }}>
                                        {row.profit_loss_amount > 0 ? '+' : ''}{formatReturnOrderCurrency(row.profit_loss_amount)}d
                                    </div>
                                    <div className="mt-2 text-[12px] font-semibold" style={{ color: profitLossMeta.color }}>{profitLossMeta.label}</div>
                                </div>
                            </div>

                            {itemCards.map((group) => (
                                <section key={group.key} className={`${panelClass} overflow-hidden`}>
                                    <div className="flex items-center justify-between border-b border-gold/10 px-5 py-4">
                                        <div>
                                            <h3 className={`text-sm font-black uppercase tracking-[0.24em] ${group.tone}`}>{group.title}</h3>
                                            <p className="mt-1 text-[11px] text-stone-500">{group.quantity} san pham / {formatReturnOrderCurrency(group.total)}d</p>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border-collapse">
                                            <thead className="bg-[#fcfcfa] text-left text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">
                                                <tr>
                                                    <th className="border-b border-primary/10 px-4 py-3">San pham</th>
                                                    <th className="border-b border-primary/10 px-4 py-3">So luong</th>
                                                    <th className="border-b border-primary/10 px-4 py-3">Gia tri</th>
                                                    <th className="border-b border-primary/10 px-4 py-3">Gia von</th>
                                                    <th className="border-b border-primary/10 px-4 py-3">Ghi chu</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.rows.map((item) => (
                                                    <tr key={item.id} className="border-b border-primary/5">
                                                        <td className="px-4 py-4">
                                                            <div className="flex flex-col">
                                                                <span className="text-[13px] font-bold text-[#0F172A]">{item.product_name_snapshot}</span>
                                                                <span className="mt-1 text-[11px] text-stone-500">{item.product_sku_snapshot || '-'}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-[12px] font-semibold text-stone-600">{item.quantity}</td>
                                                        <td className="px-4 py-4 text-[13px] font-black text-primary">{formatReturnOrderCurrency(item.line_total_snapshot)}d</td>
                                                        <td className="px-4 py-4 text-[12px] font-semibold text-stone-600">{formatReturnOrderCurrency(item.line_cost_snapshot)}d</td>
                                                        <td className="px-4 py-4 text-[12px] text-stone-600">{item.notes || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            ))}
                        </div>

                        <aside className="space-y-4">
                            <section className={`${panelClass} p-5`}>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Thong tin lien ket</h3>
                                <div className="mt-4 space-y-4 text-[12px] text-stone-600">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Don goc</div>
                                        {row.origin_order ? (
                                            <div className="mt-2 rounded-sm border border-primary/10 bg-primary/5 px-4 py-3">
                                                <div className="font-bold text-primary">#{row.origin_order.order_number}</div>
                                                <div className="mt-1">{row.origin_order.customer_name || 'Khach chua ro'}</div>
                                                <div className="mt-1">{row.origin_order.customer_phone || 'Khong co SDT'}</div>
                                            </div>
                                        ) : (
                                            <div className="mt-2 font-semibold text-stone-400">Khong lien ket don goc</div>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Khach hang snapshot</div>
                                        <div className="mt-2">{row.customer_name || '-'}</div>
                                        <div className="mt-1">{row.customer_phone || '-'}</div>
                                        <div className="mt-1">{row.customer_address || '-'}</div>
                                    </div>
                                </div>
                            </section>

                            <section className={`${panelClass} p-5`}>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Phieu kho da tao</h3>
                                <div className="mt-4 space-y-3 text-[12px] text-stone-600">
                                    <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                        <div className="font-bold text-primary">Phieu nhap hoan</div>
                                        <div className="mt-1">{row.return_document?.document_number || 'Chua co'}</div>
                                        <div className="mt-1 text-[11px] text-stone-500">{formatReturnOrderDate(row.return_document?.document_date)}</div>
                                    </div>
                                    <div className="rounded-sm border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                        <div className="font-bold text-primary">Phieu xuat</div>
                                        <div className="mt-1">{row.export_document?.document_number || 'Chua co'}</div>
                                        <div className="mt-1 text-[11px] text-stone-500">{formatReturnOrderDate(row.export_document?.document_date)}</div>
                                    </div>
                                </div>
                            </section>

                            <section className={`${panelClass} p-5`}>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Moc thoi gian</h3>
                                <div className="mt-4 space-y-3 text-[12px] text-stone-600">
                                    <div className="flex items-center justify-between gap-4"><span>Ngay doi tra</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDate(row.exchange_date)}</span></div>
                                    <div className="flex items-center justify-between gap-4"><span>Tao luc</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDateTime(row.created_at)}</span></div>
                                    <div className="flex items-center justify-between gap-4"><span>Da nhan hang</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDateTime(row.received_at)}</span></div>
                                    <div className="flex items-center justify-between gap-4"><span>Da gui hang</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDateTime(row.shipped_at)}</span></div>
                                    <div className="flex items-center justify-between gap-4"><span>Hoan tat</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDateTime(row.completed_at)}</span></div>
                                    <div className="flex items-center justify-between gap-4"><span>Huy</span><span className="font-semibold text-[#0F172A]">{formatReturnOrderDateTime(row.cancelled_at)}</span></div>
                                </div>
                            </section>

                            <section className={`${panelClass} p-5`}>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/70">Ghi chu</h3>
                                <p className="mt-3 text-[12px] leading-relaxed text-stone-600">{row.notes || 'Khong co ghi chu bo sung.'}</p>
                            </section>
                        </aside>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReturnOrderDetail;
