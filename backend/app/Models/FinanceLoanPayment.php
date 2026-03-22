<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceLoanPayment extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'loan_id',
        'wallet_id',
        'finance_transaction_id',
        'created_by',
        'updated_by',
        'code',
        'status',
        'payment_date',
        'principal_amount',
        'interest_amount',
        'total_amount',
        'note',
    ];

    protected $casts = [
        'payment_date' => 'datetime',
        'principal_amount' => 'decimal:2',
        'interest_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
    ];

    public function loan()
    {
        return $this->belongsTo(FinanceLoan::class, 'loan_id');
    }

    public function wallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'wallet_id');
    }

    public function transaction()
    {
        return $this->belongsTo(FinanceTransaction::class, 'finance_transaction_id');
    }
}
