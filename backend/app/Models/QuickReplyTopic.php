<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class QuickReplyTopic extends Model
{
    protected $fillable = [
        'account_id',
        'name',
        'slug',
        'color',
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

    public function replies()
    {
        return $this->hasMany(QuickReply::class, 'topic_id');
    }
}
