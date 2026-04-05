<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class OrderAiTrainingDataset extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'rule_key',
        'altar_size_label',
        'altar_size_aliases',
        'context_aliases',
        'input_type',
        'source_name',
        'training_note',
        'input_text',
        'input_image_path',
        'input_image_mime',
        'parsed_result',
        'parsed_raw_text',
        'parsed_provider',
        'trained_at',
    ];

    protected $casts = [
        'altar_size_aliases' => 'array',
        'context_aliases' => 'array',
        'parsed_result' => 'array',
        'trained_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(OrderAiTrainingDatasetItem::class, 'dataset_id')
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    protected function asJson($value, $flags = 0)
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }
}
