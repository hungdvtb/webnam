<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Store extends Model
{
    use \App\Traits\BelongsToAccount;

    protected static string $accountScopeType = 'catalog';

    protected $fillable = [
        'account_id',
        'public_domain_id',
        'name',
        'slug',
        'code',
        'phone',
        'address',
        'status',
        'sort_order',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'public_domain_id' => 'integer',
        'status' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function publicDomain()
    {
        return $this->belongsTo(SiteDomain::class, 'public_domain_id');
    }

    public function categories()
    {
        return $this->hasMany(Category::class);
    }

    public function products()
    {
        return $this->hasMany(Product::class);
    }
}
