<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class PayrollUserScope extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'user_id',
        'payroll_employee_id',
        'role_name',
        'scope_type',
        'department',
        'can_view_salary',
        'can_edit_attendance',
        'can_manage_payroll',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'can_view_salary' => 'boolean',
            'can_edit_attendance' => 'boolean',
            'can_manage_payroll' => 'boolean',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function employee()
    {
        return $this->belongsTo(PayrollEmployee::class, 'payroll_employee_id');
    }
}
