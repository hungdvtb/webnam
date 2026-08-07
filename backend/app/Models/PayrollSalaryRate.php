<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollSalaryRate extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'payroll_employee_id',
        'salary_type',
        'salary_amount',
        'standard_work_units',
        'effective_from',
        'notes',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'salary_amount' => 'decimal:2',
            'standard_work_units' => 'decimal:3',
            'effective_from' => 'date',
        ];
    }

    public function employee()
    {
        return $this->belongsTo(PayrollEmployee::class, 'payroll_employee_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
