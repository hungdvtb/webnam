<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceWallet extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'code',
        'name',
        'type',
        'bank_name',
        'account_number',
        'currency',
        'opening_balance',
        'current_balance',
        'color',
        'note',
        'is_default',
        'is_active',
        'sort_order',
        'balance_updated_at',
    ];

    protected $casts = [
        'opening_balance' => 'decimal:2',
        'current_balance' => 'decimal:2',
        'is_default' => 'boolean',
        'is_active' => 'boolean',
        'balance_updated_at' => 'datetime',
    ];

    public function transactions()
    {
        return $this->hasMany(FinanceTransaction::class, 'wallet_id');
    }

    public function outgoingTransfers()
    {
        return $this->hasMany(FinanceTransfer::class, 'from_wallet_id');
    }

    public function incomingTransfers()
    {
        return $this->hasMany(FinanceTransfer::class, 'to_wallet_id');
    }

    public function disbursedLoans()
    {
        return $this->hasMany(FinanceLoan::class, 'disbursed_wallet_id');
    }

    public function fixedExpenses()
    {
        return $this->hasMany(FinanceFixedExpense::class, 'default_wallet_id');
    }
}
