<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StorefrontTheme extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'code',
        'folder',
        'preview_image',
        'description',
        'product_type',
        'cloned_from_id',
        'status',
        'is_default',
        'sort_order',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'cloned_from_id' => 'integer',
        'status' => 'boolean',
        'is_default' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function clonedFrom()
    {
        return $this->belongsTo(self::class, 'cloned_from_id');
    }

    public function stores()
    {
        return $this->hasMany(Store::class);
    }

    public function toStorefrontPayload(): array
    {
        return [
            'id' => (int) $this->id,
            'name' => $this->name,
            'code' => $this->code,
            'folder' => $this->folder,
            'preview_image' => $this->preview_image,
            'description' => $this->description,
            'product_type' => $this->product_type ?: 'simple',
            'is_default' => (bool) $this->is_default,
        ];
    }
}
