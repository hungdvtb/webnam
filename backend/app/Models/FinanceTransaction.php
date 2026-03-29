<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

class FinanceTransaction extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    public const TYPE_RECEIPT_VOUCHER = 'receipt_voucher';

    protected $fillable = [
        'account_id',
        'wallet_id',
        'category_id',
        'source_name',
        'related_transaction_id',
        'created_by',
        'updated_by',
        'code',
        'status',
        'direction',
        'transaction_type',
        'payment_method',
        'transaction_date',
        'amount',
        'counterparty_type',
        'counterparty_name',
        'counterparty_phone',
        'reference_type',
        'reference_id',
        'reference_code',
        'reference_label',
        'content',
        'note',
        'attachment_path',
        'affects_profit_loss',
        'metadata',
    ];

    protected $casts = [
        'transaction_date' => 'datetime',
        'amount' => 'decimal:2',
        'affects_profit_loss' => 'boolean',
        'metadata' => 'array',
    ];

    protected $appends = [
        'signed_amount',
        'attachment_url',
    ];

    public function wallet()
    {
        return $this->belongsTo(FinanceWallet::class, 'wallet_id');
    }

    public function category()
    {
        return $this->belongsTo(FinanceCatalog::class, 'category_id');
    }

    public function relatedTransaction()
    {
        return $this->belongsTo(self::class, 'related_transaction_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function getSignedAmountAttribute(): float
    {
        $amount = (float) ($this->amount ?? 0);

        return $this->direction === 'out' ? $amount * -1 : $amount;
    }

    public function getAttachmentUrlAttribute(): ?string
    {
        if (!$this->attachment_path) {
            return null;
        }

        return Storage::disk('public')->url($this->attachment_path);
    }

    public function scopeReceiptVouchers($query)
    {
        return $query
            ->where('direction', 'in')
            ->where('transaction_type', self::TYPE_RECEIPT_VOUCHER);
    }
}
