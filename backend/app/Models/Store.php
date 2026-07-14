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
        'storefront_theme_id',
        'simple_product_theme_id',
        'configurable_product_theme_id',
        'bundle_product_theme_id',
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
        'storefront_theme_id' => 'integer',
        'simple_product_theme_id' => 'integer',
        'configurable_product_theme_id' => 'integer',
        'bundle_product_theme_id' => 'integer',
        'status' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function publicDomain()
    {
        return $this->belongsTo(SiteDomain::class, 'public_domain_id');
    }

    public function storefrontTheme()
    {
        return $this->belongsTo(StorefrontTheme::class);
    }

    public function simpleProductTheme()
    {
        return $this->belongsTo(StorefrontTheme::class, 'simple_product_theme_id');
    }

    public function configurableProductTheme()
    {
        return $this->belongsTo(StorefrontTheme::class, 'configurable_product_theme_id');
    }

    public function bundleProductTheme()
    {
        return $this->belongsTo(StorefrontTheme::class, 'bundle_product_theme_id');
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
