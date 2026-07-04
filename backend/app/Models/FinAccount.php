<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FinAccount extends Model
{
    use HasFactory;

    protected $fillable = ['account_id', 'name', 'type', 'balance', 'description', 'initial_balance'];

    public function transactions()
    {
        return $this->hasMany(FinTransaction::class);
    }
}
