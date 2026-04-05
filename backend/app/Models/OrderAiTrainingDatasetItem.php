<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderAiTrainingDatasetItem extends Model
{
    protected $fillable = [
        'dataset_id',
        'aliases',
        'default_quantity',
        'target_product_id',
        'parent_product_id',
        'entry_kind',
        'display_name',
        'display_sku',
        'option_label',
        'main_image',
        'price',
        'cost_price',
        'sort_order',
    ];

    protected $casts = [
        'aliases' => 'array',
        'default_quantity' => 'integer',
        'target_product_id' => 'integer',
        'parent_product_id' => 'integer',
        'price' => 'decimal:2',
        'cost_price' => 'decimal:2',
        'sort_order' => 'integer',
    ];

    public function dataset(): BelongsTo
    {
        return $this->belongsTo(OrderAiTrainingDataset::class, 'dataset_id');
    }

    protected function asJson($value, $flags = 0)
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }
}
