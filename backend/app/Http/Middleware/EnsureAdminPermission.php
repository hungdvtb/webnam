<?php

namespace App\Http\Middleware;

use App\Services\AccessControlService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminPermission
{
    public function handle(Request $request, Closure $next): Response
    {
        $permission = $this->resolveRequiredPermission($request);
        if ($permission === null) {
            return $next($request);
        }

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $access = app(AccessControlService::class);
        $accountId = $access->resolveAccountIdFromRequest($request);

        if (!$access->can($user, $permission, $accountId)) {
            return response()->json([
                'message' => 'Bạn không có quyền thực hiện thao tác này.',
                'required_permission' => $permission,
            ], 403);
        }

        return $next($request);
    }

    private function resolveRequiredPermission(Request $request): ?string
    {
        $path = preg_replace('#^api/#', '', trim($request->path(), '/'));

        if ($path === '' || $this->isNonAdminPath($path)) {
            return null;
        }

        if ($path === 'accounts' && strtoupper($request->method()) === 'GET') {
            return null;
        }

        if (preg_match('#^order-statuses(/|$)#', $path) && strtoupper($request->method()) === 'GET') {
            return 'orders.view';
        }

        if (preg_match('#^users/\d+/password$#', $path)) {
            return AccessControlService::USER_CHANGE_PASSWORD_PERMISSION;
        }

        $module = $this->resolveModule($path);
        if ($module === null) {
            return null;
        }

        if ($module === 'users') {
            return 'users.manage';
        }

        return "{$module}.{$this->resolveAction($request, $path)}";
    }

    private function isNonAdminPath(string $path): bool
    {
        if (preg_match('#^(user|logout|user-settings|cart|wishlist)(/|$)#', $path)) {
            return true;
        }

        if (preg_match('#^products/\d+/reviews#', $path)) {
            return true;
        }

        return false;
    }

    private function resolveModule(string $path): ?string
    {
        $rules = [
            '#^accounts(/|$)#' => 'accounts',
            '#^users(/|$)#' => 'users',
            '#^products(/|$)#' => 'products',
            '#^product-images(/|$)#' => 'products',
            '#^google-merchant(/|$)#' => 'products',
            '#^meta-catalog(/|$)#' => 'products',
            '#^categories(/|$)#' => 'categories',
            '#^attributes(/|$)#' => 'attributes',
            '#^menus(/|$)#' => 'menus',
            '#^(banners|site-settings|site-domains|quote-templates|shipping-settings|carrier-mappings|order-statuses)(/|$)#' => 'settings',
            '#^orders(/|$)#' => 'orders',
            '#^shipments(/|$)#' => 'orders',
            '#^customers(/|$)#' => 'customers',
            '#^(leads|lead-statuses|lead-staffs|lead-tag-rules)(/|$)#' => 'leads',
            '#^(inventory|stock-movements|stock-transfers)(/|$)#' => 'inventory',
            '#^warehouses(/|$)#' => 'warehouses',
            '#^blog(/|$)#' => 'blog',
            '#^reports(/|$)#' => 'reports',
            '#^finance(/|$)#' => 'reports',
            '#^payroll(/|$)#' => 'payroll',
            '#^coupons(/|$)#' => 'settings',
            '#^admin/reviews(/|$)#' => 'products',
            '#^ai/(generate|read|rewrite)(/|$)#' => 'products',
            '#^media/upload$#' => 'blog',
            '#^invoices(/|$)#' => 'orders',
        ];

        foreach ($rules as $pattern => $module) {
            if (preg_match($pattern, $path)) {
                return $module;
            }
        }

        return null;
    }

    private function resolveAction(Request $request, string $path): string
    {
        $method = strtoupper($request->method());

        if ($method === 'GET' || $method === 'HEAD') {
            if (str_contains($path, 'export')) {
                return 'export';
            }

            return 'view';
        }

        if (str_contains($path, 'force') || str_contains($path, 'permanent')) {
            return 'delete_permanent';
        }

        if ($method === 'DELETE' || str_contains($path, 'bulk-delete')) {
            return 'delete_soft';
        }

        if (preg_match('#/(restore|reorder|sync|refresh|status|dispatch|convert|duplicate|mark-|cancel|apply|pay|adjust|complete)(/|$|-)#', $path)) {
            return 'update';
        }

        if ($method === 'PUT' || $method === 'PATCH') {
            return 'update';
        }

        return 'create';
    }
}
