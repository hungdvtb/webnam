<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuickReplyImageFolder extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'sort_order',
        'is_active',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'sort_order' => 'integer',
        'is_active' => 'boolean',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function images()
    {
        return $this->hasMany(QuickReplyGalleryImage::class, 'folder_id');
    }
}
