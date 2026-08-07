<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollAdjustment extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'adjustment_date',
        'payroll_employee_id',
        'adjustment_type',
        'amount',
        'notes',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'adjustment_date' => 'date:Y-m-d',
            'amount' => 'decimal:2',
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
