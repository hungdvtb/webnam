<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MetaCatalogSyncLog extends Model
{
    protected $fillable = [
        'account_id',
        'user_id',
        'operation',
        'status',
        'total_products',
        'valid_products',
        'invalid_products',
        'success_count',
        'error_count',
        'create_count',
        'update_count',
        'delete_count',
        'fallback_count',
        'duration_ms',
        'summary',
        'error_message',
        'details',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'total_products' => 'integer',
        'valid_products' => 'integer',
        'invalid_products' => 'integer',
        'success_count' => 'integer',
        'error_count' => 'integer',
        'create_count' => 'integer',
        'update_count' => 'integer',
        'delete_count' => 'integer',
        'fallback_count' => 'integer',
        'duration_ms' => 'integer',
        'details' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function account()
    {
        return $this->belongsTo(Account::class);
    }
}
