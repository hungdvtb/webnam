<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SiteDomain extends Model
{
    protected $fillable = ['account_id', 'domain', 'is_active', 'is_default'];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
