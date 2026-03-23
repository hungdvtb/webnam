<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class FinanceDailyProfitConfigVersion extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'created_by',
        'effective_date',
        'return_rate',
        'packaging_cost_per_order',
        'shipping_calculation_mode',
        'shipping_cost_per_order',
        'shipping_cost_rate',
        'tax_rate',
        'note',
    ];

    protected $casts = [
        'effective_date' => 'date',
        'return_rate' => 'decimal:4',
        'packaging_cost_per_order' => 'decimal:2',
        'shipping_cost_per_order' => 'decimal:2',
        'shipping_cost_rate' => 'decimal:4',
        'tax_rate' => 'decimal:4',
    ];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
