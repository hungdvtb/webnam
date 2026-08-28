<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class QuickReply extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'topic_id',
        'shortcut',
        'title',
        'body',
        'tags',
        'search_text',
        'sort_order',
        'use_count',
        'is_active',
        'last_used_at',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'topic_id' => 'integer',
        'tags' => 'array',
        'sort_order' => 'integer',
        'use_count' => 'integer',
        'is_active' => 'boolean',
        'last_used_at' => 'datetime',
        'deleted_at' => 'datetime',
    ];

    public function account()
    {
        return $this->belongsTo(Account::class);
    }

    public function topic()
    {
        return $this->belongsTo(QuickReplyTopic::class, 'topic_id');
    }

    public function images()
    {
        return $this->hasMany(QuickReplyImage::class)->orderBy('sort_order')->orderBy('id');
    }

    public function contents()
    {
        return $this->hasMany(QuickReplyContent::class)->orderBy('position')->orderBy('id');
    }
}
