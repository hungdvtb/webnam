<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Supplier extends Model
{
    use \App\Traits\BelongsToAccount;
    use SoftDeletes;

    protected $fillable = [
        'account_id',
        'code',
        'name',
        'phone',
        'email',
        'address',
        'notes',
        'status',
    ];

    protected $casts = [
        'status' => 'boolean',
    ];

    public function prices()
    {
        return $this->hasMany(SupplierProductPrice::class);
    }

    public function imports()
    {
        return $this->hasMany(InventoryImport::class);
    }
}
