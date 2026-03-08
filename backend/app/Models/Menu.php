<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Menu extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = ['account_id', 'name', 'code', 'is_active'];

    public function items()
    {
        return $this->hasMany(MenuItem::class)->orderBy('order');
    }

    public function rootItems()
    {
        return $this->hasMany(MenuItem::class)->whereNull('parent_id')->orderBy('order');
    }
}
