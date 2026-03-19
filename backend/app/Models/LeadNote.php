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
