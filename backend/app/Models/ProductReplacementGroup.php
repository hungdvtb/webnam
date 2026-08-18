<?php

namespace App\Models;

use App\Traits\BelongsToAccount;
use Illuminate\Database\Eloquent\Model;

class ProductReplacementGroup extends Model
{
    use BelongsToAccount;

    protected static string $accountScopeType = 'catalog';

    protected $fillable = [
        'account_id',
        'name',
        'notes',
    ];

    public function items()
    {
        return $this->hasMany(ProductReplacementItem::class, 'group_id')
            ->orderBy('sort_order')
            ->orderBy('id');
    }
}
