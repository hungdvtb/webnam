<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DebtTransaction extends Model
{
    use HasFactory;

    protected $fillable = [
        'debt_subject_id',
        'transaction_date',
        'type',
        'amount',
        'note',
        'fin_account_id',
        'fin_transaction_id'
    ];

    public function subject()
    {
        return $this->belongsTo(DebtSubject::class, 'debt_subject_id');
    }
}
