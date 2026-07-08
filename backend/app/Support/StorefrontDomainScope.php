<?php

namespace App\Support;

use App\Models\SiteDomain;
use App\Models\Store;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class StorefrontDomainScope
{
    public static function resolveStoreIds(Request $request, ?int $accountId = null): ?array
    {
        if (
            !Schema::hasTable('stores')
            || !Schema::hasTable('site_domains')
            || !Schema::hasColumn('stores', 'public_domain_id')
        ) {
            return null;
        }

        $host = self::publicHost($request);
        if ($host === '' || self::isLocalHost($host) || str_starts_with($host, 'admin.')) {
            return null;
        }

        $domain = SiteDomain::query()
            ->when($accountId, fn (Builder $query) => $query->where('account_id', $accountId))
            ->where('is_active', true)
            ->get(['id', 'domain'])
            ->first(function (SiteDomain $siteDomain) use ($host) {
                $domainHost = self::normalizeHost($siteDomain->domain);

                return $domainHost !== '' && in_array($domainHost, self::hostCandidates($host), true);
            });

        if (!$domain) {
            return null;
        }

        $storeIds = Store::withoutGlobalScopes()
            ->where('public_domain_id', $domain->id)
            ->when($accountId, fn (Builder $query) => $query->where('account_id', $accountId))
            ->where('status', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($storeId) => (int) $storeId)
            ->values()
            ->all();

        return $storeIds === [] ? null : $storeIds;
    }

    public static function applyStoreScope($query, ?array $storeIds, string $qualifiedColumn)
    {
        if ($storeIds === null) {
            return $query;
        }

        $normalizedStoreIds = collect($storeIds)
            ->filter(fn ($storeId) => is_numeric($storeId) && (int) $storeId > 0)
            ->map(fn ($storeId) => (int) $storeId)
            ->unique()
            ->values()
            ->all();

        if ($normalizedStoreIds === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query->whereIn($qualifiedColumn, $normalizedStoreIds);
    }

    public static function cacheSegment(Request $request, ?array $storeIds): string
    {
        if ($storeIds === null) {
            return 'all';
        }

        return 'stores:' . implode('-', array_map('intval', $storeIds));
    }

    public static function publicHost(Request $request): string
    {
        $rawHost = $request->query('public_host')
            ?: $request->header('X-Public-Host')
            ?: $request->header('X-Forwarded-Host')
            ?: $request->getHost();

        if (is_string($rawHost) && str_contains($rawHost, ',')) {
            $rawHost = trim(explode(',', $rawHost)[0] ?? '');
        }

        return self::normalizeHost($rawHost);
    }

    public static function normalizeHost(mixed $value): string
    {
        $raw = strtolower(trim((string) $value));
        if ($raw === '') {
            return '';
        }

        if (!preg_match('#^[a-z][a-z0-9+.-]*://#i', $raw)) {
            $raw = 'https://' . ltrim($raw, '/');
        }

        $host = parse_url($raw, PHP_URL_HOST);
        if (!is_string($host) || trim($host) === '') {
            return '';
        }

        return trim(strtolower($host), " \t\n\r\0\x0B.");
    }

    private static function hostCandidates(string $host): array
    {
        $candidates = [$host];

        if (str_starts_with($host, 'www.')) {
            $candidates[] = substr($host, 4);
        } else {
            $candidates[] = 'www.' . $host;
        }

        return array_values(array_unique(array_filter($candidates)));
    }

    private static function isLocalHost(string $host): bool
    {
        return in_array($host, ['localhost', '127.0.0.1', '::1'], true);
    }
}
