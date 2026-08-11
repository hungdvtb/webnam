import React, { useEffect, useMemo, useState } from 'react';
import { mediaApi, payrollApi } from '../../services/api';

const NAV_ITEMS = [
    { id: 'employees', label: 'Nhân viên', icon: 'groups' },
    { id: 'schedule', label: 'Lịch làm', icon: 'calendar_month' },
    { id: 'attendance', label: 'Chấm công', icon: 'schedule' },
    { id: 'adjustments', label: 'Tạm ứng', icon: 'volunteer_activism' },
    { id: 'salary', label: 'Bảng lương', icon: 'payments' },
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
    { value: 'advance', label: 'Tạm ứng' },
];

const REGISTERED_SCHEDULE_STATUS = 'Đã đăng ký';
const CANCELLED_SCHEDULE_STATUS = 'Huỷ lịch';
const FULL_TIME_SHIFT_CODES = new Set(['S', 'C']);
const DEFAULT_STANDARD_WORK_UNITS = 26;
const SCHEDULE_WEEK_FILTERS = [1, 2, 3, 4, 5];

const BLANK_DATA = {
    scope: {},
    departments: [],
    users: [],
    employees: [],
    schedule_employees: [],
    shifts: [],
    schedules: [],
    attendance_records: [],
    adjustments: [],
    payroll_summary: [],
};

const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const workUnitFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

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
    return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : '';
};

const parseWorkUnits = (value) => {
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
const formatWorkUnit = (value) => workUnitFormatter.format(safeNumber(value));
const formatEditableDecimal = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const number = safeNumber(String(value).replace(',', '.'));
    return Number.isFinite(number) ? String(Math.round(number * 10) / 10) : '';
};
const formatTime = (value) => (value ? String(value).slice(0, 5) : '');
const firstDayOfMonth = (month) => `${month || currentMonth()}-01`;
const lastDayOfMonth = (month) => {
    const [year, monthNumber] = String(month || currentMonth()).split('-').map(Number);
    return isoDate(new Date(year, monthNumber, 0));
};
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

const datesBetween = (startValue, endValue) => {
    const start = dateFromInput(startValue);
    const end = dateFromInput(endValue);
    const dates = [];

    for (let current = start; current <= end; current = addDays(current, 1)) {
        dates.push(isoDate(current));
    }

    return dates;
};

const monthOfDate = (value) => {
    const normalized = dateValue(value);
    return normalized ? normalized.slice(0, 7) : currentMonth();
};

const monthWeeksOf = (month) => {
    const dates = datesBetween(firstDayOfMonth(month), lastDayOfMonth(month));
    const weeks = [];

    for (let index = 0; index < dates.length; index += 7) {
        weeks.push({
            weekNumber: Math.floor(index / 7) + 1,
            days: dates.slice(index, index + 7),
        });
    }

    const currentDate = isoDate(new Date());
    const currentWeekIndex = weeks.findIndex((week) => week.days.includes(currentDate));

    if (currentWeekIndex > 0) {
        return [...weeks.slice(currentWeekIndex), ...weeks.slice(0, currentWeekIndex)];
    }

    return weeks;
};

const isDateInMonth = (date, month) => String(date || '').startsWith(`${month}-`);

const shortDate = (value) => {
    const [, month, day] = String(value || '').split('-');
    return day && month ? `${day}/${month}` : value;
};

const weekday = (value) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dateFromInput(value).getDay()];
const dayColumnTone = (date, month) => {
    if (!isDateInMonth(date, month)) {
        return {
            header: 'border-gray-200 bg-white text-gray-400',
            cell: 'border-gray-200 bg-white',
        };
    }

    const tones = [
        {
            header: 'border-gray-200 bg-white text-red-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-sky-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-emerald-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-amber-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-violet-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-teal-700',
            cell: 'border-gray-200 bg-white',
        },
        {
            header: 'border-gray-200 bg-white text-orange-700',
            cell: 'border-gray-200 bg-white',
        },
    ];

    return tones[dateFromInput(date).getDay()];
};
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
const employeeRowKey = (employee) => String(employee?.id || employee?.uid || '');
const scheduleKey = (row) => [
    dateValue(row?.work_date),
    row?.payroll_employee_id,
    row?.payroll_work_shift_id,
].join('|');
const attendanceKey = (row) => [
    dateValue(row?.work_date),
    row?.payroll_employee_id,
    row?.payroll_work_shift_id,
].join('|');
const activeShiftSorter = (left, right) => (
    safeNumber(left.sort_order) - safeNumber(right.sort_order)
    || formatTime(left.start_time).localeCompare(formatTime(right.start_time))
    || String(left.shift_code || '').localeCompare(String(right.shift_code || ''))
);
const parseTimeMinutes = (value) => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    return hours * 60 + minutes;
};
const calculateShiftHours = (startTime, endTime) => {
    const startMinutes = parseTimeMinutes(startTime);
    const endMinutes = parseTimeMinutes(endTime);
    if (startMinutes === null || endMinutes === null) return '';

    const diff = endMinutes >= startMinutes
        ? endMinutes - startMinutes
        : endMinutes + (24 * 60) - startMinutes;

    return parseDecimal(diff / 60);
};
const shiftDisplayCode = (shift) => {
    const code = String(shift?.shift_code || '').trim();
    if (code) return code.toUpperCase();

    return String(shift?.shift_name || 'Ca').trim().slice(0, 2).toUpperCase();
};
const isPrimaryFullTimeShift = (shift, fallbackIds = new Set()) => {
    if (fallbackIds.has(String(shift?.id))) return true;

    const code = String(shift?.shift_code || '').trim().toUpperCase();
    if (FULL_TIME_SHIFT_CODES.has(code)) return true;

    const name = String(shift?.shift_name || '').toLowerCase();
    return name.includes('sáng') || name.includes('chiều');
};
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

const salaryContextForDate = (employee = {}, workDate) => {
    const context = {
        salary_type: employee.salary_type || 'theo_gio',
        salary_amount: safeNumber(employee.salary_amount),
        standard_work_units: safeNumber(employee.standard_work_units),
    };
    const date = dateValue(workDate);
    const rate = salaryRatesForEmployee(employee)
        .slice()
        .reverse()
        .find((item) => dateValue(item.effective_from) && dateValue(item.effective_from) <= date);

    if (!rate) return context;

    return {
        salary_type: rate.salary_type || context.salary_type,
        salary_amount: safeNumber(rate.salary_amount),
        standard_work_units: safeNumber(rate.standard_work_units),
    };
};

const monthlySalaryForWorkUnits = (salaryAmount, standardWorkUnits, workUnits) => (
    safeNumber(standardWorkUnits) > 0 ? (safeNumber(salaryAmount) / safeNumber(standardWorkUnits)) * safeNumber(workUnits) : 0
);

const calculateAttendanceAmount = (record = {}, employee = {}, shift = {}) => {
    if (!employee?.id) return 0;

    const workUnits = safeNumber(record.work_units);
    const multiplier = safeNumber(shift?.wage_multiplier || 1) || 1;
    const salary = salaryContextForDate(employee, record.work_date);
    const unitRate = record.unit_rate;

    if (unitRate !== null && unitRate !== undefined && unitRate !== '') {
        return Math.round((safeNumber(unitRate) * workUnits * multiplier) * 100) / 100;
    }

    const base = salary.salary_type === 'theo_gio'
        ? salary.salary_amount * safeNumber(shift?.standard_hours) * workUnits * multiplier
        : salary.salary_type === 'theo_thang'
            ? monthlySalaryForWorkUnits(salary.salary_amount, salary.standard_work_units, workUnits)
            : salary.salary_amount * workUnits * multiplier;

    return Math.round(base * 100) / 100;
};

const payrollSalaryBasisLabel = (row = {}) => {
    if (!row.can_view_salary) return 'Ẩn';
    if (row.has_multiple_salary_rates) return 'Nhiều mức trong tháng';

    if (row.salary_type === 'theo_thang') {
        const standard = safeNumber(row.standard_work_units);
        const standardText = standard > 0 ? `${formatDecimal(standard)} ngày / tháng` : 'chưa đặt công chuẩn';
        return `${formatMoney(row.salary_amount)} / tháng (${standardText})`;
    }

    if (row.salary_type === 'theo_gio') {
        return `${formatMoney(row.salary_amount)} / giờ`;
    }

    return `${formatMoney(row.salary_amount)} / ca`;
};

const payrollFormulaLabel = (row = {}) => {
    if (!row.can_view_salary) return 'Ẩn lương';
    const multiplierText = row.has_shift_multiplier ? ' x Hệ số ca' : '';
    if (row.has_unit_rate_override) return `Tổng lương = Tổng công x Đơn giá riêng${multiplierText}; Còn thanh toán = Tổng lương - Tạm ứng`;

    if (row.salary_type === 'theo_thang') {
        return 'Tổng lương = Tổng công / Công chuẩn x Định mức lương; Còn thanh toán = Tổng lương - Tạm ứng';
    }


    if (row.salary_type === 'theo_gio') {
        return `Tổng lương = Tổng giờ x Định mức lương${multiplierText}; Còn thanh toán = Tổng lương - Tạm ứng`;
    }

    return `Tổng lương = Tổng công x Định mức lương${multiplierText}; Còn thanh toán = Tổng lương - Tạm ứng`;
};

const buildLocalPayrollSummary = ({
    employees = [],
    records = [],
    shiftsById = new Map(),
    canViewSalary = false,
    adjustments = [],
    monthDays = [],
}) => {
    const employeesById = new Map(employees.filter((employee) => employee.id).map((employee) => [String(employee.id), employee]));
    const summary = new Map();

    employeesById.forEach((employee) => {
        const salary = salaryContextForDate(employee, monthDays[monthDays.length - 1] || isoDate(new Date()));
        summary.set(String(employee.id), {
            payroll_employee_id: employee.id,
            employee_code: employee.employee_code || '',
            full_name: employee.full_name || '',
            department: employee.department || '',
            salary_type: salary.salary_type || employee.salary_type || 'theo_gio',
            salary_amount: salary.salary_amount,
            standard_work_units: salary.standard_work_units,
            can_view_salary: canViewSalary,
            has_unit_rate_override: false,
            has_shift_multiplier: false,
            salary_context_keys: new Set(),
            total_work_units: 0,
            total_hours: 0,
            total_advance: 0,
            total_bonus: 0,
            total_penalty: 0,
            total_salary: canViewSalary ? 0 : null,
        });
    });

    records.forEach((record) => {
        const employee = employeesById.get(String(record.payroll_employee_id)) || record.employee;
        const row = employee?.id ? summary.get(String(employee.id)) : null;
        if (!employee || !row) return;

        const shift = shiftsById.get(String(record.payroll_work_shift_id)) || record.shift || {};
        const workUnits = safeNumber(record.work_units);
        const salary = salaryContextForDate(employee, record.work_date);
        const multiplier = safeNumber(shift?.wage_multiplier || 1) || 1;
        row.salary_context_keys.add(`${salary.salary_type}|${salary.salary_amount}|${salary.standard_work_units}`);
        if (record.unit_rate !== null && record.unit_rate !== undefined && record.unit_rate !== '') {
            row.has_unit_rate_override = true;
        }
        if (multiplier !== 1) {
            row.has_shift_multiplier = true;
        }
        row.total_work_units += workUnits;
        row.total_hours += workUnits * safeNumber(shift?.standard_hours);
        if (canViewSalary) {
            row.total_salary += calculateAttendanceAmount(record, employee, shift);
        }
    });

    adjustments
        .filter((adjustment) => monthDays.includes(dateValue(adjustment.adjustment_date)))
        .forEach((adjustment) => {
            const row = summary.get(String(adjustment.payroll_employee_id));
            if (!row) return;

            row.total_advance += Math.abs(safeNumber(adjustment.amount));
        });

    return Array.from(summary.values())
        .map((row) => ({
            ...row,
            has_multiple_salary_rates: row.salary_context_keys.size > 1,
        }))
        .map((row) => {
            const nextRow = {
                ...row,
                total_work_units: Math.round(row.total_work_units * 1000) / 1000,
                total_hours: Math.round(row.total_hours * 100) / 100,
                total_advance: Math.round(row.total_advance * 100) / 100,
                total_bonus: Math.round(row.total_bonus * 100) / 100,
                total_penalty: Math.round(row.total_penalty * 100) / 100,
                total_salary: row.total_salary === null ? null : Math.round(row.total_salary * 100) / 100,
            };
            delete nextRow.salary_context_keys;

            return {
                ...nextRow,
                remaining_salary: nextRow.total_salary === null ? null : Math.round((nextRow.total_salary - nextRow.total_advance) * 100) / 100,
                salary_basis: payrollSalaryBasisLabel(nextRow),
                salary_formula: payrollFormulaLabel(nextRow),
            };
        })
        .sort((left, right) => String(left.employee_code || '').localeCompare(String(right.employee_code || '')));
};

const buildDailyPayrollSummary = ({
    employees = [],
    records = [],
    shiftsById = new Map(),
    canViewSalary = false,
    monthDays = [],
}) => {
    const employeesById = new Map(employees.filter((employee) => employee.id).map((employee) => [String(employee.id), employee]));
    const rowsByDate = new Map(monthDays.map((date) => [date, {
        work_date: date,
        employee_ids: new Set(),
        shift_count: 0,
        total_work_units: 0,
        total_hours: 0,
        total_salary: canViewSalary ? 0 : null,
    }]));

    records.forEach((record) => {
        const workDate = dateValue(record.work_date);
        const row = rowsByDate.get(workDate);
        if (!row) return;

        const employee = employeesById.get(String(record.payroll_employee_id)) || record.employee;
        if (!employee?.id) return;

        const shift = shiftsById.get(String(record.payroll_work_shift_id)) || record.shift || {};
        const workUnits = safeNumber(record.work_units);

        if (workUnits > 0) {
            row.employee_ids.add(String(employee.id));
            row.shift_count += 1;
        }

        row.total_work_units += workUnits;
        row.total_hours += workUnits * safeNumber(shift?.standard_hours);
        if (canViewSalary) {
            row.total_salary += calculateAttendanceAmount(record, employee, shift);
        }
    });

    return Array.from(rowsByDate.values()).map(({ employee_ids: employeeIds, ...row }) => ({
        ...row,
        employee_count: employeeIds.size,
        total_work_units: Math.round(row.total_work_units * 1000) / 1000,
        total_hours: Math.round(row.total_hours * 100) / 100,
        total_salary: row.total_salary === null ? null : Math.round(row.total_salary * 100) / 100,
    }));
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
    standard_hours: parseDecimal(calculateShiftHours(row.start_time, row.end_time) || row.standard_hours),
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
    status: row.status || REGISTERED_SCHEDULE_STATUS,
    notes: row.notes || '',
}));

const attendancePayload = (rows) => rows.map((row) => ({
    id: row.id || null,
    payroll_schedule_registration_id: normalizeId(row.payroll_schedule_registration_id),
    work_date: row.work_date || '',
    payroll_employee_id: normalizeId(row.payroll_employee_id),
    payroll_work_shift_id: normalizeId(row.payroll_work_shift_id),
    attendance_status: row.attendance_status || 'Đi làm',
    work_units: parseWorkUnits(row.work_units || 0),
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

function MoneyInput({ value, onChange, disabled = false, suffix = 'đ', inputClassName = 'text-right' }) {
    const paddingClass = suffix === 'đ' ? 'pr-7' : 'pr-20';

    return (
        <div className="relative">
            <input
                type="text"
                inputMode="numeric"
                value={value === null || value === undefined || value === '' ? '' : moneyFormatter.format(Math.ceil(safeNumber(value)))}
                disabled={disabled}
                onChange={(event) => onChange(parseMoney(event.target.value))}
                className={`h-9 w-full rounded border border-gray-200 bg-white px-2.5 ${paddingClass} ${inputClassName} text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-gray-400">{suffix}</span>
        </div>
    );
}

function DecimalInput({ value, onChange, disabled = false, className = '', suffix = '', wrapperClassName = '' }) {
    if (suffix) {
        return (
            <div className={`flex h-9 w-full items-center rounded border border-gray-200 bg-white focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-100 ${disabled ? 'bg-gray-50 text-gray-400' : ''} ${wrapperClassName}`}>
                <input
                    type="text"
                    inputMode="decimal"
                    value={formatEditableDecimal(value)}
                    disabled={disabled}
                    onChange={(event) => onChange(parseDecimal(event.target.value))}
                    className={`h-full min-w-0 flex-1 bg-transparent px-2 text-center text-[13px] text-gray-800 outline-none disabled:text-gray-400 ${className}`}
                />
                <span className="shrink-0 pr-2 text-[10px] font-bold text-gray-400">{suffix}</span>
            </div>
        );
    }

    return (
        <input
            type="text"
            inputMode="decimal"
            value={formatEditableDecimal(value)}
            disabled={disabled}
            onChange={(event) => onChange(parseDecimal(event.target.value))}
            className={`h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-center text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
        />
    );
}

function SelectInput({ value, onChange, options, disabled = false, placeholder = 'Chọn', className = '' }) {
    return (
        <select
            value={value ?? ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={`h-9 w-full rounded border border-gray-200 bg-white px-2.5 text-[13px] text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
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
        <table className="w-full border-collapse text-center text-[12px]">
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

function DataTable({ columns, minWidth = 980, children, headerClassName = '' }) {
    return (
        <div className="overflow-auto">
            <table className="w-full border-collapse text-center text-[13px]" style={{ minWidth }}>
                <thead>
                    <tr>
                        {columns.map((column) => (
                            <th key={column} className={`sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-2 text-center text-[12px] font-bold text-gray-500 ${headerClassName}`}>{column}</th>
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

function FormulaTooltipValue({ value, formula }) {
    const [tooltip, setTooltip] = useState(null);
    const showTooltip = (event) => {
        if (!formula) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const placeAbove = rect.bottom + 96 > viewportHeight;
        setTooltip({
            left: rect.left + (rect.width / 2),
            top: placeAbove ? rect.top - 8 : rect.bottom + 8,
            placeAbove,
        });
    };

    return (
        <span
            className="inline-flex cursor-help items-center justify-center"
            title={formula || ''}
            tabIndex={0}
            onMouseEnter={showTooltip}
            onMouseMove={showTooltip}
            onMouseLeave={() => setTooltip(null)}
            onFocus={showTooltip}
            onBlur={() => setTooltip(null)}
        >
            <span className="border-b border-dotted border-teal-500">{value}</span>
            {tooltip && (
                <span
                    className="pointer-events-none fixed z-[9999] w-max max-w-[340px] -translate-x-1/2 rounded border border-gray-200 bg-white px-3 py-2 text-left text-[12px] font-semibold leading-5 text-gray-600 shadow-lg"
                    style={{
                        left: tooltip.left,
                        top: tooltip.top,
                        transform: `translate(-50%, ${tooltip.placeAbove ? '-100%' : '0'})`,
                    }}
                >
                    {formula}
                </span>
            )}
        </span>
    );
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

function ScheduleShiftButton({ shift, checked, disabled, defaulted, onClick }) {
    const code = shiftDisplayCode(shift);

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            title={`${shift?.shift_name || code} ${formatTime(shift?.start_time)}-${formatTime(shift?.end_time)}`}
            className={`relative inline-flex size-10 shrink-0 items-center justify-center rounded border text-[13px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'border-teal-600 bg-teal-700 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-500 hover:border-teal-300 hover:bg-teal-50'}`}
        >
            {code}
            {checked && (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-white bg-emerald-500 text-white">
                    <span className="material-symbols-outlined text-[12px]">done</span>
                </span>
            )}
            {defaulted && !checked && (
                <span className="absolute -bottom-1 -right-1 size-2 rounded-full bg-amber-400" />
            )}
        </button>
    );
}

function AttendanceShiftControl({ shift, record, disabled, onToggle, onHoursChange }) {
    const code = shiftDisplayCode(shift);
    const standardHours = safeNumber(shift?.standard_hours);
    const defaultWorkUnits = safeNumber(shift?.default_work_units || 1) || 1;
    const isFull = record?.attendance_status === 'Đi làm' && safeNumber(record.work_units) >= defaultWorkUnits;
    const hasPartial = record && !isFull && safeNumber(record.work_units) > 0;
    const hours = hasPartial && standardHours > 0
        ? formatDecimal((safeNumber(record.work_units) / defaultWorkUnits) * standardHours)
        : '';
    const workUnits = hasPartial && standardHours > 0
        ? formatWorkUnit(safeNumber(record.work_units))
        : '';

    return (
        <div className="flex min-w-[42px] flex-col items-center gap-1">
            <button
                type="button"
                disabled={disabled}
                onClick={onToggle}
                title={`${shift?.shift_name || code} ${formatTime(shift?.start_time)}-${formatTime(shift?.end_time)}`}
                className={`relative inline-flex size-9 items-center justify-center rounded border text-[12px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isFull ? 'border-teal-600 bg-teal-700 text-white shadow-sm' : hasPartial ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-500 hover:border-teal-300 hover:bg-teal-50'}`}
            >
                {code}
                {isFull && (
                    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-white bg-emerald-500 text-white">
                        <span className="material-symbols-outlined text-[12px]">done</span>
                    </span>
                )}
            </button>
            {!isFull && (
                <input
                    type="text"
                    inputMode="decimal"
                    disabled={disabled}
                    value={hours}
                    placeholder="giờ"
                    onChange={(event) => onHoursChange(event.target.value)}
                    title={workUnits ? `${workUnits} công` : 'Nhập giờ thực tế'}
                    className="h-5 w-10 rounded border border-gray-200 bg-white px-1 text-center text-[10px] font-bold text-gray-700 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-100 disabled:bg-gray-50 disabled:text-gray-400"
                />
            )}
            {hasPartial && <span className="text-[9px] font-bold text-amber-700">{workUnits} công</span>}
        </div>
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
    const [weekStart, setWeekStart] = useState(firstDayOfMonth(currentMonth()));
    const [attendanceFilterMode, setAttendanceFilterMode] = useState('month');
    const [attendanceDate, setAttendanceDate] = useState(isoDate(new Date()));
    const [scheduleWeekFilter, setScheduleWeekFilter] = useState('all');
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
    const [scheduleEmployees, setScheduleEmployees] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [employeeProfileKey, setEmployeeProfileKey] = useState('');
    const [zoomImage, setZoomImage] = useState({ url: '', title: '' });
    const [showShiftModal, setShowShiftModal] = useState(false);

    useEffect(() => {
        let active = true;
        payrollApi.getOverview({ month, department: departmentFilter || undefined })
            .then((response) => {
                if (!active) return;
                const nextData = response?.data?.data || BLANK_DATA;
                const normalizedEmployees = (nextData.employees || []).map(normalizeEmployee);
                const normalizedScheduleEmployees = (nextData.schedule_employees || nextData.employees || []).map(normalizeEmployee);
                setData({ ...nextData, employees: normalizedEmployees, schedule_employees: normalizedScheduleEmployees });
                setEmployees(normalizedEmployees);
                setScheduleEmployees(normalizedScheduleEmployees);
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
                setScheduleEmployees([]);
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
    const selfEmployeeId = String(scope.self_employee_id || scope.employee_id || '');
    const canEditOwnSchedule = Boolean(scope.can_edit_own_schedule || canEditAttendance);
    const canSaveSchedules = canEditAttendance || (canEditOwnSchedule && Boolean(selfEmployeeId));
    const canEditScheduleForEmployee = (employee) => canEditAttendance || (
        canEditOwnSchedule
        && selfEmployeeId
        && String(employee?.id || '') === selfEmployeeId
    );
    const employeeById = useMemo(() => new Map(employees.map((employee) => [String(employee.id), employee])), [employees]);
    const shiftById = useMemo(() => new Map(shifts.map((shift) => [String(shift.id), shift])), [shifts]);
    const activeShifts = useMemo(() => shifts.filter((shift) => shift.id && shift.is_active !== false).slice().sort(activeShiftSorter), [shifts]);
    const primaryFullTimeShifts = activeShifts.filter((shift) => isPrimaryFullTimeShift(shift));
    const fullTimeDefaultShifts = primaryFullTimeShifts.length > 0 ? primaryFullTimeShifts : activeShifts.slice(0, 2);
    const fullTimeDefaultShiftIds = new Set(fullTimeDefaultShifts.map((shift) => String(shift.id)));
    const weekDays = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => isoDate(addDays(dateFromInput(weekStart), index)))
            .filter((date) => isDateInMonth(date, month))
    ), [month, weekStart]);
    const monthDays = useMemo(() => datesBetween(firstDayOfMonth(month), lastDayOfMonth(month)), [month]);
    const monthWeeks = useMemo(() => monthWeeksOf(month), [month]);
    const scheduleDisplayWeeks = useMemo(() => (
        monthWeeks.slice().sort((left, right) => left.weekNumber - right.weekNumber)
    ), [monthWeeks]);
    const scheduleVisibleWeeks = useMemo(() => (
        scheduleWeekFilter === 'all'
            ? scheduleDisplayWeeks
            : scheduleDisplayWeeks.filter((week) => week.weekNumber === Number(scheduleWeekFilter))
    ), [scheduleDisplayWeeks, scheduleWeekFilter]);
    const scheduleWeekNumbers = useMemo(() => new Set(scheduleDisplayWeeks.map((week) => week.weekNumber)), [scheduleDisplayWeeks]);
    const attendanceAutoFillDays = useMemo(() => {
        const today = isoDate(new Date());
        const thisMonth = currentMonth();

        if (month > thisMonth) {
            return [];
        }

        if (month < thisMonth) {
            return monthDays;
        }

        return monthDays.filter((date) => date <= today);
    }, [month, monthDays]);
    const visibleAttendanceWeeks = useMemo(() => {
        const today = isoDate(new Date());
        const thisMonth = currentMonth();

        if (month > thisMonth) {
            return [];
        }

        if (month === thisMonth) {
            return monthWeeks.filter((week) => week.days.some((date) => date <= today));
        }

        return monthWeeks;
    }, [month, monthWeeks]);
    const attendanceFilterDays = useMemo(() => (
        attendanceFilterMode === 'day' && isDateInMonth(attendanceDate, month) ? [attendanceDate] : monthDays
    ), [attendanceDate, attendanceFilterMode, month, monthDays]);
    const attendanceDisplayWeeks = useMemo(() => {
        if (attendanceFilterMode === 'day') {
            const selectedWeek = monthWeeks.find((week) => week.days.includes(attendanceDate));
            return isDateInMonth(attendanceDate, month) ? [{
                weekNumber: selectedWeek?.weekNumber || 1,
                days: [attendanceDate],
            }] : [];
        }

        return visibleAttendanceWeeks;
    }, [attendanceDate, attendanceFilterMode, month, monthWeeks, visibleAttendanceWeeks]);
    const attendanceTitle = attendanceFilterMode === 'day'
        ? `Ch\u1ea5m c\u00f4ng ng\u00e0y ${shortDate(attendanceDate)}`
        : `Ch\u1ea5m c\u00f4ng th\u00e1ng ${month}`;
    const attendanceFilterLabel = attendanceFilterMode === 'day'
        ? shortDate(attendanceDate)
        : `${shortDate(firstDayOfMonth(month))} - ${shortDate(lastDayOfMonth(month))}`;
    const serverPayrollSummary = data.payroll_summary || [];
    const filteredEmployees = employees;
    const activeEmployees = filteredEmployees.filter((employee) => employee.status !== 'Nghỉ việc');
    const activeScheduleEmployees = scheduleEmployees.filter((employee) => employee.status !== 'Nghỉ việc');
    const monthSchedules = schedulesForDates(monthDays, activeEmployees);
    const attendanceFilterSchedules = monthSchedules.filter((schedule) => attendanceFilterDays.includes(schedule.work_date));
    const attendanceWithScheduleDefaults = useMemo(() => {
        const existingKeys = new Set(attendance.map(attendanceKey));
        const defaultRows = schedulesForDates(attendanceAutoFillDays)
            .filter((schedule) => !existingKeys.has(attendanceKey(schedule)))
            .map((schedule) => {
                const shift = shiftById.get(String(schedule.payroll_work_shift_id)) || schedule.shift || {};
                return {
                    uid: `auto-attendance-${attendanceKey(schedule)}`,
                    virtual_auto_attendance: true,
                    payroll_schedule_registration_id: schedule.id || null,
                    work_date: schedule.work_date,
                    payroll_employee_id: schedule.payroll_employee_id,
                    payroll_work_shift_id: schedule.payroll_work_shift_id,
                    attendance_status: 'Đi làm',
                    work_units: parseWorkUnits(schedule.registered_work_units || shift.default_work_units || 1),
                    unit_rate: '',
                    bonus_amount: '',
                    penalty_amount: '',
                    notes: '',
                };
            });

        return [...attendance, ...defaultRows];
    }, [activeEmployees, attendance, attendanceAutoFillDays, fullTimeDefaultShifts, schedules, shiftById]);
    const weekAttendance = attendanceWithScheduleDefaults.filter((record) => weekDays.includes(record.work_date));
    const monthAttendance = attendanceWithScheduleDefaults.filter((record) => monthDays.includes(record.work_date));
    const attendanceFilterRecords = attendanceWithScheduleDefaults.filter((record) => attendanceFilterDays.includes(record.work_date));
    const payrollSummary = useMemo(() => {
        if (employees.length === 0 && serverPayrollSummary.length > 0) {
            return serverPayrollSummary;
        }

        return buildLocalPayrollSummary({
            employees,
            records: monthAttendance,
            shiftsById: shiftById,
            canViewSalary,
            adjustments,
            monthDays,
        });
    }, [adjustments, canViewSalary, employees, monthAttendance, monthDays, serverPayrollSummary, shiftById]);
    const dailySalarySummary = useMemo(() => buildDailyPayrollSummary({
        employees,
        records: monthAttendance,
        shiftsById: shiftById,
        canViewSalary,
        monthDays,
    }), [canViewSalary, employees, monthAttendance, monthDays, shiftById]);
    const employeeOptions = employees.filter((employee) => employee.id).map((employee) => ({
        value: employee.id,
        label: employee.full_name || 'Chưa đặt tên',
    }));
    const userOptions = (data.users || []).map((user) => ({
        value: user.id,
        label: [user.name, user.email].filter(Boolean).join(' - ') || `User #${user.id}`,
    }));
    const accountLabel = (employee) => {
        const user = employee?.user || {};
        return [user.name, user.email].filter(Boolean).join(' - ') || (employee?.user_id ? `User #${employee.user_id}` : 'Chưa gắn');
    };
    const employeeProfile = employees.find((employee) => employeeRowKey(employee) === employeeProfileKey) || null;

    const totalHours = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_hours), 0);
    const totalWorkUnits = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_work_units), 0);
    const totalSalary = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_salary), 0);
    const totalAdvance = payrollSummary.reduce((sum, row) => sum + safeNumber(row.total_advance), 0);
    const totalRemainingSalary = payrollSummary.reduce((sum, row) => sum + safeNumber(row.remaining_salary), 0);
    const dailySalaryRowsWithWork = dailySalarySummary.filter((row) => row.shift_count > 0 || safeNumber(row.total_work_units) > 0);
    const dailySalaryWorkDays = dailySalaryRowsWithWork.length;
    const averageDailySalary = dailySalaryWorkDays > 0 ? totalSalary / dailySalaryWorkDays : 0;
    const highestDailySalary = dailySalaryRowsWithWork.reduce((best, row) => (
        !best || safeNumber(row.total_salary) > safeNumber(best.total_salary) ? row : best
    ), null);
    const highestDailySalaryLabel = highestDailySalary
        ? `${shortDate(highestDailySalary.work_date)} - ${canViewSalary ? formatMoney(highestDailySalary.total_salary) : 'Ẩn'}`
        : '-';
    const attendanceMonthHours = attendanceFilterRecords.reduce((sum, record) => sum + attendanceHours(record), 0);
    const attendanceMonthWorkUnits = attendanceFilterRecords.reduce((sum, record) => sum + safeNumber(record.work_units), 0);
    const manualCount = monthAttendance.filter((record) => !isFullAttendance(record)).length;
    const partialAttendanceCount = attendanceFilterRecords.filter((record) => safeNumber(record.work_units) > 0 && !isFullAttendance(record)).length;

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
                standard_work_units: DEFAULT_STANDARD_WORK_UNITS,
                effective_from: effectiveFrom,
                notes: '',
            }],
            deleted_salary_rate_ids: [],
            standard_work_units: DEFAULT_STANDARD_WORK_UNITS,
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

    function saveEmployees() {
        return saveRows(
            'employees',
            () => payrollApi.saveEmployees(employeePayload(employees)),
            '\u0110\u00e3 l\u01b0u nh\u00e2n vi\u00ean.'
        );
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
        const nextMonth = value || currentMonth();

        setMonth(nextMonth);
        setWeekStart(firstDayOfMonth(nextMonth));
        setAttendanceDate((current) => (isDateInMonth(current, nextMonth) ? current : firstDayOfMonth(nextMonth)));
        setScheduleWeekFilter('all');
        setLoading(true);
        setMessage('');
        setError('');
    }

    function changeAttendanceFilterMode(value) {
        setAttendanceFilterMode(value);
        if (value === 'day' && !isDateInMonth(attendanceDate, month)) {
            setAttendanceDate(firstDayOfMonth(month));
        }
        setMessage('');
        setError('');
    }

    function changeAttendanceDate(value) {
        const nextDate = dateValue(value) || isoDate(new Date());
        const nextMonth = monthOfDate(nextDate);

        setAttendanceDate(nextDate);
        if (nextMonth !== month) {
            setMonth(nextMonth);
            setWeekStart(firstDayOfMonth(nextMonth));
            setScheduleWeekFilter('all');
            setLoading(true);
        }
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

    function attendanceHours(record, shift = resolveShift(record)) {
        const standardHours = safeNumber(shift?.standard_hours);
        const defaultWorkUnits = safeNumber(shift?.default_work_units || 1) || 1;
        return defaultWorkUnits > 0 ? (safeNumber(record?.work_units) / defaultWorkUnits) * standardHours : 0;
    }

    function schedulesForDates(dates, rosterEmployees = activeEmployees) {
        const rosterEmployeeIds = new Set(rosterEmployees.map((employee) => String(employee.id || '')).filter(Boolean));

        return [
            ...schedules.filter((schedule) => (
                dates.includes(schedule.work_date)
                && schedule.status !== CANCELLED_SCHEDULE_STATUS
                && rosterEmployeeIds.has(String(schedule.payroll_employee_id || ''))
            )),
            ...rosterEmployees.flatMap((employee) => {
                if (!employee.id || !isFullTime(employee)) return [];

                return dates.flatMap((date) => fullTimeDefaultShifts
                    .filter((shift) => !schedules.some((schedule) => (
                        String(schedule.payroll_employee_id) === String(employee.id)
                        && schedule.work_date === date
                        && String(schedule.payroll_work_shift_id) === String(shift.id)
                    )))
                    .map((shift) => ({
                        uid: `default-${employee.id}-${date}-${shift.id}`,
                        virtual_default: true,
                        work_date: date,
                        payroll_employee_id: employee.id,
                        payroll_work_shift_id: shift.id,
                        registered_work_units: parseDecimal(shift.default_work_units || 1),
                        status: REGISTERED_SCHEDULE_STATUS,
                        notes: '',
                    })));
            }),
        ];
    }

    function findSchedule(employeeId, date, shiftId) {
        return schedules.find((schedule) => (
            String(schedule.payroll_employee_id) === String(employeeId)
            && schedule.work_date === date
            && String(schedule.payroll_work_shift_id) === String(shiftId)
        ));
    }

    function isScheduleShiftChecked(employee, date, shift) {
        const existing = findSchedule(employee.id, date, shift.id);
        if (existing) return existing.status !== CANCELLED_SCHEDULE_STATUS;

        return isFullTime(employee) && fullTimeDefaultShiftIds.has(String(shift.id));
    }

    function toggleScheduleShift(employee, date, shift) {
        if (!employee.id || !shift.id) return;

        const existing = findSchedule(employee.id, date, shift.id);
        if (existing) {
            const checked = existing.status !== CANCELLED_SCHEDULE_STATUS;
            if (checked && !existing.id && !isFullTime(employee)) {
                setSchedules((rows) => rows.filter((row) => row !== existing));
                return;
            }

            updateRow(setSchedules, existing, {
                registered_work_units: shift.default_work_units || existing.registered_work_units || 1,
                status: checked ? CANCELLED_SCHEDULE_STATUS : REGISTERED_SCHEDULE_STATUS,
            });
            return;
        }

        const checkedByDefault = isFullTime(employee) && fullTimeDefaultShiftIds.has(String(shift.id));
        setSchedules((rows) => [...rows, {
            uid: tempId(),
            work_date: date,
            payroll_employee_id: employee.id,
            payroll_work_shift_id: shift.id,
            registered_work_units: shift.default_work_units || 1,
            status: checkedByDefault ? CANCELLED_SCHEDULE_STATUS : REGISTERED_SCHEDULE_STATUS,
            notes: '',
        }]);
    }

    function schedulesWithFullTimeDefaults(rosterEmployees = activeEmployees) {
        const existingKeys = new Set(schedules.map(scheduleKey));
        const defaultRows = rosterEmployees.flatMap((employee) => {
            if (!employee.id || !isFullTime(employee)) return [];

            return monthDays.flatMap((date) => fullTimeDefaultShifts
                .filter((shift) => !existingKeys.has([
                    date,
                    employee.id,
                    shift.id,
                ].join('|')))
                .map((shift) => ({
                    uid: tempId(),
                    work_date: date,
                    payroll_employee_id: employee.id,
                    payroll_work_shift_id: shift.id,
                    registered_work_units: shift.default_work_units || 1,
                    status: REGISTERED_SCHEDULE_STATUS,
                    notes: '',
                })));
        });

        return [...schedules, ...defaultRows];
    }

    function schedulesForSave() {
        const rosterEmployees = canEditAttendance ? activeScheduleEmployees : activeEmployees;
        const rows = schedulesWithFullTimeDefaults(rosterEmployees);

        if (canEditAttendance) return rows;

        return rows.filter((row) => String(row.payroll_employee_id || '') === selfEmployeeId);
    }

    function updateShiftTime(shift, patch) {
        const nextShift = { ...shift, ...patch };
        const nextHours = calculateShiftHours(nextShift.start_time, nextShift.end_time);
        updateRow(setShifts, shift, {
            ...patch,
            ...(nextHours !== '' ? { standard_hours: nextHours } : {}),
        });
    }

    function createAttendanceFromSchedule() {
        const existingKeys = new Set(attendance.map((record) => [
            record.work_date,
            record.payroll_employee_id,
            record.payroll_work_shift_id,
        ].join('|')));

        const sourceSchedules = schedulesForDates(attendanceAutoFillDays);
        const newRows = sourceSchedules
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
                    work_units: parseWorkUnits(schedule.registered_work_units || shift.default_work_units || 1),
                    unit_rate: '',
                    bonus_amount: '',
                    penalty_amount: '',
                    notes: '',
                };
            });

        if (newRows.length === 0) {
            setMessage(attendanceAutoFillDays.length === 0
                ? 'Ch\u01b0a t\u1edbi ng\u00e0y n\u00e0o trong th\u00e1ng n\u00e0y \u0111\u1ec3 t\u1ea1o ch\u1ea5m c\u00f4ng.'
                : 'Th\u00e1ng n\u00e0y kh\u00f4ng c\u00f3 l\u1ecbch m\u1edbi c\u1ea7n t\u1ea1o ch\u1ea5m c\u00f4ng.');
            setActiveView('attendance');
            return;
        }

        setAttendance((rows) => [...rows, ...newRows]);
        setMessage(`\u0110\u00e3 t\u1ea1o ${newRows.length} d\u00f2ng ch\u1ea5m c\u00f4ng t\u1eeb l\u1ecbch t\u1edbi ng\u00e0y hi\u1ec7n t\u1ea1i.`);
        setActiveView('attendance');
    }

    function findAttendanceRecord(employeeId, date, shiftId) {
        return attendanceWithScheduleDefaults.find((record) => (
            String(record.payroll_employee_id) === String(employeeId)
            && record.work_date === date
            && String(record.payroll_work_shift_id) === String(shiftId)
        ));
    }

    function attendanceShiftsFor(employee, date) {
        const byId = new Map();

        monthSchedules
            .filter((schedule) => (
                String(schedule.payroll_employee_id) === String(employee.id)
                && schedule.work_date === date
                && schedule.status !== CANCELLED_SCHEDULE_STATUS
            ))
            .forEach((schedule) => {
                const shift = shiftById.get(String(schedule.payroll_work_shift_id)) || schedule.shift;
                if (shift?.id) byId.set(String(shift.id), shift);
            });

        attendance
            .filter((record) => (
                String(record.payroll_employee_id) === String(employee.id)
                && record.work_date === date
            ))
            .forEach((record) => {
                const shift = shiftById.get(String(record.payroll_work_shift_id)) || record.shift;
                if (shift?.id) byId.set(String(shift.id), shift);
            });

        return Array.from(byId.values()).sort(activeShiftSorter);
    }

    function buildAttendanceRow(employee, date, shift, patch = {}) {
        const schedule = findSchedule(employee.id, date, shift.id);
        return {
            uid: tempId(),
            payroll_schedule_registration_id: schedule?.id || null,
            work_date: date,
            payroll_employee_id: employee.id,
            payroll_work_shift_id: shift.id,
            attendance_status: 'Đi làm',
            work_units: parseWorkUnits(shift.default_work_units || 1),
            unit_rate: '',
            bonus_amount: '',
            penalty_amount: '',
            notes: '',
            ...patch,
        };
    }

    function upsertAttendanceShift(employee, date, shift, patch) {
        const existing = findAttendanceRecord(employee.id, date, shift.id);
        const schedule = findSchedule(employee.id, date, shift.id);

        if (existing && !existing.virtual_auto_attendance) {
            updateRow(setAttendance, existing, {
                payroll_schedule_registration_id: existing.payroll_schedule_registration_id || schedule?.id || null,
                ...patch,
            });
            return;
        }

        setAttendance((rows) => [...rows, buildAttendanceRow(employee, date, shift, patch)]);
    }

    function clearAttendanceShift(record) {
        if (!record) return;

        if (record.virtual_auto_attendance) {
            setAttendance((rows) => [...rows, {
                ...record,
                uid: tempId(),
                virtual_auto_attendance: false,
                attendance_status: 'Nghỉ',
                work_units: 0,
            }]);
            return;
        }

        if (!record.id) {
            setAttendance((rows) => rows.filter((row) => row !== record));
            return;
        }

        updateRow(setAttendance, record, {
            attendance_status: 'Nghỉ',
            work_units: 0,
        });
    }

    function toggleAttendanceShift(employee, date, shift) {
        const existing = findAttendanceRecord(employee.id, date, shift.id);
        if (existing && isFullAttendance(existing)) {
            clearAttendanceShift(existing);
            return;
        }

        upsertAttendanceShift(employee, date, shift, {
            attendance_status: 'Đi làm',
            work_units: parseWorkUnits(shift.default_work_units || 1),
        });
    }

    function setAttendanceShiftHours(employee, date, shift, hours) {
        const value = safeNumber(String(hours).replace(',', '.'));
        const existing = findAttendanceRecord(employee.id, date, shift.id);
        const standardHours = safeNumber(shift.standard_hours);
        const defaultWorkUnits = safeNumber(shift.default_work_units || 1) || 1;

        if (!value || value <= 0) {
            clearAttendanceShift(existing);
            return;
        }

        const nextWorkUnits = standardHours > 0 ? (value / standardHours) * defaultWorkUnits : 0;
        const isFull = nextWorkUnits >= defaultWorkUnits;

        upsertAttendanceShift(employee, date, shift, {
            attendance_status: isFull ? 'Đi làm' : 'Làm lẻ',
            work_units: parseWorkUnits(isFull ? defaultWorkUnits : nextWorkUnits),
        });
    }

    async function deleteAdjustment(adjustment) {
        if (!adjustment.id) {
            setAdjustments((rows) => rows.filter((row) => row !== adjustment));
            return;
        }

        const confirmed = window.confirm('Xoá khoản tạm ứng này?');
        if (!confirmed) return;

        setSavingKey(`delete-adjustment-${adjustment.id}`);
        setMessage('');
        setError('');
        try {
            await payrollApi.deleteAdjustment(adjustment.id);
            setMessage('Đã xoá khoản tạm ứng.');
            reloadData();
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Không xoá được khoản tạm ứng.');
        } finally {
            setSavingKey('');
        }
    }

    function exportSalaryCsv() {
        const header = ['Họ tên', 'Loại', 'Định mức lương', 'Tổng giờ', 'Tổng công', 'Tổng lương', 'Tạm ứng', 'Còn thanh toán', 'Ghi chú công thức'];
        const body = payrollSummary.map((row) => [
            row.full_name || '',
            employeeTypeLabel(row.salary_type),
            row.salary_basis || '',
            safeNumber(row.total_hours),
            safeNumber(row.total_work_units),
            row.total_salary ?? '',
            row.total_advance ?? '',
            row.remaining_salary ?? '',
            row.salary_formula || '',
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

    function exportDailySalaryCsv() {
        const header = ['Ngày', 'Thứ', 'Nhân viên có công', 'Số ca', 'Tổng giờ', 'Tổng công', 'Lương phải trả'];
        const body = dailySalarySummary.map((row) => [
            row.work_date || '',
            weekday(row.work_date),
            row.employee_count,
            row.shift_count,
            safeNumber(row.total_hours),
            safeNumber(row.total_work_units),
            canViewSalary ? (row.total_salary ?? '') : 'Ẩn',
        ]);
        const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `luong-theo-ngay-${month}.csv`;
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
                                    <td className="border-b border-gray-100 px-3 py-2 text-center text-gray-600">{formatSalary(employee.salary_amount, employee.salary_type)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2"><StatusBadge tone={employee.status === 'Đang làm' ? 'green' : 'amber'}>{employee.status || 'Đang làm'}</StatusBadge></td>
                                </tr>
                            )}
                        />
                    </Panel>

                    <Panel title="2. Lịch làm" icon="calendar_month" onOpen={() => setActiveView('schedule')} footer={`Tổng: ${monthSchedules.length} lịch tháng này`}>
                        <MiniTable
                            columns={['Nhân viên', 'Ngày', 'Ca', 'Giờ ca']}
                            rows={monthSchedules.slice(0, 4)}
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
                                        <td className="border-b border-gray-100 px-3 py-2 text-center text-gray-700">
                                            {formatDecimal(attendanceHours(record, shift))} / {formatWorkUnit(record.work_units)}
                                        </td>
                                    </tr>
                                );
                            }}
                        />
                    </Panel>

                    <Panel title="4. Tạm ứng" icon="receipt_long" onOpen={() => setActiveView('adjustments')} footer={`Tổng tạm ứng: ${formatMoney(totalAdvance)}`}>
                        <MiniTable
                            columns={['Ngày', 'Nhân viên', 'Số tiền']}
                            rows={adjustments.slice(0, 4)}
                            renderRow={(adjustment) => {
                                const employee = resolveEmployee(adjustment);
                                return (
                                    <tr key={adjustment.id || adjustment.uid} className="hover:bg-gray-50">
                                        <td className="border-b border-gray-100 px-3 py-2 text-gray-600">{shortDate(adjustment.adjustment_date)}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{employee.full_name || '-'}</td>
                                        <td className="border-b border-gray-100 px-3 py-2 text-center font-bold text-teal-700">{formatMoney(adjustment.amount)}</td>
                                    </tr>
                                );
                            }}
                        />
                    </Panel>

                    <Panel title="5. Bảng lương tháng" icon="payments" onOpen={() => setActiveView('salary')} footer={`Còn thanh toán: ${formatMoney(totalRemainingSalary)}`}>
                        <MiniTable
                            columns={['Nhân viên', 'Tổng lương', 'Tạm ứng', 'Còn thanh toán']}
                            rows={payrollSummary.slice(0, 4)}
                            renderRow={(row) => (
                                <tr key={row.payroll_employee_id || row.employee_code} className="hover:bg-gray-50">
                                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{row.full_name || '-'}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-center font-bold text-teal-700">
                                        <FormulaTooltipValue value={formatMoney(row.total_salary)} formula={row.salary_formula} />
                                    </td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-center font-bold text-amber-700">{formatMoney(row.total_advance)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-center font-bold text-emerald-700">{formatMoney(row.remaining_salary)}</td>
                                </tr>
                            )}
                        />
                    </Panel>

                    <Panel title="6. Báo cáo" icon="bar_chart" onOpen={() => setActiveView('reports')} footer={`Tổng tháng: ${formatMoney(totalSalary)}`}>
                        <MiniTable
                            columns={['Tháng', 'Tổng giờ', 'Quỹ lương', 'Xuất']}
                            rows={[month]}
                            renderRow={(item) => (
                                <tr key={item} className="hover:bg-gray-50">
                                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-800">{item}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-center text-gray-600">{formatDecimal(totalHours)}</td>
                                    <td className="border-b border-gray-100 px-3 py-2 text-center font-bold text-teal-700">{formatMoney(totalSalary)}</td>
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
                <DataTable columns={['Tên nhân viên', 'Tài khoản', 'Loại', 'Lương', 'Công chuẩn', 'Áp dụng từ', 'Số điện thoại', 'QR ngân hàng', 'Địa chỉ', 'Trạng thái', 'Hồ sơ']} minWidth={1460}>
                    {employees.length === 0 ? <EmptyRow colSpan={11} message="Chưa có nhân viên." /> : employees.map((employee) => (
                        <tr key={employee.id || employee.uid} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="w-[150px] px-2 py-2">
                                <TextInput disabled={!canManagePayroll} value={employee.full_name} onChange={(value) => updateRow(setEmployees, employee, { full_name: value })} placeholder="Tên nhân viên" />
                            </td>
                            <td className="w-[180px] px-2 py-2">
                                {canManagePayroll ? (
                                    <SelectInput disabled={!canManagePayroll} value={employee.user_id} onChange={(value) => updateRow(setEmployees, employee, { user_id: value })} options={userOptions} placeholder="Gắn tài khoản" />
                                ) : (
                                    <div className="truncate text-center text-[12px] font-semibold text-gray-700" title={accountLabel(employee)}>
                                        {accountLabel(employee)}
                                    </div>
                                )}
                            </td>
                            <td className="w-[112px] px-2 py-2"><SelectInput disabled={!canManagePayroll} value={employee.salary_type} onChange={(value) => updateRow(setEmployees, employee, { salary_type: value, salary_effective_from: dateValue(employee.salary_effective_from) || firstDayOfMonth(month), ...(value === 'theo_thang' && !employee.standard_work_units ? { standard_work_units: DEFAULT_STANDARD_WORK_UNITS } : {}) })} options={EMPLOYEE_TYPES} /></td>
                            <td className="w-[185px] px-2 py-2">{canViewSalary ? <MoneyInput disabled={!canManagePayroll} value={employee.salary_amount} suffix={salaryUnitLabel(employee.salary_type)} onChange={(value) => updateRow(setEmployees, employee, { salary_amount: value, salary_effective_from: dateValue(employee.salary_effective_from) || firstDayOfMonth(month) })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                            <td className="w-[132px] px-2 py-2">
                                {employee.salary_type === 'theo_thang' ? (
                                    canViewSalary ? (
                                        <DecimalInput disabled={!canManagePayroll} value={employee.standard_work_units || DEFAULT_STANDARD_WORK_UNITS} suffix="ngày / tháng" wrapperClassName="mx-auto max-w-[124px]" onChange={(value) => updateRow(setEmployees, employee, { standard_work_units: value, salary_effective_from: dateValue(employee.salary_effective_from) || firstDayOfMonth(month) })} />
                                    ) : <span className="text-gray-400">Ẩn</span>
                                ) : <span className="block h-9" />}
                            </td>
                            <td className="w-[140px] px-2 py-2">{canViewSalary ? <TextInput type="date" disabled={!canManagePayroll} value={dateValue(employee.salary_effective_from)} onChange={(value) => updateRow(setEmployees, employee, { salary_effective_from: value })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                            <td className="w-[140px] px-2 py-2"><TextInput disabled={!canManagePayroll} value={employee.phone} onChange={(value) => updateRow(setEmployees, employee, { phone: value })} placeholder="Số điện thoại" /></td>
                            <td className="w-[96px] px-2 py-2">
                                <BankQrPreview
                                    url={canViewSalary ? employee.bank_qr_image_url : ''}
                                    sizeClass="size-20"
                                    onZoom={() => setZoomImage({ url: employee.bank_qr_image_url, title: 'QR tài khoản ngân hàng' })}
                                />
                            </td>
                            <td className="w-[112px] px-2 py-2">
                                <div className="max-w-[112px] truncate text-[13px] text-gray-700" title={employee.address || ''}>
                                    {employee.address || <span className="text-gray-400">Chưa nhập</span>}
                                </div>
                            </td>
                            <td className="w-[112px] px-2 py-2"><SelectInput disabled={!canManagePayroll} value={employee.status} onChange={(value) => updateRow(setEmployees, employee, { status: value })} options={EMPLOYEE_STATUS} /></td>
                            <td className="w-[76px] px-2 py-2">
                                <button type="button" onClick={() => setEmployeeProfileKey(employeeRowKey(employee))} className="inline-flex h-9 items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-2 text-[12px] font-bold text-teal-700 hover:bg-teal-100">
                                    <span className="material-symbols-outlined text-[18px]">badge</span>
                                    Hồ sơ
                                </button>
                            </td>
                        </tr>
                    ))}
                </DataTable>
                {canManagePayroll && (
                    <div className="sticky bottom-0 z-20 flex flex-col gap-3 border-t border-teal-100 bg-teal-50/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-[12px] font-semibold text-teal-800">
                            {'Sau khi \u0111\u1ed5i lo\u1ea1i nh\u00e2n vi\u00ean ho\u1eb7c l\u01b0\u01a1ng, b\u1ea5m L\u01b0u nh\u00e2n vi\u00ean \u0111\u1ec3 c\u1eadp nh\u1eadt.'}
                        </div>
                        <SaveButton saving={savingKey === 'employees'} disabled={!canManagePayroll} onClick={saveEmployees}>
                            {'\u004c\u01b0u nh\u00e2n vi\u00ean'}
                        </SaveButton>
                    </div>
                )}
            </DetailShell>
        );
    }

    function addShift() {
        setShifts((rows) => [...rows, {
            uid: tempId(),
            shift_code: '',
            shift_name: '',
            start_time: '08:00',
            end_time: '12:00',
            standard_hours: calculateShiftHours('08:00', '12:00'),
            default_work_units: 1,
            wage_multiplier: 1,
            is_active: true,
            sort_order: rows.length * 10 + 10,
            notes: '',
        }]);
    }

    function renderShiftModal() {
        if (!showShiftModal) return null;

        return (
            <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/45 px-4 py-6" onClick={() => setShowShiftModal(false)}>
                <section className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-[16px] font-bold text-gray-900">Ca làm</h2>
                        <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" disabled={!canManagePayroll} onClick={addShift} className="inline-flex h-9 items-center gap-2 rounded border border-gray-200 bg-white px-3 text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                Thêm ca
                            </button>
                            <SaveButton saving={savingKey === 'shifts'} disabled={!canManagePayroll} onClick={() => saveRows('shifts', () => payrollApi.saveShifts(shiftPayload(shifts)), 'Đã lưu ca làm.')} />
                            <button type="button" onClick={() => setShowShiftModal(false)} className="inline-flex size-9 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="Đóng">
                                <span className="material-symbols-outlined text-[21px]">close</span>
                            </button>
                        </div>
                    </div>
                    <div className="min-h-0 overflow-auto p-4">
                        <DataTable columns={['Mã ca', 'Tên ca', 'Bắt đầu', 'Kết thúc', 'Giờ', 'Công', 'Hệ số', 'Hoạt động', 'Ghi chú']} minWidth={980}>
                            {shifts.length === 0 ? <EmptyRow colSpan={9} message="Chưa có ca làm." /> : shifts.map((shift) => (
                                <tr key={shift.id || shift.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="px-3 py-2 text-center"><TextInput disabled={!canManagePayroll} value={shift.shift_code} onChange={(value) => updateRow(setShifts, shift, { shift_code: value })} placeholder="S" className="text-center" /></td>
                                    <td className="px-3 py-2 text-center"><TextInput disabled={!canManagePayroll} value={shift.shift_name} onChange={(value) => updateRow(setShifts, shift, { shift_name: value })} placeholder="Ca sáng" className="text-center" /></td>
                                    <td className="px-3 py-2 text-center"><TextInput type="time" disabled={!canManagePayroll} value={formatTime(shift.start_time)} onChange={(value) => updateShiftTime(shift, { start_time: value })} className="text-center" /></td>
                                    <td className="px-3 py-2 text-center"><TextInput type="time" disabled={!canManagePayroll} value={formatTime(shift.end_time)} onChange={(value) => updateShiftTime(shift, { end_time: value })} className="text-center" /></td>
                                    <td className="px-3 py-2 text-center"><DecimalInput disabled={!canManagePayroll} value={shift.standard_hours} onChange={(value) => updateRow(setShifts, shift, { standard_hours: value })} /></td>
                                    <td className="px-3 py-2 text-center"><DecimalInput disabled={!canManagePayroll} value={shift.default_work_units} onChange={(value) => updateRow(setShifts, shift, { default_work_units: value })} /></td>
                                    <td className="px-3 py-2 text-center"><DecimalInput disabled={!canManagePayroll} value={shift.wage_multiplier} onChange={(value) => updateRow(setShifts, shift, { wage_multiplier: value })} /></td>
                                    <td className="px-3 py-2 text-center">
                                        <button
                                            type="button"
                                            disabled={!canManagePayroll}
                                            onClick={() => updateRow(setShifts, shift, { is_active: !shift.is_active })}
                                            className={`inline-flex h-9 items-center justify-center gap-2 rounded border px-3 text-[12px] font-bold disabled:opacity-50 ${shift.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{shift.is_active ? 'toggle_on' : 'toggle_off'}</span>
                                            {shift.is_active ? 'Đang dùng' : 'Tắt'}
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 text-center"><TextInput disabled={!canManagePayroll} value={shift.notes} onChange={(value) => updateRow(setShifts, shift, { notes: value })} className="text-center" /></td>
                                </tr>
                            ))}
                        </DataTable>
                    </div>
                </section>
            </div>
        );
    }

    function renderSchedule() {
        return (
            <div className="grid gap-4">
                <DetailShell title={`Đăng ký lịch làm tháng ${month}`} action={(
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex h-9 overflow-hidden rounded border border-gray-200 bg-white">
                            <button
                                type="button"
                                onClick={() => setScheduleWeekFilter('all')}
                                className={`px-3 text-[12px] font-bold ${scheduleWeekFilter === 'all' ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                                Tất cả
                            </button>
                            {SCHEDULE_WEEK_FILTERS.map((weekNumber) => {
                                const available = scheduleWeekNumbers.has(weekNumber);
                                const active = scheduleWeekFilter === weekNumber;
                                return (
                                    <button
                                        key={weekNumber}
                                        type="button"
                                        disabled={!available}
                                        onClick={() => setScheduleWeekFilter(weekNumber)}
                                        className={`border-l border-gray-200 px-3 text-[12px] font-bold disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 ${active ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        Tuần {weekNumber}
                                    </button>
                                );
                            })}
                        </div>
                        <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="h-9 rounded border border-gray-200 bg-white px-3 text-center text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                        <span className="rounded border border-gray-200 bg-white px-3 py-2 text-[12px] font-bold text-gray-600">
                            {shortDate(firstDayOfMonth(month))} - {shortDate(lastDayOfMonth(month))}
                        </span>
                        <button type="button" onClick={() => setShowShiftModal(true)} className="inline-flex h-9 items-center gap-2 rounded border border-teal-200 bg-white px-3 text-[13px] font-bold text-teal-700 hover:bg-teal-50">
                            <span className="material-symbols-outlined text-[18px]">view_module</span>
                            Ca làm
                        </button>
                        <SaveButton saving={savingKey === 'schedules'} disabled={!canSaveSchedules} onClick={() => saveRows('schedules', () => payrollApi.saveSchedules(schedulePayload(schedulesForSave())), 'Đã lưu lịch làm.')} />
                        <button type="button" disabled={!canEditAttendance} onClick={createAttendanceFromSchedule} className="inline-flex h-9 items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 text-[13px] font-bold text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            Tạo chấm công
                        </button>
                    </div>
                )}>
                    <div className="grid gap-3 bg-gray-50 p-3">
                        {activeScheduleEmployees.length === 0 ? (
                            <div className="rounded border border-gray-200 bg-white px-4 py-10 text-center text-[13px] font-semibold text-gray-400">Chưa có nhân viên.</div>
                        ) : scheduleVisibleWeeks.length === 0 ? (
                            <div className="rounded border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-[13px] font-semibold text-gray-400">
                                {scheduleWeekFilter === 'all' ? 'Chưa có tuần trong tháng này.' : `Tháng này không có tuần ${scheduleWeekFilter}.`}
                            </div>
                        ) : scheduleVisibleWeeks.map((week) => {
                            const weekDaysInMonth = week.days;
                            const weekGridStyle = {
                                gridTemplateColumns: `132px repeat(${weekDaysInMonth.length}, minmax(112px, 1fr))`,
                                minWidth: `${Math.max(420, 132 + (weekDaysInMonth.length * 132))}px`,
                            };

                            return (
                                <section key={weekDaysInMonth[0]} className="overflow-x-auto rounded border border-gray-200 bg-white">
                                    <div className="grid border-b border-gray-200 bg-white" style={weekGridStyle}>
                                        <div className="flex min-h-11 flex-col items-center justify-center border-r border-gray-200 bg-white px-2 py-1 text-center text-[12px] font-bold text-gray-700">
                                            Tuần {week.weekNumber}
                                            <span className="text-[10px] font-semibold text-gray-500">{shortDate(weekDaysInMonth[0])} - {shortDate(weekDaysInMonth[weekDaysInMonth.length - 1])}</span>
                                        </div>
                                        {weekDaysInMonth.map((date) => {
                                            const tone = dayColumnTone(date, month);
                                            return (
                                                <div key={date} className={`flex min-h-11 flex-col items-center justify-center border-r px-2 py-1 text-center text-[12px] font-bold last:border-r-0 ${tone.header}`}>
                                                    {weekday(date)}
                                                    <span className="text-[10px] font-semibold opacity-80">{shortDate(date)}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {activeScheduleEmployees.map((employee) => (
                                        <div key={`${weekDaysInMonth[0]}-${employee.id || employee.uid}`} className="grid border-b border-gray-200 last:border-b-0 hover:bg-gray-50" style={weekGridStyle}>
                                            <div className="flex min-h-[78px] flex-col items-center justify-center border-r border-gray-200 bg-white px-2 py-2 text-center">
                                                <div className="text-[13px] font-bold text-gray-800">{employee.full_name || 'Chưa đặt tên'}</div>
                                                <div className="text-[11px] font-semibold text-gray-400">{isFullTime(employee) ? 'Full-time' : 'Part-time'}</div>
                                            </div>
                                            {weekDaysInMonth.map((date) => {
                                                const tone = dayColumnTone(date, month);
                                                return (
                                                    <div key={`${employee.id}-${date}`} className={`flex min-h-[78px] items-center justify-center border-r px-1.5 py-2 text-center last:border-r-0 ${tone.cell}`}>
                                                        {activeShifts.length === 0 ? (
                                                            <span className="text-[12px] font-semibold text-gray-400">Chưa có ca</span>
                                                        ) : (
                                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                                                {activeShifts.map((shift) => {
                                                                    const checked = isScheduleShiftChecked(employee, date, shift);
                                                                    return (
                                                                        <ScheduleShiftButton
                                                                            key={shift.id}
                                                                            shift={shift}
                                                                            checked={checked}
                                                                            defaulted={isFullTime(employee) && fullTimeDefaultShiftIds.has(String(shift.id))}
                                                                            disabled={!canEditScheduleForEmployee(employee) || !employee.id}
                                                                            onClick={() => toggleScheduleShift(employee, date, shift)}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </section>
                            );
                        })}
                    </div>
                </DetailShell>
                {renderShiftModal()}
            </div>
        );
    }

    function renderAttendance() {
        return (
            <DetailShell title={attendanceTitle} action={(
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-9 overflow-hidden rounded border border-gray-200 bg-white">
                        <button
                            type="button"
                            onClick={() => changeAttendanceFilterMode('month')}
                            className={`px-3 text-[12px] font-bold ${attendanceFilterMode === 'month' ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            {'Th\u00e1ng'}
                        </button>
                        <button
                            type="button"
                            onClick={() => changeAttendanceFilterMode('day')}
                            className={`border-l border-gray-200 px-3 text-[12px] font-bold ${attendanceFilterMode === 'day' ? 'bg-teal-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                            {'Ng\u00e0y'}
                        </button>
                    </div>
                    {attendanceFilterMode === 'month' ? (
                        <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="h-9 rounded border border-gray-200 bg-white px-3 text-center text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                    ) : (
                        <input type="date" value={attendanceDate} onChange={(event) => changeAttendanceDate(event.target.value)} className="h-9 rounded border border-gray-200 bg-white px-3 text-center text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                    )}
                    <span className="rounded border border-gray-200 bg-white px-3 py-2 text-[12px] font-bold text-gray-600">
                        {attendanceFilterLabel}
                    </span>
                    <SaveButton saving={savingKey === 'attendance'} disabled={!canEditAttendance} onClick={() => saveRows('attendance', () => payrollApi.saveAttendance(attendancePayload(attendanceWithScheduleDefaults)), 'Đã lưu chấm công.')} />
                </div>
            )}>
                <div className="grid border-b border-gray-200 bg-white sm:grid-cols-4">
                    <div className="border-b border-gray-100 px-4 py-3 sm:border-b-0 sm:border-r">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Ca theo lịch</div>
                        <div className="mt-1 text-[18px] font-bold text-gray-900">{attendanceFilterSchedules.length}</div>
                    </div>
                    <div className="border-b border-gray-100 px-4 py-3 sm:border-b-0 sm:border-r">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tổng giờ</div>
                        <div className="mt-1 text-[18px] font-bold text-teal-700">{formatDecimal(attendanceMonthHours)}h</div>
                    </div>
                    <div className="border-b border-gray-100 px-4 py-3 sm:border-b-0 sm:border-r">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tổng công</div>
                        <div className="mt-1 text-[18px] font-bold text-teal-700">{formatWorkUnit(attendanceMonthWorkUnits)}</div>
                    </div>
                    <div className="px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Ca thiếu giờ</div>
                        <div className="mt-1 text-[18px] font-bold text-amber-600">{partialAttendanceCount}</div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 text-[11px] font-bold text-gray-500">
                    <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm bg-teal-700" />Đủ ca</span>
                    <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm border border-amber-300 bg-amber-50" />Thiếu giờ, nhập giờ thực tế</span>
                    <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm border border-gray-200 bg-white" />Chưa chấm công</span>
                    <span className="inline-flex items-center gap-1"><span className="size-3 rounded-sm border border-dashed border-gray-300 bg-gray-50" />{'\u004b\u0068\u00f4\u006e\u0067 \u006c\u1ecb\u0063\u0068'}</span>
                </div>

                <div className="grid gap-3 bg-gray-50 p-3">
                    {activeEmployees.length === 0 ? (
                        <div className="rounded border border-gray-200 bg-white px-4 py-10 text-center text-[13px] font-semibold text-gray-400">Chưa có nhân viên.</div>
                    ) : attendanceDisplayWeeks.length === 0 ? (
                        <div className="rounded border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-[13px] font-semibold text-gray-400">
                            {'Ch\u01b0a t\u1edbi tu\u1ea7n ch\u1ea5m c\u00f4ng trong th\u00e1ng n\u00e0y.'}
                        </div>
                    ) : attendanceDisplayWeeks.map((week) => {
                        const weekDaysInMonth = week.days;
                        const weekGridStyle = {
                            gridTemplateColumns: `132px repeat(${weekDaysInMonth.length}, minmax(82px, 1fr))`,
                            minWidth: `${Math.max(360, 132 + (weekDaysInMonth.length * 112))}px`,
                        };
                        return (
                        <section key={weekDaysInMonth[0]} className="overflow-x-auto rounded border border-gray-200 bg-white">
                            <div className="grid border-b border-gray-200 bg-white" style={weekGridStyle}>
                                <div className="flex min-h-11 flex-col items-center justify-center border-r border-gray-200 bg-white px-2 py-1 text-center text-[12px] font-bold text-gray-700">
                                    Tuần {week.weekNumber}
                                    <span className="text-[10px] font-semibold text-gray-500">{shortDate(weekDaysInMonth[0])} - {shortDate(weekDaysInMonth[weekDaysInMonth.length - 1])}</span>
                                </div>
                                {weekDaysInMonth.map((date) => {
                                    const tone = dayColumnTone(date, month);
                                    return (
                                        <div key={date} className={`flex min-h-11 flex-col items-center justify-center border-r px-2 py-1 text-center text-[12px] font-bold last:border-r-0 ${tone.header}`}>
                                            {weekday(date)}
                                            <span className="text-[10px] font-semibold opacity-80">{isDateInMonth(date, month) ? shortDate(date) : ''}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            {activeEmployees.map((employee) => (
                                <div key={`${weekDaysInMonth[0]}-${employee.id || employee.uid}`} className="grid border-b border-gray-200 last:border-b-0 hover:bg-gray-50" style={weekGridStyle}>
                                    <div className="flex min-h-[72px] flex-col items-center justify-center border-r border-gray-200 bg-white px-2 py-2 text-center">
                                        <div className="text-[13px] font-bold text-gray-800">{employee.full_name || 'Chưa đặt tên'}</div>
                                        <div className="text-[11px] font-semibold text-gray-400">{isFullTime(employee) ? 'Full-time' : 'Part-time'}</div>
                                    </div>
                                    {weekDaysInMonth.map((date) => {
                                        const inMonth = isDateInMonth(date, month);
                                        const tone = dayColumnTone(date, month);
                                        const shiftsForDay = inMonth ? attendanceShiftsFor(employee, date) : [];
                                        return (
                                            <div key={`${employee.id}-${date}`} className={`flex min-h-[72px] items-center justify-center gap-2 border-r px-1.5 py-2 text-center last:border-r-0 ${tone.cell}`}>
                                                {!inMonth ? (
                                                    <span className="text-[11px] font-semibold text-gray-300">-</span>
                                                ) : shiftsForDay.length === 0 ? (
                                                    <span
                                                        title={'Ng\u00e0y n\u00e0y ch\u01b0a \u0111\u01b0\u1ee3c x\u1ebfp ca trong L\u1ecbch l\u00e0m.'}
                                                        className="inline-flex min-h-7 items-center rounded border border-dashed border-gray-300 bg-gray-50 px-2 text-[10px] font-bold text-gray-400"
                                                    >
                                                        {'\u004b\u0068\u00f4\u006e\u0067 \u006c\u1ecb\u0063\u0068'}
                                                    </span>
                                                ) : shiftsForDay.map((shift) => (
                                                    <AttendanceShiftControl
                                                        key={shift.id}
                                                        shift={shift}
                                                        record={findAttendanceRecord(employee.id, date, shift.id)}
                                                        disabled={!canEditAttendance || !employee.id}
                                                        onToggle={() => toggleAttendanceShift(employee, date, shift)}
                                                        onHoursChange={(value) => setAttendanceShiftHours(employee, date, shift, value)}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </section>
                        );
                    })}
                </div>
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
                <DataTable columns={['Nhân viên', 'Loại', 'Định mức lương', 'Tổng giờ', 'Tổng công', 'Tổng lương', 'Tạm ứng', 'Còn thanh toán']} minWidth={1120}>
                    {payrollSummary.length === 0 ? <EmptyRow colSpan={8} message="Chưa có dữ liệu lương." /> : payrollSummary.map((row) => (
                        <tr key={row.payroll_employee_id || row.employee_code} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-3 py-2">
                                <div className="font-bold text-gray-800">{row.full_name || '-'}</div>
                                <div className="text-[11px] font-semibold text-gray-400">{row.employee_code || '-'}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{employeeTypeLabel(row.salary_type)}</td>
                            <td className="min-w-[150px] px-3 py-2 text-center font-semibold text-gray-700">{row.salary_basis || '-'}</td>
                            <td className="px-3 py-2 text-center">{formatDecimal(row.total_hours)}</td>
                            <td className="px-3 py-2 text-center">{formatDecimal(row.total_work_units)}</td>
                            <td className="px-3 py-2 text-center font-bold text-teal-700">
                                <FormulaTooltipValue value={formatMoney(row.total_salary)} formula={row.salary_formula} />
                            </td>
                            <td className="px-3 py-2 text-center font-bold text-amber-700">{formatMoney(row.total_advance)}</td>
                            <td className="px-3 py-2 text-center font-bold text-emerald-700">{formatMoney(row.remaining_salary)}</td>
                        </tr>
                    ))}
                </DataTable>
            </DetailShell>
        );
    }

    function renderAdjustments() {
        return (
            <DetailShell title="Tạm ứng" action={(
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
                    <SaveButton saving={savingKey === 'adjustments'} disabled={!canEditAttendance || !canViewSalary} onClick={() => saveRows('adjustments', () => payrollApi.saveAdjustments(adjustmentPayload(adjustments)), 'Đã lưu tạm ứng.')} />
                </div>
            )}>
                <DataTable columns={['Ngày', 'Nhân viên', 'Số tiền', 'Ghi chú', 'Xoá']} minWidth={820}>
                    {adjustments.length === 0 ? <EmptyRow colSpan={5} message="Chưa có khoản tạm ứng." /> : adjustments.map((adjustment) => {
                        return (
                            <tr key={adjustment.id || adjustment.uid} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2"><TextInput type="date" disabled={!canEditAttendance || !canViewSalary} value={adjustment.adjustment_date} onChange={(value) => updateRow(setAdjustments, adjustment, { adjustment_date: value })} className="text-center" /></td>
                                <td className="px-3 py-2"><SelectInput disabled={!canEditAttendance || !canViewSalary} value={adjustment.payroll_employee_id} onChange={(value) => updateRow(setAdjustments, adjustment, { payroll_employee_id: value })} options={employeeOptions} placeholder="Nhân viên" className="text-center" /></td>
                                <td className="px-3 py-2">{canViewSalary ? <MoneyInput disabled={!canEditAttendance} value={adjustment.amount} inputClassName="text-center" onChange={(value) => updateRow(setAdjustments, adjustment, { amount: value })} /> : <span className="text-gray-400">Ẩn</span>}</td>
                                <td className="px-3 py-2"><TextInput disabled={!canEditAttendance || !canViewSalary} value={adjustment.notes} onChange={(value) => updateRow(setAdjustments, adjustment, { notes: value })} className="text-center" /></td>
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
        const today = isoDate(new Date());

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
                        <td className="px-3 py-3 text-center">{activeEmployees.length}</td>
                        <td className="px-3 py-3 text-center">{formatDecimal(totalHours)}</td>
                        <td className="px-3 py-3 text-center">{formatDecimal(totalWorkUnits)}</td>
                        <td className="px-3 py-3 text-center font-bold text-teal-700">{formatMoney(totalSalary)}</td>
                        <td className="px-3 py-3">{closedMonth === month ? <StatusBadge>Đã chốt</StatusBadge> : <StatusBadge tone="amber">Đang tính</StatusBadge>}</td>
                    </tr>
                </DataTable>
                <div className="border-t border-gray-200 bg-white">
                    <div className="grid border-b border-gray-200 sm:grid-cols-3">
                        <div className="border-b border-gray-100 px-4 py-3 sm:border-b-0 sm:border-r">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Ngày có lương</span>
                            <p className="mt-1 text-[18px] font-bold text-gray-900">{dailySalaryWorkDays}/{monthDays.length} ngày</p>
                        </div>
                        <div className="border-b border-gray-100 px-4 py-3 sm:border-b-0 sm:border-r">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Trung bình/ngày</span>
                            <p className="mt-1 text-[18px] font-bold text-emerald-700">{canViewSalary ? formatMoney(averageDailySalary) : 'Ẩn'}</p>
                        </div>
                        <div className="px-4 py-3">
                            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Ngày cao nhất</span>
                            <p className="mt-1 text-[18px] font-bold text-amber-700">{highestDailySalaryLabel}</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                        <h3 className="text-[15px] font-bold text-gray-900">Lương phải trả theo ngày</h3>
                        <button type="button" onClick={exportDailySalaryCsv} className="inline-flex h-9 items-center justify-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-bold text-emerald-700 hover:bg-emerald-100">
                            <span className="material-symbols-outlined text-[18px]">download</span>
                            Xuất theo ngày
                        </button>
                    </div>
                    <DataTable columns={['Ngày', 'Thứ', 'Nhân viên có công', 'Số ca', 'Tổng giờ', 'Tổng công', 'Lương phải trả']} minWidth={980}>
                        {dailySalarySummary.length === 0 ? <EmptyRow colSpan={7} message="Chưa có dữ liệu theo ngày." /> : dailySalarySummary.map((row) => {
                            const hasWork = row.shift_count > 0 || safeNumber(row.total_work_units) > 0;
                            const isToday = row.work_date === today;
                            return (
                                <tr key={row.work_date} className={`border-b border-gray-100 ${isToday ? 'bg-teal-50/70' : 'hover:bg-gray-50'} ${hasWork ? 'text-gray-700' : 'text-gray-400'}`}>
                                    <td className="px-3 py-3 font-bold text-gray-800">{shortDate(row.work_date)}</td>
                                    <td className="px-3 py-3 text-center font-semibold">{weekday(row.work_date)}</td>
                                    <td className="px-3 py-3 text-center">{row.employee_count}</td>
                                    <td className="px-3 py-3 text-center">{row.shift_count}</td>
                                    <td className="px-3 py-3 text-center">{formatDecimal(row.total_hours)}</td>
                                    <td className="px-3 py-3 text-center">{formatDecimal(row.total_work_units)}</td>
                                    <td className={`px-3 py-3 text-center font-bold ${hasWork && canViewSalary ? 'text-teal-700' : 'text-gray-400'}`}>{canViewSalary ? formatMoney(row.total_salary) : 'Ẩn'}</td>
                                </tr>
                            );
                        })}
                    </DataTable>
                </div>
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
                                <div className="grid w-full gap-3 rounded border border-gray-200 bg-white p-3 text-center shadow-sm sm:grid-cols-3 xl:w-[560px]">
                                    <label className="grid gap-1 text-center">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tháng</span>
                                        <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} className="h-9 rounded border border-gray-200 bg-white px-2.5 text-center text-[13px] font-semibold text-gray-700 outline-none focus:border-teal-500" />
                                    </label>
                                    <div className="text-center">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">Tổng công</span>
                                        <p className="mt-2 text-[16px] font-bold text-gray-900">{formatDecimal(totalWorkUnits)}</p>
                                    </div>
                                    <div className="text-center">
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
            standard_work_units: currentEmployee.standard_work_units || DEFAULT_STANDARD_WORK_UNITS,
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
                <table className="w-full min-w-[840px] border-collapse text-center text-[12px]">
                    <thead>
                        <tr className="bg-white">
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Áp dụng từ</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Loại</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Mức lương</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Công chuẩn</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Ghi chú</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-center font-bold text-gray-500">Xoá</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-3 py-5 text-center font-semibold text-gray-400">Chưa có lịch sử lương.</td>
                            </tr>
                        ) : rows.map((rate, index) => (
                            <tr key={salaryRateKey(rate, index)} className="border-b border-gray-100 last:border-b-0">
                                <td className="px-3 py-2">
                                    <TextInput type="date" disabled={!canEdit} value={dateValue(rate.effective_from)} onChange={(value) => updateRate(rate, index, { effective_from: value })} />
                                </td>
                                <td className="px-3 py-2">
                                    <SelectInput disabled={!canEdit} value={rate.salary_type} onChange={(value) => updateRate(rate, index, { salary_type: value, ...(value === 'theo_thang' && !rate.standard_work_units ? { standard_work_units: DEFAULT_STANDARD_WORK_UNITS } : {}) })} options={EMPLOYEE_TYPES} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyInput disabled={!canEdit} value={rate.salary_amount} suffix={salaryUnitLabel(rate.salary_type)} onChange={(value) => updateRate(rate, index, { salary_amount: value })} />
                                </td>
                                <td className="px-3 py-2">
                                    {rate.salary_type === 'theo_thang' ? (
                                        <DecimalInput disabled={!canEdit} value={rate.standard_work_units || DEFAULT_STANDARD_WORK_UNITS} suffix="ngày / tháng" onChange={(value) => updateRate(rate, index, { standard_work_units: value })} />
                                    ) : <span className="block h-9" />}
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
