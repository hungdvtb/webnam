<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['name', 'slug', 'parent_id', 'description', 'banner_path', 'status', 'order', 'account_id', 'display_layout', 'filterable_attribute_ids'];

    protected $casts = [
        'filterable_attribute_ids' => 'array',
        'status' => 'integer',
        'order' => 'integer'
    ];
    
    public function parent()
    {
        return $this->belongsTo(Category::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(Category::class, 'parent_id');
    }

    public function products()
    {
        return $this->belongsToMany(Product::class);
    }}
