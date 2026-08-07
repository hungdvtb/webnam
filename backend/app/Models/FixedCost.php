<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FixedCost extends Model
{
    protected $fillable = ['category', 'name', 'amount', 'notes', 'applied_from'];
}
