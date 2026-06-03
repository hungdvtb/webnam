<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BlogAiBulkJob extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_SCANNING = 'scanning';
    public const STATUS_SCANNED = 'scanned';
    public const STATUS_RUNNING = 'running';
    public const STATUS_PAUSED = 'paused';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_COMPLETED_WITH_ERRORS = 'completed_with_errors';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'account_id',
        'created_by',
        'status',
        'source_filename',
        'source_disk',
        'source_path',
        'total_keywords',
        'unique_keywords',
        'cluster_count',
        'processed_clusters',
        'categories_created',
        'posts_created',
        'posts_failed',
        'ai_model',
        'started_at',
        'finished_at',
        'summary',
        'errors',
        'metadata',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'created_by' => 'integer',
        'total_keywords' => 'integer',
        'unique_keywords' => 'integer',
        'cluster_count' => 'integer',
        'processed_clusters' => 'integer',
        'categories_created' => 'integer',
        'posts_created' => 'integer',
        'posts_failed' => 'integer',
        'summary' => 'array',
        'errors' => 'array',
        'metadata' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function logs(): HasMany
    {
        return $this->hasMany(BlogAiBulkJobLog::class)->orderBy('id');
    }

    public function urlImportItems(): HasMany
    {
        return $this->hasMany(BlogAiUrlImportItem::class)->orderBy('position')->orderBy('id');
    }
}
