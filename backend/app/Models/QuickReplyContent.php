<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuickReplyContent extends Model
{
    protected $fillable = [
        'quick_reply_id',
        'body',
        'position',
        'is_active',
    ];

    protected $casts = [
        'quick_reply_id' => 'integer',
        'position' => 'integer',
        'is_active' => 'boolean',
    ];

    public function quickReply()
    {
        return $this->belongsTo(QuickReply::class);
    }

    public function images()
    {
        return $this->hasMany(QuickReplyImage::class)->orderBy('sort_order')->orderBy('id');
    }
}
