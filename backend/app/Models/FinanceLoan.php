<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceLoan extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'disbursed_wallet_id',
        'disbursement_transaction_id',
        'created_by',
        'updated_by',
        'code',
        'type',
        'status',
        'counterparty_name',
        'counterparty_contact',
        'principal_amount',
        'principal_paid',
        'interest_paid',
        'interest_rate',
        'interest_type',
        'start_date',
        'due_date',
        'note',
    ];

    protected $casts = [
        'principal_amount' => 'decimal:2',
        'principal_paid' => 'decimal:2',
        'interest_paid' => 'decimal:2',
        'interest_rate' => 'decimal:4',
        'start_date' => 'date',
        'due_date' => 'date',
    ];

    protected $appends = [
        'outstanding_principal',
    ];

    public function wallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'disbursed_wallet_id');
    }

    public function disbursementTransaction()
    {
        return $this->belongsTo(FinanceTransaction::class, 'disbursement_transaction_id');
    }

    public function payments()
    {
        return $this->hasMany(FinanceLoanPayment::class, 'loan_id')->orderByDesc('payment_date');
    }

    public function getOutstandingPrincipalAttribute(): float
    {
        return round((float) $this->principal_amount - (float) $this->principal_paid, 2);
    }
}
