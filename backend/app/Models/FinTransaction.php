<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FinTransaction extends Model
{
    use HasFactory;

    protected $fillable = [
        'account_id',
        'transaction_date',
        'description',
        'fin_account_id',
        'fin_category_id',
        'type',
        'amount',
        'balance_after',
        'notes'
    ];

    public function account()
    {
        return $this->belongsTo(FinAccount::class, 'fin_account_id');
    }

    public function category()
    {
        return $this->belongsTo(FinCategory::class, 'fin_category_id');
    }
}
