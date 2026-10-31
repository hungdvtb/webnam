<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedCostCategory extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'sort_order',
    ];
}
