<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceTransfer extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'from_wallet_id',
        'to_wallet_id',
        'outgoing_transaction_id',
        'incoming_transaction_id',
        'created_by',
        'updated_by',
        'code',
        'status',
        'transfer_date',
        'amount',
        'content',
        'note',
    ];

    protected $casts = [
        'transfer_date' => 'datetime',
        'amount' => 'decimal:2',
    ];

    public function fromWallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'from_wallet_id');
    }

    public function toWallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'to_wallet_id');
    }

    public function outgoingTransaction()
    {
        return $this->belongsTo(FinanceTransaction::class, 'outgoing_transaction_id');
    }

    public function incomingTransaction()
    {
        return $this->belongsTo(FinanceTransaction::class, 'incoming_transaction_id');
    }
}
