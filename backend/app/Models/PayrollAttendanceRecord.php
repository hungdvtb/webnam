<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollAttendanceRecord extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'payroll_schedule_registration_id',
        'work_date',
        'payroll_employee_id',
        'payroll_work_shift_id',
        'attendance_status',
        'work_units',
        'unit_rate',
        'bonus_amount',
        'penalty_amount',
        'notes',
        'approved_by',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date:Y-m-d',
            'work_units' => 'decimal:3',
            'unit_rate' => 'decimal:2',
            'bonus_amount' => 'decimal:2',
            'penalty_amount' => 'decimal:2',
        ];
    }

    public function employee()
    {
        return $this->belongsTo(PayrollEmployee::class, 'payroll_employee_id');
    }

    public function shift()
    {
        return $this->belongsTo(PayrollWorkShift::class, 'payroll_work_shift_id');
    }

    public function schedule()
    {
        return $this->belongsTo(PayrollScheduleRegistration::class, 'payroll_schedule_registration_id');
    }

    public function approver()
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
