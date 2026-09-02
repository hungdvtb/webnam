<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

class AccountUser extends Pivot
{
    protected $table = 'account_user';

    public $incrementing = true;

    protected $fillable = [
        'account_id',
        'user_id',
        'role',
        'permission_label',
        'status',
        'permissions',
        'data_permissions',
    ];

    protected $casts = [
        'status' => 'integer',
        'permissions' => 'array',
        'data_permissions' => 'array',
    ];
}
