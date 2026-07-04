<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FinCategory extends Model
{
    use HasFactory;

    protected $fillable = ['account_id', 'name', 'type', 'color', 'sort_order'];

    public static function nextSortOrder(?int $accountId = null): int
    {
        return ((int) static::query()
            ->when($accountId !== null, fn ($query) => $query->where('account_id', $accountId))
            ->max('sort_order')) + 1;
    }

    public function transactions()
    {
        return $this->hasMany(FinTransaction::class);
    }
}
