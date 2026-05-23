<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $fillable = [
        'user_id',
        'account_id',
        'action',
        'module',
        'entity_type',
        'entity_id',
        'method',
        'path',
        'before',
        'after',
        'response_status',
        'ip_address',
        'user_agent',
    ];

    protected $casts = [
        'before' => 'array',
        'after' => 'array',
        'response_status' => 'integer',
    ];
}
