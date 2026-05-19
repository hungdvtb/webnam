import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import { useTableColumns } from '../../hooks/useTableColumns';
import { payrollApi } from '../../services/api';

const EMPLOYEE_TABLE_STORAGE_KEY = 'payroll_employee_table_v1';

const EMPLOYEE_TABLE_COLUMNS = [
    { id: 'employee_code', label: 'Mã nhân viên', minWidth: '124px' },
    { id: 'full_name', label: 'Họ và tên', minWidth: '180px' },
    { id: 'department', label: 'Bộ phận', minWidth: '150px' },
    { id: 'position', label: 'Vai trò', minWidth: '160px' },
    { id: 'salary_type', label: 'Loại lương', minWidth: '132px' },
    { id: 'salary_amount', label: 'Mức lương đang hưởng', minWidth: '180px' },
    { id: 'standard_work_units', label: 'Công chuẩn/tháng', minWidth: '150px' },
    { id: 'lunch_allowance', label: 'Phụ cấp ăn trưa', minWidth: '160px' },
    { id: 'bonus_policy', label: 'Các khoản thưởng', minWidth: '180px' },
    { id: 'pay_schedule', label: 'Thời gian phát lương', minWidth: '170px' },
    { id: 'status', label: 'Trạng thái', minWidth: '140px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
    { id: 'actions', label: 'Xóa', minWidth: '72px' },
];

const SHIFT_TABLE_STORAGE_KEY = 'payroll_shift_table_v1';
const SCHEDULE_TABLE_STORAGE_KEY = 'payroll_schedule_table_v1';
const ATTENDANCE_TABLE_STORAGE_KEY = 'payroll_attendance_table_v1';
const SUMMARY_TABLE_STORAGE_KEY = 'payroll_summary_table_v1';
const SCOPE_TABLE_STORAGE_KEY = 'payroll_scope_table_v1';

const SHIFT_TABLE_COLUMNS = [
    { id: 'shift_code', label: 'Mã ca', minWidth: '100px' },
    { id: 'shift_name', label: 'Tên ca', minWidth: '160px' },
    { id: 'start_time', label: 'Giờ bắt đầu', minWidth: '130px' },
    { id: 'end_time', label: 'Giờ kết thúc', minWidth: '130px' },
    { id: 'standard_hours', label: 'Số giờ chuẩn', minWidth: '130px' },
    { id: 'default_work_units', label: 'Công mặc định', minWidth: '140px' },
    { id: 'wage_multiplier', label: 'Hệ số lương', minWidth: '130px' },
    { id: 'is_active', label: 'Đang dùng', minWidth: '110px' },
    { id: 'sort_order', label: 'Thứ tự', minWidth: '100px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
];

const SCHEDULE_TABLE_COLUMNS = [
    { id: 'work_date', label: 'Ngày', minWidth: '130px' },
    { id: 'weekday', label: 'Thứ', minWidth: '80px' },
    { id: 'employee', label: 'Nhân viên', minWidth: '220px' },
    { id: 'department', label: 'Bộ phận', minWidth: '150px' },
    { id: 'shift', label: 'Ca làm', minWidth: '180px' },
    { id: 'shift_time', label: 'Giờ ca', minWidth: '120px' },
    { id: 'registered_work_units', label: 'Công đăng ký', minWidth: '140px' },
    { id: 'status', label: 'Trạng thái', minWidth: '150px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
];

const ATTENDANCE_TABLE_COLUMNS = [
    { id: 'work_date', label: 'Ngày', minWidth: '130px' },
    { id: 'weekday', label: 'Thứ', minWidth: '80px' },
    { id: 'employee', label: 'Nhân viên', minWidth: '220px' },
    { id: 'department', label: 'Bộ phận', minWidth: '150px' },
    { id: 'shift', label: 'Ca làm', minWidth: '180px' },
    { id: 'shift_time', label: 'Giờ ca', minWidth: '120px' },
    { id: 'attendance_status', label: 'Trạng thái', minWidth: '150px' },
    { id: 'work_units', label: 'Công tính', minWidth: '130px' },
    { id: 'unit_rate', label: 'Đơn giá ghi đè', minWidth: '170px' },
    { id: 'bonus_amount', label: 'Thưởng', minWidth: '140px' },
    { id: 'penalty_amount', label: 'Phạt', minWidth: '140px' },
    { id: 'calculated_amount', label: 'Thành tiền', minWidth: '150px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
];

const SUMMARY_TABLE_COLUMNS = [
    { id: 'employee_code', label: 'Mã nhân viên', minWidth: '130px' },
    { id: 'full_name', label: 'Họ và tên', minWidth: '180px' },
    { id: 'department', label: 'Bộ phận', minWidth: '150px' },
    { id: 'salary_type', label: 'Loại lương', minWidth: '140px' },
    { id: 'total_work_units', label: 'Tổng công', minWidth: '130px' },
    { id: 'total_hours', label: 'Tổng giờ', minWidth: '120px' },
    { id: 'total_bonus', label: 'Tổng thưởng', minWidth: '150px' },
    { id: 'total_penalty', label: 'Tổng phạt', minWidth: '140px' },
    { id: 'total_salary', label: 'Tổng lương phải trả', minWidth: '180px' },
];

const SCOPE_TABLE_COLUMNS = [
    { id: 'user', label: 'Người dùng', minWidth: '220px' },
    { id: 'employee', label: 'Nhân viên liên kết', minWidth: '220px' },
    { id: 'role_name', label: 'Vai trò', minWidth: '150px' },
    { id: 'scope_type', label: 'Phạm vi xem', minWidth: '150px' },
    { id: 'department', label: 'Bộ phận quản lý', minWidth: '170px' },
    { id: 'can_view_salary', label: 'Xem lương', minWidth: '110px' },
    { id: 'can_edit_attendance', label: 'Sửa chấm công', minWidth: '140px' },
    { id: 'can_manage_payroll', label: 'Quản lý hệ thống lương', minWidth: '190px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
];

const TAB_ITEMS = [
    { id: 'he-thong-luong', label: 'Hệ thống lương', icon: 'badge' },
    { id: 'ca-lam', label: 'Ca làm', icon: 'schedule' },
    { id: 'dang-ky-lich', label: 'Đăng ký lịch làm', icon: 'event_note' },
    { id: 'cham-cong', label: 'Chấm công', icon: 'fact_check' },
    { id: 'tong-hop-luong', label: 'Tổng hợp lương', icon: 'payments' },
    { id: 'phan-quyen', label: 'Phân quyền', icon: 'admin_panel_settings' },
];

const SALARY_TYPE_OPTIONS = [
    { value: 'theo_ca', label: 'Theo ca' },
    { value: 'theo_gio', label: 'Theo giờ' },
    { value: 'theo_thang', label: 'Theo tháng' },
];

const EMPLOYEE_STATUS_OPTIONS = ['Đang làm', 'Tạm nghỉ', 'Nghỉ việc'];
const SCHEDULE_STATUS_OPTIONS = ['Đã đăng ký', 'Đổi ca', 'Huỷ lịch'];
const ATTENDANCE_STATUS_OPTIONS = ['Đi làm', 'Nửa ca', 'Làm lẻ', 'Nghỉ', 'Nghỉ phép', 'Tăng ca'];
const ROLE_OPTIONS = ['Nhân viên', 'Quản lý', 'Quản trị viên'];
const SCOPE_OPTIONS = ['Chỉ bản thân', 'Bộ phận', 'Tất cả'];

const getCurrentMonth = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const makeUid = () => Math.random().toString(36).slice(2, 11);
const withUid = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, uid: row.uid || makeUid() }));
const numberValue = (value) => (value === null || value === undefined || value === '' ? 0 : Number(value) || 0);
const trimValue = (value) => String(value ?? '').trim();
const integerFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimalFormatter = (maxDigits = 1) => new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
});

const parseMoneyValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const raw = String(value).trim();
    if (!raw) return null;

    let normalized;
    if (raw.includes(',')) {
        normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    } else {
        const cleaned = raw.replace(/[^\d.-]/g, '');
        const dotCount = (cleaned.match(/\./g) || []).length;
        normalized = dotCount > 1 || /^-?\d{1,3}(\.\d{3})+$/.test(cleaned)
            ? cleaned.replace(/\./g, '')
            : cleaned;
    }
    const number = Number(normalized);

    return Number.isFinite(number) ? number : null;
};

const parseDecimalValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const normalized = String(value)
        .trim()
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^\d.-]/g, '');
    const number = Number(normalized);

    return Number.isFinite(number) ? number : null;
};

const roundToDigits = (value, digits = 1) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const formatCurrency = (value) => {
    const number = parseMoneyValue(value);
    if (number === null) return 'Ẩn';
    return `${integerFormatter.format(Math.ceil(number))} đ`;
};

const formatInteger = (value) => {
    const number = parseMoneyValue(value);
    return number === null ? '' : integerFormatter.format(Math.ceil(number));
};

const formatDecimal = (value, maxDigits = 1) => {
    const number = parseDecimalValue(value);
    if (number === null) return '';
    return decimalFormatter(maxDigits).format(roundToDigits(number, maxDigits));
};

const normalizeMoneyInput = (value) => {
    const number = parseMoneyValue(value);
    return number === null ? '' : String(Math.ceil(number));
};

const normalizeDecimalInput = (value, maxDigits = 1) => {
    const number = parseDecimalValue(value);
    return number === null ? '' : String(roundToDigits(number, maxDigits));
};

const formatTime = (value) => {
    if (!value) return '';
    return String(value).slice(0, 5);
};

const getWeekday = (dateValue) => {
    if (!dateValue) return '';
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return names[date.getDay()];
};

const resolveErrorMessage = (error, fallbackMessage) => (
    error?.response?.data?.message || error?.message || fallbackMessage
);

const createEmployeeRow = () => ({
    uid: makeUid(),
    id: null,
    user_id: '',
    employee_code: '',
    full_name: '',
    phone: '',
    address: '',
    identity_card_image_url: '',
    department: '',
    position: '',
    salary_type: 'theo_ca',
    salary_amount: '',
    standard_work_units: '',
    lunch_allowance: '',
    bonus_policy: '',
    pay_schedule: 'Ngày 15 - 1',
    raise_plan: '',
    bank_account_note: '',
    status: 'Đang làm',
    notes: '',
});

const createShiftRow = () => ({
    uid: makeUid(),
    id: null,
    shift_code: '',
    shift_name: '',
    start_time: '',
    end_time: '',
    standard_hours: 4,
    default_work_units: 1,
    wage_multiplier: 1,
    is_active: true,
    sort_order: 99,
    notes: '',
});

const createScheduleRow = () => ({
    uid: makeUid(),
    id: null,
    work_date: '',
    payroll_employee_id: '',
    payroll_work_shift_id: '',
    registered_work_units: 1,
    status: 'Đã đăng ký',
    notes: '',
});

const createAttendanceRow = () => ({
    uid: makeUid(),
    id: null,
    payroll_schedule_registration_id: '',
    work_date: '',
    payroll_employee_id: '',
    payroll_work_shift_id: '',
    attendance_status: 'Đi làm',
    work_units: 1,
    unit_rate: '',
    bonus_amount: '',
    penalty_amount: '',
    notes: '',
});

const createScopeRow = () => ({
    uid: makeUid(),
    id: null,
    user_id: '',
    payroll_employee_id: '',
    role_name: 'Nhân viên',
    scope_type: 'Chỉ bản thân',
    department: '',
    can_view_salary: false,
    can_edit_attendance: false,
    can_manage_payroll: false,
    notes: '',
});

function SheetShell({ title, description, action, children }) {
    return (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-gray-200 bg-[#f8fafc] px-4 py-3 md:flex-row md:items-center">
                <div>
                    <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
                    {description && <p className="mt-1 text-[12px] text-gray-500">{description}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function TableWrap({ children, minWidth = 1200, tableWidth, tableClassName = '' }) {
    return (
        <div className="max-h-[calc(100vh-310px)] overflow-auto">
            <table
                className={`w-full border-collapse text-left ${tableClassName}`}
                style={{ minWidth, ...(tableWidth ? { width: `${tableWidth}px` } : {}) }}
            >
                {children}
            </table>
        </div>
    );
}

function HeaderCell({ children, className = '', style, ...props }) {
    return (
        <th
            {...props}
            style={style}
            className={`sticky top-0 z-10 border-b border-r border-gray-200 bg-[#eef2f7] px-3 py-2 text-[12px] font-bold text-gray-700 ${className}`}
        >
            {children}
        </th>
    );
}

function DataCell({ children, className = '', style }) {
    return <td style={style} className={`border-b border-r border-gray-100 p-0 ${className}`}>{children}</td>;
}

function TextInput({ value, onChange, type = 'text', step, disabled = false, placeholder = '', className = '' }) {
    return (
        <input
            type={type}
            step={step}
            disabled={disabled}
            placeholder={placeholder}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className={`h-10 w-full bg-transparent px-3 text-[13px] text-gray-800 outline-none transition-colors focus:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        />
    );
}

function MoneyInput({ value, onChange, disabled = false, placeholder = '', className = '' }) {
    return (
        <div className="relative h-10">
            <input
                type="text"
                inputMode="numeric"
                disabled={disabled}
                placeholder={placeholder}
                value={formatInteger(value)}
                onChange={(event) => onChange(normalizeMoneyInput(event.target.value))}
                className={`h-10 w-full bg-transparent px-3 pr-8 text-right text-[13px] text-gray-800 outline-none transition-colors focus:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-gray-400">đ</span>
        </div>
    );
}

function WorkUnitInput({ value, onChange, disabled = false, placeholder = '', className = '' }) {
    return (
        <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            placeholder={placeholder}
            value={formatDecimal(value)}
            onChange={(event) => onChange(normalizeDecimalInput(event.target.value))}
            className={`h-10 w-full bg-transparent px-3 text-right text-[13px] text-gray-800 outline-none transition-colors focus:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        />
    );
}

function TextAreaInput({ value, onChange, disabled = false, placeholder = '', className = '' }) {
    return (
        <textarea
            disabled={disabled}
            placeholder={placeholder}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className={`min-h-[92px] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        />
    );
}

function SelectInput({ value, onChange, options, disabled = false, placeholder = 'Chọn', className = '' }) {
    return (
        <select
            disabled={disabled}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className={`h-10 w-full bg-transparent px-3 text-[13px] text-gray-800 outline-none transition-colors focus:bg-blue-50 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        >
            <option value="">{placeholder}</option>
            {options.map((option) => {
                const normalized = typeof option === 'string' ? { value: option, label: option } : option;
                return (
                    <option key={normalized.value} value={normalized.value}>
                        {normalized.label}
                    </option>
                );
            })}
        </select>
    );
}

function CheckboxInput({ checked, onChange, disabled = false }) {
    return (
        <label className="flex h-10 items-center justify-center">
            <input
                type="checkbox"
                checked={Boolean(checked)}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
            />
        </label>
    );
}

function SaveButton({ onClick, saving, disabled, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled || saving}
            className="inline-flex h-9 items-center justify-center gap-2 rounded bg-[#1f4f82] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#183d64] disabled:cursor-not-allowed disabled:opacity-50"
        >
            {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-white" /> : <span className="material-symbols-outlined text-[17px]">save</span>}
            {children}
        </button>
    );
}

export default function PayrollManagement() {
    const [activeTab, setActiveTab] = useState('he-thong-luong');
    const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState('');
    const [message, setMessage] = useState('');
    const [scope, setScope] = useState({
        scope_type: 'Không có quyền',
        can_view_salary: false,
        can_edit_attendance: false,
        can_manage_payroll: false,
    });
    const [departments, setDepartments] = useState([]);
    const [users, setUsers] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [attendanceRecords, setAttendanceRecords] = useState([]);
    const [payrollSummary, setPayrollSummary] = useState([]);
    const [userScopes, setUserScopes] = useState([]);
    const [openColumnSettings, setOpenColumnSettings] = useState({});
    const [profileEmployeeUid, setProfileEmployeeUid] = useState('');

    const employeeTable = useTableColumns(EMPLOYEE_TABLE_STORAGE_KEY, EMPLOYEE_TABLE_COLUMNS);
    const shiftTable = useTableColumns(SHIFT_TABLE_STORAGE_KEY, SHIFT_TABLE_COLUMNS);
    const scheduleTable = useTableColumns(SCHEDULE_TABLE_STORAGE_KEY, SCHEDULE_TABLE_COLUMNS);
    const attendanceTable = useTableColumns(ATTENDANCE_TABLE_STORAGE_KEY, ATTENDANCE_TABLE_COLUMNS);
    const summaryTable = useTableColumns(SUMMARY_TABLE_STORAGE_KEY, SUMMARY_TABLE_COLUMNS);
    const scopeTable = useTableColumns(SCOPE_TABLE_STORAGE_KEY, SCOPE_TABLE_COLUMNS);

    const canManagePayroll = Boolean(scope.can_manage_payroll);
    const canEditAttendance = Boolean(scope.can_edit_attendance || scope.can_manage_payroll);
    const canViewSalary = Boolean(scope.can_view_salary);

    const loadData = useCallback(async () => {
        setLoading(true);
        setMessage('');

        try {
            const response = await payrollApi.getOverview({
                month: selectedMonth,
                department: departmentFilter || undefined,
            });
            const data = response.data?.data || {};

            setScope(data.scope || {});
            setDepartments(Array.isArray(data.departments) ? data.departments : []);
            setUsers(Array.isArray(data.users) ? data.users : []);
            setEmployees(withUid(data.employees).length ? withUid(data.employees) : [createEmployeeRow()]);
            setShifts(withUid(data.shifts).length ? withUid(data.shifts) : [createShiftRow()]);
            setSchedules(withUid(data.schedules).length ? withUid(data.schedules) : [createScheduleRow()]);
            setAttendanceRecords(withUid(data.attendance_records).length ? withUid(data.attendance_records) : [createAttendanceRow()]);
            setPayrollSummary(Array.isArray(data.payroll_summary) ? data.payroll_summary : []);
            setUserScopes(withUid(data.user_scopes).length ? withUid(data.user_scopes) : [createScopeRow()]);
        } catch (error) {
            setMessage(resolveErrorMessage(error, 'Lỗi tải dữ liệu công lương.'));
        } finally {
            setLoading(false);
        }
    }, [departmentFilter, selectedMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const employeeOptions = useMemo(() => employees
        .filter((employee) => employee.id || employee.employee_code || employee.full_name)
        .map((employee) => ({
            value: employee.id || '',
            label: `${employee.employee_code || 'Chưa có mã'} - ${employee.full_name || 'Chưa có tên'}`,
        }))
        .filter((option) => option.value), [employees]);

    const shiftOptions = useMemo(() => shifts
        .filter((shift) => shift.id || shift.shift_code || shift.shift_name)
        .map((shift) => ({
            value: shift.id || '',
            label: `${shift.shift_name || shift.shift_code || 'Ca làm'} (${formatTime(shift.start_time)}-${formatTime(shift.end_time)})`,
        }))
        .filter((option) => option.value), [shifts]);

    const userOptions = useMemo(() => users.map((user) => ({
        value: user.id,
        label: `${user.name || 'Người dùng'} - ${user.email || ''}`,
    })), [users]);

    const employeeById = useMemo(() => new Map(employees.map((employee) => [String(employee.id), employee])), [employees]);
    const shiftById = useMemo(() => new Map(shifts.map((shift) => [String(shift.id), shift])), [shifts]);
    const departmentOptions = useMemo(() => {
        const values = new Set(departments);
        employees.forEach((employee) => {
            if (trimValue(employee.department)) values.add(trimValue(employee.department));
        });
        return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
    }, [departments, employees]);
    const profileEmployee = useMemo(
        () => employees.find((employee) => employee.uid === profileEmployeeUid) || null,
        [employees, profileEmployeeUid]
    );

    const updateRow = (setter, uid, patch) => {
        setter((rows) => rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    };

    const updateEmployeeProfile = (patch) => {
        if (!profileEmployee) return;
        updateRow(setEmployees, profileEmployee.uid, patch);
    };

    const toggleColumnSettings = (tableId) => {
        setOpenColumnSettings((prev) => ({ ...prev, [tableId]: !prev[tableId] }));
    };

    const closeColumnSettings = (tableId) => {
        setOpenColumnSettings((prev) => ({ ...prev, [tableId]: false }));
    };

    const isColumnSettingsOpen = (tableId) => Boolean(openColumnSettings[tableId]);

    const getColumnStyle = (tableState, column) => {
        const width = tableState.columnWidths[column.id]
            ? `${tableState.columnWidths[column.id]}px`
            : column.minWidth;

        return {
            width,
            minWidth: column.minWidth,
        };
    };

    const renderColumnSettingsButton = (tableId) => (
        <button type="button" onClick={() => toggleColumnSettings(tableId)} className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-[13px] font-semibold transition-colors ${isColumnSettingsOpen(tableId) ? 'border-[#1f4f82] bg-[#1f4f82] text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
            <span className="material-symbols-outlined text-[17px]">view_column</span>
            Cài đặt cột
        </button>
    );

    const renderColumnSettingsPanel = (tableId, tableState, storageKey) => (
        isColumnSettingsOpen(tableId) ? (
            <TableColumnSettingsPanel
                availableColumns={tableState.availableColumns}
                visibleColumns={tableState.visibleColumns}
                toggleColumn={tableState.toggleColumn}
                setAvailableColumns={tableState.setAvailableColumns}
                resetDefault={tableState.resetDefault}
                saveAsDefault={tableState.saveAsDefault}
                onClose={() => closeColumnSettings(tableId)}
                storageKey={storageKey}
            />
        ) : null
    );

    const renderConfigurableTable = ({
        tableState,
        rows,
        renderCell,
        rowKey,
        emptyMessage,
        rowClassName = 'hover:bg-gray-50',
        rowTitle,
        onRowDoubleClick,
    }) => (
        <TableWrap minWidth={tableState.totalTableWidth} tableWidth={tableState.totalTableWidth} tableClassName="table-fixed">
            <thead>
                <tr>
                    {tableState.renderedColumns.map((column, index) => (
                        <HeaderCell
                            key={column.id}
                            draggable
                            onDragStart={(event) => tableState.handleHeaderDragStart(event, index)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => tableState.handleHeaderDrop(event, index)}
                            style={getColumnStyle(tableState, column)}
                            className="relative select-none"
                            title="Kéo để đổi thứ tự, kéo mép phải để đổi độ rộng"
                        >
                            <span className="block truncate pr-2">{column.label}</span>
                            <div
                                onMouseDown={(event) => tableState.handleColumnResize(column.id, event)}
                                className={`absolute right-0 top-0 h-full w-2 cursor-col-resize transition hover:bg-[#1f4f82]/20 ${tableState.resizingColumnId === column.id ? 'bg-[#1f4f82]/25' : ''}`}
                                title="Kéo để đổi độ rộng cột"
                            />
                        </HeaderCell>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length === 0 && emptyMessage ? (
                    <tr>
                        <td colSpan={Math.max(tableState.renderedColumns.length, 1)} className="px-4 py-10 text-center text-[13px] text-gray-500">{emptyMessage}</td>
                    </tr>
                ) : rows.map((row, index) => (
                    <tr
                        key={typeof rowKey === 'function' ? rowKey(row, index) : row[rowKey]}
                        className={rowClassName}
                        title={typeof rowTitle === 'function' ? rowTitle(row, index) : rowTitle}
                        onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row, index) : undefined}
                    >
                        {tableState.renderedColumns.map((column) => (
                            <DataCell
                                key={`${typeof rowKey === 'function' ? rowKey(row, index) : row[rowKey]}-${column.id}`}
                                style={getColumnStyle(tableState, column)}
                                className={column.id === 'actions' ? 'text-center' : ''}
                            >
                                {renderCell(column, row, index)}
                            </DataCell>
                        ))}
                    </tr>
                ))}
            </tbody>
        </TableWrap>
    );

    const removeLocalRow = (setter, uid, createRow) => {
        setter((rows) => {
            const nextRows = rows.filter((row) => row.uid !== uid || row.id);
            return nextRows.length ? nextRows : [createRow()];
        });
    };

    const handleSave = async (key, saver, successMessage) => {
        setSavingKey(key);
        setMessage('');

        try {
            await saver();
            setMessage(successMessage);
            await loadData();
        } catch (error) {
            setMessage(resolveErrorMessage(error, 'Lỗi lưu dữ liệu.'));
        } finally {
            setSavingKey('');
        }
    };

    const calculateDraftAmount = (record) => {
        if (!canViewSalary) return null;
        const employee = employeeById.get(String(record.payroll_employee_id));
        const shift = shiftById.get(String(record.payroll_work_shift_id));
        if (!employee) return numberValue(record.calculated_amount);

        const workUnits = numberValue(record.work_units);
        const bonus = numberValue(record.bonus_amount);
        const penalty = numberValue(record.penalty_amount);
        const multiplier = numberValue(shift?.wage_multiplier) || 1;

        if (record.unit_rate !== null && record.unit_rate !== undefined && record.unit_rate !== '') {
            return numberValue(record.unit_rate) * workUnits * multiplier + bonus - penalty;
        }

        const salaryAmount = numberValue(employee.salary_amount);
        let baseAmount = 0;

        if (employee.salary_type === 'theo_gio') {
            baseAmount = salaryAmount * numberValue(shift?.standard_hours) * workUnits * multiplier;
        } else if (employee.salary_type === 'theo_thang') {
            const standardUnits = numberValue(employee.standard_work_units);
            baseAmount = standardUnits > 0 ? (salaryAmount / standardUnits) * workUnits : 0;
        } else {
            baseAmount = salaryAmount * workUnits * multiplier;
        }

        return baseAmount + bonus - penalty;
    };

    const handleCreateAttendanceFromSchedules = () => {
        const existingKeys = new Set(attendanceRecords.map((row) => `${row.work_date}|${row.payroll_employee_id}|${row.payroll_work_shift_id}`));
        const rowsToAdd = schedules
            .filter((row) => row.work_date && row.payroll_employee_id && row.payroll_work_shift_id)
            .filter((row) => !existingKeys.has(`${row.work_date}|${row.payroll_employee_id}|${row.payroll_work_shift_id}`))
            .map((row) => ({
                ...createAttendanceRow(),
                payroll_schedule_registration_id: row.id || '',
                work_date: row.work_date,
                payroll_employee_id: row.payroll_employee_id,
                payroll_work_shift_id: row.payroll_work_shift_id,
                work_units: row.registered_work_units || 1,
                attendance_status: 'Đi làm',
            }));

        if (!rowsToAdd.length) {
            setMessage('Không có dòng đăng ký lịch mới để tạo chấm công.');
            return;
        }

        setAttendanceRecords((rows) => {
            const keptRows = rows.length === 1 && !rows[0].id && !rows[0].work_date ? [] : rows;
            return [...keptRows, ...rowsToAdd];
        });
        setActiveTab('cham-cong');
        setMessage(`Đã tạo ${rowsToAdd.length} dòng chấm công từ lịch đăng ký. Kiểm tra lại Công tính rồi bấm lưu.`);
    };

    const renderEmployeeCell = (column, row) => {
        switch (column.id) {
            case 'employee_code':
                return <TextInput disabled={!canManagePayroll} value={row.employee_code} onChange={(value) => updateRow(setEmployees, row.uid, { employee_code: value })} placeholder="NV001" />;
            case 'full_name':
                return <TextInput disabled={!canManagePayroll} value={row.full_name} onChange={(value) => updateRow(setEmployees, row.uid, { full_name: value })} placeholder="Nguyễn Văn A" />;
            case 'department':
                return <TextInput disabled={!canManagePayroll} value={row.department} onChange={(value) => updateRow(setEmployees, row.uid, { department: value })} placeholder="Spa" />;
            case 'position':
                return <TextInput disabled={!canManagePayroll} value={row.position} onChange={(value) => updateRow(setEmployees, row.uid, { position: value })} placeholder="Nhân viên fulltime" />;
            case 'salary_type':
                return <SelectInput disabled={!canManagePayroll} value={row.salary_type} onChange={(value) => updateRow(setEmployees, row.uid, { salary_type: value })} options={SALARY_TYPE_OPTIONS} />;
            case 'salary_amount':
                return <MoneyInput disabled={!canManagePayroll || !canViewSalary} value={row.salary_amount ?? ''} onChange={(value) => updateRow(setEmployees, row.uid, { salary_amount: value })} placeholder="100.000" />;
            case 'standard_work_units':
                return <WorkUnitInput disabled={!canManagePayroll} value={row.standard_work_units ?? ''} onChange={(value) => updateRow(setEmployees, row.uid, { standard_work_units: value })} placeholder="28" />;
            case 'lunch_allowance':
                return <MoneyInput disabled={!canManagePayroll || !canViewSalary} value={row.lunch_allowance ?? ''} onChange={(value) => updateRow(setEmployees, row.uid, { lunch_allowance: value })} placeholder="0" />;
            case 'bonus_policy':
                return <TextInput disabled={!canManagePayroll} value={row.bonus_policy} onChange={(value) => updateRow(setEmployees, row.uid, { bonus_policy: value })} placeholder="Theo KPI bộ phận" />;
            case 'pay_schedule':
                return <TextInput disabled={!canManagePayroll} value={row.pay_schedule} onChange={(value) => updateRow(setEmployees, row.uid, { pay_schedule: value })} placeholder="Ngày 15 - 1" />;
            case 'status':
                return <SelectInput disabled={!canManagePayroll} value={row.status} onChange={(value) => updateRow(setEmployees, row.uid, { status: value })} options={EMPLOYEE_STATUS_OPTIONS} />;
            case 'notes':
                return <TextInput disabled={!canManagePayroll} value={row.notes} onChange={(value) => updateRow(setEmployees, row.uid, { notes: value })} placeholder="Ghi chú" />;
            case 'actions':
                return (
                    <button
                        type="button"
                        disabled={!canManagePayroll || row.id}
                        onClick={() => removeLocalRow(setEmployees, row.uid, createEmployeeRow)}
                        className="h-10 px-3 text-red-500 disabled:text-gray-300"
                        title={row.id ? 'Nhân sự đã lưu nên đổi trạng thái thành Nghỉ việc để giữ lịch sử.' : 'Xóa dòng chưa lưu'}
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                );
            default:
                return null;
        }
    };

    const renderShiftCell = (column, row) => {
        switch (column.id) {
            case 'shift_code':
                return <TextInput disabled={!canManagePayroll} value={row.shift_code} onChange={(value) => updateRow(setShifts, row.uid, { shift_code: value })} placeholder="S" />;
            case 'shift_name':
                return <TextInput disabled={!canManagePayroll} value={row.shift_name} onChange={(value) => updateRow(setShifts, row.uid, { shift_name: value })} placeholder="Ca sáng" />;
            case 'start_time':
                return <TextInput disabled={!canManagePayroll} type="time" value={formatTime(row.start_time)} onChange={(value) => updateRow(setShifts, row.uid, { start_time: value })} />;
            case 'end_time':
                return <TextInput disabled={!canManagePayroll} type="time" value={formatTime(row.end_time)} onChange={(value) => updateRow(setShifts, row.uid, { end_time: value })} />;
            case 'standard_hours':
                return <TextInput disabled={!canManagePayroll} type="number" step="0.25" value={row.standard_hours} onChange={(value) => updateRow(setShifts, row.uid, { standard_hours: value })} />;
            case 'default_work_units':
                return <WorkUnitInput disabled={!canManagePayroll} value={row.default_work_units} onChange={(value) => updateRow(setShifts, row.uid, { default_work_units: value })} />;
            case 'wage_multiplier':
                return <TextInput disabled={!canManagePayroll} type="number" step="0.1" value={row.wage_multiplier} onChange={(value) => updateRow(setShifts, row.uid, { wage_multiplier: value })} />;
            case 'is_active':
                return <CheckboxInput disabled={!canManagePayroll} checked={row.is_active} onChange={(value) => updateRow(setShifts, row.uid, { is_active: value })} />;
            case 'sort_order':
                return <TextInput disabled={!canManagePayroll} type="number" step="1" value={row.sort_order} onChange={(value) => updateRow(setShifts, row.uid, { sort_order: value })} />;
            case 'notes':
                return <TextInput disabled={!canManagePayroll} value={row.notes} onChange={(value) => updateRow(setShifts, row.uid, { notes: value })} placeholder="Ghi chú" />;
            default:
                return null;
        }
    };

    const renderScheduleCell = (column, row) => {
        const employee = employeeById.get(String(row.payroll_employee_id));
        const shift = shiftById.get(String(row.payroll_work_shift_id));

        switch (column.id) {
            case 'work_date':
                return <TextInput disabled={!canEditAttendance} type="date" value={row.work_date} onChange={(value) => updateRow(setSchedules, row.uid, { work_date: value })} />;
            case 'weekday':
                return <div className="px-3 py-2 text-[13px] font-semibold text-gray-500">{getWeekday(row.work_date)}</div>;
            case 'employee':
                return <SelectInput disabled={!canEditAttendance} value={row.payroll_employee_id} onChange={(value) => updateRow(setSchedules, row.uid, { payroll_employee_id: value })} options={employeeOptions} placeholder="Chọn nhân viên" />;
            case 'department':
                return <div className="px-3 py-2 text-[13px] text-gray-700">{employee?.department || ''}</div>;
            case 'shift':
                return <SelectInput disabled={!canEditAttendance} value={row.payroll_work_shift_id} onChange={(value) => updateRow(setSchedules, row.uid, { payroll_work_shift_id: value, registered_work_units: shiftById.get(String(value))?.default_work_units || row.registered_work_units || 1 })} options={shiftOptions} placeholder="Chọn ca" />;
            case 'shift_time':
                return <div className="px-3 py-2 text-[13px] text-gray-700">{shift ? `${formatTime(shift.start_time)}-${formatTime(shift.end_time)}` : ''}</div>;
            case 'registered_work_units':
                return <WorkUnitInput disabled={!canEditAttendance} value={row.registered_work_units} onChange={(value) => updateRow(setSchedules, row.uid, { registered_work_units: value })} placeholder="1" />;
            case 'status':
                return <SelectInput disabled={!canEditAttendance} value={row.status} onChange={(value) => updateRow(setSchedules, row.uid, { status: value })} options={SCHEDULE_STATUS_OPTIONS} />;
            case 'notes':
                return <TextInput disabled={!canEditAttendance} value={row.notes} onChange={(value) => updateRow(setSchedules, row.uid, { notes: value })} placeholder="Ghi chú" />;
            default:
                return null;
        }
    };

    const renderAttendanceCell = (column, row) => {
        const employee = employeeById.get(String(row.payroll_employee_id));
        const shift = shiftById.get(String(row.payroll_work_shift_id));

        switch (column.id) {
            case 'work_date':
                return <TextInput disabled={!canEditAttendance} type="date" value={row.work_date} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { work_date: value })} />;
            case 'weekday':
                return <div className="px-3 py-2 text-[13px] font-semibold text-gray-500">{getWeekday(row.work_date)}</div>;
            case 'employee':
                return <SelectInput disabled={!canEditAttendance} value={row.payroll_employee_id} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { payroll_employee_id: value })} options={employeeOptions} placeholder="Chọn nhân viên" />;
            case 'department':
                return <div className="px-3 py-2 text-[13px] text-gray-700">{employee?.department || ''}</div>;
            case 'shift':
                return <SelectInput disabled={!canEditAttendance} value={row.payroll_work_shift_id} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { payroll_work_shift_id: value, work_units: shiftById.get(String(value))?.default_work_units || row.work_units || 1 })} options={shiftOptions} placeholder="Chọn ca" />;
            case 'shift_time':
                return <div className="px-3 py-2 text-[13px] text-gray-700">{shift ? `${formatTime(shift.start_time)}-${formatTime(shift.end_time)}` : ''}</div>;
            case 'attendance_status':
                return <SelectInput disabled={!canEditAttendance} value={row.attendance_status} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { attendance_status: value, work_units: value === ATTENDANCE_STATUS_OPTIONS[3] ? 0 : row.work_units })} options={ATTENDANCE_STATUS_OPTIONS} />;
            case 'work_units':
                return <WorkUnitInput disabled={!canEditAttendance} value={row.work_units} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { work_units: value })} placeholder="1 hoặc 0,5" className="font-bold text-[#1f4f82]" />;
            case 'unit_rate':
                return <MoneyInput disabled={!canEditAttendance || !canViewSalary} value={row.unit_rate ?? ''} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { unit_rate: value })} placeholder="Để trống nếu theo lương nhân sự" />;
            case 'bonus_amount':
                return <MoneyInput disabled={!canEditAttendance || !canViewSalary} value={row.bonus_amount ?? ''} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { bonus_amount: value })} placeholder="0" />;
            case 'penalty_amount':
                return <MoneyInput disabled={!canEditAttendance || !canViewSalary} value={row.penalty_amount ?? ''} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { penalty_amount: value })} placeholder="0" />;
            case 'calculated_amount':
                return <div className="px-3 py-2 text-right text-[13px] font-bold text-gray-900">{canViewSalary ? formatCurrency(calculateDraftAmount(row)) : 'Ẩn'}</div>;
            case 'notes':
                return <TextInput disabled={!canEditAttendance} value={row.notes} onChange={(value) => updateRow(setAttendanceRecords, row.uid, { notes: value })} placeholder="Ghi chú" />;
            default:
                return null;
        }
    };

    const renderSummaryCell = (column, row) => {
        switch (column.id) {
            case 'employee_code':
                return <div className="px-3 py-2 text-[13px] font-semibold">{row.employee_code}</div>;
            case 'full_name':
                return <div className="px-3 py-2 text-[13px]">{row.full_name}</div>;
            case 'department':
                return <div className="px-3 py-2 text-[13px]">{row.department}</div>;
            case 'salary_type':
                return <div className="px-3 py-2 text-[13px]">{SALARY_TYPE_OPTIONS.find((option) => option.value === row.salary_type)?.label || row.salary_type}</div>;
            case 'total_work_units':
                return <div className="px-3 py-2 text-right text-[13px] font-bold text-[#1f4f82]">{formatDecimal(row.total_work_units)}</div>;
            case 'total_hours':
                return <div className="px-3 py-2 text-right text-[13px]">{formatDecimal(row.total_hours)}</div>;
            case 'total_bonus':
                return <div className="px-3 py-2 text-right text-[13px]">{canViewSalary ? formatCurrency(row.total_bonus) : 'Ẩn'}</div>;
            case 'total_penalty':
                return <div className="px-3 py-2 text-right text-[13px]">{canViewSalary ? formatCurrency(row.total_penalty) : 'Ẩn'}</div>;
            case 'total_salary':
                return <div className="px-3 py-2 text-right text-[14px] font-bold text-gray-900">{canViewSalary ? formatCurrency(row.total_salary) : 'Ẩn'}</div>;
            default:
                return null;
        }
    };

    const renderScopeCell = (column, row) => {
        switch (column.id) {
            case 'user':
                return <SelectInput disabled={!canManagePayroll} value={row.user_id} onChange={(value) => updateRow(setUserScopes, row.uid, { user_id: value })} options={userOptions} placeholder="Chọn user" />;
            case 'employee':
                return <SelectInput disabled={!canManagePayroll} value={row.payroll_employee_id ?? ''} onChange={(value) => updateRow(setUserScopes, row.uid, { payroll_employee_id: value })} options={employeeOptions} placeholder="Không liên kết" />;
            case 'role_name':
                return <SelectInput disabled={!canManagePayroll} value={row.role_name} onChange={(value) => updateRow(setUserScopes, row.uid, { role_name: value })} options={ROLE_OPTIONS} />;
            case 'scope_type':
                return <SelectInput disabled={!canManagePayroll} value={row.scope_type} onChange={(value) => updateRow(setUserScopes, row.uid, { scope_type: value })} options={SCOPE_OPTIONS} />;
            case 'department':
                return <SelectInput disabled={!canManagePayroll} value={row.department ?? ''} onChange={(value) => updateRow(setUserScopes, row.uid, { department: value })} options={departmentOptions} placeholder="Chọn bộ phận" />;
            case 'can_view_salary':
                return <CheckboxInput disabled={!canManagePayroll} checked={row.can_view_salary} onChange={(value) => updateRow(setUserScopes, row.uid, { can_view_salary: value })} />;
            case 'can_edit_attendance':
                return <CheckboxInput disabled={!canManagePayroll} checked={row.can_edit_attendance} onChange={(value) => updateRow(setUserScopes, row.uid, { can_edit_attendance: value })} />;
            case 'can_manage_payroll':
                return <CheckboxInput disabled={!canManagePayroll} checked={row.can_manage_payroll} onChange={(value) => updateRow(setUserScopes, row.uid, { can_manage_payroll: value })} />;
            case 'notes':
                return <TextInput disabled={!canManagePayroll} value={row.notes} onChange={(value) => updateRow(setUserScopes, row.uid, { notes: value })} placeholder="Ghi chú" />;
            default:
                return null;
        }
    };

    const totalWorkUnits = payrollSummary.reduce((sum, row) => sum + numberValue(row.total_work_units), 0);
    const totalSalary = payrollSummary.reduce((sum, row) => sum + numberValue(row.total_salary), 0);

    return (
        <div className="min-h-screen bg-[#f6f8fb] font-sans">
            <div className="mb-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                    <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Quản lý công & lương nhân viên</h1>
                    <p className="mt-1 text-[13px] text-gray-500">
                        Nhập được công lẻ như 0.5, 0.3; dữ liệu đã tách sẵn để sau này phân quyền theo nhân viên hoặc bộ phận.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Tháng</span>
                        <input
                            type="month"
                            value={selectedMonth}
                            onChange={(event) => setSelectedMonth(event.target.value)}
                            className="h-9 rounded border border-gray-200 px-2 text-[13px] outline-none focus:border-blue-500"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Bộ phận</span>
                        <select
                            value={departmentFilter}
                            onChange={(event) => setDepartmentFilter(event.target.value)}
                            className="h-9 rounded border border-gray-200 px-2 text-[13px] outline-none focus:border-blue-500"
                        >
                            <option value="">Tất cả</option>
                            {departmentOptions.map((department) => (
                                <option key={department} value={department}>{department}</option>
                            ))}
                        </select>
                    </label>
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Tổng công</span>
                        <strong className="text-[15px] text-gray-900">{formatDecimal(totalWorkUnits)}</strong>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Tổng lương</span>
                        <strong className="text-[15px] text-[#1f4f82]">{canViewSalary ? formatCurrency(totalSalary) : 'Ẩn'}</strong>
                    </div>
                </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
                {TAB_ITEMS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
                            activeTab === tab.id
                                ? 'border-[#1f4f82] bg-[#1f4f82] text-white'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-[#1f4f82]/40 hover:text-[#1f4f82]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={loadData}
                    className="ml-auto inline-flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
                >
                    <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
                    Làm mới
                </button>
            </div>

            {message && (
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-medium text-blue-800">
                    {message}
                </div>
            )}

            {loading ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-gray-200 bg-white">
                    <div className="flex items-center gap-3 text-[13px] font-medium text-gray-500">
                        <span className="h-5 w-5 animate-spin rounded-full border-b-2 border-[#1f4f82]" />
                        Đang tải dữ liệu công lương...
                    </div>
                </div>
            ) : (
                <>
                    {activeTab === 'he-thong-luong' && (
                        <SheetShell
                            title="Bảng hệ thống lương"
                            description="Quản lý mã nhân viên, bộ phận, vai trò, mức lương và thông tin dùng để tính lương."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('employees')}
                                    <button type="button" onClick={() => setEmployees((rows) => [...rows, createEmployeeRow()])} disabled={!canManagePayroll} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm nhân sự
                                    </button>
                                    <SaveButton
                                        saving={savingKey === 'employees'}
                                        disabled={!canManagePayroll}
                                        onClick={() => handleSave('employees', () => payrollApi.saveEmployees(employees), 'Đã lưu bảng hệ thống lương.')}
                                    >
                                        Lưu hệ thống lương
                                    </SaveButton>
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('employees', employeeTable, EMPLOYEE_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: employeeTable,
                                rows: employees,
                                renderCell: renderEmployeeCell,
                                rowKey: 'uid',
                                rowClassName: 'cursor-default hover:bg-gray-50',
                                rowTitle: 'Bấm đúp để mở hồ sơ nhân viên',
                                onRowDoubleClick: (row) => setProfileEmployeeUid(row.uid),
                            })}
                        </SheetShell>
                    )}

                    {activeTab === 'ca-lam' && (
                        <SheetShell
                            title="Bảng ca làm"
                            description="Một ca có thể tính 1 công, 0.5 công hoặc hệ số lương riêng."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('shifts')}
                                    <button type="button" onClick={() => setShifts((rows) => [...rows, createShiftRow()])} disabled={!canManagePayroll} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm ca làm
                                    </button>
                                    <SaveButton
                                        saving={savingKey === 'shifts'}
                                        disabled={!canManagePayroll}
                                        onClick={() => handleSave('shifts', () => payrollApi.saveShifts(shifts), 'Đã lưu bảng ca làm.')}
                                    >
                                        Lưu ca làm
                                    </SaveButton>
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('shifts', shiftTable, SHIFT_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: shiftTable,
                                rows: shifts,
                                renderCell: renderShiftCell,
                                rowKey: 'uid',
                            })}
                        </SheetShell>
                    )}

                    {activeTab === 'dang-ky-lich' && (
                        <SheetShell
                            title="Bảng đăng ký lịch làm"
                            description="Mỗi dòng là một nhân viên đăng ký một ca trong một ngày. Công đăng ký có thể là 1, 0.5 hoặc 0.3."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('schedules')}
                                    <button type="button" onClick={() => setSchedules((rows) => [...rows, createScheduleRow()])} disabled={!canEditAttendance} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm lịch
                                    </button>
                                    <button type="button" onClick={handleCreateAttendanceFromSchedules} disabled={!canEditAttendance} className="inline-flex h-9 items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 text-[13px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">arrow_forward</span>
                                        Tạo chấm công từ lịch
                                    </button>
                                    <SaveButton
                                        saving={savingKey === 'schedules'}
                                        disabled={!canEditAttendance}
                                        onClick={() => handleSave('schedules', () => payrollApi.saveSchedules(schedules), 'Đã lưu bảng đăng ký lịch làm.')}
                                    >
                                        Lưu đăng ký lịch
                                    </SaveButton>
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('schedules', scheduleTable, SCHEDULE_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: scheduleTable,
                                rows: schedules,
                                renderCell: renderScheduleCell,
                                rowKey: 'uid',
                            })}
                        </SheetShell>
                    )}

                    {activeTab === 'cham-cong' && (
                        <SheetShell
                            title="Bảng chấm công hằng ngày"
                            description="Cột Công tính cho phép nhập số lẻ như 0.5 hoặc 0.3 để tính đúng tiền lương."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('attendance')}
                                    <button type="button" onClick={() => setAttendanceRecords((rows) => [...rows, createAttendanceRow()])} disabled={!canEditAttendance} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm chấm công
                                    </button>
                                    <SaveButton
                                        saving={savingKey === 'attendance'}
                                        disabled={!canEditAttendance}
                                        onClick={() => handleSave('attendance', () => payrollApi.saveAttendance(attendanceRecords), 'Đã lưu bảng chấm công.')}
                                    >
                                        Lưu chấm công
                                    </SaveButton>
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('attendance', attendanceTable, ATTENDANCE_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: attendanceTable,
                                rows: attendanceRecords,
                                renderCell: renderAttendanceCell,
                                rowKey: 'uid',
                            })}
                        </SheetShell>
                    )}

                    {activeTab === 'tong-hop-luong' && (
                        <SheetShell
                            title={`Bảng tổng hợp lương tháng ${selectedMonth}`}
                            description="Bảng này tự tổng hợp từ dữ liệu chấm công, không nhập tay."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('summary')}
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('summary', summaryTable, SUMMARY_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: summaryTable,
                                rows: payrollSummary,
                                renderCell: renderSummaryCell,
                                rowKey: 'payroll_employee_id',
                                emptyMessage: 'Chưa có dữ liệu chấm công trong tháng này.',
                            })}
                        </SheetShell>
                    )}

                    {activeTab === 'phan-quyen' && (
                        <SheetShell
                            title="Bảng phân quyền công lương"
                            description="Chuẩn bị sẵn để nhân viên chỉ xem bản thân, quản lý xem theo bộ phận, admin xem tất cả."
                            action={(
                                <div className="flex flex-wrap gap-2">
                                    {renderColumnSettingsButton('scopes')}
                                    <button type="button" onClick={() => setUserScopes((rows) => [...rows, createScopeRow()])} disabled={!canManagePayroll} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm phân quyền
                                    </button>
                                    <SaveButton
                                        saving={savingKey === 'user-scopes'}
                                        disabled={!canManagePayroll}
                                        onClick={() => handleSave('user-scopes', () => payrollApi.saveUserScopes(userScopes), 'Đã lưu bảng phân quyền công lương.')}
                                    >
                                        Lưu phân quyền
                                    </SaveButton>
                                </div>
                            )}
                        >
                            {renderColumnSettingsPanel('scopes', scopeTable, SCOPE_TABLE_STORAGE_KEY)}
                            {renderConfigurableTable({
                                tableState: scopeTable,
                                rows: userScopes,
                                renderCell: renderScopeCell,
                                rowKey: 'uid',
                            })}
                        </SheetShell>
                    )}
                </>
            )}
            {profileEmployee && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setProfileEmployeeUid('');
                    }}
                >
                    <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                            <div>
                                <h3 className="text-[18px] font-bold text-gray-900">Hồ sơ nhân viên</h3>
                                <p className="text-[12px] font-semibold text-gray-500">{profileEmployee.employee_code || 'Chưa có mã'}</p>
                            </div>
                            <button type="button" onClick={() => setProfileEmployeeUid('')} className="inline-flex h-9 w-9 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-gray-600">Tên nhân viên</span>
                                <TextInput disabled={!canManagePayroll} value={profileEmployee.full_name} onChange={(value) => updateEmployeeProfile({ full_name: value })} className="rounded border border-gray-200 bg-white" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-gray-600">Số điện thoại</span>
                                <TextInput disabled={!canManagePayroll} value={profileEmployee.phone || ''} onChange={(value) => updateEmployeeProfile({ phone: value })} className="rounded border border-gray-200 bg-white" />
                            </label>
                            <label className="flex flex-col gap-1 md:col-span-2">
                                <span className="text-[12px] font-bold text-gray-600">Địa chỉ</span>
                                <TextAreaInput disabled={!canManagePayroll} value={profileEmployee.address || ''} onChange={(value) => updateEmployeeProfile({ address: value })} className="rounded border border-gray-200 bg-white" />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-gray-600">Ảnh CMT/CCCD</span>
                                <TextInput disabled={!canManagePayroll} value={profileEmployee.identity_card_image_url || ''} onChange={(value) => updateEmployeeProfile({ identity_card_image_url: value })} placeholder="Link ảnh CMT/CCCD" className="rounded border border-gray-200 bg-white" />
                            </label>
                            <div className="flex min-h-[130px] items-center justify-center overflow-hidden rounded border border-dashed border-gray-200 bg-gray-50">
                                {profileEmployee.identity_card_image_url ? (
                                    <img src={profileEmployee.identity_card_image_url} alt="Ảnh CMT/CCCD" className="max-h-56 w-full object-contain" />
                                ) : (
                                    <span className="text-[12px] font-semibold text-gray-400">Chưa có ảnh</span>
                                )}
                            </div>
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-gray-600">Tài khoản ngân hàng nhận lương</span>
                                {canViewSalary ? (
                                    <TextInput disabled={!canManagePayroll} value={profileEmployee.bank_account_note || ''} onChange={(value) => updateEmployeeProfile({ bank_account_note: value })} className="rounded border border-gray-200 bg-white" />
                                ) : (
                                    <div className="flex h-10 items-center rounded border border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-400">Ẩn</div>
                                )}
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] font-bold text-gray-600">User đăng nhập</span>
                                <SelectInput disabled={!canManagePayroll} value={profileEmployee.user_id || ''} onChange={(value) => updateEmployeeProfile({ user_id: value })} options={userOptions} placeholder="Chọn user" className="rounded border border-gray-200 bg-white" />
                            </label>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                            <button type="button" onClick={() => setProfileEmployeeUid('')} className="inline-flex h-9 items-center justify-center rounded border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
                                Đóng
                            </button>
                            <SaveButton
                                saving={savingKey === 'employees'}
                                disabled={!canManagePayroll}
                                onClick={async () => {
                                    await handleSave('employees', () => payrollApi.saveEmployees(employees), 'Đã lưu hồ sơ nhân viên.');
                                    setProfileEmployeeUid('');
                                }}
                            >
                                Lưu hồ sơ
                            </SaveButton>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
