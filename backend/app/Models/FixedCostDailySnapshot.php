<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedCostDailySnapshot extends Model
{
    protected $fillable = ['account_id', 'date', 'amount'];
}
