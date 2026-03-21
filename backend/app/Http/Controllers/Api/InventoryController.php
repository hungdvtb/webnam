<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryImport;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use App\Services\Inventory\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function __construct(private readonly InventoryService $inventoryService)
    {
    }

    public function dashboard(Request $request)
    {
        $fromDate = now()->subDays((int) $request->input('days', 30))->startOfDay();

        $activeProducts = Product::query()->count();
        $trashedProducts = Product::onlyTrashed()->count();
        $totalUnits = (int) Product::query()->sum('stock_quantity');
        $damagedUnits = (int) Product::query()->sum('damaged_quantity');
        $supplierCount = Supplier::query()->count();
        $stockValue = (float) Product::query()
            ->selectRaw('COALESCE(SUM(stock_quantity * COALESCE(cost_price, expected_cost, 0)), 0) AS total_value')
            ->value('total_value');
        $importsTotal = (float) InventoryImport::query()
            ->whereDate('import_date', '>=', $fromDate->toDateString())
            ->sum('total_amount');
        $returnsTotal = (float) InventoryDocument::query()
            ->where('type', 'return')
            ->whereDate('document_date', '>=', $fromDate->toDateString())
            ->sum('total_amount');
        $damagedTotal = (float) InventoryDocument::query()
            ->where('type', 'damaged')
            ->whereDate('document_date', '>=', $fromDate->toDateString())
            ->sum('total_amount');
        $exportsRevenue = (float) Order::query()
            ->whereDate('created_at', '>=', $fromDate)
            ->sum('total_price');
        $exportsCost = (float) Order::query()
            ->whereDate('created_at', '>=', $fromDate)
            ->sum('cost_total');

        $lowStockItems = Product::query()
            ->select([
                'id',
                'sku',
                'name',
                'stock_quantity',
                'damaged_quantity',
                'cost_price',
                'expected_cost',
                'status',
                'price',
                'created_at',
                'deleted_at',
            ])
            ->where('stock_quantity', '<=', 5)
            ->orderBy('stock_quantity')
            ->limit(8)
            ->get()
            ->map(fn (Product $product) => $this->productPayload($product));

        return response()->json([
            'summary' => [
                'active_products' => $activeProducts,
                'trashed_products' => $trashedProducts,
                'total_units' => $totalUnits,
                'damaged_units' => $damagedUnits,
                'supplier_count' => $supplierCount,
                'stock_value' => round($stockValue, 2),
                'imports_total' => round($importsTotal, 2),
                'returns_total' => round($returnsTotal, 2),
                'damaged_total' => round($damagedTotal, 2),
                'exports_revenue' => round($exportsRevenue, 2),
                'exports_cost' => round($exportsCost, 2),
                'exports_profit' => round($exportsRevenue - $exportsCost, 2),
            ],
            'low_stock' => $lowStockItems,
        ]);
    }

    public function products(Request $request)
    {
        $query = $this->buildInventoryProductsQuery($request);
        $summary = $this->inventoryProductSummary(clone $query);
        $withVariants = $request->boolean('with_variants');

        $query->with([
            'category:id,name',
            'parentConfigurable:id,name,sku',
        ]);

        if ($withVariants) {
            $query->with([
                'variations' => function ($builder) {
                    $builder
                        ->select([
                            'products.id',
                            'products.sku',
                            'products.name',
                            'products.price',
                            'products.expected_cost',
                            'products.cost_price',
                            'products.stock_quantity',
                            'products.damaged_quantity',
                            'products.status',
                            'products.type',
                            'products.category_id',
                            'products.created_at',
                            'products.deleted_at',
                        ])
                        ->with(['category:id,name', 'parentConfigurable:id,name,sku'])
                        ->orderBy('products.name');
                },
            ]);
        }

        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = strtolower((string) $request->input('sort_order', 'desc')) === 'asc' ? 'asc' : 'desc';
        $allowedSorts = [
            'created_at',
            'deleted_at',
            'sku',
            'name',
            'stock_quantity',
            'damaged_quantity',
            'price',
            'expected_cost',
            'cost_price',
            'display_cost',
            'inventory_value',
            'total_imported',
            'total_exported',
            'total_returned',
            'total_damaged',
        ];
        $query->orderBy(in_array($sortBy, $allowedSorts, true) ? $sortBy : 'created_at', $sortOrder);

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);
        $paginated = $query->paginate($perPage);

        $pageProductIds = collect($paginated->items())
            ->flatMap(function (Product $product) use ($withVariants) {
                $ids = [$product->id];
                if ($withVariants && $product->relationLoaded('variations')) {
                    $ids = array_merge($ids, $product->variations->pluck('id')->all());
                }

                return $ids;
            });
        $supplierPriceMap = $this->supplierPriceMap($request, $pageProductIds);

        $paginated->getCollection()->transform(function (Product $product) use ($supplierPriceMap, $withVariants) {
            return $this->inventoryProductPayload(
                $product,
                $supplierPriceMap->get($product->id),
                $withVariants ? $supplierPriceMap : null
            );
        });

        $response = $paginated->toArray();
        $response['summary'] = $summary;

        return response()->json($response);
    }

    public function storeProduct(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'sku' => 'required|string|max:120|unique:products,sku',
            'name' => 'required|string|max:255',
            'price' => 'nullable|numeric|min:0',
            'expected_cost' => 'nullable|numeric|min:0',
            'status' => 'nullable|boolean',
        ]);

        $baseSlug = Str::slug($validated['name']);
        $slug = $baseSlug !== '' ? $baseSlug : 'san-pham';
        $suffix = 1;
        while (Product::withoutGlobalScopes()->where('slug', $slug)->exists()) {
            $slug = ($baseSlug !== '' ? $baseSlug : 'san-pham') . '-' . $suffix++;
        }

        $product = Product::create([
            'account_id' => $accountId,
            'type' => 'simple',
            'sku' => $validated['sku'],
            'name' => $validated['name'],
            'slug' => $slug,
            'price' => $validated['price'] ?? 0,
            'expected_cost' => $validated['expected_cost'] ?? null,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
            'status' => $validated['status'] ?? true,
        ]);

        return response()->json($this->productPayload($product->fresh()), 201);
    }

    public function updateProduct(Request $request, int $id)
    {
        $product = Product::withTrashed()->findOrFail($id);
        $validated = $request->validate([
            'sku' => 'sometimes|required|string|max:120|unique:products,sku,' . $product->id,
            'name' => 'sometimes|required|string|max:255',
            'price' => 'nullable|numeric|min:0',
            'expected_cost' => 'nullable|numeric|min:0',
            'status' => 'nullable|boolean',
        ]);

        $product->fill($validated);
        $product->save();

        return response()->json($this->productPayload($product->fresh()));
    }

    public function suppliers(Request $request)
    {
        $query = Supplier::query()
            ->select([
                'id',
                'account_id',
                'code',
                'name',
                'phone',
                'email',
                'address',
                'notes',
                'status',
                'updated_at',
                'deleted_at',
            ])
            ->withCount('prices');

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('name', 'like', '%' . $search . '%')
                    ->orWhere('phone', 'like', '%' . $search . '%')
                    ->orWhere('email', 'like', '%' . $search . '%')
                    ->orWhere('code', 'like', '%' . $search . '%');
            });
        }

        if ($request->filled('status')) {
            $query->where('status', $request->boolean('status'));
        }

        $query
            ->withCount([
                'imports as import_slips_count' => function ($builder) use ($request) {
                    $this->applySupplierImportDateFilter($builder, $request);
                },
            ])
            ->withSum([
                'imports as imported_quantity_total' => function ($builder) use ($request) {
                    $this->applySupplierImportDateFilter($builder, $request);
                },
            ], 'total_quantity')
            ->withSum([
                'imports as imported_amount_total' => function ($builder) use ($request) {
                    $this->applySupplierImportDateFilter($builder, $request);
                },
            ], 'total_amount');

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);
        $summary = DB::query()
            ->fromSub(clone $query, 'supplier_stats')
            ->selectRaw('COUNT(*) as total_suppliers')
            ->selectRaw('COALESCE(SUM(import_slips_count), 0) as total_import_slips')
            ->selectRaw('COALESCE(SUM(imported_quantity_total), 0) as total_imported_quantity')
            ->selectRaw('COALESCE(SUM(imported_amount_total), 0) as total_imported_amount')
            ->first();

        $this->applyMappedSort($query, $request, [
            'name' => 'name',
            'code' => 'code',
            'phone' => 'phone',
            'prices_count' => 'prices_count',
            'import_slips_count' => 'import_slips_count',
            'imported_quantity_total' => 'imported_quantity_total',
            'imported_amount_total' => 'imported_amount_total',
            'updated_at' => 'updated_at',
        ], 'updated_at', ['id' => 'desc']);

        $paginated = $query->paginate($perPage)->toArray();
        $paginated['summary'] = [
            'total_suppliers' => (int) ($summary->total_suppliers ?? 0),
            'total_import_slips' => (int) ($summary->total_import_slips ?? 0),
            'total_imported_quantity' => (int) round((float) ($summary->total_imported_quantity ?? 0)),
            'total_imported_amount' => round((float) ($summary->total_imported_amount ?? 0), 2),
        ];

        return response()->json($paginated);
    }

    public function storeSupplier(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'code' => 'nullable|string|max:120',
            'name' => 'required|string|max:255',
            'phone' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'address' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:5000',
            'status' => 'nullable|boolean',
        ]);

        $supplier = Supplier::create([
            ...$validated,
            'account_id' => $accountId,
        ]);

        return response()->json($supplier, 201);
    }

    public function updateSupplier(Request $request, int $id)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $validated = $request->validate([
            'code' => 'nullable|string|max:120',
            'name' => 'sometimes|required|string|max:255',
            'phone' => 'nullable|string|max:50',
            'email' => 'nullable|email|max:255',
            'address' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:5000',
            'status' => 'nullable|boolean',
        ]);

        $supplier->fill($validated);
        $supplier->save();

        return response()->json($supplier);
    }

    public function destroySupplier(int $id)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $supplier->delete();

        return response()->json(['message' => 'Đã xóa nhà cung cấp.']);
    }

    public function supplierPrices(Request $request, int $id)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $query = Product::query()
            ->select([
                'products.id',
                'products.sku',
                'products.name',
                'products.price',
                'products.expected_cost',
                'products.cost_price',
                'products.stock_quantity',
                'products.damaged_quantity',
                'products.status',
                'products.type',
                'products.category_id',
                'products.created_at',
                'products.deleted_at',
            ])
            ->leftJoin('supplier_product_prices as supplier_price_rows', function ($join) use ($supplier) {
                $join
                    ->on('supplier_price_rows.product_id', '=', 'products.id')
                    ->where('supplier_price_rows.supplier_id', '=', $supplier->id);
            })
            ->where(function ($builder) use ($supplier) {
                $builder
                    ->where('products.supplier_id', $supplier->id)
                    ->orWhereNotNull('supplier_price_rows.id')
                    ->orWhereHas('variations', function ($variationQuery) use ($supplier) {
                        $variationQuery
                            ->where('products.supplier_id', $supplier->id)
                            ->orWhereHas('supplierPrices', function ($priceQuery) use ($supplier) {
                                $priceQuery->where('supplier_id', $supplier->id);
                            });
                    });
            })
            ->whereDoesntHave('parentConfigurable')
            ->with([
                'category:id,name',
                'variations' => function ($builder) use ($supplier) {
                    $builder
                        ->select([
                            'products.id',
                            'products.sku',
                            'products.name',
                            'products.price',
                            'products.expected_cost',
                            'products.cost_price',
                            'products.stock_quantity',
                            'products.damaged_quantity',
                            'products.status',
                            'products.type',
                            'products.category_id',
                            'products.created_at',
                            'products.deleted_at',
                        ])
                        ->where(function ($variationQuery) use ($supplier) {
                            $variationQuery
                                ->where('products.supplier_id', $supplier->id)
                                ->orWhereHas('supplierPrices', function ($priceQuery) use ($supplier) {
                                    $priceQuery->where('supplier_id', $supplier->id);
                                });
                        })
                        ->with([
                            'category:id,name',
                            'parentConfigurable:id,name,sku',
                        ])
                        ->orderBy('products.name');
                },
            ]);

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($productQuery) use ($search) {
                $productQuery
                    ->where('products.sku', 'like', '%' . $search . '%')
                    ->orWhere('products.name', 'like', '%' . $search . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($search) {
                        $variationQuery
                            ->where('products.sku', 'like', '%' . $search . '%')
                            ->orWhere('products.name', 'like', '%' . $search . '%');
                    });
            });
        }

        if ($request->filled('sku')) {
            $sku = trim((string) $request->input('sku'));
            $query->where(function ($productQuery) use ($sku) {
                $productQuery
                    ->where('products.sku', 'like', '%' . $sku . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($sku) {
                        $variationQuery->where('products.sku', 'like', '%' . $sku . '%');
                    });
            });
        }

        if ($request->filled('name')) {
            $name = trim((string) $request->input('name'));
            $query->where(function ($productQuery) use ($name) {
                $productQuery
                    ->where('products.name', 'like', '%' . $name . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($name) {
                        $variationQuery->where('products.name', 'like', '%' . $name . '%');
                    });
            });
        }

        if ($request->filled('category_id')) {
            $query->where('products.category_id', (int) $request->input('category_id'));
        }

        if ($request->filled('type')) {
            $type = (string) $request->input('type');
            if ($type === 'configurable') {
                $query->where('products.type', 'configurable')->whereHas('variations');
            } elseif ($type === 'simple') {
                $query->where('products.type', 'simple')->whereDoesntHave('variations');
            } else {
                $query->where('products.type', $type);
            }
        }

        if ($request->filled('variant_scope')) {
            $variantScope = (string) $request->input('variant_scope');
            if (in_array($variantScope, ['has_variants', 'only_variants'], true)) {
                $query->whereHas('variations');
            } elseif ($variantScope === 'no_variants') {
                $query->whereDoesntHave('variations');
            }
        }

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);

        $this->applyMappedSort($query, $request, [
            'sku' => 'products.sku',
            'name' => 'products.name',
            'price' => 'products.price',
            'unit_cost' => ['raw' => 'COALESCE(supplier_price_rows.unit_cost, 0)'],
            'current_cost' => ['raw' => 'COALESCE(products.cost_price, products.expected_cost, 0)'],
            'updated_at' => ['raw' => 'COALESCE(supplier_price_rows.updated_at, products.updated_at)'],
            'notes' => 'supplier_price_rows.notes',
        ], 'updated_at', ['products.id' => 'desc']);

        $paginated = $query->paginate($perPage);
        $pageProductIds = collect($paginated->items())
            ->flatMap(function (Product $product) {
                $ids = [$product->id];
                if ($product->relationLoaded('variations')) {
                    $ids = array_merge($ids, $product->variations->pluck('id')->all());
                }

                return $ids;
            });
        $supplierPriceMap = $this->supplierPriceMapBySupplierId($supplier->id, $pageProductIds);

        $paginated->getCollection()->transform(function (Product $product) use ($supplierPriceMap) {
            return $this->inventoryProductPayload(
                $product,
                $supplierPriceMap->get($product->id),
                $supplierPriceMap
            );
        });

        return response()->json($paginated);
    }

    public function storeSupplierPrice(Request $request, int $id)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $validated = $request->validate([
            'product_id' => 'required|integer|exists:products,id',
            'unit_cost' => 'required|numeric|min:0',
            'notes' => 'nullable|string|max:1000',
        ]);

        Product::query()
            ->whereKey((int) $validated['product_id'])
            ->update(['supplier_id' => $supplier->id]);

        $price = SupplierProductPrice::query()->updateOrCreate(
            [
                'supplier_id' => $supplier->id,
                'product_id' => (int) $validated['product_id'],
            ],
            [
                'account_id' => $supplier->account_id,
                'unit_cost' => $this->normalizeSupplierUnitCost($validated['unit_cost']),
                'notes' => $validated['notes'] ?? null,
                'updated_by' => auth()->id(),
            ]
        );

        return response()->json($price->load(['product:id,sku,name,expected_cost,cost_price,stock_quantity,type,category_id', 'product.category:id,name', 'updater:id,name']), 201);
    }

    public function updateSupplierPrice(Request $request, int $id, int $priceId)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $price = SupplierProductPrice::query()
            ->where('supplier_id', $supplier->id)
            ->findOrFail($priceId);

        $validated = $request->validate([
            'unit_cost' => 'required|numeric|min:0',
            'notes' => 'nullable|string|max:1000',
        ]);

        $price->forceFill([
            'unit_cost' => $this->normalizeSupplierUnitCost($validated['unit_cost']),
            'notes' => $validated['notes'] ?? null,
            'updated_by' => auth()->id(),
        ])->save();

        return response()->json($price->load(['product:id,sku,name,expected_cost,cost_price,stock_quantity,type,category_id', 'product.category:id,name', 'updater:id,name']));
    }

    public function destroySupplierPrice(int $id, int $priceId)
    {
        Supplier::query()->findOrFail($id);
        $price = SupplierProductPrice::query()
            ->where('supplier_id', $id)
            ->findOrFail($priceId);
        $price->delete();

        return response()->json(['message' => 'Đã xóa giá nhà cung cấp.']);
    }

    public function bulkUpsertSupplierPrices(Request $request, int $id)
    {
        $supplier = Supplier::query()->findOrFail($id);
        $validated = $request->validate([
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.unit_cost' => 'required|numeric|min:0',
            'items.*.notes' => 'nullable|string|max:1000',
        ]);

        $savedIds = [];
        $productIds = collect($validated['items'])
            ->pluck('product_id')
            ->map(fn ($productId) => (int) $productId)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (!empty($productIds)) {
            Product::query()
                ->whereIn('id', $productIds)
                ->update(['supplier_id' => $supplier->id]);
        }

        foreach ($validated['items'] as $item) {
            $price = SupplierProductPrice::query()->updateOrCreate(
                [
                    'supplier_id' => $supplier->id,
                    'product_id' => (int) $item['product_id'],
                ],
                [
                    'account_id' => $supplier->account_id,
                    'unit_cost' => $this->normalizeSupplierUnitCost($item['unit_cost']),
                    'notes' => $item['notes'] ?? null,
                    'updated_by' => auth()->id(),
                ]
            );

            $savedIds[] = $price->id;
        }

        $prices = SupplierProductPrice::query()
            ->where('supplier_id', $supplier->id)
            ->whereIn('id', $savedIds)
            ->with([
                'product:id,sku,name,expected_cost,cost_price,stock_quantity,type,category_id',
                'product.category:id,name',
                'updater:id,name',
            ])
            ->get();

        return response()->json([
            'message' => 'Đã cập nhật bảng giá nhà cung cấp.',
            'count' => $prices->count(),
            'items' => $prices,
        ]);
    }

    public function imports(Request $request)
    {
        $query = InventoryImport::query()
            ->withCount('items')
            ->with(['supplier:id,name', 'creator:id,name'])
            ->withSum('items as lines_total_amount', 'line_total');

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('import_number', 'like', '%' . $search . '%')
                    ->orWhere('supplier_name', 'like', '%' . $search . '%')
                    ->orWhereHas('supplier', function ($supplierQuery) use ($search) {
                        $supplierQuery->where('name', 'like', '%' . $search . '%');
                    });
            });
        }

        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', (int) $request->input('supplier_id'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('import_date', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('import_date', '<=', $request->input('date_to'));
        }

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);

        $this->applyMappedSort($query, $request, [
            'code' => 'import_number',
            'supplier' => 'supplier_name',
            'date' => 'import_date',
            'line_count' => 'items_count',
            'qty' => 'total_quantity',
            'amount' => 'total_amount',
            'note' => 'notes',
        ], 'date', ['id' => 'desc']);

        return response()->json(
            $query->paginate($perPage)
        );
    }

    public function storeImport(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'supplier_id' => 'required|integer|exists:suppliers,id',
            'import_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'update_supplier_prices' => 'nullable|boolean',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_cost' => 'required|numeric|min:0',
            'items.*.update_supplier_price' => 'nullable|boolean',
            'items.*.notes' => 'nullable|string|max:1000',
            'items.*.price_notes' => 'nullable|string|max:1000',
        ]);

        $import = $this->inventoryService->createImport($validated, $accountId, auth()->id());

        return response()->json($import, 201);
    }

    public function showImport(int $id)
    {
        $import = InventoryImport::query()
            ->with([
                'supplier:id,name,phone,email,address',
                'items.product:id,sku,name,price,stock_quantity',
                'items.batch',
                'items.supplierPrice',
                'creator:id,name',
            ])
            ->findOrFail($id);

        return response()->json($import);
    }

    public function updateImport(Request $request, int $id)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $import = InventoryImport::query()->findOrFail($id);
        $validated = $request->validate([
            'supplier_id' => 'required|integer|exists:suppliers,id',
            'import_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'update_supplier_prices' => 'nullable|boolean',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.unit_cost' => 'required|numeric|min:0',
            'items.*.update_supplier_price' => 'nullable|boolean',
            'items.*.notes' => 'nullable|string|max:1000',
            'items.*.price_notes' => 'nullable|string|max:1000',
        ]);

        return response()->json(
            $this->inventoryService->updateImport($import, $validated, $accountId, auth()->id())
        );
    }

    public function destroyImport(int $id)
    {
        $import = InventoryImport::query()->findOrFail($id);
        $this->inventoryService->deleteImport($import);

        return response()->json(['message' => 'Đã xóa phiếu nhập.']);
    }

    public function documents(Request $request, string $type)
    {
        $type = $this->normalizeDocumentType($type);
        $query = InventoryDocument::query()
            ->where('type', $type)
            ->with(['supplier:id,name', 'creator:id,name'])
            ->withCount('items');

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('document_number', 'like', '%' . $search . '%')
                    ->orWhere('notes', 'like', '%' . $search . '%')
                    ->orWhereHas('supplier', function ($supplierQuery) use ($search) {
                        $supplierQuery->where('name', 'like', '%' . $search . '%');
                    });
            });
        }

        if ($request->filled('date_from')) {
            $query->whereDate('document_date', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('document_date', '<=', $request->input('date_to'));
        }

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);

        $this->applyMappedSort($query, $request, [
            'code' => 'document_number',
            'supplier' => 'supplier_id',
            'date' => 'document_date',
            'line_count' => 'items_count',
            'qty' => 'total_quantity',
            'amount' => 'total_amount',
            'note' => 'notes',
        ], 'date', ['id' => 'desc']);

        return response()->json(
            $query->paginate($perPage)
        );
    }

    public function storeDocument(Request $request, string $type)
    {
        $type = $this->normalizeDocumentType($type);
        $accountId = (int) $request->header('X-Account-Id');

        $rules = [
            'document_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'supplier_id' => 'nullable|integer|exists:suppliers,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.notes' => 'nullable|string|max:1000',
        ];

        if ($type === 'return') {
            $rules['items.*.unit_cost'] = 'nullable|numeric|min:0';
        }

        if ($type === 'adjustment') {
            $rules['items.*.stock_bucket'] = ['required', Rule::in(['sellable', 'damaged'])];
            $rules['items.*.direction'] = ['required', Rule::in(['in', 'out'])];
            $rules['items.*.unit_cost'] = 'nullable|numeric|min:0';
        }

        $validated = $request->validate($rules);
        $document = $this->inventoryService->createDocument($type, $validated, $accountId, auth()->id());

        return response()->json($document, 201);
    }

    public function showDocument(string $type, int $id)
    {
        $type = $this->normalizeDocumentType($type);
        $document = InventoryDocument::query()
            ->where('type', $type)
            ->with([
                'supplier:id,name,phone,email',
                'items.product:id,sku,name',
                'items.allocations.batch',
                'creator:id,name',
            ])
            ->findOrFail($id);

        return response()->json($document);
    }

    public function updateDocument(Request $request, string $type, int $id)
    {
        $type = $this->normalizeDocumentType($type);
        $accountId = (int) $request->header('X-Account-Id');
        $document = InventoryDocument::query()
            ->where('type', $type)
            ->findOrFail($id);

        $rules = [
            'document_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'supplier_id' => 'nullable|integer|exists:suppliers,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.notes' => 'nullable|string|max:1000',
        ];

        if ($type === 'return') {
            $rules['items.*.unit_cost'] = 'nullable|numeric|min:0';
        }

        if ($type === 'adjustment') {
            $rules['items.*.stock_bucket'] = ['required', Rule::in(['sellable', 'damaged'])];
            $rules['items.*.direction'] = ['required', Rule::in(['in', 'out'])];
            $rules['items.*.unit_cost'] = 'nullable|numeric|min:0';
        }

        $validated = $request->validate($rules);

        return response()->json(
            $this->inventoryService->updateDocument($document, $type, $validated, $accountId, auth()->id())
        );
    }

    public function destroyDocument(string $type, int $id)
    {
        $type = $this->normalizeDocumentType($type);
        $document = InventoryDocument::query()
            ->where('type', $type)
            ->findOrFail($id);

        $this->inventoryService->deleteDocument($document);

        return response()->json(['message' => 'Đã xóa phiếu kho.']);
    }

    public function batches(Request $request)
    {
        $query = InventoryBatch::query()
            ->select('inventory_batches.*')
            ->leftJoin('products', 'products.id', '=', 'inventory_batches.product_id')
            ->with([
                'product:id,sku,name,price,expected_cost,cost_price,stock_quantity,damaged_quantity',
                'import:id,import_number,supplier_name,import_date',
            ]);

        if ($request->boolean('remaining_only', true)) {
            $query->where('remaining_quantity', '>', 0);
        }

        if ($request->filled('product_id')) {
            $query->where('product_id', (int) $request->input('product_id'));
        }

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('batch_number', 'like', '%' . $search . '%')
                    ->orWhereHas('product', function ($productQuery) use ($search) {
                        $productQuery
                            ->where('sku', 'like', '%' . $search . '%')
                            ->orWhere('name', 'like', '%' . $search . '%');
                    });
            });
        }

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);
        $this->applyMappedSort($query, $request, [
            'code' => 'inventory_batches.batch_number',
            'product' => 'products.name',
            'date' => 'inventory_batches.received_at',
            'qty' => 'inventory_batches.quantity',
            'remaining' => 'inventory_batches.remaining_quantity',
            'amount' => 'inventory_batches.unit_cost',
            'source' => 'inventory_batches.source_type',
        ], 'date', ['inventory_batches.id' => 'asc']);
        $paginated = $query->paginate($perPage);

        $paginated->getCollection()->transform(function (InventoryBatch $batch) {
            $meta = is_array($batch->meta) ? $batch->meta : [];

            return [
                'id' => $batch->id,
                'batch_number' => $batch->batch_number,
                'received_at' => $batch->received_at,
                'quantity' => (int) $batch->quantity,
                'remaining_quantity' => (int) $batch->remaining_quantity,
                'unit_cost' => (float) $batch->unit_cost,
                'status' => $batch->status,
                'source_type' => $batch->source_type,
                'source_label' => $batch->import?->import_number ?? ($meta['source_label'] ?? '-'),
                'source_name' => $batch->import ? 'Phiếu nhập' : ($meta['source_name'] ?? 'Phiếu kho'),
                'product' => $batch->product,
                'import' => $batch->import,
            ];
        });

        return response()->json($paginated);
    }

    public function exports(Request $request)
    {
        $query = Order::query()
            ->select([
                'id',
                'order_number',
                'customer_name',
                'customer_phone',
                'status',
                'total_price',
                'cost_total',
                'profit_total',
                'source',
                'created_at',
            ])
            ->withCount('items');

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('order_number', 'like', $search . '%')
                    ->orWhere('customer_name', 'like', '%' . $search . '%')
                    ->orWhere('customer_phone', 'like', '%' . $search . '%');
            });
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->input('date_to'));
        }

        $perPage = min(max((int) $request->input('per_page', 20), 20), 500);

        $this->applyMappedSort($query, $request, [
            'code' => 'order_number',
            'customer' => 'customer_name',
            'date' => 'created_at',
            'line_count' => 'items_count',
            'revenue' => 'total_price',
            'cost' => 'cost_total',
            'profit' => 'profit_total',
            'status' => 'status',
        ], 'date', ['id' => 'desc']);

        return response()->json(
            $query->paginate($perPage)
        );
    }

    public function showExport(int $id)
    {
        $order = Order::query()
            ->with([
                'items.product:id,sku,name',
                'items.batchAllocations.batch',
                'customer:id,name,phone',
                'attributeValues.attribute:id,name,code',
            ])
            ->findOrFail($id);

        return response()->json($order);
    }

    private function sortDirection(Request $request): string
    {
        return strtolower((string) $request->input('sort_order', 'desc')) === 'asc' ? 'asc' : 'desc';
    }

    private function applyMappedSort($query, Request $request, array $sortMap, string $defaultSortKey, array $secondaryOrders = []): void
    {
        $sortKey = (string) $request->input('sort_by', $defaultSortKey);
        $direction = $this->sortDirection($request);
        $sortValue = $sortMap[$sortKey] ?? $sortMap[$defaultSortKey] ?? $defaultSortKey;

        if (is_array($sortValue) && isset($sortValue['raw'])) {
            $query->orderByRaw($sortValue['raw'] . ' ' . $direction);
        } else {
            $query->orderBy($sortValue, $direction);
        }

        foreach ($secondaryOrders as $column => $order) {
            $query->orderBy($column, $order);
        }
    }

    private function normalizeDocumentType(string $type): string
    {
        return match ($type) {
            'return', 'returns' => 'return',
            'damaged', 'damage' => 'damaged',
            'adjustment', 'adjustments' => 'adjustment',
            default => abort(404),
        };
    }

    private function buildInventoryProductsQuery(Request $request)
    {
        $query = Product::query()->select([
            'products.id',
            'products.sku',
            'products.name',
            'products.price',
            'products.expected_cost',
            'products.cost_price',
            'products.stock_quantity',
            'products.damaged_quantity',
            'products.status',
            'products.type',
            'products.category_id',
            'products.created_at',
            'products.deleted_at',
        ]);

        $this->applyInventoryProductFilters($query, $request);

        $importQtySub = \App\Models\ImportItem::query()
            ->join('imports', 'imports.id', '=', 'import_items.import_id')
            ->selectRaw('COALESCE(SUM(import_items.quantity), 0)')
            ->whereColumn('import_items.product_id', 'products.id');
        $this->applyDateRange($importQtySub, 'imports.import_date', $request);

        $exportQtySub = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->selectRaw('COALESCE(SUM(order_items.quantity), 0)')
            ->whereColumn('order_items.product_id', 'products.id')
            ->whereNull('orders.deleted_at');
        $this->applyDateRange($exportQtySub, 'orders.created_at', $request);

        $returnQtySub = \App\Models\InventoryDocumentItem::query()
            ->join('inventory_documents', 'inventory_documents.id', '=', 'inventory_document_items.inventory_document_id')
            ->selectRaw('COALESCE(SUM(inventory_document_items.quantity), 0)')
            ->whereColumn('inventory_document_items.product_id', 'products.id')
            ->where('inventory_documents.type', 'return');
        $this->applyDateRange($returnQtySub, 'inventory_documents.document_date', $request);

        $damagedQtySub = \App\Models\InventoryDocumentItem::query()
            ->join('inventory_documents', 'inventory_documents.id', '=', 'inventory_document_items.inventory_document_id')
            ->selectRaw('COALESCE(SUM(inventory_document_items.quantity), 0)')
            ->whereColumn('inventory_document_items.product_id', 'products.id')
            ->where('inventory_documents.type', 'damaged');
        $this->applyDateRange($damagedQtySub, 'inventory_documents.document_date', $request);

        $variantCountSub = DB::table('product_links')
            ->selectRaw('COUNT(*)')
            ->whereColumn('product_links.product_id', 'products.id')
            ->where('product_links.link_type', 'super_link');

        $parentIdSub = DB::table('product_links')
            ->select('product_links.product_id')
            ->whereColumn('product_links.linked_product_id', 'products.id')
            ->where('product_links.link_type', 'super_link')
            ->limit(1);

        return $query
            ->selectSub($importQtySub, 'total_imported')
            ->selectSub($exportQtySub, 'total_exported')
            ->selectSub($returnQtySub, 'total_returned')
            ->selectSub($damagedQtySub, 'total_damaged')
            ->selectSub($variantCountSub, 'variant_count')
            ->selectSub($parentIdSub, 'parent_product_id')
            ->selectRaw('COALESCE(products.cost_price, products.expected_cost, 0) as display_cost')
            ->selectRaw('products.stock_quantity * COALESCE(products.cost_price, products.expected_cost, 0) as inventory_value');
    }

    private function applyInventoryProductFilters($query, Request $request): void
    {
        if ($request->boolean('trash')) {
            $query->onlyTrashed();
        }

        $search = trim((string) ($request->input('quick_search') ?? $request->input('search') ?? ''));
        if ($search !== '') {
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('products.sku', 'like', '%' . $search . '%')
                    ->orWhere('products.name', 'like', '%' . $search . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($search) {
                        $variationQuery
                            ->where('products.sku', 'like', '%' . $search . '%')
                            ->orWhere('products.name', 'like', '%' . $search . '%');
                    })
                    ->orWhereHas('parentConfigurable', function ($parentQuery) use ($search) {
                        $parentQuery
                            ->where('products.sku', 'like', '%' . $search . '%')
                            ->orWhere('products.name', 'like', '%' . $search . '%');
                    });
            });
        }

        if ($request->filled('sku')) {
            $sku = trim((string) $request->input('sku'));
            $query->where(function ($builder) use ($sku) {
                $builder
                    ->where('products.sku', 'like', '%' . $sku . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($sku) {
                        $variationQuery->where('products.sku', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('parentConfigurable', function ($parentQuery) use ($sku) {
                        $parentQuery->where('products.sku', 'like', '%' . $sku . '%');
                    });
            });
        }

        if ($request->filled('name')) {
            $name = trim((string) $request->input('name'));
            $query->where(function ($builder) use ($name) {
                $builder
                    ->where('products.name', 'like', '%' . $name . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($name) {
                        $variationQuery->where('products.name', 'like', '%' . $name . '%');
                    })
                    ->orWhereHas('parentConfigurable', function ($parentQuery) use ($name) {
                        $parentQuery->where('products.name', 'like', '%' . $name . '%');
                    });
            });
        }

        if ($request->filled('status')) {
            $status = (string) $request->input('status');
            if ($status === 'active') {
                $query->where('products.status', true);
            } elseif ($status === 'inactive') {
                $query->where('products.status', false);
            }
        }

        if ($request->filled('cost_source')) {
            $costSource = (string) $request->input('cost_source');
            if ($costSource === 'expected') {
                $query->whereNull('products.cost_price')->whereNotNull('products.expected_cost');
            } elseif ($costSource === 'actual') {
                $query->whereNotNull('products.cost_price');
            } elseif ($costSource === 'empty') {
                $query->whereNull('products.cost_price')->whereNull('products.expected_cost');
            }
        }

        if ($request->filled('category_id')) {
            $categoryId = $request->input('category_id');
            if ($categoryId === 'uncategorized') {
                $query->whereNull('products.category_id');
            } else {
                $query->where('products.category_id', (int) $categoryId);
            }
        }

        if ($request->filled('supplier_id')) {
            $supplierId = $request->input('supplier_id');
            if ($supplierId === 'unassigned') {
                $query->whereNull('products.supplier_id');
            } else {
                $query->where('products.supplier_id', (int) $supplierId);
            }
        }

        if ($request->filled('type')) {
            $query->where('products.type', (string) $request->input('type'));
        }

        $variantScope = (string) $request->input('variant_scope', '');
        if ($variantScope === 'has_variants') {
            $query->whereHas('variations');
        } elseif ($variantScope === 'no_variants') {
            $query->whereDoesntHave('variations');
        } elseif ($variantScope === 'only_variants') {
            $query->whereHas('parentConfigurable');
        } elseif (in_array($variantScope, ['roots', 'parents_only'], true)) {
            $query->whereDoesntHave('parentConfigurable');
        }

        if ($request->filled('has_variants')) {
            if ($request->boolean('has_variants')) {
                $query->whereHas('variations');
            } else {
                $query->whereDoesntHave('variations');
            }
        }
    }

    private function inventoryProductSummary($query): array
    {
        $summary = DB::query()
            ->fromSub($query, 'inventory_products')
            ->selectRaw('COUNT(*) as total_products')
            ->selectRaw('COALESCE(SUM(total_imported), 0) as total_imported')
            ->selectRaw('COALESCE(SUM(total_exported), 0) as total_exported')
            ->selectRaw('COALESCE(SUM(total_returned), 0) as total_returned')
            ->selectRaw('COALESCE(SUM(total_damaged), 0) as total_damaged')
            ->selectRaw('COALESCE(SUM(stock_quantity), 0) as total_sellable_stock')
            ->selectRaw('COALESCE(SUM(damaged_quantity), 0) as total_damaged_stock')
            ->selectRaw('COALESCE(SUM(inventory_value), 0) as total_inventory_value')
            ->first();

        return [
            'total_products' => (int) ($summary->total_products ?? 0),
            'total_imported' => (int) round((float) ($summary->total_imported ?? 0)),
            'total_exported' => (int) round((float) ($summary->total_exported ?? 0)),
            'total_returned' => (int) round((float) ($summary->total_returned ?? 0)),
            'total_damaged' => (int) round((float) ($summary->total_damaged ?? 0)),
            'total_sellable_stock' => (int) round((float) ($summary->total_sellable_stock ?? 0)),
            'total_damaged_stock' => (int) round((float) ($summary->total_damaged_stock ?? 0)),
            'total_inventory_value' => round((float) ($summary->total_inventory_value ?? 0), 2),
        ];
    }

    private function applySupplierImportDateFilter($query, Request $request): void
    {
        $this->applyDateRange($query, 'imports.import_date', $request);

        if ($request->filled('month')) {
            $month = trim((string) $request->input('month'));
            if (preg_match('/^\\d{4}-\\d{2}$/', $month) === 1) {
                [$year, $monthNumber] = explode('-', $month);
                $query->whereYear('imports.import_date', (int) $year)
                    ->whereMonth('imports.import_date', (int) $monthNumber);
            }
        }
    }

    private function applyDateRange($query, string $column, Request $request): void
    {
        if ($request->filled('date_from')) {
            $query->whereDate($column, '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate($column, '<=', $request->input('date_to'));
        }
    }

    private function supplierPriceMap(Request $request, $productIds)
    {
        if (!$request->filled('supplier_id')) {
            return collect();
        }

        return $this->supplierPriceMapBySupplierId((int) $request->input('supplier_id'), $productIds);
    }

    private function supplierPriceMapBySupplierId(int $supplierId, $productIds)
    {
        if (!$supplierId) {
            return collect();
        }

        $ids = collect($productIds)->map(fn ($id) => (int) $id)->filter()->unique()->values()->all();
        if (empty($ids)) {
            return collect();
        }

        return SupplierProductPrice::query()
            ->where('supplier_id', $supplierId)
            ->whereIn('product_id', $ids)
            ->with(['updater:id,name'])
            ->get()
            ->keyBy('product_id');
    }

    private function inventoryProductPayload(Product $product, ?SupplierProductPrice $supplierPrice = null, $supplierPriceMap = null): array
    {
        $currentCost = $product->cost_price !== null ? (float) $product->cost_price : null;
        $expectedCost = $product->expected_cost !== null ? (float) $product->expected_cost : null;
        $costSource = $currentCost !== null ? 'current_cost' : ($expectedCost !== null ? 'expected_cost' : 'empty');
        $parentProduct = $product->relationLoaded('parentConfigurable') ? $product->parentConfigurable->first() : null;
        $variantCount = (int) ($product->variant_count ?? ($product->relationLoaded('variations') ? $product->variations->count() : 0));

        $payload = [
            'id' => $product->id,
            'sku' => $product->sku,
            'name' => $product->name,
            'price' => (float) ($product->price ?? 0),
            'stock_quantity' => (int) ($product->stock_quantity ?? 0),
            'damaged_quantity' => (int) ($product->damaged_quantity ?? 0),
            'status' => (bool) $product->status,
            'type' => $product->type,
            'type_label' => match ($product->type) {
                'configurable' => 'Sản phẩm có biến thể',
                'bundle' => 'Bộ sản phẩm',
                'grouped' => 'Nhóm sản phẩm',
                'virtual' => 'Sản phẩm ảo',
                'downloadable' => 'Tải về',
                default => 'Sản phẩm thường',
            },
            'category_id' => $product->category_id,
            'category_name' => $product->relationLoaded('category') ? $product->category?->name : null,
            'current_cost' => $currentCost,
            'expected_cost' => $expectedCost,
            'display_cost' => round((float) ($product->display_cost ?? ($currentCost ?? $expectedCost ?? 0)), 2),
            'cost_source' => $costSource,
            'price_status' => match ($costSource) {
                'current_cost' => 'Đang dùng giá vốn',
                'expected_cost' => 'Đang dùng giá dự kiến',
                default => 'Chưa có giá',
            },
            'total_imported' => (int) round((float) ($product->total_imported ?? 0)),
            'total_exported' => (int) round((float) ($product->total_exported ?? 0)),
            'total_returned' => (int) round((float) ($product->total_returned ?? 0)),
            'total_damaged' => (int) round((float) ($product->total_damaged ?? 0)),
            'inventory_value' => round((float) ($product->inventory_value ?? 0), 2),
            'has_variants' => $variantCount > 0,
            'variant_count' => $variantCount,
            'is_variant' => $parentProduct !== null || !empty($product->parent_product_id),
            'parent_id' => $parentProduct?->id ?? (!empty($product->parent_product_id) ? (int) $product->parent_product_id : null),
            'parent_name' => $parentProduct?->name,
            'parent_sku' => $parentProduct?->sku,
            'supplier_unit_cost' => $supplierPrice ? (float) $supplierPrice->unit_cost : null,
            'supplier_price_id' => $supplierPrice?->id,
            'supplier_price_updated_at' => $supplierPrice?->updated_at,
            'supplier_notes' => $supplierPrice?->notes,
            'supplier_updater_name' => $supplierPrice?->relationLoaded('updater') ? $supplierPrice->updater?->name : null,
            'deleted_at' => $product->deleted_at,
            'created_at' => $product->created_at,
        ];

        if ($product->relationLoaded('variations')) {
            $payload['variants'] = $product->variations->map(function (Product $variant) use ($supplierPriceMap) {
                return $this->inventoryProductPayload($variant, $supplierPriceMap?->get($variant->id));
            })->values();
        }

        return $payload;
    }

    private function productPayload(Product $product, ?SupplierProductPrice $supplierPrice = null): array
    {
        $currentCost = $product->cost_price !== null ? (float) $product->cost_price : null;
        $expectedCost = $product->expected_cost !== null ? (float) $product->expected_cost : null;
        $costSource = $currentCost !== null ? 'current_cost' : ($expectedCost !== null ? 'expected_cost' : 'empty');

        return [
            'id' => $product->id,
            'sku' => $product->sku,
            'name' => $product->name,
            'price' => (float) ($product->price ?? 0),
            'stock_quantity' => (int) ($product->stock_quantity ?? 0),
            'damaged_quantity' => (int) ($product->damaged_quantity ?? 0),
            'status' => (bool) $product->status,
            'current_cost' => $currentCost,
            'expected_cost' => $expectedCost,
            'cost_source' => $costSource,
            'price_status' => match ($costSource) {
                'current_cost' => 'Đang dùng giá vốn',
                'expected_cost' => 'Đang dùng giá dự kiến',
                default => 'Chưa có giá',
            },
            'supplier_unit_cost' => $supplierPrice ? (float) $supplierPrice->unit_cost : null,
            'supplier_price_id' => $supplierPrice?->id,
            'supplier_price_updated_at' => $supplierPrice?->updated_at,
            'deleted_at' => $product->deleted_at,
            'created_at' => $product->created_at,
        ];
    }

    private function normalizeSupplierUnitCost($value): int
    {
        return (int) round((float) $value);
    }
}
