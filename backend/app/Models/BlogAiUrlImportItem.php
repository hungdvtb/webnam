<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BlogAiUrlImportItem extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'blog_ai_bulk_job_id',
        'position',
        'source_url',
        'source_hash',
        'source_title',
        'status',
        'post_id',
        'generated_title',
        'last_model',
        'source_brief',
        'last_error',
        'metadata',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'blog_ai_bulk_job_id' => 'integer',
        'position' => 'integer',
        'post_id' => 'integer',
        'metadata' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(BlogAiBulkJob::class, 'blog_ai_bulk_job_id');
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }
}
