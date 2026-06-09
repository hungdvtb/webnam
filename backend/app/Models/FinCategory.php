<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class FinCategory extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'type', 'color', 'sort_order'];

    public static function nextSortOrder(): int
    {
        return ((int) static::query()->max('sort_order')) + 1;
    }

    public function transactions()
    {
        return $this->hasMany(FinTransaction::class);
    }
}
