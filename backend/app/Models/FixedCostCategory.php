<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedCostCategory extends Model
{
    protected $fillable = [
        'name',
        'sort_order',
    ];
}
