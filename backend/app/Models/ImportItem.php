<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ImportItem extends Model
{
    use \App\Traits\BelongsToAccount;

    protected $fillable = [
        'account_id',
        'import_id',
        'product_id',
        'supplier_product_price_id',
        'product_name_snapshot',
        'product_sku_snapshot',
        'supplier_product_code_snapshot',
        'unit_name_snapshot',
        'quantity',
        'received_quantity',
        'unit_cost',
        'supplier_price_snapshot',
        'price_was_updated',
        'line_total',
        'notes',
        'sort_order',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'received_quantity' => 'integer',
        'unit_cost' => 'decimal:2',
        'supplier_price_snapshot' => 'decimal:2',
        'line_total' => 'decimal:2',
        'price_was_updated' => 'boolean',
    ];

    public function import()
    {
        return $this->belongsTo(InventoryImport::class, 'import_id');
    }

    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    public function batch()
    {
        return $this->hasOne(InventoryBatch::class, 'import_item_id');
    }

    public function supplierPrice()
    {
        return $this->belongsTo(SupplierProductPrice::class, 'supplier_product_price_id');
    }
}
