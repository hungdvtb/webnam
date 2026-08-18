<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductStorageLocation;
use App\Models\Warehouse;
use App\Models\WarehouseShelf;
use App\Services\AccountDataScopeService;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class WarehouseShelfController extends Controller
{
    public function __construct(private readonly AccountDataScopeService $accountDataScopeService)
    {
    }

    public function index(Request $request)
    {
        $accountId = $this->inventoryAccountId($request);
        $search = trim((string) $request->input('search', ''));
        $warehouseId = (int) $request->input('warehouse_id', 0);

        $query = WarehouseShelf::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->with(['warehouse:id,name,code'])
            ->withCount('locations');

        if ($warehouseId > 0) {
            $query->where('warehouse_id', $warehouseId);
        }

        if ($search !== '') {
            $like = $this->likeTerm($search);
            $warehouseSequenceSearch = ctype_digit($search) ? (int) $search : null;
            $query->where(function ($builder) use ($like, $warehouseSequenceSearch) {
                $builder
                    ->where('name', 'like', $like)
                    ->orWhere('code', 'like', $like)
                    ->orWhereHas('warehouse', function ($warehouseQuery) use ($like) {
                        $warehouseQuery
                            ->where('name', 'like', $like)
                            ->orWhere('code', 'like', $like);
                    })
                    ->orWhereHas('locations.product', function ($productQuery) use ($like, $warehouseSequenceSearch) {
                        $productQuery
                            ->where('sku', 'like', $like)
                            ->orWhere('name', 'like', $like);

                        if ($warehouseSequenceSearch !== null && $warehouseSequenceSearch > 0) {
                            $productQuery->orWhere(function ($sequenceQuery) use ($warehouseSequenceSearch) {
                                $this->applyWarehouseSequenceSearchConstraint($sequenceQuery, $warehouseSequenceSearch);
                            });
                        }
                    });
            });
        }

        $shelves = $query
            ->orderByDesc('is_active')
            ->orderBy('warehouse_id')
            ->orderBy('code')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $shelves
                ->map(fn (WarehouseShelf $shelf) => $this->shelfPayload($shelf))
                ->values()
                ->all(),
        ]);
    }

    public function search(Request $request)
    {
        $accountId = $this->inventoryAccountId($request);
        $search = trim((string) ($request->input('q') ?: $request->input('search', '')));
        $limit = max(10, min(120, (int) $request->input('limit', 80)));

        $shelfQuery = WarehouseShelf::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->with(['warehouse:id,name,code'])
            ->withCount('locations');

        $locationQuery = ProductStorageLocation::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->with([
                'product' => fn ($query) => $query
                    ->select(['id', 'account_id', 'name', 'sku', 'type', 'status', 'inventory_unit_id', 'warehouse_sequence', 'deleted_at'])
                    ->withExists('variations'),
                'product.unit:id,name',
                'shelf:id,account_id,warehouse_id,name,code,floor_count,is_active',
                'shelf.warehouse:id,name,code',
            ]);

        if ($search !== '') {
            $like = $this->likeTerm($search);
            $warehouseSequenceSearch = ctype_digit($search) ? (int) $search : null;

            $shelfQuery->where(function ($builder) use ($like, $warehouseSequenceSearch) {
                $builder
                    ->where('name', 'like', $like)
                    ->orWhere('code', 'like', $like)
                    ->orWhereHas('warehouse', function ($warehouseQuery) use ($like) {
                        $warehouseQuery
                            ->where('name', 'like', $like)
                            ->orWhere('code', 'like', $like);
                    })
                    ->orWhereHas('locations.product', function ($productQuery) use ($like, $warehouseSequenceSearch) {
                        $productQuery
                            ->where('sku', 'like', $like)
                            ->orWhere('name', 'like', $like);

                        if ($warehouseSequenceSearch !== null && $warehouseSequenceSearch > 0) {
                            $productQuery->orWhere(function ($sequenceQuery) use ($warehouseSequenceSearch) {
                                $this->applyWarehouseSequenceSearchConstraint($sequenceQuery, $warehouseSequenceSearch);
                            });
                        }
                    });
            });

            $locationQuery->where(function ($builder) use ($like, $warehouseSequenceSearch) {
                $builder
                    ->where('position_note', 'like', $like)
                    ->orWhereHas('product', function ($productQuery) use ($like, $warehouseSequenceSearch) {
                        $productQuery
                            ->where('sku', 'like', $like)
                            ->orWhere('name', 'like', $like);

                        if ($warehouseSequenceSearch !== null && $warehouseSequenceSearch > 0) {
                            $productQuery->orWhere(function ($sequenceQuery) use ($warehouseSequenceSearch) {
                                $this->applyWarehouseSequenceSearchConstraint($sequenceQuery, $warehouseSequenceSearch);
                            });
                        }
                    })
                    ->orWhereHas('shelf', function ($shelfQuery) use ($like) {
                        $shelfQuery
                            ->where('name', 'like', $like)
                            ->orWhere('code', 'like', $like)
                            ->orWhereHas('warehouse', function ($warehouseQuery) use ($like) {
                                $warehouseQuery
                                    ->where('name', 'like', $like)
                                    ->orWhere('code', 'like', $like);
                            });
                    });
            });
        }

        $shelves = $shelfQuery
            ->orderByDesc('is_active')
            ->orderBy('warehouse_id')
            ->orderBy('code')
            ->limit($limit)
            ->get();

        $locations = $locationQuery
            ->orderByDesc('updated_at')
            ->limit($limit)
            ->get()
            ->sortBy(fn (ProductStorageLocation $location) => sprintf(
                '%s-%02d-%s',
                $location->shelf?->code ?? '',
                (int) $location->floor_number,
                $location->product?->sku ?? ''
            ))
            ->values();

        return response()->json([
            'data' => [
                'query' => $search,
                'shelves' => $shelves
                    ->map(fn (WarehouseShelf $shelf) => $this->shelfPayload($shelf))
                    ->values()
                    ->all(),
                'locations' => $locations
                    ->map(fn (ProductStorageLocation $location) => $this->locationPayload($location))
                    ->values()
                    ->all(),
            ],
        ]);
    }

    public function store(Request $request)
    {
        $accountId = $this->inventoryAccountId($request);
        $validated = $request->validate([
            'warehouse_id' => 'nullable|integer',
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:80',
            'floor_count' => 'nullable|integer|min:1|max:20',
            'is_active' => 'nullable|boolean',
            'notes' => 'nullable|string|max:2000',
        ]);

        $warehouseId = $this->resolveWarehouseId($accountId, $validated['warehouse_id'] ?? null);
        $code = $this->normalizeShelfCode($validated['code']);
        $this->ensureShelfCodeAvailable($accountId, $warehouseId, $code);

        $shelf = WarehouseShelf::query()->create([
            'account_id' => $accountId,
            'warehouse_id' => $warehouseId,
            'name' => trim((string) $validated['name']),
            'code' => $code,
            'floor_count' => (int) ($validated['floor_count'] ?? 4),
            'is_active' => (bool) ($validated['is_active'] ?? true),
            'notes' => trim((string) ($validated['notes'] ?? '')) ?: null,
        ]);

        return response()->json([
            'data' => $this->shelfPayload($shelf->load(['warehouse:id,name,code'])),
        ], 201);
    }

    public function show(Request $request, int $id)
    {
        $shelf = $this->findShelf($request, $id)
            ->load([
                'warehouse:id,name,code',
                'locations' => fn ($query) => $query
                    ->with([
                        'product' => fn ($query) => $query
                            ->select(['id', 'account_id', 'name', 'sku', 'type', 'status', 'inventory_unit_id', 'warehouse_sequence', 'deleted_at'])
                            ->withExists('variations'),
                        'product.unit:id,name',
                    ])
                    ->orderByDesc('floor_number')
                    ->orderBy('id'),
            ])
            ->loadCount('locations');

        return response()->json([
            'data' => $this->shelfPayload($shelf, true),
        ]);
    }

    public function update(Request $request, int $id)
    {
        $accountId = $this->inventoryAccountId($request);
        $shelf = $this->findShelf($request, $id);
        $validated = $request->validate([
            'warehouse_id' => 'nullable|integer',
            'name' => 'sometimes|required|string|max:255',
            'code' => 'sometimes|required|string|max:80',
            'floor_count' => 'nullable|integer|min:1|max:20',
            'is_active' => 'nullable|boolean',
            'notes' => 'nullable|string|max:2000',
        ]);

        $warehouseId = array_key_exists('warehouse_id', $validated)
            ? $this->resolveWarehouseId($accountId, $validated['warehouse_id'])
            : $shelf->warehouse_id;
        $code = array_key_exists('code', $validated)
            ? $this->normalizeShelfCode($validated['code'])
            : $shelf->code;

        $this->ensureShelfCodeAvailable($accountId, $warehouseId, $code, $shelf->id);

        if (array_key_exists('floor_count', $validated)) {
            $highestUsedFloor = ProductStorageLocation::withoutGlobalScope('account_id')
                ->where('account_id', $accountId)
                ->where('warehouse_shelf_id', $shelf->id)
                ->max('floor_number');

            if ($highestUsedFloor && (int) $validated['floor_count'] < (int) $highestUsedFloor) {
                throw ValidationException::withMessages([
                    'floor_count' => "Kệ đang có sản phẩm ở tầng {$highestUsedFloor}, không thể giảm số tầng thấp hơn.",
                ]);
            }
        }

        $updates = [
            'warehouse_id' => $warehouseId,
            'code' => $code,
        ];

        foreach (['name', 'floor_count', 'is_active', 'notes'] as $field) {
            if (array_key_exists($field, $validated)) {
                $updates[$field] = is_string($validated[$field])
                    ? (trim($validated[$field]) ?: null)
                    : $validated[$field];
            }
        }

        $shelf->update($updates);

        return response()->json([
            'data' => $this->shelfPayload($shelf->refresh()->load(['warehouse:id,name,code'])),
        ]);
    }

    public function destroy(Request $request, int $id)
    {
        $accountId = $this->inventoryAccountId($request);
        $shelf = $this->findShelf($request, $id);
        $hasLocations = ProductStorageLocation::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->where('warehouse_shelf_id', $shelf->id)
            ->exists();

        if ($hasLocations) {
            throw ValidationException::withMessages([
                'shelf' => 'Kệ này đang có mã sản phẩm. Hãy chuyển hoặc xóa vị trí sản phẩm trước khi xóa kệ.',
            ]);
        }

        $shelf->delete();

        return response()->json(['message' => 'Đã xóa kệ.']);
    }

    public function assign(Request $request, int $id)
    {
        $shelf = $this->findShelf($request, $id);
        $validated = $request->validate([
            'floors' => 'required|array|min:1',
            'mode' => 'nullable|in:merge,replace',
            'position_note' => 'nullable|string|max:255',
        ]);

        $mode = (string) ($validated['mode'] ?? 'merge');
        $positionNote = trim((string) ($validated['position_note'] ?? '')) ?: null;

        $summary = DB::transaction(function () use ($request, $shelf, $validated, $mode, $positionNote) {
            $summary = [
                'assigned_count' => 0,
                'moved_count' => 0,
                'unchanged_count' => 0,
                'removed_count' => 0,
                'missing_skus' => [],
                'assigned_locations' => [],
            ];

            foreach ($validated['floors'] as $floorNumber => $floorInput) {
                $floor = (int) $floorNumber;
                $this->ensureFloorExists($shelf, $floor);

                $result = $this->assignFloor($request, $shelf, $floor, $floorInput, $mode, $positionNote);
                foreach (['assigned_count', 'moved_count', 'unchanged_count', 'removed_count'] as $key) {
                    $summary[$key] += (int) ($result[$key] ?? 0);
                }

                $summary['missing_skus'] = array_values(array_unique(array_merge(
                    $summary['missing_skus'],
                    $result['missing_skus'] ?? []
                )));
                $summary['assigned_locations'] = array_merge(
                    $summary['assigned_locations'],
                    $result['assigned_locations'] ?? []
                );
            }

            return $summary;
        });

        return response()->json([
            'message' => 'Đã cập nhật vị trí kệ.',
            'data' => $summary,
        ]);
    }

    public function destroyLocation(Request $request, int $locationId)
    {
        $accountId = $this->inventoryAccountId($request);
        $location = ProductStorageLocation::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->findOrFail($locationId);

        $location->delete();

        return response()->json(['message' => 'Đã xóa vị trí sản phẩm khỏi kệ.']);
    }

    private function assignFloor(
        Request $request,
        WarehouseShelf $shelf,
        int $floor,
        mixed $floorInput,
        string $mode,
        ?string $positionNote
    ): array {
        $accountId = $this->inventoryAccountId($request);
        $skus = $this->parseSkuList($floorInput);
        $products = $this->productsBySku($request, $skus);
        $productsBySku = $this->mapProductsBySku($products, $skus);
        $foundProducts = collect($skus)
            ->map(fn (string $sku) => $productsBySku[$this->normalizeSkuKey($sku)] ?? null)
            ->filter()
            ->unique('id')
            ->values();

        $foundProductIds = $foundProducts
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $missingSkus = collect($skus)
            ->reject(fn (string $sku) => isset($productsBySku[$this->normalizeSkuKey($sku)]))
            ->values()
            ->all();

        $removedCount = 0;
        if ($mode === 'replace') {
            $removeQuery = ProductStorageLocation::withoutGlobalScope('account_id')
                ->where('account_id', $accountId)
                ->where('warehouse_shelf_id', $shelf->id)
                ->where('floor_number', $floor);

            if (!empty($foundProductIds)) {
                $removeQuery->whereNotIn('product_id', $foundProductIds);
            }

            $removedCount = (int) $removeQuery->count();
            $removeQuery->delete();
        }

        if ($foundProducts->isEmpty()) {
            return [
                'assigned_count' => 0,
                'moved_count' => 0,
                'unchanged_count' => 0,
                'removed_count' => $removedCount,
                'missing_skus' => $missingSkus,
                'assigned_locations' => [],
            ];
        }

        $existingLocations = ProductStorageLocation::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->whereIn('product_id', $foundProductIds)
            ->get()
            ->keyBy('product_id');

        $assignedCount = 0;
        $movedCount = 0;
        $unchangedCount = 0;
        $now = now();

        foreach ($foundProducts as $product) {
            $existing = $existingLocations->get((int) $product->id);
            if (!$existing) {
                $assignedCount++;
            } elseif ((int) $existing->warehouse_shelf_id === (int) $shelf->id && (int) $existing->floor_number === $floor) {
                $unchangedCount++;
            } else {
                $movedCount++;
            }

            ProductStorageLocation::withoutGlobalScope('account_id')->updateOrCreate(
                [
                    'account_id' => $accountId,
                    'product_id' => (int) $product->id,
                ],
                [
                    'warehouse_shelf_id' => (int) $shelf->id,
                    'floor_number' => $floor,
                    'position_note' => $positionNote,
                    'assigned_by' => Auth::id(),
                    'assigned_at' => $now,
                ]
            );
        }

        $locations = ProductStorageLocation::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->whereIn('product_id', $foundProductIds)
            ->with([
                'product' => fn ($query) => $query
                    ->select(['id', 'account_id', 'name', 'sku', 'type', 'status', 'inventory_unit_id', 'warehouse_sequence', 'deleted_at'])
                    ->withExists('variations'),
                'product.unit:id,name',
                'shelf:id,account_id,warehouse_id,name,code,floor_count,is_active',
                'shelf.warehouse:id,name,code',
            ])
            ->get();

        return [
            'assigned_count' => $assignedCount,
            'moved_count' => $movedCount,
            'unchanged_count' => $unchangedCount,
            'removed_count' => $removedCount,
            'missing_skus' => $missingSkus,
            'assigned_locations' => $locations
                ->map(fn (ProductStorageLocation $location) => $this->locationPayload($location))
                ->values()
                ->all(),
        ];
    }

    private function shelfPayload(WarehouseShelf $shelf, bool $withFloors = false): array
    {
        $payload = [
            'id' => (int) $shelf->id,
            'account_id' => (int) $shelf->account_id,
            'warehouse_id' => $shelf->warehouse_id ? (int) $shelf->warehouse_id : null,
            'warehouse_name' => $shelf->warehouse?->name,
            'warehouse_code' => $shelf->warehouse?->code,
            'name' => $shelf->name,
            'code' => $shelf->code,
            'floor_count' => (int) ($shelf->floor_count ?: 4),
            'is_active' => (bool) $shelf->is_active,
            'notes' => $shelf->notes,
            'locations_count' => (int) ($shelf->locations_count ?? $shelf->locations?->count() ?? 0),
            'created_at' => $shelf->created_at,
            'updated_at' => $shelf->updated_at,
        ];

        if (!$withFloors) {
            return $payload;
        }

        $locations = $shelf->relationLoaded('locations')
            ? $shelf->locations
            : collect();

        $payload['floors'] = collect(range((int) $payload['floor_count'], 1))
            ->map(function (int $floor) use ($locations) {
                $items = $locations
                    ->where('floor_number', $floor)
                    ->sortBy(fn (ProductStorageLocation $location) => sprintf(
                        '%s-%s',
                        $location->product?->sku ?? '',
                        $location->product?->name ?? ''
                    ))
                    ->map(fn (ProductStorageLocation $location) => $this->locationPayload($location))
                    ->values()
                    ->all();

                return [
                    'floor_number' => $floor,
                    'items_count' => count($items),
                    'items' => $items,
                ];
            })
            ->values()
            ->all();

        return $payload;
    }

    private function locationPayload(ProductStorageLocation $location): array
    {
        $shelf = $location->shelf;
        $product = $location->product;
        $warehouseSequence = $this->warehouseSequenceForProduct($product);
        $productHasVariations = $product ? $product->hasVariantChildren() : false;

        return [
            'id' => (int) $location->id,
            'product_id' => (int) $location->product_id,
            'product_name' => $product?->name,
            'product_sku' => $product?->sku,
            'product_warehouse_sequence' => $warehouseSequence,
            'warehouse_sequence' => $warehouseSequence,
            'warehouse_pick_label' => $this->formatWarehousePickLabel($product),
            'product_type' => $product?->type,
            'product_has_variations' => $productHasVariations,
            'has_variations' => $productHasVariations,
            'product_status' => $product ? (bool) $product->status : null,
            'product_deleted' => $product ? (bool) $product->trashed() : false,
            'product_unit_name' => $product?->unit?->name,
            'warehouse_shelf_id' => (int) $location->warehouse_shelf_id,
            'shelf_id' => (int) $location->warehouse_shelf_id,
            'shelf_name' => $shelf?->name,
            'shelf_code' => $shelf?->code,
            'warehouse_id' => $shelf?->warehouse_id ? (int) $shelf->warehouse_id : null,
            'warehouse_name' => $shelf?->warehouse?->name,
            'warehouse_code' => $shelf?->warehouse?->code,
            'floor_number' => (int) $location->floor_number,
            'position_note' => $location->position_note,
            'location_code' => $this->formatLocationCode($shelf, (int) $location->floor_number),
            'location_label' => $this->formatLocationLabel($shelf, (int) $location->floor_number),
            'updated_at' => $location->updated_at,
        ];
    }

    private function warehouseSequenceForProduct(?Product $product): ?int
    {
        if (!$product || !$product->usesWarehouseSequenceForDisplay()) {
            return null;
        }

        $sequence = $product->warehouse_sequence !== null ? (int) $product->warehouse_sequence : null;

        return $sequence !== null && $sequence > 0 ? $sequence : null;
    }

    private function applyWarehouseSequenceSearchConstraint($query, int $sequence)
    {
        return $query
            ->where('warehouse_sequence', $sequence)
            ->whereNotIn('type', ['configurable', 'bundle'])
            ->whereDoesntHave('variations');
    }

    private function formatWarehousePickLabel(?Product $product): ?string
    {
        if (!$product) {
            return null;
        }

        $name = trim((string) $product->name);
        $sequence = $this->warehouseSequenceForProduct($product);

        if ($sequence !== null && $sequence > 0 && $name !== '') {
            return "{$sequence} - {$name}";
        }

        if ($sequence !== null && $sequence > 0) {
            return (string) $sequence;
        }

        return $name !== '' ? $name : null;
    }

    private function productsBySku(Request $request, array $skus): EloquentCollection
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

        $accountIds = $this->productAccountIdsForRequest($request);

        return Product::withoutGlobalScope('account_id')
            ->with(['unit'])
            ->whereIn('account_id', $accountIds)
            ->whereIn(DB::raw('LOWER(sku)'), $skuKeys)
            ->get()
            ->sortBy(function (Product $product) use ($skuKeys, $accountIds) {
                $skuPosition = $this->arrayPosition($skuKeys, $this->normalizeSkuKey($product->sku));
                $accountPosition = $this->arrayPosition($accountIds, (int) $product->account_id);

                return ($skuPosition * 1000) + $accountPosition;
            })
            ->values();
    }

    private function mapProductsBySku(EloquentCollection $products, array $skus): array
    {
        $skuKeys = collect($skus)
            ->map(fn (string $sku) => $this->normalizeSkuKey($sku))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $result = [];
        foreach ($products as $product) {
            $key = $this->normalizeSkuKey($product->sku);
            if ($key !== '' && in_array($key, $skuKeys, true) && !isset($result[$key])) {
                $result[$key] = $product;
            }
        }

        return $result;
    }

    private function parseSkuList(mixed $input): array
    {
        $rawValues = [];

        if (is_array($input)) {
            if (array_key_exists('skus', $input) && is_array($input['skus'])) {
                $rawValues = array_merge($rawValues, $input['skus']);
            }

            foreach (['expression', 'text', 'sku'] as $field) {
                if (array_key_exists($field, $input)) {
                    $rawValues[] = $input[$field];
                }
            }

            if (empty($rawValues)) {
                $rawValues = $input;
            }
        } else {
            $rawValues[] = $input;
        }

        return collect($rawValues)
            ->flatMap(fn ($value) => preg_split('/[\s,;=|]+/u', (string) $value) ?: [])
            ->map(fn ($sku) => trim((string) $sku))
            ->filter()
            ->unique(fn (string $sku) => $this->normalizeSkuKey($sku))
            ->values()
            ->all();
    }

    private function ensureFloorExists(WarehouseShelf $shelf, int $floor): void
    {
        if ($floor < 1 || $floor > (int) $shelf->floor_count) {
            throw ValidationException::withMessages([
                'floor_number' => "Tầng {$floor} không tồn tại trên {$shelf->name}.",
            ]);
        }
    }

    private function findShelf(Request $request, int $id): WarehouseShelf
    {
        $accountId = $this->inventoryAccountId($request);

        return WarehouseShelf::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->findOrFail($id);
    }

    private function resolveWarehouseId(int $accountId, mixed $warehouseId): ?int
    {
        if ($warehouseId === null || $warehouseId === '') {
            return null;
        }

        $normalizedWarehouseId = (int) $warehouseId;
        if ($normalizedWarehouseId <= 0) {
            return null;
        }

        $exists = Warehouse::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->whereKey($normalizedWarehouseId)
            ->exists();

        if (!$exists) {
            throw ValidationException::withMessages([
                'warehouse_id' => 'Kho được chọn không tồn tại trong tài khoản hiện tại.',
            ]);
        }

        return $normalizedWarehouseId;
    }

    private function ensureShelfCodeAvailable(int $accountId, ?int $warehouseId, string $code, ?int $ignoreId = null): void
    {
        $exists = WarehouseShelf::withoutGlobalScope('account_id')
            ->where('account_id', $accountId)
            ->where('code', $code)
            ->when(
                $warehouseId,
                fn ($query) => $query->where('warehouse_id', $warehouseId),
                fn ($query) => $query->whereNull('warehouse_id')
            )
            ->when($ignoreId, fn ($query) => $query->where('id', '!=', $ignoreId))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'code' => 'Mã kệ này đã tồn tại trong kho được chọn.',
            ]);
        }
    }

    private function inventoryAccountId(Request $request): int
    {
        $accountId = $this->accountDataScopeService->inventoryAccountIdForRequest($request);
        abort_unless($accountId, 400, 'Account ID required');

        return (int) $accountId;
    }

    private function productAccountIdsForRequest(Request $request): array
    {
        $rawAccountId = $this->accountDataScopeService->rawActiveAccountId($request);
        $sharedInventoryAccountIds = $this->accountDataScopeService->accountIdsSharingInventoryScopeForRequest($request);

        return collect($sharedInventoryAccountIds)
            ->push($rawAccountId)
            ->map(fn ($accountId) => $accountId ? $this->accountDataScopeService->catalogAccountId((int) $accountId) : null)
            ->push($this->accountDataScopeService->catalogAccountIdForRequest($request))
            ->push($rawAccountId)
            ->filter()
            ->map(fn ($accountId) => (int) $accountId)
            ->unique()
            ->values()
            ->all();
    }

    private function normalizeShelfCode(mixed $value): string
    {
        return mb_strtoupper(trim((string) $value), 'UTF-8');
    }

    private function normalizeSkuKey(mixed $value): string
    {
        return mb_strtolower(trim((string) $value), 'UTF-8');
    }

    private function likeTerm(string $value): string
    {
        return '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value) . '%';
    }

    private function formatLocationCode(?WarehouseShelf $shelf, int $floor): string
    {
        $shelfCode = trim((string) ($shelf?->code ?: $shelf?->name ?: 'KE'));

        return "{$shelfCode}-T{$floor}";
    }

    private function formatLocationLabel(?WarehouseShelf $shelf, int $floor): string
    {
        $shelfName = trim((string) ($shelf?->name ?: $shelf?->code ?: 'Kệ'));

        return "{$shelfName} - Tầng {$floor}";
    }

    private function arrayPosition(array $values, mixed $needle): int
    {
        $position = array_search($needle, $values, true);

        return $position === false ? 999999 : (int) $position;
    }
}
