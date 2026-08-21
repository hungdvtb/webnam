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

const addDaysAtNine = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + Number(days || 0));
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
    const [errorMessage, setErrorMessage] = useState('');
    const [toast, setToast] = useState('');
    const [importOpen, setImportOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const [importForm, setImportForm] = useState({
        phones_text: '',
        source: 'telesales',
        tag: 'Telesales',
        assigned_staff_id: '',
        potential_level: '',
        follow_up_script: 'same_day',
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
        activity_type: 'call',
        note: '',
    });

    const selectedStatus = useMemo(
        () => bootstrap.statuses.find((status) => Number(status.id) === Number(careForm.lead_status_id)) || null,
        [bootstrap.statuses, careForm.lead_status_id]
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

        setCareForm((prev) => ({
            ...prev,
            assigned_staff_id: selectedLead.assigned_staff_id ? String(selectedLead.assigned_staff_id) : '',
            lead_status_id: selectedLead.lead_status_id ? String(selectedLead.lead_status_id) : '',
            potential_level: selectedLead.potential_level || '',
            follow_up_script: selectedLead.follow_up_script || prev.follow_up_script || '3_days',
            follow_up_interval_days: selectedLead.follow_up_interval_days ?? prev.follow_up_interval_days ?? 3,
            next_follow_up_at: toDateTimeLocalValue(selectedLead.next_follow_up_at) || prev.next_follow_up_at,
            do_not_call: Boolean(selectedLead.do_not_call),
            note: '',
        }));
    }, [selectedLead]);

    const handleQueueChange = (nextQueue) => {
        setQueue(nextQueue);
        setPage(1);
    };

    const handleSelectLead = (lead) => {
        setSelectedId(lead.id);
        setSelectedLead(lead);
    };

    const handleScriptChange = (scriptValue) => {
        const script = bootstrap.follow_up_scripts.find((item) => item.value === scriptValue);
        const days = script?.days;

        setCareForm((prev) => ({
            ...prev,
            follow_up_script: scriptValue,
            follow_up_interval_days: days ?? null,
            next_follow_up_at: days === null ? prev.next_follow_up_at : addDaysAtNine(days),
        }));
    };

    const handleSaveCare = async (activityType = careForm.activity_type) => {
        if (!selectedLead?.id) return;

        setSaving(true);
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.update(selectedLead.id, {
                assigned_staff_id: careForm.assigned_staff_id || null,
                lead_status_id: careForm.lead_status_id || null,
                potential_level: careForm.potential_level || null,
                follow_up_script: careForm.follow_up_script || null,
                follow_up_interval_days: careForm.follow_up_interval_days,
                next_follow_up_at: careForm.do_not_call ? null : (careForm.next_follow_up_at || null),
                do_not_call: careForm.do_not_call,
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

    const handleImportSubmit = async (event) => {
        event.preventDefault();
        setImporting(true);
        setErrorMessage('');
        setImportResult(null);

        try {
            const response = await telesalesApi.importLeads({
                ...importForm,
                assigned_staff_id: importForm.assigned_staff_id || null,
                potential_level: importForm.potential_level || null,
            });
            const result = response.data || {};
            setImportResult(result);
            setToast(`Đã nhập ${formatNumber(result.created_count)} khách, bỏ qua ${formatNumber(result.duplicate_count)} số trùng.`);
            setImportForm((prev) => ({ ...prev, phones_text: '', note: '' }));
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
        const url = buildZaloUrl(selectedLead?.phone_for_zalo || selectedLead?.phone);
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
                            Nhập SĐT
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
                                                    <span
                                                        className="inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[12px] font-semibold"
                                                        style={{
                                                            borderColor: `${lead.status_config?.color || '#64748b'}33`,
                                                            color: lead.status_config?.color || '#475569',
                                                            backgroundColor: `${lead.status_config?.color || '#64748b'}12`,
                                                        }}
                                                    >
                                                        <span className="truncate">{lead.status_config?.name || lead.status || '-'}</span>
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 align-top">{renderPotentialBadge(lead)}</td>
                                                <td className="px-4 py-3 align-top">
                                                    <div className="flex flex-col gap-1">
                                                        {renderDueBadge(lead)}
                                                        <span className="text-[12px] font-semibold text-slate-500">{lead.next_follow_up_label || '-'}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 align-top">
                                                    <div className="line-clamp-2 text-slate-600">{lead.latest_note_excerpt || 'Chưa có ghi chú'}</div>
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
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, lead_status_id: event.target.value }))}
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

                                    <div className="mt-3">
                                        <span className="mb-2 block text-[12px] font-bold text-slate-500">Kịch bản gọi lại</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {bootstrap.follow_up_scripts.map((script) => (
                                                <button
                                                    key={script.value}
                                                    type="button"
                                                    onClick={() => handleScriptChange(script.value)}
                                                    className={`h-10 rounded-sm border px-3 text-[13px] font-semibold transition ${
                                                        careForm.follow_up_script === script.value
                                                            ? 'border-teal-500 bg-teal-50 text-teal-800'
                                                            : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'
                                                    }`}
                                                >
                                                    {script.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                                        <label className="block">
                                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Ngày giờ gọi lại</span>
                                            <input
                                                type="datetime-local"
                                                value={careForm.next_follow_up_at}
                                                onChange={(event) => setCareForm((prev) => ({
                                                    ...prev,
                                                    next_follow_up_at: event.target.value,
                                                    follow_up_script: prev.follow_up_script === 'custom' ? 'custom' : prev.follow_up_script,
                                                }))}
                                                disabled={careForm.do_not_call}
                                                className={inputClassName}
                                            />
                                        </label>

                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={careForm.do_not_call}
                                                onChange={(event) => setCareForm((prev) => ({ ...prev, do_not_call: event.target.checked }))}
                                                className="size-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
                                            />
                                            Không gọi nữa
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
                    <form onSubmit={handleImportSubmit} className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-sm bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
                            <div>
                                <h2 className="text-xl font-black text-slate-950">Nhập khách telesales</h2>
                                <p className="mt-1 text-[13px] font-medium text-slate-500">Dán mỗi dòng một số, có thể kèm tên khách phía trước hoặc phía sau.</p>
                            </div>
                            <button type="button" onClick={() => setImportOpen(false)} className={iconButtonClassName} title="Đóng">
                                <span className="material-symbols-outlined text-[19px]">close</span>
                            </button>
                        </div>

                        <div className="space-y-4 p-4">
                            <label className="block">
                                <span className="mb-1 block text-[12px] font-bold text-slate-500">Danh sách số điện thoại</span>
                                <textarea
                                    value={importForm.phones_text}
                                    onChange={(event) => setImportForm((prev) => ({ ...prev, phones_text: event.target.value }))}
                                    className="min-h-[220px] w-full resize-y rounded-sm border border-slate-200 bg-white px-3 py-2 text-[13px] leading-6 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                                    placeholder={`Nguyễn Văn An - 0912 345 678\n0987 654 321 - Trần Thị Mai\n0901234567`}
                                />
                            </label>

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

                                <label className="block md:col-span-2">
                                    <span className="mb-1 block text-[12px] font-bold text-slate-500">Kịch bản sau khi nhập</span>
                                    <select
                                        value={importForm.follow_up_script}
                                        onChange={(event) => setImportForm((prev) => ({ ...prev, follow_up_script: event.target.value }))}
                                        className={selectClassName}
                                    >
                                        {bootstrap.follow_up_scripts.map((script) => (
                                            <option key={script.value} value={script.value}>{script.label}</option>
                                        ))}
                                    </select>
                                </label>

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
                            <button type="submit" disabled={importing || !importForm.phones_text.trim()} className={primaryButtonClassName}>
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
