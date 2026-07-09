<?php

namespace App\Support;

use App\Models\Account;
use App\Models\SiteDomain;
use App\Models\Store;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class StorefrontDomainScope
{
    public static function resolveAccountIds(Request $request, ?int $accountId = null): ?array
    {
        if (
            !Schema::hasTable('accounts')
            || !Schema::hasTable('site_domains')
            || !Schema::hasColumn('accounts', 'public_domain_id')
        ) {
            return null;
        }

        $domain = self::resolvePublicDomain($request);
        if (!$domain) {
            return null;
        }

        $accountIds = Account::query()
            ->where('public_domain_id', $domain->id)
            ->where('status', true)
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($accountId) => (int) $accountId)
            ->values()
            ->all();

        if ($accountIds === [] && $domain->account_id) {
            $accountIds = [(int) $domain->account_id];
        }

        return $accountIds === [] ? null : $accountIds;
    }

    public static function resolveStoreIds(Request $request, ?int $accountId = null, ?array $accountIds = null): ?array
    {
        if (
            !Schema::hasTable('stores')
            || !Schema::hasTable('site_domains')
            || !Schema::hasColumn('stores', 'public_domain_id')
        ) {
            return null;
        }

        $domain = self::resolvePublicDomain($request);
        if (!$domain) {
            return null;
        }

        if (self::hasAccountLevelDomainAssignments($domain)) {
            return null;
        }

        $storeIds = Store::withoutGlobalScopes()
            ->where('public_domain_id', $domain->id)
            ->when(
                $accountIds !== null,
                fn (Builder $query) => $query->whereIn('account_id', self::normalizeIds($accountIds)),
                fn (Builder $query) => $query->when($accountId, fn (Builder $q) => $q->where('account_id', $accountId))
            )
            ->where('status', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($storeId) => (int) $storeId)
            ->values()
            ->all();

        return $storeIds === [] ? null : $storeIds;
    }

    private static function hasAccountLevelDomainAssignments(SiteDomain $domain): bool
    {
        if (
            !Schema::hasTable('accounts')
            || !Schema::hasColumn('accounts', 'public_domain_id')
        ) {
            return false;
        }

        return Account::query()
            ->where('public_domain_id', $domain->id)
            ->where('status', true)
            ->exists();
    }

    public static function applyAccountScope($query, ?int $accountId, ?array $accountIds, string $qualifiedColumn)
    {
        if ($accountIds !== null) {
            $normalizedAccountIds = self::normalizeIds($accountIds);

            return $normalizedAccountIds === []
                ? $query->whereRaw('1 = 0')
                : $query->whereIn($qualifiedColumn, $normalizedAccountIds);
        }

        if ($accountId) {
            return $query->where($qualifiedColumn, $accountId);
        }

        return $query;
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

    public static function cacheSegment(Request $request, ?array $storeIds, ?array $accountIds = null): string
    {
        if ($storeIds === null && $accountIds === null) {
            return 'all';
        }

        $segments = [];
        if ($accountIds !== null) {
            $segments[] = 'accounts:' . implode('-', self::normalizeIds($accountIds));
        }

        if ($storeIds !== null) {
            $segments[] = 'stores:' . implode('-', self::normalizeIds($storeIds));
        }

        return implode('|', $segments);
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

    private static function resolvePublicDomain(Request $request): ?SiteDomain
    {
        $host = self::publicHost($request);
        if ($host === '' || self::isLocalHost($host) || str_starts_with($host, 'admin.')) {
            return null;
        }

        return SiteDomain::query()
            ->where('is_active', true)
            ->get(['id', 'account_id', 'domain'])
            ->first(function (SiteDomain $siteDomain) use ($host) {
                $domainHost = self::normalizeHost($siteDomain->domain);

                return $domainHost !== '' && in_array($domainHost, self::hostCandidates($host), true);
            });
    }

    private static function normalizeIds(array $ids): array
    {
        return collect($ids)
            ->filter(fn ($id) => is_numeric($id) && (int) $id > 0)
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }
}
