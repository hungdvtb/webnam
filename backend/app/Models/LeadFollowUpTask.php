<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class LeadFollowUpTask extends Model
{
    use BelongsToAccount;

    public const STATUS_PENDING = 'pending';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_STOPPED = 'stopped';

    public const TYPE_NEW = 'new';
    public const TYPE_THREE_DAYS = '3_days';
    public const TYPE_SEVEN_DAYS = '7_days';

    protected $fillable = [
        'account_id',
        'lead_id',
        'task_type',
        'due_date',
        'status',
        'completed_at',
        'completed_by',
        'completed_activity_type',
    ];

    protected $casts = [
        'due_date' => 'date',
        'completed_at' => 'datetime',
    ];

    public function lead()
    {
        return $this->belongsTo(Lead::class);
    }

    public function completedBy()
    {
        return $this->belongsTo(User::class, 'completed_by');
    }
}
