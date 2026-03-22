<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupplierProductPrice extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'supplier_id',
        'product_id',
        'supplier_product_code',
        'unit_cost',
        'notes',
        'updated_by',
    ];

    protected $casts = [
        'unit_cost' => 'decimal:2',
    ];

    public function supplier()
    {
        return $this->belongsTo(Supplier::class)->withTrashed();
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function updater()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
