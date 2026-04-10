<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductSeoBulkRunItem extends Model
{
    public const STATUS_QUEUED = 'queued';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_RETRYING = 'retrying';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'product_seo_bulk_run_id',
        'product_id',
        'position',
        'product_name',
        'product_sku',
        'status',
        'attempt_count',
        'max_attempts',
        'error_code',
        'last_error',
        'retryable',
        'next_retry_at',
        'last_model',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'product_seo_bulk_run_id' => 'integer',
        'product_id' => 'integer',
        'position' => 'integer',
        'attempt_count' => 'integer',
        'max_attempts' => 'integer',
        'retryable' => 'boolean',
        'next_retry_at' => 'datetime',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function run(): BelongsTo
    {
        return $this->belongsTo(ProductSeoBulkRun::class, 'product_seo_bulk_run_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
