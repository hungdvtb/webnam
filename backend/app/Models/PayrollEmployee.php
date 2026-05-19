<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollEmployee extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'user_id',
        'employee_code',
        'full_name',
        'phone',
        'address',
        'identity_card_image_url',
        'department',
        'position',
        'salary_type',
        'salary_amount',
        'standard_work_units',
        'lunch_allowance',
        'bonus_policy',
        'pay_schedule',
        'raise_plan',
        'bank_account_note',
        'status',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'salary_amount' => 'decimal:2',
            'standard_work_units' => 'decimal:3',
            'lunch_allowance' => 'decimal:2',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function schedules()
    {
        return $this->hasMany(PayrollScheduleRegistration::class);
    }

    public function attendanceRecords()
    {
        return $this->hasMany(PayrollAttendanceRecord::class);
    }
}
