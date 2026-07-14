<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteDomain;
use App\Models\SiteSetting;
use App\Models\Store;
use App\Models\StorefrontTheme;
use App\Services\AccountDataScopeService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class StoreController extends Controller
{
    private const STOREFRONT_THEME_RELATION_SELECT = 'id,name,code,folder,status,is_default,preview_image';

    public function __construct(
        protected AccountDataScopeService $accountDataScopeService
    ) {
    }

    private function storeRelations(): array
    {
        return [
            'publicDomain:id,domain,is_active,is_default',
            'storefrontTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'simpleProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'configurableProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'bundleProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
        ];
    }

    public function index(Request $request)
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);
        $this->seedStoresFromSiteSettingsIfEmpty($accountId);

        $stores = Store::query()
            ->with($this->storeRelations())
            ->when($request->filled('status'), function ($query) use ($request) {
                $query->where('status', filter_var($request->input('status'), FILTER_VALIDATE_BOOLEAN));
            })
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json($stores);
    }

    public function store(Request $request)
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'public_domain_id' => ['nullable', 'integer'],
            'storefront_theme_id' => ['nullable', 'integer'],
            'simple_product_theme_id' => ['nullable', 'integer'],
            'configurable_product_theme_id' => ['nullable', 'integer'],
            'bundle_product_theme_id' => ['nullable', 'integer'],
            'slug' => ['nullable', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        $validated['account_id'] = $accountId;
        $validated['public_domain_id'] = $this->resolvePublicDomainId($validated['public_domain_id'] ?? null, $accountId);
        $validated['storefront_theme_id'] = $this->resolveStorefrontThemeId($validated['storefront_theme_id'] ?? null, $accountId);
        $validated['simple_product_theme_id'] = $this->resolveStorefrontThemeId($validated['simple_product_theme_id'] ?? null, $accountId, 'simple');
        $validated['configurable_product_theme_id'] = $this->resolveStorefrontThemeId($validated['configurable_product_theme_id'] ?? null, $accountId, 'configurable');
        $validated['bundle_product_theme_id'] = $this->resolveStorefrontThemeId($validated['bundle_product_theme_id'] ?? null, $accountId, 'bundle');
        $validated['slug'] = $this->uniqueSlug($validated['slug'] ?? $validated['name'], $accountId);
        $validated['status'] = $validated['status'] ?? true;
        $validated['sort_order'] = $validated['sort_order'] ?? $this->nextSortOrder($accountId);

        $store = Store::create($validated);

        return response()->json($store->load($this->storeRelations()), 201);
    }

    public function update(Request $request, int $id)
    {
        $store = Store::query()->findOrFail($id);
        $accountId = $store->account_id;

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'public_domain_id' => ['nullable', 'integer'],
            'storefront_theme_id' => ['nullable', 'integer'],
            'simple_product_theme_id' => ['nullable', 'integer'],
            'configurable_product_theme_id' => ['nullable', 'integer'],
            'bundle_product_theme_id' => ['nullable', 'integer'],
            'slug' => ['nullable', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        if ($request->has('slug') || $request->has('name')) {
            $validated['slug'] = $this->uniqueSlug(
                $validated['slug'] ?? $validated['name'] ?? $store->name,
                $accountId,
                $store->id
            );
        }

        if ($request->has('public_domain_id')) {
            $validated['public_domain_id'] = $this->resolvePublicDomainId($request->input('public_domain_id'), $accountId);
        }

        if ($request->has('storefront_theme_id')) {
            $validated['storefront_theme_id'] = $this->resolveStorefrontThemeId($request->input('storefront_theme_id'), $accountId);
        }

        foreach ([
            'simple_product_theme_id' => 'simple',
            'configurable_product_theme_id' => 'configurable',
            'bundle_product_theme_id' => 'bundle',
        ] as $themeField => $productType) {
            if ($request->has($themeField)) {
                $validated[$themeField] = $this->resolveStorefrontThemeId($request->input($themeField), $accountId, $productType);
            }
        }

        $store->update($validated);

        return response()->json($store->fresh($this->storeRelations()));
    }

    public function destroy(int $id)
    {
        $store = Store::query()->findOrFail($id);

        $store->delete();

        return response()->json(['message' => 'Store deleted successfully']);
    }

    private function uniqueSlug(string $source, ?int $accountId, ?int $exceptId = null): string
    {
        $baseSlug = Str::slug($source) ?: 'cua-hang';
        $slug = $baseSlug;
        $suffix = 2;

        while (
            Store::withoutGlobalScopes()
                ->where('slug', $slug)
                ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
                ->when($exceptId, fn ($query) => $query->where('id', '!=', $exceptId))
                ->exists()
        ) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function nextSortOrder(?int $accountId): int
    {
        return (int) Store::withoutGlobalScopes()
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->max('sort_order') + 1;
    }

    private function resolvePublicDomainId(mixed $value, ?int $accountId): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (!is_numeric($value) || (int) $value <= 0) {
            abort(422, 'Ten mien public khong hop le.');
        }

        $domainId = (int) $value;
        $exists = SiteDomain::query()
            ->whereKey($domainId)
            ->when($accountId, fn ($query) => $query->where('account_id', $accountId))
            ->exists();

        if (!$exists) {
            abort(422, 'Ten mien public khong ton tai trong account hien tai.');
        }

        return $domainId;
    }

    private function resolveStorefrontThemeId(mixed $value, ?int $accountId, ?string $productType = null): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (!is_numeric($value) || (int) $value <= 0) {
            abort(422, 'Giao dien storefront khong hop le.');
        }

        $themeId = (int) $value;
        $exists = StorefrontTheme::query()
            ->whereKey($themeId)
            ->where('status', true)
            ->when($productType, fn ($query) => $query->where('product_type', $productType))
            ->where(function ($query) use ($accountId) {
                $query->whereNull('account_id');

                if ($accountId) {
                    $query->orWhere('account_id', $accountId);
                }
            })
            ->exists();

        if (!$exists) {
            abort(422, 'Giao dien storefront khong ton tai trong account hien tai.');
        }

        return $themeId;
    }

    private function seedStoresFromSiteSettingsIfEmpty(?int $accountId): void
    {
        if (!$accountId) {
            return;
        }

        $hasStores = Store::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->exists();

        if ($hasStores) {
            return;
        }

        $rawLocations = SiteSetting::getValue('store_locations', $accountId);
        $locations = is_string($rawLocations) ? json_decode($rawLocations, true) : $rawLocations;

        if (!is_array($locations)) {
            return;
        }

        foreach (array_values($locations) as $index => $location) {
            if (!is_array($location)) {
                continue;
            }

            $name = trim((string) ($location['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            Store::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'public_domain_id' => $this->resolvePublicDomainId($location['public_domain_id'] ?? null, $accountId),
                'storefront_theme_id' => $this->resolveStorefrontThemeId($location['storefront_theme_id'] ?? null, $accountId),
                'simple_product_theme_id' => $this->resolveStorefrontThemeId($location['simple_product_theme_id'] ?? null, $accountId, 'simple'),
                'configurable_product_theme_id' => $this->resolveStorefrontThemeId($location['configurable_product_theme_id'] ?? null, $accountId, 'configurable'),
                'bundle_product_theme_id' => $this->resolveStorefrontThemeId($location['bundle_product_theme_id'] ?? null, $accountId, 'bundle'),
                'name' => $name,
                'slug' => $this->uniqueSlug($name, $accountId),
                'code' => trim((string) ($location['id'] ?? '')) ?: 'store-location-' . ($index + 1),
                'phone' => trim((string) ($location['phone'] ?? $location['hotline'] ?? '')) ?: null,
                'address' => trim((string) ($location['address'] ?? '')) ?: null,
                'status' => array_key_exists('is_active', $location) ? (bool) $location['is_active'] : true,
                'sort_order' => (int) ($location['order'] ?? $location['sort_order'] ?? ($index + 1)),
            ]);
        }
    }
}
