<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShipmentReconciliation extends Model
{
    protected $fillable = [
        'shipment_id', 'reconciliation_code', 'carrier_code',
        'cod_amount', 'shipping_fee', 'service_fee', 'return_fee',
        'actual_received_amount', 'system_expected_amount', 'diff_amount',
        'status', 'note', 'reconciled_by', 'reconciled_at',
    ];

    protected $casts = [
        'cod_amount' => 'decimal:2',
        'shipping_fee' => 'decimal:2',
        'service_fee' => 'decimal:2',
        'return_fee' => 'decimal:2',
        'actual_received_amount' => 'decimal:2',
        'system_expected_amount' => 'decimal:2',
        'diff_amount' => 'decimal:2',
        'reconciled_at' => 'datetime',
    ];

    public function shipment()
    {
        return $this->belongsTo(Shipment::class);
    }

    public function reconciledByUser()
    {
        return $this->belongsTo(User::class, 'reconciled_by');
    }
}
