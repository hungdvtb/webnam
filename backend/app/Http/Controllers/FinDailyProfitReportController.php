<?php

namespace App\Http\Controllers;

use App\Models\DailyAdsSpend;
use App\Models\FinDailyReportConfig;
use App\Models\InventoryDocument;
use App\Models\Order;
use App\Services\FacebookAdsSyncService;
use App\Services\GoogleAdsSyncService;
use App\Support\OrderShippingFeeCalculator;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Collection;

class FinDailyProfitReportController extends Controller
{
    private const MONTHLY_REPORT_INCLUDED_STATUS = 'completed';
    private const MONTHLY_REPORT_TAX_RATE = 1.5;
    private const EXCLUDED_ORDER_STATUSES = ['cancelled', 'canceled'];
    private const REPORT_AD_CHANNEL_ALL = 'all';
    private const REPORT_AD_CHANNEL_FACEBOOK = 'facebook';
    private const REPORT_AD_CHANNEL_GOOGLE = 'google';
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
        'fb_ads_spend_raw',
        'fb_ads_spend',
        'google_ads_spend_raw',
        'google_ads_spend',
        'tax',
        'fixed_cost',
        'total_profit',
        'profit_per_house',
    ];
    private const MONTHLY_REPORT_DRILLDOWN_METRICS = [
        'order_count' => [
            'label' => 'Đơn hàng',
            'summary_field' => 'order_count',
            'date_filter_mode' => 'shipping_dispatched',
            'status' => [],
            'status_exclude' => self::EXCLUDED_ORDER_STATUSES,
            'order_type' => [],
        ],
        'revenue' => [
            'label' => 'Doanh thu',
            'summary_field' => 'report_revenue_total',
            'date_filter_mode' => 'created',
            'status' => [self::MONTHLY_REPORT_INCLUDED_STATUS],
            'status_exclude' => [],
            'order_type' => [Order::TYPE_STANDARD],
        ],
        'cost_actual' => [
            'label' => 'Tiền hàng thực tế',
            'summary_field' => 'report_cost_total',
            'date_filter_mode' => 'created',
            'status' => [self::MONTHLY_REPORT_INCLUDED_STATUS],
            'status_exclude' => [],
            'order_type' => [Order::TYPE_STANDARD],
        ],
        'shipping_fee' => [
            'label' => 'Tiền ship hàng',
            'summary_field' => 'shipping_fee_total',
            'date_filter_mode' => 'created',
            'status' => [],
            'status_exclude' => self::EXCLUDED_ORDER_STATUSES,
            'order_type' => [],
        ],
        'exchange_profit_loss' => [
            'label' => 'Lãi lỗ đổi trả',
            'summary_field' => 'report_profit_total',
            'date_filter_mode' => 'created',
            'status' => [],
            'status_exclude' => self::EXCLUDED_ORDER_STATUSES,
            'order_type' => [Order::TYPE_EXCHANGE_RETURN],
        ],
        'partial_delivery_profit_loss' => [
            'label' => 'Lãi lỗ giao 1 phần',
            'summary_field' => 'report_profit_total',
            'date_filter_mode' => 'created',
            'status' => [],
            'status_exclude' => self::EXCLUDED_ORDER_STATUSES,
            'order_type' => [Order::TYPE_PARTIAL_DELIVERY],
        ],
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
            'google_developer_token',
            'google_client_id',
            'google_client_secret',
            'google_refresh_token',
            'google_login_customer_id',
            'google_customer_ids',
            'google_tax_rate',
        ]);

        $config->fill($data);
        $config->save();

        return response()->json([
            'status' => 'success',
            'data' => $config,
            'message' => 'Cập nhật cấu hình thành công',
        ]);
    }

    private function dailyAdsSpendTotalsByDate(string $startDate, string $endDate, string $platform, array $configuredAccountIds): array
    {
        $query = DailyAdsSpend::query()
            ->where('platform', $platform)
            ->whereBetween('date', [$startDate, $endDate])
            ->select('date', DB::raw('SUM(COALESCE(amount, 0)) as total_amount'))
            ->groupBy('date');

        if ($configuredAccountIds !== []) {
            $hasConfiguredAccountRows = DailyAdsSpend::query()
                ->where('platform', $platform)
                ->whereBetween('date', [$startDate, $endDate])
                ->whereIn('account_id', $configuredAccountIds)
                ->exists();

            if ($hasConfiguredAccountRows) {
                $query->whereIn('account_id', $configuredAccountIds);
            } else {
                $query->whereNull('account_id');
            }
        } else {
            $query->whereNull('account_id');
        }

        return $query
            ->pluck('total_amount', 'date')
            ->map(fn ($amount) => (float) $amount)
            ->toArray();
    }

    private function extractRequestedValues(mixed $values): array
    {
        $rawValues = is_array($values) ? $values : explode(',', (string) $values);
        $seen = [];
        $result = [];

        foreach ($rawValues as $value) {
            $normalized = trim((string) $value);
            if ($normalized === '' || isset($seen[$normalized])) {
                continue;
            }

            $seen[$normalized] = true;
            $result[] = $normalized;
        }

        return $result;
    }

    private function extractRequestedStatusCodes(mixed $statuses): array
    {
        return $this->extractRequestedValues($statuses);
    }

    private function extractRequestedOrderTypes(mixed $orderTypes): array
    {
        $seen = [];
        $result = [];

        foreach ($this->extractRequestedValues($orderTypes) as $candidate) {
            $normalized = strtolower(trim($candidate));

            if (!in_array($normalized, Order::TYPES, true)) {
                if ($normalized !== Order::TYPE_STANDARD) {
                    continue;
                }
            }

            if (isset($seen[$normalized])) {
                continue;
            }

            $seen[$normalized] = true;
            $result[] = $normalized;
        }

        return $result;
    }

    private function normalizeReportAdChannel(mixed $value): string
    {
        $normalized = strtolower(trim((string) $value));

        return match ($normalized) {
            'facebook', 'fb', 'meta', 'facebook_ads', 'facebook-ad', 'facebook ads' => self::REPORT_AD_CHANNEL_FACEBOOK,
            'google', 'gg', 'ga', 'google_ads', 'google-ad', 'google ads', 'googleads' => self::REPORT_AD_CHANNEL_GOOGLE,
            default => self::REPORT_AD_CHANNEL_ALL,
        };
    }

    private function reportAdChannelLabel(string $channel): string
    {
        return match ($channel) {
            self::REPORT_AD_CHANNEL_FACEBOOK => 'Facebook',
            self::REPORT_AD_CHANNEL_GOOGLE => 'Google',
            default => 'Tất cả',
        };
    }

    private function reportAdChannelSourceMatches(string $channel): array
    {
        return match ($channel) {
            self::REPORT_AD_CHANNEL_FACEBOOK => [
                'exact' => ['fb', 'facebook', 'meta', 'facebook_ads', 'facebook-ad', 'facebook ads'],
                'contains' => ['facebook', 'fbclid', 'meta'],
            ],
            self::REPORT_AD_CHANNEL_GOOGLE => [
                'exact' => ['gg', 'google', 'ga', 'google_ads', 'google-ad', 'google ads', 'googleads'],
                'contains' => ['google', 'gclid', 'googleads'],
            ],
            default => [
                'exact' => [],
                'contains' => [],
            ],
        };
    }

    private function applyReportAdChannelOrderFilter($query, string $channel, string $column = 'source'): void
    {
        if ($channel === self::REPORT_AD_CHANNEL_ALL) {
            return;
        }

        $matches = $this->reportAdChannelSourceMatches($channel);
        $exactValues = $matches['exact'] ?? [];
        $containsValues = $matches['contains'] ?? [];

        $query->where(function ($sourceQuery) use ($column, $exactValues, $containsValues) {
            if ($exactValues !== []) {
                $sourceQuery->whereIn(DB::raw("LOWER(COALESCE({$column}, ''))"), $exactValues);
            } else {
                $sourceQuery->whereRaw('1 = 0');
            }

            foreach ($containsValues as $keyword) {
                $sourceQuery->orWhereRaw("LOWER(COALESCE({$column}, '')) LIKE ?", ['%' . $keyword . '%']);
            }
        });
    }

    private function applyRequestedOrderTypeFilter($query, array $requestedOrderTypes, string $column = 'order_type'): void
    {
        if ($requestedOrderTypes === []) {
            $query->whereRaw('1 = 0');
            return;
        }

        $includesStandard = in_array(Order::TYPE_STANDARD, $requestedOrderTypes, true);
        $specialTypes = array_values(array_filter(
            $requestedOrderTypes,
            fn (string $type) => $type !== Order::TYPE_STANDARD
        ));

        $query->where(function ($typeQuery) use ($column, $includesStandard, $specialTypes) {
            if ($includesStandard) {
                $typeQuery->where(function ($standardQuery) use ($column) {
                    $standardQuery->where($column, Order::TYPE_STANDARD)
                        ->orWhereNull($column)
                        ->orWhere($column, '');
                });

                if ($specialTypes !== []) {
                    $typeQuery->orWhereIn($column, $specialTypes);
                }

                return;
            }

            $typeQuery->whereIn($column, $specialTypes);
        });
    }

    private function applyDailyReportOptionalFilters($query, array $filters = []): void
    {
        if (array_key_exists('status', $filters) && $filters['status'] !== null && $filters['status'] !== '') {
            $statuses = $this->extractRequestedStatusCodes($filters['status']);

            if ($statuses === []) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn('status', $statuses);
            }
        }

        if (array_key_exists('order_type', $filters) && $filters['order_type'] !== null && $filters['order_type'] !== '') {
            $this->applyRequestedOrderTypeFilter(
                $query,
                $this->extractRequestedOrderTypes($filters['order_type'])
            );
        }

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );
    }

    private function dailyReportBaseOrdersQuery(string $startDate, string $endDate, array $filters = [])
    {
        $query = Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where(function ($kindQuery) {
                $kindQuery->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES);

        $this->applyDailyReportOptionalFilters($query, $filters);

        return $query;
    }

    private function dailySpecialProfitOrdersQuery(string $startDate, string $endDate, array $filters = [])
    {
        $startAt = $startDate . ' 00:00:00';
        $endAt = $endDate . ' 23:59:59';

        $query = Order::query()
            ->where(function ($kindQuery) {
                $kindQuery->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->where(function ($dateQuery) use ($startAt, $endAt) {
                $dateQuery->whereBetween('officialized_at', [$startAt, $endAt])
                    ->orWhere(function ($fallbackQuery) use ($startAt, $endAt) {
                        $fallbackQuery->whereNull('officialized_at')
                            ->whereBetween('created_at', [$startAt, $endAt]);
                    });
            })
            ->whereIn('order_type', [
                Order::TYPE_EXCHANGE_RETURN,
                Order::TYPE_PARTIAL_DELIVERY,
            ])
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES);

        $this->applyDailyReportOptionalFilters($query, $filters);

        return $query;
    }

    private function dailySpecialProfitLossByDate(string $startDate, string $endDate, array $filters = [])
    {
        return $this->dailySpecialProfitOrdersQuery($startDate, $endDate, $filters)
            ->select(
                DB::raw('DATE(COALESCE(officialized_at, created_at)) as date'),
                DB::raw("SUM(CASE WHEN order_type = 'exchange_return' THEN 1 ELSE 0 END) as exchange_return_order_count"),
                DB::raw("SUM(CASE WHEN order_type = 'partial_delivery' THEN 1 ELSE 0 END) as partial_delivery_order_count"),
                DB::raw("SUM(CASE WHEN order_type = 'exchange_return' THEN COALESCE(report_profit_total, 0) ELSE 0 END) as exchange_profit_loss"),
                DB::raw("SUM(CASE WHEN order_type = 'partial_delivery' THEN COALESCE(report_profit_total, 0) ELSE 0 END) as partial_delivery_profit_loss")
            )
            ->groupBy('date')
            ->get()
            ->keyBy('date');
    }

    private function resolveRecordedShippingFee(Order $order): float
    {
        return OrderShippingFeeCalculator::resolveRecordedShippingFee($order);
    }

    private function resolveOrderShippingSummary(Order $order): array
    {
        return OrderShippingFeeCalculator::resolveShippingSummary($order);
    }

    private function buildDailyReportPayload(string $startDate, string $endDate, array $filters = []): array
    {
        $config = FinDailyReportConfig::first();
        $returnRate = $config ? (float) $config->return_rate : 2.0;
        $packFee = $config ? (float) $config->packaging_fee : 2000.0;
        $taxRate = $config ? (float) $config->tax_rate : 1.5;
        $adChannel = $this->normalizeReportAdChannel($filters['ad_channel'] ?? null);
        $includeFacebookAds = in_array($adChannel, [self::REPORT_AD_CHANNEL_ALL, self::REPORT_AD_CHANNEL_FACEBOOK], true);
        $includeGoogleAds = in_array($adChannel, [self::REPORT_AD_CHANNEL_ALL, self::REPORT_AD_CHANNEL_GOOGLE], true);
        $includeSharedCosts = $adChannel === self::REPORT_AD_CHANNEL_ALL;

        $baseOrdersQuery = $this->dailyReportBaseOrdersQuery($startDate, $endDate, $filters);

        $dataRaw = (clone $baseOrdersQuery)
            ->select(
                DB::raw('DATE(officialized_at) as date'),
                DB::raw('COUNT(*) as order_count'),
                DB::raw("SUM(CASE WHEN order_type IS NULL OR order_type = '' OR order_type NOT IN ('exchange_return', 'partial_delivery') THEN total_price ELSE 0 END) as revenue_total"),
                DB::raw("SUM(CASE WHEN order_type IS NULL OR order_type = '' OR order_type NOT IN ('exchange_return', 'partial_delivery') THEN cost_total ELSE 0 END) as cost_total")
            )
            ->groupBy('date')
            ->get()
            ->keyBy('date');

        $specialProfitByDate = $this->dailySpecialProfitLossByDate($startDate, $endDate, $filters);

        $shippingOrdersByDate = (clone $baseOrdersQuery)
            ->with(['activeShipment:id,order_id,shipping_cost'])
            ->get([
                'id',
                'officialized_at',
                'total_price',
                'internal_shipping_fee',
                'external_delivery_meta',
            ])
            ->groupBy(fn (Order $order) => optional($order->officialized_at)?->format('Y-m-d'));

        $fixedCosts = $includeSharedCosts
            ? \App\Models\FixedCostDailySnapshot::query()
                ->whereBetween('date', [$startDate, $endDate])
                ->pluck('amount', 'date')
                ->toArray()
            : [];

        $fbAdsSpends = $includeFacebookAds
            ? $this->dailyAdsSpendTotalsByDate(
                $startDate,
                $endDate,
                DailyAdsSpend::PLATFORM_FACEBOOK,
                app(FacebookAdsSyncService::class)->configuredStorageAccountIds($config)
            )
            : [];
        $googleAdsSpends = $includeGoogleAds
            ? $this->dailyAdsSpendTotalsByDate(
                $startDate,
                $endDate,
                DailyAdsSpend::PLATFORM_GOOGLE,
                app(GoogleAdsSyncService::class)->configuredStorageAccountIds($config)
            )
            : [];
        $fbTaxRate = $config ? (float) $config->fb_tax_rate : 0;
        $googleTaxRate = $config ? (float) ($config->google_tax_rate ?? 0) : 0;

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

            $ordersOfDay = $shippingOrdersByDate->get($dateStr, collect());
            $dailyShip = round((float) $ordersOfDay->sum(
                fn (Order $order) => $this->resolveOrderShippingSummary($order)['shipping_fee_total']
            ), 2);
            $shippingFee = $dailyShip;

            $packagingFee = $orderCount * $packFee;
            $tax = ($taxRate / 100) * ($revenueActual - $shippingFee);
            $fixedCostDaily = isset($fixedCosts[$dateStr]) ? (float) $fixedCosts[$dateStr] : 0;

            $fbAdsSpendRawDaily = (float) ($fbAdsSpends[$dateStr] ?? 0);
            $fbAdsSpendDaily = $fbAdsSpendRawDaily * (1 + $fbTaxRate / 100);
            $googleAdsSpendRawDaily = (float) ($googleAdsSpends[$dateStr] ?? 0);
            $googleAdsSpendDaily = $googleAdsSpendRawDaily * (1 + $googleTaxRate / 100);
            $adsSpendRawDaily = $fbAdsSpendRawDaily + $googleAdsSpendRawDaily;
            $adsSpendDaily = $fbAdsSpendDaily + $googleAdsSpendDaily;

            $profitFromNewOrders = $revenueActual - $costActual - $shippingFee - $packagingFee - $tax - $fixedCostDaily - $adsSpendDaily;
            $specialProfit = $specialProfitByDate->get($dateStr);
            $exchangeReturnOrderCount = $specialProfit ? (int) $specialProfit->exchange_return_order_count : 0;
            $partialDeliveryOrderCount = $specialProfit ? (int) $specialProfit->partial_delivery_order_count : 0;
            $extraProfitOrderCount = $exchangeReturnOrderCount + $partialDeliveryOrderCount;
            $exchangeProfitLoss = $specialProfit ? (float) $specialProfit->exchange_profit_loss : 0;
            $partialDeliveryProfitLoss = $specialProfit ? (float) $specialProfit->partial_delivery_profit_loss : 0;
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
                'shipping_return' => 0,
                'packaging_fee' => $packagingFee,
                'tax' => $tax,
                'fixed_cost' => $fixedCostDaily,
                'fb_ads_spend_raw' => $fbAdsSpendRawDaily,
                'fb_ads_spend' => $fbAdsSpendDaily,
                'google_ads_spend_raw' => $googleAdsSpendRawDaily,
                'google_ads_spend' => $googleAdsSpendDaily,
                'ads_spend_raw' => $adsSpendRawDaily,
                'ads_spend' => $adsSpendDaily,
                'exchange_return_order_count' => $exchangeReturnOrderCount,
                'partial_delivery_order_count' => $partialDeliveryOrderCount,
                'extra_profit_order_count' => $extraProfitOrderCount,
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
                'exchange_return_order_count' => (int) $reportCollection->sum('exchange_return_order_count'),
                'partial_delivery_order_count' => (int) $reportCollection->sum('partial_delivery_order_count'),
                'extra_profit_order_count' => (int) $reportCollection->sum('extra_profit_order_count'),
                'exchange_profit_loss' => round((float) $reportCollection->sum('exchange_profit_loss'), 2),
                'partial_delivery_profit_loss' => round((float) $reportCollection->sum('partial_delivery_profit_loss'), 2),
                'total_extra_profit' => round((float) $reportCollection->sum('extra_profit'), 2),
                'fb_ads_spend_raw' => round((float) $reportCollection->sum('fb_ads_spend_raw'), 2),
                'fb_ads_spend' => round((float) $reportCollection->sum('fb_ads_spend'), 2),
                'google_ads_spend_raw' => round((float) $reportCollection->sum('google_ads_spend_raw'), 2),
                'google_ads_spend' => round((float) $reportCollection->sum('google_ads_spend'), 2),
                'ads_spend_raw' => round((float) $reportCollection->sum('ads_spend_raw'), 2),
                'ads_spend' => round((float) $reportCollection->sum('ads_spend'), 2),
            ],
            'meta' => [
                'ad_channel' => $adChannel,
                'ad_channel_label' => $this->reportAdChannelLabel($adChannel),
                'shared_costs_included' => $includeSharedCosts,
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
            'fb_ads_spend_raw' => 0,
            'fb_ads_spend' => 0,
            'google_ads_spend_raw' => 0,
            'google_ads_spend' => 0,
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

    private function monthlySpecialOrderProfitLoss(string $startDate, string $endDate, array $filters = [])
    {
        $startAt = $startDate . ' 00:00:00';
        $endAt = $endDate . ' 23:59:59';

        $query = Order::query()
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
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES);

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );

        return $query
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
            'fb_ads_spend_raw' => round((float) $rows->sum('fb_ads_spend_raw'), 2),
            'fb_ads_spend' => round((float) $rows->sum('fb_ads_spend'), 2),
            'google_ads_spend_raw' => round((float) $rows->sum('google_ads_spend_raw'), 2),
            'google_ads_spend' => round((float) $rows->sum('google_ads_spend'), 2),
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
            || (float) ($row['fb_ads_spend_raw'] ?? 0) !== 0.0
            || (float) ($row['fb_ads_spend'] ?? 0) !== 0.0
            || (float) ($row['google_ads_spend_raw'] ?? 0) !== 0.0
            || (float) ($row['google_ads_spend'] ?? 0) !== 0.0
            || (float) ($row['ads_spend_raw'] ?? 0) !== 0.0
            || (float) ($row['ads_spend'] ?? 0) !== 0.0
            || (float) ($row['tax'] ?? 0) !== 0.0
            || (float) ($row['fixed_cost'] ?? 0) !== 0.0
            || (float) ($row['total_profit'] ?? 0) !== 0.0;
    }

    private function successfulOrdersForMonthlyReport(string $startDate, string $endDate, array $filters = [])
    {
        $query = Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where('status', self::MONTHLY_REPORT_INCLUDED_STATUS)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );

        return $query;
    }

    private function shippingOrdersForMonthlyReport(string $startDate, string $endDate, array $filters = [])
    {
        $query = Order::query()
            ->whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES)
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            });

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );

        return $query;
    }

    private function successfulStandardOrdersForMonthlyReport(string $startDate, string $endDate, array $filters = [])
    {
        return $this->successfulOrdersForMonthlyReport($startDate, $endDate, $filters)
            ->where(function ($query) {
                $query->where('order_type', Order::TYPE_STANDARD)
                    ->orWhereNull('order_type')
                    ->orWhere('order_type', '');
            });
    }

    private function monthlyRevenueAndCostActual(string $startDate, string $endDate, array $filters = [])
    {
        return $this->successfulStandardOrdersForMonthlyReport($startDate, $endDate, $filters)
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
        return OrderShippingFeeCalculator::resolveTotalShippingFee($order);
    }

    private function monthlyOrderShippingFee(string $startDate, string $endDate, array $filters = [])
    {
        return $this->shippingOrdersForMonthlyReport($startDate, $endDate, $filters)
            ->with(['activeShipment:id,order_id,shipping_cost'])
            ->get([
                'id',
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

    private function monthlySuccessfulOrderRevenueShippingAndTax(string $startDate, string $endDate, float $taxRate, array $filters = [])
    {
        return $this->successfulOrdersForMonthlyReport($startDate, $endDate, $filters)
            ->with(['activeShipment:id,order_id,shipping_cost'])
            ->get([
                'id',
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

    private function normalizeMonthlyReportDrilldownMetric(?string $metric): ?string
    {
        $normalized = trim((string) $metric);

        return array_key_exists($normalized, self::MONTHLY_REPORT_DRILLDOWN_METRICS)
            ? $normalized
            : null;
    }

    private function resolveMonthlyReportDrilldownRange(string $monthKey, string $reportStartDate, string $reportEndDate): ?array
    {
        if (!preg_match('/^\d{4}-\d{2}$/', $monthKey)) {
            return null;
        }

        try {
            $monthStart = Carbon::createFromFormat('Y-m-d', $monthKey . '-01')->startOfDay();
            $monthEnd = (clone $monthStart)->endOfMonth()->endOfDay();
            $reportStart = Carbon::createFromFormat('Y-m-d', $reportStartDate)->startOfDay();
            $reportEnd = Carbon::createFromFormat('Y-m-d', $reportEndDate)->endOfDay();
        } catch (\Throwable) {
            return null;
        }

        if ($reportStart->greaterThan($reportEnd)) {
            return null;
        }

        $effectiveStart = $monthStart->greaterThan($reportStart) ? clone $monthStart : clone $reportStart;
        $effectiveEnd = $monthEnd->lessThan($reportEnd) ? clone $monthEnd : clone $reportEnd;

        if ($effectiveStart->greaterThan($effectiveEnd)) {
            return null;
        }

        return [
            'month_key' => $monthStart->format('Y-m'),
            'month_label' => sprintf('Tháng %d/%d', (int) $monthStart->format('n'), (int) $monthStart->format('Y')),
            'start_date' => $effectiveStart->format('Y-m-d'),
            'end_date' => $effectiveEnd->format('Y-m-d'),
        ];
    }

    private function dispatchedOrdersForMonthlyReport(string $startDate, string $endDate, array $filters = [])
    {
        $query = Order::query()
            ->whereNotNull('shipping_dispatched_at')
            ->whereBetween('shipping_dispatched_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where(function ($query) {
                $query->where('order_kind', Order::KIND_OFFICIAL)
                    ->orWhereNull('order_kind')
                    ->orWhere('order_kind', '');
            })
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES);

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );

        return $query;
    }

    private function specialOrdersForMonthlyReport(string $startDate, string $endDate, string $orderType, array $filters = [])
    {
        $startAt = $startDate . ' 00:00:00';
        $endAt = $endDate . ' 23:59:59';

        $query = Order::query()
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
            ->where('order_type', $orderType)
            ->whereNotIn('status', self::EXCLUDED_ORDER_STATUSES);

        $this->applyReportAdChannelOrderFilter(
            $query,
            $this->normalizeReportAdChannel($filters['ad_channel'] ?? null)
        );

        return $query;
    }

    private function monthlyReportDrilldownOrders(string $metric, string $startDate, string $endDate, array $filters = []): Collection
    {
        return match ($metric) {
            'order_count' => $this->dispatchedOrdersForMonthlyReport($startDate, $endDate, $filters)
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'shipping_dispatched_at',
                ]),
            'revenue' => $this->successfulStandardOrdersForMonthlyReport($startDate, $endDate, $filters)
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'officialized_at',
                    'created_at',
                    'total_price',
                    'report_revenue_total',
                ]),
            'cost_actual' => $this->successfulStandardOrdersForMonthlyReport($startDate, $endDate, $filters)
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'officialized_at',
                    'created_at',
                    'cost_total',
                    'report_cost_total',
                ]),
            'shipping_fee' => $this->shippingOrdersForMonthlyReport($startDate, $endDate, $filters)
                ->with(['activeShipment:id,order_id,shipping_cost'])
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'officialized_at',
                    'created_at',
                    'internal_shipping_fee',
                    'external_delivery_meta',
                    'total_price',
                ]),
            'exchange_profit_loss' => $this->specialOrdersForMonthlyReport($startDate, $endDate, Order::TYPE_EXCHANGE_RETURN, $filters)
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'officialized_at',
                    'created_at',
                    'report_profit_total',
                ]),
            'partial_delivery_profit_loss' => $this->specialOrdersForMonthlyReport($startDate, $endDate, Order::TYPE_PARTIAL_DELIVERY, $filters)
                ->get([
                    'id',
                    'status',
                    'order_type',
                    'officialized_at',
                    'created_at',
                    'report_profit_total',
                ]),
            default => collect(),
        };
    }

    private function calculateMonthlyReportDrilldownMetricValue(string $metric, Collection $orders): int|float
    {
        return match ($metric) {
            'order_count' => $orders->count(),
            'revenue' => round((float) $orders->sum(
                fn (Order $order) => (float) ($order->report_revenue_total ?? $order->total_price ?? 0)
            ), 2),
            'cost_actual' => round((float) $orders->sum(
                fn (Order $order) => (float) ($order->report_cost_total ?? $order->cost_total ?? 0)
            ), 2),
            'shipping_fee' => round((float) $orders->sum(
                fn (Order $order) => $this->resolveMonthlyReportShippingFee($order)
            ), 2),
            'exchange_profit_loss',
            'partial_delivery_profit_loss' => round((float) $orders->sum(
                fn (Order $order) => (float) ($order->report_profit_total ?? 0)
            ), 2),
            default => 0,
        };
    }

    private function buildMonthlyReportDrilldownFilters(string $metric, array $range, array $orderIds): array
    {
        return [
            'order_ids' => array_values(array_unique(array_map('intval', $orderIds))),
        ];
    }

    private function buildMonthlyReportDrilldownContextFilters(string $metric, array $range): array
    {
        $metricConfig = self::MONTHLY_REPORT_DRILLDOWN_METRICS[$metric] ?? [];
        $dateFilterMode = (string) ($metricConfig['date_filter_mode'] ?? 'created');
        $filters = [
            'status' => $metricConfig['status'] ?? [],
            'status_exclude' => $metricConfig['status_exclude'] ?? [],
            'order_type' => $metricConfig['order_type'] ?? [],
            'created_at_from' => '',
            'created_at_to' => '',
            'shipping_dispatched_from' => '',
            'shipping_dispatched_to' => '',
        ];

        if ($dateFilterMode === 'shipping_dispatched') {
            $filters['shipping_dispatched_from'] = $range['start_date'];
            $filters['shipping_dispatched_to'] = $range['end_date'];
        } else {
            $filters['created_at_from'] = $range['start_date'];
            $filters['created_at_to'] = $range['end_date'];
        }

        return $filters;
    }

    public function getMonthlyReportDrilldown(Request $request)
    {
        $request->validate([
            'metric' => ['required', 'string'],
            'month' => ['required', 'regex:/^\d{4}-\d{2}$/'],
            'start_date' => ['nullable', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'date_format:Y-m-d'],
            'ad_channel' => ['nullable', 'string'],
        ]);

        $metric = $this->normalizeMonthlyReportDrilldownMetric($request->input('metric'));
        if (!$metric) {
            return response()->json([
                'status' => 'error',
                'message' => 'Chỉ số drilldown không hợp lệ.',
            ], 422);
        }

        $reportStartDate = (string) ($request->input('start_date') ?: date('Y-01-01'));
        $reportEndDate = (string) ($request->input('end_date') ?: date('Y-m-d'));
        $range = $this->resolveMonthlyReportDrilldownRange((string) $request->input('month'), $reportStartDate, $reportEndDate);

        if (!$range) {
            return response()->json([
                'status' => 'error',
                'message' => 'Không thể xác định phạm vi tháng cần drilldown.',
            ], 422);
        }

        $metricConfig = self::MONTHLY_REPORT_DRILLDOWN_METRICS[$metric];
        $adChannel = $this->normalizeReportAdChannel($request->input('ad_channel'));
        $orders = $this->monthlyReportDrilldownOrders($metric, $range['start_date'], $range['end_date'], [
            'ad_channel' => $adChannel,
        ]);
        $orderIds = $orders
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        return response()->json([
            'status' => 'success',
            'data' => [
                'metric' => $metric,
                'metric_label' => $metricConfig['label'],
                'summary_field' => $metricConfig['summary_field'],
                'month_key' => $range['month_key'],
                'month_label' => $range['month_label'],
                'start_date' => $range['start_date'],
                'end_date' => $range['end_date'],
                'scope_label' => sprintf('Báo cáo tháng · %s · %s', $metricConfig['label'], $range['month_label']),
                'ad_channel' => $adChannel,
                'ad_channel_label' => $this->reportAdChannelLabel($adChannel),
                'value' => $this->calculateMonthlyReportDrilldownMetricValue($metric, $orders),
                'order_ids' => $orderIds,
                'filters' => $this->buildMonthlyReportDrilldownFilters($metric, $range, $orderIds),
                'context_filters' => $this->buildMonthlyReportDrilldownContextFilters($metric, $range),
            ],
        ]);
    }

    public function getReport(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-01');
        $endDate = $request->end_date ?: date('Y-m-d');

        app(FacebookAdsSyncService::class)->syncRange($startDate, $endDate);
        app(GoogleAdsSyncService::class)->syncRange($startDate, $endDate);

        $payload = $this->buildDailyReportPayload($startDate, $endDate, [
            'status' => $request->input('status'),
            'order_type' => $request->input('order_type'),
            'ad_channel' => $request->input('ad_channel'),
        ]);

        return response()->json([
            'status' => 'success',
            'data' => $payload['data'],
            'summary' => $payload['summary'],
            'meta' => $payload['meta'] ?? [],
        ]);
    }

    public function getMonthlyReport(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-01-01');
        $endDate = $request->end_date ?: date('Y-m-d');
        $adChannel = $this->normalizeReportAdChannel($request->input('ad_channel'));
        $filters = [
            'ad_channel' => $adChannel,
        ];
        $includeSharedCosts = $adChannel === self::REPORT_AD_CHANNEL_ALL;

        app(FacebookAdsSyncService::class)->syncRange($startDate, $endDate);
        app(GoogleAdsSyncService::class)->syncRange($startDate, $endDate);

        $payload = $this->buildDailyReportPayload($startDate, $endDate, $filters);
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
                    $monthly['fb_ads_spend_raw'] += (float) ($row['fb_ads_spend_raw'] ?? 0);
                    $monthly['fb_ads_spend'] += (float) ($row['fb_ads_spend'] ?? 0);
                    $monthly['google_ads_spend_raw'] += (float) ($row['google_ads_spend_raw'] ?? 0);
                    $monthly['google_ads_spend'] += (float) ($row['google_ads_spend'] ?? 0);
                    $monthly['ads_spend_raw'] += (float) ($row['ads_spend_raw'] ?? 0);
                    $monthly['ads_spend'] += (float) ($row['ads_spend'] ?? 0);
                    $monthly['fixed_cost'] += (float) ($row['fixed_cost'] ?? 0);
                }

                return $monthly;
            });

        $monthlyRevenueAndCost = $this->monthlyRevenueAndCostActual($startDate, $endDate, $filters);
        $monthlyShippingFee = $this->monthlyOrderShippingFee($startDate, $endDate, $filters);
        $monthlySuccessfulOrderTotals = $this->monthlySuccessfulOrderRevenueShippingAndTax($startDate, $endDate, $taxRate, $filters);
        $monthlyDamagedGoods = $includeSharedCosts
            ? $this->monthlyDamagedGoodsFromDamagedSlips($startDate, $endDate)
            : collect();
        $monthlySpecialOrderProfitLoss = $this->monthlySpecialOrderProfitLoss($startDate, $endDate, $filters);

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

        $dispatchedOrderCounts = $this->dispatchedOrdersForMonthlyReport($startDate, $endDate, $filters)
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
                'ad_channel' => $adChannel,
                'ad_channel_label' => $this->reportAdChannelLabel($adChannel),
                'shared_costs_included' => $includeSharedCosts,
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

    public function getGoogleAdAccounts(Request $request)
    {
        try {
            $accounts = app(GoogleAdsSyncService::class)->listAccessibleCustomers($request->only([
                'google_developer_token',
                'developer_token',
                'google_client_id',
                'client_id',
                'google_client_secret',
                'client_secret',
                'google_refresh_token',
                'refresh_token',
                'google_login_customer_id',
                'login_customer_id',
            ]));

            return response()->json([
                'status' => 'success',
                'data' => $accounts,
            ]);
        } catch (\Exception $exception) {
            return response()->json([
                'status' => 'error',
                'message' => $exception->getMessage(),
            ]);
        }
    }

    public function syncGoogleAds(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-d');
        $endDate = $request->end_date ?: date('Y-m-d');

        $syncService = app(GoogleAdsSyncService::class);
        try {
            $success = $syncService->syncRange($startDate, $endDate, true);
        } catch (\Exception $exception) {
            return response()->json([
                'status' => 'error',
                'message' => $exception->getMessage(),
                'data' => [],
            ], 422);
        }

        if (!$success) {
            return response()->json([
                'status' => 'error',
                'message' => 'Khong dong bo duoc du lieu Google Ads.',
                'data' => [],
            ], 422);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Dong bo du lieu Google Ads thanh cong',
            'data' => [],
        ]);
    }

    public function getGoogleAdSpendSplit(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-d');
        $endDate = $request->end_date ?: date('Y-m-d');

        $config = FinDailyReportConfig::first();
        if (!$config) {
            return response()->json(['status' => 'error', 'message' => 'Chua cau hinh Google Ads']);
        }

        $configuredAccountIds = app(GoogleAdsSyncService::class)->configuredStorageAccountIds($config);
        if ($configuredAccountIds === []) {
            return response()->json(['status' => 'error', 'message' => 'Chua cau hinh Google Ads Customer ID']);
        }

        app(GoogleAdsSyncService::class)->syncRange($startDate, $endDate);

        $taxRate = (float) ($config->google_tax_rate ?: 0);

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

        foreach ($configuredAccountIds as $accountId) {
            $accountKey = (string) $accountId;
            $accountsInfo[$accountKey] = [
                'account_id' => $accountKey,
                'account_name' => $accountKey,
                'total_raw' => 0,
                'total_taxed' => 0,
            ];
        }

        $rows = DailyAdsSpend::query()
            ->where('platform', DailyAdsSpend::PLATFORM_GOOGLE)
            ->whereBetween('date', [$startDate, $endDate])
            ->whereIn('account_id', $configuredAccountIds)
            ->get(['date', 'account_id', 'amount']);

        foreach ($rows as $row) {
            $dateStr = optional($row->date)->format('Y-m-d');
            $accountKey = (string) $row->account_id;
            if (!$dateStr || !isset($accountsInfo[$accountKey])) {
                continue;
            }

            $spendRaw = (float) ($row->amount ?? 0);
            $spendTaxed = $spendRaw * (1 + $taxRate / 100);

            if (!isset($dailyData[$dateStr])) {
                $dailyData[$dateStr] = [];
            }

            $dailyData[$dateStr][$accountKey] = [
                'spend_raw' => $spendRaw,
                'spend_taxed' => $spendTaxed,
            ];

            $accountsInfo[$accountKey]['total_raw'] += $spendRaw;
            $accountsInfo[$accountKey]['total_taxed'] += $spendTaxed;
            $totalRaw += $spendRaw;
            $totalTaxed += $spendTaxed;
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

        $facebookAdsSyncService = app(FacebookAdsSyncService::class);
        $facebookAdsSyncService->syncRange($startDate, $endDate);

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

                    $response = $facebookAdsSyncService->fetchDailyInsights(
                        $adAccountId,
                        $token,
                        $startDate,
                        $endDate,
                        'spend,account_name'
                    );

                    if ($response['successful']) {
                        $data = $response['data'] ?? [];

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
