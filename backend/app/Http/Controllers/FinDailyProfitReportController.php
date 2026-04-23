<?php

namespace App\Http\Controllers;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\InventoryDocument;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FinDailyProfitReportController extends Controller
{
    private const MONTHLY_REPORT_INCLUDED_STATUS = 'completed';
    private const MONTHLY_REPORT_TAX_RATE = 1.5;
    private const EXCLUDED_ORDER_STATUSES = ['cancelled', 'canceled'];
    private const MONTHLY_REPORT_COST_FIELDS = [
        'cost_actual',
        'shipping_fee',
        'damaged_goods',
        'salary',
        'packaging_fee',
        'ads_spend',
        'tax',
        'fixed_cost',
    ];
    private const MONTHLY_REPORT_ROUNDED_FIELDS = [
        'revenue',
        'cost_actual',
        'shipping_fee',
        'damaged_goods',
        'exchange_profit_loss',
        'partial_delivery_profit_loss',
        'salary',
        'packaging_fee',
        'ads_spend_raw',
        'ads_spend',
        'tax',
        'fixed_cost',
        'total_profit',
        'profit_per_house',
    ];

    public function getConfig()
    {
        $config = FinDailyReportConfig::first();

        if (!$config) {
            $config = FinDailyReportConfig::create([
                'return_rate' => 2.00,
                'packaging_fee' => 2000.00,
                'shipping_estimate_rate' => 10.00,
                'tax_rate' => 1.50,
            ]);
        }

        return response()->json(['status' => 'success', 'data' => $config]);
    }

    public function updateConfig(Request $request)
    {
        $config = FinDailyReportConfig::first();
        if (!$config) {
            $config = new FinDailyReportConfig();
        }

        $data = $request->only([
            'return_rate',
            'packaging_fee',
            'shipping_estimate_rate',
            'tax_rate',
            'shipping_fee_type',
            'fb_access_token',
            'fb_ad_account_ids',
            'fb_tax_rate',
            'fb_tokens_configs',
        ]);

        $config->fill($data);
        $config->save();

        return response()->json([
            'status' => 'success',
            'data' => $config,
            'message' => 'Cập nhật cấu hình thành công',
        ]);
    }

    private function dailyAdsSpendTotalsByDate(string $startDate, string $endDate): array
    {
        return DailyAdsSpend::query()
            ->whereBetween('date', [$startDate, $endDate])
            ->select('date', DB::raw('ROUND(SUM(COALESCE(amount, 0)), 2) as total_amount'))
            ->groupBy('date')
            ->pluck('total_amount', 'date')
            ->map(fn ($amount) => (float) $amount)
            ->toArray();
    }

    private function buildDailyReportPayload(string $startDate, string $endDate): array
    {
        $config = FinDailyReportConfig::first();
        $returnRate = $config ? (float) $config->return_rate : 2.0;
        $packFee = $config ? (float) $config->packaging_fee : 2000.0;
        $shipEstRate = $config ? (float) $config->shipping_estimate_rate : 10.0;
        $shipFeeType = $config ? $config->shipping_fee_type : '%';
        $taxRate = $config ? (float) $config->tax_rate : 1.5;

        $dataRaw = Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where(function ($query) {
                $query->where('order_kind', 'official')
                    ->orWhereNull('order_kind');
            })
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
            ->select(
                DB::raw('DATE(officialized_at) as date'),
                DB::raw('COUNT(*) as order_count'),
                DB::raw("SUM(CASE WHEN order_type NOT IN ('exchange_return', 'partial_delivery') THEN total_price ELSE 0 END) as revenue_total"),
                DB::raw("SUM(CASE WHEN order_type NOT IN ('exchange_return', 'partial_delivery') THEN cost_total ELSE 0 END) as cost_total"),
                DB::raw("SUM(CASE WHEN order_type IN ('exchange_return', 'partial_delivery') THEN shipping_fee ELSE 0 END) as shipping_explicit"),
                DB::raw("SUM(CASE WHEN order_type = 'exchange_return' THEN COALESCE(report_profit_total, 0) ELSE 0 END) as exchange_profit_loss"),
                DB::raw("SUM(CASE WHEN order_type = 'partial_delivery' THEN COALESCE(report_profit_total, 0) ELSE 0 END) as partial_delivery_profit_loss")
            )
            ->groupBy('date')
            ->get()
            ->keyBy('date');

        $fixedCosts = \App\Models\FixedCostDailySnapshot::query()
            ->whereBetween('date', [$startDate, $endDate])
            ->pluck('amount', 'date')
            ->toArray();

        $adsSpends = $this->dailyAdsSpendTotalsByDate($startDate, $endDate);

        $report = [];
        $period = \Carbon\CarbonPeriod::create($startDate, $endDate);
        $dates = array_reverse(array_map(
            fn ($date) => $date->format('Y-m-d'),
            iterator_to_array($period)
        ));

        foreach ($dates as $dateStr) {
            $dayData = $dataRaw->get($dateStr);

            $revenueRaw = $dayData ? (float) $dayData->revenue_total : 0;
            $orderCount = $dayData ? (int) $dayData->order_count : 0;
            $costRaw = $dayData ? (float) $dayData->cost_total : 0;

            $estimatedReturns = $revenueRaw * ($returnRate / 100);
            $revenueActual = $revenueRaw - $estimatedReturns;
            $costActual = $costRaw * (1 - $returnRate / 100);

            $dailyShip = 0;
            $standardOrderCount = 0;

            if ($dayData) {
                $ordersOfDay = Order::query()
                    ->whereDate('officialized_at', $dateStr)
                    ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
                    ->where(function ($query) {
                        $query->where('order_kind', 'official')
                            ->orWhereNull('order_kind');
                    })
                    ->where(function ($query) {
                        $query->whereNotIn('order_type', ['exchange_return', 'partial_delivery'])
                            ->orWhereNull('order_type');
                    })
                    ->get();

                $dailyShip = $ordersOfDay->sum(function ($order) use ($shipEstRate, $shipFeeType) {
                    $shipValue = (float) $order->shipping_fee;
                    if ($shipValue > 0) {
                        return $shipValue;
                    }

                    if ($shipFeeType === 'fixed') {
                        return $shipEstRate;
                    }

                    return (float) $order->total_price * $shipEstRate / 100;
                });

                $standardOrderCount = $ordersOfDay->count();
            }

            $avgShipSent = $standardOrderCount > 0 ? ($dailyShip / $standardOrderCount) : 0;
            $returnedOrdersCount = $orderCount * ($returnRate / 100);
            $returnedShipFee = round($returnedOrdersCount * ($avgShipSent * 0.5));
            $shippingFee = $dailyShip + $returnedShipFee;

            $packagingFee = $orderCount * $packFee;
            $tax = ($taxRate / 100) * ($revenueActual - $shippingFee);
            $fixedCostDaily = isset($fixedCosts[$dateStr]) ? (float) $fixedCosts[$dateStr] : 0;

            $fbTaxRate = $config ? (float) $config->fb_tax_rate : 0;
            $adsSpendRawDaily = round((float) ($adsSpends[$dateStr] ?? 0), 2);
            $adsSpendDaily = round($adsSpendRawDaily * (1 + $fbTaxRate / 100), 2);

            $profitFromNewOrders = $revenueActual - $costActual - $shippingFee - $packagingFee - $tax - $fixedCostDaily - $adsSpendDaily;
            $exchangeProfitLoss = $dayData ? (float) $dayData->exchange_profit_loss : 0;
            $partialDeliveryProfitLoss = $dayData ? (float) $dayData->partial_delivery_profit_loss : 0;
            $extraProfit = $exchangeProfitLoss + $partialDeliveryProfitLoss;
            $profit = $profitFromNewOrders + $extraProfit;

            $report[] = [
                'date' => $dateStr,
                'order_count' => $orderCount,
                'revenue_raw' => $revenueRaw,
                'revenue_actual' => $revenueActual,
                'cost_raw' => $costRaw,
                'cost_actual' => $costActual,
                'shipping_fee' => $shippingFee,
                'shipping_out' => $dailyShip,
                'shipping_return' => $returnedShipFee,
                'packaging_fee' => $packagingFee,
                'tax' => $tax,
                'fixed_cost' => $fixedCostDaily,
                'ads_spend_raw' => $adsSpendRawDaily,
                'ads_spend' => $adsSpendDaily,
                'exchange_profit_loss' => $exchangeProfitLoss,
                'partial_delivery_profit_loss' => $partialDeliveryProfitLoss,
                'extra_profit' => $extraProfit,
                'profit' => $profit,
                'percent_revenue_actual' => $revenueRaw > 0 ? ($revenueActual / $revenueRaw * 100) : 0,
                'percent_cost_raw' => $revenueRaw > 0 ? ($costRaw / $revenueRaw * 100) : 0,
                'percent_cost' => $revenueRaw > 0 ? ($costActual / $revenueRaw * 100) : 0,
                'percent_ship' => $revenueRaw > 0 ? ($shippingFee / $revenueRaw * 100) : 0,
                'percent_pack' => $revenueRaw > 0 ? ($packagingFee / $revenueRaw * 100) : 0,
                'percent_tax' => $revenueRaw > 0 ? ($tax / $revenueRaw * 100) : 0,
                'percent_ads' => $revenueRaw > 0 ? ($adsSpendDaily / $revenueRaw * 100) : 0,
                'percent_profit' => $revenueRaw > 0 ? ($profit / $revenueRaw * 100) : 0,
            ];
        }

        $reportCollection = collect($report);

        return [
            'data' => $report,
            'summary' => [
                'total_profit' => round((float) $reportCollection->sum('profit'), 2),
                'total_revenue' => round((float) $reportCollection->sum('revenue_raw'), 2),
                'total_orders' => (int) $reportCollection->sum('order_count'),
            ],
        ];
    }

    private function makeMonthlyReportRow(string $monthKey): array
    {
        [$year, $month] = explode('-', $monthKey);

        return [
            'key' => $monthKey,
            'month' => sprintf('Tháng %d/%d', (int) $month, (int) $year),
            'order_count' => 0,
            'revenue' => 0,
            'cost_actual' => 0,
            'shipping_fee' => 0,
            'damaged_goods' => 0,
            'exchange_profit_loss' => 0,
            'partial_delivery_profit_loss' => 0,
            'salary' => 0,
            'packaging_fee' => 0,
            'ads_spend_raw' => 0,
            'ads_spend' => 0,
            'tax' => 0,
            'fixed_cost' => 0,
            'total_profit' => 0,
            'profit_per_house' => 0,
        ];
    }

    private function monthlyReportOrderTimestamp(Order $order): ?\Carbon\Carbon
    {
        $officializedAt = $order->officialized_at;

        if ($officializedAt instanceof \Carbon\Carbon) {
            return $officializedAt;
        }

        if ($officializedAt instanceof \DateTimeInterface) {
            return \Carbon\Carbon::instance($officializedAt);
        }

        if ($officializedAt) {
            return \Carbon\Carbon::parse($officializedAt);
        }

        $createdAt = $order->created_at;

        if ($createdAt instanceof \Carbon\Carbon) {
            return $createdAt;
        }

        if ($createdAt instanceof \DateTimeInterface) {
            return \Carbon\Carbon::instance($createdAt);
        }

        return $createdAt ? \Carbon\Carbon::parse($createdAt) : null;
    }

    private function monthlySpecialOrderProfitLoss(string $startDate, string $endDate)
    {
        $startAt = $startDate . ' 00:00:00';
        $endAt = $endDate . ' 23:59:59';

        return Order::query()
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->where(function ($query) use ($startAt, $endAt) {
                $query->whereBetween('officialized_at', [$startAt, $endAt])
                    ->orWhere(function ($fallbackQuery) use ($startAt, $endAt) {
                        $fallbackQuery->whereNull('officialized_at')
                            ->whereBetween('created_at', [$startAt, $endAt]);
                    });
            })
            ->whereIn('order_type', [
                Order::TYPE_EXCHANGE_RETURN,
                Order::TYPE_PARTIAL_DELIVERY,
            ])
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
            ->get([
                'order_type',
                'report_profit_total',
                'officialized_at',
                'created_at',
            ])
            ->groupBy(function (Order $order) {
                return $this->monthlyReportOrderTimestamp($order)?->format('Y-m');
            })
            ->filter(fn ($orders, $monthKey) => !empty($monthKey))
            ->map(function ($orders) {
                return [
                    'exchange_profit_loss' => round((float) $orders
                        ->where('order_type', Order::TYPE_EXCHANGE_RETURN)
                        ->sum(fn (Order $order) => (float) ($order->report_profit_total ?? 0)), 2),
                    'partial_delivery_profit_loss' => round((float) $orders
                        ->where('order_type', Order::TYPE_PARTIAL_DELIVERY)
                        ->sum(fn (Order $order) => (float) ($order->report_profit_total ?? 0)), 2),
                ];
            });
    }

    private function calculateMonthlyTotalCosts(array $row): float
    {
        return round((float) collect(self::MONTHLY_REPORT_COST_FIELDS)
            ->sum(fn (string $field) => (float) ($row[$field] ?? 0)), 2);
    }

    private function calculateMonthlyTotalProfit(array $row): float
    {
        $specialProfit = round(
            (float) ($row['exchange_profit_loss'] ?? 0)
            + (float) ($row['partial_delivery_profit_loss'] ?? 0),
            2
        );

        return round(
            (float) ($row['revenue'] ?? 0)
            - $this->calculateMonthlyTotalCosts($row)
            + $specialProfit,
            2
        );
    }

    private function finalizeMonthlyReportRow(array $row): array
    {
        foreach (self::MONTHLY_REPORT_ROUNDED_FIELDS as $field) {
            if ($field === 'total_profit' || $field === 'profit_per_house') {
                continue;
            }

            $row[$field] = round((float) ($row[$field] ?? 0), 2);
        }

        $row['total_profit'] = $this->calculateMonthlyTotalProfit($row);
        $row['profit_per_house'] = round((float) $row['total_profit'] / 2, 2);

        return $row;
    }

    private function buildMonthlySummary($rows): array
    {
        $totalRevenue = round((float) $rows->sum('revenue'), 2);
        $totalOrders = (int) $rows->sum('order_count');

        $summary = [
            'order_count' => $totalOrders,
            'revenue' => $totalRevenue,
            'cost_actual' => round((float) $rows->sum('cost_actual'), 2),
            'shipping_fee' => round((float) $rows->sum('shipping_fee'), 2),
            'damaged_goods' => round((float) $rows->sum('damaged_goods'), 2),
            'exchange_profit_loss' => round((float) $rows->sum('exchange_profit_loss'), 2),
            'partial_delivery_profit_loss' => round((float) $rows->sum('partial_delivery_profit_loss'), 2),
            'salary' => round((float) $rows->sum('salary'), 2),
            'packaging_fee' => round((float) $rows->sum('packaging_fee'), 2),
            'ads_spend_raw' => round((float) $rows->sum('ads_spend_raw'), 2),
            'ads_spend' => round((float) $rows->sum('ads_spend'), 2),
            'tax' => round((float) $rows->sum('tax'), 2),
            'fixed_cost' => round((float) $rows->sum('fixed_cost'), 2),
            'total_revenue' => $totalRevenue,
            'total_tax' => round((float) $rows->sum('tax'), 2),
            'total_orders' => $totalOrders,
        ];

        return $this->finalizeMonthlyReportRow($summary);
    }

    private function hasMonthlyActivity(array $row): bool
    {
        return (int) ($row['order_count'] ?? 0) !== 0
            || (float) ($row['revenue'] ?? 0) !== 0.0
            || (float) ($row['cost_actual'] ?? 0) !== 0.0
            || (float) ($row['shipping_fee'] ?? 0) !== 0.0
            || (float) ($row['damaged_goods'] ?? 0) !== 0.0
            || (float) ($row['exchange_profit_loss'] ?? 0) !== 0.0
            || (float) ($row['partial_delivery_profit_loss'] ?? 0) !== 0.0
            || (float) ($row['salary'] ?? 0) !== 0.0
            || (float) ($row['packaging_fee'] ?? 0) !== 0.0
            || (float) ($row['ads_spend_raw'] ?? 0) !== 0.0
            || (float) ($row['ads_spend'] ?? 0) !== 0.0
            || (float) ($row['tax'] ?? 0) !== 0.0
            || (float) ($row['fixed_cost'] ?? 0) !== 0.0
            || (float) ($row['total_profit'] ?? 0) !== 0.0;
    }

    private function successfulOrdersForMonthlyReport(string $startDate, string $endDate)
    {
        return Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where('status', self::MONTHLY_REPORT_INCLUDED_STATUS)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });
    }

    private function shippingOrdersForMonthlyReport(string $startDate, string $endDate)
    {
        return Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });
    }

    private function successfulStandardOrdersForMonthlyReport(string $startDate, string $endDate)
    {
        return $this->successfulOrdersForMonthlyReport($startDate, $endDate)
            ->where(function ($query) {
                $query->where('order_type', Order::TYPE_STANDARD)
                    ->orWhereNull('order_type')
                    ->orWhere('order_type', '');
            });
    }

    private function monthlyRevenueAndCostActual(string $startDate, string $endDate)
    {
        return $this->successfulStandardOrdersForMonthlyReport($startDate, $endDate)
            ->get([
                'officialized_at',
                'total_price',
                'cost_total',
                'report_revenue_total',
                'report_cost_total',
            ])
            ->groupBy(fn (Order $order) => optional($order->officialized_at)?->format('Y-m'))
            ->map(function ($orders) {
                $revenue = round((float) $orders->sum(
                    fn (Order $order) => (float) ($order->report_revenue_total ?? $order->total_price ?? 0)
                ), 2);

                $costRaw = round((float) $orders->sum(
                    fn (Order $order) => (float) ($order->report_cost_total ?? $order->cost_total ?? 0)
                ), 2);

                return [
                    'revenue' => $revenue,
                    'cost_actual' => $costRaw,
                ];
            });
    }

    private function resolveMonthlyReportShippingFee(Order $order): float
    {
        $storedShippingFee = max(0, round((float) ($order->internal_shipping_fee ?? 0), 2));
        $activeShipmentFee = max(0, round((float) ($order->activeShipment?->shipping_cost ?? 0), 2));
        $outsideDeliveryFee = max(0, round((float) data_get($order->external_delivery_meta, 'shipping_cost', 0), 2));

        $resolvedShippingFee = max($storedShippingFee, $activeShipmentFee, $outsideDeliveryFee);

        if ($resolvedShippingFee > 0) {
            return $resolvedShippingFee;
        }

        return round((float) ($order->total_price ?? 0) * 0.05, 2);
    }

    private function monthlyOrderShippingFee(string $startDate, string $endDate)
    {
        return $this->shippingOrdersForMonthlyReport($startDate, $endDate)
            ->with(['activeShipment:id,order_id,shipping_cost'])
            ->get([
                'officialized_at',
                'internal_shipping_fee',
                'external_delivery_meta',
                'total_price',
            ])
            ->groupBy(fn (Order $order) => optional($order->officialized_at)?->format('Y-m'))
            ->map(function ($orders) {
                return [
                    'shipping_fee' => round((float) $orders->sum(
                        fn (Order $order) => $this->resolveMonthlyReportShippingFee($order)
                    ), 2),
                ];
            });
    }

    private function monthlySuccessfulOrderRevenueShippingAndTax(string $startDate, string $endDate, float $taxRate)
    {
        return $this->successfulOrdersForMonthlyReport($startDate, $endDate)
            ->with(['activeShipment:id,order_id,shipping_cost'])
            ->get([
                'officialized_at',
                'report_revenue_total',
                'internal_shipping_fee',
                'external_delivery_meta',
                'total_price',
            ])
            ->groupBy(fn (Order $order) => optional($order->officialized_at)?->format('Y-m'))
            ->map(function ($orders) use ($taxRate) {
                $revenue = round((float) $orders->sum(
                    fn (Order $order) => (float) ($order->report_revenue_total ?? $order->total_price ?? 0)
                ), 2);

                $shippingFee = round((float) $orders->sum(
                    fn (Order $order) => $this->resolveMonthlyReportShippingFee($order)
                ), 2);

                return [
                    'revenue_for_tax' => $revenue,
                    'shipping_fee' => $shippingFee,
                    'tax' => round(($revenue - $shippingFee) * ($taxRate / 100), 2),
                ];
            });
    }

    private function monthlyDamagedGoodsFromDamagedSlips(string $startDate, string $endDate)
    {
        return InventoryDocument::query()
            ->where('type', 'damaged')
            ->where('status', 'completed')
            ->whereBetween('document_date', [$startDate, $endDate])
            ->get([
                'document_date',
                'total_amount',
            ])
            ->groupBy(fn (InventoryDocument $document) => optional($document->document_date)?->format('Y-m'))
            ->map(function ($documents) {
                return [
                    'damaged_goods' => round((float) $documents->sum(
                        fn (InventoryDocument $document) => (float) ($document->total_amount ?? 0)
                    ), 2),
                ];
            });
    }

    public function getReport(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-01');
        $endDate = $request->end_date ?: date('Y-m-d');

        $payload = $this->buildDailyReportPayload($startDate, $endDate);

        return response()->json([
            'status' => 'success',
            'data' => $payload['data'],
            'summary' => $payload['summary'],
        ]);
    }

    public function getMonthlyReport(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-01-01');
        $endDate = $request->end_date ?: date('Y-m-d');

        $payload = $this->buildDailyReportPayload($startDate, $endDate);
        $config = FinDailyReportConfig::query()->first();
        $packagingFeePerOrder = $config ? (float) $config->packaging_fee : 2000.0;
        $taxRate = self::MONTHLY_REPORT_TAX_RATE;

        $monthlyRows = collect($payload['data'])
            ->filter(fn (array $row) => !empty($row['date']))
            ->groupBy(fn (array $row) => substr((string) $row['date'], 0, 7))
            ->map(function ($rows, string $monthKey) {
                $monthly = $this->makeMonthlyReportRow($monthKey);

                foreach ($rows as $row) {
                    $monthly['salary'] += (float) ($row['salary'] ?? 0);
                    $monthly['ads_spend_raw'] += (float) ($row['ads_spend_raw'] ?? 0);
                    $monthly['ads_spend'] += (float) ($row['ads_spend'] ?? 0);
                    $monthly['fixed_cost'] += (float) ($row['fixed_cost'] ?? 0);
                }

                return $monthly;
            });

        $monthlyRevenueAndCost = $this->monthlyRevenueAndCostActual($startDate, $endDate);
        $monthlyShippingFee = $this->monthlyOrderShippingFee($startDate, $endDate);
        $monthlySuccessfulOrderTotals = $this->monthlySuccessfulOrderRevenueShippingAndTax($startDate, $endDate, $taxRate);
        $monthlyDamagedGoods = $this->monthlyDamagedGoodsFromDamagedSlips($startDate, $endDate);
        $monthlySpecialOrderProfitLoss = $this->monthlySpecialOrderProfitLoss($startDate, $endDate);

        foreach ($monthlyRevenueAndCost as $monthKey => $totals) {
            if (!$monthKey) {
                continue;
            }

            $monthly = $monthlyRows->get($monthKey, $this->makeMonthlyReportRow($monthKey));
            $monthly['revenue'] = round((float) ($totals['revenue'] ?? 0), 2);
            $monthly['cost_actual'] = round((float) ($totals['cost_actual'] ?? 0), 2);
            $monthlyRows->put($monthKey, $monthly);
        }

        $shippingMonthKeys = $monthlyRows->keys()
            ->merge($monthlyShippingFee->keys())
            ->unique();

        foreach ($shippingMonthKeys as $monthKey) {
            if (!$monthKey) {
                continue;
            }

            $monthly = $monthlyRows->get($monthKey, $this->makeMonthlyReportRow($monthKey));
            $monthly['shipping_fee'] = round((float) ($monthlyShippingFee->get($monthKey)['shipping_fee'] ?? 0), 2);
            $monthlyRows->put($monthKey, $monthly);
        }

        $taxMonthKeys = $monthlyRows->keys()
            ->merge($monthlySuccessfulOrderTotals->keys())
            ->unique();

        foreach ($taxMonthKeys as $monthKey) {
            if (!$monthKey) {
                continue;
            }

            $monthly = $monthlyRows->get($monthKey, $this->makeMonthlyReportRow($monthKey));
            $totals = $monthlySuccessfulOrderTotals->get($monthKey, []);
            $monthly['tax'] = round((float) ($totals['tax'] ?? 0), 2);
            $monthlyRows->put($monthKey, $monthly);
        }

        foreach ($monthlyDamagedGoods as $monthKey => $totals) {
            if (!$monthKey) {
                continue;
            }

            $monthly = $monthlyRows->get($monthKey, $this->makeMonthlyReportRow($monthKey));
            $monthly['damaged_goods'] = round((float) ($totals['damaged_goods'] ?? 0), 2);
            $monthlyRows->put($monthKey, $monthly);
        }

        $dispatchedOrderCounts = Order::query()
            ->whereNotNull('shipping_dispatched_at')
            ->whereBetween('shipping_dispatched_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where(function ($query) {
                $query->where('order_kind', 'official')
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
            ->get(['id', 'shipping_dispatched_at'])
            ->groupBy(fn (Order $order) => optional($order->shipping_dispatched_at)?->format('Y-m'))
            ->map(fn ($orders) => $orders->count());

        foreach ($dispatchedOrderCounts as $monthKey => $count) {
            if (!$monthKey) {
                continue;
            }

            $monthly = $monthlyRows->get($monthKey, $this->makeMonthlyReportRow($monthKey));
            $monthly['order_count'] = (int) $count;
            $monthly['packaging_fee'] = round((float) $count * $packagingFeePerOrder, 2);
            $monthlyRows->put($monthKey, $monthly);
        }

        $monthlyRows = $monthlyRows->map(function (array $monthly, string $monthKey) use ($monthlySpecialOrderProfitLoss) {
            $resolvedSpecialProfit = $monthlySpecialOrderProfitLoss->get($monthKey, [
                'exchange_profit_loss' => 0,
                'partial_delivery_profit_loss' => 0,
            ]);

            $monthly['exchange_profit_loss'] = round((float) ($resolvedSpecialProfit['exchange_profit_loss'] ?? 0), 2);
            $monthly['partial_delivery_profit_loss'] = round((float) ($resolvedSpecialProfit['partial_delivery_profit_loss'] ?? 0), 2);

            return $this->finalizeMonthlyReportRow($monthly);
        });

        $rows = $monthlyRows
            ->filter(fn (array $row) => $this->hasMonthlyActivity($row))
            ->sortKeysDesc()
            ->values();

        $summary = $this->buildMonthlySummary($rows);

        return response()->json([
            'status' => 'success',
            'data' => $rows,
            'summary' => $summary,
            'meta' => [
                'order_count_basis' => 'shipping_dispatched_at',
                'special_profit_source' => 'orders.report_profit_total',
                'special_profit_month_basis' => 'officialized_at_or_created_at_fallback',
                'total_profit_formula' => 'revenue - cost_actual - shipping_fee - damaged_goods - salary - packaging_fee - ads_spend - tax - fixed_cost + exchange_profit_loss + partial_delivery_profit_loss',
            ],
        ]);
    }

    public function getFacebookAdAccounts(Request $request)
    {
        $token = $request->token;

        if (!$token) {
            $config = FinDailyReportConfig::first();
            $token = $config ? $config->fb_access_token : null;
        }

        if (!$token) {
            return response()->json(['status' => 'error', 'message' => 'Vui lòng cung cấp Access Token']);
        }

        try {
            $response = \Illuminate\Support\Facades\Http::withoutVerifying()
                ->get('https://graph.facebook.com/v19.0/me/adaccounts', [
                    'fields' => 'name,adaccount_id,id',
                    'access_token' => $token,
                    'limit' => 50,
                ]);

            if ($response->failed()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Lỗi từ Facebook: ' . ($response->json()['error']['message'] ?? 'Không xác định'),
                ]);
            }

            return response()->json([
                'status' => 'success',
                'data' => $response->json()['data'] ?? [],
            ]);
        } catch (\Exception $exception) {
            return response()->json(['status' => 'error', 'message' => $exception->getMessage()]);
        }
    }

    public function syncFacebookAds(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-d');
        $endDate = $request->end_date ?: date('Y-m-d');

        $syncService = app(\App\Services\FacebookAdsSyncService::class);
        $syncService->syncRange($startDate, $endDate);

        return response()->json([
            'status' => 'success',
            'message' => 'Đồng bộ dữ liệu Facebook Ads thành công',
            'data' => [],
        ]);
    }

    public function getFbAdSpendSplit(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-d');
        $endDate = $request->end_date ?: date('Y-m-d');

        $config = FinDailyReportConfig::first();
        if (!$config) {
            return response()->json(['status' => 'error', 'message' => 'Chưa cấu hình Facebook Ads']);
        }

        $tokenConfigs = [];
        if (!empty($config->fb_tokens_configs) && is_array($config->fb_tokens_configs)) {
            $tokenConfigs = $config->fb_tokens_configs;
        } elseif ($config->fb_access_token && $config->fb_ad_account_ids) {
            $tokenConfigs = [
                [
                    'token' => $config->fb_access_token,
                    'account_ids' => $config->fb_ad_account_ids,
                ],
            ];
        }

        if (empty($tokenConfigs)) {
            return response()->json(['status' => 'error', 'message' => 'Chưa cấu hình Facebook Access Token']);
        }

        $taxRate = (float) ($config->fb_tax_rate ?: 0);

        $dailyData = [];
        $accountsInfo = [];
        $totalRaw = 0;
        $totalTaxed = 0;

        $currentDate = strtotime($startDate);
        $endDateTime = strtotime($endDate);
        while ($currentDate <= $endDateTime) {
            $dailyPivot = date('Y-m-d', $currentDate);
            $dailyData[$dailyPivot] = [];
            $currentDate = strtotime('+1 day', $currentDate);
        }

        foreach ($tokenConfigs as $tokenGroup) {
            $token = trim($tokenGroup['token'] ?? '');
            $accountIdsStr = trim($tokenGroup['account_ids'] ?? '');

            if (!$token || !$accountIdsStr) {
                continue;
            }

            $adAccountIds = explode(',', $accountIdsStr);

            foreach ($adAccountIds as $adAccountId) {
                $adAccountId = trim($adAccountId);
                if (!$adAccountId) {
                    continue;
                }

                if (!str_starts_with($adAccountId, 'act_')) {
                    $adAccountId = 'act_' . $adAccountId;
                }

                if (!isset($accountsInfo[$adAccountId])) {
                    $accountsInfo[$adAccountId] = [
                        'account_id' => $adAccountId,
                        'account_name' => $adAccountId,
                        'total_raw' => 0,
                        'total_taxed' => 0,
                    ];
                }

                try {
                    $nameResponse = \Illuminate\Support\Facades\Http::withoutVerifying()->get(
                        "https://graph.facebook.com/v20.0/{$adAccountId}",
                        [
                            'access_token' => $token,
                            'fields' => 'name',
                        ]
                    );

                    if ($nameResponse->successful()) {
                        $nameData = $nameResponse->json();
                        if (!empty($nameData['name'])) {
                            $accountsInfo[$adAccountId]['account_name'] = $nameData['name'];
                        }
                    }

                    $response = \Illuminate\Support\Facades\Http::withoutVerifying()->get(
                        "https://graph.facebook.com/v20.0/{$adAccountId}/insights",
                        [
                            'access_token' => $token,
                            'time_range' => json_encode(['since' => $startDate, 'until' => $endDate]),
                            'time_increment' => 1,
                            'fields' => 'spend,account_name',
                        ]
                    );

                    if ($response->successful()) {
                        $data = $response->json('data');

                        if (!empty($data) && isset($data[0]['account_name'])) {
                            $accountsInfo[$adAccountId]['account_name'] = $data[0]['account_name'];
                        }

                        foreach ($data as $dayData) {
                            $dateStr = $dayData['date_start'] ?? null;
                            if (!$dateStr) {
                                continue;
                            }

                            $spendRaw = (float) ($dayData['spend'] ?? 0);
                            if ($spendRaw <= 0) {
                                continue;
                            }

                            $spendTaxed = $spendRaw * (1 + $taxRate / 100);

                            if (!isset($dailyData[$dateStr])) {
                                $dailyData[$dateStr] = [];
                            }

                            if (!isset($dailyData[$dateStr][$adAccountId])) {
                                $dailyData[$dateStr][$adAccountId] = ['spend_raw' => 0, 'spend_taxed' => 0];
                            }

                            $dailyData[$dateStr][$adAccountId]['spend_raw'] += $spendRaw;
                            $dailyData[$dateStr][$adAccountId]['spend_taxed'] += $spendTaxed;

                            $accountsInfo[$adAccountId]['total_raw'] += $spendRaw;
                            $accountsInfo[$adAccountId]['total_taxed'] += $spendTaxed;

                            $totalRaw += $spendRaw;
                            $totalTaxed += $spendTaxed;
                        }
                    }
                } catch (\Exception $exception) {
                    // Ignore individual account failures so the rest of the split view can still load.
                }
            }
        }

        krsort($dailyData);

        return response()->json([
            'status' => 'success',
            'data' => [
                'accounts' => array_values($accountsInfo),
                'daily_matrix' => $dailyData,
                'total_raw' => $totalRaw,
                'total_taxed' => $totalTaxed,
                'tax_rate' => $taxRate,
            ],
        ]);
    }
}
