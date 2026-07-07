<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use App\Models\Store;
use App\Services\AccountDataScopeService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class StoreController extends Controller
{
    public function __construct(
        protected AccountDataScopeService $accountDataScopeService
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);
        $this->seedStoresFromSiteSettingsIfEmpty($accountId);

        $stores = Store::query()
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
            'slug' => ['nullable', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:80'],
            'phone' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);

        $validated['account_id'] = $accountId;
        $validated['slug'] = $this->uniqueSlug($validated['slug'] ?? $validated['name'], $accountId);
        $validated['status'] = $validated['status'] ?? true;
        $validated['sort_order'] = $validated['sort_order'] ?? $this->nextSortOrder($accountId);

        $store = Store::create($validated);

        return response()->json($store, 201);
    }

    public function update(Request $request, int $id)
    {
        $store = Store::query()->findOrFail($id);
        $accountId = $store->account_id;

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
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

        $store->update($validated);

        return response()->json($store->fresh());
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
