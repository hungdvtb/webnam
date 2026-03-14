<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attribute extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['name', 'entity_type', 'code', 'frontend_type', 'swatch_type', 'is_filterable', 'is_filterable_frontend', 'is_filterable_backend', 'is_required', 'is_variant', 'status', 'account_id'];

    protected $casts = [
        'is_filterable' => 'boolean',
        'is_filterable_frontend' => 'boolean',
        'is_filterable_backend' => 'boolean',
        'is_required' => 'boolean',
        'is_variant' => 'boolean',
        'status' => 'boolean',
    ];

    public function scopeByEntityType($query, $type)
    {
        return $query->where('entity_type', $type);
    }

    public function options()
    {
        return $this->hasMany(AttributeOption::class)->orderBy('order');
    }

    public function values()
    {
        return $this->hasMany(ProductAttributeValue::class);
    }
}
