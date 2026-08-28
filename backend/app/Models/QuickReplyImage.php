<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuickReplyImage extends Model
{
    protected $fillable = [
        'quick_reply_id',
        'quick_reply_content_id',
        'media_asset_id',
        'url',
        'thumbnail_url',
        'medium_url',
        'large_url',
        'original_url',
        'width',
        'height',
        'sort_order',
        'metadata',
    ];

    protected $casts = [
        'quick_reply_id' => 'integer',
        'quick_reply_content_id' => 'integer',
        'media_asset_id' => 'integer',
        'width' => 'integer',
        'height' => 'integer',
        'sort_order' => 'integer',
        'metadata' => 'array',
    ];

    public function quickReply()
    {
        return $this->belongsTo(QuickReply::class);
    }

    public function content()
    {
        return $this->belongsTo(QuickReplyContent::class, 'quick_reply_content_id');
    }

    public function mediaAsset()
    {
        return $this->belongsTo(MediaAsset::class);
    }
}
