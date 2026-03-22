import React, { useEffect, useRef, useState } from 'react';
import AccountSelector from '../../components/AccountSelector';
import { financeApi } from '../../services/api';

const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const iconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[13px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black text-primary transition hover:border-primary hover:bg-primary/5';

const todayValue = new Date().toISOString().slice(0, 10);

function formatMoney(value) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
    }).format(Number(value || 0));
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('vi-VN');
}

function getDaysInMonth(dateValue, mode) {
    if (mode === 'fixed_30') return 30;
    const date = new Date(dateValue || todayValue);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function createRow(row = {}) {
    return {
        localKey: row.id ? `fixed-${row.id}` : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        id: row.id ?? null,
        content: row.content ?? row.name ?? '',
        monthly_amount: row.monthly_amount ?? row.amount ?? '',
    };
}

function normalizeRowsForSave(rows) {
    return rows
        .filter((row) => row.content.trim() !== '' || row.monthly_amount !== '')
        .map((row) => ({
            id: row.id ?? undefined,
            content: row.content.trim(),
            monthly_amount: row.monthly_amount === '' ? 0 : Number(row.monthly_amount),
        }));
}

function validateRows(rows) {
    const errors = {};

    rows.forEach((row) => {
        const hasContent = row.content.trim() !== '';
        const hasAmount = row.monthly_amount !== '' && row.monthly_amount !== null && row.monthly_amount !== undefined;

        if (!hasContent && !hasAmount) return;

        if (!hasContent) {
            errors[row.localKey] = 'Thiếu nội dung.';
            return;
        }

        const amount = Number(row.monthly_amount);
        if (row.monthly_amount === '' || Number.isNaN(amount) || amount < 0) {
            errors[row.localKey] = 'Số tiền phải là số >= 0.';
        }
    });

    return errors;
}

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-xl' }) => {
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

const FinanceTracking = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);
    const [previewDate, setPreviewDate] = useState(todayValue);
    const [sheetRows, setSheetRows] = useState([createRow()]);
    const [history, setHistory] = useState([]);
    const [currentVersion, setCurrentVersion] = useState(null);
    const [summary, setSummary] = useState({
        row_count: 0,
        total_monthly_amount: 0,
        daily_amount: 0,
        days_in_month: getDaysInMonth(todayValue, 'actual_month'),
        day_calculation_mode: 'actual_month',
        day_calculation_label: 'Theo tháng thực tế',
    });
    const [sheetDirty, setSheetDirty] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [saveModal, setSaveModal] = useState({
        open: false,
        effective_date: todayValue,
        day_calculation_mode: 'actual_month',
        note: '',
    });

    const cellRefs = useRef({});

    const rowErrors = validateRows(sheetRows);
    const visibleRows = sheetRows.length ? sheetRows : [createRow()];
    const totalMonthly = visibleRows.reduce((sum, row) => {
        if (row.content.trim() === '' && row.monthly_amount === '') return sum;
        const amount = Number(row.monthly_amount || 0);
        return sum + (Number.isNaN(amount) ? 0 : amount);
    }, 0);
    const activeDayMode = saveModal.day_calculation_mode || summary.day_calculation_mode || 'actual_month';
    const daysInMonth = getDaysInMonth(previewDate, activeDayMode);
    const dailyCost = daysInMonth > 0 ? totalMonthly / daysInMonth : 0;

    useEffect(() => {
        let ignore = false;

        async function loadSheet() {
            setLoading(true);

            try {
                const response = await financeApi.getFixedExpenses({ date: previewDate });
                if (ignore) return;

                const payload = response.data || {};
                const rows = (payload.rows || []).map((row) => createRow(row));

                setHistory(payload.history || []);
                setCurrentVersion(payload.current_version || null);
                setSummary(payload.summary || {});
                setSaveModal((previous) => ({
                    ...previous,
                    day_calculation_mode: payload.summary?.day_calculation_mode || previous.day_calculation_mode || 'actual_month',
                }));

                if (!sheetDirty) {
                    setSheetRows(rows.length ? rows : [createRow()]);
                }
            } catch (error) {
                if (!ignore) {
                    setNotice({
                        type: 'error',
                        message: error.response?.data?.message || 'Không thể tải bảng chi phí cố định.',
                    });
                }
            } finally {
                if (!ignore) setLoading(false);
            }
        }

        loadSheet();

        return () => {
            ignore = true;
        };
    }, [previewDate, reloadKey]);

    const setCellRef = (key, node) => {
        if (!node) return;
        cellRefs.current[key] = node;
    };

    const focusCell = (rowKey, field) => {
        setTimeout(() => {
            cellRefs.current[`${rowKey}:${field}`]?.focus();
            cellRefs.current[`${rowKey}:${field}`]?.select?.();
        }, 0);
    };

    const addRow = (focusField = 'content') => {
        const nextRow = createRow();
        setSheetRows((previous) => [...previous, nextRow]);
        setSheetDirty(true);
        focusCell(nextRow.localKey, focusField);
    };

    const updateRow = (localKey, field, value) => {
        setSheetRows((previous) => previous.map((row) => (row.localKey === localKey ? { ...row, [field]: value } : row)));
        setSheetDirty(true);
    };

    const removeRow = (localKey) => {
        setSheetRows((previous) => {
            const nextRows = previous.filter((row) => row.localKey !== localKey);
            return nextRows.length ? nextRows : [createRow()];
        });
        setSheetDirty(true);
    };

    const handleCellKeyDown = (event, rowIndex, field) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();

        const nextRow = visibleRows[rowIndex + 1];
        if (nextRow) {
            focusCell(nextRow.localKey, field);
            return;
        }

        addRow(field);
    };

    const openSaveModal = () => {
        const errors = validateRows(visibleRows);
        const hasRowsToSave = normalizeRowsForSave(visibleRows).length > 0;

        if (Object.keys(errors).length) {
            setNotice({ type: 'error', message: 'Bảng còn dòng chưa hợp lệ. Hãy kiểm tra nội dung và số tiền.' });
            return;
        }

        if (!hasRowsToSave) {
            setNotice({ type: 'error', message: 'Bảng đang trống, chưa có dòng chi phí nào để lưu.' });
            return;
        }

        setSaveModal((previous) => ({
            ...previous,
            open: true,
            effective_date: previewDate || todayValue,
            day_calculation_mode: summary.day_calculation_mode || previous.day_calculation_mode || 'actual_month',
        }));
    };

    const handleSaveSheet = async () => {
        const errors = validateRows(visibleRows);
        if (Object.keys(errors).length) {
            setNotice({ type: 'error', message: 'Không thể lưu vì bảng còn dòng chưa hợp lệ.' });
            return;
        }

        setSaving(true);
        try {
            await financeApi.syncFixedExpenseSheet({
                effective_date: saveModal.effective_date,
                day_calculation_mode: saveModal.day_calculation_mode,
                note: saveModal.note,
                rows: normalizeRowsForSave(visibleRows),
            });

            setNotice({ type: 'success', message: 'Đã lưu bảng chi phí cố định thành công.' });
            setSheetDirty(false);
            setSaveModal((previous) => ({ ...previous, open: false, note: '' }));
            setReloadKey((previous) => previous + 1);
            setPreviewDate(saveModal.effective_date);
        } catch (error) {
            setNotice({
                type: 'error',
                message: error.response?.data?.message || 'Không thể lưu chi phí cố định.',
            });
        } finally {
            setSaving(false);
        }
    };

    const applicableItems = currentVersion?.items || [];

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <AccountSelector />
            </div>

            {notice ? (
                <div className={`rounded-sm border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/25 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {notice.message}
                </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className={`${panelClass} p-4`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tổng chi phí/tháng</p>
                    <p className="mt-3 text-[24px] font-black text-primary">{formatMoney(totalMonthly)}</p>
                </div>
                <div className={`${panelClass} p-4`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí cố định/ngày</p>
                    <p className="mt-3 text-[24px] font-black text-primary">{formatMoney(dailyCost)}</p>
                    <p className="mt-2 text-[12px] text-primary/55">Chia theo {daysInMonth} ngày</p>
                </div>
                <div className={`${panelClass} p-4`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày đang xem</p>
                    <input
                        type="date"
                        value={previewDate}
                        onChange={(event) => setPreviewDate(event.target.value)}
                        className={`${inputClass} mt-3 w-full`}
                    />
                </div>
                <div className={`${panelClass} p-4`}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Trạng thái bảng</p>
                    <p className="mt-3 text-[18px] font-black text-primary">{sheetDirty ? 'Có thay đổi chưa lưu' : 'Đồng bộ với server'}</p>
                    <p className="mt-2 text-[12px] text-primary/55">{visibleRows.filter((row) => row.content.trim() !== '' || row.monthly_amount !== '').length} dòng đang dùng</p>
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
                <div className={panelClass}>
                    <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                        <div>
                            <h2 className="text-[18px] font-black text-primary">Bảng nhập liệu</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Enter để xuống dòng cùng cột. Sửa trực tiếp như làm việc với Excel.</p>
                        </div>
                        <button type="button" className={secondaryButtonClass} onClick={() => addRow()}>
                            <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                            <span>Thêm dòng</span>
                        </button>
                    </div>

                    <div className="overflow-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {['STT', 'Nội dung', 'Số tiền/tháng', ''].map((label) => (
                                        <th key={label} className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary last:border-r-0">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="px-5 py-10 text-center text-[13px] font-semibold text-primary/45">Đang tải bảng chi phí...</td>
                                    </tr>
                                ) : visibleRows.map((row, index) => (
                                    <tr key={row.localKey} className="hover:bg-primary/[0.03]">
                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-black text-primary">{index + 1}</td>
                                        <td className="border-b border-r border-primary/10 px-3 py-2">
                                            <input
                                                ref={(node) => setCellRef(`${row.localKey}:content`, node)}
                                                className={`${inputClass} w-full ${rowErrors[row.localKey] ? 'border-brick' : ''}`}
                                                placeholder="Ví dụ: Thuê mặt bằng, lương, internet..."
                                                value={row.content}
                                                onChange={(event) => updateRow(row.localKey, 'content', event.target.value)}
                                                onKeyDown={(event) => handleCellKeyDown(event, index, 'content')}
                                            />
                                            {rowErrors[row.localKey] ? <p className="mt-2 text-[11px] font-semibold text-brick">{rowErrors[row.localKey]}</p> : null}
                                        </td>
                                        <td className="border-b border-r border-primary/10 px-3 py-2">
                                            <input
                                                ref={(node) => setCellRef(`${row.localKey}:monthly_amount`, node)}
                                                className={`${inputClass} w-full text-right ${rowErrors[row.localKey] ? 'border-brick' : ''}`}
                                                type="number"
                                                min="0"
                                                step="1000"
                                                placeholder="0"
                                                value={row.monthly_amount}
                                                onChange={(event) => updateRow(row.localKey, 'monthly_amount', event.target.value)}
                                                onKeyDown={(event) => handleCellKeyDown(event, index, 'monthly_amount')}
                                            />
                                        </td>
                                        <td className="border-b border-primary/10 px-3 py-3">
                                            <button type="button" className={iconButtonClass} title="Xóa dòng" onClick={() => removeRow(row.localKey)}>
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-[#fbfcfe]">
                                <tr>
                                    <td colSpan={2} className="border-t border-r border-primary/10 px-3 py-4 text-[13px] font-black text-primary">Tổng chi phí/tháng</td>
                                    <td className="border-t border-r border-primary/10 px-3 py-4 text-right text-[15px] font-black text-primary">{formatMoney(totalMonthly)}</td>
                                    <td className="border-t border-primary/10 px-3 py-4" />
                                </tr>
                                <tr>
                                    <td colSpan={2} className="border-t border-r border-primary/10 px-3 py-4 text-[13px] font-black text-primary">Chi phí cố định/ngày</td>
                                    <td className="border-t border-r border-primary/10 px-3 py-4 text-right text-[15px] font-black text-primary">{formatMoney(dailyCost)}</td>
                                    <td className="border-t border-primary/10 px-3 py-4 text-[12px] font-semibold text-primary/55">{summary.day_calculation_label || 'Theo tháng thực tế'}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                <div className="space-y-5">
                    <div className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <h2 className="text-[18px] font-black text-primary">Phiên bản áp dụng theo ngày đang xem</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Dữ liệu báo cáo quá khứ sẽ bám theo phiên bản này.</p>
                        </div>
                        <div className="space-y-4 p-5">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fbff] p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng</p>
                                <p className="mt-2 text-[18px] font-black text-primary">{formatDate(currentVersion?.effective_date || previewDate)}</p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tổng tháng</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatMoney(currentVersion?.total_monthly_amount || 0)}</p>
                                </div>
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí/ngày</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatMoney(currentVersion?.daily_amount || 0)}</p>
                                </div>
                            </div>
                            <div className="rounded-sm border border-primary/10 p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính</p>
                                <p className="mt-2 text-[14px] font-black text-primary">{currentVersion?.day_calculation_label || 'Theo tháng thực tế'}</p>
                                <p className="mt-2 text-[12px] text-primary/55">Chia theo {currentVersion?.days_in_month || getDaysInMonth(previewDate, 'actual_month')} ngày</p>
                            </div>

                            <div className="max-h-[320px] overflow-auto rounded-sm border border-primary/10">
                                <table className="w-full border-collapse">
                                    <thead className="bg-[#f6f9fc]">
                                        <tr>
                                            <th className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary">STT</th>
                                            <th className="border-b border-r border-primary/10 px-3 py-3 text-left text-[12px] font-black text-primary">Nội dung</th>
                                            <th className="border-b border-primary/10 px-3 py-3 text-right text-[12px] font-black text-primary">Số tiền</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {applicableItems.length ? applicableItems.map((item, index) => (
                                            <tr key={`${item.line_key}-${index}`}>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] font-semibold text-primary">{index + 1}</td>
                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-[12px] text-primary">{item.content}</td>
                                                <td className="border-b border-primary/10 px-3 py-3 text-right text-[12px] font-black text-primary">{formatMoney(item.monthly_amount)}</td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan={3} className="px-5 py-8 text-center text-[12px] font-semibold text-primary/45">Không có version nào cho ngày này.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className={panelClass}>
                        <div className="border-b border-primary/10 px-5 py-4">
                            <h2 className="text-[18px] font-black text-primary">Lịch sử áp dụng</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Mỗi lần lưu sẽ tạo một version mới theo ngày hiệu lực.</p>
                        </div>
                        <div className="space-y-3 p-5">
                            {history.length ? history.map((version) => (
                                <button
                                    key={`${version.id}-${version.effective_date}`}
                                    type="button"
                                    onClick={() => setPreviewDate(version.effective_date)}
                                    className="w-full rounded-sm border border-primary/10 bg-white px-4 py-4 text-left transition hover:border-primary hover:bg-primary/[0.03]"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-[14px] font-black text-primary">{formatDate(version.effective_date)}</p>
                                            <p className="mt-1 text-[12px] text-primary/55">{version.day_calculation_label}</p>
                                            <p className="mt-2 text-[12px] text-primary/45">{version.items?.length || 0} dòng chi phí</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[13px] font-black text-primary">{formatMoney(version.total_monthly_amount)}</p>
                                            <p className="mt-1 text-[12px] text-primary/55">{formatMoney(version.daily_amount)}/ngày</p>
                                        </div>
                                    </div>
                                </button>
                            )) : (
                                <div className="px-4 py-6 text-center text-[13px] font-semibold text-primary/45">Chưa có lịch sử version.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ModalShell
                open={saveModal.open}
                title="Áp dụng chi phí cố định mới từ ngày nào?"
                onClose={() => setSaveModal((previous) => ({ ...previous, open: false }))}
                footer={(
                    <div className="flex justify-end gap-2">
                        <button type="button" className={secondaryButtonClass} onClick={() => setSaveModal((previous) => ({ ...previous, open: false }))}>
                            Hủy
                        </button>
                        <button type="button" className={primaryButtonClass} onClick={handleSaveSheet} disabled={saving}>
                            <span className="material-symbols-outlined text-[18px]">{saving ? 'hourglass_top' : 'save'}</span>
                            <span>Lưu version mới</span>
                        </button>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="rounded-sm border border-primary/10 bg-[#f8fbff] px-4 py-4">
                        <p className="text-[12px] font-semibold text-primary/60">
                            Sau khi lưu, toàn bộ báo cáo lãi lỗ theo ngày từ mốc này trở đi sẽ dùng version chi phí cố định mới.
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng</span>
                            <input
                                type="date"
                                className={`${inputClass} w-full`}
                                value={saveModal.effective_date}
                                onChange={(event) => setSaveModal((previous) => ({ ...previous, effective_date: event.target.value }))}
                            />
                        </label>

                        <label className="space-y-2">
                            <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính chi phí/ngày</span>
                            <select
                                className={`${inputClass} w-full pr-8`}
                                value={saveModal.day_calculation_mode}
                                onChange={(event) => setSaveModal((previous) => ({ ...previous, day_calculation_mode: event.target.value }))}
                            >
                                <option value="actual_month">Theo tháng thực tế</option>
                                <option value="fixed_30">Cố định 30 ngày</option>
                            </select>
                        </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-sm border border-primary/10 px-4 py-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tổng tháng sau khi lưu</p>
                            <p className="mt-2 text-[18px] font-black text-primary">{formatMoney(totalMonthly)}</p>
                        </div>
                        <div className="rounded-sm border border-primary/10 px-4 py-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí/ngày sau khi lưu</p>
                            <p className="mt-2 text-[18px] font-black text-primary">{formatMoney(dailyCost)}</p>
                            <p className="mt-2 text-[12px] text-primary/55">Tính trên {daysInMonth} ngày</p>
                        </div>
                    </div>

                    <label className="space-y-2">
                        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú version</span>
                        <textarea
                            className="min-h-[110px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary"
                            placeholder="Ví dụ: cập nhật mặt bằng và internet từ đầu tháng mới..."
                            value={saveModal.note}
                            onChange={(event) => setSaveModal((previous) => ({ ...previous, note: event.target.value }))}
                        />
                    </label>
                </div>
            </ModalShell>
        </div>
    );
};

export default FinanceTracking;
