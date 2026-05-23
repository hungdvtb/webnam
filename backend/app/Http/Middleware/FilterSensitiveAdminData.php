<?php

namespace App\Http\Middleware;

use App\Services\AccessControlService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class FilterSensitiveAdminData
{
    private const COST_KEYS = [
        'cost_total',
        'total_cost',
        'cost_price',
        'expected_cost',
        'current_cost',
        'supplier_unit_cost',
        'source_unit_cost',
        'import_cost',
        'display_cost',
        'landed_cost',
        'unit_cost',
        'line_cost',
        'cost_source',
        'report_cost_total',
    ];

    private const PROFIT_KEYS = [
        'gross_profit',
        'gross_profit_total',
        'profit',
        'profit_total',
        'report_profit_total',
        'net_profit',
        'profit_margin',
        'margin',
        'daily_profit',
        'monthly_profit',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$response instanceof JsonResponse || !$this->shouldFilterPath($request)) {
            return $response;
        }

        $access = app(AccessControlService::class);
        $user = $access->resolveUserFromRequest($request);
        if (!$user) {
            return $response;
        }

        $accountId = $access->resolveAccountIdFromRequest($request);
        $canViewCost = $access->canViewData($user, 'cost.view', $accountId);
        $canViewProfit = $access->canViewData($user, 'profit.view', $accountId);

        if ($canViewCost && $canViewProfit) {
            return $response;
        }

        $data = $response->getData(true);
        $filtered = $this->filterValue($data, $canViewCost, $canViewProfit);

        $response->setData($filtered);

        return $response;
    }

    private function shouldFilterPath(Request $request): bool
    {
        $path = preg_replace('#^api/#', '', trim($request->path(), '/'));

        return (bool) preg_match('#^(products|storefront/products|web-api/products|orders|inventory|stock-|finance|reports)(/|$)#', $path);
    }

    private function filterValue(mixed $value, bool $canViewCost, bool $canViewProfit): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $filtered = [];
        foreach ($value as $key => $item) {
            $normalizedKey = strtolower((string) $key);

            if (!$canViewCost && in_array($normalizedKey, self::COST_KEYS, true)) {
                continue;
            }

            if (!$canViewProfit && in_array($normalizedKey, self::PROFIT_KEYS, true)) {
                continue;
            }

            $filtered[$key] = $this->filterValue($item, $canViewCost, $canViewProfit);
        }

        return $filtered;
    }
}
