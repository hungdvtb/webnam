import React, { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { financeApi } from '../../services/api';

const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const toolbarPanelClass = 'rounded-sm border border-primary/10 bg-white p-2 shadow-sm';
const dataPanelClass = 'overflow-hidden rounded-md border border-primary/10 bg-white shadow-xl';
const tableFrameClass = 'overflow-auto table-scrollbar relative';
const sheetTableClass = 'min-w-full border-collapse table-fixed text-left admin-text-13';
const stickyHeaderClass = 'admin-table-header sticky top-0 z-20 border-b border-primary/10 shadow-sm';
const headerCellClass = 'border border-primary/10 px-3 py-2.5 text-left text-[12px] font-black text-primary';
const bodyCellClass = 'border border-primary/20 px-3 py-2.5 text-[12px] text-[#0F172A]';
const numericBodyCellClass = 'border border-primary/20 px-3 py-2.5 text-right text-[12px] font-black text-primary';
const summaryCardClass = 'rounded-sm border border-primary/10 bg-white p-4 shadow-sm';
const infoChipClass = 'flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const sheetInputClass = 'h-10 rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-bold text-[#0F172A] outline-none transition placeholder:text-primary/30 focus:border-primary shadow-sm';
const iconButtonClass = 'inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[13px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black text-primary transition hover:border-primary hover:bg-primary/5';
const todayValue = new Date().toISOString().slice(0, 10);
const pageTitle = 'Chi phí cố định';

function formatMoneyValue(value) {
    const amount = Number(value || 0);

    return new Intl.NumberFormat('vi-VN', {
        maximumFractionDigits: 0,
    }).format(Number.isFinite(amount) ? Math.round(amount) : 0);
}

function formatMoney(value) {
    return `${formatMoneyValue(value)} đ`;
}

function sanitizeMoneyInput(value) {
    const digits = String(value ?? '').replace(/[^\d]/g, '');

    if (digits === '') return '';

    return digits.replace(/^0+(?=\d)/, '');
}

function parseMoneyValue(value) {
    if (value === '' || value === null || value === undefined) return 0;

    const normalized = sanitizeMoneyInput(value);
    return normalized === '' ? 0 : Number(normalized);
}

function formatMoneyInput(value) {
    if (value === '' || value === null || value === undefined) return '';

    const normalized = sanitizeMoneyInput(value);
    if (normalized === '') return '';

    return formatMoneyValue(normalized);
}

function formatDate(value) {
    if (!value) return 'Chưa có version';

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
    const monthlyAmount = row.monthly_amount ?? row.amount ?? '';

    return {
        localKey: row.id ? `fixed-${row.id}` : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        id: row.id ?? row.fixed_expense_id ?? null,
        content: row.content ?? row.name ?? '',
        monthly_amount: monthlyAmount === '' || monthlyAmount === null || monthlyAmount === undefined
            ? ''
            : sanitizeMoneyInput(monthlyAmount),
    };
}

function normalizeRowsForSave(rows) {
    return rows
        .filter((row) => row.content.trim() !== '' || row.monthly_amount !== '')
        .map((row) => ({
            id: row.id ?? undefined,
            content: row.content.trim(),
            monthly_amount: row.monthly_amount === '' ? 0 : parseMoneyValue(row.monthly_amount),
        }));
}

function validateRows(rows) {
    const errors = {};

    rows.forEach((row) => {
        const hasContent = row.content.trim() !== '';
        const normalizedAmount = sanitizeMoneyInput(row.monthly_amount);
        const hasAmount = normalizedAmount !== '';

        if (!hasContent && !hasAmount) return;

        if (!hasContent) {
            errors[row.localKey] = 'Thiếu nội dung.';
            return;
        }

        const amount = Number(normalizedAmount);
        if (!hasAmount || Number.isNaN(amount) || amount < 0) {
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

export default function FinanceTracking() {
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

        return sum + parseMoneyValue(row.monthly_amount);
    }, 0);
    const previewDayMode = summary.day_calculation_mode || currentVersion?.day_calculation_mode || 'actual_month';
    const previewDaysInMonth = getDaysInMonth(previewDate, previewDayMode);
    const dailyCost = previewDaysInMonth > 0 ? totalMonthly / previewDaysInMonth : 0;
    const saveDayMode = saveModal.day_calculation_mode || previewDayMode;
    const saveDaysInMonth = getDaysInMonth(saveModal.effective_date || previewDate, saveDayMode);
    const saveDailyCost = saveDaysInMonth > 0 ? totalMonthly / saveDaysInMonth : 0;
    const currentEffectiveDate = currentVersion?.effective_date || null;
    const applicableItems = currentVersion?.items || [];

    useEffect(() => {
        document.title = `${pageTitle} | Admin`;
    }, []);

    useEffect(() => {
        let ignore = false;

        async function loadSheet() {
            setLoading(true);

            try {
                const response = await financeApi.getFixedExpenses({ date: previewDate });
                if (ignore) return;

                const payload = response.data || {};
                const rows = (payload.rows || payload.current_version?.items || []).map((row) => createRow(row));

                setHistory(payload.history || []);
                setCurrentVersion(payload.current_version || null);
                setSummary({
                    row_count: 0,
                    total_monthly_amount: 0,
                    daily_amount: 0,
                    days_in_month: getDaysInMonth(previewDate, 'actual_month'),
                    day_calculation_mode: 'actual_month',
                    day_calculation_label: 'Theo tháng thực tế',
                    ...(payload.summary || {}),
                });
                setSaveModal((previous) => ({
                    ...previous,
                    day_calculation_mode: payload.current_version?.day_calculation_mode || payload.summary?.day_calculation_mode || previous.day_calculation_mode || 'actual_month',
                }));
                setSheetRows(rows.length ? rows : [createRow()]);
                setSheetDirty(false);
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
        setSheetRows((previous) => previous.map((row) => (
            row.localKey === localKey ? { ...row, [field]: value } : row
        )));
        setSheetDirty(true);
    };

    const updateMoneyRow = (localKey, value) => {
        updateRow(localKey, 'monthly_amount', sanitizeMoneyInput(value));
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
            day_calculation_mode: currentVersion?.day_calculation_mode || summary.day_calculation_mode || previous.day_calculation_mode || 'actual_month',
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

            setNotice({ type: 'success', message: 'Đã lưu version chi phí cố định thành công.' });
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
                        <span className="text-primary">Chi phí cố định</span>
                    </div>
                    <div>
                        <h1 className="text-[28px] font-black tracking-tight text-primary">{pageTitle}</h1>
                        <p className="mt-1 max-w-3xl text-[13px] text-primary/60">
                            Nhập liệu nhanh như bảng Excel, lưu version theo ngày áp dụng và để báo cáo lãi lỗ theo ngày tự lấy đúng chi phí cố định/ngày đang có hiệu lực.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <AccountSelector />
                    <button type="button" className={secondaryButtonClass} onClick={() => addRow()}>
                        <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                        <span>Thêm dòng</span>
                    </button>
                    <button type="button" className={primaryButtonClass} onClick={openSaveModal} disabled={saving}>
                        <span className="material-symbols-outlined text-[18px]">{saving ? 'hourglass_top' : 'event_available'}</span>
                        <span>Chọn ngày áp dụng & lưu</span>
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
                    <span className="text-[13px] font-black text-primary">{currentEffectiveDate ? `Từ ${formatDate(currentEffectiveDate)}` : 'Chưa có'}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Bảng</span>
                    <span className="text-[13px] font-black text-primary">{sheetDirty ? 'Có thay đổi chưa lưu' : 'Đồng bộ với version'}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Dòng dùng</span>
                    <span className="text-[13px] font-black text-primary">{visibleRows.filter((row) => row.content.trim() !== '' || row.monthly_amount !== '').length}</span>
                </div>
                <div className={infoChipClass}>
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Version đã lưu</span>
                    <span className="text-[13px] font-black text-primary">{history.length}</span>
                </div>
            </div>

            <div className={`${panelClass} px-5 py-4`}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Version đang chỉnh</p>
                        <p className="mt-2 text-[18px] font-black text-primary">
                            {currentEffectiveDate ? `Áp dụng từ ${formatDate(currentEffectiveDate)}` : 'Chưa có version, hãy lưu version đầu tiên'}
                        </p>
                        <p className="mt-1 max-w-3xl text-[12px] leading-6 text-primary/55">
                            Khi bạn thêm mới hoặc sửa chi phí, hãy bấm nút lưu để chọn ngày hiệu lực. Từ mốc đó trở đi, hệ thống sẽ tạo version mới và báo cáo theo ngày sẽ dùng đúng chi phí cố định/ngày của version này.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-sm border border-primary/10 bg-[#f8fbff] px-4 py-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày đang xem</p>
                            <p className="mt-2 text-[16px] font-black text-primary">{formatDate(previewDate)}</p>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-[#f8fbff] px-4 py-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Số version đã lưu</p>
                            <p className="mt-2 text-[16px] font-black text-primary">{history.length}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng hiện tại</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{currentEffectiveDate ? formatDate(currentEffectiveDate) : 'Chưa có'}</p>
                </div>

                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tổng chi phí/tháng</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatMoney(totalMonthly)}</p>
                </div>

                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí cố định/ngày</p>
                    <p className="mt-3 text-[22px] font-black text-primary">{formatMoney(dailyCost)}</p>
                    <p className="mt-2 text-[12px] text-primary/55">Chia theo {previewDaysInMonth} ngày</p>
                </div>

                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày muốn xem</p>
                    <input
                        type="date"
                        value={previewDate}
                        onChange={(event) => setPreviewDate(event.target.value)}
                        className={`${inputClass} mt-3 w-full`}
                    />
                </div>

                <div className={summaryCardClass}>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Trạng thái bảng</p>
                    <p className="mt-3 text-[18px] font-black text-primary">{sheetDirty ? 'Có thay đổi chưa lưu' : 'Đồng bộ với version đang xem'}</p>
                    <p className="mt-2 text-[12px] text-primary/55">{visibleRows.filter((row) => row.content.trim() !== '' || row.monthly_amount !== '').length} dòng đang dùng</p>
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
                <div className={dataPanelClass}>
                    <div className="flex flex-col gap-3 border-b border-primary/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[18px] font-black text-primary">Bảng nhập liệu chi phí cố định</h2>
                            <p className="mt-1 text-[12px] text-primary/55">
                                Enter để xuống dòng cùng cột. Cột tiền được format theo dấu chấm hàng nghìn để nhập nhanh và dễ nhìn.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={secondaryButtonClass} onClick={() => addRow()}>
                                <span className="material-symbols-outlined text-[18px]">playlist_add</span>
                                <span>Thêm dòng</span>
                            </button>
                            <button type="button" className={primaryButtonClass} onClick={openSaveModal} disabled={saving}>
                                <span className="material-symbols-outlined text-[18px]">{saving ? 'hourglass_top' : 'save'}</span>
                                <span>Lưu version</span>
                            </button>
                        </div>
                    </div>

                    <div className={tableFrameClass}>
                        <table className={`${sheetTableClass} min-w-[860px]`}>
                            <thead className={stickyHeaderClass}>
                                <tr>
                                    {['STT', 'Nội dung', 'Số tiền/tháng', ''].map((label) => (
                                        <th key={label} className={headerCellClass}>
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
                                    <tr key={row.localKey} className="transition-colors odd:bg-white even:bg-primary/[0.02] hover:bg-gold/5">
                                        <td className={`${bodyCellClass} font-black text-primary`}>{index + 1}</td>

                                        <td className={bodyCellClass}>
                                            <input
                                                ref={(node) => setCellRef(`${row.localKey}:content`, node)}
                                                className={`${sheetInputClass} w-full ${rowErrors[row.localKey] ? 'border-brick' : ''}`}
                                                placeholder="Ví dụ: Thuê mặt bằng, lương, internet..."
                                                value={row.content}
                                                onChange={(event) => updateRow(row.localKey, 'content', event.target.value)}
                                                onKeyDown={(event) => handleCellKeyDown(event, index, 'content')}
                                            />
                                            {rowErrors[row.localKey] ? <p className="mt-2 text-[11px] font-semibold text-brick">{rowErrors[row.localKey]}</p> : null}
                                        </td>

                                        <td className={bodyCellClass}>
                                            <input
                                                ref={(node) => setCellRef(`${row.localKey}:monthly_amount`, node)}
                                                className={`${sheetInputClass} w-full text-right ${rowErrors[row.localKey] ? 'border-brick' : ''}`}
                                                inputMode="numeric"
                                                autoComplete="off"
                                                placeholder="300.000"
                                                value={formatMoneyInput(row.monthly_amount)}
                                                onChange={(event) => updateMoneyRow(row.localKey, event.target.value)}
                                                onKeyDown={(event) => handleCellKeyDown(event, index, 'monthly_amount')}
                                            />
                                        </td>

                                        <td className={bodyCellClass}>
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
                            <h2 className="text-[18px] font-black text-primary">Version đang áp dụng cho ngày xem</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Báo cáo lãi lỗ theo ngày sẽ bám theo version này.</p>
                        </div>
                        <div className="space-y-4 p-5">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fbff] p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ngày áp dụng hiện tại</p>
                                <p className="mt-2 text-[18px] font-black text-primary">{formatDate(currentEffectiveDate || previewDate)}</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tổng chi phí/tháng</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatMoney(currentVersion?.total_monthly_amount || 0)}</p>
                                </div>
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí cố định/ngày</p>
                                    <p className="mt-2 text-[16px] font-black text-primary">{formatMoney(currentVersion?.daily_amount || 0)}</p>
                                </div>
                            </div>

                            <div className="rounded-sm border border-primary/10 p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Cách tính chi phí/ngày</p>
                                <p className="mt-2 text-[14px] font-black text-primary">{currentVersion?.day_calculation_label || 'Theo tháng thực tế'}</p>
                                <p className="mt-2 text-[12px] text-primary/55">Chia theo {currentVersion?.days_in_month || previewDaysInMonth} ngày</p>
                            </div>

                            {currentVersion?.note ? (
                                <div className="rounded-sm border border-primary/10 p-4">
                                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú version</p>
                                    <p className="mt-2 text-[13px] leading-6 text-primary/70">{currentVersion.note}</p>
                                </div>
                            ) : null}

                            <div className="rounded-sm border border-primary/10 p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Người tạo version</p>
                                <p className="mt-2 text-[14px] font-black text-primary">{currentVersion?.created_by_name || 'Hệ thống'}</p>
                                <p className="mt-2 text-[12px] text-primary/55">
                                    {currentVersion?.created_at ? `Tạo lúc ${new Date(currentVersion.created_at).toLocaleString('vi-VN')}` : 'Chưa có lịch sử tạo version.'}
                                </p>
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
                            <h2 className="text-[18px] font-black text-primary">Danh sách version đã áp dụng</h2>
                            <p className="mt-1 text-[12px] text-primary/55">Chạm vào một version để xem lại dữ liệu và chi phí/ngày ở mốc đó.</p>
                        </div>

                        <div className="space-y-3 p-5">
                            {history.length ? history.map((version) => {
                                const isActive = version.id ? version.id === currentVersion?.id : version.effective_date === currentVersion?.effective_date;

                                return (
                                    <button
                                        key={`${version.id}-${version.effective_date}`}
                                        type="button"
                                        onClick={() => setPreviewDate(version.effective_date)}
                                        className={`w-full rounded-sm border px-4 py-4 text-left transition ${isActive ? 'border-primary bg-primary/[0.04]' : 'border-primary/10 bg-white hover:border-primary hover:bg-primary/[0.03]'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-[14px] font-black text-primary">{formatDate(version.effective_date)}</p>
                                                    {isActive ? <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">Đang áp dụng</span> : null}
                                                </div>
                                                <p className="mt-1 text-[12px] text-primary/55">{version.day_calculation_label}</p>
                                                <p className="mt-2 text-[12px] text-primary/45">{version.items?.length || 0} dòng chi phí</p>
                                                {version.note ? <p className="mt-2 text-[12px] leading-5 text-primary/60">{version.note}</p> : null}
                                            </div>

                                            <div className="text-right">
                                                <p className="text-[13px] font-black text-primary">{formatMoney(version.total_monthly_amount)}</p>
                                                <p className="mt-1 text-[12px] text-primary/55">{formatMoney(version.daily_amount)}/ngày</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            }) : (
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
                        <p className="text-[12px] font-semibold leading-6 text-primary/65">
                            Ví dụ: nếu bạn chọn ngày hiệu lực là <strong>{formatDate(saveModal.effective_date || todayValue)}</strong>, thì từ ngày đó trở đi hệ thống sẽ tự dùng version chi phí cố định mới cho báo cáo lãi lỗ theo ngày.
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
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chi phí/ngày của version mới</p>
                            <p className="mt-2 text-[18px] font-black text-primary">{formatMoney(saveDailyCost)}</p>
                            <p className="mt-2 text-[12px] text-primary/55">Tính trên {saveDaysInMonth} ngày</p>
                        </div>
                    </div>

                    <label className="space-y-2">
                        <span className="text-[12px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú version</span>
                        <textarea
                            className="min-h-[110px] w-full rounded-sm border border-primary/15 bg-white px-3 py-2 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary"
                            placeholder="Ví dụ: cập nhật thêm internet và lương từ ngày 30..."
                            value={saveModal.note}
                            onChange={(event) => setSaveModal((previous) => ({ ...previous, note: event.target.value }))}
                        />
                    </label>
                </div>
            </ModalShell>
        </div>
    );
}
