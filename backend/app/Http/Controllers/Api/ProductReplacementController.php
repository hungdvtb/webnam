<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\Product;
use App\Models\ProductReplacementGroup;
use App\Models\ProductReplacementItem;
use App\Services\AccountDataScopeService;
use App\Support\InventoryQuantity;
use App\Services\AccessControlService;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ProductReplacementController extends Controller
{
    public function __construct(private readonly AccountDataScopeService $accountDataScopeService)
    {
    }

    public function index(Request $request)
    {
        $search = trim((string) $request->input('search', ''));
        $canViewCost = $this->canViewReplacementDataPermission($request, 'cost.view');
        $canViewProfit = $this->canViewReplacementDataPermission($request, 'profit.view');
        $perPage = max(5, min(100, (int) $request->input('per_page', 30)));

        $query = ProductReplacementGroup::query()
            ->with(['items.product.unit'])
            ->withCount('items')
            ->latest('id');

        if ($search !== '') {
            $query->where(function ($builder) use ($search) {
                $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search) . '%';

                $builder
                    ->where('name', 'like', $like)
                    ->orWhere('notes', 'like', $like)
                    ->orWhereHas('items', function ($itemQuery) use ($like) {
                        $itemQuery
                            ->where('product_sku_snapshot', 'like', $like)
                            ->orWhere('product_name_snapshot', 'like', $like)
                            ->orWhereHas('product', function ($productQuery) use ($like) {
                                $productQuery
                                    ->where('sku', 'like', $like)
                                    ->orWhere('name', 'like', $like);
                            });
                    });
            });
        }

        $groups = $query->paginate($perPage);
        $productIds = collect($groups->items())
            ->flatMap(fn (ProductReplacementGroup $group) => $group->items->pluck('product_id'))
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $locationsByProductId = $this->warehouseLocationsByProductId($productIds);

        return response()->json([
            'data' => collect($groups->items())
                ->map(fn (ProductReplacementGroup $group) => $this->groupPayload($group, $locationsByProductId, $canViewCost, $canViewProfit))
                ->values()
                ->all(),
            'current_page' => $groups->currentPage(),
            'last_page' => $groups->lastPage(),
            'per_page' => $groups->perPage(),
            'total' => $groups->total(),
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'expression' => 'nullable|string|max:5000|required_without:skus',
            'skus' => 'nullable|array|min:2|required_without:expression',
            'skus.*' => 'required|string|max:120',
            'name' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:2000',
        ]);

        $products = $this->resolveProductsFromRequest($validated);
        $group = DB::transaction(function () use ($request, $validated, $products) {
            return $this->mergeProductsIntoReplacementGroup(
                $request,
                $products,
                trim((string) ($validated['name'] ?? '')) ?: null,
                trim((string) ($validated['notes'] ?? '')) ?: null
            );
        });

        return response()->json([
            'data' => $this->groupPayload(
                $group->load(['items.product.unit']),
                [],
                $this->canViewReplacementDataPermission($request, 'cost.view'),
                $this->canViewReplacementDataPermission($request, 'profit.view')
            ),
        ], 201);
    }

    public function update(Request $request, int $id)
    {
        $group = ProductReplacementGroup::query()->findOrFail($id);
        $validated = $request->validate([
            'expression' => 'nullable|string|max:5000|required_without:skus',
            'skus' => 'nullable|array|min:2|required_without:expression',
            'skus.*' => 'required|string|max:120',
            'name' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:2000',
        ]);

        $products = $this->resolveProductsFromRequest($validated);
        $group = DB::transaction(function () use ($request, $group, $validated, $products) {
            return $this->replaceProductsInReplacementGroup(
                $request,
                $group,
                $products,
                trim((string) ($validated['name'] ?? '')) ?: null,
                trim((string) ($validated['notes'] ?? '')) ?: null
            );
        });

        return response()->json([
            'data' => $this->groupPayload(
                $group->load(['items.product.unit']),
                [],
                $this->canViewReplacementDataPermission($request, 'cost.view'),
                $this->canViewReplacementDataPermission($request, 'profit.view')
            ),
        ]);
    }

    public function destroy(int $id)
    {
        ProductReplacementGroup::query()->findOrFail($id)->delete();

        return response()->json(['message' => 'Đã xóa nhóm mã thay thế.']);
    }

    public function lookup(Request $request)
    {
        $validated = $request->validate([
            'sku' => 'nullable|string|max:120',
            'product_id' => 'nullable|integer',
            'locked_price' => 'nullable|numeric|min:0',
            'order_price' => 'nullable|numeric|min:0',
            'quantity' => 'nullable|numeric|min:0',
        ]);

        $canViewCost = $this->canViewReplacementDataPermission($request, 'cost.view');
        $canViewProfit = $this->canViewReplacementDataPermission($request, 'profit.view');
        $product = $this->findLookupProduct($validated);
        if (!$product) {
            return response()->json([
                'data' => [
                    'query' => [
                        'sku' => trim((string) ($validated['sku'] ?? '')),
                        'product_id' => (int) ($validated['product_id'] ?? 0) ?: null,
                    ],
                    'product' => null,
                    'group' => null,
                    'alternatives' => [],
                    'suggestions' => [],
                ],
            ]);
        }

        $group = ProductReplacementItem::query()
            ->where('product_id', $product->id)
            ->with('group.items.product.unit')
            ->first()
            ?->group;

        $lockedPrice = $this->resolveLockedPrice($validated, $product);
        $quantity = max(1, InventoryQuantity::normalize($validated['quantity'] ?? 1));

        if (!$group) {
            return response()->json([
                'data' => [
                    'query' => [
                        'sku' => $product->sku,
                        'product_id' => (int) $product->id,
                    ],
                    'product' => $this->productPayload($product, [], $lockedPrice, $quantity, $canViewCost, $canViewProfit),
                    'group' => null,
                    'alternatives' => [],
                    'suggestions' => [],
                ],
            ]);
        }

        $group->loadMissing(['items.product.unit']);
        $productIds = $group->items
            ->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
        $locationsByProductId = $this->warehouseLocationsByProductId($productIds);

        $alternatives = $group->items
            ->filter(fn (ProductReplacementItem $item) => (int) $item->product_id !== (int) $product->id)
            ->map(fn (ProductReplacementItem $item) => $this->replacementEntryPayload($item, $locationsByProductId, $lockedPrice, $quantity, $canViewCost, $canViewProfit))
            ->filter()
            ->sortBy([
                ['is_available', 'desc'],
                ['available_to_sell', 'desc'],
                ['sort_order', 'asc'],
                ['sku', 'asc'],
            ])
            ->values()
            ->all();

        return response()->json([
            'data' => [
                'query' => [
                    'sku' => $product->sku,
                    'product_id' => (int) $product->id,
                ],
                'product' => $this->productPayload($product, $locationsByProductId[(int) $product->id] ?? [], $lockedPrice, $quantity, $canViewCost, $canViewProfit),
                'group' => $this->groupPayload($group, $locationsByProductId, $canViewCost, $canViewProfit),
                'alternatives' => $alternatives,
                'suggestions' => $alternatives,
            ],
        ]);
    }

    private function resolveProductsFromRequest(array $validated): EloquentCollection
    {
        $skus = $this->parseSkuList($validated['skus'] ?? null, $validated['expression'] ?? null);
        if (count($skus) < 2) {
            throw ValidationException::withMessages([
                'expression' => 'Cần ít nhất 2 mã sản phẩm để tạo nhóm thay thế.',
            ]);
        }

        $products = $this->productsBySku($skus);
        $foundSkuKeys = $products
            ->map(fn (Product $product) => $this->normalizeSkuKey($product->sku))
            ->filter()
            ->unique()
            ->values()
            ->all();
        $missingSkus = collect($skus)
            ->reject(fn (string $sku) => in_array($this->normalizeSkuKey($sku), $foundSkuKeys, true))
            ->values()
            ->all();

        if (!empty($missingSkus)) {
            throw ValidationException::withMessages([
                'expression' => 'Không tìm thấy mã sản phẩm: ' . implode(', ', $missingSkus),
            ]);
        }

        return $products->values();
    }

    private function mergeProductsIntoReplacementGroup(
        Request $request,
        EloquentCollection $products,
        ?string $name,
        ?string $notes
    ): ProductReplacementGroup {
        $accountId = $this->catalogAccountId($request);
        $productIds = $products->pluck('id')->map(fn ($id) => (int) $id)->all();
        $existingGroupIds = ProductReplacementItem::query()
            ->whereIn('product_id', $productIds)
            ->pluck('group_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        if ($existingGroupIds->isNotEmpty()) {
            $keepGroup = ProductReplacementGroup::query()
                ->whereIn('id', $existingGroupIds->all())
                ->orderBy('id')
                ->firstOrFail();
            $allProductIds = ProductReplacementItem::query()
                ->whereIn('group_id', $existingGroupIds->all())
                ->pluck('product_id')
                ->merge($productIds)
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();

            ProductReplacementItem::query()
                ->whereIn('group_id', $existingGroupIds->all())
                ->delete();
            ProductReplacementGroup::query()
                ->whereIn('id', $existingGroupIds->reject(fn (int $id) => $id === (int) $keepGroup->id)->all())
                ->delete();

            $keepGroup->fill([
                'name' => $name ?: $keepGroup->name,
                'notes' => $notes ?? $keepGroup->notes,
            ])->save();

            return $this->syncGroupProducts($keepGroup, $this->productsByIds($allProductIds), $accountId);
        }

        $group = ProductReplacementGroup::query()->create([
            'account_id' => $accountId,
            'name' => $name,
            'notes' => $notes,
        ]);

        return $this->syncGroupProducts($group, $products, $accountId);
    }

    private function replaceProductsInReplacementGroup(
        Request $request,
        ProductReplacementGroup $group,
        EloquentCollection $products,
        ?string $name,
        ?string $notes
    ): ProductReplacementGroup {
        $accountId = $this->catalogAccountId($request);
        $productIds = $products->pluck('id')->map(fn ($id) => (int) $id)->all();
        $otherGroupIds = ProductReplacementItem::query()
            ->whereIn('product_id', $productIds)
            ->where('group_id', '!=', $group->id)
            ->pluck('group_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        if (!empty($otherGroupIds)) {
            ProductReplacementItem::query()->whereIn('group_id', $otherGroupIds)->delete();
            ProductReplacementGroup::query()->whereIn('id', $otherGroupIds)->delete();
        }

        ProductReplacementItem::query()->where('group_id', $group->id)->delete();
        $group->fill([
            'name' => $name,
            'notes' => $notes,
        ])->save();

        return $this->syncGroupProducts($group, $products, $accountId);
    }

    private function syncGroupProducts(ProductReplacementGroup $group, EloquentCollection $products, int $accountId): ProductReplacementGroup
    {
        $products->values()->each(function (Product $product, int $index) use ($group, $accountId) {
            ProductReplacementItem::query()->create([
                'account_id' => $accountId,
                'group_id' => $group->id,
                'product_id' => $product->id,
                'product_sku_snapshot' => $product->sku,
                'product_name_snapshot' => $product->name,
                'sort_order' => $index + 1,
            ]);
        });

        return $group->refresh()->load(['items.product.unit']);
    }

    private function parseSkuList(mixed $skus, ?string $expression): array
    {
        $rawValues = is_array($skus) ? $skus : [];
        if ($expression !== null && trim($expression) !== '') {
            $rawValues = array_merge($rawValues, preg_split('/[=\r\n,;]+/u', $expression) ?: []);
        }

        return collect($rawValues)
            ->map(fn ($sku) => trim((string) $sku))
            ->filter()
            ->unique(fn (string $sku) => $this->normalizeSkuKey($sku))
            ->values()
            ->all();
    }

    private function productsBySku(array $skus): EloquentCollection
    {
        $skuKeys = collect($skus)
            ->map(fn (string $sku) => $this->normalizeSkuKey($sku))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($skuKeys)) {
            return new EloquentCollection();
        }

        return Product::query()
            ->with(['unit'])
            ->whereIn(DB::raw('LOWER(sku)'), $skuKeys)
            ->get()
            ->sortBy(fn (Product $product) => array_search($this->normalizeSkuKey($product->sku), $skuKeys, true))
            ->values();
    }

    private function productsByIds(array $productIds): EloquentCollection
    {
        $ids = collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($ids)) {
            return new EloquentCollection();
        }

        return Product::query()
            ->with(['unit'])
            ->whereIn('id', $ids)
            ->get()
            ->sortBy(fn (Product $product) => array_search((int) $product->id, $ids, true))
            ->values();
    }

    private function findLookupProduct(array $validated): ?Product
    {
        $skuKey = $this->normalizeSkuKey($validated['sku'] ?? '');
        if ($skuKey !== '') {
            $productBySku = Product::withTrashed()
                ->with(['unit'])
                ->whereRaw('LOWER(sku) = ?', [$skuKey])
                ->first();

            if ($productBySku) {
                return $productBySku;
            }
        }

        $productId = (int) ($validated['product_id'] ?? 0);
        if ($productId > 0) {
            return Product::withTrashed()
                ->with(['unit'])
                ->whereKey($productId)
                ->first();
        }

        return null;
    }

    private function resolveLockedPrice(array $validated, Product $product): float
    {
        $rawPrice = $validated['locked_price'] ?? $validated['order_price'] ?? null;

        return round((float) ($rawPrice ?? $product->price ?? 0), 2);
    }

    private function groupPayload(
        ProductReplacementGroup $group,
        array $locationsByProductId = [],
        bool $canViewCost = true,
        bool $canViewProfit = true
    ): array
    {
        $items = $group->items
            ->map(fn (ProductReplacementItem $item) => $this->replacementEntryPayload($item, $locationsByProductId, null, 1, $canViewCost, $canViewProfit))
            ->filter()
            ->values()
            ->all();

        return [
            'id' => (int) $group->id,
            'name' => $group->name,
            'notes' => $group->notes,
            'items_count' => count($items),
            'expression' => collect($items)->pluck('sku')->filter()->implode(' = '),
            'items' => $items,
            'created_at' => $group->created_at,
            'updated_at' => $group->updated_at,
        ];
    }

    private function replacementEntryPayload(
        ProductReplacementItem $item,
        array $locationsByProductId = [],
        ?float $lockedPrice = null,
        float $quantity = 1,
        bool $canViewCost = true,
        bool $canViewProfit = true
    ): ?array {
        $product = $item->product;
        if (!$product) {
            return null;
        }

        $payload = $this->productPayload(
            $product,
            $locationsByProductId[(int) $product->id] ?? [],
            $lockedPrice,
            $quantity,
            $canViewCost,
            $canViewProfit
        );

        return array_merge($payload, [
            'replacement_item_id' => (int) $item->id,
            'replacement_group_id' => (int) $item->group_id,
            'sort_order' => (int) $item->sort_order,
            'entry_id' => 'product-replacement-' . (int) $item->group_id . '-' . (int) $product->id,
            'entry_kind' => 'product',
            'target_product_id' => (int) $product->id,
            'product_id' => (int) $product->id,
            'display_name' => $payload['name'],
            'display_sku' => $payload['sku'],
            'is_declared_replacement' => true,
        ]);
    }

    private function productPayload(
        Product $product,
        array $warehouseLocations = [],
        ?float $lockedPrice = null,
        float $quantity = 1,
        bool $canViewCost = true,
        bool $canViewProfit = true
    ): array
    {
        $stockQuantity = InventoryQuantity::normalize($product->stock_quantity ?? 0);
        $warehouseQuantity = collect($warehouseLocations)->sum(fn (array $location) => InventoryQuantity::normalize($location['quantity'] ?? 0));
        $costPrice = round((float) ($product->cost_price ?? $product->expected_cost ?? 0), 2);
        $listPrice = round((float) ($product->price ?? 0), 2);
        $effectiveSellingPrice = round((float) ($lockedPrice ?? $listPrice), 2);
        $lineCost = round($costPrice * $quantity, 2);
        $lineRevenue = round($effectiveSellingPrice * $quantity, 2);

        $payload = [
            'id' => (int) $product->id,
            'product_id' => (int) $product->id,
            'account_id' => (int) ($product->account_id ?? 0),
            'sku' => $product->sku,
            'display_sku' => $product->sku,
            'name' => $product->name,
            'display_name' => $product->name,
            'price' => $listPrice,
            'list_price' => $listPrice,
            'locked_price' => $effectiveSellingPrice,
            'effective_selling_price' => $effectiveSellingPrice,
            'price_delta' => round($listPrice - $effectiveSellingPrice, 2),
            'expected_cost' => $product->expected_cost !== null ? (float) $product->expected_cost : null,
            'cost_price' => $costPrice,
            'replacement_cost_price' => $costPrice,
            'replacement_profit_total' => round($lineRevenue - $lineCost, 2),
            'quantity' => $quantity,
            'unit_name' => $product->unit?->name,
            'stock_quantity' => $stockQuantity,
            'computed_stock' => $stockQuantity,
            'pending_export_quantity' => null,
            'available_to_sell' => $stockQuantity,
            'warehouse_quantity' => $warehouseQuantity,
            'warehouse_locations' => $warehouseLocations,
            'status' => (bool) $product->status,
            'deleted' => $product->trashed(),
            'is_available' => !$product->trashed() && (bool) $product->status && $stockQuantity > 0,
        ];

        if (!$canViewCost) {
            $payload['expected_cost'] = null;
            $payload['cost_price'] = null;
            $payload['replacement_cost_price'] = null;
        }

        if (!$canViewProfit) {
            $payload['replacement_profit_total'] = null;
        }

        return $payload;
    }

    private function canViewReplacementDataPermission(Request $request, string $permission): bool
    {
        $access = app(AccessControlService::class);
        $user = $access->resolveUserFromRequest($request);

        if (!$user) {
            return false;
        }

        return $access->canViewData(
            $user,
            $permission,
            $access->resolveAccountIdFromRequest($request)
        );

    }

    private function warehouseLocationsByProductId(array $productIds): array
    {
        $ids = collect($productIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($ids)) {
            return [];
        }

        return InventoryItem::query()
            ->with(['warehouse:id,name,code'])
            ->whereIn('product_id', $ids)
            ->where('qty', '>', 0)
            ->get()
            ->groupBy('product_id')
            ->map(function (Collection $items) {
                return $items
                    ->map(fn (InventoryItem $item) => [
                        'warehouse_id' => (int) $item->warehouse_id,
                        'warehouse_name' => $item->warehouse?->name,
                        'warehouse_code' => $item->warehouse?->code,
                        'quantity' => InventoryQuantity::normalize($item->qty ?? 0),
                    ])
                    ->values()
                    ->all();
            })
            ->all();
    }

    private function catalogAccountId(Request $request): int
    {
        $accountId = $this->accountDataScopeService->catalogAccountIdForRequest($request);
        abort_unless($accountId, 400, 'Account ID required');

        return (int) $accountId;
    }

    private function normalizeSkuKey(mixed $value): string
    {
        return mb_strtolower(trim((string) $value), 'UTF-8');
    }
}
