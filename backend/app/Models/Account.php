<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Account extends Model
{
    protected $fillable = [
        'name',
        'domain',
        'subdomain',
        'site_code',
        'status',
        'ai_api_key',
        'catalog_account_id',
        'inventory_account_id',
        'public_domain_id',
        'storefront_theme_id',
        'simple_product_theme_id',
        'configurable_product_theme_id',
        'bundle_product_theme_id',
    ];

    protected $casts = [
        'status' => 'boolean',
        'catalog_account_id' => 'integer',
        'inventory_account_id' => 'integer',
        'public_domain_id' => 'integer',
        'storefront_theme_id' => 'integer',
        'simple_product_theme_id' => 'integer',
        'configurable_product_theme_id' => 'integer',
        'bundle_product_theme_id' => 'integer',
    ];

    public function users()
    {
        return $this->belongsToMany(User::class)
            ->using(AccountUser::class)
            ->withPivot('role', 'permission_label', 'status', 'permissions', 'data_permissions')
            ->withTimestamps();
    }

    public function catalogAccount()
    {
        return $this->belongsTo(self::class, 'catalog_account_id');
    }

    public function inventoryAccount()
    {
        return $this->belongsTo(self::class, 'inventory_account_id');
    }

    public function publicDomain()
    {
        return $this->belongsTo(SiteDomain::class, 'public_domain_id');
    }

    public function storefrontTheme()
    {
        return $this->belongsTo(StorefrontTheme::class, 'storefront_theme_id');
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
}
