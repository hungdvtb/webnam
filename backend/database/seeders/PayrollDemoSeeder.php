<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\PayrollAttendanceRecord;
use App\Models\PayrollEmployee;
use App\Models\PayrollScheduleRegistration;
use App\Models\PayrollUserScope;
use App\Models\PayrollWorkShift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class PayrollDemoSeeder extends Seeder
{
    public function run(): void
    {
        $accounts = Account::query()->orderBy('id')->get();

        if ($accounts->isEmpty()) {
            $accounts = collect([Account::create([
                'name' => 'Cửa hàng demo',
                'site_code' => 'DEMO',
                'status' => 1,
            ])]);
        }

        DB::transaction(function () use ($accounts) {
            foreach ($accounts as $account) {
                $shifts = $this->seedShifts($account->id);
                $employees = $this->seedEmployees($account->id);
                $this->seedUserScopes($account->id, $employees);
                $this->seedScheduleAndAttendance($account->id, $employees, $shifts);
            }
        });
    }

    private function seedShifts(int $accountId): array
    {
        $rows = [
            [
                'shift_code' => 'S',
                'shift_name' => 'Ca sáng',
                'start_time' => '08:00:00',
                'end_time' => '12:00:00',
                'standard_hours' => 4,
                'default_work_units' => 1,
                'wage_multiplier' => 1,
                'sort_order' => 10,
                'notes' => 'Một ca sáng tính 1 công.',
            ],
            [
                'shift_code' => 'C',
                'shift_name' => 'Ca chiều',
                'start_time' => '13:30:00',
                'end_time' => '17:30:00',
                'standard_hours' => 4,
                'default_work_units' => 1,
                'wage_multiplier' => 1,
                'sort_order' => 20,
                'notes' => 'Một ca chiều tính 1 công.',
            ],
            [
                'shift_code' => 'T',
                'shift_name' => 'Ca tối',
                'start_time' => '18:30:00',
                'end_time' => '22:30:00',
                'standard_hours' => 4,
                'default_work_units' => 1,
                'wage_multiplier' => 1.2,
                'sort_order' => 30,
                'notes' => 'Ca tối có hệ số lương cao hơn.',
            ],
        ];

        $result = [];

        foreach ($rows as $row) {
            $result[$row['shift_code']] = PayrollWorkShift::query()->updateOrCreate(
                ['account_id' => $accountId, 'shift_code' => $row['shift_code']],
                array_merge($row, ['account_id' => $accountId, 'is_active' => true])
            );
        }

        return $result;
    }

    private function seedEmployees(int $accountId): array
    {
        $rows = [
            ['NV001', 'Cao Quỳnh Nhung', 'Marketing', 'Nhân viên fulltime', 'theo_thang', 8000000, 26, 500000, 'Theo KPI bộ phận', 'Ngày 15 - 1', 'Sau 6 tháng xét tăng lương'],
            ['NV002', 'Chị Nga', 'Spa', 'Kỹ thuật viên', 'theo_ca', 120000, null, 0, 'Thưởng doanh thu dịch vụ', 'Ngày 10 - 25', 'Xét tăng theo tay nghề'],
            ['NV003', 'Mai Mít', 'Spa', 'Kỹ thuật viên part-time', 'theo_ca', 100000, null, 0, 'Không có', 'Ngày 10 - 25', 'Theo lịch làm thực tế'],
            ['NV004', 'Duy Anh', 'Marketing', 'Content marketing', 'theo_ca', 120000, null, 0, 'Thưởng bài đạt KPI', 'Ngày 15 - 1', 'Sau 3 tháng thử việc'],
            ['NV005', 'Nguyễn Thị Lan', 'Chăm sóc khách hàng', 'Tư vấn viên', 'theo_thang', 7000000, 26, 400000, 'Thưởng chốt đơn', 'Ngày 15 - 1', 'Sau 6 tháng xét tăng'],
            ['NV006', 'Trần Minh Đức', 'Kho', 'Nhân viên kho', 'theo_thang', 6500000, 26, 300000, 'Thưởng chuyên cần', 'Ngày 15 - 1', 'Theo năng lực'],
            ['NV007', 'Phạm Thu Hà', 'Kế toán', 'Kế toán nội bộ', 'theo_thang', 9000000, 26, 500000, 'Thưởng cuối tháng', 'Ngày 15 - 1', 'Theo đánh giá quý'],
            ['NV008', 'Lê Hoàng Nam', 'Bán hàng', 'Nhân viên bán hàng', 'theo_ca', 110000, null, 0, 'Thưởng doanh số', 'Ngày 10 - 25', 'Theo doanh số'],
            ['NV009', 'Bùi Hồng Anh', 'Spa', 'Phụ tá dịch vụ', 'theo_gio', 30000, null, 0, 'Không có', 'Ngày 10 - 25', 'Theo số giờ làm'],
            ['NV010', 'Đỗ Gia Hân', 'Chăm sóc khách hàng', 'Part-time hỗ trợ', 'theo_ca', 90000, null, 0, 'Không có', 'Ngày 10 - 25', 'Theo lịch làm thực tế'],
        ];

        $employees = [];

        foreach ($rows as $row) {
            [$code, $name, $department, $position, $salaryType, $salaryAmount, $standardUnits, $lunchAllowance, $bonusPolicy, $paySchedule, $raisePlan] = $row;

            $employees[$code] = PayrollEmployee::query()->updateOrCreate(
                ['account_id' => $accountId, 'employee_code' => $code],
                [
                    'account_id' => $accountId,
                    'employee_code' => $code,
                    'full_name' => $name,
                    'department' => $department,
                    'position' => $position,
                    'salary_type' => $salaryType,
                    'salary_amount' => $salaryAmount,
                    'standard_work_units' => $standardUnits,
                    'lunch_allowance' => $lunchAllowance,
                    'bonus_policy' => $bonusPolicy,
                    'pay_schedule' => $paySchedule,
                    'raise_plan' => $raisePlan,
                    'bank_account_note' => "TK demo {$code}",
                    'status' => 'Đang làm',
                    'notes' => 'Dữ liệu demo để kiểm tra bảng công lương.',
                ]
            );
        }

        return $employees;
    }

    private function seedUserScopes(int $accountId, array $employees): void
    {
        $users = User::query()->orderByDesc('is_admin')->orderBy('id')->limit(3)->get();

        if ($users->isEmpty()) {
            return;
        }

        $scopeRows = [
            [
                'user' => $users->get(0),
                'employee' => $employees['NV001'] ?? null,
                'role_name' => 'Quản trị viên',
                'scope_type' => 'Tất cả',
                'department' => null,
                'can_view_salary' => true,
                'can_edit_attendance' => true,
                'can_manage_payroll' => true,
                'notes' => 'Demo quyền admin xem toàn bộ công lương.',
            ],
            [
                'user' => $users->get(1),
                'employee' => $employees['NV002'] ?? null,
                'role_name' => 'Quản lý',
                'scope_type' => 'Bộ phận',
                'department' => 'Spa',
                'can_view_salary' => true,
                'can_edit_attendance' => true,
                'can_manage_payroll' => false,
                'notes' => 'Demo quản lý chỉ xem bộ phận Spa.',
            ],
            [
                'user' => $users->get(2),
                'employee' => $employees['NV003'] ?? null,
                'role_name' => 'Nhân viên',
                'scope_type' => 'Chỉ bản thân',
                'department' => null,
                'can_view_salary' => true,
                'can_edit_attendance' => false,
                'can_manage_payroll' => false,
                'notes' => 'Demo nhân viên chỉ xem dữ liệu của mình.',
            ],
        ];

        foreach ($scopeRows as $row) {
            if (!$row['user']) {
                continue;
            }

            PayrollUserScope::query()->updateOrCreate(
                ['account_id' => $accountId, 'user_id' => $row['user']->id],
                [
                    'account_id' => $accountId,
                    'user_id' => $row['user']->id,
                    'payroll_employee_id' => $row['employee']?->id,
                    'role_name' => $row['role_name'],
                    'scope_type' => $row['scope_type'],
                    'department' => $row['department'],
                    'can_view_salary' => $row['can_view_salary'],
                    'can_edit_attendance' => $row['can_edit_attendance'],
                    'can_manage_payroll' => $row['can_manage_payroll'],
                    'notes' => $row['notes'],
                ]
            );
        }
    }

    private function seedScheduleAndAttendance(int $accountId, array $employees, array $shifts): void
    {
        $monthStart = now()->startOfMonth();
        $maxDay = min(now()->day, 18);
        $patterns = [
            'NV001' => ['S', 'C'],
            'NV002' => ['S', 'C'],
            'NV003' => ['C', 'T'],
            'NV004' => ['S'],
            'NV005' => ['S', 'C'],
            'NV006' => ['S'],
            'NV007' => ['S'],
            'NV008' => ['C', 'T'],
            'NV009' => ['S', 'C'],
            'NV010' => ['C'],
        ];

        foreach ($patterns as $employeeCode => $shiftCodes) {
            $employee = $employees[$employeeCode] ?? null;
            if (!$employee) {
                continue;
            }

            for ($day = 1; $day <= $maxDay; $day++) {
                $date = $monthStart->copy()->day($day);
                if ($date->isSunday()) {
                    continue;
                }

                foreach ($shiftCodes as $shiftCode) {
                    $shift = $shifts[$shiftCode] ?? null;
                    if (!$shift) {
                        continue;
                    }

                    $registeredUnits = 1;
                    $status = 'Đi làm';
                    $workUnits = 1;
                    $bonus = 0;
                    $penalty = 0;
                    $notes = null;

                    if ($employeeCode === 'NV003' && in_array($day, [3, 11], true) && $shiftCode === 'T') {
                        $status = 'Làm lẻ';
                        $registeredUnits = 0.3;
                        $workUnits = 0.3;
                        $notes = 'Demo công lẻ 0.3 ca.';
                    } elseif ($employeeCode === 'NV002' && in_array($day, [5, 14], true) && $shiftCode === 'C') {
                        $status = 'Nửa ca';
                        $registeredUnits = 0.5;
                        $workUnits = 0.5;
                        $notes = 'Demo làm nửa ca.';
                    } elseif ($employeeCode === 'NV004' && in_array($day, [7, 16], true)) {
                        $status = 'Nghỉ';
                        $workUnits = 0;
                        $penalty = 0;
                        $notes = 'Báo nghỉ trước.';
                    } elseif ($employeeCode === 'NV008' && $day === 10 && $shiftCode === 'T') {
                        $status = 'Tăng ca';
                        $registeredUnits = 1.25;
                        $workUnits = 1.25;
                        $bonus = 50000;
                        $notes = 'Demo tăng ca 1.25 công.';
                    }

                    $schedule = PayrollScheduleRegistration::query()->updateOrCreate(
                        [
                            'account_id' => $accountId,
                            'work_date' => $date->toDateString(),
                            'payroll_employee_id' => $employee->id,
                            'payroll_work_shift_id' => $shift->id,
                        ],
                        [
                            'account_id' => $accountId,
                            'work_date' => $date->toDateString(),
                            'payroll_employee_id' => $employee->id,
                            'payroll_work_shift_id' => $shift->id,
                            'registered_work_units' => $registeredUnits,
                            'status' => 'Đã đăng ký',
                            'notes' => $notes,
                        ]
                    );

                    PayrollAttendanceRecord::query()->updateOrCreate(
                        [
                            'account_id' => $accountId,
                            'work_date' => $date->toDateString(),
                            'payroll_employee_id' => $employee->id,
                            'payroll_work_shift_id' => $shift->id,
                        ],
                        [
                            'account_id' => $accountId,
                            'payroll_schedule_registration_id' => $schedule->id,
                            'work_date' => $date->toDateString(),
                            'payroll_employee_id' => $employee->id,
                            'payroll_work_shift_id' => $shift->id,
                            'attendance_status' => $status,
                            'work_units' => $workUnits,
                            'unit_rate' => null,
                            'bonus_amount' => $bonus,
                            'penalty_amount' => $penalty,
                            'notes' => $notes,
                        ]
                    );
                }
            }
        }
    }
}
