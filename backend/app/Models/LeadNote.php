<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class LeadNote extends Model
{
    use BelongsToAccount;

    protected $fillable = [
        'account_id',
        'lead_id',
        'user_id',
        'staff_name',
        'content',
        'activity_type',
        'next_follow_up_at',
        'potential_level',
        'lead_status_id',
        'assigned_staff_id',
    ];

    protected $casts = [
        'next_follow_up_at' => 'datetime',
    ];

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function statusConfig()
    {
        return $this->belongsTo(LeadStatus::class, 'lead_status_id');
    }

    public function assignedStaff()
    {
        return $this->belongsTo(LeadStaff::class, 'assigned_staff_id');
    }
}
