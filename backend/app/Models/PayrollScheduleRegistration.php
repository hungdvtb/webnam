<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollScheduleRegistration extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'work_date',
        'payroll_employee_id',
        'payroll_work_shift_id',
        'registered_work_units',
        'status',
        'notes',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'work_date' => 'date:Y-m-d',
            'registered_work_units' => 'decimal:3',
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

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function attendanceRecord()
    {
        return $this->hasOne(PayrollAttendanceRecord::class);
    }
}
