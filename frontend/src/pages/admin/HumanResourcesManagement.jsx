import React, { useEffect, useMemo, useState } from 'react';
import { mediaApi, payrollApi } from '../../services/api';

const NAV_ITEMS = [
    { id: 'employees', label: 'Nhân viên', icon: 'groups' },
    { id: 'schedule', label: 'Lịch làm', icon: 'calendar_month' },
    { id: 'attendance', label: 'Chấm công', icon: 'schedule' },
    { id: 'salary', label: 'Bảng lương', icon: 'payments' },
    { id: 'adjustments', label: 'Tạm ứng', icon: 'volunteer_activism' },
    { id: 'reports', label: 'Báo cáo', icon: 'bar_chart' },
];

const EMPLOYEE_TYPES = [
    { value: 'theo_thang', label: 'Full-time' },
    { value: 'theo_gio', label: 'Part-time / giờ' },
    { value: 'theo_ca', label: 'Part-time / ca' },
];

const EMPLOYEE_STATUS = ['Đang làm', 'Tạm nghỉ', 'Nghỉ việc'];
const ATTENDANCE_STATUS = ['Đi làm', 'Làm lẻ', 'Nửa ca', 'Nghỉ', 'Nghỉ phép', 'Tăng ca'];
const SCHEDULE_STATUS = ['Đã đăng ký', 'Đổi ca', 'Huỷ lịch'];
const ADJUSTMENT_TYPES = [
    { value: 'bonus', label: 'Cộng / thưởng' },
    { value: 'advance', label: 'Tạm ứng' },
    { value: 'deduction', label: 'Trừ khác' },
];

const BLANK_DATA = {
    scope: {},
    departments: [],
    users: [],
    employees: [],
    shifts: [],
    schedules: [],
    attendance_records: [],
    adjustments: [],
    payroll_summary: [],
};

const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

const currentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const safeNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

const parseMoney = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') return String(Math.ceil(Math.abs(value)));

    let normalized = String(value).trim().replace(/[^\d.,-]/g, '');
    if (normalized.includes('.') && normalized.includes(',')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes('.')) {
        const parts = normalized.split('.');
        const decimalLike = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
        normalized = decimalLike ? normalized : normalized.replace(/\./g, '');
    } else {
        normalized = normalized.replace(',', '.');
    }

    const number = Number(normalized);
    return Number.isFinite(number) ? String(Math.ceil(Math.abs(number))) : '';
};

const parseDecimal = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const normalized = String(value).trim().replace(',', '.').replace(/[^\d.-]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : '';
};

const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return 'Ẩn';
    return `${moneyFormatter.format(Math.ceil(safeNumber(value)))} đ`;
};

const formatDecimal = (value) => decimalFormatter.format(safeNumber(value));
const formatTime = (value) => (value ? String(value).slice(0, 5) : '');
const firstDayOfMonth = (month) => `${month || currentMonth()}-01`;
const dateValue = (value) => {
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
};
const tempId = () => `new-${Math.random().toString(36).slice(2, 9)}`;

const dateFromInput = (value) => {
    const date = new Date(`${dateValue(value) || value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
};

const isoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const weekStartOf = (value) => {
    const date = dateFromInput(value);
    const day = date.getDay() || 7;
    return isoDate(addDays(date, 1 - day));
};

const shortDate = (value) => {
    const [, month, day] = String(value || '').split('-');
    return day && month ? `${day}/${month}` : value;
};

const weekday = (value) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dateFromInput(value).getDay()];
const employeeTypeLabel = (value) => EMPLOYEE_TYPES.find((item) => item.value === value)?.label || 'Part-time';
const salaryUnitLabel = (value) => ({
    theo_gio: 'đ / giờ',
    theo_thang: 'đ / tháng',
    theo_ca: 'đ / ca',
})[value] || 'đ / ca';
const formatSalary = (amount, type) => {
    if (amount === null || amount === undefined || amount === '') return 'Ẩn';
    return `${moneyFormatter.format(Math.ceil(safeNumber(amount)))} ${salaryUnitLabel(type)}`;
};
const isFullTime = (employee) => employee?.salary_type === 'theo_thang';
const normalizeId = (value) => (value === '' || value === null || value === undefined ? null : value);
const positiveAdjustment = (type) => type === 'bonus';
const employeeRowKey = (employee) => String(employee?.id || employee?.uid || '');
const imageSource = (value) => {
    const source = String(value || '').trim();
    if (!source) return '';
    return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(source) ? source : '';
};

const normalizeSalaryRate = (rate = {}, fallback = {}) => ({
    id: rate.id || null,
    uid: rate.uid || tempId(),
    salary_type: rate.salary_type || fallback.salary_type || 'theo_gio',
    salary_amount: rate.salary_amount ?? fallback.salary_amount ?? '',
    standard_work_units: rate.standard_work_units ?? fallback.standard_work_units ?? '',
    effective_from: dateValue(rate.effective_from || rate.salary_effective_from || fallback.salary_effective_from),
    notes: rate.notes || '',
});

const salaryRateKey = (rate, index = 0) => String(rate?.id || rate?.uid || `${dateValue(rate?.effective_from)}-${index}`);

const salaryRatesForEmployee = (employee = {}) => {
    const rows = Array.isArray(employee.salary_rates)
        ? employee.salary_rates.map((rate) => normalizeSalaryRate(rate, employee))
        : [];
    const currentDate = dateValue(employee.salary_effective_from);

    if (currentDate && employee.salary_amount !== null && employee.salary_amount !== undefined && employee.salary_amount !== '') {
        const currentRate = normalizeSalaryRate({
            salary_type: employee.salary_type,
            salary_amount: employee.salary_amount,
            standard_work_units: employee.standard_work_units,
            effective_from: currentDate,
        }, employee);
        const index = rows.findIndex((rate) => dateValue(rate.effective_from) === currentDate);
        if (index >= 0) {
            rows[index] = { ...rows[index], ...currentRate, id: rows[index].id, uid: rows[index].uid };
        } else {
            rows.push(currentRate);
        }
    }

    return rows
        .filter((rate) => dateValue(rate.effective_from) || rate.salary_amount !== '')
        .sort((left, right) => dateValue(left.effective_from).localeCompare(dateValue(right.effective_from)));
};

const normalizeEmployee = (row = {}) => {
    const salaryEffectiveFrom = dateValue(row.salary_effective_from);
    return {
        ...row,
        salary_effective_from: salaryEffectiveFrom,
        salary_rates: salaryRatesForEmployee({ ...row, salary_effective_from: salaryEffectiveFrom }),
        deleted_salary_rate_ids: row.deleted_salary_rate_ids || [],
    };
};

const employeePayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    user_id: normalizeId(row.user_id),
    employee_code: row.employee_code || '',
    full_name: row.full_name || '',
    phone: row.phone || '',
    address: row.address || '',
    identity_card_image_url: row.identity_card_image_url || '',
    identity_card_front_image_url: row.identity_card_front_image_url || row.identity_card_image_url || '',
    identity_card_back_image_url: row.identity_card_back_image_url || '',
    department: row.department || '',
    position: row.position || '',
    salary_type: row.salary_type || 'theo_gio',
    salary_amount: parseMoney(row.salary_amount),
    salary_effective_from: dateValue(row.salary_effective_from),
    salary_rates: salaryRatesForEmployee(row).map((rate) => ({
        id: rate.id || null,
        salary_type: rate.salary_type || row.salary_type || 'theo_gio',
        salary_amount: parseMoney(rate.salary_amount),
        standard_work_units: parseDecimal(rate.standard_work_units),
        effective_from: dateValue(rate.effective_from),
        notes: rate.notes || '',
    })),
    deleted_salary_rate_ids: row.deleted_salary_rate_ids || [],
    standard_work_units: parseDecimal(row.standard_work_units),
    lunch_allowance: parseMoney(row.lunch_allowance),
    bonus_policy: row.bonus_policy || '',
    pay_schedule: row.pay_schedule || '',
    raise_plan: row.raise_plan || '',
    bank_account_note: row.bank_account_note || '',
    bank_qr_image_url: row.bank_qr_image_url || '',
    status: row.status || 'Đang làm',
    notes: row.notes || '',
}));

const uploadedImageUrl = (response) => String(
    response?.data?.url
    || response?.data?.image?.large_url
    || response?.data?.image?.medium_url
    || response?.data?.image?.url
    || ''
).trim();

const shiftPayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    shift_code: row.shift_code || '',
    shift_name: row.shift_name || '',
    start_time: row.start_time || '',
    end_time: row.end_time || '',
    standard_hours: parseDecimal(row.standard_hours),
    default_work_units: parseDecimal(row.default_work_units),
    wage_multiplier: parseDecimal(row.wage_multiplier || 1),
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    notes: row.notes || '',
}));

const schedulePayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    work_date: row.work_date || '',
    payroll_employee_id: normalizeId(row.payroll_employee_id),
    payroll_work_shift_id: normalizeId(row.payroll_work_shift_id),
    registered_work_units: parseDecimal(row.registered_work_units || 1),
    status: row.status || 'Đã đăng ký',
    notes: row.notes || '',
}));

const attendancePayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    payroll_schedule_registration_id: normalizeId(row.payroll_schedule_registration_id),
    work_date: row.work_date || '',
    payroll_employee_id: normalizeId(row.payroll_employee_id),
    payroll_work_shift_id: normalizeId(row.payroll_work_shift_id),
    attendance_status: row.attendance_status || 'Đi làm',
    work_units: parseDecimal(row.work_units || 0),
    unit_rate: parseMoney(row.unit_rate),
    bonus_amount: parseMoney(row.bonus_amount),
    penalty_amount: parseMoney(row.penalty_amount),
    notes: row.notes || '',
}));

const adjustmentPayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    adjustment_date: row.adjustment_date || '',
    payroll_employee_id: normalizeId(row.payroll_employee_id),
    adjustment_type: row.adjustment_type || 'advance',
    amount: parseMoney(row.amount),
    notes: row.notes || '',
}));

function TextInput({ value, onChange, type = 'text', disabled = false, placeholder = '', className = '' }) {
    return (
        <input
            type={type}
            value={value ?? ''}
            disabled={disabled}
            placeholder={placeholder}
            onInput={(event) => onChange(event.currentTarget.value)}
            onChange={(event) => onChange(event.target.value)}
            className={`h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        />
    );
}

function TextAreaInput({ value, onChange, disabled = false, placeholder = '' }) {
    return (
        <textarea
            value={value ?? ''}
            disabled={disabled}
            placeholder={placeholder}
            rows={4}
            onChange={(event) => onChange(event.target.value)}
            className="w-full resize-none rounded border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400"
        />
    );
}

function MoneyInput({ value, onChange, disabled = false, suffix = 'đ' }) {
    const paddingClass = suffix === 'đ' ? 'pr-7' : 'pr-20';

    return (
        <div className="relative">
            <input
                type="text"
                inputMode="numeric"
                value={value === null || value === undefined || value === '' ? '' : moneyFormatter.format(Math.ceil(safeNumber(value)))}
                disabled={disabled}
                onChange={(event) => onChange(parseMoney(event.target.value))}
                className={`h-9 w-full rounded border border-gray-200 bg-white px-2.5 ${paddingClass} text-right text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-gray-400">{suffix}</span>
        </div>
    );
}

function DecimalInput({ value, onChange, disabled = false }) {
    return (
        <input
            type="text"
            inputMode="decimal"
            value={value ?? ''}
            disabled={disabled}
            onChange={(event) => onChange(parseDecimal(event.target.value))}
            className="h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-right text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400"
        />
    );
}

function SelectInput({ value, onChange, options, disabled = false, placeholder = 'Chọn' }) {
    return (
        <select
            value={value ?? ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400"
        >
            <option value="">{placeholder}</option>
            {options.map((option) => {
                const item = typeof option === 'string' ? { value: option, label: option } : option;
                return <option key={item.value} value={item.value}>{item.label}</option>;
            })}
        </select>
    );
}

function MiniTable({ columns, rows, renderRow, empty = 'Chưa có dữ liệu.' }) {
    return (
        <table className="w-full border-collapse text-left text-[12px]">
            <thead>
                <tr>
                    {columns.map((column) => (
                        <th key={column} className="border-b border-gray-200 bg-white px-3 py-2 font-bold text-gray-500">{column}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length === 0 ? (
                    <tr><td colSpan={columns.length} className="px-3 py-8 text-center font-semibold text-gray-400">{empty}</td></tr>
                ) : rows.map(renderRow)}
            </tbody>
        </table>
    );
}

function DataTable({ columns, minWidth = 980, children }) {
    return (
        <div className="overflow-auto">
            <table className="w-full border-collapse text-left text-[13px]" style={{ minWidth }}>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column} className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-[12px] font-bold text-gray-500">{column}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

function EmptyRow({ colSpan, message }) {
    return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-[13px] font-semibold text-gray-400">{message}</td></tr>;
}

function Panel({ title, icon, onOpen, children, footer }) {
    return (
        <section className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="material-symbols-outlined text-[19px] text-teal-700">{icon}</span>
                    <h2 className="truncate text-[15px] font-bold text-gray-900">{title}</h2>
                </div>
                {onOpen && (
                    <button type="button" onClick={onOpen} className="text-[12px] font-bold text-teal-700 hover:text-teal-900">
                        Xem tất cả
                    </button>
                )}
            </div>
            <div className="overflow-x-auto">{children}</div>
            {footer && <div className="border-t border-gray-100 px-4 py-2 text-[12px] font-semibold text-gray-500">{footer}</div>}
        </section>
    );
}

function SaveButton({ saving, disabled, onClick, children = 'Lưu' }) {
    return (
        <button
            type="button"
            disabled={disabled || saving}
            onClick={onClick}
            className="inline-flex h-9 items-center justify-center gap-2 rounded bg-teal-700 px-3 text-[13px] font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {saving ? <span className="size-3.5 animate-spin rounded-full border-b-2 border-white" /> : <span className="material-symbols-outlined text-[18px]">save</span>}
            {children}
        </button>
    );
}

function StatusBadge({ children, tone = 'green' }) {
    const className = {
        green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
        amber: 'bg-amber-50 text-amber-700 ring-amber-100',
        red: 'bg-red-50 text-red-700 ring-red-100',
        gray: 'bg-gray-100 text-gray-600 ring-gray-200',
    }[tone];
    return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${className}`}>{children}</span>;
}

function TickButton({ checked, disabled, onClick }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={`inline-flex size-8 items-center justify-center rounded border transition-colors disabled:opacity-40 ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-300 hover:bg-gray-50'}`}
            title="Đủ ca"
        >
            <span className="material-symbols-outlined text-[20px]">{checked ? 'check_box' : 'check_box_outline_blank'}</span>
        </button>
    );
}

function DetailShell({ title, action, children }) {
    return (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <h2 className="text-[16px] font-bold text-gray-900">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

export default function HumanResourcesManagement() {
    const [activeView, setActiveView] = useState('overview');
    const [month, setMonth] = useState(currentMonth());
    const [weekStart, setWeekStart] = useState(weekStartOf(firstDayOfMonth(currentMonth())));
    const departmentFilter = '';
    const [reloadKey, setReloadKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState('');
    const [uploadingKey, setUploadingKey] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [closedMonth, setClosedMonth] = useState('');
    const [data, setData] = useState(BLANK_DATA);
    const [employees, setEmployees] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [employeeProfileKey, setEmployeeProfileKey] = useState('');
    const [zoomImage, setZoomImage] = useState({ url: '', title: '' });

    useEffect(() => {
        let active = true;
        payrollApi.getOverview({ month, department: departmentFilter || undefined })
            .then((response) => {
                if (!active) return;
                const nextData = response?.data?.data || BLANK_DATA;
                const normalizedEmployees = (nextData.employees || []).map(normalizeEmployee);
                setData({ ...nextData, employees: normalizedEmployees });
                setEmployees(normalizedEmployees);
                setShifts(nextData.shifts || []);
                setSchedules(nextData.schedules || []);
                setAttendance(nextData.attendance_records || []);
                setAdjustments(nextData.adjustments || []);
                setError('');
            })
            .catch((err) => {
                if (!active) return;
                setData(BLANK_DATA);
                setEmployees([]);
                setShifts([]);
                setSchedules([]);
                setAttendance([]);
                setAdjustments([]);
                setError(err?.response?.data?.message || err?.message || 'Không tải được dữ liệu nhân sự.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [departmentFilter, month, reloadKey]);

    const scope = data.scope || {};
    const canManagePayroll = Boolean(scope.can_manage_payroll);
    const canEditAttendance = Boolean(scope.can_edit_attendance || scope.can_manage_payroll);
    const canViewSalary = Boolean(scope.can_view_salary);
    const employeeById = useMemo(() => new Map(employees.map((employee) => [String(employee.id), employee])), [employees]);
    const shiftById = useMemo(() => new Map(shifts.map((shift) => [String(shift.id), shift])), [shifts]);
    const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => isoDate(addDays(dateFromInput(weekStart), index))), [weekStart]);
    const payrollSummary = data.payroll_summary || [];
    const filteredEmployees = employees;
    const activeEmployees = filteredEmployees.filter((employee) => employee.status !== 'Nghỉ việc');
    const weekSchedules = schedules.filter((schedule) => weekDays.includes(schedule.work_date) && schedule.status !== 'Huỷ lịch');
    const weekAttendance = attendance.filter((record) => weekDays.includes(record.work_date));
    const employeeOptions = employees.filter((employee) => employee.id).map((employee) => ({
        value: employee.id,
        label: employee.full_name || 'Chưa đặt tên',
    }));
    const userOptions = (data.users || []).map((user) => ({
        value: user.id,
        label: [user.name, user.email].filter(Boolean).join(' - ') || `User #${user.id}`,
    }));
    const shiftOptions = shifts.filter((shift) => shift.id && shift.is_active !== false).map((shift) => ({
        value: shift.id,
        label: `${shift.shift_name || shift.shift_code || 'Ca'} ${formatTime(shift.start_time)}-${formatTime(shift.end_time)}`,
    }));
    const employeeProfile = employees.find((employee) => employeeRowKey(employee) === employeeProfileKey) || null;

    const totalHours = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_hours), 0);
    const totalWorkUnits = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_work_units), 0);
    const totalSalary = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_salary), 0);
    const manualCount = attendance.filter((record) => !isFullAttendance(record)).length;
    const adjustmentImpact = adjustments.reduce((sum, adjustment) => (
        sum + (positiveAdjustment(adjustment.adjustment_type) ? safeNumber(adjustment.amount) : -safeNumber(adjustment.amount))
    ), 0);

    function reloadData() {
        setLoading(true);
        setReloadKey((value) => value + 1);
    }

    function updateRow(setter, target, patch) {
        const targetKey = String(target?.id || target?.uid || '');
        setter((rows) => rows.map((row) => {
            const rowKey = String(row?.id || row?.uid || '');
            return row === target || (targetKey && rowKey === targetKey) ? { ...row, ...patch } : row;
        }));
    }

    function addEmployee() {
        const effectiveFrom = firstDayOfMonth(month);
        const nextEmployee = {
            uid: tempId(),
            employee_code: '',
            full_name: '',
            phone: '',
            address: '',
            identity_card_image_url: '',
            identity_card_front_image_url: '',
            identity_card_back_image_url: '',
            bank_qr_image_url: '',
            user_id: '',
            department: '',
            position: '',
            salary_type: 'theo_gio',
            salary_amount: '',
            salary_effective_from: effectiveFrom,
            salary_rates: [{
                uid: tempId(),
                salary_type: 'theo_gio',
                salary_amount: '',
                standard_work_units: 26,
                effective_from: effectiveFrom,
                notes: '',
            }],
            deleted_salary_rate_ids: [],
            standard_work_units: 26,
            lunch_allowance: '',
            bank_account_note: '',
            status: 'Đang làm',
            notes: '',
        };

        setEmployees((rows) => [...rows, nextEmployee]);
        setEmployeeProfileKey(employeeRowKey(nextEmployee));
    }

    function updateEmployeeProfile(patch) {
        if (!employeeProfile) return;
        const targetKey = employeeRowKey(employeeProfile);
        setEmployees((rows) => rows.map((row) => {
            if (employeeRowKey(row) !== targetKey) return row;
            const nextPatch = typeof patch === 'function' ? patch(row) : patch;
            return { ...row, ...nextPatch };
        }));
    }

    async function uploadEmployeeBankQr(file) {
        if (!employeeProfile || !file) return;

        setUploadingKey(`bank-qr-${employeeRowKey(employeeProfile)}`);
        setMessage('');
        setError('');
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('collection', 'payroll-bank-qr');
            const response = await mediaApi.upload(formData);
            const nextUrl = uploadedImageUrl(response);

            if (!nextUrl) {
                throw new Error('API upload không trả về URL ảnh QR.');
            }

            updateEmployeeProfile({ bank_qr_image_url: nextUrl });
            setMessage('Đã tải QR tài khoản ngân hàng lên. Bấm Lưu hồ sơ để lưu lại.');
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Không tải được ảnh QR ngân hàng.');
        } finally {
            setUploadingKey('');
        }
    }

    async function uploadEmployeeIdentityCard(side, file) {
        if (!employeeProfile || !file) return;

        const field = side === 'back' ? 'identity_card_back_image_url' : 'identity_card_front_image_url';
        const label = side === 'back' ? 'mặt sau' : 'mặt trước';

        setUploadingKey(`identity-${side}-${employeeRowKey(employeeProfile)}`);
        setMessage('');
        setError('');
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('collection', 'payroll-identity-card');
            const response = await mediaApi.upload(formData);
            const nextUrl = uploadedImageUrl(response);

            if (!nextUrl) {
                throw new Error('API upload không trả về URL ảnh CMT/CCCD.');
            }

            updateEmployeeProfile({
                [field]: nextUrl,
                ...(side === 'front' ? { identity_card_image_url: nextUrl } : {}),
            });
            setMessage(`Đã tải ảnh CMT/CCCD ${label}. Bấm Lưu hồ sơ để lưu lại.`);
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || `Không tải được ảnh CMT/CCCD ${label}.`);
        } finally {
            setUploadingKey('');
        }
    }

    async function saveRows(key, request, successMessage) {
        setSavingKey(key);
        setMessage('');
        setError('');
        try {
            await request();
            setMessage(successMessage);
            reloadData();
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Không lưu được dữ liệu.');
        } finally {
            setSavingKey('');
        }
    }

    function changeMonth(value) {
        setMonth(value);
        setWeekStart(weekStartOf(firstDayOfMonth(value)));
        setLoading(true);
        setMessage('');
        setError('');
    }

    function resolveEmployee(row) {
        return employeeById.get(String(row?.payroll_employee_id)) || row?.employee || {};
    }

    function resolveShift(row) {
        return shiftById.get(String(row?.payroll_work_shift_id)) || row?.shift || {};
    }

    function isFullAttendance(record) {
        const shift = resolveShift(record);
        return record?.attendance_status === 'Đi làm' && safeNumber(record.work_units) >= safeNumber(shift.default_work_units || 1);
    }

    function shiftText(shift) {
        return [shift?.shift_name, `${formatTime(shift?.start_time)}-${formatTime(shift?.end_time)}`].filter(Boolean).join(' ');
    }

    function findSchedule(employeeId, date) {
        return schedules.find((schedule) => (
            String(schedule.payroll_employee_id) === String(employeeId)
            && schedule.work_date === date
            && schedule.status !== 'Huỷ lịch'
        ));
    }

    function setScheduleCell(employee, date, shiftId) {
        const existing = findSchedule(employee.id, date);
        const shift = shiftById.get(String(shiftId));

        if (!shiftId) {
            if (!existing) return;
            if (!existing.id) {
                setSchedules((rows) => rows.filter((row) => row !== existing));
                return;
            }
            updateRow(setSchedules, existing, { status: 'Huỷ lịch' });
            return;
        }

        if (existing) {
            updateRow(setSchedules, existing, {
                payroll_work_shift_id: shiftId,
                registered_work_units: shift?.default_work_units || existing.registered_work_units || 1,
                status: 'Đã đăng ký',
            });
            return;
        }

        setSchedules((rows) => [...rows, {
            uid: tempId(),
            work_date: date,
            payroll_employee_id: employee.id,
            payroll_work_shift_id: shiftId,
            registered_work_units: shift?.default_work_units || 1,
            status: 'Đã đăng ký',
            notes: '',
        }]);
    }

    function createAttendanceFromWeek() {
        const existingKeys = new Set(attendance.map((record) => [
            record.work_date,
            record.payroll_employee_id,
            record.payroll_work_shift_id,
        ].join('|')));

        const newRows = weekSchedules
            .filter((schedule) => !existingKeys.has([
                schedule.work_date,
                schedule.payroll_employee_id,
                schedule.payroll_work_shift_id,
            ].join('|')))
            .map((schedule) => {
                const shift = shiftById.get(String(schedule.payroll_work_shift_id)) || {};
                return {
                    uid: tempId(),
                    payroll_schedule_registration_id: schedule.id || null,
                    work_date: schedule.work_date,
                    payroll_employee_id: schedule.payroll_employee_id,
                    payroll_work_shift_id: schedule.payroll_work_shift_id,
                    attendance_status: 'Đi làm',
                    work_units: parseDecimal(schedule.registered_work_units || shift.default_work_units || 1),
                    unit_rate: '',
                    bonus_amount: '',
                    penalty_amount: '',
                    notes: '',
                };
            });

        if (newRows.length === 0) {
            setMessage('Tuần này không có lịch mới cần tạo chấm công.');
            setActiveView('attendance');
            return;
        }

        setAttendance((rows) => [...rows, ...newRows]);
        setMessage(`Đã tạo ${newRows.length} dòng chấm công từ lịch tuần.`);
        setActiveView('attendance');
    }

    function toggleFullAttendance(record) {
        const shift = resolveShift(record);
        const isFull = isFullAttendance(record);
        updateRow(setAttendance, record, {
            attendance_status: isFull ? 'Làm lẻ' : 'Đi làm',
            work_units: isFull ? record.work_units : parseDecimal(shift.default_work_units || 1),
        });
    }

    function setAttendanceHours(record, hours) {
        const shift = resolveShift(record);
        const standardHours = safeNumber(shift.standard_hours);
        updateRow(setAttendance, record, {
            attendance_status: 'Làm lẻ',
            work_units: parseDecimal(standardHours > 0 ? safeNumber(hours) / standardHours : 0),
        });
    }

    async function deleteAdjustment(adjustment) {
        if (!adjustment.id) {
            setAdjustments((rows) => rows.filter((row) => row !== adjustment));
            return;
        }

        const confirmed = window.confirm('Xoá khoản cộng trừ này?');
        if (!confirmed) return;

        setSavingKey(`delete-adjustment-${adjustment.id}`);
        setMessage('');
        setError('');
        try {
            await payrollApi.deleteAdjustment(adjustment.id);
            setMessage('Đã xoá khoản cộng trừ.');
            reloadData();
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Không xoá được khoản cộng trừ.');
        } finally {
            setSavingKey('');
        }
    }

    function exportSalaryCsv() {
        const header = ['Họ tên', 'Loại', 'Tổng giờ', 'Tổng công', 'Cộng', 'Trừ', 'Thực nhận'];
        const body = payrollSummary.map((row) => [
            row.full_name || '',
            employeeTypeLabel(row.salary_type),
            safeNumber(row.total_hours),
            safeNumber(row.total_work_units),
            safeNumber(row.total_bonus),
            safeNumber(row.total_penalty),
            row.total_salary ?? '',
        ]);
        const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bang-luong-${month}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function renderOverview() {
        return (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-3">
                    <Panel title="1. Nhân viên" icon="groups" onOpen={() => setActiveView('employees')} footer={`Tổng: ${employees.length} nhân viên`}>
                        <MiniTable
                            columns={['Tên', 'Loại', 'Lương', 'Trạng thái']}
                            rows={employees.slice(0, 4)}
                            renderRow={(employee) => (
                                <tr key={employee.id || employee.uid} className="hover:bg-gray-50">
                                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{employee.full_name || 'Chưa đặt tên'}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{isFullTime(employee) ? 'Full-time' : 'Part-time'}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">{formatSalary(employee.salary_amount, employee.salary_type)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2"><StatusBadge tone={employee.status === 'Đang làm' ? 'green' : 'amber'}>{employee.status || 'Đang làm'}</StatusBadge></td>
                                </tr>
                            )}
                        />
                    </Panel>

                    <Panel title="2. Lịch làm" icon="calendar_month" onOpen={() => setActiveView('schedule')} footer={`Tổng: ${weekSchedules.length} lịch tuần này`}>
                        <MiniTable
                            columns={['Nhân viên', 'Ngày', 'Ca', 'Giờ ca']}
                            rows={weekSchedules.slice(0, 4)}
                            renderRow={(schedule) => {
                                const employee = resolveEmployee(schedule);
                                const shift = resolveShift(schedule);
                                return (
                                    <tr key={schedule.id || schedule.uid} className="hover:bg-gray-50">
                                        <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{employee.full_name || '-'}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{weekday(schedule.work_date)}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{shift.shift_name || '-'}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{formatTime(shift.start_time)}-{formatTime(shift.end_time)}</td>
                                    </tr>
                                );
                            }}
                        />
                    </Panel>

                    <Panel title="3. Chấm công" icon="fact_check" onOpen={() => setActiveView('attendance')} footer={`Cần nhập tay: ${manualCount}`}>
                        <MiniTable
                            columns={['Ngày', 'Nhân viên', 'Đủ ca', 'Giờ/Công']}
                            rows={weekAttendance.slice(0, 4)}
                            renderRow={(record) => {
                                const employee = resolveEmployee(record);
                                const shift = resolveShift(record);
                                return (
                                    <tr key={record.id || record.uid} className="hover:bg-gray-50">
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{shortDate(record.work_date)}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{employee.full_name || '-'}</td>
                                        <td className="border-b border-gray-100 px-3 py-2">
                                            <span className={`material-symbols-outlined text-[19px] ${isFullAttendance(record) ? 'text-emerald-700' : 'text-gray-300'}`}>
                                                {isFullAttendance(record) ? 'check_box' : 'check_box_outline_blank'}
                                            </span>
                                        </td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-700">
                                            {formatDecimal(safeNumber(record.work_units) * safeNumber(shift.standard_hours))} / {formatDecimal(record.work_units)}
                                        </td>
                                    </tr>
                                );
                            }}
                        />
                    </Panel>

                    <Panel title="4. Bảng lương tháng" icon="payments" onOpen={() => setActiveView('salary')} footer={`Tổng quỹ lương tạm tính: ${formatMoney(totalSalary)}`}>
                        <MiniTable
                            columns={['Nhân viên', 'Tổng giờ', 'Tổng công', 'Thực nhận']}
                            rows={payrollSummary.slice(0, 4)}
                            renderRow={(row) => (
                                <tr key={row.payroll_employee_id || row.employee_code} className="hover:bg-gray-50">
                                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{row.full_name || '-'}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">{formatDecimal(row.total_hours)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">{formatDecimal(row.total_work_units)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right font-bold text-teal-700">{formatMoney(row.total_salary)}</td>
                                </tr>
                            )}
                        />
                    </Panel>

                    <Panel title="5. Tạm ứng / Cộng trừ" icon="receipt_long" onOpen={() => setActiveView('adjustments')} footer={`Tổng ảnh hưởng: ${adjustmentImpact >= 0 ? '+' : '-'}${formatMoney(Math.abs(adjustmentImpact))}`}>
                        <MiniTable
                            columns={['Ngày', 'Nhân viên', 'Loại', 'Số tiền']}
                            rows={adjustments.slice(0, 4)}
                            renderRow={(adjustment) => {
                                const employee = resolveEmployee(adjustment);
                                const positive = positiveAdjustment(adjustment.adjustment_type);
                                return (
                                    <tr key={adjustment.id || adjustment.uid} className="hover:bg-gray-50">
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{shortDate(adjustment.adjustment_date)}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{employee.full_name || '-'}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{ADJUSTMENT_TYPES.find((item) => item.value === adjustment.adjustment_type)?.label || 'Trừ khác'}</td>
                                        <td className={`border-b border-gray-100 px-3 py-2 text-right font-bold ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                                            {positive ? '+' : '-'}{formatMoney(adjustment.amount)}
                                        </td>
                                    </tr>
                                );
                            }}
                        />
                    </Panel>

                    <Panel title="6. Báo cáo" icon="bar_chart" onOpen={() => setActiveView('reports')} footer={`Tổng tháng: ${formatMoney(totalSalary)}`}>
                        <MiniTable
                            columns={['Tháng', 'Tổng giờ', 'Quỹ lương', 'Xuất']}
                            rows={[month]}
                            renderRow={(item) => (
                                <tr key={item} className="hover:bg-gray-50">
                                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{item}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right text-gray-600">{formatDecimal(totalHours)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-right font-bold text-teal-700">{formatMoney(totalSalary)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2"><button type="button" onClick={exportSalaryCsv} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Excel</button></td>
                                </tr>
                            )}
                        />
                    </Panel>
                </div>

                <aside className="h-fit rounded-lg border border-gray-200 bg-white p-4">
                    <h2 className="text-[18px] font-bold text-gray-900">Tháng {month.replace('-', '/')}</h2>
                    <div className="mt-4 space-y-4">
                        <SummaryLine icon="groups" label="Nhân viên" value={`${activeEmployees.length} nhân viên`} />
                        <SummaryLine icon="warning" label="Cần nhập tay" value={manualCount} tone="amber" />
                        <SummaryLine icon="payments" label="Lương tạm tính" value={formatMoney(totalSalary)} tone="green" />
                    </div>
                    <div className="mt-5 grid gap-3">
                        <button type="button" onClick={() => { reloadData(); setActiveView('salary'); }} className="inline-flex h-12 items-center justify-center gap-2 rounded bg-teal-700 px-4 text-[15px] font-bold text-white shadow-sm hover:bg-teal-800">
                            <span className="material-symbols-outlined text-[20px]">calculate</span>
                            Tính lương
                        </button>
                        <button type="button" onClick={() => { setClosedMonth(month); setMessage(`Đã đánh dấu chốt tháng ${month}.`); }} className="inline-flex h-12 items-center justify-center gap-2 rounded bg-emerald-700 px-4 text-[15px] font-bold text-white shadow-sm hover:bg-emerald-800">
                            <span className="material-symbols-outlined text-[20px]">lock</span>
                            Chốt tháng
                        </button>
                    </div>
                    <div className="mt-5 rounded border border-blue-100 bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-700">
                        Hãy kiểm tra chấm công trước khi tính lương.
                    </div>
                    {closedMonth === month && <div className="mt-3 rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-700">Tháng này đã được đánh dấu chốt.</div>}
                </aside>
            </div>
        );
    }

    function renderEmployees() {
        return (
            <DetailShell title="Nhân viên" action={(
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!canManagePayroll} onClick={addEmployee} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Thêm nhân viên
                    </button>
                    <SaveButton saving={savingKey === 'employees'} disabled={!canManagePayroll} onClick={() => saveRows('employees', () => payrollApi.saveEmployees(employeePayload(employees)), 'Đã lưu nhân viên.')}>Áp dụng thay đổi</SaveButton>
                </div>
            )}>
                <DataTable columns={['Tên nhân viên', 'Loại', 'Lương', 'Áp dụng từ', 'Số điện thoại', 'QR ngân hàng', 'Địa chỉ', 'Trạng thái', 'Hồ sơ']} minWidth={1420}>
                    {employees.length === 0 ? <EmptyRow colSpan={9} message="Chưa có nhân viên." /> : employees.map((employee) => (
                        <tr key={employee.id || employee.uid} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2">
                                <TextInput disabled={!canManagePayroll} value={employee.full_name} onChange={(value) => updateRow(setEmployees, employee, { full_name: value })} placeholder="Tên nhân viên" />
                            </td>
                            <td className="px-3 py-2"><SelectInput disabled={!canManagePayroll} value={employee.salary_type} onChange={(value) => updateRow(setEmployees, employee, { salary_type: value, salary_effective_from: dateValue(employee.salary_effective_from) || firstDayOfMonth(month) })} options={EMPLOYEE_TYPES} /></td>
                            <td className="px-3 py-2">{canViewSalary ? <MoneyInput disabled={!canManagePayroll} value={employee.salary_amount} suffix={salaryUnitLabel(employee.salary_type)} onChange={(value) => updateRow(setEmployees, employee, { salary_amount: value, salary_effective_from: dateValue(employee.salary_effective_from) || firstDayOfMonth(month) })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                            <td className="px-3 py-2">{canViewSalary ? <TextInput type="date" disabled={!canManagePayroll} value={dateValue(employee.salary_effective_from)} onChange={(value) => updateRow(setEmployees, employee, { salary_effective_from: value })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                            <td className="px-3 py-2"><TextInput disabled={!canManagePayroll} value={employee.phone} onChange={(value) => updateRow(setEmployees, employee, { phone: value })} placeholder="Số điện thoại" /></td>
                            <td className="px-3 py-2">
                                <BankQrPreview
                                    url={canViewSalary ? employee.bank_qr_image_url : ''}
                                    sizeClass="size-24"
                                    onZoom={() => setZoomImage({ url: employee.bank_qr_image_url, title: 'QR tài khoản ngân hàng' })}
                                />
                            </td>
                            <td className="px-3 py-2">
                                <div className="max-w-[280px] truncate text-[13px] text-gray-700" title={employee.address || ''}>
                                    {employee.address || <span className="text-gray-400">Chưa nhập</span>}
                                </div>
                            </td>
                            <td className="px-3 py-2"><SelectInput disabled={!canManagePayroll} value={employee.status} onChange={(value) => updateRow(setEmployees, employee, { status: value })} options={EMPLOYEE_STATUS} /></td>
                            <td className="px-3 py-2">
                                <button type="button" onClick={() => setEmployeeProfileKey(employeeRowKey(employee))} className="inline-flex h-9 items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 text-[13px] font-bold text-teal-700 hover:bg-teal-100">
                                    <span className="material-symbols-outlined text-[18px]">badge</span>
                                    Hồ sơ
                                </button>
                            </td>
                        </tr>
                    ))}
                </DataTable>
            </DetailShell>
        );
    }

    function renderSchedule() {
        return (
            <div className="grid gap-4">
                <DetailShell title="Ca làm" action={(
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!canManagePayroll} onClick={() => setShifts((rows) => [...rows, {
                            uid: tempId(),
                            shift_code: '',
                            shift_name: '',
                            start_time: '08:00',
                            end_time: '12:00',
                            standard_hours: 4,
                            default_work_units: 1,
                            wage_multiplier: 1,
                            is_active: true,
                            sort_order: rows.length * 10 + 10,
                            notes: '',
                        }])} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Thêm ca
                        </button>
                        <SaveButton saving={savingKey === 'shifts'} disabled={!canManagePayroll} onClick={() => saveRows('shifts', () => payrollApi.saveShifts(shiftPayload(shifts)), 'Đã lưu ca làm.')} />
                    </div>
                )}>
                    <DataTable columns={['Mã ca', 'Tên ca', 'Bắt đầu', 'Kết thúc', 'Giờ', 'Công', 'Hệ số', 'Hoạt động', 'Ghi chú']} minWidth={980}>
                        {shifts.length === 0 ? <EmptyRow colSpan={9} message="Chưa có ca làm." /> : shifts.map((shift) => (
                            <tr key={shift.id || shift.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2"><TextInput disabled={!canManagePayroll} value={shift.shift_code} onChange={(value) => updateRow(setShifts, shift, { shift_code: value })} placeholder="S" /></td>
                                <td className="px-3 py-2"><TextInput disabled={!canManagePayroll} value={shift.shift_name} onChange={(value) => updateRow(setShifts, shift, { shift_name: value })} placeholder="Ca sáng" /></td>
                                <td className="px-3 py-2"><TextInput type="time" disabled={!canManagePayroll} value={formatTime(shift.start_time)} onChange={(value) => updateRow(setShifts, shift, { start_time: value })} /></td>
                                <td className="px-3 py-2"><TextInput type="time" disabled={!canManagePayroll} value={formatTime(shift.end_time)} onChange={(value) => updateRow(setShifts, shift, { end_time: value })} /></td>
                                <td className="px-3 py-2"><DecimalInput disabled={!canManagePayroll} value={shift.standard_hours} onChange={(value) => updateRow(setShifts, shift, { standard_hours: value })} /></td>
                                <td className="px-3 py-2"><DecimalInput disabled={!canManagePayroll} value={shift.default_work_units} onChange={(value) => updateRow(setShifts, shift, { default_work_units: value })} /></td>
                                <td className="px-3 py-2"><DecimalInput disabled={!canManagePayroll} value={shift.wage_multiplier} onChange={(value) => updateRow(setShifts, shift, { wage_multiplier: value })} /></td>
                                <td className="px-3 py-2">
                                    <button
                                        type="button"
                                        disabled={!canManagePayroll}
                                        onClick={() => updateRow(setShifts, shift, { is_active: !shift.is_active })}
                                        className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-[12px] font-bold disabled:opacity-50 ${shift.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{shift.is_active ? 'toggle_on' : 'toggle_off'}</span>
                                        {shift.is_active ? 'Đang dùng' : 'Tắt'}
                                    </button>
                                </td>
                                <td className="px-3 py-2"><TextInput disabled={!canManagePayroll} value={shift.notes} onChange={(value) => updateRow(setShifts, shift, { notes: value })} /></td>
                            </tr>
                        ))}
                    </DataTable>
                </DetailShell>

                <DetailShell title="Đăng ký lịch làm theo tuần" action={(
                    <div className="flex flex-wrap gap-2">
                        <input type="date" value={weekStart} onChange={(event) => setWeekStart(weekStartOf(event.target.value))} className="h-9 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                        <SaveButton saving={savingKey === 'schedules'} disabled={!canEditAttendance} onClick={() => saveRows('schedules', () => payrollApi.saveSchedules(schedulePayload(schedules)), 'Đã lưu lịch làm.')} />
                        <button type="button" disabled={!canEditAttendance} onClick={createAttendanceFromWeek} className="inline-flex h-9 items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 text-[13px] font-bold text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            Tạo chấm công
                        </button>
                    </div>
                )}>
                    <DataTable columns={['Nhân viên', ...weekDays.map((date) => `${weekday(date)} ${shortDate(date)}`)]} minWidth={1180}>
                        {activeEmployees.length === 0 ? <EmptyRow colSpan={8} message="Chưa có nhân viên." /> : activeEmployees.map((employee) => (
                            <tr key={employee.id || employee.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2">
                                    <div className="font-bold text-gray-800">{employee.full_name || 'Chưa đặt tên'}</div>
                                    <div className="text-[11px] font-semibold text-gray-400">{isFullTime(employee) ? 'Full-time' : 'Part-time'}</div>
                                </td>
                                {weekDays.map((date) => {
                                    const schedule = findSchedule(employee.id, date);
                                    return (
                                        <td key={`${employee.id}-${date}`} className="min-w-[136px] px-2 py-2">
                                            <SelectInput disabled={!canEditAttendance || !employee.id} value={schedule?.payroll_work_shift_id || ''} onChange={(value) => setScheduleCell(employee, date, value)} options={shiftOptions} placeholder="Không lịch" />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </DataTable>
                </DetailShell>
            </div>
        );
    }

    function renderAttendance() {
        return (
            <DetailShell title="Chấm công nhanh" action={(
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!canEditAttendance} onClick={() => setAttendance((rows) => [...rows, {
                        uid: tempId(),
                        work_date: weekStart,
                        payroll_employee_id: '',
                        payroll_work_shift_id: '',
                        attendance_status: 'Đi làm',
                        work_units: 1,
                        unit_rate: '',
                        bonus_amount: '',
                        penalty_amount: '',
                        notes: '',
                    }])} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Thêm dòng lẻ
                    </button>
                    <SaveButton saving={savingKey === 'attendance'} disabled={!canEditAttendance} onClick={() => saveRows('attendance', () => payrollApi.saveAttendance(attendancePayload(attendance)), 'Đã lưu chấm công.')} />
                </div>
            )}>
                <DataTable columns={['Ngày', 'Nhân viên', 'Ca', 'Đủ ca', 'Giờ thực tế', 'Công tính', 'Trạng thái', 'Ghi chú']} minWidth={1120}>
                    {weekAttendance.length === 0 ? <EmptyRow colSpan={8} message="Tuần này chưa có chấm công." /> : weekAttendance.map((record) => {
                        const employee = resolveEmployee(record);
                        const shift = resolveShift(record);
                        const isFull = isFullAttendance(record);
                        const hours = safeNumber(record.work_units) * safeNumber(shift.standard_hours);
                        return (
                            <tr key={record.id || record.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2"><TextInput type="date" disabled={!canEditAttendance} value={record.work_date} onChange={(value) => updateRow(setAttendance, record, { work_date: value })} /></td>
                                <td className="px-3 py-2">
                                    <SelectInput disabled={!canEditAttendance} value={record.payroll_employee_id} onChange={(value) => updateRow(setAttendance, record, { payroll_employee_id: value })} options={employeeOptions} placeholder="Nhân viên" />
                                    <div className="mt-1 text-[11px] font-semibold text-gray-400">{isFullTime(employee) ? 'Full-time' : 'Part-time'}</div>
                                </td>
                                <td className="px-3 py-2"><SelectInput disabled={!canEditAttendance} value={record.payroll_work_shift_id} onChange={(value) => updateRow(setAttendance, record, { payroll_work_shift_id: value, work_units: shiftById.get(String(value))?.default_work_units || record.work_units || 1 })} options={shiftOptions} placeholder="Ca" /></td>
                                <td className="px-3 py-2 text-center"><TickButton disabled={!canEditAttendance} checked={isFull} onClick={() => toggleFullAttendance(record)} /></td>
                                <td className="px-3 py-2"><DecimalInput disabled={!canEditAttendance || isFull} value={formatDecimal(hours)} onChange={(value) => setAttendanceHours(record, value)} /></td>
                                <td className="px-3 py-2"><DecimalInput disabled={!canEditAttendance || isFull} value={record.work_units} onChange={(value) => updateRow(setAttendance, record, { work_units: value, attendance_status: 'Làm lẻ' })} /></td>
                                <td className="px-3 py-2"><SelectInput disabled={!canEditAttendance} value={record.attendance_status} onChange={(value) => updateRow(setAttendance, record, { attendance_status: value })} options={ATTENDANCE_STATUS} /></td>
                                <td className="px-3 py-2"><TextInput disabled={!canEditAttendance} value={record.notes} onChange={(value) => updateRow(setAttendance, record, { notes: value })} placeholder={shiftText(shift)} /></td>
                            </tr>
                        );
                    })}
                </DataTable>
            </DetailShell>
        );
    }

    function renderSalary() {
        return (
            <DetailShell title={`Bảng lương tháng ${month}`} action={(
                <button type="button" onClick={exportSalaryCsv} className="inline-flex h-9 items-center gap-2 rounded bg-teal-700 px-3 text-[13px] font-bold text-white hover:bg-teal-800">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Xuất Excel
                </button>
            )}>
                <DataTable columns={['Nhân viên', 'Loại', 'Tổng giờ', 'Tổng công', 'Cộng', 'Trừ', 'Thực nhận']} minWidth={900}>
                    {payrollSummary.length === 0 ? <EmptyRow colSpan={7} message="Chưa có dữ liệu lương." /> : payrollSummary.map((row) => (
                        <tr key={row.payroll_employee_id || row.employee_code} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2">
                                <div className="font-bold text-gray-800">{row.full_name || '-'}</div>
                                <div className="text-[11px] font-semibold text-gray-400">{row.employee_code || '-'}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{employeeTypeLabel(row.salary_type)}</td>
                            <td className="px-3 py-2 text-right">{formatDecimal(row.total_hours)}</td>
                            <td className="px-3 py-2 text-right">{formatDecimal(row.total_work_units)}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{formatMoney(row.total_bonus)}</td>
                            <td className="px-3 py-2 text-right text-red-600">{formatMoney(row.total_penalty)}</td>
                            <td className="px-3 py-2 text-right font-bold text-teal-700">{formatMoney(row.total_salary)}</td>
                        </tr>
                    ))}
                </DataTable>
            </DetailShell>
        );
    }

    function renderAdjustments() {
        return (
            <DetailShell title="Tạm ứng / cộng trừ" action={(
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={!canEditAttendance || !canViewSalary} onClick={() => setAdjustments((rows) => [...rows, {
                        uid: tempId(),
                        adjustment_date: firstDayOfMonth(month),
                        payroll_employee_id: '',
                        adjustment_type: 'advance',
                        amount: '',
                        notes: '',
                    }])} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Thêm khoản
                    </button>
                    <SaveButton saving={savingKey === 'adjustments'} disabled={!canEditAttendance || !canViewSalary} onClick={() => saveRows('adjustments', () => payrollApi.saveAdjustments(adjustmentPayload(adjustments)), 'Đã lưu cộng trừ.')} />
                </div>
            )}>
                <DataTable columns={['Ngày', 'Nhân viên', 'Loại', 'Số tiền', 'Ảnh hưởng', 'Ghi chú', 'Xoá']} minWidth={1040}>
                    {adjustments.length === 0 ? <EmptyRow colSpan={7} message="Chưa có khoản cộng trừ." /> : adjustments.map((adjustment) => {
                        const positive = positiveAdjustment(adjustment.adjustment_type);
                        return (
                            <tr key={adjustment.id || adjustment.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2"><TextInput type="date" disabled={!canEditAttendance || !canViewSalary} value={adjustment.adjustment_date} onChange={(value) => updateRow(setAdjustments, adjustment, { adjustment_date: value })} /></td>
                                <td className="px-3 py-2"><SelectInput disabled={!canEditAttendance || !canViewSalary} value={adjustment.payroll_employee_id} onChange={(value) => updateRow(setAdjustments, adjustment, { payroll_employee_id: value })} options={employeeOptions} placeholder="Nhân viên" /></td>
                                <td className="px-3 py-2"><SelectInput disabled={!canEditAttendance || !canViewSalary} value={adjustment.adjustment_type} onChange={(value) => updateRow(setAdjustments, adjustment, { adjustment_type: value })} options={ADJUSTMENT_TYPES} /></td>
                                <td className="px-3 py-2">{canViewSalary ? <MoneyInput disabled={!canEditAttendance} value={adjustment.amount} onChange={(value) => updateRow(setAdjustments, adjustment, { amount: value })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                                <td className={`px-3 py-2 text-right font-bold ${positive ? 'text-emerald-700' : 'text-red-600'}`}>{adjustment.amount ? `${positive ? '+' : '-'}${formatMoney(adjustment.amount)}` : '-'}</td>
                                <td className="px-3 py-2"><TextInput disabled={!canEditAttendance || !canViewSalary} value={adjustment.notes} onChange={(value) => updateRow(setAdjustments, adjustment, { notes: value })} /></td>
                                <td className="px-3 py-2 text-center">
                                    <button type="button" disabled={!canEditAttendance || !canViewSalary || savingKey === `delete-adjustment-${adjustment.id}`} onClick={() => deleteAdjustment(adjustment)} className="inline-flex size-8 items-center justify-center rounded border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40" title="Xoá">
                                        <span className="material-symbols-outlined text-[17px]">delete</span>
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </DataTable>
            </DetailShell>
        );
    }

    function renderReports() {
        return (
            <DetailShell title="Báo cáo" action={(
                <button type="button" onClick={exportSalaryCsv} className="inline-flex h-9 items-center gap-2 rounded bg-teal-700 px-3 text-[13px] font-bold text-white hover:bg-teal-800">
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    Xuất Excel
                </button>
            )}>
                <DataTable columns={['Tháng', 'Nhân viên', 'Tổng giờ', 'Tổng công', 'Quỹ lương', 'Trạng thái']} minWidth={820}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-3 font-bold text-gray-800">{month}</td>
                        <td className="px-3 py-3 text-right">{activeEmployees.length}</td>
                        <td className="px-3 py-3 text-right">{formatDecimal(totalHours)}</td>
                        <td className="px-3 py-3 text-right">{formatDecimal(totalWorkUnits)}</td>
                        <td className="px-3 py-3 text-right font-bold text-teal-700">{formatMoney(totalSalary)}</td>
                        <td className="px-3 py-3">{closedMonth === month ? <StatusBadge>Đã chốt</StatusBadge> : <StatusBadge tone="amber">Đang tính</StatusBadge>}</td>
                    </tr>
                </DataTable>
            </DetailShell>
        );
    }

    function renderActiveView() {
        if (activeView === 'employees') return renderEmployees();
        if (activeView === 'schedule') return renderSchedule();
        if (activeView === 'attendance') return renderAttendance();
        if (activeView === 'salary') return renderSalary();
        if (activeView === 'adjustments') return renderAdjustments();
        if (activeView === 'reports') return renderReports();
        return renderOverview();
    }

    return (
        <>
            <div className="h-full min-h-[calc(100vh-4rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="flex h-full min-h-[calc(100vh-4rem)]">
                    <aside className="hidden w-[244px] shrink-0 border-r border-gray-200 bg-white lg:block">
                        <button type="button" onClick={() => setActiveView('overview')} className="flex w-full items-center gap-3 border-b border-gray-200 px-5 py-5 text-left">
                            <span className="material-symbols-outlined flex size-10 items-center justify-center rounded bg-teal-700 text-white">groups</span>
                            <span className="text-[20px] font-bold text-gray-900">Quản lí nhân sự</span>
                        </button>
                        <nav className="space-y-1 p-3">
                            {NAV_ITEMS.map((item) => {
                                const active = activeView === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setActiveView(item.id)}
                                        className={`flex w-full items-center gap-3 rounded px-3 py-3 text-left text-[14px] font-semibold transition-colors ${active ? 'bg-teal-50 text-teal-700' : 'text-gray-700 hover:bg-gray-50'}`}
                                    >
                                        <span className={`material-symbols-outlined text-[21px] ${active ? 'text-teal-700' : 'text-gray-500'}`}>{item.icon}</span>
                                        {item.label}
                                    </button>
                                );
                            })}
                        </nav>
                    </aside>

                    <main className="min-w-0 flex-1 overflow-auto bg-gray-50">
                        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
                            <button type="button" onClick={() => setActiveView('overview')} className="inline-flex size-10 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                                <span className="material-symbols-outlined text-[22px]">menu</span>
                            </button>
                            <div className="flex items-center gap-3 text-gray-500">
                                <span className="material-symbols-outlined">notifications</span>
                                <span className="material-symbols-outlined">account_circle</span>
                                <span className="hidden text-[13px] font-semibold text-gray-700 sm:block">Admin</span>
                            </div>
                        </div>

                        <div className="space-y-4 p-4 md:p-5">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                <div>
                                    <h1 className="text-[24px] font-bold text-gray-900">Tổng quan bảng nhân sự & chấm công</h1>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[12px] font-semibold text-gray-500">
                                        <span>{activeEmployees.length} nhân viên</span>
                                        <span>•</span>
                                        <span>{formatDecimal(totalHours)} giờ</span>
                                        <span>•</span>
                                        <span>{formatDecimal(totalWorkUnits)} công</span>
                                    </div>
                                </div>
                                <div className="grid w-full gap-3 rounded border border-gray-200 bg-white p-3 shadow-sm sm:grid-cols-3 xl:w-[560px]">
                                    <label className="grid gap-1">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tháng</span>
                                        <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="h-9 rounded border border-gray-200 bg-white px-2.5 text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                                    </label>
                                    <div>
                                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tổng công</span>
                                        <p className="mt-2 text-[16px] font-bold text-gray-900">{formatDecimal(totalWorkUnits)}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tổng lương</span>
                                        <p className="mt-2 text-[16px] font-bold text-teal-700">{formatMoney(totalSalary)}</p>
                                    </div>
                                </div>
                            </div>

                            {message && <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800">{message}</div>}
                            {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{error}</div>}

                            <div className="relative">
                                {renderActiveView()}
                                {loading && (
                                    <div className="absolute inset-0 z-20 flex min-h-[260px] items-center justify-center rounded-lg bg-white/70 backdrop-blur-sm">
                                        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-[13px] font-bold text-gray-700 shadow-sm">
                                            <span className="size-4 animate-spin rounded-full border-b-2 border-teal-700" />
                                            Đang tải dữ liệu...
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </main>
                </div>
            </div>
            <EmployeeProfileModal
                employee={employeeProfile}
                userOptions={userOptions}
                canEdit={canManagePayroll}
                canViewSalary={canViewSalary}
                saving={savingKey === 'employee-profile'}
                uploadingQr={uploadingKey === `bank-qr-${employeeRowKey(employeeProfile)}`}
                uploadingIdentityFront={uploadingKey === `identity-front-${employeeRowKey(employeeProfile)}`}
                uploadingIdentityBack={uploadingKey === `identity-back-${employeeRowKey(employeeProfile)}`}
                onChange={updateEmployeeProfile}
                onUploadIdentityCard={uploadEmployeeIdentityCard}
                onUploadBankQr={uploadEmployeeBankQr}
                onZoomImage={setZoomImage}
                onClose={() => setEmployeeProfileKey('')}
                onSave={() => saveRows('employee-profile', () => payrollApi.saveEmployees(employeePayload(employees)), 'Đã lưu hồ sơ nhân viên.')}
            />
            <ImageZoomModal imageUrl={zoomImage.url} title={zoomImage.title} onClose={() => setZoomImage({ url: '', title: '' })} />
        </>
    );
}

function SummaryLine({ icon, label, value, tone = 'teal' }) {
    const iconClass = {
        teal: 'bg-teal-50 text-teal-700',
        amber: 'bg-amber-50 text-amber-700',
        green: 'bg-emerald-50 text-emerald-700',
    }[tone] || 'bg-teal-50 text-teal-700';

    return (
        <div className="flex items-center gap-3">
            <span className={`material-symbols-outlined flex size-10 items-center justify-center rounded ${iconClass}`}>{icon}</span>
            <div>
                <p className="text-[12px] font-semibold text-gray-500">{label}</p>
                <p className="text-[18px] font-bold text-gray-900">{value}</p>
            </div>
        </div>
    );
}

function BankQrPreview({ url, sizeClass = 'size-24', onZoom, emptyText = 'Chưa có QR' }) {
    const imageUrl = String(url || '').trim();

    if (!imageUrl) {
        return (
            <div className={`${sizeClass} flex items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 px-2 text-center text-[11px] font-bold text-gray-400`}>
                {emptyText}
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={onZoom}
            className={`${sizeClass} group relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-teal-200 bg-white p-1 shadow-sm hover:border-teal-500`}
            title="Bấm để phóng to QR"
        >
            <img src={imageUrl} alt="QR tài khoản ngân hàng" className="h-full w-full object-contain" />
            <span className="pointer-events-none absolute bottom-1 right-1 flex size-6 items-center justify-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <span className="material-symbols-outlined text-[16px]">zoom_in</span>
            </span>
        </button>
    );
}

function ImageZoomModal({ imageUrl, title, onClose }) {
    if (!imageUrl) return null;

    return (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 px-4 py-6" onClick={onClose}>
            <section className="relative max-h-[94vh] max-w-[94vw] rounded-lg bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between gap-4">
                    <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
                    <button type="button" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="Đóng">
                        <span className="material-symbols-outlined text-[21px]">close</span>
                    </button>
                </div>
                <img src={imageUrl} alt={title} className="max-h-[82vh] max-w-[88vw] object-contain" />
            </section>
        </div>
    );
}

function IdentityCardUploadCard({ title, imageUrl, canEdit, uploading, onUpload, onRemove, onZoom }) {
    const source = imageSource(imageUrl);

    return (
        <section className="rounded border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold text-gray-700">{title}</h3>
                <div className="flex gap-2">
                    <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-teal-200 bg-white px-2.5 text-[12px] font-bold text-teal-700 hover:bg-teal-50 ${(!canEdit || uploading) ? 'pointer-events-none opacity-50' : ''}`}>
                        {uploading ? <span className="size-3 animate-spin rounded-full border-b-2 border-teal-700" /> : <span className="material-symbols-outlined text-[16px]">upload</span>}
                        Tải ảnh
                        <input
                            type="file"
                            accept="image/*"
                            disabled={!canEdit || uploading}
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) onUpload(file);
                            }}
                            className="hidden"
                        />
                    </label>
                    <button type="button" disabled={!canEdit || !source} onClick={onRemove} className="inline-flex h-8 items-center gap-1.5 rounded border border-gray-200 bg-white px-2.5 text-[12px] font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        Xoá
                    </button>
                </div>
            </div>
            {source ? (
                <button type="button" onClick={() => onZoom(source)} className="group relative flex h-36 w-full items-center justify-center overflow-hidden rounded border border-gray-200 bg-white p-2 hover:border-teal-500" title="Bấm để phóng to ảnh">
                    <img src={source} alt={title} className="h-full w-full object-contain" />
                    <span className="pointer-events-none absolute bottom-2 right-2 flex size-7 items-center justify-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="material-symbols-outlined text-[17px]">zoom_in</span>
                    </span>
                </button>
            ) : (
                <div className="flex h-36 w-full items-center justify-center rounded border border-dashed border-gray-200 bg-white text-[12px] font-bold text-gray-400">
                    Chưa có ảnh
                </div>
            )}
        </section>
    );
}

function SalaryHistoryEditor({ employee, canEdit, onChange }) {
    const rows = salaryRatesForEmployee(employee);
    const buildSalaryHistoryPatch = (sourceEmployee, nextRows, extraPatch = {}) => {
        const sortedRows = nextRows
            .map((rate) => normalizeSalaryRate(rate, sourceEmployee))
            .sort((left, right) => dateValue(left.effective_from).localeCompare(dateValue(right.effective_from)));
        const latestRate = [...sortedRows]
            .filter((rate) => dateValue(rate.effective_from))
            .sort((left, right) => dateValue(right.effective_from).localeCompare(dateValue(left.effective_from)))[0];

        return {
            salary_rates: sortedRows,
            ...(latestRate ? {
                salary_type: latestRate.salary_type || sourceEmployee.salary_type,
                salary_amount: latestRate.salary_amount ?? sourceEmployee.salary_amount,
                salary_effective_from: dateValue(latestRate.effective_from),
                standard_work_units: latestRate.standard_work_units ?? sourceEmployee.standard_work_units,
            } : {}),
            ...extraPatch,
        };
    };
    const applyRows = (producer, extraPatch = {}) => {
        onChange((currentEmployee) => {
            const currentRows = salaryRatesForEmployee(currentEmployee);
            const nextRows = typeof producer === 'function' ? producer(currentRows, currentEmployee) : producer;
            const nextExtraPatch = typeof extraPatch === 'function' ? extraPatch(currentEmployee) : extraPatch;
            return buildSalaryHistoryPatch(currentEmployee, nextRows, nextExtraPatch);
        });
    };
    const updateRate = (target, index, patch) => {
        const key = salaryRateKey(target, index);
        applyRows((currentRows) => currentRows.map((rate, rateIndex) => (
            salaryRateKey(rate, rateIndex) === key ? { ...rate, ...patch } : rate
        )));
    };
    const addRate = () => {
        applyRows((currentRows, currentEmployee) => [...currentRows, {
            uid: tempId(),
            salary_type: currentEmployee.salary_type || 'theo_gio',
            salary_amount: currentEmployee.salary_amount || '',
            standard_work_units: currentEmployee.standard_work_units || 26,
            effective_from: dateValue(currentEmployee.salary_effective_from) || firstDayOfMonth(currentMonth()),
            notes: '',
        }]);
    };
    const removeRate = (target, index) => {
        const key = salaryRateKey(target, index);
        applyRows(
            (currentRows) => currentRows.filter((rate, rateIndex) => salaryRateKey(rate, rateIndex) !== key),
            (currentEmployee) => ({
                deleted_salary_rate_ids: target.id
                    ? [...(currentEmployee.deleted_salary_rate_ids || []), target.id]
                    : (currentEmployee.deleted_salary_rate_ids || []),
            })
        );
    };

    return (
        <section className="rounded border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                <h3 className="text-[12px] font-bold text-gray-700">Lịch sử tăng lương</h3>
                <button type="button" disabled={!canEdit} onClick={addRate} className="inline-flex h-8 items-center gap-1.5 rounded border border-teal-200 bg-white px-2.5 text-[12px] font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Thêm mốc lương
                </button>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
                    <thead>
                        <tr className="bg-white">
                            <th className="border-b border-gray-200 px-3 py-2 font-bold text-gray-500">Áp dụng từ</th>
                            <th className="border-b border-gray-200 px-3 py-2 font-bold text-gray-500">Loại</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-right font-bold text-gray-500">Mức lương</th>
                            <th className="border-b border-gray-200 px-3 py-2 font-bold text-gray-500">Ghi chú</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Xoá</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-3 py-5 text-center font-semibold text-gray-400">Chưa có lịch sử lương.</td>
                            </tr>
                        ) : rows.map((rate, index) => (
                            <tr key={salaryRateKey(rate, index)} className="border-b border-gray-100 last:border-b-0">
                                <td className="px-3 py-2">
                                    <TextInput type="date" disabled={!canEdit} value={dateValue(rate.effective_from)} onChange={(value) => updateRate(rate, index, { effective_from: value })} />
                                </td>
                                <td className="px-3 py-2">
                                    <SelectInput disabled={!canEdit} value={rate.salary_type} onChange={(value) => updateRate(rate, index, { salary_type: value })} options={EMPLOYEE_TYPES} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyInput disabled={!canEdit} value={rate.salary_amount} suffix={salaryUnitLabel(rate.salary_type)} onChange={(value) => updateRate(rate, index, { salary_amount: value })} />
                                </td>
                                <td className="px-3 py-2">
                                    <TextInput disabled={!canEdit} value={rate.notes} onChange={(value) => updateRate(rate, index, { notes: value })} placeholder="VD: Tăng lương tháng 12" />
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <button type="button" disabled={!canEdit || rows.length <= 1} onClick={() => removeRate(rate, index)} className="inline-flex size-8 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40" title="Xoá mốc lương">
                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function EmployeeProfileModal({
    employee,
    userOptions,
    canEdit,
    canViewSalary,
    saving,
    uploadingQr,
    uploadingIdentityFront,
    uploadingIdentityBack,
    onChange,
    onUploadIdentityCard,
    onUploadBankQr,
    onZoomImage,
    onClose,
    onSave,
}) {
    if (!employee) return null;

    return (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/45 px-4 py-6">
            <section className="flex max-h-[calc(100vh-3rem)] w-full max-w-[880px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
                <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
                    <div>
                        <h2 className="text-[18px] font-bold text-gray-900">Hồ sơ nhân viên</h2>
                        <p className="mt-1 text-[12px] font-semibold text-gray-500">{employee.full_name || 'Nhân viên mới'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50" title="Đóng">
                        <span className="material-symbols-outlined text-[21px]">close</span>
                    </button>
                </header>

                <div className="grid gap-4 overflow-y-auto px-5 py-5 md:grid-cols-2">
                    <label className="grid gap-1">
                        <span className="text-[12px] font-bold text-gray-600">Tên nhân viên</span>
                        <TextInput disabled={!canEdit} value={employee.full_name} onChange={(value) => onChange({ full_name: value })} />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-[12px] font-bold text-gray-600">Số điện thoại</span>
                        <TextInput disabled={!canEdit} value={employee.phone} onChange={(value) => onChange({ phone: value })} />
                    </label>
                    <label className="grid gap-1 md:col-span-2">
                        <span className="text-[12px] font-bold text-gray-600">Địa chỉ</span>
                        <TextAreaInput disabled={!canEdit} value={employee.address} onChange={(value) => onChange({ address: value })} />
                    </label>
                    <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                        <IdentityCardUploadCard
                            title="CMT/CCCD mặt trước"
                            imageUrl={employee.identity_card_front_image_url || employee.identity_card_image_url}
                            canEdit={canEdit}
                            uploading={uploadingIdentityFront}
                            onUpload={(file) => onUploadIdentityCard('front', file)}
                            onRemove={() => onChange({ identity_card_front_image_url: '', identity_card_image_url: '' })}
                            onZoom={(url) => onZoomImage({ url, title: 'CMT/CCCD mặt trước' })}
                        />
                        <IdentityCardUploadCard
                            title="CMT/CCCD mặt sau"
                            imageUrl={employee.identity_card_back_image_url}
                            canEdit={canEdit}
                            uploading={uploadingIdentityBack}
                            onUpload={(file) => onUploadIdentityCard('back', file)}
                            onRemove={() => onChange({ identity_card_back_image_url: '' })}
                            onZoom={(url) => onZoomImage({ url, title: 'CMT/CCCD mặt sau' })}
                        />
                    </div>
                    <div className="grid gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_240px]">
                        <div className="grid gap-3">
                            <label className="grid gap-1">
                                <span className="text-[12px] font-bold text-gray-600">Tài khoản ngân hàng nhận lương</span>
                                {canViewSalary ? (
                                    <TextInput disabled={!canEdit} value={employee.bank_account_note} onChange={(value) => onChange({ bank_account_note: value })} />
                                ) : (
                                    <div className="flex h-9 items-center rounded border border-gray-200 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-400">Ẩn</div>
                                )}
                            </label>
                            <label className="grid gap-1">
                                <span className="text-[12px] font-bold text-gray-600">QR tài khoản ngân hàng</span>
                                {canViewSalary ? (
                                    <TextInput disabled={!canEdit} value={employee.bank_qr_image_url} onChange={(value) => onChange({ bank_qr_image_url: value })} placeholder="Link ảnh QR ngân hàng" />
                                ) : (
                                    <div className="flex h-9 items-center rounded border border-gray-200 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-400">Ẩn</div>
                                )}
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 text-[13px] font-bold text-teal-700 hover:bg-teal-100 ${(!canEdit || !canViewSalary || uploadingQr) ? 'pointer-events-none opacity-50' : ''}`}>
                                    {uploadingQr ? <span className="size-3.5 animate-spin rounded-full border-b-2 border-teal-700" /> : <span className="material-symbols-outlined text-[18px]">upload</span>}
                                    Tải QR lên
                                    <input
                                        type="file"
                                        accept="image/*"
                                        disabled={!canEdit || !canViewSalary || uploadingQr}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = '';
                                            if (file) onUploadBankQr(file);
                                        }}
                                        className="hidden"
                                    />
                                </label>
                                <button type="button" disabled={!canEdit || !canViewSalary || !employee.bank_qr_image_url} onClick={() => onChange({ bank_qr_image_url: '' })} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                    Xoá QR
                                </button>
                            </div>
                        </div>
                        <div>
                            <span className="mb-1 block text-[12px] font-bold text-gray-600">Ảnh QR chuyển khoản</span>
                            <BankQrPreview
                                url={canViewSalary ? employee.bank_qr_image_url : ''}
                                sizeClass="size-56"
                                onZoom={() => onZoomImage({ url: employee.bank_qr_image_url, title: 'QR tài khoản ngân hàng' })}
                                emptyText="Chưa có QR"
                            />
                        </div>
                    </div>
                    <label className="grid gap-1">
                        <span className="text-[12px] font-bold text-gray-600">User đăng nhập</span>
                        <SelectInput disabled={!canEdit} value={employee.user_id} onChange={(value) => onChange({ user_id: value })} options={userOptions} placeholder="Chọn user" />
                    </label>
                    {canViewSalary && (
                        <div className="md:col-span-2">
                            <SalaryHistoryEditor employee={employee} canEdit={canEdit} onChange={onChange} />
                        </div>
                    )}
                </div>

                <footer className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
                    <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-700 hover:bg-gray-50">
                        Đóng
                    </button>
                    <SaveButton saving={saving} disabled={!canEdit} onClick={onSave}>Lưu hồ sơ</SaveButton>
                </footer>
            </section>
        </div>
    );
}
