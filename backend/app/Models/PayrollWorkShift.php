<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollWorkShift extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'shift_code',
        'shift_name',
        'start_time',
        'end_time',
        'standard_hours',
        'default_work_units',
        'wage_multiplier',
        'is_active',
        'sort_order',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'standard_hours' => 'decimal:2',
            'default_work_units' => 'decimal:3',
            'wage_multiplier' => 'decimal:3',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
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
