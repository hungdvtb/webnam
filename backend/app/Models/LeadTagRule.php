<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class LeadTagRule extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'tag',
        'match_type',
        'pattern',
        'priority',
        'notes',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];
}
