import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { telesalesApi } from '../../services/api';

const queueTabs = [
    { value: 'all', label: 'Tất cả', icon: 'view_list', statKey: 'total' },
    { value: 'today', label: 'Việc hôm nay', icon: 'event_available', statKey: 'today_due' },
    { value: 'new_today', label: 'Khách mới', icon: 'person_add', statKey: 'new_today' },
    { value: '3_days', label: 'Gọi lại 3 ngày', icon: 'phone_callback', statKey: 'three_day_due' },
    { value: '7_days', label: 'Gọi lại 7 ngày', icon: 'event_repeat', statKey: 'seven_day_due' },
    { value: 'overdue', label: 'Quá hạn', icon: 'alarm', statKey: 'overdue' },
];

const TELESALES_RETURN_STATE_KEY = 'webnam.telesales.return_state';
const perPageOptions = [20, 50, 100];
const workStatusOptions = [
    { value: 'all', label: 'Tất cả xử lý' },
    { value: 'pending', label: 'Chưa xử lý' },
    { value: 'completed', label: 'Đã xử lý' },
];
const workStatusValues = new Set(workStatusOptions.map((option) => option.value));
const queueValues = new Set(queueTabs.map((tab) => tab.value));
const returnStateParamKeys = [
    'crm_restore',
    'return_lead_id',
    'table_scroll',
    'row_top',
    'queue',
    'page',
    'per_page',
    'search',
    'work_status',
    'staff_id',
    'status_id',
    'potential_level',
    'date_from',
    'date_to',
];

const emptyStats = {
    total: 0,
    today_due: 0,
    new_today: 0,
    three_day_due: 0,
    seven_day_due: 0,
    overdue: 0,
    high_potential: 0,
    unassigned: 0,
    conversion: {
        mode: 'day',
        date_label: '',
        total: 0,
        closed_count: 0,
        close_rate: 0,
        potential_count: 0,
        potential_rate: 0,
    },
    status_breakdown: [],
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
const iconButtonClassName = 'inline-flex size-10 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-teal-700 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50';

const activityIconMap = {
    call: 'call',
    zalo: 'chat',
    schedule: 'event',
    status: 'published_with_changes',
    import: 'upload_file',
    profile: 'manage_accounts',
    note: 'sticky_note_2',
};

const taskStatusDisplayMap = {
    new: { value: '__task_new', label: 'Số mới', color: '#2563eb' },
    '3_days': { value: '__task_3_days', label: 'Số 3 ngày trước', color: '#f97316' },
    '7_days': { value: '__task_7_days', label: 'Số 7 ngày trước', color: '#dc2626' },
};

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

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
const formatPercent = (value) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`;
const isCanceledRequest = (error) => error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
const isNotFoundRequest = (error) => Number(error?.response?.status) === 404;
const firstFilledValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');
const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePerPage = (value) => {
    const parsed = parsePositiveInteger(value, 20);
    return perPageOptions.includes(parsed) ? parsed : 20;
};

const normalizeQueue = (value) => (queueValues.has(value) ? value : 'all');
const normalizeWorkStatus = (value) => (workStatusValues.has(value) ? value : 'all');

const readStoredReturnState = () => {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;

    try {
        const rawValue = window.sessionStorage.getItem(TELESALES_RETURN_STATE_KEY);
        return rawValue ? JSON.parse(rawValue) : null;
    } catch {
        return null;
    }
};

const writeStoredReturnState = (payload) => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;

    try {
        window.sessionStorage.setItem(TELESALES_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch {
        // Browser storage can be unavailable in private mode; URL params still carry the essential state.
    }
};

const clearStoredReturnState = () => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;

    try {
        window.sessionStorage.removeItem(TELESALES_RETURN_STATE_KEY);
    } catch {
        // Ignore storage cleanup failures.
    }
};

const buildInitialViewState = (searchString = '') => {
    const params = new URLSearchParams(searchString || '');
    const storedState = readStoredReturnState();
    const returnLeadId = params.get('return_lead_id') || '';
    const shouldRestoreStoredState = params.get('crm_restore') === '1'
        && storedState
        && (!returnLeadId || String(storedState.leadId || '') === String(returnLeadId));
    const storedFilters = shouldRestoreStoredState ? storedState.filters || {} : {};

    const page = parsePositiveInteger(firstFilledValue(params.get('page'), storedFilters.page), 1);
    const perPage = normalizePerPage(firstFilledValue(params.get('per_page'), storedFilters.perPage));
    const leadId = firstFilledValue(returnLeadId, storedState?.leadId);

    const tableScrollTop = Number(firstFilledValue(params.get('table_scroll'), storedState?.tableScrollTop));
    const rowTopInContainer = Number(firstFilledValue(params.get('row_top'), storedState?.rowTopInContainer));

    return {
        queue: normalizeQueue(firstFilledValue(params.get('queue'), storedFilters.queue)),
        page,
        perPage,
        search: String(firstFilledValue(params.get('search'), storedFilters.search, '') || ''),
        workStatus: normalizeWorkStatus(firstFilledValue(params.get('work_status'), storedFilters.workStatus)),
        staffFilter: String(firstFilledValue(params.get('staff_id'), storedFilters.staffFilter, '') || ''),
        statusFilter: String(firstFilledValue(params.get('status_id'), storedFilters.statusFilter, '') || ''),
        potentialFilter: String(firstFilledValue(params.get('potential_level'), storedFilters.potentialFilter, '') || ''),
        dateFrom: String(firstFilledValue(params.get('date_from'), storedFilters.dateFrom, '') || ''),
        dateTo: String(firstFilledValue(params.get('date_to'), storedFilters.dateTo, '') || ''),
        restoreContext: params.get('crm_restore') === '1' && leadId ? {
            leadId: String(leadId),
            scrollY: Number.isFinite(Number(storedState?.scrollY)) ? Number(storedState.scrollY) : 0,
            tableScrollTop: Number.isFinite(tableScrollTop) ? tableScrollTop : 0,
            rowTopInContainer: Number.isFinite(rowTopInContainer) ? rowTopInContainer : null,
        } : null,
    };
};

const toDateInputValue = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
};

const toMonthInputValue = (value = new Date()) => toDateInputValue(value).slice(0, 7);

const getCurrentMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
        from: toDateInputValue(start),
        to: toDateInputValue(end),
    };
};

const formatDateOnlyLabel = (value) => {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(date);
};

const formatShortDateLabel = (value) => {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
    }).format(date);
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

const resolveApiMessage = (error, fallback) => {
    if (isNotFoundRequest(error)) {
        return 'Khách này không còn tồn tại hoặc không thuộc gian hàng hiện tại.';
    }

    return error?.response?.data?.message
        || error?.message
        || fallback;
};

const createImportRow = (overrides = {}) => ({
    local_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customer_name: '',
    phone: '',
    zalo_same_as_phone: true,
    zalo_phone: '',
    ...overrides,
});

const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');

const vietnamMobileCarrierByPrefix = {
    '032': 'Viettel',
    '033': 'Viettel',
    '034': 'Viettel',
    '035': 'Viettel',
    '036': 'Viettel',
    '037': 'Viettel',
    '038': 'Viettel',
    '039': 'Viettel',
    '086': 'Viettel',
    '096': 'Viettel',
    '097': 'Viettel',
    '098': 'Viettel',
    '070': 'MobiFone',
    '076': 'MobiFone',
    '077': 'MobiFone',
    '078': 'MobiFone',
    '079': 'MobiFone',
    '089': 'MobiFone',
    '090': 'MobiFone',
    '093': 'MobiFone',
    '081': 'VinaPhone',
    '082': 'VinaPhone',
    '083': 'VinaPhone',
    '084': 'VinaPhone',
    '085': 'VinaPhone',
    '088': 'VinaPhone',
    '091': 'VinaPhone',
    '094': 'VinaPhone',
    '052': 'Vietnamobile',
    '056': 'Vietnamobile',
    '058': 'Vietnamobile',
    '092': 'Vietnamobile',
    '059': 'Gmobile',
    '099': 'Gmobile',
    '087': 'iTelecom',
    '055': 'Wintel',
};

const detectVietnamMobileCarrier = (phone) => {
    const digits = normalizePhoneDigits(phone);
    if (!digits) return '';

    const localPhone = digits.startsWith('84') && digits.length >= 11
        ? `0${digits.slice(2)}`
        : digits.length === 9 && !digits.startsWith('0')
            ? `0${digits}`
            : digits;

    return vietnamMobileCarrierByPrefix[localPhone.slice(0, 3)] || '';
};

const normalizeVietnameseText = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const statusStopsFollowUp = (status) => {
    const normalized = normalizeVietnameseText(`${status?.code || ''} ${status?.name || ''}`);
    return stopFollowUpStatusPatterns.some((pattern) => normalized.includes(pattern));
};

const buildZaloUrl = (phone) => {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return '';

    const zaloPhone = digits.startsWith('0') ? `84${digits.slice(1)}` : digits;
    return `https://zalo.me/${zaloPhone}`;
};

const labelForReminder = (lead) => {
    const task = lead?.work_task || lead?.current_task;
    if (task?.label) return task.label;
    if (lead?.care_bucket_label) return lead.care_bucket_label;
    if (lead?.do_not_call || lead?.due_bucket === 'stopped') return 'Đã dừng nhắc';
    if (lead?.due_bucket === 'overdue') return 'Quá hạn';
    if (lead?.due_bucket === 'today') return 'Đến lịch';
    if (lead?.due_bucket === 'future') return 'Sắp tới';
    return 'Chưa bật nhắc';
};

const getTaskStatusDisplay = (task) => {
    if (!task || task.status !== 'pending' || !task.is_due) return null;

    return taskStatusDisplayMap[task.task_type] || null;
};

const leadMatchesWorkStatusFilter = (lead, filter) => {
    if (filter === 'all') return true;

    const task = lead?.work_task || lead?.current_task;
    if (filter === 'completed') return task?.status === 'completed';
    if (filter === 'pending') return task?.status === 'pending' && task?.is_due;

    return true;
};

const normalizeStatusDraft = (status) => ({
    id: status.id,
    code: status.code || '',
    name: status.name || '',
    color: status.color || '#64748b',
    sort_order: Number(status.sort_order || 0),
    is_default: Boolean(status.is_default),
    is_active: status.is_active !== false,
    blocks_order_create: Boolean(status.blocks_order_create),
});

const normalizePotentialDraft = (potential) => ({
    id: potential.id,
    code: potential.code || potential.value || '',
    value: potential.value || potential.code || '',
    name: potential.name || potential.label || '',
    label: potential.label || potential.name || '',
    color: potential.color || '#16a34a',
    sort_order: Number(potential.sort_order || 0),
    is_default: Boolean(potential.is_default),
    counts_as_potential: Boolean(potential.counts_as_potential),
    is_active: potential.is_active !== false,
});

const columnOptions = [
    { key: 'customer', label: 'Khách hàng' },
    { key: 'phone', label: 'SĐT / Zalo' },
    { key: 'staff', label: 'Sale phụ trách' },
    { key: 'status', label: 'Trạng thái' },
    { key: 'potential', label: 'Tiềm năng' },
    { key: 'createOrder', label: 'Tạo đơn' },
    { key: 'reminder', label: 'Việc cần xử lý' },
    { key: 'note', label: 'Ghi chú' },
];

const TelesalesCrm = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [initialViewState] = useState(() => buildInitialViewState(location.search));
    const tableScrollRef = useRef(null);
    const todayValue = useMemo(() => toDateInputValue(), []);
    const monthValue = useMemo(() => toMonthInputValue(), []);
    const initialMonthRange = useMemo(() => getCurrentMonthRange(), []);

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
    const [page, setPage] = useState(initialViewState.page);
    const [perPage, setPerPage] = useState(initialViewState.perPage);
    const [queue, setQueue] = useState(initialViewState.queue);
    const [search, setSearch] = useState(initialViewState.search);
    const [workStatus, setWorkStatus] = useState(initialViewState.workStatus);
    const [staffFilter, setStaffFilter] = useState(initialViewState.staffFilter);
    const [statusFilter, setStatusFilter] = useState(initialViewState.statusFilter);
    const [potentialFilter, setPotentialFilter] = useState(initialViewState.potentialFilter);
    const [dateFrom, setDateFrom] = useState(initialViewState.dateFrom);
    const [dateTo, setDateTo] = useState(initialViewState.dateTo);
    const [dateFilterOpen, setDateFilterOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [inlineSavingIds, setInlineSavingIds] = useState({});
    const [inlineNoteDrafts, setInlineNoteDrafts] = useState({});
    const [historyOpenIds, setHistoryOpenIds] = useState({});
    const [historyLoadingIds, setHistoryLoadingIds] = useState({});
    const [historyDetails, setHistoryDetails] = useState({});
    const [errorMessage, setErrorMessage] = useState('');
    const [toast, setToast] = useState('');
    const [pendingReturnRestore, setPendingReturnRestore] = useState(initialViewState.restoreContext);
    const [restoredLeadId, setRestoredLeadId] = useState(initialViewState.restoreContext?.leadId || null);
    const [selectedLeadIds, setSelectedLeadIds] = useState([]);
    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const [leadEditOpen, setLeadEditOpen] = useState(false);
    const [leadEditForm, setLeadEditForm] = useState({
        customer_name: '',
        phone: '',
        zalo_same_as_phone: true,
        zalo_phone: '',
    });
    const [leadEditError, setLeadEditError] = useState('');
    const [leadEditSaving, setLeadEditSaving] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);


    const [statsOpen, setStatsOpen] = useState(false);
    const [statsMode, setStatsMode] = useState('day');
    const [statsDate, setStatsDate] = useState(todayValue);
    const [statsMonth, setStatsMonth] = useState(monthValue);
    const [statsFrom, setStatsFrom] = useState(todayValue);
    const [statsTo, setStatsTo] = useState(todayValue);

    const [statusManagerOpen, setStatusManagerOpen] = useState(false);
    const [statusManagerTab, setStatusManagerTab] = useState('statuses');
    const [statusDrafts, setStatusDrafts] = useState([]);
    const [statusSavingIds, setStatusSavingIds] = useState({});
    const [potentialDrafts, setPotentialDrafts] = useState([]);
    const [potentialSavingIds, setPotentialSavingIds] = useState({});
    const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
    const [visibleColumns, setVisibleColumns] = useState(() => (
        columnOptions.reduce((result, column) => ({ ...result, [column.key]: true }), {})
    ));
    const [newStatusForm, setNewStatusForm] = useState({
        name: '',
        color: '#2563eb',
        is_default: false,
        blocks_order_create: false,
    });
    const [newPotentialForm, setNewPotentialForm] = useState({
        name: '',
        color: '#16a34a',
        is_default: false,
        counts_as_potential: true,
    });

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

    const canSubmitImport = useMemo(
        () => importRows.some((row) => row.phone.trim())
            && importRows.every((row) => !row.phone.trim() || row.zalo_same_as_phone || row.zalo_phone.trim()),
        [importRows]
    );

    const conversionStats = stats.conversion || emptyStats.conversion;
    const statusBreakdown = Array.isArray(stats.status_breakdown) ? stats.status_breakdown : [];
    const activeStatuses = useMemo(
        () => bootstrap.statuses.filter((status) => status.is_active !== false),
        [bootstrap.statuses]
    );
    const activePotentials = useMemo(
        () => bootstrap.potentials.filter((potential) => potential.is_active !== false),
        [bootstrap.potentials]
    );
    const currentStart = pagination.total > 0 ? ((pagination.current_page - 1) * pagination.per_page) + 1 : 0;
    const currentEnd = pagination.total > 0 ? Math.min(pagination.current_page * pagination.per_page, pagination.total) : 0;
    const visibleColumnCount = columnOptions.filter((column) => visibleColumns[column.key]).length;
    const tableColumnCount = visibleColumnCount + 1;
    const selectedLeadIdSet = useMemo(() => new Set(selectedLeadIds.map((id) => String(id))), [selectedLeadIds]);
    const selectedLeads = useMemo(
        () => leads.filter((lead) => selectedLeadIdSet.has(String(lead.id))),
        [leads, selectedLeadIdSet]
    );
    const allVisibleLeadsSelected = leads.length > 0 && leads.every((lead) => selectedLeadIdSet.has(String(lead.id)));
    const hasVisibleLeadSelection = leads.some((lead) => selectedLeadIdSet.has(String(lead.id)));
    const canEditSelectedLead = selectedLeadIds.length === 1 && selectedLeads.length === 1;

    const dateRangeLabel = useMemo(() => {
        if (dateFrom && dateTo) return `${formatShortDateLabel(dateFrom)} - ${formatShortDateLabel(dateTo)}`;
        if (dateFrom) return `Từ ${formatShortDateLabel(dateFrom)}`;
        if (dateTo) return `Đến ${formatShortDateLabel(dateTo)}`;
        return 'Lọc ngày';
    }, [dateFrom, dateTo]);

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

    const buildStatsParams = useCallback(() => {
        if (statsMode === 'month') {
            return {
                stats_mode: 'month',
                stats_month: statsMonth || monthValue,
            };
        }

        if (statsMode === 'custom') {
            return {
                stats_mode: 'custom',
                stats_date_from: statsFrom || todayValue,
                stats_date_to: statsTo || statsFrom || todayValue,
            };
        }

        return {
            stats_mode: 'day',
            stats_date: statsDate || todayValue,
        };
    }, [monthValue, statsDate, statsFrom, statsMode, statsMonth, statsTo, todayValue]);

    const fetchLeads = useCallback(async (nextPage = page, signal = undefined, overrides = {}) => {
        const nextPerPage = overrides.perPage ?? perPage;
        const nextQueue = overrides.queue ?? queue;
        const nextSearch = overrides.search ?? search;
        const nextWorkStatus = overrides.workStatus ?? workStatus;
        const nextStaffFilter = overrides.staffFilter ?? staffFilter;
        const nextStatusFilter = overrides.statusFilter ?? statusFilter;
        const nextPotentialFilter = overrides.potentialFilter ?? potentialFilter;
        const nextDateFrom = overrides.dateFrom ?? dateFrom;
        const nextDateTo = overrides.dateTo ?? dateTo;

        setLoading(true);
        setErrorMessage('');

        try {
            const response = await telesalesApi.getAll({
                page: nextPage,
                per_page: nextPerPage,
                queue: nextQueue,
                search: String(nextSearch || '').trim() || undefined,
                work_status: nextWorkStatus !== 'all' ? nextWorkStatus : undefined,
                staff_id: nextStaffFilter || undefined,
                status_id: nextStatusFilter || undefined,
                potential_level: nextPotentialFilter || undefined,
                date_from: nextDateFrom || undefined,
                date_to: nextDateTo || undefined,
                ...buildStatsParams(),
            }, signal);
            const data = response.data || {};

            setLeads(data.data || []);
            setStats({ ...emptyStats, ...(data.stats || {}) });
            setPagination({
                current_page: data.current_page || 1,
                last_page: data.last_page || 1,
                per_page: data.per_page || nextPerPage,
                total: data.total || 0,
            });
        } catch (error) {
            if (!isCanceledRequest(error)) {
                setErrorMessage(resolveApiMessage(error, 'Không tải được danh sách telesales.'));
            }
        } finally {
            setLoading(false);
        }
    }, [buildStatsParams, dateFrom, dateTo, page, perPage, potentialFilter, queue, search, staffFilter, statusFilter, workStatus]);

    const forgetLeadFromCurrentView = useCallback((leadId) => {
        const normalizedLeadId = String(leadId || '');
        if (!normalizedLeadId) return;

        setLeads((prev) => prev.filter((lead) => String(lead.id) !== normalizedLeadId));
        setHistoryOpenIds((prev) => {
            const next = { ...prev };
            delete next[normalizedLeadId];
            return next;
        });
        setHistoryDetails((prev) => {
            const next = { ...prev };
            delete next[normalizedLeadId];
            return next;
        });
        setHistoryLoadingIds((prev) => {
            const next = { ...prev };
            delete next[normalizedLeadId];
            return next;
        });
        setInlineNoteDrafts((prev) => {
            const next = { ...prev };
            delete next[normalizedLeadId];
            return next;
        });
        setInlineSavingIds((prev) => {
            const next = { ...prev };
            delete next[normalizedLeadId];
            return next;
        });
        setSelectedLeadIds((prev) => prev.filter((id) => String(id) !== normalizedLeadId));
        setLeadEditOpen(false);
        setLeadEditError('');
    }, []);

    const refreshLeadHistory = useCallback(async (leadId) => {
        if (!leadId) return null;

        setHistoryLoadingIds((prev) => ({ ...prev, [leadId]: true }));
        try {
            const response = await telesalesApi.getOne(leadId);
            const detail = response.data || null;
            setHistoryDetails((prev) => ({ ...prev, [leadId]: detail }));
            return detail;
        } catch (error) {
            if (isNotFoundRequest(error)) {
                forgetLeadFromCurrentView(leadId);
                setErrorMessage('');
                setToast('Khách này không còn tồn tại hoặc không thuộc gian hàng hiện tại.');
                return null;
            }

            if (!isCanceledRequest(error)) {
                setErrorMessage(resolveApiMessage(error, 'Không tải được lịch sử ghi chú.'));
            }
            return null;
        } finally {
            setHistoryLoadingIds((prev) => ({ ...prev, [leadId]: false }));
        }
    }, [forgetLeadFromCurrentView]);

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
        const visibleIds = new Set(leads.map((lead) => String(lead.id)));
        setSelectedLeadIds((prev) => {
            const next = prev.filter((id) => visibleIds.has(String(id)));
            return next.length === prev.length ? prev : next;
        });
    }, [leads]);

    useEffect(() => {
        if (!pendingReturnRestore || loading) return undefined;

        const leadId = String(pendingReturnRestore.leadId || '');
        const timeoutIds = [];
        let highlightTimeoutId = null;

        if (leadId) {
            setRestoredLeadId(leadId);
            highlightTimeoutId = window.setTimeout(() => {
                setRestoredLeadId((currentLeadId) => (String(currentLeadId || '') === leadId ? null : currentLeadId));
            }, 3500);
        }

        const applyReturnScroll = () => {
            const scrollContainer = tableScrollRef.current;
            const row = leadId
                ? scrollContainer?.querySelector(`[data-telesales-lead-row="${leadId}"]`)
                : null;

            if (Number.isFinite(Number(pendingReturnRestore.scrollY))) {
                window.scrollTo({ top: Number(pendingReturnRestore.scrollY), behavior: 'auto' });
            }

            if (!scrollContainer) return;

            if (row) {
                const rowTopInContainer = Number(pendingReturnRestore.rowTopInContainer);
                const preferredTop = Number.isFinite(rowTopInContainer) ? rowTopInContainer : Math.max(80, scrollContainer.clientHeight * 0.35);
                const containerRect = scrollContainer.getBoundingClientRect();
                const rowRect = row.getBoundingClientRect();
                scrollContainer.scrollTop += rowRect.top - containerRect.top - preferredTop;
                return;
            }

            if (Number.isFinite(Number(pendingReturnRestore.tableScrollTop))) {
                scrollContainer.scrollTop = Number(pendingReturnRestore.tableScrollTop);
            }
        };

        [0, 80, 180, 360, 720, 1200, 2000, 3000].forEach((delay) => {
            timeoutIds.push(window.setTimeout(applyReturnScroll, delay));
        });

        timeoutIds.push(window.setTimeout(() => {
            clearStoredReturnState();
            setPendingReturnRestore(null);

            const params = new URLSearchParams(location.search || '');
            if (returnStateParamKeys.some((key) => params.has(key))) {
                returnStateParamKeys.forEach((key) => params.delete(key));
                const nextSearch = params.toString();
                window.history.replaceState(
                    window.history.state,
                    '',
                    `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash || ''}`
                );
            }
        }, 3400));

        return () => {
            timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
            if (highlightTimeoutId) {
                window.clearTimeout(highlightTimeoutId);
            }
        };
    }, [leads, loading, location.hash, location.pathname, location.search, pendingReturnRestore]);

    useEffect(() => {
        if (statusManagerOpen) {
            setStatusDrafts(bootstrap.statuses.map(normalizeStatusDraft));
            setPotentialDrafts(bootstrap.potentials.map(normalizePotentialDraft));
        }
    }, [bootstrap.potentials, bootstrap.statuses, statusManagerOpen]);

    useEffect(() => {
        if (statusFilter && activeStatuses.length > 0 && !activeStatuses.some((status) => String(status.id) === String(statusFilter))) {
            setStatusFilter('');
            setPage(1);
        }

        if (potentialFilter && activePotentials.length > 0 && !activePotentials.some((potential) => potential.value === potentialFilter)) {
            setPotentialFilter('');
            setPage(1);
        }
    }, [activePotentials, activeStatuses, potentialFilter, statusFilter]);

    const setInlineSaving = (leadId, isSaving) => {
        setInlineSavingIds((prev) => ({
            ...prev,
            [leadId]: isSaving,
        }));
    };

    const handleQueueChange = (nextQueue) => {
        setQueue(nextQueue);
        setPage(1);
    };

    const toggleSelectLead = useCallback((leadId, checked) => {
        const normalizedLeadId = String(leadId || '');
        if (!normalizedLeadId) return;

        setSelectedLeadIds((prev) => {
            const exists = prev.some((id) => String(id) === normalizedLeadId);
            if (checked) return exists ? prev : [...prev, normalizedLeadId];
            return prev.filter((id) => String(id) !== normalizedLeadId);
        });
    }, []);

    const toggleSelectAllLeads = useCallback(() => {
        if (leads.length === 0) return;

        setSelectedLeadIds(allVisibleLeadsSelected
            ? []
            : leads.map((lead) => String(lead.id))
        );
    }, [allVisibleLeadsSelected, leads]);

    const openEditSelectedLead = () => {
        const lead = selectedLeads[0];
        setActionMenuOpen(false);

        if (!canEditSelectedLead || !lead) {
            setErrorMessage('Tích chọn đúng 1 khách để sửa thông tin.');
            return;
        }

        const zaloSameAsPhone = normalizePhoneDigits(lead.zalo_phone || lead.phone) === normalizePhoneDigits(lead.phone);
        setLeadEditForm({
            customer_name: lead.customer_name || '',
            phone: lead.phone || '',
            zalo_same_as_phone: zaloSameAsPhone,
            zalo_phone: lead.zalo_phone || lead.phone || '',
        });
        setLeadEditError('');
        setErrorMessage('');
        setToast('');
        setLeadEditOpen(true);
    };

    const closeLeadEdit = () => {
        if (leadEditSaving) return;
        setLeadEditOpen(false);
        setLeadEditError('');
    };

    const handleLeadEditSameAsPhoneChange = (checked) => {
        setLeadEditForm((prev) => ({
            ...prev,
            zalo_same_as_phone: checked,
            zalo_phone: checked ? prev.phone : prev.zalo_phone,
        }));
    };

    const handleLeadEditSubmit = async (event) => {
        event.preventDefault();

        const lead = selectedLeads[0];
        if (!canEditSelectedLead || !lead) {
            setLeadEditError('Tích chọn đúng 1 khách để sửa thông tin.');
            return;
        }

        const customerName = leadEditForm.customer_name.trim();
        const phone = leadEditForm.phone.trim();
        const zaloPhone = leadEditForm.zalo_same_as_phone ? phone : leadEditForm.zalo_phone.trim();

        if (!phone) {
            setLeadEditError('Nhập SĐT khách trước khi lưu.');
            return;
        }

        if (!leadEditForm.zalo_same_as_phone && !zaloPhone) {
            setLeadEditError('Nhập SĐT Zalo hoặc tích SĐT là Zalo.');
            return;
        }

        setLeadEditSaving(true);
        setLeadEditError('');
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.update(lead.id, {
                customer_name: customerName || null,
                phone,
                zalo_phone: zaloPhone,
                activity_type: 'profile',
            });
            const nextLead = response.data?.lead;

            if (nextLead) {
                setLeads((prev) => prev.map((item) => Number(item.id) === Number(nextLead.id) ? nextLead : item));
                setSelectedLeadIds([String(nextLead.id)]);
            }

            setStats((prev) => ({ ...emptyStats, ...(response.data?.stats || prev) }));
            setLeadEditOpen(false);
            setToast('Đã cập nhật thông tin khách.');

            if (historyOpenIds[lead.id]) {
                await refreshLeadHistory(lead.id);
            }

            await fetchLeads(page);
        } catch (error) {
            if (isNotFoundRequest(error)) {
                forgetLeadFromCurrentView(lead.id);
                setToast('Khách này không còn tồn tại hoặc không thuộc gian hàng hiện tại.');
                return;
            }

            setLeadEditError(resolveApiMessage(error, 'Không lưu được thông tin khách.'));
        } finally {
            setLeadEditSaving(false);
        }
    };

    const handleDeleteSelectedLeads = async () => {
        const targetIds = selectedLeadIds.map((id) => String(id)).filter(Boolean);
        if (targetIds.length === 0) return;

        const firstLead = selectedLeads[0];
        const targetLabel = targetIds.length === 1
            ? (firstLead?.customer_name || firstLead?.phone || 'khách này')
            : `${formatNumber(targetIds.length)} khách đã chọn`;

        setActionMenuOpen(false);
        if (!window.confirm(`Xóa ${targetLabel} khỏi CRM telesales?`)) return;

        setBulkDeleting(true);
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.bulkDelete(targetIds);
            const deletedCount = Number(response.data?.count ?? targetIds.length) || targetIds.length;
            setStats((prev) => ({ ...emptyStats, ...(response.data?.stats || prev) }));
            setSelectedLeadIds([]);
            await fetchLeads(page);
            setToast(`Đã xóa ${formatNumber(deletedCount)} khách khỏi CRM.`);
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không xóa được khách đã chọn.'));
        } finally {
            setBulkDeleting(false);
        }
    };

    const handleInlineLeadUpdate = async (lead, payload, options = 'Đã cập nhật khách.') => {
        if (!lead?.id) return null;

        const updateOptions = typeof options === 'string'
            ? { successMessage: options }
            : (options || {});
        const {
            successMessage = 'Đã cập nhật khách.',
            silent = false,
            refreshList = true,
        } = updateOptions;

        setInlineSaving(lead.id, true);
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.update(lead.id, payload);
            const nextLead = response.data?.lead;

            if (nextLead) {
                setLeads((prev) => prev.map((item) => Number(item.id) === Number(nextLead.id) ? nextLead : item));
            }

            setStats((prev) => ({ ...emptyStats, ...(response.data?.stats || prev) }));
            if (!silent && successMessage) {
                setToast(successMessage);
            }

            if (historyOpenIds[lead.id]) {
                await refreshLeadHistory(lead.id);
            }
            if (refreshList) {
                await fetchLeads(page);
            }
            return nextLead || null;
        } catch (error) {
            if (isNotFoundRequest(error)) {
                forgetLeadFromCurrentView(lead.id);
                setToast('Khách này không còn tồn tại hoặc không thuộc gian hàng hiện tại.');
                return null;
            }

            setErrorMessage(resolveApiMessage(error, 'Không lưu được cập nhật trực tiếp.'));
            return null;
        } finally {
            setInlineSaving(lead.id, false);
        }
    };

    const handleInlineStaffChange = (lead, nextStaffId) => {
        if (String(lead.assigned_staff_id || '') === String(nextStaffId || '')) return;

        handleInlineLeadUpdate(lead, {
            assigned_staff_id: nextStaffId || null,
            activity_type: 'note',
        }, 'Đã cập nhật sale phụ trách.');
    };

    const handleInlineStatusChange = async (lead, nextStatusId) => {
        if (String(nextStatusId || '').startsWith('__task_')) return;

        const nextStatus = bootstrap.statuses.find((status) => Number(status.id) === Number(nextStatusId)) || null;
        const shouldStopFollowUp = statusStopsFollowUp(nextStatus);

        const nextLead = await handleInlineLeadUpdate(lead, {
            lead_status_id: nextStatusId || null,
            do_not_call: shouldStopFollowUp,
            activity_type: 'status',
        }, {
            silent: true,
            refreshList: false,
        });

        if (nextLead && !leadMatchesWorkStatusFilter(nextLead, workStatus)) {
            forgetLeadFromCurrentView(nextLead.id);
        }
    };

    const handleInlinePotentialChange = (lead, nextPotential) => {
        if ((lead.potential_level || '') === nextPotential) return;

        handleInlineLeadUpdate(lead, {
            potential_level: nextPotential || null,
            activity_type: 'note',
        }, 'Đã cập nhật mức tiềm năng.');
    };

    const handleToggleDoNotCall = (lead, checked) => {
        handleInlineLeadUpdate(lead, {
            do_not_call: checked,
            activity_type: 'schedule',
        }, checked ? 'Đã dừng nhắc lại cho khách.' : 'Đã bật lại nhắc tự động.');
    };

    const handleZaloSameAsPhoneChange = (lead, checked) => {
        handleInlineLeadUpdate(lead, {
            zalo_phone: checked ? lead.phone : null,
            activity_type: 'note',
        }, checked ? 'Đã đặt SĐT khách là Zalo.' : 'Đã bỏ đánh dấu SĐT là Zalo.');
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

    const deleteHistoryNote = async (lead, note) => {
        if (!lead?.id || !note?.id) return;
        setInlineSaving(lead.id, true);
        setErrorMessage('');
        setToast('');

        try {
            const response = await telesalesApi.deleteNote(lead.id, note.id);
            const nextLead = response.data?.lead;

            if (nextLead) {
                setLeads((prev) => prev.map((item) => Number(item.id) === Number(nextLead.id) ? nextLead : item));
                setInlineNoteDrafts((prev) => ({
                    ...prev,
                    [lead.id]: nextLead.latest_note_content || nextLead.latest_note_excerpt || '',
                }));
            }

            setStats((prev) => ({ ...emptyStats, ...(response.data?.stats || prev) }));
            setToast('Đã xóa ghi chú.');

            if (historyOpenIds[lead.id]) {
                await refreshLeadHistory(lead.id);
            }

            await fetchLeads(page);
        } catch (error) {
            if (isNotFoundRequest(error)) {
                forgetLeadFromCurrentView(lead.id);
                setToast('Khách này không còn tồn tại hoặc không thuộc gian hàng hiện tại.');
                return;
            }

            setErrorMessage(resolveApiMessage(error, 'Không xóa được ghi chú.'));
        } finally {
            setInlineSaving(lead.id, false);
        }
    };

    const toggleHistory = async (lead) => {
        const isOpen = Boolean(historyOpenIds[lead.id]);
        setHistoryOpenIds((prev) => ({ ...prev, [lead.id]: !isOpen }));

        if (!isOpen && !historyDetails[lead.id]) {
            await refreshLeadHistory(lead.id);
        }
    };

    const openCreateOrder = (lead) => {
        if (!lead?.id) return;

        if (lead.status_config?.blocks_order_create) {
            setErrorMessage('Trạng thái hiện tại của khách đang chặn thao tác tạo đơn.');
            return;
        }

        const filters = {
            queue,
            page,
            perPage,
            search,
            workStatus,
            staffFilter,
            statusFilter,
            potentialFilter,
            dateFrom,
            dateTo,
        };
        const params = new URLSearchParams();
        const scrollContainer = tableScrollRef.current;
        const activeRow = scrollContainer?.querySelector(`[data-telesales-lead-row="${lead.id}"]`);
        const containerRect = scrollContainer?.getBoundingClientRect?.();
        const rowRect = activeRow?.getBoundingClientRect?.();
        const tableScrollTop = scrollContainer?.scrollTop || 0;
        const rowTopInContainer = rowRect && containerRect ? rowRect.top - containerRect.top : null;

        params.set('crm_restore', '1');
        params.set('return_lead_id', String(lead.id));
        params.set('queue', filters.queue);
        params.set('page', String(filters.page));
        params.set('per_page', String(filters.perPage));
        params.set('table_scroll', String(Math.round(tableScrollTop)));

        if (filters.search.trim()) params.set('search', filters.search.trim());
        if (filters.workStatus && filters.workStatus !== 'all') params.set('work_status', filters.workStatus);
        if (filters.staffFilter) params.set('staff_id', filters.staffFilter);
        if (filters.statusFilter) params.set('status_id', filters.statusFilter);
        if (filters.potentialFilter) params.set('potential_level', filters.potentialFilter);
        if (filters.dateFrom) params.set('date_from', filters.dateFrom);
        if (filters.dateTo) params.set('date_to', filters.dateTo);
        if (Number.isFinite(rowTopInContainer)) params.set('row_top', String(Math.round(rowTopInContainer)));

        const returnUrl = `${location.pathname || '/admin/telesales'}?${params.toString()}#telesales-lead-${lead.id}`;
        writeStoredReturnState({
            leadId: String(lead.id),
            filters,
            scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
            tableScrollTop,
            rowTopInContainer,
            createdAt: new Date().toISOString(),
        });

        const returnTo = encodeURIComponent(returnUrl);
        navigate(`/admin/orders/new?lead_id=${lead.id}&return_to=${returnTo}`);
    };

    const handleOpenPhone = (lead) => {
        if (!lead?.phone) return;
        window.location.href = `tel:${lead.phone}`;
    };

    const handleOpenZalo = (lead) => {
        const url = buildZaloUrl(lead?.zalo_phone_for_zalo || lead?.phone_for_zalo || lead?.zalo_phone || lead?.phone);
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
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

    const focusCustomerInTable = useCallback(async (rawSearch, shouldCloseImport = false) => {
        const nextSearch = String(rawSearch || '').trim();
        const filterReset = {
            queue: 'all',
            search: nextSearch,
            workStatus: 'all',
            staffFilter: '',
            statusFilter: '',
            potentialFilter: '',
            dateFrom: '',
            dateTo: '',
        };

        setQueue(filterReset.queue);
        setSearch(filterReset.search);
        setWorkStatus(filterReset.workStatus);
        setStaffFilter(filterReset.staffFilter);
        setStatusFilter(filterReset.statusFilter);
        setPotentialFilter(filterReset.potentialFilter);
        setDateFrom(filterReset.dateFrom);
        setDateTo(filterReset.dateTo);
        setPage(1);

        if (shouldCloseImport) {
            setImportOpen(false);
        }

        await fetchLeads(1, undefined, filterReset);
    }, [fetchLeads]);

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
            const createdItems = Array.isArray(result.created) ? result.created : [];
            const duplicateItems = Array.isArray(result.duplicates) ? result.duplicates : [];
            const createdCount = Number(result.created_count || 0);
            const duplicateCount = Number(result.duplicate_count || 0);
            const focusPhone = createdItems[0]?.phone
                || duplicateItems[0]?.normalized_phone
                || duplicateItems[0]?.lead?.phone
                || duplicateItems[0]?.phone
                || importPayloadRows[0]?.phone
                || '';

            setImportResult(result);
            setToast(createdCount > 0
                ? `Đã nhập ${formatNumber(createdCount)} khách, bỏ qua ${formatNumber(duplicateCount)} số trùng.`
                : `Số này đã tồn tại, đã lọc bảng theo ${focusPhone || 'số trùng'} để bạn kiểm tra.`
            );

            if (createdCount > 0) {
                setImportRows([createImportRow()]);
                setImportForm((prev) => ({ ...prev, note: '' }));
                await focusCustomerInTable('', true);
            } else {
                await focusCustomerInTable(focusPhone);
            }
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không nhập được danh sách số điện thoại.'));
        } finally {
            setImporting(false);
        }
    };

    const updateStatusDraft = (statusId, updates) => {
        setStatusDrafts((prev) => prev.map((status) => {
            if (Number(status.id) === Number(statusId)) {
                return { ...status, ...updates };
            }

            if (updates.is_default) {
                return { ...status, is_default: false };
            }

            return status;
        }));
    };

    const setStatusSaving = (statusId, isSaving) => {
        setStatusSavingIds((prev) => ({ ...prev, [statusId]: isSaving }));
    };

    const createStatus = async () => {
        if (!newStatusForm.name.trim()) {
            setErrorMessage('Tên trạng thái không được để trống.');
            return;
        }

        setStatusSaving('new', true);
        setErrorMessage('');
        setToast('');

        try {
            await telesalesApi.createStatus({
                name: newStatusForm.name.trim(),
                color: newStatusForm.color || '#2563eb',
                is_default: newStatusForm.is_default,
                is_active: true,
                blocks_order_create: newStatusForm.blocks_order_create,
            });
            setNewStatusForm({
                name: '',
                color: '#2563eb',
                is_default: false,
                blocks_order_create: false,
            });
            await fetchBootstrap();
            await fetchLeads(page);
            setToast('Đã thêm trạng thái mới.');
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không thêm được trạng thái.'));
        } finally {
            setStatusSaving('new', false);
        }
    };

    const deleteStatus = async (status) => {
        if (!window.confirm(`Xóa trạng thái "${status.name}"?`)) return;

        setStatusSaving(status.id, true);
        setErrorMessage('');
        setToast('');

        try {
            await telesalesApi.deleteStatus(status.id);
            await fetchBootstrap();
            await fetchLeads(page);
            setToast('Đã xóa trạng thái.');
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không xóa được trạng thái. Trạng thái đang có khách sử dụng sẽ không xóa được.'));
        } finally {
            setStatusSaving(status.id, false);
        }
    };

    const updatePotentialDraft = (potentialId, updates) => {
        setPotentialDrafts((prev) => prev.map((potential) => {
            if (Number(potential.id) === Number(potentialId)) {
                return { ...potential, ...updates };
            }

            if (updates.is_default) {
                return { ...potential, is_default: false };
            }

            return potential;
        }));
    };

    const setPotentialSaving = (potentialId, isSaving) => {
        setPotentialSavingIds((prev) => ({ ...prev, [potentialId]: isSaving }));
    };

    const saveConfigurationDrafts = async () => {
        const blankStatus = statusDrafts.find((status) => !status.name?.trim());
        if (blankStatus) {
            setErrorMessage('Tên trạng thái không được để trống.');
            setStatusManagerTab('statuses');
            return;
        }

        const blankPotential = potentialDrafts.find((potential) => !potential.name?.trim());
        if (blankPotential) {
            setErrorMessage('Tên mức tiềm năng không được để trống.');
            setStatusManagerTab('potentials');
            return;
        }

        setStatusSaving('bulk', true);
        setPotentialSaving('bulk', true);
        setErrorMessage('');
        setToast('');

        try {
            await Promise.all([
                ...statusDrafts.map((status) => telesalesApi.updateStatus(status.id, {
                    name: status.name.trim(),
                    code: status.code,
                    color: status.color || '#64748b',
                    sort_order: status.sort_order,
                    is_default: status.is_default,
                    is_active: status.is_active,
                    blocks_order_create: status.blocks_order_create,
                })),
                ...potentialDrafts.map((potential) => telesalesApi.updatePotential(potential.id, {
                    name: potential.name.trim(),
                    color: potential.color || '#16a34a',
                    sort_order: potential.sort_order,
                    is_default: potential.is_default,
                    counts_as_potential: potential.counts_as_potential,
                    is_active: potential.is_active,
                })),
            ]);

            await fetchBootstrap();
            await fetchLeads(page);
            setToast('Đã lưu cấu hình telesales.');
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không lưu được cấu hình telesales.'));
        } finally {
            setStatusSaving('bulk', false);
            setPotentialSaving('bulk', false);
        }
    };

    const createPotential = async () => {
        if (!newPotentialForm.name.trim()) {
            setErrorMessage('Tên mức tiềm năng không được để trống.');
            return;
        }

        setPotentialSaving('new', true);
        setErrorMessage('');
        setToast('');

        try {
            await telesalesApi.createPotential({
                name: newPotentialForm.name.trim(),
                color: newPotentialForm.color || '#16a34a',
                is_default: newPotentialForm.is_default,
                counts_as_potential: newPotentialForm.counts_as_potential,
                is_active: true,
            });
            setNewPotentialForm({
                name: '',
                color: '#16a34a',
                is_default: false,
                counts_as_potential: true,
            });
            await fetchBootstrap();
            await fetchLeads(page);
            setToast('Đã thêm mức tiềm năng mới.');
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không thêm được mức tiềm năng.'));
        } finally {
            setPotentialSaving('new', false);
        }
    };

    const deletePotential = async (potential) => {
        if (!window.confirm(`Xóa mức tiềm năng "${potential.name}"?`)) return;

        setPotentialSaving(potential.id, true);
        setErrorMessage('');
        setToast('');

        try {
            await telesalesApi.deletePotential(potential.id);
            await fetchBootstrap();
            await fetchLeads(page);
            setToast('Đã xóa mức tiềm năng.');
        } catch (error) {
            setErrorMessage(resolveApiMessage(error, 'Không xóa được mức tiềm năng. Mức đang có khách hoặc lịch sử ghi chú sử dụng sẽ không xóa được.'));
        } finally {
            setPotentialSaving(potential.id, false);
        }
    };

    const renderStatusManager = () => {
        if (!statusManagerOpen) return null;
        const isStatusTab = statusManagerTab === 'statuses';
        const configurationSaving = Boolean(statusSavingIds.bulk || potentialSavingIds.bulk);
        const tabClassName = (active) => `inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-4 text-[13px] font-black transition ${active ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'}`;

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-sm bg-white shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
                        <div>
                            <h2 className="text-xl font-black text-slate-950">Cấu hình telesales</h2>
                            <p className="mt-1 text-[13px] font-medium text-slate-500">Thêm, sửa, xóa và chọn màu cho trạng thái hoặc mức tiềm năng.</p>
                        </div>
                        <button type="button" onClick={() => setStatusManagerOpen(false)} className={iconButtonClassName} title="Đóng">
                            <span className="material-symbols-outlined text-[19px]">close</span>
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setStatusManagerTab('statuses')} className={tabClassName(isStatusTab)}>
                                <span className="material-symbols-outlined text-[18px]">settings</span>
                                Trạng thái
                            </button>
                            <button type="button" onClick={() => setStatusManagerTab('potentials')} className={tabClassName(!isStatusTab)}>
                                <span className="material-symbols-outlined text-[18px]">trending_up</span>
                                Tiềm năng
                            </button>
                        </div>
                        <button type="button" onClick={saveConfigurationDrafts} disabled={configurationSaving} className={primaryButtonClassName}>
                            <span className="material-symbols-outlined text-[18px]">save</span>
                            {configurationSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                        </button>
                    </div>

                    <div className="space-y-4 p-4">
                        {isStatusTab ? (
                            <>
                                <div className="overflow-hidden rounded-sm border border-slate-200">
                                    <div className="grid min-w-[860px] grid-cols-[70px_minmax(180px,1fr)_120px_100px_100px_120px_120px] border-b border-slate-200 bg-slate-50 text-[12px] font-black text-slate-500">
                                        <div className="border-r border-slate-200 px-3 py-2">Màu</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Tên trạng thái</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Mã</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Mặc định</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Đang dùng</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Chặn tạo đơn</div>
                                        <div className="px-3 py-2">Xóa</div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        {statusDrafts.map((status) => {
                                            const savingStatus = Boolean(statusSavingIds[status.id] || configurationSaving);

                                            return (
                                                <div key={status.id} className="grid min-w-[860px] grid-cols-[70px_minmax(180px,1fr)_120px_100px_100px_120px_120px] border-b border-slate-200 text-[13px] last:border-b-0">
                                                    <div className="flex items-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="color"
                                                            value={status.color || '#64748b'}
                                                            onChange={(event) => updateStatusDraft(status.id, { color: event.target.value })}
                                                            className="h-8 w-10 rounded-sm border border-slate-200 bg-white"
                                                            title="Chọn màu"
                                                        />
                                                    </div>
                                                    <div className="border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            value={status.name}
                                                            onChange={(event) => updateStatusDraft(status.id, { name: event.target.value })}
                                                            className={inlineInputClassName}
                                                        />
                                                    </div>
                                                    <div className="flex items-center border-r border-slate-200 px-3 py-2 font-mono text-[12px] text-slate-500">{status.code}</div>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={status.is_default}
                                                            onChange={(event) => updateStatusDraft(status.id, { is_default: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={status.is_active}
                                                            onChange={(event) => updateStatusDraft(status.id, { is_active: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={status.blocks_order_create}
                                                            onChange={(event) => updateStatusDraft(status.id, { blocks_order_create: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <div className="flex items-center gap-2 px-3 py-2">
                                                        <button type="button" onClick={() => deleteStatus(status)} disabled={savingStatus} className="inline-flex size-8 items-center justify-center rounded-sm border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:cursor-wait disabled:opacity-50" title="Xóa">
                                                            <span className="material-symbols-outlined text-[17px]">delete</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-sm border border-teal-200 bg-teal-50 p-3">
                                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(160px,1fr)_90px_120px_130px_120px] lg:items-center">
                                        <input
                                            value={newStatusForm.name}
                                            onChange={(event) => setNewStatusForm((prev) => ({ ...prev, name: event.target.value }))}
                                            className={inputClassName}
                                            placeholder="Tên trạng thái mới"
                                        />
                                        <input
                                            type="color"
                                            value={newStatusForm.color}
                                            onChange={(event) => setNewStatusForm((prev) => ({ ...prev, color: event.target.value }))}
                                            className="h-10 w-full rounded-sm border border-slate-200 bg-white p-1"
                                            title="Màu trạng thái"
                                        />
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-teal-200 bg-white px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={newStatusForm.is_default}
                                                onChange={(event) => setNewStatusForm((prev) => ({ ...prev, is_default: event.target.checked }))}
                                                className="size-4 accent-teal-700"
                                            />
                                            Mặc định
                                        </label>
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-teal-200 bg-white px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={newStatusForm.blocks_order_create}
                                                onChange={(event) => setNewStatusForm((prev) => ({ ...prev, blocks_order_create: event.target.checked }))}
                                                className="size-4 accent-teal-700"
                                            />
                                            Chặn tạo đơn
                                        </label>
                                        <button type="button" onClick={createStatus} disabled={Boolean(statusSavingIds.new)} className={primaryButtonClassName}>
                                            <span className="material-symbols-outlined text-[18px]">add</span>
                                            Thêm
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="overflow-hidden rounded-sm border border-slate-200">
                                    <div className="grid min-w-[860px] grid-cols-[70px_minmax(180px,1fr)_120px_100px_100px_140px_120px] border-b border-slate-200 bg-slate-50 text-[12px] font-black text-slate-500">
                                        <div className="border-r border-slate-200 px-3 py-2">Màu</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Tên tiềm năng</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Mã</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Mặc định</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Đang dùng</div>
                                        <div className="border-r border-slate-200 px-3 py-2">Tính % tiềm năng</div>
                                        <div className="px-3 py-2">Xóa</div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        {potentialDrafts.map((potential) => {
                                            const savingPotential = Boolean(potentialSavingIds[potential.id] || configurationSaving);

                                            return (
                                                <div key={potential.id} className="grid min-w-[860px] grid-cols-[70px_minmax(180px,1fr)_120px_100px_100px_140px_120px] border-b border-slate-200 text-[13px] last:border-b-0">
                                                    <div className="flex items-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="color"
                                                            value={potential.color || '#16a34a'}
                                                            onChange={(event) => updatePotentialDraft(potential.id, { color: event.target.value })}
                                                            className="h-8 w-10 rounded-sm border border-slate-200 bg-white"
                                                            title="Chọn màu"
                                                        />
                                                    </div>
                                                    <div className="border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            value={potential.name}
                                                            onChange={(event) => updatePotentialDraft(potential.id, { name: event.target.value })}
                                                            className={inlineInputClassName}
                                                        />
                                                    </div>
                                                    <div className="flex items-center border-r border-slate-200 px-3 py-2 font-mono text-[12px] text-slate-500">{potential.code}</div>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={potential.is_default}
                                                            onChange={(event) => updatePotentialDraft(potential.id, { is_default: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={potential.is_active}
                                                            onChange={(event) => updatePotentialDraft(potential.id, { is_active: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <label className="flex items-center justify-center border-r border-slate-200 px-3 py-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={potential.counts_as_potential}
                                                            onChange={(event) => updatePotentialDraft(potential.id, { counts_as_potential: event.target.checked })}
                                                            className="size-4 accent-teal-700"
                                                        />
                                                    </label>
                                                    <div className="flex items-center gap-2 px-3 py-2">
                                                        <button type="button" onClick={() => deletePotential(potential)} disabled={savingPotential} className="inline-flex size-8 items-center justify-center rounded-sm border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:cursor-wait disabled:opacity-50" title="Xóa">
                                                            <span className="material-symbols-outlined text-[17px]">delete</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-sm border border-teal-200 bg-teal-50 p-3">
                                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(160px,1fr)_90px_120px_150px_120px] lg:items-center">
                                        <input
                                            value={newPotentialForm.name}
                                            onChange={(event) => setNewPotentialForm((prev) => ({ ...prev, name: event.target.value }))}
                                            className={inputClassName}
                                            placeholder="Tên mức tiềm năng mới"
                                        />
                                        <input
                                            type="color"
                                            value={newPotentialForm.color}
                                            onChange={(event) => setNewPotentialForm((prev) => ({ ...prev, color: event.target.value }))}
                                            className="h-10 w-full rounded-sm border border-slate-200 bg-white p-1"
                                            title="Màu tiềm năng"
                                        />
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-teal-200 bg-white px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={newPotentialForm.is_default}
                                                onChange={(event) => setNewPotentialForm((prev) => ({ ...prev, is_default: event.target.checked }))}
                                                className="size-4 accent-teal-700"
                                            />
                                            Mặc định
                                        </label>
                                        <label className="flex h-10 items-center gap-2 rounded-sm border border-teal-200 bg-white px-3 text-[13px] font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={newPotentialForm.counts_as_potential}
                                                onChange={(event) => setNewPotentialForm((prev) => ({ ...prev, counts_as_potential: event.target.checked }))}
                                                className="size-4 accent-teal-700"
                                            />
                                            Tính % tiềm năng
                                        </label>
                                        <button type="button" onClick={createPotential} disabled={Boolean(potentialSavingIds.new)} className={primaryButtonClassName}>
                                            <span className="material-symbols-outlined text-[18px]">add</span>
                                            Thêm
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const renderStatsPanel = () => {
        if (!statsOpen) return null;

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                <div className="w-full max-w-4xl rounded-sm bg-white shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
                        <div>
                            <h2 className="text-xl font-black text-slate-950">Thống kê telesales</h2>
                            <p className="mt-1 text-[13px] font-medium text-slate-500">Tỉ lệ chốt, khách tiềm năng và cơ cấu trạng thái theo khoảng thời gian.</p>
                        </div>
                        <button type="button" onClick={() => setStatsOpen(false)} className={iconButtonClassName} title="Đóng">
                            <span className="material-symbols-outlined text-[19px]">close</span>
                        </button>
                    </div>

                    <div className="space-y-4 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                            <div className="inline-grid overflow-hidden rounded-sm border border-slate-200 bg-white sm:grid-cols-3">
                                {[
                                    ['day', 'Theo ngày'],
                                    ['month', 'Theo tháng'],
                                    ['custom', 'Tùy chọn'],
                                ].map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setStatsMode(value)}
                                        className={`h-10 px-4 text-[13px] font-bold transition ${statsMode === value ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {statsMode === 'day' ? (
                                <input type="date" value={statsDate} onChange={(event) => setStatsDate(event.target.value)} className={`${inputClassName} lg:w-[180px]`} />
                            ) : null}

                            {statsMode === 'month' ? (
                                <input type="month" value={statsMonth} onChange={(event) => setStatsMonth(event.target.value)} className={`${inputClassName} lg:w-[180px]`} />
                            ) : null}

                            {statsMode === 'custom' ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_180px]">
                                    <input type="date" value={statsFrom} onChange={(event) => setStatsFrom(event.target.value)} className={inputClassName} />
                                    <input type="date" value={statsTo} onChange={(event) => setStatsTo(event.target.value)} className={inputClassName} />
                                </div>
                            ) : null}

                            <button type="button" onClick={() => fetchLeads(page)} className={secondaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">sync</span>
                                Cập nhật
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-sm border border-slate-200 bg-slate-50 p-4">
                                <div className="text-[12px] font-black uppercase text-slate-500">Tổng khách</div>
                                <div className="mt-2 text-3xl font-black text-slate-950">{formatNumber(conversionStats.total)}</div>
                                <div className="mt-1 text-[12px] font-semibold text-slate-500">{conversionStats.date_label || 'Khoảng đang chọn'}</div>
                            </div>
                            <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-4">
                                <div className="text-[12px] font-black uppercase text-emerald-700">Tỉ lệ chốt</div>
                                <div className="mt-2 text-3xl font-black text-emerald-800">{formatPercent(conversionStats.close_rate)}</div>
                                <div className="mt-1 text-[12px] font-semibold text-emerald-700">{formatNumber(conversionStats.closed_count)} khách đã chốt</div>
                            </div>
                            <div className="rounded-sm border border-violet-200 bg-violet-50 p-4">
                                <div className="text-[12px] font-black uppercase text-violet-700">Khách tiềm năng</div>
                                <div className="mt-2 text-3xl font-black text-violet-800">{formatPercent(conversionStats.potential_rate)}</div>
                                <div className="mt-1 text-[12px] font-semibold text-violet-700">{formatNumber(conversionStats.potential_count)} khách tiềm năng</div>
                            </div>
                        </div>

                        <div className="rounded-sm border border-slate-200 p-4">
                            <div className="mb-3 text-[14px] font-black text-slate-950">Theo trạng thái</div>
                            {statusBreakdown.length ? (
                                <div className="space-y-3">
                                    {statusBreakdown.map((item) => (
                                        <div key={item.id || 'none'} className="grid grid-cols-[150px_minmax(0,1fr)_86px] items-center gap-3 text-[13px]">
                                            <div className="flex min-w-0 items-center gap-2 font-bold text-slate-700">
                                                <span className="size-3 rounded-full" style={{ backgroundColor: item.color || '#94a3b8' }} />
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Number(item.rate) || 0)}%`, backgroundColor: item.color || '#94a3b8' }} />
                                            </div>
                                            <div className="text-right font-black text-slate-700">{formatNumber(item.count)} / {formatPercent(item.rate)}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-[13px] font-semibold text-slate-500">Chưa có dữ liệu thống kê trong khoảng này.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderImportModal = () => {
        if (!importOpen) return null;

        return (
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
                                    {activePotentials.map((potential) => (
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
                                Khách mới sẽ hiện ngay trong Việc hôm nay. Đến đúng 3 ngày và 7 ngày sau, hệ thống đưa khách vào nhóm gọi lại tương ứng.
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
                            <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-3 text-[13px] font-semibold text-slate-600">
                                <div>
                                    Đã tạo {formatNumber(importResult.created_count)} khách, bỏ qua {formatNumber(importResult.duplicate_count)} số trùng.
                                </div>
                                {Array.isArray(importResult.duplicates) && importResult.duplicates.length > 0 ? (
                                    <div className="rounded-sm border border-amber-200 bg-amber-50 p-2 text-amber-800">
                                        <div className="mb-1 font-black">Số đã tồn tại trong hệ thống:</div>
                                        <div className="space-y-1">
                                            {importResult.duplicates.slice(0, 6).map((duplicate, index) => {
                                                const duplicatePhone = duplicate.normalized_phone || duplicate.lead?.phone || duplicate.phone || '';
                                                const duplicateName = duplicate.lead?.customer_name || 'Khách chưa có tên';

                                                return (
                                                    <div key={`${duplicatePhone}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-white/70 px-2 py-1.5">
                                                        <span className="min-w-0 truncate">
                                                            <span className="font-black">{duplicatePhone || duplicate.phone}</span>
                                                            <span className="text-amber-700"> - {duplicateName}</span>
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => focusCustomerInTable(duplicatePhone || duplicate.phone, true)}
                                                            className="inline-flex h-7 shrink-0 items-center justify-center rounded-sm border border-amber-300 bg-white px-2 text-[12px] font-black text-amber-800 shadow-sm hover:bg-amber-100"
                                                        >
                                                            Xem
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {importResult.duplicates.length > 6 ? (
                                            <div className="mt-1 text-[12px]">Còn {formatNumber(importResult.duplicates.length - 6)} số trùng khác.</div>
                                        ) : null}
                                    </div>
                                ) : null}
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
        );
    };

    const renderLeadEditModal = () => {
        if (!leadEditOpen) return null;

        const editingLead = selectedLeads[0];

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
                <form onSubmit={handleLeadEditSubmit} className="w-full max-w-lg overflow-hidden rounded-sm bg-white shadow-2xl">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
                        <div className="min-w-0">
                            <h2 className="text-xl font-black text-slate-950">Sửa thông tin khách</h2>
                            <p className="mt-1 truncate text-[13px] font-medium text-slate-500">
                                {editingLead?.lead_number || editingLead?.customer_name || editingLead?.phone || 'Khách đang chọn'}
                            </p>
                        </div>
                        <button type="button" onClick={closeLeadEdit} disabled={leadEditSaving} className={iconButtonClassName} title="Đóng">
                            <span className="material-symbols-outlined text-[19px]">close</span>
                        </button>
                    </div>

                    <div className="space-y-3 p-4">
                        <label className="block">
                            <span className="mb-1 block text-[12px] font-bold text-slate-500">Tên khách</span>
                            <input
                                value={leadEditForm.customer_name}
                                onChange={(event) => setLeadEditForm((prev) => ({ ...prev, customer_name: event.target.value }))}
                                disabled={leadEditSaving}
                                className={inputClassName}
                                placeholder="Tên khách"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-1 block text-[12px] font-bold text-slate-500">SĐT khách</span>
                            <input
                                value={leadEditForm.phone}
                                onChange={(event) => {
                                    const nextPhone = event.target.value;
                                    setLeadEditForm((prev) => ({
                                        ...prev,
                                        phone: nextPhone,
                                        zalo_phone: prev.zalo_same_as_phone ? nextPhone : prev.zalo_phone,
                                    }));
                                }}
                                disabled={leadEditSaving}
                                className={inputClassName}
                                placeholder="09xx xxx xxx"
                            />
                        </label>

                        <label className="flex h-10 items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-700">
                            <input
                                type="checkbox"
                                checked={leadEditForm.zalo_same_as_phone}
                                onChange={(event) => handleLeadEditSameAsPhoneChange(event.target.checked)}
                                disabled={leadEditSaving}
                                className="size-4 accent-teal-700"
                            />
                            SĐT khách cũng là Zalo
                        </label>

                        <label className="block">
                            <span className="mb-1 block text-[12px] font-bold text-slate-500">SĐT Zalo</span>
                            <input
                                value={leadEditForm.zalo_same_as_phone ? leadEditForm.phone : leadEditForm.zalo_phone}
                                onChange={(event) => setLeadEditForm((prev) => ({ ...prev, zalo_phone: event.target.value }))}
                                disabled={leadEditSaving || leadEditForm.zalo_same_as_phone}
                                className={inputClassName}
                                placeholder="Nhập nếu khác SĐT khách"
                            />
                        </label>

                        {leadEditError ? (
                            <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
                                {leadEditError}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
                        <button type="button" onClick={closeLeadEdit} disabled={leadEditSaving} className={secondaryButtonClassName}>Đóng</button>
                        <button type="submit" disabled={leadEditSaving} className={primaryButtonClassName}>
                            <span className="material-symbols-outlined text-[18px]">save</span>
                            {leadEditSaving ? 'Đang lưu...' : 'Lưu sửa'}
                        </button>
                    </div>
                </form>
            </div>
        );
    };
    const renderHistoryRow = (lead) => {
        const detail = historyDetails[lead.id];
        const notes = Array.isArray(detail?.notes_timeline) ? detail.notes_timeline : [];
        const inlineSaving = Boolean(inlineSavingIds[lead.id]);

        return (
            <tr className="bg-slate-50">
                <td colSpan={tableColumnCount} className="border border-slate-200 px-4 py-3">
                    <div className="mx-auto max-w-4xl rounded-sm border border-slate-200 bg-white p-3 shadow-sm">
                        {historyLoadingIds[lead.id] ? (
                            <div className="py-6 text-center text-[13px] font-semibold text-slate-500">Đang tải lịch sử...</div>
                        ) : notes.length ? (
                            <div className="divide-y divide-slate-100">
                                {notes.map((note) => {
                                    const isLatestNote = Number(note.id) === Number(lead.latest_note_id);

                                    return (
                                        <div key={note.id} className="grid grid-cols-[34px_150px_110px_minmax(0,1fr)_36px] items-center gap-3 py-2 text-[12px]">
                                            <span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                                                <span className="material-symbols-outlined text-[17px]">{activityIconMap[note.activity_type] || activityIconMap.note}</span>
                                            </span>
                                            <span className="font-semibold text-slate-500">{formatDateTimeLocalLabel(note.created_at) || note.created_label}</span>
                                            <span className="flex items-center gap-1 font-black text-teal-700">
                                                {note.activity_label}
                                                {isLatestNote ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-black text-teal-700">Mới</span> : null}
                                            </span>
                                            <span className="whitespace-pre-wrap font-semibold text-slate-700">{note.content}</span>
                                            <button
                                                type="button"
                                                onClick={() => deleteHistoryNote(lead, note)}
                                                disabled={inlineSaving}
                                                className="inline-flex size-8 items-center justify-center rounded-sm border border-red-100 bg-white text-red-500 shadow-sm hover:border-red-300 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                                                title="Xóa ghi chú này"
                                            >
                                                <span className="material-symbols-outlined text-[17px]">delete</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-6 text-center text-[13px] font-semibold text-slate-500">Chưa có ghi chú nào.</div>
                        )}
                    </div>
                </td>
            </tr>
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

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <AccountSelector />
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

                <div className="min-w-0 overflow-hidden rounded-sm border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 p-3">
                        <div className="grid grid-cols-1 gap-2 xl:grid-cols-[136px_124px_minmax(150px,1fr)_150px_156px_128px_132px_160px_180px_180px_152px] xl:items-center">
                            <button type="button" onClick={() => setImportOpen(true)} className={primaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                Nhập khách
                            </button>

                            <div className="relative">
                                <button type="button" onClick={() => setActionMenuOpen((open) => !open)} className={`${secondaryButtonClassName} w-full justify-between px-3`}>
                                    <span className="inline-flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                                        Thao tác
                                    </span>
                                    {selectedLeadIds.length > 0 ? (
                                        <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-teal-50 px-1.5 text-[11px] font-black text-teal-700">
                                            {formatNumber(selectedLeadIds.length)}
                                        </span>
                                    ) : null}
                                </button>

                                {actionMenuOpen ? (
                                    <div className="absolute left-0 top-12 z-30 w-[240px] rounded-sm border border-slate-200 bg-white p-2 shadow-xl">
                                        <div className="px-2 pb-2 text-[12px] font-semibold text-slate-500">
                                            {selectedLeadIds.length > 0
                                                ? `Đã chọn ${formatNumber(selectedLeadIds.length)} khách`
                                                : 'Tích ô nhỏ ở bảng để chọn khách'}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={openEditSelectedLead}
                                            disabled={!canEditSelectedLead || leadEditSaving || bulkDeleting}
                                            className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] font-bold text-slate-700 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">edit</span>
                                            Sửa khách
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDeleteSelectedLeads}
                                            disabled={selectedLeadIds.length === 0 || bulkDeleting}
                                            className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                            {bulkDeleting ? 'Đang xóa...' : 'Xóa khách'}
                                        </button>
                                        {selectedLeadIds.length > 1 ? (
                                            <div className="mt-2 rounded-sm bg-slate-50 px-2 py-1.5 text-[11px] font-semibold leading-5 text-slate-500">
                                                Sửa từng khách một; xóa có thể áp dụng cho nhiều khách đã chọn.
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            <div className="relative min-w-0">
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
                            <div className="relative min-w-0">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-500">fact_check</span>
                                <select
                                    value={workStatus}
                                    onChange={(event) => {
                                        setWorkStatus(event.target.value);
                                        setPage(1);
                                    }}
                                    className={`${selectClassName} pl-10`}
                                    aria-label="Lọc trạng thái xử lý"
                                >
                                    {workStatusOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="relative">
                                <button type="button" onClick={() => setDateFilterOpen((open) => !open)} className={`${secondaryButtonClassName} w-full justify-start px-3`}>
                                    <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                                    {dateRangeLabel}
                                </button>

                                {dateFilterOpen ? (
                                    <div className="absolute left-0 top-12 z-30 w-[280px] rounded-sm border border-slate-200 bg-white p-3 shadow-xl">
                                        <div className="grid grid-cols-1 gap-2">
                                            <label className="block">
                                                <span className="mb-1 block text-[12px] font-bold text-slate-500">Từ ngày</span>
                                                <input
                                                    type="date"
                                                    value={dateFrom}
                                                    onChange={(event) => {
                                                        setDateFrom(event.target.value);
                                                        setPage(1);
                                                    }}
                                                    className={inputClassName}
                                                />
                                            </label>
                                            <label className="block">
                                                <span className="mb-1 block text-[12px] font-bold text-slate-500">Đến ngày</span>
                                                <input
                                                    type="date"
                                                    value={dateTo}
                                                    onChange={(event) => {
                                                        setDateTo(event.target.value);
                                                        setPage(1);
                                                    }}
                                                    className={inputClassName}
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-3 flex items-center justify-between gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDateFrom(initialMonthRange.from);
                                                    setDateTo(initialMonthRange.to);
                                                    setPage(1);
                                                }}
                                                className="h-9 rounded-sm border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700"
                                            >
                                                Tháng này
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDateFrom('');
                                                    setDateTo('');
                                                    setPage(1);
                                                    setDateFilterOpen(false);
                                                }}
                                                className="h-9 rounded-sm border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-600 hover:border-red-200 hover:text-red-600"
                                            >
                                                Xóa lọc
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <button type="button" onClick={() => setStatsOpen(true)} className={secondaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">bar_chart</span>
                                Thống kê
                            </button>

                            <button type="button" onClick={() => setStatusManagerOpen(true)} className={secondaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">settings</span>
                                Trạng thái
                            </button>

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
                                {activeStatuses.map((status) => (
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
                                {activePotentials.map((potential) => (
                                    <option key={potential.value} value={potential.value}>{potential.label}</option>
                                ))}
                            </select>

                            <div className="relative">
                                <button type="button" onClick={() => setColumnSettingsOpen((open) => !open)} className={`${secondaryButtonClassName} w-full px-3`}>
                                    <span className="material-symbols-outlined text-[18px]">view_column</span>
                                    Cột hiển thị
                                </button>

                                {columnSettingsOpen ? (
                                    <div className="absolute right-0 top-12 z-30 w-[220px] rounded-sm border border-slate-200 bg-white p-2 shadow-xl">
                                        {columnOptions.map((column) => (
                                            <label key={column.key} className="flex h-9 items-center gap-2 rounded-sm px-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(visibleColumns[column.key])}
                                                    onChange={(event) => setVisibleColumns((prev) => ({ ...prev, [column.key]: event.target.checked }))}
                                                    className="size-4 accent-teal-700"
                                                />
                                                {column.label}
                                            </label>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <div ref={tableScrollRef} className="max-h-[calc(100vh-330px)] min-h-[480px] overflow-auto">
                        <table className="min-w-[1632px] table-fixed border-collapse">
                            <thead className="sticky top-0 z-20">
                                <tr className="bg-slate-50 text-left text-[12px] font-bold text-slate-500">
                                    <th className="w-[52px] border border-slate-200 px-2 py-3 text-center">
                                        <label className="inline-flex size-8 items-center justify-center rounded-sm border border-slate-200 bg-white shadow-sm" title="Chọn tất cả khách đang hiển thị">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleLeadsSelected}
                                                disabled={leads.length === 0}
                                                onChange={toggleSelectAllLeads}
                                                aria-label="Chọn tất cả khách đang hiển thị"
                                                aria-checked={hasVisibleLeadSelection && !allVisibleLeadsSelected ? 'mixed' : allVisibleLeadsSelected}
                                                className="size-4 accent-teal-700 disabled:cursor-not-allowed"
                                            />
                                        </label>
                                    </th>
                                    {visibleColumns.customer ? <th className="w-[190px] border border-slate-200 px-3 py-3">Khách hàng</th> : null}
                                    {visibleColumns.phone ? <th className="w-[210px] border border-slate-200 px-3 py-3">SĐT / Zalo</th> : null}
                                    {visibleColumns.staff ? <th className="w-[140px] border border-slate-200 px-3 py-3">Sale phụ trách</th> : null}
                                    {visibleColumns.status ? <th className="w-[190px] border border-slate-200 px-3 py-3">Trạng thái</th> : null}
                                    {visibleColumns.potential ? <th className="w-[190px] border border-slate-200 px-3 py-3">Tiềm năng</th> : null}
                                    {visibleColumns.createOrder ? <th className="w-[145px] border border-slate-200 px-3 py-3">Tạo đơn</th> : null}
                                    {visibleColumns.reminder ? <th className="w-[250px] border border-slate-200 px-3 py-3">Việc cần xử lý</th> : null}
                                    {visibleColumns.note ? <th className="w-[365px] border border-slate-200 px-3 py-3">Ghi chú</th> : null}
                                </tr>
                            </thead>
                            <tbody>
                                {loading && leads.length === 0 ? (
                                    <tr>
                                        <td colSpan={tableColumnCount} className="border border-slate-200 px-4 py-16 text-center text-[13px] font-semibold text-slate-500">
                                            Đang tải danh sách khách...
                                        </td>
                                    </tr>
                                ) : leads.length === 0 ? (
                                    <tr>
                                        <td colSpan={tableColumnCount} className="border border-slate-200 px-4 py-16 text-center text-[13px] font-semibold text-slate-500">
                                            Chưa có khách phù hợp với bộ lọc hiện tại.
                                        </td>
                                    </tr>
                                ) : leads.map((lead) => {
                                    const inlineSaving = Boolean(inlineSavingIds[lead.id]);
                                    const statusValue = lead.lead_status_id ? String(lead.lead_status_id) : '';
                                    const potentialValue = lead.potential_level || '';
                                    const noteValue = inlineNoteDrafts[lead.id] ?? lead.latest_note_content ?? lead.latest_note_excerpt ?? '';
                                    const potentialOption = activePotentials.find((potential) => potential.value === potentialValue);
                                    const historyOpen = Boolean(historyOpenIds[lead.id]);
                                    const zaloSameAsPhone = normalizePhoneDigits(lead.zalo_phone || lead.phone) === normalizePhoneDigits(lead.phone);
                                    const phoneCarrierLabel = detectVietnamMobileCarrier(lead.phone);
                                    const potentialSelectValue = potentialOption ? potentialValue : '';
                                    const leadAddedAt = lead.added_at || lead.placed_at || lead.created_at;
                                    const customerAddedLabel = formatDateTimeLocalLabel(leadAddedAt) || lead.added_label || lead.placed_label || '';
                                    const reminderAddedDateLabel = formatDateOnlyLabel(leadAddedAt);
                                    const currentTask = lead.current_task || null;
                                    const workTask = lead.work_task || currentTask;
                                    const reminderProcessed = workTask?.status === 'completed';
                                    const taskStatusDisplay = getTaskStatusDisplay(currentTask);
                                    const currentStatusOption = activeStatuses.find((status) => String(status.id) === String(statusValue));
                                    const statusSelectValue = taskStatusDisplay ? taskStatusDisplay.value : (currentStatusOption ? statusValue : '');
                                    const currentStatusColor = taskStatusDisplay?.color || currentStatusOption?.color || '#64748b';
                                    const currentTaskDue = workTask?.due_label || '';
                                    const rowWasRestored = String(restoredLeadId || '') === String(lead.id);
                                    const rowSelected = selectedLeadIdSet.has(String(lead.id));

                                    return (
                                        <React.Fragment key={lead.id}>
                                            <tr id={`telesales-lead-${lead.id}`} data-telesales-lead-row={lead.id} className={`border-b border-slate-200 text-[13px] transition ${rowWasRestored || rowSelected ? 'bg-teal-50' : 'bg-white hover:bg-teal-50/40'}`}>
                                                <td className="border border-slate-200 px-2 py-3 text-center align-middle">
                                                    <label className="inline-flex size-8 items-center justify-center rounded-sm border border-slate-200 bg-white shadow-sm hover:border-teal-300" title="Chọn khách này">
                                                        <input
                                                            type="checkbox"
                                                            checked={rowSelected}
                                                            onChange={(event) => toggleSelectLead(lead.id, event.target.checked)}
                                                            className="size-4 accent-teal-700"
                                                            aria-label={`Chọn ${lead.customer_name || lead.phone || lead.id}`}
                                                        />
                                                    </label>
                                                </td>

                                                {visibleColumns.customer ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className="min-w-0">
                                                        <div className="truncate font-black text-slate-950">{lead.customer_name || 'Khách chưa có tên'}</div>
                                                        <div className="mt-1 truncate text-[12px] font-semibold text-slate-500">
                                                            {customerAddedLabel || 'Chưa có ngày thêm'}
                                                        </div>
                                                    </div>
                                                </td> : null}

                                                {visibleColumns.phone ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className="whitespace-nowrap font-black text-slate-900">
                                                        {lead.phone || '-'}
                                                        {phoneCarrierLabel ? <span className="font-bold text-teal-700"> - {phoneCarrierLabel}</span> : null}
                                                    </div>
                                                    <label className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                                                        <input
                                                            type="checkbox"
                                                            checked={zaloSameAsPhone}
                                                            disabled={inlineSaving}
                                                            onChange={(event) => handleZaloSameAsPhoneChange(lead, event.target.checked)}
                                                            className="size-3.5 accent-teal-700"
                                                        />
                                                        SĐT là Zalo
                                                    </label>
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <button type="button" onClick={() => handleOpenPhone(lead)} className="inline-flex h-8 items-center gap-1 rounded-sm bg-teal-700 px-2 text-[12px] font-bold text-white shadow-sm hover:bg-teal-800">
                                                            <span className="material-symbols-outlined text-[15px]">call</span>
                                                            Gọi
                                                        </button>
                                                        <button type="button" onClick={() => handleOpenZalo(lead)} className="inline-flex h-8 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[12px] font-bold text-slate-700 shadow-sm hover:border-teal-300 hover:text-teal-700">
                                                            Zalo
                                                        </button>
                                                    </div>
                                                </td> : null}

                                                {visibleColumns.staff ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <select
                                                        value={lead.assigned_staff_id ? String(lead.assigned_staff_id) : ''}
                                                        disabled={inlineSaving}
                                                        onChange={(event) => handleInlineStaffChange(lead, event.target.value)}
                                                        className={inlineSelectClassName}
                                                        aria-label={`Sửa sale ${lead.customer_name || lead.phone || lead.id}`}
                                                    >
                                                        <option value="">Chưa gán</option>
                                                        {bootstrap.staffs.map((staff) => (
                                                            <option key={staff.id} value={staff.id}>{staff.name}</option>
                                                        ))}
                                                    </select>
                                                </td> : null}

                                                {visibleColumns.status ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className="relative">
                                                        <span className="pointer-events-none absolute left-3 top-1/2 z-10 size-3 -translate-y-1/2 rounded-full shadow-sm" style={{ backgroundColor: currentStatusColor }} />
                                                        <select
                                                            value={statusSelectValue}
                                                            disabled={inlineSaving}
                                                            onChange={(event) => handleInlineStatusChange(lead, event.target.value)}
                                                            className={`${inlineSelectClassName} pl-8`}
                                                            style={{
                                                                borderColor: `${currentStatusColor}55`,
                                                                color: currentStatusColor,
                                                                backgroundColor: `${currentStatusColor}10`,
                                                            }}
                                                            aria-label={`Sửa trạng thái ${lead.customer_name || lead.phone || lead.id}`}
                                                        >
                                                            {taskStatusDisplay ? (
                                                                <option value={taskStatusDisplay.value} disabled>{taskStatusDisplay.label}</option>
                                                            ) : null}
                                                            <option value="">Chưa chọn</option>
                                                            {activeStatuses.map((status) => (
                                                                <option key={status.id} value={status.id}>{status.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </td> : null}

                                                {visibleColumns.potential ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className="relative">
                                                        <span className="pointer-events-none absolute left-3 top-1/2 z-10 size-3 -translate-y-1/2 rounded-full shadow-sm" style={{ backgroundColor: potentialOption?.color || '#94a3b8' }} />
                                                        <select
                                                            value={potentialSelectValue}
                                                            disabled={inlineSaving}
                                                            onChange={(event) => handleInlinePotentialChange(lead, event.target.value)}
                                                            className={`${inlineSelectClassName} pl-8`}
                                                            style={{
                                                                borderColor: `${potentialOption?.color || '#94a3b8'}55`,
                                                                color: potentialOption?.color || '#475569',
                                                                backgroundColor: `${potentialOption?.color || '#94a3b8'}10`,
                                                            }}
                                                            aria-label={`Sửa tiềm năng ${lead.customer_name || lead.phone || lead.id}`}
                                                        >
                                                            <option value="">Chưa phân loại</option>
                                                            {activePotentials.map((potential) => (
                                                                <option key={potential.value} value={potential.value}>{potential.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </td> : null}

                                                {visibleColumns.createOrder ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <button type="button" onClick={() => openCreateOrder(lead)} className="inline-flex h-9 w-full items-center justify-center rounded-sm bg-teal-700 px-2 text-[12px] font-bold text-white shadow-sm hover:bg-teal-800">
                                                        Tạo đơn
                                                    </button>
                                                </td> : null}

                                                {visibleColumns.reminder ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className={`rounded-sm border px-2.5 py-2 ${reminderProcessed ? 'border-emerald-200 bg-emerald-50' : lead.do_not_call ? 'border-slate-200 bg-slate-50' : 'border-teal-200 bg-teal-50'}`}>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className={`text-[12px] font-black ${reminderProcessed ? 'text-emerald-700' : lead.do_not_call ? 'text-slate-600' : workTask?.is_overdue ? 'text-red-700' : 'text-teal-800'}`}>
                                                                {labelForReminder(lead)}
                                                            </div>
                                                            {reminderProcessed ? (
                                                                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">Đã xử lý</span>
                                                            ) : null}
                                                        </div>
                                                        {workTask ? (
                                                            <div className="mt-1 text-[11px] font-semibold text-slate-600">
                                                                {workTask.status_label}{currentTaskDue ? ` - hạn ${currentTaskDue}` : ''}
                                                            </div>
                                                        ) : null}
                                                        {reminderAddedDateLabel ? (
                                                            <div className="mt-1 text-[11px] font-semibold text-slate-600">
                                                                Ngày thêm: {reminderAddedDateLabel}
                                                            </div>
                                                        ) : null}
                                                        <label className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(lead.do_not_call)}
                                                                disabled={inlineSaving}
                                                                onChange={(event) => handleToggleDoNotCall(lead, event.target.checked)}
                                                                className="size-3.5 accent-teal-700"
                                                            />
                                                            Dừng nhắc lại
                                                        </label>
                                                    </div>
                                                </td> : null}

                                                {visibleColumns.note ? <td className="border border-slate-200 px-3 py-3 align-middle">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={noteValue}
                                                            disabled={inlineSaving}
                                                            placeholder="Nhập ghi chú rồi Enter..."
                                                            onChange={(event) => setInlineNoteDrafts((prev) => ({ ...prev, [lead.id]: event.target.value }))}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') {
                                                                    event.preventDefault();
                                                                    saveInlineNote(lead);
                                                                }

                                                                if (event.key === 'Escape') {
                                                                    event.preventDefault();
                                                                    setInlineNoteDrafts((prev) => {
                                                                        const next = { ...prev };
                                                                        delete next[lead.id];
                                                                        return next;
                                                                    });
                                                                }
                                                            }}
                                                            className={inlineInputClassName}
                                                            aria-label={`Sửa ghi chú ${lead.customer_name || lead.phone || lead.id}`}
                                                        />
                                                        <button type="button" onClick={() => toggleHistory(lead)} disabled={inlineSaving} className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-teal-300 bg-white text-teal-700 shadow-sm hover:bg-teal-50" title="Xem lịch sử cũ">
                                                            <span className="material-symbols-outlined text-[19px]">{historyOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}</span>
                                                        </button>
                                                    </div>
                                                    <div className="mt-1 text-[11px] font-semibold text-slate-400">
                                                        {lead.last_noted_label ? `Mới nhất: ${formatDateOnlyLabel(lead.last_noted_at) || lead.last_noted_label}` : 'Chưa có ghi chú'}
                                                    </div>
                                                </td> : null}
                                            </tr>

                                            {historyOpen ? renderHistoryRow(lead) : null}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-3 text-[13px] font-semibold text-slate-500">
                            <span>Hiển thị {formatNumber(currentStart)}-{formatNumber(currentEnd)} / {formatNumber(pagination.total)}</span>
                            <span className="flex items-center gap-2">
                                Số dòng:
                                <select
                                    value={perPage}
                                    onChange={(event) => {
                                        setPerPage(Number(event.target.value));
                                        setPage(1);
                                    }}
                                    className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[13px] font-black text-slate-900 shadow-sm outline-none focus:border-teal-500"
                                >
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-bold text-slate-500">
                                Tổng khách: <span className="font-black text-slate-900">{formatNumber(pagination.total)}</span>
                            </span>
                            <Pagination pagination={pagination} onPageChange={setPage} />
                        </div>
                    </div>
                </div>
            </div>

            {renderImportModal()}
            {renderLeadEditModal()}
            {renderStatsPanel()}
            {renderStatusManager()}
        </div>
    );
};

export default TelesalesCrm;
