<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\FinDailyReportConfig;
use App\Models\Order;
use App\Models\DailyAdsSpend;
use Illuminate\Support\Facades\DB;

class FinDailyProfitReportController extends Controller
{
    public function getConfig()
    {
        $config = FinDailyReportConfig::first();
        if (!$config) {
            $config = FinDailyReportConfig::create([
                'return_rate' => 2.00,
                'packaging_fee' => 2000.00,
                'shipping_estimate_rate' => 10.00,
                'tax_rate' => 1.50
            ]);
        }
        return response()->json(['status' => 'success', 'data' => $config]);
    }

    public function updateConfig(Request $request)
    {
        $config = FinDailyReportConfig::first();
        if (!$config) $config = new FinDailyReportConfig();

        $data = $request->only([
            'return_rate',
            'packaging_fee',
            'shipping_estimate_rate',
            'tax_rate',
            'shipping_fee_type',
            'fb_access_token',
            'fb_ad_account_ids',
            'fb_tax_rate',
            'fb_tokens_configs'
        ]);

        $config->fill($data);
        $config->save();

        return response()->json([
            'status' => 'success',
            'data' => $config,
            'message' => 'Cập nhật cấu hình thành công'
        ]);
    }

    public function getReport(Request $request)
    {
        $startDate = $request->start_date ?: date('Y-m-01');
        $endDate = $request->end_date ?: date('Y-m-d');

        $config = FinDailyReportConfig::first();
        $returnRate = $config ? floatval($config->return_rate) : 2.0;
        $packFee = $config ? floatval($config->packaging_fee) : 2000.0;
        $shipEstRate = $config ? floatval($config->shipping_estimate_rate) : 10.0;
        $shipFeeType = $config ? $config->shipping_fee_type : '%';
        $taxRate = $config ? floatval($config->tax_rate) : 1.5;

        // Using Order model will automatically apply SoftDeletes and BelongsToAccount scopes
        $dataRaw = Order::whereBetween('officialized_at', [$startDate . ' 00:00:00', $endDate . ' 23:59:59'])
            ->where(function($q) {
                $q->where('order_kind', 'official')
                  ->orWhereNull('order_kind');
            })
            ->whereNotIn('status', ['cancelled'])
            ->select(
                DB::raw('DATE(officialized_at) as date'),
                DB::raw('COUNT(*) as order_count'),
                DB::raw("SUM(CASE WHEN order_type NOT IN ('exchange_return', 'partial_delivery') THEN total_price ELSE 0 END) as revenue_total"),
                DB::raw("SUM(CASE WHEN order_type NOT IN ('exchange_return', 'partial_delivery') THEN cost_total ELSE 0 END) as cost_total"),
                DB::raw("SUM(CASE WHEN order_type IN ('exchange_return', 'partial_delivery') THEN shipping_fee ELSE 0 END) as shipping_explicit"),
                DB::raw("SUM(CASE WHEN order_type IN ('exchange_return', 'partial_delivery') THEN COALESCE(report_profit_total, 0) ELSE 0 END) as extra_profit")
            )
            ->groupBy('date')
            ->get()
            ->keyBy('date');

        $fixedCosts = \App\Models\FixedCostDailySnapshot::whereBetween('date', [$startDate, $endDate])
            ->pluck('amount', 'date')
            ->toArray();

        $adsSpends = DailyAdsSpend::whereBetween('date', [$startDate, $endDate])
            ->pluck('amount', 'date')
            ->toArray();

        $report = [];
        $period = \Carbon\CarbonPeriod::create($startDate, $endDate);

        $datesArray = array_reverse(array_map(function($date) { return $date->format('Y-m-d'); }, iterator_to_array($period)));

        foreach ($datesArray as $dateStr) {
            $dayData = $dataRaw->has($dateStr) ? $dataRaw[$dateStr] : null;

            $doanhThuGoc = $dayData ? floatval($dayData->revenue_total) : 0;
            $orderCount = $dayData ? intval($dayData->order_count) : 0;
            $giaVonGoc = $dayData ? floatval($dayData->cost_total) : 0;

            $hoanTamTinh = $doanhThuGoc * ($returnRate / 100);
            $doanhThuThuc = $doanhThuGoc - $hoanTamTinh;
            $giaVonThuc = $giaVonGoc * (1 - $returnRate / 100);

            $dailyShip = 0;
            $standardOrderCount = 0;

            if ($dayData) {
                $ordersOfDay = Order::whereDate('officialized_at', $dateStr)
                    ->whereNotIn('status', ['cancelled'])
                    ->where(function($q) {
                        $q->where('order_kind', 'official')->orWhereNull('order_kind');
                    })
                    ->where(function($q) {
                        $q->whereNotIn('order_type', ['exchange_return', 'partial_delivery'])->orWhereNull('order_type');
                    })
                    ->get();

                $dailyShip = $ordersOfDay->sum(function($o) use ($shipEstRate, $shipFeeType) {
                    $shipValue = floatval($o->shipping_fee);
                    if ($shipValue > 0) return $shipValue;
                    if ($shipFeeType === 'fixed') {
                        return $shipEstRate;
                    }
                    return floatval($o->total_price) * $shipEstRate / 100;
                });

                $standardOrderCount = $ordersOfDay->count();
            }

            $avgShipSent = $standardOrderCount > 0 ? ($dailyShip / $standardOrderCount) : 0;
            $returnedOrdersCount = $orderCount * ($returnRate / 100);
            $returnedShipFee = round($returnedOrdersCount * ($avgShipSent * 0.5));
            $totalDailyShip = $dailyShip + $returnedShipFee;

            $phiGoiHang = $orderCount * $packFee;
            $thue = ($taxRate / 100) * ($doanhThuThuc - $totalDailyShip);
            $fixedCostDaily = isset($fixedCosts[$dateStr]) ? floatval($fixedCosts[$dateStr]) : 0;

            $fbTaxRate = $config ? floatval($config->fb_tax_rate) : 0;
            $adsSpendRawDaily = isset($adsSpends[$dateStr]) ? floatval($adsSpends[$dateStr]) : 0;
            $adsSpendDaily = $adsSpendRawDaily * (1 + $fbTaxRate / 100);

            $loiNhuanBanMoi = ($doanhThuThuc - $giaVonThuc - $totalDailyShip - $phiGoiHang - $thue - $fixedCostDaily - $adsSpendDaily);
            $extraProfit = $dayData ? floatval($dayData->extra_profit) : 0;
            $tongLoiNhuan = $loiNhuanBanMoi + $extraProfit;

            $report[] = [
                'date' => $dateStr,
                'order_count' => $orderCount,
                'revenue_raw' => $doanhThuGoc,
                'revenue_actual' => $doanhThuThuc,
                'cost_raw' => $giaVonGoc,
                'cost_actual' => $giaVonThuc,
                'shipping_fee' => $totalDailyShip,
                'shipping_out' => $dailyShip,
                'shipping_return' => $returnedShipFee,
                'packaging_fee' => $phiGoiHang,
                'tax' => $thue,
                'fixed_cost' => $fixedCostDaily,
                'ads_spend_raw' => $adsSpendRawDaily,
                'ads_spend' => $adsSpendDaily,
                'extra_profit' => $extraProfit,
                'profit' => $tongLoiNhuan,
                'percent_revenue_actual' => $doanhThuGoc > 0 ? ($doanhThuThuc / $doanhThuGoc * 100) : 0,
                'percent_cost_raw' => $doanhThuGoc > 0 ? ($giaVonGoc / $doanhThuGoc * 100) : 0,
                'percent_cost' => $doanhThuGoc > 0 ? ($giaVonThuc / $doanhThuGoc * 100) : 0,
                'percent_ship' => $doanhThuGoc > 0 ? ($totalDailyShip / $doanhThuGoc * 100) : 0,
                'percent_pack' => $doanhThuGoc > 0 ? ($phiGoiHang / $doanhThuGoc * 100) : 0,
                'percent_tax' => $doanhThuGoc > 0 ? ($thue / $doanhThuGoc * 100) : 0,
                'percent_ads' => $doanhThuGoc > 0 ? ($adsSpendDaily / $doanhThuGoc * 100) : 0,
                'percent_profit' => $doanhThuGoc > 0 ? (($tongLoiNhuan) / $doanhThuGoc * 100) : 0,
            ];
        }

        $reportCollection = collect($report);

        return response()->json([
            'status' => 'success',
            'data' => $report,
            'summary' => [
                'total_profit' => $reportCollection->sum('profit'),
                'total_revenue' => $reportCollection->sum('revenue_raw'),
                'total_orders' => $reportCollection->sum('order_count')
            ]
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
                ->get("https://graph.facebook.com/v19.0/me/adaccounts", [
                'fields' => 'name,adaccount_id,id',
                'access_token' => $token,
                'limit' => 50
            ]);

            if ($response->failed()) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Lỗi từ Facebook: ' . ($response->json()['error']['message'] ?? 'Không xác định')
                ]);
            }

            return response()->json([
                'status' => 'success',
                'data' => $response->json()['data'] ?? []
            ]);
        } catch (\Exception $e) {
            return response()->json(['status' => 'error', 'message' => $e->getMessage()]);
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
            'message' => 'Đồng bộ dữ liệu Facebook Ads thành công (thông minh/bỏ qua ngày đã có)',
            'data' => []
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
        } else if ($config->fb_access_token && $config->fb_ad_account_ids) {
            $tokenConfigs = [
                [
                    'token' => $config->fb_access_token,
                    'account_ids' => $config->fb_ad_account_ids
                ]
            ];
        }

        if (empty($tokenConfigs)) {
            return response()->json(['status' => 'error', 'message' => 'Chưa cấu hình Facebook Access Token']);
        }

        $taxRate = floatval($config->fb_tax_rate ?: 0);

        $dailyData = [];
        $accountsInfo = [];
        $totalRaw = 0;
        $totalTaxed = 0;

        // Initialize daily data matrix for the date range
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
            if (!$token || !$accountIdsStr) continue;

            $adAccountIds = explode(',', $accountIdsStr);

            foreach ($adAccountIds as $adAccountId) {
                $adAccountId = trim($adAccountId);
                if (!$adAccountId) continue;

                if (!str_starts_with($adAccountId, 'act_')) {
                    $adAccountId = 'act_' . $adAccountId;
                }

                if (!isset($accountsInfo[$adAccountId])) {
                    $accountsInfo[$adAccountId] = [
                        'account_id' => $adAccountId,
                        'account_name' => $adAccountId,
                        'total_raw' => 0,
                        'total_taxed' => 0
                    ];
                }

                try {
                    // Try to fetch account name explicitly in case there are no insights
                    $nameResponse = \Illuminate\Support\Facades\Http::withoutVerifying()->get("https://graph.facebook.com/v20.0/{$adAccountId}", [
                        'access_token' => $token,
                        'fields' => 'name',
                    ]);

                    if ($nameResponse->successful()) {
                        $nameData = $nameResponse->json();
                        if (!empty($nameData['name'])) {
                            $accountsInfo[$adAccountId]['account_name'] = $nameData['name'];
                        }
                    }

                    // Fetch insights
                    $response = \Illuminate\Support\Facades\Http::withoutVerifying()->get("https://graph.facebook.com/v20.0/{$adAccountId}/insights", [
                        'access_token' => $token,
                        'time_range' => json_encode(['since' => $startDate, 'until' => $endDate]),
                        'time_increment' => 1,
                        'fields' => 'spend,account_name',
                    ]);

                    if ($response->successful()) {
                        $data = $response->json('data');

                        if (!empty($data) && isset($data[0]['account_name'])) {
                            $accountsInfo[$adAccountId]['account_name'] = $data[0]['account_name'];
                        }

                        foreach ($data as $dayData) {
                            $dateStr = $dayData['date_start'] ?? null;
                            if (!$dateStr) continue;

                            $spendRaw = floatval($dayData['spend'] ?? 0);
                            if ($spendRaw <= 0) continue;

                            $spendTaxed = $spendRaw * (1 + $taxRate / 100);

                            if (!isset($dailyData[$dateStr])) {
                                $dailyData[$dateStr] = []; // In case out of bounds somehow
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
                } catch (\Exception $e) {
                    // ignore or log
                }
            }
        }

        krsort($dailyData); // Sort by date descending

        return response()->json([
            'status' => 'success',
            'data' => [
                'accounts' => array_values($accountsInfo),
                'daily_matrix' => $dailyData,
                'total_raw' => $totalRaw,
                'total_taxed' => $totalTaxed,
                'tax_rate' => $taxRate
            ]
        ]);
    }
}
