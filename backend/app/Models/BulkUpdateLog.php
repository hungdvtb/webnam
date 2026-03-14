<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BulkUpdateLog extends Model
{
    protected $fillable = ['batch_name', 'original_data', 'product_count'];

    protected $casts = [
        'original_data' => 'array',
    ];
}
