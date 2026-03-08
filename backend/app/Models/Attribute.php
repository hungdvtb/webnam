<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Attribute extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['name', 'code', 'frontend_type', 'swatch_type', 'is_filterable', 'is_required', 'is_variant', 'account_id'];

    public function options()
    {
        return $this->hasMany(AttributeOption::class)->orderBy('order');
    }

    public function values()
    {
        return $this->hasMany(ProductAttributeValue::class);
    }
}
