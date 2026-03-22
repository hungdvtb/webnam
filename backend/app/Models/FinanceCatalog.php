<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class FinanceCatalog extends Model
{
    use BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'group_key',
        'code',
        'name',
        'color',
        'is_system',
        'is_active',
        'sort_order',
        'meta',
    ];

    protected $casts = [
        'is_system' => 'boolean',
        'is_active' => 'boolean',
        'meta' => 'array',
    ];

    public function transactions()
    {
        return $this->hasMany(FinanceTransaction::class, 'category_id');
    }

    public function fixedExpenses()
    {
        return $this->hasMany(FinanceFixedExpense::class, 'category_id');
    }
}
