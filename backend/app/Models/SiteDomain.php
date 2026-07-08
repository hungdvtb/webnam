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

    public function publicStores()
    {
        return $this->hasMany(Store::class, 'public_domain_id');
    }

    public function publicAccounts()
    {
        return $this->hasMany(Account::class, 'public_domain_id');
    }
}
