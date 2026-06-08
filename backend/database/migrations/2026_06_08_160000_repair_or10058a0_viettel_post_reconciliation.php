<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('shipments') || !Schema::hasTable('shipment_reconciliations')) {
            return;
        }

        $shipment = DB::table('shipments')
            ->where('order_code', 'OR10058A0')
            ->where(function ($query) {
                $query->where('tracking_number', '139763959535')
                    ->orWhere('carrier_tracking_code', '139763959535');
            })
            ->first();

        if (!$shipment) {
            return;
        }

        $systemCodAmount = round((float) $shipment->cod_amount, 2);
        $systemExpectedAmount = round((float) $shipment->actual_received_amount, 2);

        if ($systemCodAmount <= 0) {
            return;
        }

        $reconciliation = DB::table('shipment_reconciliations')
            ->where('shipment_id', $shipment->id)
            ->where('carrier_code', 'viettel_post')
            ->where('status', 'received_cod')
            ->where('actual_received_amount', '<', 0)
            ->where('cod_amount', '<', 100000)
            ->orderByDesc('id')
            ->first();

        if (!$reconciliation) {
            return;
        }

        $totalFee = round((float) $reconciliation->shipping_fee, 2);
        $receivedAmount = round($systemCodAmount - $totalFee, 2);
        $diffAmount = round($receivedAmount - $systemExpectedAmount, 2);
        $now = now();

        DB::table('shipment_reconciliations')
            ->where('id', $reconciliation->id)
            ->update([
                'cod_amount' => $systemCodAmount,
                'actual_received_amount' => $receivedAmount,
                'system_expected_amount' => $systemExpectedAmount,
                'diff_amount' => $diffAmount,
                'note' => 'Doi soat VTP da sua COD import loi. Ma VD: 139763959535. '
                    . 'COD: ' . number_format($systemCodAmount) . 'd. '
                    . 'Tong phi: ' . number_format($totalFee) . 'd. '
                    . 'Tien ve: ' . number_format($receivedAmount) . 'd.',
                'updated_at' => $now,
            ]);

        DB::table('shipments')
            ->where('id', $shipment->id)
            ->update([
                'reconciled_amount' => $receivedAmount,
                'reconciliation_diff_amount' => $diffAmount,
                'reconciliation_status' => 'received_cod',
                'updated_at' => $now,
            ]);
    }

    public function down(): void
    {
        // Intentionally no-op: do not reintroduce incorrect reconciliation data.
    }
};
