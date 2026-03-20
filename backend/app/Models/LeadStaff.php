<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class LeadStaff extends Model
{
    use BelongsToAccount;

    protected $table = 'lead_staffs';

    protected $fillable = [
        'account_id',
        'user_id',
        'name',
        'sort_order',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
