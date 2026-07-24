<?php

namespace App\Http\Middleware;

use App\Services\AuditLogService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuditAdminAction
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if ($this->shouldAudit($request, $response)) {
            app(AuditLogService::class)->logFromRequest(
                $request,
                $response->getStatusCode(),
                $this->resolveModule($request),
                strtolower($request->method())
            );
        }

        return $response;
    }

    private function shouldAudit(Request $request, Response $response): bool
    {
        if ($response->getStatusCode() >= 400 || !$request->user()) {
            return false;
        }

        if (in_array(strtoupper($request->method()), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return false;
        }

        $path = preg_replace('#^api/#', '', trim($request->path(), '/'));

        if ($path === 'products/refresh-order-items') {
            return false;
        }

        return (bool) preg_match(
            '#^(users|accounts|products|product-images|categories|attributes|menus|orders|shipments|customers|leads|lead-|inventory|stock-|warehouses|blog|reports|finance|payroll|banners|site-|shipping-|carrier-|order-statuses|quote-templates)(/|$)#',
            $path
        );
    }

    private function resolveModule(Request $request): ?string
    {
        $path = preg_replace('#^api/#', '', trim($request->path(), '/'));
        $segment = explode('/', $path)[0] ?? null;

        return $segment ?: null;
    }
}
