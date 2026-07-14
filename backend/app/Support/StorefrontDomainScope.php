<?php

namespace App\Support;

use App\Models\Account;
use App\Models\SiteDomain;
use App\Models\Store;
use App\Models\StorefrontTheme;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

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

        if ($domain->account_id) {
            $accountIds[] = (int) $domain->account_id;
        }

        $accountIds = collect($accountIds)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();

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

    public static function resolvePublicDomainForRequest(Request $request): ?SiteDomain
    {
        return self::resolvePublicDomain($request);
    }

    public static function resolveStorefrontTheme(Request $request, ?int $accountId = null, ?array $accountIds = null, ?array $storeIds = null, ?string $productType = null): ?StorefrontTheme
    {
        if (!Schema::hasTable('storefront_themes')) {
            return null;
        }

        $requestedCode = Str::slug(
            $request->query('storefront_theme')
            ?: $request->query('theme')
            ?: ''
        );

        if ($requestedCode !== '') {
            $requestedTheme = self::themeQueryForAccounts($accountId, $accountIds)
                ->where('code', $requestedCode)
                ->where('status', true)
                ->first();

            if ($requestedTheme instanceof StorefrontTheme) {
                return $requestedTheme;
            }
        }

        $storeTheme = self::resolveStoreAssignedTheme($request, $accountId, $accountIds, $storeIds, $productType);
        if ($storeTheme instanceof StorefrontTheme) {
            return $storeTheme;
        }

        $accountTheme = self::resolveAccountAssignedTheme($accountId, $accountIds, $productType);
        if ($accountTheme instanceof StorefrontTheme) {
            return $accountTheme;
        }

        return self::defaultStorefrontTheme($accountId, $accountIds);
    }

    public static function storefrontThemePayload(?StorefrontTheme $theme): array
    {
        $resolvedTheme = $theme;

        if (!$resolvedTheme instanceof StorefrontTheme && Schema::hasTable('storefront_themes')) {
            $resolvedTheme = self::defaultStorefrontTheme();
        }

        if (!$resolvedTheme instanceof StorefrontTheme) {
            return [
                'id' => null,
                'name' => 'Giao diện số 1',
                'code' => 'do-tho',
                'folder' => 'do-tho',
                'preview_image' => null,
                'description' => null,
                'is_default' => true,
            ];
        }

        return $resolvedTheme->toStorefrontPayload();
    }

    private static function resolveStoreAssignedTheme(Request $request, ?int $accountId = null, ?array $accountIds = null, ?array $storeIds = null, ?string $productType = null): ?StorefrontTheme
    {
        if (!Schema::hasTable('stores')) {
            return null;
        }

        $themeColumns = array_values(array_filter(
            self::themeAssignmentColumns($productType),
            fn (string $column) => Schema::hasColumn('stores', $column)
        ));

        if ($themeColumns === []) {
            return null;
        }

        $storeQuery = Store::withoutGlobalScopes()
            ->where('status', true)
            ->where(function (Builder $query) use ($themeColumns) {
                foreach ($themeColumns as $column) {
                    $query->orWhereNotNull($column);
                }
            })
            ->orderBy('sort_order')
            ->orderBy('id');

        if ($storeIds !== null) {
            $normalizedStoreIds = self::normalizeIds($storeIds);
            if ($normalizedStoreIds === []) {
                return null;
            }

            $storeQuery->whereIn('id', $normalizedStoreIds);
        } else {
            if (!Schema::hasColumn('stores', 'public_domain_id')) {
                return null;
            }

            $domain = self::resolvePublicDomain($request);
            if (!$domain) {
                return null;
            }

            $storeQuery->where('public_domain_id', $domain->id);
        }

        StorefrontDomainScope::applyAccountScope($storeQuery, $accountId, $accountIds, 'stores.account_id');

        $store = $storeQuery->first();

        if (!$store instanceof Store) {
            return null;
        }

        foreach ($themeColumns as $column) {
            $themeId = (int) ($store->{$column} ?? 0);
            if ($themeId > 0) {
                $theme = self::activeThemeById($themeId, $accountId, $accountIds, self::productTypeForAssignmentColumn($column));
                if ($theme instanceof StorefrontTheme) {
                    return $theme;
                }
            }
        }

        return null;
    }

    private static function resolveAccountAssignedTheme(?int $accountId = null, ?array $accountIds = null, ?string $productType = null): ?StorefrontTheme
    {
        if (!Schema::hasTable('accounts')) {
            return null;
        }

        $themeColumns = array_values(array_filter(
            self::themeAssignmentColumns($productType),
            fn (string $column) => Schema::hasColumn('accounts', $column)
        ));

        if ($themeColumns === []) {
            return null;
        }

        $normalizedAccountIds = $accountIds !== null
            ? self::normalizeIds($accountIds)
            : ($accountId ? [(int) $accountId] : []);

        if ($normalizedAccountIds === []) {
            return null;
        }

        $account = Account::query()
            ->whereIn('id', $normalizedAccountIds)
            ->where('status', true)
            ->where(function (Builder $query) use ($themeColumns) {
                foreach ($themeColumns as $column) {
                    $query->orWhereNotNull($column);
                }
            })
            ->orderBy('id')
            ->first();

        if (!$account instanceof Account) {
            return null;
        }

        foreach ($themeColumns as $column) {
            $themeId = (int) ($account->{$column} ?? 0);
            if ($themeId > 0) {
                $theme = self::activeThemeById($themeId, $accountId, $accountIds, self::productTypeForAssignmentColumn($column));
                if ($theme instanceof StorefrontTheme) {
                    return $theme;
                }
            }
        }

        return null;
    }

    private static function activeThemeById(int $themeId, ?int $accountId = null, ?array $accountIds = null, ?string $productType = null): ?StorefrontTheme
    {
        if ($themeId <= 0) {
            return null;
        }

        return self::themeQueryForAccounts($accountId, $accountIds)
            ->whereKey($themeId)
            ->where('status', true)
            ->when($productType, fn (Builder $query) => $query->where('product_type', $productType))
            ->first();
    }

    private static function productTypeForAssignmentColumn(string $column): ?string
    {
        return match ($column) {
            'simple_product_theme_id' => 'simple',
            'configurable_product_theme_id' => 'configurable',
            'bundle_product_theme_id' => 'bundle',
            default => null,
        };
    }

    private static function themeAssignmentColumns(?string $productType = null): array
    {
        $fallbackColumn = 'storefront_theme_id';
        $normalizedType = self::normalizeProductThemeType($productType);

        if ($normalizedType === null) {
            return [$fallbackColumn];
        }

        $typedColumn = match ($normalizedType) {
            'bundle' => 'bundle_product_theme_id',
            'configurable' => 'configurable_product_theme_id',
            default => 'simple_product_theme_id',
        };

        return array_values(array_unique([$typedColumn, $fallbackColumn]));
    }

    private static function normalizeProductThemeType(?string $productType = null): ?string
    {
        $type = Str::lower(Str::squish((string) $productType));

        if ($type === '') {
            return null;
        }

        return match ($type) {
            'bundle' => 'bundle',
            'configurable' => 'configurable',
            default => 'simple',
        };
    }

    private static function defaultStorefrontTheme(?int $accountId = null, ?array $accountIds = null): ?StorefrontTheme
    {
        return self::themeQueryForAccounts($accountId, $accountIds)
            ->where('status', true)
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->first();
    }

    private static function themeQueryForAccounts(?int $accountId = null, ?array $accountIds = null)
    {
        return StorefrontTheme::query()
            ->where(function ($query) use ($accountId, $accountIds) {
                $query->whereNull('account_id');

                $normalizedAccountIds = $accountIds !== null
                    ? self::normalizeIds($accountIds)
                    : ($accountId ? [(int) $accountId] : []);

                if ($normalizedAccountIds !== []) {
                    $query->orWhereIn('account_id', $normalizedAccountIds);
                }
            });
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
