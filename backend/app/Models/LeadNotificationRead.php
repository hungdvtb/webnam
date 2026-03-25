<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LeadNotificationRead extends Model
{
    protected $fillable = [
        'account_id',
        'lead_id',
        'user_id',
        'read_at',
    ];

    protected $casts = [
        'read_at' => 'datetime',
    ];

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
