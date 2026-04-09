<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BlogAiBulkJobLog extends Model
{
    protected $fillable = [
        'blog_ai_bulk_job_id',
        'level',
        'step',
        'message',
        'context',
    ];

    protected $casts = [
        'blog_ai_bulk_job_id' => 'integer',
        'context' => 'array',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(BlogAiBulkJob::class, 'blog_ai_bulk_job_id');
    }
}
