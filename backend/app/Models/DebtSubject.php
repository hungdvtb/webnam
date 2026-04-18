<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DebtSubject extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'interest_rate_percent', 'initial_debt'];

    public function transactions()
    {
        return $this->hasMany(DebtTransaction::class)->orderBy('transaction_date', 'asc');
    }
}
