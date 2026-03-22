<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class FinanceChangeLog extends Model
{
    use BelongsToAccount;

    public $timestamps = false;

    protected $fillable = [
        'account_id',
        'changed_by',
        'subject_type',
        'subject_id',
        'action',
        'before_data',
        'after_data',
        'created_at',
    ];

    protected $casts = [
        'before_data' => 'array',
        'after_data' => 'array',
        'created_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
