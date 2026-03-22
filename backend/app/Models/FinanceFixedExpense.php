<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceFixedExpense extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'category_id',
        'default_wallet_id',
        'created_by',
        'updated_by',
        'code',
        'name',
        'amount',
        'sort_order',
        'frequency',
        'interval_value',
        'reminder_days',
        'status',
        'start_date',
        'next_due_date',
        'last_paid_date',
        'note',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'sort_order' => 'integer',
        'start_date' => 'date',
        'next_due_date' => 'date',
        'last_paid_date' => 'date',
    ];

    public function category()
    {
        return $this->belongsTo(FinanceCatalog::class, 'category_id');
    }

    public function wallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'default_wallet_id');
    }
}
