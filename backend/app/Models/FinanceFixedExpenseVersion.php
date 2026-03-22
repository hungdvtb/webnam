<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class FinanceFixedExpenseVersion extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'created_by',
        'effective_date',
        'day_calculation_mode',
        'total_monthly_amount',
        'items_snapshot',
        'note',
    ];

    protected $casts = [
        'effective_date' => 'date',
        'total_monthly_amount' => 'decimal:2',
        'items_snapshot' => 'array',
    ];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
