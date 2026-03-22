<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryImport;
use App\Models\InventoryImportStatus;
use App\Models\InventoryInvoiceAnalysisLog;
use App\Models\InventoryUnit;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\SupplierProductPrice;
use App\Services\Inventory\InvoiceAnalysisService;
use App\Services\Inventory\InventoryService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function __construct(
        private readonly InventoryService $inventoryService,
        private readonly InvoiceAnalysisService $invoiceAnalysisService,
    )
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
        $isPickerMode = $request->boolean('picker') || $request->boolean('quick_lookup') || $request->boolean('without_summary');
        $query = $this->buildInventoryProductsQuery($request, $isPickerMode);
        $summary = $isPickerMode ? null : $this->inventoryProductSummary(clone $query);
        $withVariants = $request->boolean('with_variants');
        $searchTerm = trim((string) ($request->input('quick_search') ?? $request->input('search') ?? ''));

        $baseRelations = [
            'unit:id,name',
            'parentConfigurable:id,name,sku',
            'supplierPrices' => function ($builder) {
                $builder
                    ->select(['id', 'supplier_id', 'product_id', 'unit_cost', 'supplier_product_code', 'updated_at']);
            },
        ];

        if (!$isPickerMode) {
            $baseRelations[] = 'category:id,name';
            $baseRelations[] = 'suppliers:id,name,code';
            $baseRelations['supplierPrices'] = function ($builder) {
                $builder
                    ->select(['id', 'supplier_id', 'product_id', 'unit_cost', 'supplier_product_code', 'updated_at'])
                    ->with(['supplier:id,name,code']);
            };
        }

        $query->with($baseRelations);

        if ($withVariants) {
            $query->with([
                'variations' => function ($builder) use ($isPickerMode) {
                    $variationRelations = [
                        'unit:id,name',
                        'parentConfigurable:id,name,sku',
                        'supplierPrices' => function ($priceBuilder) {
                            $priceBuilder
                                ->select(['id', 'supplier_id', 'product_id', 'unit_cost', 'supplier_product_code', 'updated_at']);
                        },
                    ];

                    if (!$isPickerMode) {
                        $variationRelations[] = 'category:id,name';
                        $variationRelations[] = 'suppliers:id,name,code';
                        $variationRelations['supplierPrices'] = function ($priceBuilder) {
                            $priceBuilder
                                ->select(['id', 'supplier_id', 'product_id', 'unit_cost', 'supplier_product_code', 'updated_at'])
                                ->with(['supplier:id,name,code']);
                        };
                    }

                    $builder
                        ->select([
                            'products.id',
                            'products.sku',
                            'products.name',
                            'products.price',
                            'products.expected_cost',
                            'products.cost_price',
                            'products.inventory_unit_id',
                            'products.stock_quantity',
                            'products.damaged_quantity',
                            'products.status',
                            'products.type',
                            'products.category_id',
                            'products.created_at',
                            'products.deleted_at',
                        ])
                        ->with($variationRelations)
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
        if ($searchTerm !== '') {
            $query
                ->orderByDesc('search_score')
                ->orderBy('products.name', 'asc')
                ->orderBy('products.created_at', 'desc');
        } else {
            $query->orderBy(in_array($sortBy, $allowedSorts, true) ? $sortBy : 'created_at', $sortOrder);
        }

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

        $paginated->getCollection()->transform(function (Product $product) use ($supplierPriceMap, $withVariants, $isPickerMode) {
            return $this->inventoryProductPayload(
                $product,
                $supplierPriceMap->get($product->id),
                $withVariants ? $supplierPriceMap : null,
                $isPickerMode
            );
        });

        $response = $paginated->toArray();
        if (!$isPickerMode) {
            $response['summary'] = $summary;
        }

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
                'products.inventory_unit_id',
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
                $this->applySupplierMembershipFilter($builder, $supplier->id);
                $builder
                    ->orWhereNotNull('supplier_price_rows.id')
                    ->orWhereHas('variations', function ($variationQuery) use ($supplier) {
                        $this->applySupplierMembershipFilter($variationQuery, $supplier->id);
                    });
            })
            ->whereDoesntHave('parentConfigurable')
            ->with([
                'category:id,name',
                'unit:id,name',
                'suppliers:id,name,code',
                'supplierPrices' => function ($builder) {
                    $builder
                        ->select(['id', 'supplier_id', 'product_id', 'supplier_product_code', 'unit_cost', 'updated_at'])
                        ->with(['supplier:id,name,code']);
                },
                'variations' => function ($builder) use ($supplier) {
                    $builder
                        ->select([
                            'products.id',
                            'products.sku',
                            'products.name',
                            'products.price',
                            'products.expected_cost',
                            'products.cost_price',
                            'products.inventory_unit_id',
                            'products.stock_quantity',
                            'products.damaged_quantity',
                            'products.status',
                            'products.type',
                            'products.category_id',
                            'products.created_at',
                            'products.deleted_at',
                        ])
                        ->where(function ($variationQuery) use ($supplier) {
                            $this->applySupplierMembershipFilter($variationQuery, $supplier->id);
                        })
                        ->with([
                            'category:id,name',
                            'unit:id,name',
                            'parentConfigurable:id,name,sku',
                            'suppliers:id,name,code',
                            'supplierPrices' => function ($priceBuilder) {
                                $priceBuilder
                                    ->select(['id', 'supplier_id', 'product_id', 'supplier_product_code', 'unit_cost', 'updated_at'])
                                    ->with(['supplier:id,name,code']);
                            },
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
                    ->orWhere('supplier_price_rows.supplier_product_code', 'like', '%' . $search . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($search) {
                        $variationQuery
                            ->where('products.sku', 'like', '%' . $search . '%')
                            ->orWhere('products.name', 'like', '%' . $search . '%');
                    })
                    ->orWhereHas('variations.supplierPrices', function ($priceQuery) use ($search, $supplier) {
                        $priceQuery
                            ->where('supplier_id', $supplier->id)
                            ->where('supplier_product_code', 'like', '%' . $search . '%');
                    });
            });
        }

        if ($request->filled('sku')) {
            $sku = trim((string) $request->input('sku'));
            $query->where(function ($productQuery) use ($sku) {
                $productQuery
                    ->where('products.sku', 'like', '%' . $sku . '%')
                    ->orWhere('supplier_price_rows.supplier_product_code', 'like', '%' . $sku . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($sku) {
                        $variationQuery
                            ->where('products.sku', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('variations.supplierPrices', function ($priceQuery) use ($sku, $supplier) {
                        $priceQuery
                            ->where('supplier_id', $supplier->id)
                            ->where('supplier_product_code', 'like', '%' . $sku . '%');
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

        if ($request->boolean('missing_supplier_price')) {
            $query->where(function ($builder) use ($supplier) {
                $builder
                    ->whereNull('supplier_price_rows.id')
                    ->orWhereNull('supplier_price_rows.unit_cost')
                    ->orWhere('supplier_price_rows.unit_cost', '<=', 0)
                    ->orWhereHas('variations', function ($variationQuery) use ($supplier) {
                        $this->applySupplierMembershipFilter($variationQuery, $supplier->id);
                        $variationQuery->whereDoesntHave('supplierPrices', function ($priceQuery) use ($supplier) {
                            $priceQuery
                                ->where('supplier_id', $supplier->id)
                                ->whereNotNull('unit_cost')
                                ->where('unit_cost', '>', 0);
                        });
                    });
            });
        }

        if ($request->boolean('multiple_suppliers')) {
            $query->where(function ($builder) {
                $builder
                    ->has('suppliers', '>', 1)
                    ->orWhereIn('products.id', function ($subQuery) {
                        $subQuery
                            ->from('supplier_product_prices')
                            ->select('product_id')
                            ->groupBy('product_id')
                            ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                    })
                    ->orWhereHas('variations', function ($variationQuery) {
                        $variationQuery->where(function ($nested) {
                            $nested
                                ->has('suppliers', '>', 1)
                                ->orWhereIn('products.id', function ($subQuery) {
                                    $subQuery
                                        ->from('supplier_product_prices')
                                        ->select('product_id')
                                        ->groupBy('product_id')
                                        ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                                });
                        });
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
            'supplier_product_code' => 'supplier_price_rows.supplier_product_code',
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
            'supplier_product_code' => 'nullable|string|max:255',
            'unit_cost' => 'required|numeric|min:0',
            'notes' => 'nullable|string|max:1000',
        ]);

        $product = Product::query()->findOrFail((int) $validated['product_id']);
        $product->suppliers()->syncWithoutDetaching([
            $supplier->id => ['account_id' => $supplier->account_id ?? $product->account_id],
        ]);
        if (!$product->supplier_id) {
            $product->update(['supplier_id' => $supplier->id]);
        }

        $price = SupplierProductPrice::query()->updateOrCreate(
            [
                'supplier_id' => $supplier->id,
                'product_id' => (int) $validated['product_id'],
            ],
            [
                'account_id' => $supplier->account_id,
                'supplier_product_code' => isset($validated['supplier_product_code']) && trim((string) $validated['supplier_product_code']) !== ''
                    ? trim((string) $validated['supplier_product_code'])
                    : null,
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
            'supplier_product_code' => 'nullable|string|max:255',
            'unit_cost' => 'required|numeric|min:0',
            'notes' => 'nullable|string|max:1000',
        ]);

        $price->forceFill([
            'supplier_product_code' => isset($validated['supplier_product_code']) && trim((string) $validated['supplier_product_code']) !== ''
                ? trim((string) $validated['supplier_product_code'])
                : null,
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
            'items.*.supplier_product_code' => 'nullable|string|max:255',
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
                ->get()
                ->each(function (Product $product) use ($supplier) {
                    $product->suppliers()->syncWithoutDetaching([
                        $supplier->id => ['account_id' => $supplier->account_id ?? $product->account_id],
                    ]);

                    if (!$product->supplier_id) {
                        $product->update(['supplier_id' => $supplier->id]);
                    }
                });
        }

        foreach ($validated['items'] as $item) {
            $price = SupplierProductPrice::query()->updateOrCreate(
                [
                    'supplier_id' => $supplier->id,
                    'product_id' => (int) $item['product_id'],
                ],
                [
                    'account_id' => $supplier->account_id,
                    'supplier_product_code' => isset($item['supplier_product_code']) && trim((string) $item['supplier_product_code']) !== ''
                        ? trim((string) $item['supplier_product_code'])
                        : null,
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

    public function inventoryUnits(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');

        $units = InventoryUnit::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->orderByRaw('CASE WHEN account_id = ? THEN 0 ELSE 1 END', [$accountId])
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        return response()->json($units);
    }

    public function storeInventoryUnit(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'name' => 'required|string|max:80',
        ]);

        $name = trim((string) $validated['name']);
        $normalizedName = Str::lower(Str::ascii($name));
        $code = Str::upper(Str::slug($name, '_'));

        $existing = InventoryUnit::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->where('normalized_name', $normalizedName)
            ->first();

        if ($existing) {
            return response()->json($existing);
        }

        $unit = InventoryUnit::create([
            'account_id' => $accountId,
            'name' => $name,
            'normalized_name' => $normalizedName,
            'code' => $code !== '' ? $code : Str::upper(Str::random(6)),
            'is_default' => false,
            'is_system' => false,
            'sort_order' => (int) InventoryUnit::query()->where('account_id', $accountId)->max('sort_order') + 1,
            'created_by' => auth()->id(),
        ]);

        return response()->json($unit, 201);
    }

    public function importStatuses(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');

        $statuses = InventoryImportStatus::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->when($request->boolean('active_only'), function ($builder) {
                $builder->where('is_active', true);
            })
            ->orderByRaw('CASE WHEN account_id = ? THEN 0 ELSE 1 END', [$accountId])
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json($statuses);
    }

    public function storeImportStatus(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'color' => ['nullable', 'string', 'max:20', 'regex:/^#?[0-9a-fA-F]{3,8}$/'],
            'affects_inventory' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'is_default' => 'nullable|boolean',
        ]);

        $name = trim((string) $validated['name']);
        $code = $this->uniqueImportStatusCode($name, $accountId);

        if (!empty($validated['is_default'])) {
            InventoryImportStatus::query()
                ->where('account_id', $accountId)
                ->update(['is_default' => false]);
        }

        $status = InventoryImportStatus::create([
            'account_id' => $accountId,
            'code' => $code,
            'name' => $name,
            'color' => $validated['color'] ?? '#1d4ed8',
            'sort_order' => (int) InventoryImportStatus::query()->where('account_id', $accountId)->max('sort_order') + 1,
            'is_default' => (bool) ($validated['is_default'] ?? false),
            'is_system' => false,
            'is_active' => (bool) ($validated['is_active'] ?? true),
            'affects_inventory' => (bool) ($validated['affects_inventory'] ?? false),
        ]);

        return response()->json($status, 201);
    }

    public function updateImportStatus(Request $request, int $id)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'name' => 'required|string|max:120',
            'color' => ['nullable', 'string', 'max:20', 'regex:/^#?[0-9a-fA-F]{3,8}$/'],
            'affects_inventory' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'is_default' => 'nullable|boolean',
        ]);

        $status = InventoryImportStatus::query()
            ->where(function ($builder) use ($accountId) {
                $builder
                    ->whereNull('account_id')
                    ->orWhere('account_id', $accountId);
            })
            ->findOrFail($id);

        if ($status->account_id === null) {
            $status = InventoryImportStatus::firstOrNew([
                'account_id' => $accountId,
                'code' => $status->code,
            ]);

            if (!$status->exists) {
                $status->fill([
                    'sort_order' => (int) InventoryImportStatus::query()->where('account_id', $accountId)->max('sort_order') + 1,
                    'is_system' => false,
                ]);
            }
        }

        if (!empty($validated['is_default'])) {
            InventoryImportStatus::query()
                ->where('account_id', $accountId)
                ->where('id', '!=', $status->id ?: 0)
                ->update(['is_default' => false]);
        }

        $status->fill([
            'name' => trim((string) $validated['name']),
            'color' => $validated['color'] ?? '#1d4ed8',
            'is_default' => (bool) ($validated['is_default'] ?? $status->is_default),
            'is_active' => (bool) ($validated['is_active'] ?? $status->is_active),
            'affects_inventory' => (bool) ($validated['affects_inventory'] ?? $status->affects_inventory),
        ]);
        $status->save();

        InventoryImport::query()
            ->where('account_id', $accountId)
            ->where('inventory_import_status_id', $id)
            ->update([
                'inventory_import_status_id' => $status->id,
                'status' => $status->code,
            ]);

        return response()->json($status);
    }

    public function analyzeImportInvoice(Request $request)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $validated = $request->validate([
            'supplier_id' => 'nullable|integer|exists:suppliers,id',
            'invoice_file' => 'required|file|max:12288|mimes:pdf,jpg,jpeg,png,webp,txt,csv,json',
        ]);

        return response()->json(
            $this->invoiceAnalysisService->analyzeUploadedInvoice(
                $request->file('invoice_file'),
                $accountId,
                $validated['supplier_id'] ?? null,
                auth()->id()
            )
        );
    }

    public function showInvoiceAnalysis(int $id)
    {
        return response()->json(
            $this->invoiceAnalysisService->getAnalysisLog($id)
        );
    }

    public function imports(Request $request)
    {
        $query = InventoryImport::query()
            ->withCount('items')
            ->with(['supplier:id,name', 'creator:id,name', 'statusConfig:id,code,name,color,affects_inventory'])
            ->withSum('items as lines_total_amount', 'line_total')
            ->withSum('items as total_received_quantity', 'received_quantity');

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

        if ($request->filled('inventory_import_status_id')) {
            $query->where('inventory_import_status_id', (int) $request->input('inventory_import_status_id'));
        }

        if ($request->filled('entry_mode')) {
            $query->where('entry_mode', (string) $request->input('entry_mode'));
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
            'status' => 'inventory_import_status_id',
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
        $validated = $this->validatedImportPayload($request);

        $import = $this->inventoryService->createImport($validated, $accountId, auth()->id());

        return response()->json($import, 201);
    }

    public function showImport(int $id)
    {
        $import = InventoryImport::query()
            ->with([
                'supplier:id,name,phone,email,address',
                'statusConfig:id,code,name,color,affects_inventory',
                'items.product:id,sku,name,price,stock_quantity,inventory_unit_id',
                'items.product.unit:id,name',
                'items.batch',
                'items.supplierPrice',
                'attachments',
                'invoiceAnalysisLogs',
                'creator:id,name',
            ])
            ->findOrFail($id);

        return response()->json($import);
    }

    public function updateImport(Request $request, int $id)
    {
        $accountId = (int) $request->header('X-Account-Id');
        $import = InventoryImport::query()->findOrFail($id);
        $validated = $this->validatedImportPayload($request);

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

    private function applySupplierMembershipFilter($query, int $supplierId): void
    {
        $query->where(function ($builder) use ($supplierId) {
            $builder
                ->whereHas('suppliers', function ($supplierQuery) use ($supplierId) {
                    $supplierQuery->where('suppliers.id', $supplierId);
                })
                ->orWhere('products.supplier_id', $supplierId)
                ->orWhereHas('supplierPrices', function ($priceQuery) use ($supplierId) {
                    $priceQuery->where('supplier_id', $supplierId);
                });
        });
    }

    private function applyInventorySupplierScopeFilter(Builder $query, int $supplierId): void
    {
        $query->where(function (Builder $builder) use ($supplierId) {
            $this->applySupplierMembershipFilter($builder, $supplierId);

            $builder
                ->orWhereHas('variations', function (Builder $variationQuery) use ($supplierId) {
                    $this->applySupplierMembershipFilter($variationQuery, $supplierId);
                })
                ->orWhereHas('parentConfigurable', function (Builder $parentQuery) use ($supplierId) {
                    $this->applySupplierMembershipFilter($parentQuery, $supplierId);
                });
        });
    }

    private function applyInventoryProductSearch(Builder $query, string $rawSearch, ?int $supplierIdForCodeSearch = null): void
    {
        $rawSearch = trim($rawSearch);
        if ($rawSearch === '') {
            return;
        }

        $normalizedSearch = Str::of($rawSearch)
            ->lower()
            ->ascii()
            ->replaceMatches('/[^a-z0-9\s]+/', ' ')
            ->squish()
            ->toString();

        $strictTokens = collect(preg_split('/\s+/', $normalizedSearch, -1, PREG_SPLIT_NO_EMPTY))
            ->map(fn ($token) => trim($token))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->unique()
            ->take(6)
            ->values()
            ->all();

        $escapeLike = static fn ($value) => str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
        $nameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
        $skuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
        $keywordExpr = "immutable_unaccent(COALESCE(products.meta_keywords, ''))";
        $compactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";
        $phraseLike = '%' . $escapeLike($rawSearch) . '%';
        $prefixLike = $escapeLike($rawSearch) . '%';
        $compactSearch = preg_replace('/[^a-z0-9]+/', '', $normalizedSearch);
        $compactPhraseLike = $compactSearch !== '' ? '%' . $escapeLike($compactSearch) . '%' : null;
        $compactPrefixLike = $compactSearch !== '' ? $escapeLike($compactSearch) . '%' : null;
        $strictTokenMatchParts = [];
        $strictTokenMatchBindings = [];

        foreach ($strictTokens as $token) {
            $tokenLike = '%' . $escapeLike($token) . '%';
            $compactToken = preg_replace('/[^a-z0-9]+/', '', $token);
            $compactTokenLike = '%' . $escapeLike($compactToken) . '%';
            $strictTokenMatchParts[] = "CASE WHEN ({$nameExpr} ILIKE immutable_unaccent(?) OR {$skuExpr} ILIKE immutable_unaccent(?) OR {$keywordExpr} ILIKE immutable_unaccent(?) OR {$compactSkuExpr} ILIKE immutable_unaccent(?)) THEN 1 ELSE 0 END";
            array_push($strictTokenMatchBindings, $tokenLike, $tokenLike, $tokenLike, $compactTokenLike);
        }

        $strictTokenMatchSql = !empty($strictTokenMatchParts) ? '(' . implode(' + ', $strictTokenMatchParts) . ')' : '0';
        $minimumRelevantMatches = count($strictTokens) <= 1 ? 1 : max(2, count($strictTokens) - 1);
        $searchRankingParts = [
            "CASE WHEN {$skuExpr} = immutable_unaccent(?) THEN 1600 ELSE 0 END",
            "CASE WHEN {$nameExpr} = immutable_unaccent(?) THEN 1500 ELSE 0 END",
            "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 980 ELSE 0 END",
            "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 930 ELSE 0 END",
            "CASE WHEN {$keywordExpr} ILIKE immutable_unaccent(?) THEN 760 ELSE 0 END",
            "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 860 ELSE 0 END",
            "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 820 ELSE 0 END",
            "CASE WHEN {$keywordExpr} ILIKE immutable_unaccent(?) THEN 640 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $rawSearch,
            $rawSearch,
            $prefixLike,
            $prefixLike,
            $prefixLike,
            $phraseLike,
            $phraseLike,
            $phraseLike,
        ];

        if ($compactPhraseLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 920 ELSE 0 END";
            $searchRankingBindings[] = $compactPhraseLike;
        }

        if ($compactPrefixLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END";
            $searchRankingBindings[] = $compactPrefixLike;
        }

        if (!empty($strictTokenMatchParts)) {
            $searchRankingParts[] = "({$strictTokenMatchSql} * 140)";
            $searchRankingBindings = array_merge($searchRankingBindings, $strictTokenMatchBindings);
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use (
            $nameExpr,
            $skuExpr,
            $keywordExpr,
            $compactSkuExpr,
            $phraseLike,
            $compactPhraseLike,
            $strictTokenMatchSql,
            $strictTokenMatchBindings,
            $minimumRelevantMatches,
            $supplierIdForCodeSearch
        ) {
            $searchQuery
                ->whereRaw("{$nameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                ->orWhereRaw("{$skuExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                ->orWhereRaw("{$keywordExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

            if ($compactPhraseLike !== null) {
                $searchQuery->orWhereRaw("{$compactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
            }

            if ($strictTokenMatchSql !== '0') {
                $searchQuery->orWhereRaw("{$strictTokenMatchSql} >= ?", array_merge($strictTokenMatchBindings, [$minimumRelevantMatches]));
            }

            $searchQuery
                ->orWhereHas('variations', function (Builder $variationQuery) use ($phraseLike, $compactPhraseLike) {
                    $variationNameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                    $variationSkuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                    $variationKeywordExpr = "immutable_unaccent(COALESCE(products.meta_keywords, ''))";
                    $variationCompactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";

                    $variationQuery
                        ->whereRaw("{$variationNameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$variationSkuExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$variationKeywordExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                    if ($compactPhraseLike !== null) {
                        $variationQuery->orWhereRaw("{$variationCompactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                    }
                })
                ->orWhereHas('parentConfigurable', function (Builder $parentQuery) use ($phraseLike, $compactPhraseLike) {
                    $parentNameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                    $parentSkuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                    $parentKeywordExpr = "immutable_unaccent(COALESCE(products.meta_keywords, ''))";
                    $parentCompactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";

                    $parentQuery
                        ->whereRaw("{$parentNameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$parentSkuExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$parentKeywordExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                    if ($compactPhraseLike !== null) {
                        $parentQuery->orWhereRaw("{$parentCompactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                    }
                })
                ->orWhereHas('supplierPrices', function (Builder $priceQuery) use ($phraseLike, $supplierIdForCodeSearch) {
                    if ($supplierIdForCodeSearch) {
                        $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                    }

                    $priceQuery->whereRaw("immutable_unaccent(COALESCE(supplier_product_code, '')) ILIKE immutable_unaccent(?)", [$phraseLike]);
                })
                ->orWhereHas('variations.supplierPrices', function (Builder $priceQuery) use ($phraseLike, $supplierIdForCodeSearch) {
                    if ($supplierIdForCodeSearch) {
                        $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                    }

                    $priceQuery->whereRaw("immutable_unaccent(COALESCE(supplier_product_code, '')) ILIKE immutable_unaccent(?)", [$phraseLike]);
                })
                ->orWhereHas('parentConfigurable.supplierPrices', function (Builder $priceQuery) use ($phraseLike, $supplierIdForCodeSearch) {
                    if ($supplierIdForCodeSearch) {
                        $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                    }

                    $priceQuery->whereRaw("immutable_unaccent(COALESCE(supplier_product_code, '')) ILIKE immutable_unaccent(?)", [$phraseLike]);
                });
        });
    }

    private function productSupplierIds(Product $product): array
    {
        $ids = collect();

        if ($product->relationLoaded('suppliers')) {
            $ids = $ids->merge($product->suppliers->pluck('id'));
        }

        if ($product->relationLoaded('supplierPrices')) {
            $ids = $ids->merge($product->supplierPrices->pluck('supplier_id'));
        }

        if (!empty($product->supplier_id)) {
            $ids->push($product->supplier_id);
        }

        return $ids
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function productSupplierPayload(Product $product): array
    {
        $byId = collect();

        if ($product->relationLoaded('suppliers')) {
            $byId = $byId->merge($product->suppliers->mapWithKeys(function ($supplier) {
                return [(int) $supplier->id => [
                    'id' => (int) $supplier->id,
                    'name' => $supplier->name,
                    'code' => $supplier->code,
                ]];
            }));
        }

        if ($product->relationLoaded('supplierPrices')) {
            $product->supplierPrices
                ->filter(fn ($price) => $price->relationLoaded('supplier') && $price->supplier)
                ->each(function ($price) use (&$byId) {
                    $supplier = $price->supplier;
                    $byId->put((int) $supplier->id, [
                        'id' => (int) $supplier->id,
                        'name' => $supplier->name,
                        'code' => $supplier->code,
                    ]);
                });
        }

        return $byId->values()->all();
    }

    private function productSupplierComparisons(Product $product): array
    {
        if (!$product->relationLoaded('supplierPrices')) {
            return [];
        }

        $comparisons = $product->supplierPrices
            ->filter(function ($price) {
                return $price->relationLoaded('supplier')
                    && $price->supplier
                    && $price->unit_cost !== null
                    && (float) $price->unit_cost > 0;
            })
            ->sortBy('unit_cost')
            ->values();

        $cheapestId = $comparisons->first()?->supplier_id;

        return $comparisons->map(function ($price) use ($cheapestId) {
            return [
                'supplier_id' => (int) $price->supplier_id,
                'supplier_name' => $price->supplier?->name,
                'supplier_code' => $price->supplier?->code,
                'unit_cost' => (float) $price->unit_cost,
                'updated_at' => $price->updated_at,
                'is_lowest' => (int) $price->supplier_id === (int) $cheapestId,
            ];
        })->all();
    }

    private function buildInventoryProductsQuery(Request $request, bool $compact = false)
    {
        $query = Product::query()->select([
            'products.id',
            'products.sku',
            'products.name',
            'products.price',
            'products.expected_cost',
            'products.cost_price',
            'products.inventory_unit_id',
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

        if ($compact) {
            return $query
                ->selectSub($variantCountSub, 'variant_count')
                ->selectSub($parentIdSub, 'parent_product_id')
                ->selectRaw('COALESCE(products.cost_price, products.expected_cost, 0) as display_cost')
                ->selectRaw('products.stock_quantity * COALESCE(products.cost_price, products.expected_cost, 0) as inventory_value');
        }

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

        $requestedIds = $request->input('ids', []);
        if (!is_array($requestedIds)) {
            $requestedIds = explode(',', (string) $requestedIds);
        }

        $productIds = collect($requestedIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (!empty($productIds)) {
            $query->whereIn('products.id', $productIds);
        }

        $supplierIdForCodeSearch = null;
        if ($request->filled('supplier_id') && $request->input('supplier_id') !== 'unassigned') {
            $supplierIdForCodeSearch = (int) $request->input('supplier_id');
        }

        $search = trim((string) ($request->input('quick_search') ?? $request->input('search') ?? ''));
        if ($search !== '') {
            $this->applyInventoryProductSearch($query, $search, $supplierIdForCodeSearch);
        }

        if ($request->filled('sku')) {
            $sku = trim((string) $request->input('sku'));
            $query->where(function ($builder) use ($sku, $supplierIdForCodeSearch) {
                $builder
                    ->where('products.sku', 'like', '%' . $sku . '%')
                    ->orWhereHas('variations', function ($variationQuery) use ($sku) {
                        $variationQuery
                            ->where('products.sku', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('parentConfigurable', function ($parentQuery) use ($sku) {
                        $parentQuery->where('products.sku', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('supplierPrices', function ($priceQuery) use ($sku, $supplierIdForCodeSearch) {
                        if ($supplierIdForCodeSearch) {
                            $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                        }

                        $priceQuery->where('supplier_product_code', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('variations.supplierPrices', function ($priceQuery) use ($sku, $supplierIdForCodeSearch) {
                        if ($supplierIdForCodeSearch) {
                            $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                        }

                        $priceQuery->where('supplier_product_code', 'like', '%' . $sku . '%');
                    })
                    ->orWhereHas('parentConfigurable.supplierPrices', function ($priceQuery) use ($sku, $supplierIdForCodeSearch) {
                        if ($supplierIdForCodeSearch) {
                            $priceQuery->where('supplier_id', $supplierIdForCodeSearch);
                        }

                        $priceQuery->where('supplier_product_code', 'like', '%' . $sku . '%');
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
                $query
                    ->whereNull('products.supplier_id')
                    ->whereDoesntHave('suppliers')
                    ->whereDoesntHave('supplierPrices');
            } else {
                $this->applyInventorySupplierScopeFilter($query, (int) $supplierId);
            }
        }

        if ($request->boolean('missing_purchase_price')) {
            $query->whereDoesntHave('supplierPrices', function ($priceQuery) {
                $priceQuery
                    ->whereNotNull('unit_cost')
                    ->where('unit_cost', '>', 0);
            });
        }

        if ($request->boolean('multiple_suppliers')) {
            $query->where(function ($builder) {
                $builder
                    ->has('suppliers', '>', 1)
                    ->orWhereIn('products.id', function ($subQuery) {
                        $subQuery
                            ->from('supplier_product_prices')
                            ->select('product_id')
                            ->groupBy('product_id')
                            ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                    });
            });
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

    private function validatedImportPayload(Request $request): array
    {
        $payload = $request->all();
        $payload['items'] = $this->decodeJsonArrayInput($request->input('items', $payload['items'] ?? []));
        $payload['attachments'] = $this->decodeJsonArrayInput($request->input('attachments', $payload['attachments'] ?? []));
        $payload['attachments'] = array_merge(
            is_array($payload['attachments']) ? $payload['attachments'] : [],
            $this->storeImportAttachmentFiles($request)
        );

        if (($payload['invoice_analysis_log_id'] ?? null) === '') {
            unset($payload['invoice_analysis_log_id']);
        }

        return validator($payload, [
            'supplier_id' => 'nullable|integer|exists:suppliers,id',
            'inventory_import_status_id' => 'nullable|integer|exists:inventory_import_statuses,id',
            'import_date' => 'required|date',
            'notes' => 'nullable|string|max:5000',
            'entry_mode' => 'nullable|string|max:50',
            'extra_charge_percent' => 'nullable|numeric|between:-100000,100000',
            'extra_charge_mode' => ['nullable', 'string', Rule::in(['percent', 'amount', 'mixed'])],
            'extra_charge_value' => 'nullable|numeric|between:-999999999999.99,999999999999.99',
            'extra_charge_amount' => 'nullable|numeric|between:-999999999999.99,999999999999.99',
            'invoice_analysis_log_id' => 'nullable|integer|exists:inventory_invoice_analysis_logs,id',
            'update_supplier_prices' => 'nullable|boolean',
            'status_is_manual' => 'nullable|boolean',
            'attachments' => 'nullable|array',
            'attachments.*.id' => 'nullable|integer',
            'attachments.*.file_path' => 'required|string|max:1000',
            'attachments.*.disk' => 'nullable|string|max:50',
            'attachments.*.original_name' => 'nullable|string|max:255',
            'attachments.*.mime_type' => 'nullable|string|max:150',
            'attachments.*.file_size' => 'nullable|integer|min:0',
            'attachments.*.source_type' => 'nullable|string|max:30',
            'attachments.*.invoice_analysis_log_id' => 'nullable|integer|exists:inventory_invoice_analysis_logs,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.received_quantity' => 'nullable|integer|min:0',
            'items.*.unit_cost' => 'required|numeric|min:0',
            'items.*.supplier_product_code' => 'nullable|string|max:255',
            'items.*.unit_name' => 'nullable|string|max:80',
            'items.*.update_supplier_price' => 'nullable|boolean',
            'items.*.notes' => 'nullable|string|max:1000',
            'items.*.price_notes' => 'nullable|string|max:1000',
        ])->validate();
    }

    private function decodeJsonArrayInput($value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function storeImportAttachmentFiles(Request $request): array
    {
        $files = [];

        foreach (['attachments', 'attachment_files'] as $key) {
            $input = $request->file($key);
            if (!$input) {
                continue;
            }

            $stack = is_array($input) ? $input : [$input];
            array_walk_recursive($stack, function ($file) use (&$files) {
                if ($file instanceof \Illuminate\Http\UploadedFile) {
                    $path = $file->store('uploads/inventory/import-attachments', 'public');
                    $files[] = [
                        'disk' => 'public',
                        'file_path' => $path,
                        'original_name' => $file->getClientOriginalName(),
                        'mime_type' => $file->getMimeType(),
                        'file_size' => $file->getSize(),
                        'source_type' => 'manual',
                    ];
                }
            });
        }

        return $files;
    }

    private function uniqueImportStatusCode(string $name, int $accountId): string
    {
        $base = Str::slug($name, '_');
        $code = $base !== '' ? $base : 'status_' . Str::lower(Str::random(4));
        $suffix = 1;

        while (
            InventoryImportStatus::query()
                ->where(function ($builder) use ($accountId) {
                    $builder
                        ->whereNull('account_id')
                        ->orWhere('account_id', $accountId);
                })
                ->where('code', $code)
                ->exists()
        ) {
            $code = ($base !== '' ? $base : 'status') . '_' . $suffix;
            $suffix++;
        }

        return $code;
    }

    private function inventoryProductPayload(Product $product, ?SupplierProductPrice $supplierPrice = null, $supplierPriceMap = null, bool $compact = false): array
    {
        $currentCost = $product->cost_price !== null ? (float) $product->cost_price : null;
        $expectedCost = $product->expected_cost !== null ? (float) $product->expected_cost : null;
        $costSource = $currentCost !== null ? 'current_cost' : ($expectedCost !== null ? 'expected_cost' : 'empty');
        $parentProduct = $product->relationLoaded('parentConfigurable') ? $product->parentConfigurable->first() : null;
        $variantCount = (int) ($product->variant_count ?? ($product->relationLoaded('variations') ? $product->variations->count() : 0));
        $fallbackSupplierPrice = $supplierPrice;

        if (!$fallbackSupplierPrice && $product->relationLoaded('supplierPrices')) {
            $fallbackSupplierPrice = $product->supplierPrices
                ->first(function ($price) {
                    return filled($price->supplier_product_code) || $price->unit_cost !== null;
                });
        }

        $supplierComparisons = $compact ? [] : $this->productSupplierComparisons($product);
        $supplierPayload = $compact ? [] : $this->productSupplierPayload($product);
        $supplierIds = $compact ? [] : $this->productSupplierIds($product);

        $payload = [
            'id' => $product->id,
            'sku' => $product->sku,
            'supplier_product_code' => $supplierPrice?->supplier_product_code ?? $fallbackSupplierPrice?->supplier_product_code,
            'name' => $product->name,
            'inventory_unit_id' => $product->inventory_unit_id ? (int) $product->inventory_unit_id : null,
            'unit_name' => $product->relationLoaded('unit') ? $product->unit?->name : null,
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
            'suppliers' => $supplierPayload,
            'supplier_ids' => $supplierIds,
            'supplier_count' => max(count($supplierPayload), count($supplierIds), count(array_unique(array_column($supplierComparisons, 'supplier_id')))),
            'has_multiple_suppliers' => max(count($supplierPayload), count($supplierIds), count(array_unique(array_column($supplierComparisons, 'supplier_id')))) > 1,
            'supplier_price_comparisons' => $supplierComparisons,
            'supplier_unit_cost' => $supplierPrice ? (float) $supplierPrice->unit_cost : null,
            'supplier_price_id' => $supplierPrice?->id,
            'supplier_price_updated_at' => $supplierPrice?->updated_at,
            'supplier_notes' => $supplierPrice?->notes,
            'supplier_updater_name' => $supplierPrice?->relationLoaded('updater') ? $supplierPrice->updater?->name : null,
            'deleted_at' => $product->deleted_at,
            'created_at' => $product->created_at,
        ];

        if ($product->relationLoaded('variations')) {
            $payload['variants'] = $product->variations->map(function (Product $variant) use ($supplierPriceMap, $compact) {
                return $this->inventoryProductPayload($variant, $supplierPriceMap?->get($variant->id), null, $compact);
            })->values();
        }

        return $payload;
    }

    private function productPayload(Product $product, ?SupplierProductPrice $supplierPrice = null): array
    {
        $currentCost = $product->cost_price !== null ? (float) $product->cost_price : null;
        $expectedCost = $product->expected_cost !== null ? (float) $product->expected_cost : null;
        $costSource = $currentCost !== null ? 'current_cost' : ($expectedCost !== null ? 'expected_cost' : 'empty');
        $supplierIds = $this->productSupplierIds($product);

        return [
            'id' => $product->id,
            'sku' => $product->sku,
            'supplier_product_code' => $supplierPrice?->supplier_product_code,
            'name' => $product->name,
            'inventory_unit_id' => $product->inventory_unit_id ? (int) $product->inventory_unit_id : null,
            'unit_name' => $product->relationLoaded('unit') ? $product->unit?->name : null,
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
            'supplier_ids' => $supplierIds,
            'supplier_count' => count($supplierIds),
            'has_multiple_suppliers' => count($supplierIds) > 1,
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
