import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Pagination from '../../components/Pagination';
import { telesalesApi } from '../../services/api';

const queueTabs = [
    { value: 'today', label: 'Việc hôm nay', icon: 'event_available', statKey: 'today_due' },
    { value: 'new_today', label: 'Khách mới', icon: 'person_add', statKey: 'new_today' },
    { value: '3_days', label: 'Gọi lại 3 ngày', icon: 'phone_callback', statKey: 'three_day_due' },
    { value: '7_days', label: 'Gọi lại 7 ngày', icon: 'event_repeat', statKey: 'seven_day_due' },
    { value: 'overdue', label: 'Quá hạn', icon: 'alarm', statKey: 'overdue' },
    { value: 'all', label: 'Tất cả', icon: 'view_list', statKey: null },
];

const emptyStats = {
    today_due: 0,
    new_today: 0,
    three_day_due: 0,
    seven_day_due: 0,
    overdue: 0,
    high_potential: 0,
    unassigned: 0,
};

const emptyPagination = {
    current_page: 1,
    last_page: 1,
    per_page: 20,
    total: 0,
};

const inputClassName = 'h-10 w-full rounded-sm border border-slate-200 bg-white px-3 text-[13px] text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10';
const selectClassName = `${inputClassName} pr-8`;
const inlineInputClassName = 'h-9 w-full min-w-0 rounded-sm border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:cursor-wait disabled:bg-slate-50 disabled:text-slate-400';
const inlineSelectClassName = `${inlineInputClassName} pr-7`;
const iconButtonClassName = 'inline-flex size-10 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-700';
const primaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-teal-700 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50';

const activityIconMap = {
    call: 'call',
    zalo: 'chat',
    schedule: 'event',
    status: 'published_with_changes',
    import: 'upload_file',
    note: 'sticky_note_2',
};

const dueBadgeClassMap = {
    overdue: 'border-red-200 bg-red-50 text-red-700',
    today: 'border-amber-200 bg-amber-50 text-amber-700',
    future: 'border-sky-200 bg-sky-50 text-sky-700',
    stopped: 'border-slate-200 bg-slate-100 text-slate-600',
};

const potentialBadgeClassMap = {
    hot: 'border-red-200 bg-red-50 text-red-700',
    high: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    medium: 'border-amber-200 bg-amber-50 text-amber-700',
    low: 'border-slate-200 bg-slate-50 text-slate-600',
    unqualified: 'border-zinc-200 bg-zinc-100 text-zinc-600',
};

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);

const isCanceledRequest = (error) => error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';

const createImportRow = (overrides = {}) => ({
    local_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customer_name: '',
    phone: '',
    zalo_same_as_phone: true,
    zalo_phone: '',
    ...overrides,
});

const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');

const normalizeVietnameseText = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stopFollowUpStatusPatterns = [
    'khong co nhu cau',
    'khong nhu cau',
    'chua co nhu cau',
    'chi tham khao',
    'tham khao',
    'khong tiem nang',
    'khong goi nua',
    'tu choi',
    'huy',
    'sai sdt',
    'sai so',
    'so rac',
    'spam',
];

const statusStopsFollowUp = (status) => {
    const normalized = normalizeVietnameseText(`${status?.code || ''} ${status?.name || ''}`);
    return stopFollowUpStatusPatterns.some((pattern) => normalized.includes(pattern));
};

const nextAutomaticFollowUpInterval = (previousIntervalDays) => (
    Number(previousIntervalDays || 0) >= 3 ? 7 : 3
);

const scriptForFollowUpInterval = (intervalDays) => (
    Number(intervalDays) === 7 ? '7_days' : '3_days'
);

const addDaysAtNine = (days) => {
    const date = new Date();
    const dayCount = Number(days || 0);

    if (dayCount <= 0) {
        date.setMinutes(date.getMinutes() + 30);
        const roundedMinutes = Math.ceil(date.getMinutes() / 15) * 15;
        if (roundedMinutes >= 60) {
            date.setHours(date.getHours() + 1, 0, 0, 0);
        } else {
            date.setMinutes(roundedMinutes, 0, 0);
        }

        return toDateTimeLocalValue(date);
    }

    date.setDate(date.getDate() + dayCount);
    date.setHours(9, 0, 0, 0);
    return toDateTimeLocalValue(date);
};

const toDateTimeLocalValue = (value) => {
    if (!value) return '';

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const formatDateTimeLocalLabel = (value) => {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

const resolveApiMessage = (error, fallback) => (
    error?.response?.data?.message
    || error?.message
    || fallback
);

const labelForDueBucket = (lead) => {
    if (lead?.do_not_call || lead?.due_bucket === 'stopped') return 'Không gọi nữa';
    if (lead?.due_bucket === 'overdue') return 'Quá hạn';
    if (lead?.due_bucket === 'today') return 'Đến lịch';
    if (lead?.due_bucket === 'future') return 'Sắp tới';
    return 'Chưa hẹn';
};

const buildZaloUrl = (phone) => {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return '';

    const zaloPhone = digits.startsWith('0') ? `84${digits.slice(1)}` : digits;
    return `https://zalo.me/${zaloPhone}`;
};

const TelesalesCrm = () => {
    const [bootstrap, setBootstrap] = useState({
        statuses: [],
        staffs: [],
        potentials: [],
        follow_up_scripts: [],
        activity_types: [],
    });
    const [leads, setLeads] = useState([]);
    const [stats, setStats] = useState(emptyStats);
    const [pagination, setPagination] = useState(emptyPagination);
    const [page, setPage] = useState(1);
    const [queue, setQueue] = useState('today');
    const [search, setSearch] = useState('');
    const [staffFilter, setStaffFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [potentialFilter, setPotentialFilter] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [selectedLead, setSelectedLead] = useState(null);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [inlineSavingIds, setInlineSavingIds] = useState({});
    const [inlineNoteDrafts, setInlineNoteDrafts] = useState({});
    const [inlineFollowUpDrafts, setInlineFollowUpDrafts] = useState({});
    const [errorMessage, setErrorMessage] = useState('');
    const [toast, setToast] = useState('');
    const [importOpen, setImportOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const [importRows, setImportRows] = useState(() => [createImportRow()]);
    const [importForm, setImportForm] = useState({
        source: 'telesales',
        tag: 'Telesales',
        assigned_staff_id: '',
        potential_level: '',
        follow_up_script: '3_days',
        note: '',
    });
    const [careForm, setCareForm] = useState({
        assigned_staff_id: '',
        lead_status_id: '',
        potential_level: '',
        follow_up_script: '3_days',
        follow_up_interval_days: 3,
        next_follow_up_at: addDaysAtNine(3),
        do_not_call: false,
        zalo_same_as_phone: true,
        zalo_phone: '',
        activity_type: 'call',
        note: '',
    });

    const selectedStatus = useMemo(
        () => bootstrap.statuses.find((status) => Number(status.id) === Number(careForm.lead_status_id)) || null,
        [bootstrap.statuses, careForm.lead_status_id]
    );
    const followUpPreview = useMemo(() => {
        if (careForm.do_not_call || statusStopsFollowUp(selectedStatus)) {
            return 'Khách sẽ dừng nhắc lại và không hiện trong Việc hôm nay.';
        }

        const nextIntervalDays = nextAutomaticFollowUpInterval(selectedLead?.follow_up_interval_days);
        const dateLabel = formatDateTimeLocalLabel(addDaysAtNine(nextIntervalDays));

        return `Sau khi bấm Lưu chăm sóc, hệ thống tự hẹn lại sau ${nextIntervalDays} ngày và đưa khách lên Việc hôm nay vào ${dateLabel}.`;
    }, [careForm.do_not_call, selectedLead?.follow_up_interval_days, selectedStatus]);
    const canSubmitImport = useMemo(
        () => importRows.some((row) => row.phone.trim())
            && importRows.every((row) => !row.phone.trim() || row.zalo_same_as_phone || row.zalo_phone.trim()),
        [importRows]
    );

    const fetchBootstrap = useCallback(async () => {
        const response = await telesalesApi.bootstrap();
        setBootstrap({
            statuses: response.data?.statuses || [],
            staffs: response.data?.staffs || [],
            potentials: response.data?.potentials || [],
            follow_up_scripts: response.data?.follow_up_scripts || [],
            activity_types: response.data?.activity_types || [],
        });
    }, []);

    const fetchLeads = useCallback(async (nextPage = page, signal = undefined) => {
        setLoading(true);
        setErrorMessage('');

        try {
            const response = await telesalesApi.getAll({
                page: nextPage,
                per_page: 20,
                queue,
                search: search.trim() || undefined,
                staff_id: staffFilter || undefined,
                status_id: statusFilter || undefined,
                potential_level: potentialFilter || undefined,
            }, signal);
            const data = response.data || {};
            const nextLeads = data.data || [];

            setLeads(nextLeads);
            setStats({ ...emptyStats, ...(data.stats || {}) });
            setPagination({
                current_page: data.current_page || 1,
                last_page: data.last_page || 1,
                per_page: data.per_page || 20,
                total: data.total || 0,
            });
            setSelectedId((currentId) => {
                if (currentId && nextLeads.some((lead) => Number(lead.id) === Number(currentId))) {
                    return currentId;
                }

                return nextLeads[0]?.id || null;
            });
        } catch (error) {
            if (!isCanceledRequest(error)) {
                setErrorMessage(resolveApiMessage(error, 'Không tải được danh sách telesales.'));
            }
        } finally {
            setLoading(false);
        }
    }, [page, potentialFilter, queue, search, staffFilter, statusFilter]);

    const fetchLeadDetail = useCallback(async (id) => {
        if (!id) {
            setSelectedLead(null);
            return;
        }

        setDetailLoading(true);
        try {
            const response = await telesalesApi.getOne(id);
            setSelectedLead(response.data || null);
        } catch (error) {
            if (!isCanceledRequest(error)) {
                setErrorMessage(resolveApiMessage(error, 'Không tải được chi tiết khách.'));
            }
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBootstrap().catch((error) => {
            setErrorMessage(resolveApiMessage(error, 'Không tải được cấu hình telesales.'));
        });
    }, [fetchBootstrap]);

    useEffect(() => {
        const controller = new AbortController();
        fetchLeads(page, controller.signal);

        return () => controller.abort();
    }, [fetchLeads, page]);

    useEffect(() => {
        fetchLeadDetail(selectedId);
    }, [fetchLeadDetail, selectedId]);

    useEffect(() => {
        if (!selectedLead?.id) return;
        const nextStatus = bootstrap.statuses.find((status) => Number(status.id) === Number(selectedLead.lead_status_id)) || selectedLead.status_config;
        const shouldStopFollowUp = Boolean(selectedLead.do_not_call) || statusStopsFollowUp(nextStatus);
        const nextIntervalDays = nextAutomaticFollowUpInterval(selectedLead.follow_up_interval_days);

        setCareForm((prev) => ({
            ...prev,
            assigned_staff_id: selectedLead.assigned_staff_id ? String(selectedLead.assigned_staff_id) : '',
            lead_status_id: selectedLead.lead_status_id ? String(selectedLead.lead_status_id) : '',
            potential_level: selectedLead.potential_level || '',
            follow_up_script: scriptForFollowUpInterval(nextIntervalDays),
            follow_up_interval_days: nextIntervalDays,
            next_follow_up_at: shouldStopFollowUp ? '' : (toDateTimeLocalValue(selectedLead.next_follow_up_at) || addDaysAtNine(nextIntervalDays)),
            do_not_call: shouldStopFollowUp,
            zalo_same_as_phone: !selectedLead.zalo_phone || normalizePhoneDigits(selectedLead.zalo_phone) === normalizePhoneDigits(selectedLead.phone),
            zalo_phone: selectedLead.zalo_phone || selectedLead.phone || '',
            note: '',
        }));
    }, [bootstrap.statuses, selectedLead]);

    const handleQueueChange = (nextQueue) => {
        setQueue(nextQueue);
        setPage(1);
    };

    const handleSelectLead = (lead) => {
        setSelectedId(lead.id);
        setSelectedLead(lead);
    };

    const handleSaveCare = async (activityType = careForm.activity_type) => {
        if (!selectedLead?.id) return;

        setSaving(true);
        setErrorMessage('');
        setToast('');

        try {
            const selectedStatusForSave = bootstrap.statuses.find((status) => Number(status.id) === Number(careForm.lead_status_id)) || null;
            const shouldStopFollowUp = careForm.do_not_call || statusStopsFollowUp(selectedStatusForSave);
            const nextIntervalDays = nextAutomaticFollowUpInterval(selectedLead.follow_up_interval_days);

            const response = await telesalesApi.update(selectedLead.id, {
                assigned_staff_id: careForm.assigned_staff_id || null,
                lead_status_id: careForm.lead_status_id || null,
                potential_level: careForm.potential_level || null,
                follow_up_script: shouldStopFollowUp ? null : scriptForFollowUpInterval(nextIntervalDays),
                follow_up_interval_days: shouldStopFollowUp ? null : nextIntervalDays,
                next_follow_up_at: shouldStopFollowUp ? null : addDaysAtNine(nextIntervalDays),
                do_not_call: shouldStopFollowUp,
                zalo_phone: careForm.zalo_same_as_phone ? selectedLead.phone : careForm.zalo_phone,
                activity_type: activityType,
                note: careForm.note.trim(),
            });

            const nextLead = response.data?.lead;
            if (nextLead) {
                setSelectedLead(nextLead);
                setSelectedId(nextLead.id);
                setLeads((prev) => prev.map((lead) => Number(lead.id) === Number(nextLead.id) ? nextLead : lead));
            }
            setStats({ ...emptyStats, ...(response.data?.stats || stats) });
            setCareForm((prev) => ({ ...prev, note: '' }));
            setToast('Đã lưu lịch sử chăm sóc.');
            await fetchLeadDetail(selectedLead.id);
            await fetchLeads(page);
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không lưu được cập nhật telesales.'));
        } finally {
            setSaving(false);
        }
    };

    const setInlineSaving = (leadId, isSaving) => {
        setInlineSavingIds((prev) => ({
            ...prev,
            [leadId]: isSaving,
        }));
    };

    const handleInlineLeadUpdate = async (lead, payload, successMessage = 'Đã cập nhật khách.') => {
        if (!lead?.id) return null;

        setInlineSaving(lead.id, true);
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.update(lead.id, payload);
            const nextLead = response.data?.lead;

            if (nextLead) {
                setLeads((prev) => prev.map((item) => Number(item.id) === Number(nextLead.id) ? nextLead : item));
                setSelectedLead((current) => Number(current?.id) === Number(nextLead.id) ? nextLead : current);
            }

            setStats((prev) => ({ ...emptyStats, ...(response.data?.stats || prev) }));
            setToast(successMessage);

            if (nextLead && Number(selectedId) === Number(nextLead.id)) {
                await fetchLeadDetail(nextLead.id);
            }

            await fetchLeads(page);

            return nextLead || null;
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không lưu được cập nhật trực tiếp.'));
            return null;
        } finally {
            setInlineSaving(lead.id, false);
        }
    };

    const handleInlineStatusChange = (lead, nextStatusId) => {
        const nextStatus = bootstrap.statuses.find((status) => Number(status.id) === Number(nextStatusId)) || null;
        const shouldStopFollowUp = statusStopsFollowUp(nextStatus);

        handleInlineLeadUpdate(lead, {
            lead_status_id: nextStatusId || null,
            do_not_call: shouldStopFollowUp,
            activity_type: 'status',
        }, 'Đã cập nhật trạng thái khách.');
    };

    const handleInlinePotentialChange = (lead, nextPotential) => {
        if ((lead.potential_level || '') === nextPotential) return;

        handleInlineLeadUpdate(lead, {
            potential_level: nextPotential || null,
            activity_type: 'note',
        }, 'Đã cập nhật mức tiềm năng.');
    };

    const saveInlineFollowUp = async (lead) => {
        const draftValue = inlineFollowUpDrafts[lead.id] ?? toDateTimeLocalValue(lead.next_follow_up_at);
        const currentValue = toDateTimeLocalValue(lead.next_follow_up_at);

        if (draftValue === currentValue) return;

        const nextLead = await handleInlineLeadUpdate(lead, {
            next_follow_up_at: draftValue || null,
            follow_up_script: draftValue ? 'custom' : null,
            follow_up_interval_days: null,
            do_not_call: false,
            activity_type: 'schedule',
        }, draftValue ? 'Đã cập nhật lịch hẹn gọi lại.' : 'Đã xóa lịch hẹn gọi lại.');

        if (nextLead) {
            setInlineFollowUpDrafts((prev) => {
                const next = { ...prev };
                delete next[lead.id];
                return next;
            });
        }
    };

    const saveInlineNote = async (lead) => {
        const draftValue = inlineNoteDrafts[lead.id] ?? lead.latest_note_content ?? lead.latest_note_excerpt ?? '';
        const content = draftValue.trim();
        const currentContent = String(lead.latest_note_content ?? lead.latest_note_excerpt ?? '').trim();

        if (!content || content === currentContent) return;

        const nextLead = await handleInlineLeadUpdate(lead, {
            note: content,
            activity_type: 'note',
        }, 'Đã thêm ghi chú mới.');

        if (nextLead) {
            setInlineNoteDrafts((prev) => ({
                ...prev,
                [lead.id]: nextLead.latest_note_content || nextLead.latest_note_excerpt || '',
            }));
        }
    };

    const updateImportRow = (rowId, updates) => {
        setImportRows((prev) => prev.map((row) => {
            if (row.local_id !== rowId) return row;

            const nextRow = { ...row, ...updates };
            if (Object.prototype.hasOwnProperty.call(updates, 'phone') && nextRow.zalo_same_as_phone) {
                nextRow.zalo_phone = '';
            }

            return nextRow;
        }));
    };

    const addImportRow = () => {
        setImportRows((prev) => [...prev, createImportRow()]);
    };

    const removeImportRow = (rowId) => {
        setImportRows((prev) => {
            if (prev.length <= 1) return [createImportRow()];
            return prev.filter((row) => row.local_id !== rowId);
        });
    };

    const handleImportSubmit = async (event) => {
        event.preventDefault();
        setImporting(true);
        setErrorMessage('');
        setImportResult(null);

        try {
            const importPayloadRows = importRows
                .map((row) => ({
                    customer_name: row.customer_name.trim(),
                    phone: row.phone.trim(),
                    zalo_same_as_phone: row.zalo_same_as_phone,
                    zalo_phone: row.zalo_same_as_phone ? row.phone.trim() : row.zalo_phone.trim(),
                }))
                .filter((row) => row.phone);

            const response = await telesalesApi.importLeads({
                ...importForm,
                phones: importPayloadRows,
                assigned_staff_id: importForm.assigned_staff_id || null,
                potential_level: importForm.potential_level || null,
            });
            const result = response.data || {};
            setImportResult(result);
            setToast(`Đã nhập ${formatNumber(result.created_count)} khách, bỏ qua ${formatNumber(result.duplicate_count)} số trùng.`);
            setImportRows([createImportRow()]);
            setImportForm((prev) => ({ ...prev, note: '' }));
            setQueue('today');
            setPage(1);

            if (result.created?.[0]?.id) {
                setSelectedId(result.created[0].id);
            }

            await fetchLeads(1);
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không nhập được danh sách số điện thoại.'));
        } finally {
            setImporting(false);
        }
    };

    const handleOpenPhone = () => {
        if (!selectedLead?.phone) return;
        window.location.href = `tel:${selectedLead.phone}`;
    };

    const handleOpenZalo = () => {
        const url = buildZaloUrl(selectedLead?.zalo_phone_for_zalo || selectedLead?.phone_for_zalo || selectedLead?.phone);
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const renderPotentialBadge = (lead) => {
        const value = lead?.potential_level;
        const label = lead?.potential_label || 'Chưa phân loại';
        const className = potentialBadgeClassMap[value] || 'border-slate-200 bg-white text-slate-500';

        return (
            <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[12px] font-semibold ${className}`}>
                <span className="truncate">{label}</span>
            </span>
        );
    };

    const renderDueBadge = (lead) => {
        const bucket = lead?.due_bucket;
        const className = dueBadgeClassMap[bucket] || 'border-slate-200 bg-white text-slate-500';

        return (
            <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[12px] font-semibold ${className}`}>
                {labelForDueBucket(lead)}
            </span>
        );
    };

    return (
        <div className="min-h-full bg-[#edf3f6] text-slate-900">
            <div className="flex min-h-full flex-col gap-4 p-4 lg:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-slate-950">CRM Telesales</h1>
                        <p className="mt-1 text-[13px] font-medium text-slate-500">Quản lý khách, lịch gọi lại 3/7 ngày, sale phụ trách và lịch sử chăm sóc.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setImportOpen(true)} className={primaryButtonClassName}>
                            <span className="material-symbols-outlined text-[18px]">upload_file</span>
                            Nhập khách
                        </button>
                        <button type="button" onClick={() => fetchLeads(page)} className={iconButtonClassName} title="Làm mới">
                            <span className="material-symbols-outlined text-[19px]">refresh</span>
                        </button>
                    </div>
                </div>

                {errorMessage ? (
                    <div className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                        {errorMessage}
                    </div>
                ) : null}

                {toast ? (
                    <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700">
                        {toast}
                    </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                    {queueTabs.map((tab) => {
                        const active = queue === tab.value;
                        const value = tab.statKey ? stats[tab.statKey] : pagination.total;

                        return (
                            <button
                                key={tab.value}
                                type="button"
                                onClick={() => handleQueueChange(tab.value)}
                                className={`min-h-[92px] rounded-sm border bg-white p-3 text-left shadow-sm transition ${
                                    active ? 'border-teal-500 ring-2 ring-teal-500/10' : 'border-slate-200 hover:border-teal-300'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className={`inline-flex size-9 items-center justify-center rounded-sm ${active ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                        <span className="material-symbols-outlined text-[19px]">{tab.icon}</span>
                                    </span>
                                    {tab.value === 'overdue' && Number(value) > 0 ? (
                                        <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700">Cần xử lý</span>
                                    ) : null}
                                </div>
                                <div className="mt-3 text-2xl font-black text-slate-950">{formatNumber(value)}</div>
                                <div className="mt-0.5 truncate text-[13px] font-semibold text-slate-500">{tab.label}</div>
                            </button>
                        );
                    })}
                </div>

                <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <div className="min-w-0 overflow-hidden rounded-sm border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-200 p-4">
                            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
                                <div className="relative min-w-0 flex-1">
                                    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">search</span>
                                    <input
                                        value={search}
                                        onChange={(event) => {
                                            setSearch(event.target.value);
                                            setPage(1);
                                        }}
                                        className={`${inputClassName} pl-10`}
                                        placeholder="Tìm tên khách, SĐT, mã lead, ghi chú..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 2xl:w-[620px]">
                                    <select
                                        value={staffFilter}
                                        onChange={(event) => {
                                            setStaffFilter(event.target.value);
                                            setPage(1);
                                        }}
                                        className={selectClassName}
                                    >
                                        <option value="">Tất cả sale</option>
                                        <option value="unassigned">Chưa gán sale</option>
                                        {bootstrap.staffs.map((staff) => (
                                            <option key={staff.id} value={staff.id}>{staff.name}</option>
                                        ))}
                                    </select>

                                    <select
                                        value={statusFilter}
                                        onChange={(event) => {
                                            setStatusFilter(event.target.value);
                                            setPage(1);
                                        }}
                                        className={selectClassName}
                                    >
                                        <option value="">Tất cả trạng thái</option>
                                        {bootstrap.statuses.map((status) => (
                                            <option key={status.id} value={status.id}>{status.name}</option>
                                        ))}
                                    </select>

                                    <select
                                        value={potentialFilter}
                                        onChange={(event) => {
                                            setPotentialFilter(event.target.value);
                                            setPage(1);
                                        }}
                                        className={selectClassName}
                                    >
                                        <option value="">Tất cả tiềm năng</option>
                                        {bootstrap.potentials.map((potential) => (
                                            <option key={potential.value} value={potential.value}>{potential.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="lead-table-scrollbar overflow-auto">
                            <table className="min-w-[980px] table-fixed border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 text-left text-[12px] font-bold text-slate-500">
                                        <th className="w-[210px] border-b border-slate-200 px-4 py-3">Khách hàng</th>
                                        <th className="w-[140px] border-b border-slate-200 px-4 py-3">SĐT</th>
                                        <th className="w-[150px] border-b border-slate-200 px-4 py-3">Sale phụ trách</th>
                                        <th className="w-[150px] border-b border-slate-200 px-4 py-3">Trạng thái</th>
                                        <th className="w-[140px] border-b border-slate-200 px-4 py-3">Tiềm năng</th>
                                        <th className="w-[170px] border-b border-slate-200 px-4 py-3">Hẹn gọi lại</th>
                                        <th className="w-[220px] border-b border-slate-200 px-4 py-3">Ghi chú gần nhất</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && leads.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-16 text-center text-[13px] font-semibold text-slate-500">
                                                Đang tải danh sách khách...
                                            </td>
                                        </tr>
                                    ) : leads.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-16 text-center text-[13px] font-semibold text-slate-500">
                                                Chưa có khách phù hợp với bộ lọc hiện tại.
                                            </td>
                                        </tr>
                                    ) : leads.map((lead) => {
                                        const selected = Number(selectedId) === Number(lead.id);
                                        const inlineSaving = Boolean(inlineSavingIds[lead.id]);
                                        const statusValue = lead.lead_status_id ? String(lead.lead_status_id) : '';
                                        const potentialValue = lead.potential_level || '';
                                        const followUpValue = inlineFollowUpDrafts[lead.id] ?? toDateTimeLocalValue(lead.next_follow_up_at);
                                        const noteValue = inlineNoteDrafts[lead.id] ?? lead.latest_note_content ?? lead.latest_note_excerpt ?? '';
                                        const potentialOption = bootstrap.potentials.find((potential) => potential.value === potentialValue);

                                        return (
                                            <tr
                                                key={lead.id}
                                                onClick={() => handleSelectLead(lead)}
                                                className={`cursor-pointer border-b border-slate-100 text-[13px] transition ${
                                                    selected ? 'bg-teal-50/80' : 'bg-white hover:bg-slate-50'
                                                }`}
                                            >
                                                <td className="px-4 py-3 align-top">
                                                    <div className="min-w-0">
                                                        <div className="truncate font-bold text-slate-950">{lead.customer_name || 'Khách chưa có tên'}</div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                                                            <span>{lead.lead_number || `#${lead.id}`}</span>
                                                            <span className="text-slate-300">/</span>
                                                            <span className="truncate">{lead.tag || lead.source || 'Telesales'}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 align-top font-semibold text-slate-800">{lead.phone || '-'}</td>
                                                <td className="px-4 py-3 align-top text-slate-700">{lead.assigned_staff?.name || 'Chưa gán'}</td>
                                                <td className="px-4 py-3 align-top">
                                                    <select
                                                        value={statusValue}
                                                        disabled={inlineSaving}
                                                        onClick={(event) => event.stopPropagation()}
                                                        onChange={(event) => handleInlineStatusChange(lead, event.target.value)}
                                                        className={inlineSelectClassName}
                                                        style={{
                                                            borderColor: `${lead.status_config?.color || '#64748b'}55`,
                                                            color: lead.status_config?.color || '#475569',
                                                        }}
                                                        aria-label={`Sửa trạng thái ${lead.customer_name || lead.phone || lead.id}`}
                                                    >
                                                        <option value="">Chưa chọn</option>
                                                        {bootstrap.statuses.map((status) => (
                                                            <option key={status.id} value={status.id}>{status.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <select
                                                        value={potentialValue}
                                                        disabled={inlineSaving}
                                                        onClick={(event) => event.stopPropagation()}
                                                        onChange={(event) => handleInlinePotentialChange(lead, event.target.value)}
                                                        className={inlineSelectClassName}
                                                        style={{
                                                            borderColor: `${potentialOption?.color || '#94a3b8'}55`,
                                                            color: potentialOption?.color || '#475569',
                                                        }}
                                                        aria-label={`Sửa tiềm năng ${lead.customer_name || lead.phone || lead.id}`}
                                                    >
                                                        <option value="">Chưa phân loại</option>
                                                        {bootstrap.potentials.map((potential) => (
                                                            <option key={potential.value} value={potential.value}>{potential.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex flex-col gap-1">
                                                        {renderDueBadge(lead)}
                                                        <input
                                                            type="datetime-local"
                                                            value={followUpValue}
                                                            disabled={inlineSaving}
                                                            onClick={(event) => event.stopPropagation()}
                                                            onChange={(event) => setInlineFollowUpDrafts((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                                                            onBlur={() => saveInlineFollowUp(lead)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') {
                                                                    event.preventDefault();
                                                                    event.currentTarget.blur();
                                                                }

                                                                if (event.key === 'Escape') {
                                                                    event.preventDefault();
                                                                    setInlineFollowUpDrafts((prev) => {
                                                                        const next = { ...prev };
                                                                        delete next[lead.id];
                                                                        return next;
                                                                    });
                                                                    event.currentTarget.blur();
                                                                }
                                                            }}
                                                            className={`${inlineInputClassName} text-[11px]`}
                                                            aria-label={`Sửa ngày hẹn gọi lại ${lead.customer_name || lead.phone || lead.id}`}
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <input
                                                        type="text"
                                                        value={noteValue}
                                                        disabled={inlineSaving}
                                                        placeholder="Nhập ghi chú..."
                                                        onClick={(event) => event.stopPropagation()}
                                                        onChange={(event) => setInlineNoteDrafts((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                                                        onBlur={() => saveInlineNote(lead)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                event.currentTarget.blur();
                                                            }

                                                            if (event.key === 'Escape') {
                                                                event.preventDefault();
                                                                setInlineNoteDrafts((prev) => {
                                                                    const next = { ...prev };
                                                                    delete next[lead.id];
                                                                    return next;
                                                                });
                                                                event.currentTarget.blur();
                                                            }
                                                        }}
                                                        className={inlineInputClassName}
                                                        aria-label={`Sửa ghi chú ${lead.customer_name || lead.phone || lead.id}`}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
                            <div className="text-[13px] font-semibold text-slate-500">
                                Tổng khách đang xem: <span className="font-black text-slate-900">{formatNumber(pagination.total)}</span>
                            </div>
                            <Pagination pagination={pagination} onPageChange={setPage} />
                        </div>
                    </div>

                    <aside className="min-w-0 rounded-sm border border-slate-200 bg-white shadow-sm">
                        {!selectedLead ? (
                            <div className="flex min-h-[520px] items-center justify-center p-8 text-center">
                                <div>
                                    <span className="material-symbols-outlined text-[44px] text-slate-300">contact_phone</span>
                                    <div className="mt-3 text-[15px] font-bold text-slate-700">Chọn một khách để xem chi tiết</div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full min-h-[680px] flex-col">
                                <div className="border-b border-slate-200 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="truncate text-xl font-black text-slate-950">{selectedLead.customer_name || 'Khách chưa có tên'}</h2>
                                                {renderPotentialBadge(selectedLead)}
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-500">
                                                <span>{selectedLead.phone || '-'}</span>
                                                <span className="text-slate-300">/</span>
                                                <span>{selectedLead.assigned_staff?.name || 'Chưa gán sale'}</span>
                                            </div>
                                        </div>
                                        {detailLoading ? (
                                            <span className="material-symbols-outlined animate-spin text-[20px] text-teal-700">progress_activity</span>
                                        ) : null}
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-2">
                                        <button type="button" onClick={handleOpenPhone} className={primaryButtonClassName}>
                                            <span className="material-symbols-outlined text-[18px]">call</span>
                                            Gọi điện
                                        </button>
                                        <button type="button" onClick={handleOpenZalo} className={secondaryButtonClassName}>
                                            <span className="material-symbols-outlined text-[18px]">chat</span>
                                            Nhắn Zalo
                                        </button>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 gap-2">
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={careForm.zalo_same_as_phone}
                                                onChange={(event) => setCareForm((prev) => ({
                                                    ...prev,
                                                    zalo_same_as_phone: event.target.checked,
                                                    zalo_phone: event.target.checked ? (selectedLead.phone || '') : prev.zalo_phone,
                                                }))}
                                                className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                                            />
                                            SĐT khách là Zalo
                                        </label>
                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">SĐT Zalo</span>
                                            <input
                                                value={careForm.zalo_same_as_phone ? (selectedLead.phone || '') : careForm.zalo_phone}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, zalo_phone: event.target.value }))}
                                                disabled={careForm.zalo_same_as_phone}
                                                className={inputClassName}
                                                placeholder="Nhập SĐT Zalo nếu khác SĐT khách"
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className="border-b border-slate-200 p-4">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Sale phụ trách</span>
                                            <select
                                                value={careForm.assigned_staff_id}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, assigned_staff_id: event.target.value }))}
                                                className={selectClassName}
                                            >
                                                <option value="">Chưa gán</option>
                                                {bootstrap.staffs.map((staff) => (
                                                    <option key={staff.id} value={staff.id}>{staff.name}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Trạng thái</span>
                                            <select
                                                value={careForm.lead_status_id}
                                                onChange={(event) => {
                                                    const nextStatusId = event.target.value;
                                                    const nextStatus = bootstrap.statuses.find((status) => Number(status.id) === Number(nextStatusId));
                                                    const shouldStopFollowUp = statusStopsFollowUp(nextStatus);
                                                    const nextIntervalDays = nextAutomaticFollowUpInterval(selectedLead?.follow_up_interval_days);

                                                    setCareForm((prev) => ({
                                                        ...prev,
                                                        lead_status_id: nextStatusId,
                                                        do_not_call: shouldStopFollowUp ? true : false,
                                                        follow_up_script: scriptForFollowUpInterval(nextIntervalDays),
                                                        follow_up_interval_days: nextIntervalDays,
                                                        next_follow_up_at: shouldStopFollowUp ? '' : addDaysAtNine(nextIntervalDays),
                                                    }));
                                                }}
                                                className={selectClassName}
                                            >
                                                <option value="">Chưa có</option>
                                                {bootstrap.statuses.map((status) => (
                                                    <option key={status.id} value={status.id}>{status.name}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Tiềm năng</span>
                                            <select
                                                value={careForm.potential_level}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, potential_level: event.target.value }))}
                                                className={selectClassName}
                                            >
                                                <option value="">Chưa phân loại</option>
                                                {bootstrap.potentials.map((potential) => (
                                                    <option key={potential.value} value={potential.value}>{potential.label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Loại lịch sử</span>
                                            <select
                                                value={careForm.activity_type}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, activity_type: event.target.value }))}
                                                className={selectClassName}
                                            >
                                                {bootstrap.activity_types.map((activity) => (
                                                    <option key={activity.value} value={activity.value}>{activity.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <div className="mt-3 rounded-sm border border-teal-200 bg-teal-50 px-3 py-3">
                                        <div className="flex items-start gap-2">
                                            <span className="material-symbols-outlined mt-0.5 text-[18px] text-teal-700">event_repeat</span>
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-black text-teal-900">
                                                    Tự động nhắc lại sau {nextAutomaticFollowUpInterval(selectedLead.follow_up_interval_days)} ngày
                                                </div>
                                                <div className="mt-1 text-[12px] font-semibold leading-5 text-teal-800">{followUpPreview}</div>
                                                {selectedLead.next_follow_up_label ? (
                                                    <div className="mt-1 text-[12px] font-semibold text-teal-700/75">
                                                        Lịch hiện tại: {selectedLead.next_follow_up_label}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3">
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={careForm.do_not_call}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, do_not_call: event.target.checked }))}
                                                className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                                            />
                                            Dừng nhắc lại cho khách này
                                        </label>
                                    </div>

                                    <label className="mt-3 block">
                                        <span className="mb-1 block text-[12px] font-bold text-slate-500">Ghi chú</span>
                                        <textarea
                                            value={careForm.note}
                                            onChange={(event) => setCareForm((prev) => ({ ...prev, note: event.target.value }))}
                                            className="min-h-[96px] w-full resize-none rounded-sm border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                                            placeholder="Ví dụ: khách hỏi giá, hẹn gọi lại chiều thứ 6..."
                                        />
                                    </label>

                                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-[12px] font-semibold text-slate-500">
                                            {selectedStatus ? `Sẽ lưu trạng thái: ${selectedStatus.name}` : 'Sẵn sàng lưu cập nhật'}
                                        </div>
                                        <button type="button" onClick={() => handleSaveCare()} disabled={saving} className={primaryButtonClassName}>
                                            <span className="material-symbols-outlined text-[18px]">save</span>
                                            {saving ? 'Đang lưu...' : 'Lưu chăm sóc'}
                                        </button>
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 overflow-auto p-4">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <h3 className="text-[15px] font-black text-slate-950">Lịch sử chăm sóc</h3>
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-500">
                                            {formatNumber(selectedLead.notes_timeline?.length || selectedLead.notes_count || 0)}
                                        </span>
                                    </div>

                                    {selectedLead.notes_timeline?.length ? (
                                        <div className="space-y-3">
                                            {selectedLead.notes_timeline.map((note) => (
                                                <div key={note.id} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
                                                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                                                        <span className="material-symbols-outlined text-[17px]">{activityIconMap[note.activity_type] || activityIconMap.note}</span>
                                                    </span>
                                                    <div className="min-w-0 border-b border-slate-100 pb-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <div className="text-[13px] font-black text-slate-900">{note.activity_label}</div>
                                                            <div className="text-[12px] font-semibold text-slate-400">{note.created_label}</div>
                                                        </div>
                                                        <div className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-slate-600">{note.content}</div>
                                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                                            {note.assigned_staff?.name ? (
                                                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{note.assigned_staff.name}</span>
                                                            ) : null}
                                                            {note.potential_label ? (
                                                                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{note.potential_label}</span>
                                                            ) : null}
                                                            {note.next_follow_up_label ? (
                                                                <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">Hẹn {note.next_follow_up_label}</span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-sm border border-dashed border-slate-200 p-6 text-center text-[13px] font-semibold text-slate-500">
                                            Chưa có lịch sử chăm sóc.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </aside>
                </div>
            </div>

            {importOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                    <form onSubmit={handleImportSubmit} className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-sm bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
                            <div>
                                <h2 className="text-xl font-black text-slate-950">Nhập khách telesales</h2>
                                <p className="mt-1 text-[13px] font-medium text-slate-500">Mỗi dòng là một khách, mặc định SĐT khách cũng là SĐT Zalo.</p>
                            </div>
                            <button type="button" onClick={() => setImportOpen(false)} className={iconButtonClassName} title="Đóng">
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>

                        <div className="space-y-4 p-4">
                            <div className="rounded-sm border border-slate-200">
                                <div className="grid grid-cols-[minmax(150px,1fr)_150px_150px_minmax(150px,1fr)_42px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-black text-slate-500">
                                    <span>Tên khách</span>
                                    <span>SĐT khách</span>
                                    <span>SĐT là Zalo</span>
                                    <span>SĐT Zalo</span>
                                    <span />
                                </div>

                                <div className="divide-y divide-slate-100">
                                    {importRows.map((row, index) => (
                                        <div key={row.local_id} className="grid grid-cols-1 gap-2 px-3 py-3 lg:grid-cols-[minmax(150px,1fr)_150px_150px_minmax(150px,1fr)_42px] lg:items-center">
                                            <label className="block">
                                                <span className="mb-1 block text-[12px] font-bold text-slate-500 lg:hidden">Tên khách</span>
                                                <input
                                                    value={row.customer_name}
                                                    onChange={(event) => updateImportRow(row.local_id, { customer_name: event.target.value })}
                                                    className={inputClassName}
                                                    placeholder={`Khách ${index + 1}`}
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="mb-1 block text-[12px] font-bold text-slate-500 lg:hidden">SĐT khách</span>
                                                <input
                                                    value={row.phone}
                                                    onChange={(event) => updateImportRow(row.local_id, { phone: event.target.value })}
                                                    className={inputClassName}
                                                    placeholder="09xx xxx xxx"
                                                />
                                            </label>

                                            <label className="flex h-10 items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={row.zalo_same_as_phone}
                                                    onChange={(event) => updateImportRow(row.local_id, {
                                                        zalo_same_as_phone: event.target.checked,
                                                        zalo_phone: event.target.checked ? '' : row.zalo_phone,
                                                    })}
                                                    className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                                                />
                                                Có
                                            </label>

                                            <label className="block">
                                                <span className="mb-1 block text-[12px] font-bold text-slate-500 lg:hidden">SĐT Zalo</span>
                                                <input
                                                    value={row.zalo_same_as_phone ? row.phone : row.zalo_phone}
                                                    onChange={(event) => updateImportRow(row.local_id, { zalo_phone: event.target.value })}
                                                    disabled={row.zalo_same_as_phone}
                                                    className={inputClassName}
                                                    placeholder="Nhập nếu khác SĐT khách"
                                                />
                                            </label>

                                            <button type="button" onClick={() => removeImportRow(row.local_id)} className={iconButtonClassName} title="Xóa dòng">
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t border-slate-200 p-3">
                                    <button type="button" onClick={addImportRow} className={secondaryButtonClassName}>
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                        Thêm khách
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Sale phụ trách</span>
                                    <select
                                        value={importForm.assigned_staff_id}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, assigned_staff_id: event.target.value }))}
                                        className={selectClassName}
                                    >
                                        <option value="">Chưa gán</option>
                                        {bootstrap.staffs.map((staff) => (
                                            <option key={staff.id} value={staff.id}>{staff.name}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Tiềm năng ban đầu</span>
                                    <select
                                        value={importForm.potential_level}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, potential_level: event.target.value }))}
                                        className={selectClassName}
                                    >
                                        <option value="">Chưa phân loại</option>
                                        {bootstrap.potentials.map((potential) => (
                                            <option key={potential.value} value={potential.value}>{potential.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Nguồn</span>
                                    <input
                                        value={importForm.source}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, source: event.target.value }))}
                                        className={inputClassName}
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Nhãn / chiến dịch</span>
                                    <input
                                        value={importForm.tag}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, tag: event.target.value }))}
                                        className={inputClassName}
                                    />
                                </label>

                                <div className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-3 text-[13px] font-semibold leading-6 text-teal-800 md:col-span-2">
                                    Sau khi nhập, khách sẽ tự hiện lại trong Việc hôm nay sau 3 ngày. Nếu sale chăm tiếp mà khách chưa dừng, lịch tiếp theo tự chuyển sang 7 ngày.
                                </div>

                                <label className="block md:col-span-2">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Ghi chú nhập</span>
                                    <textarea
                                        value={importForm.note}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, note: event.target.value }))}
                                        className="min-h-[82px] w-full resize-none rounded-sm border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                                        placeholder="Ví dụ: khách từ file Facebook Ads ngày hôm nay..."
                                    />
                                </label>
                            </div>

                            {importResult ? (
                                <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-[13px] font-semibold text-slate-600">
                                    Đã tạo {formatNumber(importResult.created_count)} khách, bỏ qua {formatNumber(importResult.duplicate_count)} số trùng.
                                </div>
                            ) : null}
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
                            <button type="button" onClick={() => setImportOpen(false)} className={secondaryButtonClassName}>Đóng</button>
                            <button type="submit" disabled={importing || !canSubmitImport} className={primaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                {importing ? 'Đang nhập...' : 'Nhập khách'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </div>
    );
};

export default TelesalesCrm;
