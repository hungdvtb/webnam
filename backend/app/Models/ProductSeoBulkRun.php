<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ProductSeoBulkRun extends Model
{
    public const STATUS_QUEUED = 'queued';
    public const STATUS_RUNNING = 'running';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_COMPLETED_WITH_ERRORS = 'completed_with_errors';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'account_id',
        'created_by',
        'status',
        'total_items',
        'queued_items',
        'processing_items',
        'completed_items',
        'retrying_items',
        'failed_items',
        'max_attempts',
        'ai_model',
        'custom_instruction',
        'started_at',
        'finished_at',
        'summary',
        'errors',
        'metadata',
    ];

    protected $casts = [
        'account_id' => 'integer',
        'created_by' => 'integer',
        'total_items' => 'integer',
        'queued_items' => 'integer',
        'processing_items' => 'integer',
        'completed_items' => 'integer',
        'retrying_items' => 'integer',
        'failed_items' => 'integer',
        'max_attempts' => 'integer',
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

    public function items(): HasMany
    {
        return $this->hasMany(ProductSeoBulkRunItem::class)->orderBy('position')->orderBy('id');
    }
}
