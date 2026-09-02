<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollAdjustment;
use App\Models\PayrollAttendanceRecord;
use App\Models\PayrollEmployee;
use App\Models\PayrollSalaryRate;
use App\Models\PayrollScheduleRegistration;
use App\Models\PayrollUserScope;
use App\Models\PayrollWorkShift;
use App\Models\User;
use App\Services\AccessControlService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PayrollController extends Controller
{
    public function overview(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $month = $this->normalizeMonth($request->query('month'));
        [$startDate, $endDate] = $this->monthRange($month);
        $department = trim((string) $request->query('department', ''));
        $user = $request->user();
        $scope = $this->resolvePayrollScope($accountId, $user);

        $this->ensureDefaultShifts($accountId);

        $employeeQuery = PayrollEmployee::query()
            ->with([
                'user:id,name,email',
                'salaryRates' => fn ($query) => $query->orderByDesc('effective_from')->orderByDesc('id'),
            ])
            ->orderBy('department')
            ->orderBy('employee_code');

        $this->applyEmployeeScope($employeeQuery, $scope);

        if ($department !== '') {
            $employeeQuery->where('department', $department);
        }

        $employees = $employeeQuery->get();
        $employeeIds = $employees->pluck('id');
        $employeesById = $employees->keyBy('id');

        $scheduleEmployeeQuery = PayrollEmployee::query()
            ->orderBy('department')
            ->orderBy('employee_code');

        if (!($scope['can_view_all_schedule'] ?? false)) {
            $this->applyEmployeeScope($scheduleEmployeeQuery, $scope);
        }

        if ($department !== '') {
            $scheduleEmployeeQuery->where('department', $department);
        }

        $scheduleEmployees = $scheduleEmployeeQuery->get();
        $scheduleEmployeeIds = $scheduleEmployees->pluck('id');

        $shifts = PayrollWorkShift::query()
            ->orderBy('sort_order')
            ->orderBy('start_time')
            ->get();
        $shiftsById = $shifts->keyBy('id');

        $schedules = PayrollScheduleRegistration::query()
            ->with(['employee:id,employee_code,full_name,department', 'shift:id,shift_code,shift_name,start_time,end_time,standard_hours,default_work_units,wage_multiplier'])
            ->whereBetween('work_date', [$startDate, $endDate])
            ->whereIn('payroll_employee_id', $scheduleEmployeeIds)
            ->orderBy('work_date')
            ->orderBy('payroll_employee_id')
            ->get();

        $attendanceRecords = PayrollAttendanceRecord::query()
            ->with(['employee.salaryRates' => fn ($query) => $query->orderByDesc('effective_from')->orderByDesc('id'), 'employee:id,employee_code,full_name,department,salary_type,salary_amount,salary_effective_from,standard_work_units', 'shift:id,shift_code,shift_name,start_time,end_time,standard_hours,default_work_units,wage_multiplier'])
            ->whereBetween('work_date', [$startDate, $endDate])
            ->whereIn('payroll_employee_id', $employeeIds)
            ->orderBy('work_date')
            ->orderBy('payroll_employee_id')
            ->get();

        $adjustments = PayrollAdjustment::query()
            ->with(['employee:id,employee_code,full_name,department'])
            ->whereBetween('adjustment_date', [$startDate, $endDate])
            ->whereIn('payroll_employee_id', $employeeIds)
            ->orderBy('adjustment_date')
            ->orderBy('payroll_employee_id')
            ->get();

        $departmentQuery = PayrollEmployee::query()
            ->whereNotNull('department')
            ->where('department', '<>', '');
        $this->applyEmployeeScope($departmentQuery, $scope);
        $departments = $departmentQuery
            ->distinct()
            ->orderBy('department')
            ->pluck('department')
            ->values();

        $canManagePayroll = (bool) $scope['can_manage_payroll'];
        $canViewSalary = (bool) $scope['can_view_salary'];

        $users = $canManagePayroll
            ? $this->usersForAccount($accountId)
            : collect([$user])->filter()->map(fn (User $item) => $item->only(['id', 'name', 'email']))->values();

        $userScopes = $canManagePayroll
            ? PayrollUserScope::query()
                ->with(['user:id,name,email', 'employee:id,employee_code,full_name,department'])
                ->where('account_id', $accountId)
                ->orderBy('role_name')
                ->orderBy('department')
                ->get()
            : PayrollUserScope::query()
                ->with(['user:id,name,email', 'employee:id,employee_code,full_name,department'])
                ->where('account_id', $accountId)
                ->where('user_id', $user?->id)
                ->get();

        return response()->json([
            'status' => 'success',
            'data' => [
                'month' => $month,
                'scope' => $scope,
                'departments' => $departments,
                'users' => $users,
                'employees' => $this->serializeEmployees($employees, $canViewSalary),
                'schedule_employees' => $this->serializeScheduleEmployees($scheduleEmployees),
                'shifts' => $shifts,
                'schedules' => $schedules,
                'attendance_records' => $this->serializeAttendanceRecords($attendanceRecords, $employeesById, $shiftsById, $canViewSalary),
                'adjustments' => $this->serializeAdjustments($adjustments, $canViewSalary),
                'payroll_summary' => $this->buildPayrollSummary($attendanceRecords, $employeesById, $shiftsById, $canViewSalary, $adjustments),
                'user_scopes' => $userScopes,
            ],
        ]);
    }

    public function syncEmployees(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $this->ensureCanManagePayroll($accountId, $request->user());
        $rows = $request->validate([
            'employees' => 'required|array',
            'employees.*.id' => 'nullable|integer',
            'employees.*.user_id' => 'nullable|integer|exists:users,id',
            'employees.*.employee_code' => 'nullable|string|max:50',
            'employees.*.full_name' => 'nullable|string|max:255',
            'employees.*.phone' => 'nullable|string|max:50',
            'employees.*.address' => 'nullable|string|max:1000',
            'employees.*.identity_card_image_url' => 'nullable|string|max:1000',
            'employees.*.identity_card_front_image_url' => 'nullable|string|max:1000',
            'employees.*.identity_card_back_image_url' => 'nullable|string|max:1000',
            'employees.*.department' => 'nullable|string|max:255',
            'employees.*.position' => 'nullable|string|max:255',
            'employees.*.salary_type' => 'nullable|string|max:30',
            'employees.*.salary_amount' => 'nullable|numeric',
            'employees.*.salary_effective_from' => 'nullable|date',
            'employees.*.salary_rates' => 'nullable|array',
            'employees.*.salary_rates.*.id' => 'nullable|integer',
            'employees.*.salary_rates.*.salary_type' => 'nullable|string|max:30',
            'employees.*.salary_rates.*.salary_amount' => 'nullable|numeric',
            'employees.*.salary_rates.*.standard_work_units' => 'nullable|numeric',
            'employees.*.salary_rates.*.effective_from' => 'nullable|date',
            'employees.*.salary_rates.*.notes' => 'nullable|string|max:255',
            'employees.*.deleted_salary_rate_ids' => 'nullable|array',
            'employees.*.deleted_salary_rate_ids.*' => 'integer',
            'employees.*.standard_work_units' => 'nullable|numeric',
            'employees.*.lunch_allowance' => 'nullable|numeric',
            'employees.*.bonus_policy' => 'nullable|string|max:255',
            'employees.*.pay_schedule' => 'nullable|string|max:255',
            'employees.*.raise_plan' => 'nullable|string|max:255',
            'employees.*.bank_account_note' => 'nullable|string|max:255',
            'employees.*.bank_qr_image_url' => 'nullable|string|max:1000',
            'employees.*.status' => 'nullable|string|max:30',
            'employees.*.notes' => 'nullable|string',
        ])['employees'];

        DB::transaction(function () use ($rows, $accountId, $request) {
            foreach ($rows as $row) {
                $employeeCode = trim((string) ($row['employee_code'] ?? ''));
                $fullName = trim((string) ($row['full_name'] ?? ''));

                $hasProfileData = collect([
                    $row['phone'] ?? null,
                    $row['address'] ?? null,
                    $row['identity_card_image_url'] ?? null,
                    $row['identity_card_front_image_url'] ?? null,
                    $row['identity_card_back_image_url'] ?? null,
                    $row['user_id'] ?? null,
                    $row['salary_amount'] ?? null,
                    $row['salary_effective_from'] ?? null,
                    $row['bank_account_note'] ?? null,
                    $row['bank_qr_image_url'] ?? null,
                    $row['notes'] ?? null,
                ])->contains(fn ($value) => trim((string) ($value ?? '')) !== '');

                if ($fullName === '' && !$hasProfileData) {
                    continue;
                }

                if ($fullName === '') {
                    throw ValidationException::withMessages([
                        'employees' => 'Mỗi dòng nhân sự cần có Tên nhân viên.',
                    ]);
                }

                $employee = !empty($row['id'])
                    ? PayrollEmployee::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : null;

                if ($employee && $employeeCode === '') {
                    $employeeCode = $employee->employee_code;
                }

                if ($employeeCode === '') {
                    $employeeCode = $this->nextEmployeeCode($accountId);
                }

                $salaryEffectiveFrom = !empty($row['salary_effective_from'])
                    ? Carbon::parse($row['salary_effective_from'])->toDateString()
                    : ($employee?->salary_effective_from?->toDateString() ?: now()->toDateString());

                $payload = [
                    'account_id' => $accountId,
                    'user_id' => $row['user_id'] ?? null,
                    'employee_code' => $employeeCode,
                    'full_name' => $fullName,
                    'phone' => $this->nullableTrim($row['phone'] ?? null),
                    'address' => $this->nullableTrim($row['address'] ?? null),
                    'identity_card_image_url' => $this->nullableTrim($row['identity_card_image_url'] ?? null),
                    'identity_card_front_image_url' => $this->nullableTrim($row['identity_card_front_image_url'] ?? null),
                    'identity_card_back_image_url' => $this->nullableTrim($row['identity_card_back_image_url'] ?? null),
                    'department' => $this->nullableTrim($row['department'] ?? null),
                    'position' => $this->nullableTrim($row['position'] ?? null),
                    'salary_type' => $row['salary_type'] ?? 'theo_ca',
                    'salary_amount' => $this->number($row['salary_amount'] ?? 0),
                    'salary_effective_from' => $salaryEffectiveFrom,
                    'standard_work_units' => $this->nullableNumber($row['standard_work_units'] ?? null),
                    'lunch_allowance' => $this->number($row['lunch_allowance'] ?? 0),
                    'bonus_policy' => $this->nullableTrim($row['bonus_policy'] ?? null),
                    'pay_schedule' => $this->nullableTrim($row['pay_schedule'] ?? null),
                    'raise_plan' => $this->nullableTrim($row['raise_plan'] ?? null),
                    'bank_account_note' => $this->nullableTrim($row['bank_account_note'] ?? null),
                    'bank_qr_image_url' => $this->nullableTrim($row['bank_qr_image_url'] ?? null),
                    'status' => $row['status'] ?? 'Đang làm',
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                ];

                if (!$employee) {
                    $employee = PayrollEmployee::query()
                        ->where('account_id', $accountId)
                        ->where('employee_code', $employeeCode)
                        ->first();
                }

                if ($employee) {
                    $employee->update($payload);
                } else {
                    $employee = PayrollEmployee::create($payload);
                }

                if ($employee) {
                    $this->syncSalaryRates(
                        $accountId,
                        $employee,
                        $payload,
                        $row['salary_rates'] ?? [],
                        $row['deleted_salary_rate_ids'] ?? [],
                        $request->user()?->id
                    );
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu danh sách nhân viên.']);
    }

    public function syncShifts(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $this->ensureCanManagePayroll($accountId, $request->user());
        $rows = $request->validate([
            'shifts' => 'required|array',
            'shifts.*.id' => 'nullable|integer',
            'shifts.*.shift_code' => 'nullable|string|max:30',
            'shifts.*.shift_name' => 'nullable|string|max:255',
            'shifts.*.start_time' => 'nullable',
            'shifts.*.end_time' => 'nullable',
            'shifts.*.standard_hours' => 'nullable|numeric',
            'shifts.*.default_work_units' => 'nullable|numeric',
            'shifts.*.wage_multiplier' => 'nullable|numeric',
            'shifts.*.is_active' => 'nullable|boolean',
            'shifts.*.sort_order' => 'nullable|integer',
            'shifts.*.notes' => 'nullable|string',
        ])['shifts'];

        DB::transaction(function () use ($rows, $accountId) {
            foreach ($rows as $row) {
                $shiftCode = trim((string) ($row['shift_code'] ?? ''));
                $shiftName = trim((string) ($row['shift_name'] ?? ''));

                if ($shiftCode === '' && $shiftName === '') {
                    continue;
                }

                if ($shiftCode === '' || $shiftName === '') {
                    throw ValidationException::withMessages([
                        'shifts' => 'Mỗi dòng ca làm cần có đủ Mã ca và Tên ca.',
                    ]);
                }

                $payload = [
                    'account_id' => $accountId,
                    'shift_code' => $shiftCode,
                    'shift_name' => $shiftName,
                    'start_time' => $this->nullableTrim($row['start_time'] ?? null),
                    'end_time' => $this->nullableTrim($row['end_time'] ?? null),
                    'standard_hours' => $this->number($row['standard_hours'] ?? 4),
                    'default_work_units' => $this->number($row['default_work_units'] ?? 1),
                    'wage_multiplier' => $this->number($row['wage_multiplier'] ?? 1),
                    'is_active' => (bool) ($row['is_active'] ?? true),
                    'sort_order' => (int) ($row['sort_order'] ?? 0),
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                ];

                $shift = !empty($row['id'])
                    ? PayrollWorkShift::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : PayrollWorkShift::query()->where('account_id', $accountId)->where('shift_code', $shiftCode)->first();

                if ($shift) {
                    $shift->update($payload);
                } else {
                    PayrollWorkShift::create($payload);
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu bảng ca làm.']);
    }

    public function syncSchedules(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $scope = $this->resolvePayrollScope($accountId, $request->user());
        $canEditAllSchedules = (bool) ($scope['can_edit_attendance'] || $scope['can_manage_payroll']);
        $selfEmployeeId = ($scope['self_employee_id'] ?? $scope['employee_id'])
            ? (int) ($scope['self_employee_id'] ?? $scope['employee_id'])
            : null;
        $canEditOwnSchedule = !$canEditAllSchedules
            && (bool) ($scope['can_edit_own_schedule'] ?? false)
            && $selfEmployeeId;

        abort_unless($canEditAllSchedules || $canEditOwnSchedule, 403, 'Bạn chưa có quyền sửa lịch làm.');

        $rows = $request->validate([
            'schedules' => 'required|array',
            'schedules.*.id' => 'nullable|integer',
            'schedules.*.work_date' => 'nullable|date',
            'schedules.*.payroll_employee_id' => 'nullable|integer|exists:payroll_employees,id',
            'schedules.*.payroll_work_shift_id' => 'nullable|integer|exists:payroll_work_shifts,id',
            'schedules.*.registered_work_units' => 'nullable|numeric',
            'schedules.*.status' => 'nullable|string|max:40',
            'schedules.*.notes' => 'nullable|string',
        ])['schedules'];

        DB::transaction(function () use ($rows, $accountId, $request, $canEditAllSchedules, $selfEmployeeId) {
            foreach ($rows as $row) {
                if (empty($row['work_date']) && empty($row['payroll_employee_id']) && empty($row['payroll_work_shift_id'])) {
                    continue;
                }

                if (empty($row['work_date']) || empty($row['payroll_employee_id']) || empty($row['payroll_work_shift_id'])) {
                    throw ValidationException::withMessages([
                        'schedules' => 'Mỗi dòng đăng ký lịch cần có đủ Ngày, Nhân viên và Ca làm.',
                    ]);
                }

                if (!$canEditAllSchedules && (int) $row['payroll_employee_id'] !== $selfEmployeeId) {
                    abort(403, 'Bạn chỉ có thể đăng ký lịch của chính mình.');
                }

                $this->assertEmployeeBelongsToAccount($accountId, $row['payroll_employee_id']);
                $this->assertShiftBelongsToAccount($accountId, $row['payroll_work_shift_id']);

                $payload = [
                    'account_id' => $accountId,
                    'work_date' => $row['work_date'],
                    'payroll_employee_id' => $row['payroll_employee_id'],
                    'payroll_work_shift_id' => $row['payroll_work_shift_id'],
                    'registered_work_units' => $this->number($row['registered_work_units'] ?? 1),
                    'status' => $row['status'] ?? 'Đã đăng ký',
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                    'created_by' => $request->user()?->id,
                ];

                $schedule = !empty($row['id'])
                    ? PayrollScheduleRegistration::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : PayrollScheduleRegistration::query()
                        ->where('account_id', $accountId)
                        ->where('work_date', $row['work_date'])
                        ->where('payroll_employee_id', $row['payroll_employee_id'])
                        ->where('payroll_work_shift_id', $row['payroll_work_shift_id'])
                        ->first();

                if (!$canEditAllSchedules && $schedule && (int) $schedule->payroll_employee_id !== $selfEmployeeId) {
                    abort(403, 'Bạn chỉ có thể đăng ký lịch của chính mình.');
                }

                if ($schedule) {
                    $schedule->update($payload);
                } else {
                    PayrollScheduleRegistration::create($payload);
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu bảng đăng ký lịch làm.']);
    }

    public function syncAttendance(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $this->ensureCanEditAttendance($accountId, $request->user());
        $rows = $request->validate([
            'attendance_records' => 'required|array',
            'attendance_records.*.id' => 'nullable|integer',
            'attendance_records.*.payroll_schedule_registration_id' => 'nullable|integer|exists:payroll_schedule_registrations,id',
            'attendance_records.*.work_date' => 'nullable|date',
            'attendance_records.*.payroll_employee_id' => 'nullable|integer|exists:payroll_employees,id',
            'attendance_records.*.payroll_work_shift_id' => 'nullable|integer|exists:payroll_work_shifts,id',
            'attendance_records.*.attendance_status' => 'nullable|string|max:40',
            'attendance_records.*.work_units' => 'nullable|numeric',
            'attendance_records.*.unit_rate' => 'nullable|numeric',
            'attendance_records.*.bonus_amount' => 'nullable|numeric',
            'attendance_records.*.penalty_amount' => 'nullable|numeric',
            'attendance_records.*.notes' => 'nullable|string',
        ])['attendance_records'];

        DB::transaction(function () use ($rows, $accountId, $request) {
            foreach ($rows as $row) {
                if (empty($row['work_date']) && empty($row['payroll_employee_id']) && empty($row['payroll_work_shift_id'])) {
                    continue;
                }

                if (empty($row['work_date']) || empty($row['payroll_employee_id']) || empty($row['payroll_work_shift_id'])) {
                    throw ValidationException::withMessages([
                        'attendance_records' => 'Mỗi dòng chấm công cần có đủ Ngày, Nhân viên và Ca làm.',
                    ]);
                }

                $this->assertEmployeeBelongsToAccount($accountId, $row['payroll_employee_id']);
                $this->assertShiftBelongsToAccount($accountId, $row['payroll_work_shift_id']);

                $scheduleId = $row['payroll_schedule_registration_id'] ?? null;
                if (!$scheduleId) {
                    $scheduleId = PayrollScheduleRegistration::query()
                        ->where('account_id', $accountId)
                        ->where('work_date', $row['work_date'])
                        ->where('payroll_employee_id', $row['payroll_employee_id'])
                        ->where('payroll_work_shift_id', $row['payroll_work_shift_id'])
                        ->value('id');
                }

                $payload = [
                    'account_id' => $accountId,
                    'payroll_schedule_registration_id' => $scheduleId,
                    'work_date' => $row['work_date'],
                    'payroll_employee_id' => $row['payroll_employee_id'],
                    'payroll_work_shift_id' => $row['payroll_work_shift_id'],
                    'attendance_status' => $row['attendance_status'] ?? 'Đi làm',
                    'work_units' => $this->number($row['work_units'] ?? 1),
                    'unit_rate' => $this->nullableNumber($row['unit_rate'] ?? null),
                    'bonus_amount' => $this->number($row['bonus_amount'] ?? 0),
                    'penalty_amount' => $this->number($row['penalty_amount'] ?? 0),
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                    'approved_by' => $request->user()?->id,
                ];

                $record = !empty($row['id'])
                    ? PayrollAttendanceRecord::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : PayrollAttendanceRecord::query()
                        ->where('account_id', $accountId)
                        ->where('work_date', $row['work_date'])
                        ->where('payroll_employee_id', $row['payroll_employee_id'])
                        ->where('payroll_work_shift_id', $row['payroll_work_shift_id'])
                        ->first();

                if ($record) {
                    $record->update($payload);
                } else {
                    PayrollAttendanceRecord::create($payload);
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu bảng chấm công.']);
    }

    public function syncAdjustments(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $scope = $this->resolvePayrollScope($accountId, $request->user());
        abort_unless(($scope['can_edit_attendance'] || $scope['can_manage_payroll']) && $scope['can_view_salary'], 403, 'Bạn chưa có quyền sửa khoản tạm ứng.');

        $rows = $request->validate([
            'adjustments' => 'required|array',
            'adjustments.*.id' => 'nullable|integer',
            'adjustments.*.adjustment_date' => 'nullable|date',
            'adjustments.*.payroll_employee_id' => 'nullable|integer|exists:payroll_employees,id',
            'adjustments.*.adjustment_type' => 'nullable|string|max:30',
            'adjustments.*.amount' => 'nullable|numeric',
            'adjustments.*.notes' => 'nullable|string',
        ])['adjustments'];

        DB::transaction(function () use ($rows, $accountId, $request) {
            foreach ($rows as $row) {
                if (empty($row['adjustment_date']) && empty($row['payroll_employee_id']) && empty($row['amount'])) {
                    continue;
                }

                if (empty($row['adjustment_date']) || empty($row['payroll_employee_id']) || empty($row['amount'])) {
                    throw ValidationException::withMessages([
                        'adjustments' => 'Mỗi dòng tạm ứng cần có đủ Ngày, Nhân viên và Số tiền.',
                    ]);
                }

                $this->assertEmployeeBelongsToAccount($accountId, $row['payroll_employee_id']);

                $payload = [
                    'account_id' => $accountId,
                    'adjustment_date' => $row['adjustment_date'],
                    'payroll_employee_id' => $row['payroll_employee_id'],
                    'adjustment_type' => $row['adjustment_type'] ?? 'advance',
                    'amount' => abs($this->number($row['amount'] ?? 0)),
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                    'created_by' => $request->user()?->id,
                ];

                $adjustment = !empty($row['id'])
                    ? PayrollAdjustment::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : null;

                if ($adjustment) {
                    $adjustment->update($payload);
                } else {
                    PayrollAdjustment::create($payload);
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu bảng tạm ứng.']);
    }

    public function deleteAdjustment(Request $request, int $id)
    {
        $accountId = $this->activeAccountId($request);
        $scope = $this->resolvePayrollScope($accountId, $request->user());
        abort_unless(($scope['can_edit_attendance'] || $scope['can_manage_payroll']) && $scope['can_view_salary'], 403, 'Bạn chưa có quyền xoá khoản tạm ứng.');

        PayrollAdjustment::query()
            ->where('account_id', $accountId)
            ->findOrFail($id)
            ->delete();

        return response()->json(['status' => 'success', 'message' => 'Đã xoá khoản tạm ứng.']);
    }

    public function syncUserScopes(Request $request)
    {
        $accountId = $this->activeAccountId($request);
        $this->ensureCanManagePayroll($accountId, $request->user());
        $rows = $request->validate([
            'user_scopes' => 'required|array',
            'user_scopes.*.id' => 'nullable|integer',
            'user_scopes.*.user_id' => 'nullable|integer|exists:users,id',
            'user_scopes.*.payroll_employee_id' => 'nullable|integer|exists:payroll_employees,id',
            'user_scopes.*.role_name' => 'nullable|string|max:40',
            'user_scopes.*.scope_type' => 'nullable|string|max:40',
            'user_scopes.*.department' => 'nullable|string|max:255',
            'user_scopes.*.can_view_salary' => 'nullable|boolean',
            'user_scopes.*.can_edit_attendance' => 'nullable|boolean',
            'user_scopes.*.can_manage_payroll' => 'nullable|boolean',
            'user_scopes.*.notes' => 'nullable|string',
        ])['user_scopes'];

        DB::transaction(function () use ($rows, $accountId) {
            foreach ($rows as $row) {
                if (empty($row['user_id'])) {
                    continue;
                }

                if (!empty($row['payroll_employee_id'])) {
                    $this->assertEmployeeBelongsToAccount($accountId, $row['payroll_employee_id']);
                }

                $payload = [
                    'account_id' => $accountId,
                    'user_id' => $row['user_id'],
                    'payroll_employee_id' => $row['payroll_employee_id'] ?? null,
                    'role_name' => $row['role_name'] ?? 'Nhân viên',
                    'scope_type' => $row['scope_type'] ?? 'Chỉ bản thân',
                    'department' => $this->nullableTrim($row['department'] ?? null),
                    'can_view_salary' => (bool) ($row['can_view_salary'] ?? false),
                    'can_edit_attendance' => (bool) ($row['can_edit_attendance'] ?? false),
                    'can_manage_payroll' => (bool) ($row['can_manage_payroll'] ?? false),
                    'notes' => $this->nullableTrim($row['notes'] ?? null),
                ];

                $scope = !empty($row['id'])
                    ? PayrollUserScope::query()->where('account_id', $accountId)->findOrFail($row['id'])
                    : PayrollUserScope::query()->where('account_id', $accountId)->where('user_id', $row['user_id'])->first();

                if ($scope) {
                    $scope->update($payload);
                } else {
                    PayrollUserScope::create($payload);
                }
            }
        });

        return response()->json(['status' => 'success', 'message' => 'Đã lưu bảng phân quyền công lương.']);
    }

    private function activeAccountId(Request $request): int
    {
        $accountId = $request->header('X-Account-Id');

        if (!$accountId || $accountId === 'all') {
            $accountId = $request->user()?->accounts()->first()?->id;
        }

        abort_unless($accountId, 400, 'Vui lòng chọn cửa hàng trước khi quản lý công lương.');

        return (int) $accountId;
    }

    private function normalizeMonth(?string $month): string
    {
        if (is_string($month) && preg_match('/^\d{4}-\d{2}$/', $month)) {
            return $month;
        }

        return now()->format('Y-m');
    }

    private function monthRange(string $month): array
    {
        $start = Carbon::createFromFormat('Y-m-d', "{$month}-01")->startOfMonth();

        return [$start->toDateString(), $start->copy()->endOfMonth()->toDateString()];
    }

    private function usersForAccount(int $accountId)
    {
        return User::query()
            ->whereHas('accounts', fn (Builder $query) => $query->where('accounts.id', $accountId))
            ->orWhere('is_admin', true)
            ->orderBy('name')
            ->get(['id', 'name', 'email']);
    }

    private function ensureDefaultShifts(int $accountId): void
    {
        if (PayrollWorkShift::query()->where('account_id', $accountId)->exists()) {
            return;
        }

        $defaults = [
            ['shift_code' => 'S', 'shift_name' => 'Ca sáng', 'start_time' => '08:00:00', 'end_time' => '12:00:00', 'sort_order' => 10],
            ['shift_code' => 'C', 'shift_name' => 'Ca chiều', 'start_time' => '13:30:00', 'end_time' => '17:30:00', 'sort_order' => 20],
            ['shift_code' => 'T', 'shift_name' => 'Ca tối', 'start_time' => '18:30:00', 'end_time' => '22:30:00', 'sort_order' => 30],
        ];

        foreach ($defaults as $row) {
            PayrollWorkShift::create(array_merge($row, [
                'account_id' => $accountId,
                'standard_hours' => 4,
                'default_work_units' => 1,
                'wage_multiplier' => 1,
                'is_active' => true,
            ]));
        }
    }

    private function resolvePayrollScope(int $accountId, ?User $user): array
    {
        if (!$user) {
            return [
                'scope_type' => 'Không có quyền',
                'employee_id' => null,
                'self_employee_id' => null,
                'department' => null,
                'can_view_salary' => false,
                'can_edit_attendance' => false,
                'can_manage_payroll' => false,
                'can_view_all_schedule' => false,
                'can_edit_own_schedule' => false,
            ];
        }

        $linkedEmployee = PayrollEmployee::query()
            ->where('account_id', $accountId)
            ->where('user_id', $user->id)
            ->first(['id', 'department']);

        if ($user->is_admin) {
            return [
                'scope_type' => 'Tất cả',
                'employee_id' => null,
                'self_employee_id' => $linkedEmployee?->id,
                'department' => null,
                'can_view_salary' => true,
                'can_edit_attendance' => true,
                'can_manage_payroll' => true,
                'can_view_all_schedule' => true,
                'can_edit_own_schedule' => true,
            ];
        }

        $scope = PayrollUserScope::query()
            ->where('account_id', $accountId)
            ->where('user_id', $user->id)
            ->first();

        if ($scope) {
            $employeeId = $scope->payroll_employee_id;
            if ($scope->scope_type === 'Chỉ bản thân' && !$employeeId && $linkedEmployee) {
                $employeeId = $linkedEmployee->id;
            }

            $department = $scope->department;
            if ($scope->scope_type === 'Chỉ bản thân' && !$department && $linkedEmployee) {
                $department = $linkedEmployee->department;
            }

            $canEditAttendance = (bool) $scope->can_edit_attendance;
            $canManagePayroll = (bool) $scope->can_manage_payroll;

            return [
                'scope_type' => $scope->scope_type,
                'employee_id' => $employeeId,
                'self_employee_id' => $linkedEmployee?->id ?? $employeeId,
                'department' => $department,
                'can_view_salary' => (bool) $scope->can_view_salary,
                'can_edit_attendance' => $canEditAttendance,
                'can_manage_payroll' => $canManagePayroll,
                'can_view_all_schedule' => true,
                'can_edit_own_schedule' => $canEditAttendance || $canManagePayroll || (bool) ($linkedEmployee?->id ?? $employeeId),
            ];
        }

        if ($linkedEmployee) {
            return [
                'scope_type' => 'Chỉ bản thân',
                'employee_id' => $linkedEmployee->id,
                'self_employee_id' => $linkedEmployee->id,
                'department' => $linkedEmployee->department,
                'can_view_salary' => true,
                'can_edit_attendance' => false,
                'can_manage_payroll' => false,
                'can_view_all_schedule' => true,
                'can_edit_own_schedule' => true,
            ];
        }

        if ($this->userHasPayrollModulePermission($user, $accountId)) {
            return [
                'scope_type' => 'Tất cả',
                'employee_id' => null,
                'self_employee_id' => null,
                'department' => null,
                'can_view_salary' => true,
                'can_edit_attendance' => true,
                'can_manage_payroll' => true,
                'can_view_all_schedule' => true,
                'can_edit_own_schedule' => true,
            ];
        }

        return [
            'scope_type' => 'Không có quyền',
            'employee_id' => null,
            'self_employee_id' => null,
            'department' => null,
            'can_view_salary' => false,
            'can_edit_attendance' => false,
            'can_manage_payroll' => false,
            'can_view_all_schedule' => false,
            'can_edit_own_schedule' => false,
        ];
    }

    private function userHasPayrollModulePermission(User $user, int $accountId): bool
    {
        $access = app(AccessControlService::class);

        foreach (['payroll.create', 'payroll.delete_soft', 'payroll.export'] as $permission) {
            if ($access->can($user, $permission, $accountId)) {
                return true;
            }
        }

        return false;
    }

    private function applyEmployeeScope(Builder $query, array $scope): void
    {
        if ($scope['scope_type'] === 'Tất cả') {
            return;
        }

        if ($scope['scope_type'] === 'Bộ phận' && $scope['department']) {
            $query->where('department', $scope['department']);
            return;
        }

        if ($scope['scope_type'] === 'Chỉ bản thân' && $scope['employee_id']) {
            $query->where('id', $scope['employee_id']);
            return;
        }

        $query->whereRaw('1 = 0');
    }

    private function ensureCanManagePayroll(int $accountId, ?User $user): void
    {
        $scope = $this->resolvePayrollScope($accountId, $user);
        abort_unless($scope['can_manage_payroll'], 403, 'Bạn chưa có quyền quản lý hệ thống lương.');
    }

    private function ensureCanEditAttendance(int $accountId, ?User $user): void
    {
        $scope = $this->resolvePayrollScope($accountId, $user);
        abort_unless($scope['can_edit_attendance'] || $scope['can_manage_payroll'], 403, 'Bạn chưa có quyền sửa bảng chấm công.');
    }

    private function assertEmployeeBelongsToAccount(int $accountId, int $employeeId): void
    {
        PayrollEmployee::query()
            ->where('account_id', $accountId)
            ->where('id', $employeeId)
            ->firstOrFail();
    }

    private function assertShiftBelongsToAccount(int $accountId, int $shiftId): void
    {
        PayrollWorkShift::query()
            ->where('account_id', $accountId)
            ->where('id', $shiftId)
            ->firstOrFail();
    }

    private function syncSalaryRates(int $accountId, PayrollEmployee $employee, array $payload, array $rateRows, array $deletedIds, ?int $userId): void
    {
        if (!empty($deletedIds)) {
            PayrollSalaryRate::query()
                ->where('account_id', $accountId)
                ->where('payroll_employee_id', $employee->id)
                ->whereIn('id', $deletedIds)
                ->delete();
        }

        $normalizedRows = [];
        foreach ($rateRows as $row) {
            if ($this->isEmptySalaryRateRow($row)) {
                continue;
            }

            if (empty($row['effective_from'])) {
                throw ValidationException::withMessages([
                    'employees' => 'Mỗi mốc lương cần có ngày áp dụng.',
                ]);
            }

            $effectiveFrom = Carbon::parse($row['effective_from'])->toDateString();
            $normalizedRows[$effectiveFrom] = [
                'id' => $row['id'] ?? null,
                'effective_from' => $effectiveFrom,
                'salary_type' => $row['salary_type'] ?? ($payload['salary_type'] ?? 'theo_ca'),
                'salary_amount' => $this->number($row['salary_amount'] ?? 0),
                'standard_work_units' => $this->nullableNumber($row['standard_work_units'] ?? null),
                'notes' => $this->nullableTrim($row['notes'] ?? null),
                'created_by' => $userId,
            ];
        }

        if (!empty($payload['salary_effective_from'])) {
            $effectiveFrom = Carbon::parse($payload['salary_effective_from'])->toDateString();
            $normalizedRows[$effectiveFrom] = [
                'id' => $normalizedRows[$effectiveFrom]['id'] ?? null,
                'effective_from' => $effectiveFrom,
                'salary_type' => $payload['salary_type'] ?? 'theo_ca',
                'salary_amount' => $payload['salary_amount'] ?? 0,
                'standard_work_units' => $payload['standard_work_units'] ?? null,
                'notes' => $normalizedRows[$effectiveFrom]['notes'] ?? null,
                'created_by' => $userId,
            ];
        }

        foreach ($normalizedRows as $row) {
            $values = [
                'account_id' => $accountId,
                'payroll_employee_id' => $employee->id,
                'salary_type' => $row['salary_type'],
                'salary_amount' => $row['salary_amount'],
                'standard_work_units' => $row['standard_work_units'],
                'effective_from' => $row['effective_from'],
                'notes' => $row['notes'],
                'created_by' => $row['created_by'],
            ];

            $salaryRate = !empty($row['id'])
                ? PayrollSalaryRate::query()
                    ->where('account_id', $accountId)
                    ->where('payroll_employee_id', $employee->id)
                    ->where('id', $row['id'])
                    ->first()
                : null;

            if ($salaryRate) {
                $conflict = PayrollSalaryRate::query()
                    ->where('account_id', $accountId)
                    ->where('payroll_employee_id', $employee->id)
                    ->where('effective_from', $row['effective_from'])
                    ->where('id', '<>', $salaryRate->id)
                    ->first();

                if ($conflict) {
                    $conflict->update($values);
                    $salaryRate->delete();
                } else {
                    $salaryRate->update($values);
                }
            } else {
                PayrollSalaryRate::query()->updateOrCreate(
                    [
                        'account_id' => $accountId,
                        'payroll_employee_id' => $employee->id,
                        'effective_from' => $row['effective_from'],
                    ],
                    $values
                );
            }
        }
    }

    private function isEmptySalaryRateRow(array $row): bool
    {
        return collect([
            $row['salary_type'] ?? null,
            $row['salary_amount'] ?? null,
            $row['standard_work_units'] ?? null,
            $row['effective_from'] ?? null,
            $row['notes'] ?? null,
        ])->every(fn ($value) => trim((string) ($value ?? '')) === '');
    }

    private function serializeScheduleEmployees($employees)
    {
        return $employees->map(fn (PayrollEmployee $employee) => [
            'id' => $employee->id,
            'employee_code' => $employee->employee_code,
            'full_name' => $employee->full_name,
            'department' => $employee->department,
            'salary_type' => $employee->salary_type,
            'status' => $employee->status,
        ])->values();
    }

    private function serializeEmployees($employees, bool $canViewSalary)
    {
        return $employees->map(function (PayrollEmployee $employee) use ($canViewSalary) {
            $row = $employee->toArray();
            $row['salary_effective_from'] = $employee->salary_effective_from?->toDateString();
            $row['salary_rates'] = $employee->salaryRates
                ->map(function (PayrollSalaryRate $rate) {
                    $row = $rate->toArray();
                    $row['effective_from'] = $rate->effective_from?->toDateString();

                    return $row;
                })
                ->values();

            if (!$canViewSalary) {
                $row['salary_amount'] = null;
                $row['salary_effective_from'] = null;
                $row['lunch_allowance'] = null;
                $row['salary_rates'] = [];
                $row['bank_account_note'] = null;
                $row['bank_qr_image_url'] = null;
            }

            return $row;
        })->values();
    }

    private function serializeAttendanceRecords($records, $employeesById, $shiftsById, bool $canViewSalary)
    {
        return $records->map(function (PayrollAttendanceRecord $record) use ($employeesById, $shiftsById, $canViewSalary) {
            $employee = $employeesById->get($record->payroll_employee_id) ?? $record->employee;
            $shift = $shiftsById->get($record->payroll_work_shift_id) ?? $record->shift;
            $row = $record->toArray();
            $row['calculated_amount'] = $canViewSalary
                ? $this->calculateAttendanceAmount($record, $employee, $shift)
                : null;

            if (!$canViewSalary) {
                $row['unit_rate'] = null;
                $row['bonus_amount'] = null;
                $row['penalty_amount'] = null;
            }

            return $row;
        })->values();
    }

    private function serializeAdjustments($adjustments, bool $canViewSalary)
    {
        return $adjustments->map(function (PayrollAdjustment $adjustment) use ($canViewSalary) {
            $row = $adjustment->toArray();
            if (!$canViewSalary) {
                $row['amount'] = null;
            }

            return $row;
        })->values();
    }

    private function buildPayrollSummary($records, $employeesById, $shiftsById, bool $canViewSalary, $adjustments = null)
    {
        $summary = [];

        foreach ($employeesById as $employee) {
            $summary[$employee->id] = [
                'payroll_employee_id' => $employee->id,
                'employee_code' => $employee->employee_code,
                'full_name' => $employee->full_name,
                'department' => $employee->department,
                'salary_type' => $employee->salary_type,
                'total_work_units' => 0,
                'total_hours' => 0,
                'total_advance' => 0,
                'total_bonus' => 0,
                'total_penalty' => 0,
                'total_salary' => $canViewSalary ? 0 : null,
            ];
        }

        foreach ($records as $record) {
            $employee = $employeesById->get($record->payroll_employee_id) ?? $record->employee;
            if (!$employee || !isset($summary[$employee->id])) {
                continue;
            }

            $shift = $shiftsById->get($record->payroll_work_shift_id) ?? $record->shift;
            $workUnits = (float) $record->work_units;
            $summary[$employee->id]['total_work_units'] += $workUnits;
            $summary[$employee->id]['total_hours'] += $workUnits * (float) ($shift?->standard_hours ?? 0);
            $summary[$employee->id]['total_bonus'] += (float) $record->bonus_amount;
            $summary[$employee->id]['total_penalty'] += (float) $record->penalty_amount;

            if ($canViewSalary) {
                $summary[$employee->id]['total_salary'] += $this->calculateAttendanceAmount($record, $employee, $shift);
            }
        }

        foreach (($adjustments ?? collect()) as $adjustment) {
            $employee = $employeesById->get($adjustment->payroll_employee_id) ?? $adjustment->employee;
            if (!$employee || !isset($summary[$employee->id])) {
                continue;
            }

            $summary[$employee->id]['total_advance'] += abs((float) $adjustment->amount);
        }

        return collect($summary)
            ->map(function ($row) {
                $row['total_work_units'] = round($row['total_work_units'], 3);
                $row['total_hours'] = round($row['total_hours'], 2);
                $row['total_advance'] = round($row['total_advance'], 2);
                $row['total_bonus'] = round($row['total_bonus'], 2);
                $row['total_penalty'] = round($row['total_penalty'], 2);
                if ($row['total_salary'] !== null) {
                    $row['total_salary'] = round($row['total_salary'], 2);
                }
                $row['remaining_salary'] = $row['total_salary'] === null
                    ? null
                    : round($row['total_salary'] - $row['total_advance'], 2);

                return $row;
            })
            ->sortBy('employee_code')
            ->values();
    }

    private function calculateAttendanceAmount(PayrollAttendanceRecord $record, ?PayrollEmployee $employee, ?PayrollWorkShift $shift): float
    {
        if (!$employee) {
            return 0;
        }

        $workUnits = (float) $record->work_units;
        $bonus = (float) $record->bonus_amount;
        $penalty = (float) $record->penalty_amount;
        $multiplier = (float) ($shift?->wage_multiplier ?? 1);
        $salary = $this->salaryContextForDate($employee, $record->work_date);
        $salaryAmount = (float) $salary['salary_amount'];

        if ($record->unit_rate !== null) {
            $base = (float) $record->unit_rate * $workUnits * $multiplier;
            return round($base + $bonus - $penalty, 2);
        }

        $base = match ($salary['salary_type']) {
            'theo_gio' => $salaryAmount * (float) ($shift?->standard_hours ?? 0) * $workUnits * $multiplier,
            'theo_thang' => $this->monthlySalaryForWorkUnits($salaryAmount, (float) ($salary['standard_work_units'] ?: 0), $workUnits),
            default => $salaryAmount * $workUnits * $multiplier,
        };

        return round($base + $bonus - $penalty, 2);
    }

    private function salaryContextForDate(PayrollEmployee $employee, $workDate): array
    {
        $context = [
            'salary_type' => $employee->salary_type,
            'salary_amount' => (float) $employee->salary_amount,
            'standard_work_units' => (float) ($employee->standard_work_units ?: 0),
        ];

        $date = Carbon::parse($workDate)->toDateString();
        $rates = $employee->relationLoaded('salaryRates')
            ? $employee->salaryRates
            : PayrollSalaryRate::query()
                ->where('account_id', $employee->account_id)
                ->where('payroll_employee_id', $employee->id)
                ->orderByDesc('effective_from')
                ->orderByDesc('id')
                ->get();

        $rate = $rates->first(function (PayrollSalaryRate $item) use ($date) {
            return Carbon::parse($item->effective_from)->toDateString() <= $date;
        });

        if (!$rate) {
            return $context;
        }

        return [
            'salary_type' => $rate->salary_type,
            'salary_amount' => (float) $rate->salary_amount,
            'standard_work_units' => (float) ($rate->standard_work_units ?: 0),
        ];
    }

    private function monthlySalaryForWorkUnits(float $salaryAmount, float $standardWorkUnits, float $workUnits): float
    {
        if ($standardWorkUnits <= 0) {
            return 0;
        }

        return $salaryAmount / $standardWorkUnits * $workUnits;
    }

    private function nextEmployeeCode(int $accountId): string
    {
        $number = PayrollEmployee::query()
            ->where('account_id', $accountId)
            ->count() + 1;

        do {
            $code = 'NV' . str_pad((string) $number, 3, '0', STR_PAD_LEFT);
            $number++;
        } while (
            PayrollEmployee::query()
                ->where('account_id', $accountId)
                ->where('employee_code', $code)
                ->exists()
        );

        return $code;
    }

    private function nullableTrim($value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));

        return $trimmed === '' ? null : $trimmed;
    }

    private function number($value): float
    {
        if ($value === null || $value === '') {
            return 0;
        }

        return (float) $value;
    }

    private function nullableNumber($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return (float) $value;
    }
}
