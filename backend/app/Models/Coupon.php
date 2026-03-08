<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Coupon extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'code',
        'type',
        'value',
        'min_order_value',
        'start_date',
        'end_date',
        'usage_limit',
        'used_count',
        'is_active',
    ];

    public function isValid()
    {
        if (!$this->is_active) return false;
        if ($this->start_date && $this->start_date > now()) return false;
        if ($this->end_date && $this->end_date < now()) return false;
        if ($this->usage_limit && $this->used_count >= $this->usage_limit) return false;
        return true;
    }
}
