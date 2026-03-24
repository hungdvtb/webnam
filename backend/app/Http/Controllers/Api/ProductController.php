<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryUnit;
use App\Models\Product;
use App\Models\ProductImage;
use App\Models\BulkUpdateLog;
use App\Services\ProductSkuService;
use Illuminate\Http\Request;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

use Illuminate\Database\Eloquent\Builder;

class ProductController extends Controller
{
    public function __construct(protected ProductSkuService $productSkuService)
    {
    }

    protected function supplierExistsRule(Request $request)
    {
        return Rule::exists('suppliers', 'id')->where(function ($query) {
            $query->whereNull('deleted_at');
        });
    }

    protected function productResourceRelations(): array
    {
        return [
            'category:id,name',
            'categories:id,name',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'unit:id,name',
            'siteDomain:id,domain,is_active,is_default',
            'images:id,product_id,image_url,is_primary,file_name,file_size',
            'superAttributes:id,name,code,frontend_type',
            'superAttributes.options:id,attribute_id,value,swatch_value,order',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,frontend_type',
            'linkedProducts' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary',
                        'attributeValues:id,product_id,attribute_id,value',
                        'attributeValues.attribute:id,name,code',
                    ]);
            },
            'groupedItems' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary',
                        'attributeValues:id,product_id,attribute_id,value',
                    ]);
            },
            'bundleItems' => function ($q) {
                $q->select(['products.id', 'products.sku', 'products.name', 'products.price', 'products.expected_cost', 'products.cost_price', 'products.stock_quantity', 'products.type', 'products.weight', 'products.inventory_unit_id'])
                    ->withPivot(['link_type', 'position', 'quantity', 'is_required', 'option_title', 'is_default', 'variant_id', 'price', 'cost_price'])
                    ->with([
                        'unit:id,name',
                        'images:id,product_id,image_url,is_primary',
                        'attributeValues:id,product_id,attribute_id,value',
                    ]);
            },
            'approvedReviews.user:id,name',
        ];
    }

    protected function appendSupplierMeta(Product $product): Product
    {
        if (!$product->relationLoaded('suppliers')) {
            $product->loadMissing('suppliers:id,name,code');
        }

        $supplierIds = $product->suppliers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();

        $product->setAttribute('supplier_ids', $supplierIds);
        $product->setAttribute('supplier_count', count($supplierIds));
        $product->setAttribute('has_multiple_suppliers', count($supplierIds) > 1);

        return $product;
    }

    protected function loadProductResource(Product $product): Product
    {
        return $this->appendSupplierMeta($product->load($this->productResourceRelations()));
    }

    protected function prepareProductSku(array &$validated, ?Product $product = null): void
    {
        $normalizedSku = $this->productSkuService->normalize($validated['sku'] ?? $product?->sku);

        if ($normalizedSku === null) {
            $normalizedSku = $this->productSkuService->ensureUniqueSku(
                null,
                $validated['name'] ?? $product?->name,
                $product?->id
            );
        } elseif ($this->productSkuService->skuExists($normalizedSku, $product?->id)) {
            throw ValidationException::withMessages([
                'sku' => ['Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
            ]);
        }

        $validated['sku'] = $normalizedSku;
    }

    protected function prepareVariantPayloads(array $incomingVariants, string $parentSku, ?Product $product = null): array
    {
        $preparedVariants = [];
        $messages = [];
        $reservedSkus = array_values(array_filter([$parentSku]));
        $ownedVariantIds = $product
            ? array_flip($product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->map(fn ($id) => (int) $id)
                ->all())
            : [];
        $sharedVariantIds = ($product && !empty($ownedVariantIds))
            ? DB::table('product_links')
                ->where('link_type', 'super_link')
                ->whereIn('linked_product_id', array_keys($ownedVariantIds))
                ->where('product_id', '<>', $product->id)
                ->pluck('linked_product_id')
                ->map(fn ($id) => (int) $id)
                ->flip()
                ->all()
            : [];

        foreach ($incomingVariants as $index => $variantData) {
            $variantId = isset($variantData['id']) && is_numeric($variantData['id'])
                ? (int) $variantData['id']
                : null;
            $isExistingVariant = $variantId !== null;

            if ($isExistingVariant && !isset($ownedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này không thuộc sản phẩm hiện tại.';
                continue;
            }

            if ($isExistingVariant && isset($sharedVariantIds[$variantId])) {
                $messages["variants.{$index}.id"][] = 'Biến thể này đang được gán cho sản phẩm cha khác. Vui lòng tạo biến thể riêng cho sản phẩm hiện tại.';
                continue;
            }

            $normalizedSku = $this->productSkuService->normalize($variantData['sku'] ?? null);

            if ($isExistingVariant) {
                if ($normalizedSku === null) {
                    $messages["variants.{$index}.sku"][] = 'Mỗi biến thể phải có mã SKU riêng.';
                } elseif ($normalizedSku === $parentSku) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể không được trùng với mã sản phẩm cha.';
                } elseif (in_array($normalizedSku, $reservedSkus, true)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể đang bị trùng trong danh sách hiện tại.';
                } elseif ($this->productSkuService->skuExists($normalizedSku, $variantId)) {
                    $messages["variants.{$index}.sku"][] = 'Mã biến thể này đã được sử dụng bởi một sản phẩm khác.';
                }
            } else {
                if (
                    $normalizedSku === null
                    || $normalizedSku === $parentSku
                    || in_array($normalizedSku, $reservedSkus, true)
                    || $this->productSkuService->skuExists($normalizedSku)
                ) {
                    $normalizedSku = $this->productSkuService->generateVariantSku($parentSku, null, $reservedSkus);
                }
            }

            if ($normalizedSku !== null) {
                $reservedSkus[] = $normalizedSku;
            }

            $variantData['sku'] = $normalizedSku;
            $preparedVariants[] = $variantData;
        }

        if (!empty($messages)) {
            throw ValidationException::withMessages($messages);
        }

        return $preparedVariants;
    }

    protected function throwSkuConstraintValidation(QueryException $exception, ?string $message = null): never
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $normalizedMessage = Str::lower($exception->getMessage());

        if (in_array($sqlState, ['23000', '23505'], true)) {
            if (Str::contains($normalizedMessage, [
                'product_links_unique_super_link_variant',
                'linked_product_id',
                'super_link',
            ])) {
                throw ValidationException::withMessages([
                    'variants' => ['Mỗi biến thể chỉ được thuộc về một sản phẩm cha. Dữ liệu hiện tại đang bị trùng, vui lòng tải lại và thử lại.'],
                ]);
            }

            if (Str::contains($normalizedMessage, [
                'products_sku_unique',
                'products_sku_key',
                'products.sku',
                ' sku ',
            ])) {
                throw ValidationException::withMessages([
                    'sku' => [$message ?? 'Mã SKU này đã được sử dụng bởi một sản phẩm khác.'],
                ]);
            }
        }

        throw $exception;
    }

    protected function normalizeSupplierIds(Request $request, array $validated = []): array
    {
        $rawSupplierIds = $validated['supplier_ids'] ?? $request->input('supplier_ids', []);
        $legacySupplierId = $validated['supplier_id'] ?? $request->input('supplier_id');

        if (!is_array($rawSupplierIds)) {
            $rawSupplierIds = is_string($rawSupplierIds) ? explode(',', $rawSupplierIds) : [$rawSupplierIds];
        }

        if ($legacySupplierId !== null && $legacySupplierId !== '' && !in_array($legacySupplierId, $rawSupplierIds, true)) {
            $rawSupplierIds[] = $legacySupplierId;
        }

        return collect($rawSupplierIds)
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function syncProductSuppliers(Product $product, array $supplierIds): array
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        $syncData = [];
        foreach ($supplierIds as $supplierId) {
            $syncData[$supplierId] = ['account_id' => $product->account_id];
        }

        $product->suppliers()->sync($syncData);
        $product->forceFill([
            'supplier_id' => $supplierIds[0] ?? null,
        ])->save();

        return $supplierIds;
    }

    protected function syncSuppliersToVariants(Product $product, array $supplierIds): void
    {
        $variantIds = $product->linkedProducts()
            ->wherePivot('link_type', 'super_link')
            ->pluck('products.id');

        if ($variantIds->isEmpty()) {
            return;
        }

        Product::query()
            ->whereIn('id', $variantIds)
            ->get()
            ->each(function (Product $variant) use ($supplierIds) {
                $this->syncProductSuppliers($variant, $supplierIds);
            });
    }

    protected function applySupplierFilter(Builder $query, array $supplierIds, bool $includeUnassigned = false): void
    {
        $supplierIds = collect($supplierIds)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (empty($supplierIds) && !$includeUnassigned) {
            return;
        }

        $query->where(function (Builder $builder) use ($supplierIds, $includeUnassigned) {
            if (!empty($supplierIds)) {
                $builder
                    ->whereHas('suppliers', function (Builder $supplierQuery) use ($supplierIds) {
                        $supplierQuery->whereIn('suppliers.id', $supplierIds);
                    })
                    ->orWhereIn('supplier_id', $supplierIds)
                    ->orWhereHas('supplierPrices', function (Builder $priceQuery) use ($supplierIds) {
                        $priceQuery->whereIn('supplier_id', $supplierIds);
                    });
            }

            if ($includeUnassigned) {
                if (!empty($supplierIds)) {
                    $builder->orWhere(function (Builder $unassignedQuery) {
                        $unassignedQuery
                            ->doesntHave('suppliers')
                            ->whereNull('supplier_id')
                            ->whereDoesntHave('supplierPrices');
                    });
                } else {
                    $builder
                        ->doesntHave('suppliers')
                        ->whereNull('supplier_id')
                        ->whereDoesntHave('supplierPrices');
                }
            }
        });
    }

    protected function usesPostgresSearchDriver(): bool
    {
        return DB::connection()->getDriverName() === 'pgsql';
    }

    protected function loweredSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(immutable_unaccent({$column}))";
        }

        return "LOWER({$column})";
    }

    protected function compactSearchExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]', '', 'g'))";
        }

        $expression = $column;
        foreach (['-', '_', ' ', '/', '.', '#'] as $character) {
            $expression = "REPLACE({$expression}, '{$character}', '')";
        }

        return "LOWER({$expression})";
    }

    protected function normalizedWordsExpression(string $column): string
    {
        $column = "COALESCE({$column}, '')";

        if ($this->usesPostgresSearchDriver()) {
            return "LOWER(REGEXP_REPLACE(immutable_unaccent({$column}), '[^a-zA-Z0-9]+', ' ', 'g'))";
        }

        return "LOWER({$column})";
    }

    protected function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    protected function normalizeCodeSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/\s+/', ' ')
            ->trim();
    }

    protected function normalizeNameSearchText(string $value): string
    {
        return (string) Str::of($value)
            ->lower()
            ->ascii()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish();
    }

    protected function compactSearchText(string $value): string
    {
        return preg_replace('/[^a-z0-9]+/', '', $this->normalizeNameSearchText($value)) ?? '';
    }

    protected function looksLikeProductCodeSearch(string $rawSearch): bool
    {
        $trimmed = trim($rawSearch);
        if ($trimmed === '') {
            return false;
        }

        $compactSearch = $this->compactSearchText($trimmed);
        if ($compactSearch === '') {
            return false;
        }

        $hasDigit = preg_match('/\d/u', $trimmed) === 1;
        $hasSeparator = preg_match('/[-_.\/\\\\]/u', $trimmed) === 1;
        $hasWhitespace = preg_match('/\s/u', $trimmed) === 1;
        $allowedCharactersOnly = preg_match('/^[\pL\pN\s\-_.\/\\\\]+$/u', $trimmed) === 1;

        if (!$allowedCharactersOnly) {
            return false;
        }

        if (!$hasWhitespace && ($hasDigit || $hasSeparator)) {
            return true;
        }

        return ctype_digit($compactSearch) && strlen($compactSearch) >= 3;
    }

    protected function applyProductSearch(Builder $query, string $rawSearch): array
    {
        $trimmedSearch = trim($rawSearch);
        if ($trimmedSearch === '') {
            return [null, []];
        }

        if ($this->looksLikeProductCodeSearch($trimmedSearch)) {
            return $this->applyProductCodeSearch($query, $trimmedSearch);
        }

        return $this->applyProductNameSearch($query, $trimmedSearch);
    }

    protected function applyProductCodeSearch(Builder $query, string $rawSearch): array
    {
        $normalizedCode = $this->normalizeCodeSearchText($rawSearch);
        $compactCode = $this->compactSearchText($rawSearch);

        if ($normalizedCode === '' && $compactCode === '') {
            return [null, []];
        }

        $skuExpr = $this->loweredSearchExpression('products.sku');
        $compactSkuExpr = $this->compactSearchExpression('products.sku');
        $exactCodeSearch = function (Builder $searchQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode) {
            $searchQuery
                ->where(function (Builder $directQuery) use ($skuExpr, $compactSkuExpr, $normalizedCode, $compactCode) {
                    $directQuery->whereRaw("{$skuExpr} = ?", [$normalizedCode]);

                    if ($compactCode !== '') {
                        $directQuery->orWhereRaw("{$compactSkuExpr} = ?", [$compactCode]);
                    }
                })
                ->orWhereHas('variations', function (Builder $variationQuery) use ($normalizedCode, $compactCode) {
                    $variationSkuExpr = $this->loweredSearchExpression('products.sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('products.sku');

                    $variationQuery->where(function (Builder $directVariationQuery) use ($variationSkuExpr, $variationCompactSkuExpr, $normalizedCode, $compactCode) {
                        $directVariationQuery->whereRaw("{$variationSkuExpr} = ?", [$normalizedCode]);

                        if ($compactCode !== '') {
                            $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} = ?", [$compactCode]);
                        }
                    });
                });
        };

        $hasExactCodeMatch = (clone $query)->where($exactCodeSearch)->exists();

        if ($hasExactCodeMatch) {
            $searchRankingParts = [
                "CASE WHEN {$skuExpr} = ? THEN 5000 ELSE 0 END",
            ];
            $searchRankingBindings = [$normalizedCode];

            if ($compactCode !== '') {
                $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} = ? THEN 4900 ELSE 0 END";
                $searchRankingBindings[] = $compactCode;
            }

            $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
            $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
            $query->where($exactCodeSearch);

            return [$searchRankingSql, $searchRankingBindings];
        }

        $codePrefixLike = $this->escapeLike($normalizedCode) . '%';
        $codeContainsLike = '%' . $this->escapeLike($normalizedCode) . '%';
        $compactCodePrefixLike = $compactCode !== '' ? $this->escapeLike($compactCode) . '%' : null;
        $compactCodeContainsLike = $compactCode !== '' ? '%' . $this->escapeLike($compactCode) . '%' : null;

        $searchRankingParts = [
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 2400 ELSE 0 END",
            "CASE WHEN {$skuExpr} LIKE ? ESCAPE '\\' THEN 1800 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $codePrefixLike,
            $codeContainsLike,
        ];

        if ($compactCodePrefixLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 2300 ELSE 0 END";
            $searchRankingBindings[] = $compactCodePrefixLike;
        }

        if ($compactCodeContainsLike !== null) {
            $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END";
            $searchRankingBindings[] = $compactCodeContainsLike;
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use ($skuExpr, $compactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
            $searchQuery
                ->where(function (Builder $directQuery) use ($skuExpr, $compactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
                    $directQuery->whereRaw("{$skuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                    if ($compactCodeContainsLike !== null) {
                        $directQuery->orWhereRaw("{$compactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                    }
                })
                ->orWhereHas('variations', function (Builder $variationQuery) use ($codeContainsLike, $compactCodeContainsLike) {
                    $variationSkuExpr = $this->loweredSearchExpression('products.sku');
                    $variationCompactSkuExpr = $this->compactSearchExpression('products.sku');

                    $variationQuery->where(function (Builder $directVariationQuery) use ($variationSkuExpr, $variationCompactSkuExpr, $codeContainsLike, $compactCodeContainsLike) {
                        $directVariationQuery->whereRaw("{$variationSkuExpr} LIKE ? ESCAPE '\\'", [$codeContainsLike]);

                        if ($compactCodeContainsLike !== null) {
                            $directVariationQuery->orWhereRaw("{$variationCompactSkuExpr} LIKE ? ESCAPE '\\'", [$compactCodeContainsLike]);
                        }
                    });
                });
        });

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function applyProductNamePhraseConstraint(Builder $query, string $nameContainsLike): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');

        $query
            ->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike])
            ->orWhereHas('variations', function (Builder $variationQuery) use ($nameContainsLike) {
                $variationNameExpr = $this->normalizedWordsExpression('products.name');
                $variationQuery->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$nameContainsLike]);
            });
    }

    protected function applyProductNameTokenConstraint(Builder $query, array $tokenLikes): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $tokenLikes) {
                foreach ($tokenLikes as $tokenLike) {
                    $directQuery->whereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                }
            })
            ->orWhereHas('variations', function (Builder $variationQuery) use ($tokenLikes) {
                $variationNameExpr = $this->normalizedWordsExpression('products.name');

                foreach ($tokenLikes as $tokenLike) {
                    $variationQuery->whereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$tokenLike]);
                }
            });
    }

    protected function applyProductNameAdjacentPhraseConstraint(Builder $query, array $adjacentPhraseLikes): void
    {
        $nameExpr = $this->normalizedWordsExpression('products.name');

        $query
            ->where(function (Builder $directQuery) use ($nameExpr, $adjacentPhraseLikes) {
                foreach ($adjacentPhraseLikes as $phraseLike) {
                    $directQuery->orWhereRaw("{$nameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                }
            })
            ->orWhereHas('variations', function (Builder $variationQuery) use ($adjacentPhraseLikes) {
                $variationNameExpr = $this->normalizedWordsExpression('products.name');

                $variationQuery->where(function (Builder $directVariationQuery) use ($variationNameExpr, $adjacentPhraseLikes) {
                    foreach ($adjacentPhraseLikes as $phraseLike) {
                        $directVariationQuery->orWhereRaw("{$variationNameExpr} LIKE ? ESCAPE '\\'", [$phraseLike]);
                    }
                });
            });
    }

    protected function applyProductNameSearch(Builder $query, string $rawSearch): array
    {
        $normalizedName = $this->normalizeNameSearchText($rawSearch);
        if ($normalizedName === '') {
            return [null, []];
        }

        $nameExpr = $this->normalizedWordsExpression('products.name');
        $nameExact = $normalizedName;
        $namePrefixLike = $this->escapeLike($normalizedName) . '%';
        $nameContainsLike = '%' . $this->escapeLike($normalizedName) . '%';
        $nameTokens = collect(preg_split('/\s+/', $normalizedName, -1, PREG_SPLIT_NO_EMPTY))
            ->filter(fn ($token) => mb_strlen($token) >= 2)
            ->unique()
            ->take(12)
            ->values()
            ->all();
        $tokenLikes = array_map(
            fn ($token) => '%' . $this->escapeLike($token) . '%',
            $nameTokens
        );
        $adjacentPhraseLikes = collect($nameTokens)
            ->sliding(2)
            ->map(function ($tokens) {
                $phrase = collect($tokens)->implode(' ');

                return '%' . $this->escapeLike($phrase) . '%';
            })
            ->unique()
            ->values()
            ->all();

        $phraseRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 2600 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 2100 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1700 ELSE 0 END",
        ];
        $phraseRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];
        $phraseRankingSql = '(' . implode(' + ', $phraseRankingParts) . ')';

        $hasPhraseMatch = (clone $query)
            ->where(function (Builder $searchQuery) use ($nameContainsLike) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike);
            })
            ->exists();

        if ($hasPhraseMatch || empty($tokenLikes)) {
            $query->selectRaw("{$phraseRankingSql} AS search_score", $phraseRankingBindings);
            $query->where(function (Builder $searchQuery) use ($nameContainsLike) {
                $this->applyProductNamePhraseConstraint($searchQuery, $nameContainsLike);
            });

            return [$phraseRankingSql, $phraseRankingBindings];
        }

        $hasAdjacentPhraseMatch = !empty($adjacentPhraseLikes)
            && (clone $query)
                ->where(function (Builder $searchQuery) use ($adjacentPhraseLikes) {
                    $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes);
                })
                ->exists();

        $searchRankingParts = [
            "CASE WHEN {$nameExpr} = ? THEN 1800 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1500 ELSE 0 END",
            "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 1200 ELSE 0 END",
        ];
        $searchRankingBindings = [
            $nameExact,
            $namePrefixLike,
            $nameContainsLike,
        ];

        foreach ($tokenLikes as $tokenLike) {
            $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 120 ELSE 0 END";
            $searchRankingBindings[] = $tokenLike;
        }

        if ($hasAdjacentPhraseMatch) {
            foreach ($adjacentPhraseLikes as $phraseLike) {
                $searchRankingParts[] = "CASE WHEN {$nameExpr} LIKE ? ESCAPE '\\' THEN 260 ELSE 0 END";
                $searchRankingBindings[] = $phraseLike;
            }
        }

        $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
        $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
        $query->where(function (Builder $searchQuery) use ($tokenLikes) {
            $this->applyProductNameTokenConstraint($searchQuery, $tokenLikes);
        });

        if ($hasAdjacentPhraseMatch) {
            $query->where(function (Builder $searchQuery) use ($adjacentPhraseLikes) {
                $this->applyProductNameAdjacentPhraseConstraint($searchQuery, $adjacentPhraseLikes);
            });
        }

        return [$searchRankingSql, $searchRankingBindings];
    }

    protected function applyAttributeValueConstraint(Builder $query, int $attributeId, array $valueArray): void
    {
        $query
            ->where('attribute_id', $attributeId)
            ->where(function (Builder $valueQuery) use ($valueArray) {
                foreach ($valueArray as $value) {
                    $escapedValue = $this->escapeLike($value);

                    $valueQuery
                        ->orWhere('value', $value)
                        ->orWhereRaw("value LIKE ? ESCAPE '\\'", ['%"' . $escapedValue . '"%']);
                }
            });
    }

    protected function applyProductAttributeFilters(Builder $query, $inputAttributes): void
    {
        if (!is_array($inputAttributes) || empty($inputAttributes)) {
            return;
        }

        foreach ($inputAttributes as $attrId => $values) {
            if (!is_numeric($attrId)) {
                continue;
            }

            $valueArray = collect(is_array($values) ? $values : explode(',', (string) $values))
                ->map(function ($value) {
                    if (!is_scalar($value)) {
                        return null;
                    }

                    return trim((string) $value);
                })
                ->filter(fn ($value) => $value !== null && $value !== '')
                ->unique()
                ->values()
                ->all();

            if (empty($valueArray)) {
                continue;
            }

            $attributeId = (int) $attrId;

            $query->where(function (Builder $attributeQuery) use ($attributeId, $valueArray) {
                $attributeQuery
                    ->whereHas('attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                        $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                    })
                    ->orWhereHas('variations.attributeValues', function (Builder $attributeValueQuery) use ($attributeId, $valueArray) {
                        $this->applyAttributeValueConstraint($attributeValueQuery, $attributeId, $valueArray);
                    });
            });
        }
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        // Start with optimized column selection for products list to reduce memory & payload
        $query = Product::query()
            ->select([
            'id', 'sku', 'name', 'price', 'expected_cost', 'cost_price', 'stock_quantity',
            'supplier_id', 'inventory_unit_id',
            'type', 'category_id', 'is_featured', 'is_new', 'created_at', 'status', 'specifications', 'video_url', 'bundle_title'
        ])
            ->withCount('suppliers')
            ->with([
            'categories:id,name',
            'category:id,name',
            'supplier:id,name,code',
            'suppliers:id,name,code',
            'unit:id,name',
            'siteDomain:id,domain',
            'images:id,product_id,image_url,is_primary',
            'attributeValues:id,product_id,attribute_id,value',
            'attributeValues.attribute:id,name,code,is_filterable,is_filterable_backend',
            'variations:id,sku,name,price,expected_cost,cost_price,stock_quantity,type,inventory_unit_id',
            'variations.attributeValues:id,product_id,attribute_id,value',
            'variations.unit:id,name',
            'variations.images:id,product_id,image_url,is_primary',
            'groupedItems:id,sku,name,price,expected_cost,cost_price,stock_quantity,type,inventory_unit_id',
            'groupedItems.unit:id,name',
            'groupedItems.images:id,product_id,image_url,is_primary'
        ]);

        // Handle Trash View
        if ($request->boolean('is_trash')) {
            $query->onlyTrashed();
        }

        // Filter by category
        if ($request->filled('category_id')) {
            if ($request->category_id === 'uncategorized') {
                $query->whereNull('category_id')->doesntHave('categories');
            }
            else {
                $query->where(function ($q) use ($request) {
                    $q->where('category_id', $request->category_id)
                        ->orWhereHas('categories', function ($sub) use ($request) {
                        $sub->where('categories.id', $request->category_id);
                    }
                    );
                });
            }
        }

        if ($request->filled('category_ids')) {
            $catIds = is_array($request->category_ids) ? $request->category_ids : explode(',', $request->category_ids);
            $query->where(function ($q) use ($catIds) {
                $q->whereIn('category_id', $catIds)
                    ->orWhereHas('categories', function ($sub) use ($catIds) {
                    $sub->whereIn('categories.id', $catIds);
                }
                );
            });
        }

        $rawSupplierIds = $request->input('supplier_ids', $request->input('supplier_id'));
        $includeUnassignedSuppliers = false;
        $supplierIds = [];
        if ($rawSupplierIds !== null && $rawSupplierIds !== '') {
            $normalizedSupplierFilter = is_array($rawSupplierIds) ? $rawSupplierIds : explode(',', (string) $rawSupplierIds);
            $includeUnassignedSuppliers = in_array('unassigned', $normalizedSupplierFilter, true);
            $supplierIds = collect($normalizedSupplierFilter)
                ->reject(fn ($value) => $value === 'unassigned')
                ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
                ->filter()
                ->unique()
                ->values()
                ->all();
            $this->applySupplierFilter($query, $supplierIds, $includeUnassignedSuppliers);
        }

        if ($request->boolean('missing_purchase_price')) {
            $query->whereDoesntHave('supplierPrices', function (Builder $priceQuery) {
                $priceQuery
                    ->whereNotNull('unit_cost')
                    ->where('unit_cost', '>', 0);
            });
        }

        if ($request->boolean('multiple_suppliers')) {
            $query->where(function (Builder $builder) {
                $builder
                    ->has('suppliers', '>', 1)
                    ->orWhereIn('id', function ($subQuery) {
                        $subQuery
                            ->from('supplier_product_prices')
                            ->select('product_id')
                            ->groupBy('product_id')
                            ->havingRaw('COUNT(DISTINCT supplier_id) > 1');
                    });
            });
        }

        $searchRankingSql = null;
        $searchRankingBindings = [];

        // Search by name & SKU & more (Advanced Fuzzy & Token Matching)
        if (false && $request->filled('search')) {
            $search = trim($request->search);
            // Split into tokens
            $tokens = preg_split('/\s+/', $search, -1, PREG_SPLIT_NO_EMPTY);

            if (!empty($tokens)) {
                $query->where(function (Builder $q) use ($tokens) {
                    foreach ($tokens as $token) {
                        $q->where(function (Builder $sub) use ($token) {
                                    $escapedToken = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $token) . '%';
                                    $fuzzyToken = '%' . implode('%', preg_split('//u', str_replace(['%', '_'], '', $token), -1, PREG_SPLIT_NO_EMPTY)) . '%';

                                    // Name match
                                    $sub->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        // SKU match (substring or compacted substring)
                                        ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken])
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$escapedToken])
                                        // SKU fuzzy/subsequence match
                                        ->orWhereRaw("immutable_unaccent(REGEXP_REPLACE(sku, '[^a-zA-Z0-9]', '', 'g')) ILIKE immutable_unaccent(?)", [$fuzzyToken])

                                        // Nếu là sản phẩm cha, hãy kiểm tra xem có biến thể nào khớp không
                                        ->orWhereHas('variations', function (Builder $sq) use ($escapedToken) {
                                $sq->whereRaw('immutable_unaccent(name) ILIKE immutable_unaccent(?)', [$escapedToken])
                                    ->orWhereRaw('immutable_unaccent(sku) ILIKE immutable_unaccent(?)', [$escapedToken]);
                            }
                            );

                        }
                        );
                    }
                });
            }
        }

        if (false && $request->filled('search')) {
            $rawSearch = trim($request->search);
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

            if ($rawSearch !== '' || !empty($strictTokens)) {
                $escapeLike = static fn ($value) => str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
                $nameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                $skuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
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
                    $strictTokenMatchParts[] = "CASE WHEN ({$nameExpr} ILIKE immutable_unaccent(?) OR {$skuExpr} ILIKE immutable_unaccent(?) OR {$compactSkuExpr} ILIKE immutable_unaccent(?)) THEN 1 ELSE 0 END";
                    array_push($strictTokenMatchBindings, $tokenLike, $tokenLike, $compactTokenLike);
                }

                $strictTokenMatchSql = !empty($strictTokenMatchParts) ? '(' . implode(' + ', $strictTokenMatchParts) . ')' : '0';
                $minimumRelevantMatches = count($strictTokens) <= 1 ? 1 : max(2, count($strictTokens) - 1);

                $searchRankingParts = [
                    "CASE WHEN {$skuExpr} = immutable_unaccent(?) THEN 1500 ELSE 0 END",
                    "CASE WHEN {$nameExpr} = immutable_unaccent(?) THEN 1400 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 950 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END",
                    "CASE WHEN {$skuExpr} ILIKE immutable_unaccent(?) THEN 820 ELSE 0 END",
                    "CASE WHEN {$nameExpr} ILIKE immutable_unaccent(?) THEN 780 ELSE 0 END",
                ];
                $searchRankingBindings = [
                    $rawSearch,
                    $rawSearch,
                    $prefixLike,
                    $prefixLike,
                    $phraseLike,
                    $phraseLike,
                ];

                if ($compactPhraseLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 900 ELSE 0 END";
                    $searchRankingBindings[] = $compactPhraseLike;
                }

                if ($compactPrefixLike !== null) {
                    $searchRankingParts[] = "CASE WHEN {$compactSkuExpr} ILIKE immutable_unaccent(?) THEN 880 ELSE 0 END";
                    $searchRankingBindings[] = $compactPrefixLike;
                }

                if (!empty($strictTokenMatchParts)) {
                    $searchRankingParts[] = "({$strictTokenMatchSql} * 140)";
                    $searchRankingBindings = array_merge($searchRankingBindings, $strictTokenMatchBindings);
                }

                $searchRankingSql = '(' . implode(' + ', $searchRankingParts) . ')';
                $query->selectRaw("{$searchRankingSql} AS search_score", $searchRankingBindings);
                $query->where(function (Builder $strictSearchQuery) use (
                    $nameExpr,
                    $skuExpr,
                    $compactSkuExpr,
                    $phraseLike,
                    $compactPhraseLike,
                    $strictTokenMatchSql,
                    $strictTokenMatchBindings,
                    $minimumRelevantMatches
                ) {
                    $strictSearchQuery
                        ->whereRaw("{$nameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                        ->orWhereRaw("{$skuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                    if ($compactPhraseLike !== null) {
                        $strictSearchQuery
                            ->orWhereRaw("{$compactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                    }

                    if ($strictTokenMatchSql !== '0') {
                        $strictSearchQuery->orWhereRaw("{$strictTokenMatchSql} >= ?", array_merge($strictTokenMatchBindings, [$minimumRelevantMatches]));
                    }

                    $strictSearchQuery->orWhereHas('variations', function (Builder $variationQuery) use ($phraseLike, $compactPhraseLike) {
                        $variationNameExpr = "immutable_unaccent(COALESCE(products.name, ''))";
                        $variationSkuExpr = "immutable_unaccent(COALESCE(products.sku, ''))";
                        $variationCompactSkuExpr = "immutable_unaccent(REGEXP_REPLACE(COALESCE(products.sku, ''), '[^a-zA-Z0-9]', '', 'g'))";

                        $variationQuery
                            ->whereRaw("{$variationNameExpr} ILIKE immutable_unaccent(?)", [$phraseLike])
                            ->orWhereRaw("{$variationSkuExpr} ILIKE immutable_unaccent(?)", [$phraseLike]);

                        if ($compactPhraseLike !== null) {
                            $variationQuery
                                ->orWhereRaw("{$variationCompactSkuExpr} ILIKE immutable_unaccent(?)", [$compactPhraseLike]);
                        }
                    });
                });
            }
        }

        // Numberic Filters
        if ($request->filled('min_price'))
            $query->where('price', '>=', $request->min_price);
        if ($request->filled('max_price'))
            $query->where('price', '<=', $request->max_price);
        if ($request->filled('min_stock'))
            $query->where('stock_quantity', '>=', $request->min_stock);
        if ($request->filled('max_stock'))
            $query->where('stock_quantity', '<=', $request->max_stock);

        // Filter by date range
        if ($request->filled('start_date'))
            $query->whereDate('created_at', '>=', $request->start_date);
        if ($request->filled('end_date'))
            $query->whereDate('created_at', '<=', $request->end_date);

        // Flags
        if ($request->filled('is_featured'))
            $query->where('is_featured', $request->boolean('is_featured'));
        if ($request->filled('is_new'))
            $query->where('is_new', $request->boolean('is_new'));
        // Type Filtering (Improved for Multiple Types & Variants logic)
        if ($request->filled('type')) {
            $types = is_array($request->type) ? $request->type : explode(',', $request->type);
            $query->where(function ($q) use ($types) {
                foreach ($types as $type) {
                    $q->orWhere(function ($sub) use ($type) {
                        if ($type === 'configurable') {
                            // Trả về sản phẩm cha thực sự có biến thể
                            $sub->where('type', 'configurable')
                                ->whereHas('variations');
                        } elseif ($type === 'simple') {
                            // Trả về sản phẩm đơn độc lập (không phải là biến thể của sản phẩm khác)
                            $sub->where('type', 'simple')
                                ->whereDoesntHave('parentConfigurable');
                        } else {
                            $sub->where('type', $type);
                        }
                    });
                }
            });
        }

        // Filter by EAV Attributes
        $this->applyProductAttributeFilters($query, $request->input('attributes'));
        // Mặc định luôn ẩn sản phẩm con (biến thể) ở danh sách chính
        // Sản phẩm con chỉ hiển thị khi bấm mở rộng sản phẩm cha ở frontend
        if ($request->filled('search')) {
            [$searchRankingSql, $searchRankingBindings] = $this->applyProductSearch(
                $query,
                (string) $request->input('search')
            );
        }

        if (!$request->filled('type')) {
            $query->whereDoesntHave('parentConfigurable');
        }

        // Sorting
        $sortBy = $request->input('sort_by', 'created_at');
        $sortOrder = $request->input('sort_order', 'desc');

        if ($sortBy === 'random') {
            $query->inRandomOrder();
        } else {
            $sortMapping = ['stock' => 'stock_quantity', 'category' => 'category_id'];
            $validSortFields = ['id', 'sku', 'name', 'price', 'expected_cost', 'cost_price', 'stock_quantity', 'created_at', 'type', 'category_id'];

            $field = $sortMapping[$sortBy] ?? $sortBy;
            if (!in_array($field, $validSortFields))
                $field = 'created_at';

            $order = (strtolower($sortOrder) === 'asc') ? 'asc' : 'desc';

            // Ưu tiên đưa sản phẩm có biến thể lên đầu nếu cùng tiêu chí sắp xếp (giúp dễ quản lý)
            if ($searchRankingSql !== null) {
                $query->orderByRaw("{$searchRankingSql} DESC", $searchRankingBindings)
                    ->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                    ->orderBy('name', 'asc');
            } else {
                $query->orderByRaw("CASE WHEN type = 'configurable' THEN 0 ELSE 1 END")
                    ->orderBy($field, $order);
            }
        }

        $perPage = (int)$request->get('per_page', 20);
        // Ensure perPage is reasonable
        $perPage = min(max($perPage, 1), 100);

        $paginated = $query->paginate($perPage);
        $paginated->setCollection(
            $paginated->getCollection()->map(function (Product $product) {
                return $this->appendSupplierMeta($product);
            })
        );

        return response()->json($paginated);
    }


    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'type' => 'required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'integer|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'status' => 'nullable|boolean',
            'video_url' => 'nullable|string',
            'slug' => 'nullable|string|max:255|unique:products,slug',
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            'custom_attributes' => 'nullable|array',
            'main_image' => 'nullable|image',
            'images' => 'nullable|array',
            'images.*' => 'image',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|integer|min:0',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'type.required' => 'Vui lòng chọn loại sản phẩm.',
            'name.required' => 'Vui lòng nhập tên tác phẩm nghệ thuật.',
            'price.required' => 'Vui lòng nhập giá bán.',
            'stock_quantity.integer' => 'Số lượng tồn kho phải là số nguyên.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
        ]);

        $validated['slug'] = $this->productSkuService->generateUniqueSlug(
            !empty($validated['slug']) ? $validated['slug'] : $validated['name']
        );

        $supplierIds = $this->normalizeSupplierIds($request, $validated);
        $validated['supplier_id'] = $supplierIds[0] ?? null;
        unset($validated['supplier_ids']);

        try {
            $product = DB::transaction(function () use ($request, $validated, $supplierIds) {
                $this->prepareProductSku($validated);
                $preparedVariants = $validated['type'] === 'configurable'
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'])
                    : [];

                $product = Product::create(array_merge($validated, ['account_id' => $request->header('X-Account-Id')]));
                $this->syncProductSuppliers($product, $supplierIds);

                if ($request->has('category_ids')) {
                    $product->categories()->sync($request->category_ids);
                } elseif ($request->has('category_id') && !empty($request->category_id)) {
                    $product->categories()->sync([$request->category_id]);
                }

                if ($request->hasFile('main_image')) {
                    $disk = 's3';
                    $imageFile = $request->file('main_image');
                    $path = Storage::disk($disk)->put('products', $imageFile, 'public');
                    $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                    $url = $baseUrl . '/' . ltrim($path, '/');

                    ProductImage::create([
                        'product_id' => $product->id,
                        'image_url' => $url,
                        'file_name' => $imageFile->getClientOriginalName(),
                        'file_size' => $imageFile->getSize(),
                        'is_primary' => true,
                    ]);
                }

                if ($request->hasFile('images')) {
                    $disk = 's3';
                    foreach ($request->file('images') as $idx => $image) {
                        $path = Storage::disk($disk)->put('products', $image, 'public');
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');
                        $isPrimary = (!$request->hasFile('main_image')) && ($idx === 0);

                        ProductImage::create([
                            'product_id' => $product->id,
                            'image_url' => $url,
                            'file_name' => $image->getClientOriginalName(),
                            'file_size' => $image->getSize(),
                            'is_primary' => $isPrimary,
                            'sort_order' => $idx,
                        ]);
                    }
                }

                if ($request->has('custom_attributes')) {
                    $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
                    foreach ($request->custom_attributes as $attrId => $val) {
                        if (!in_array($attrId, $validAttrIds)) {
                            continue;
                        }

                        $rawValue = is_array($val) ? json_encode($val) : $val;
                        \App\Models\ProductAttributeValue::create([
                            'product_id' => $product->id,
                            'attribute_id' => $attrId,
                            'value' => $rawValue,
                        ]);
                    }
                }

                if ($request->has('linked_product_ids')) {
                    $type = $request->get('link_type', 'related');
                    $links = [];
                    foreach ($request->linked_product_ids as $idx => $idOrObj) {
                        if (is_array($idOrObj)) {
                            if (!empty($idOrObj['id'])) {
                                $links[$idOrObj['id']] = [
                                    'link_type' => $type,
                                    'position' => $idx,
                                    'option_title' => $idOrObj['option_title'] ?? null,
                                ];
                            }
                        } elseif (!empty($idOrObj)) {
                            $links[$idOrObj] = ['link_type' => $type, 'position' => $idx];
                        }
                    }

                    if (!empty($links)) {
                        $product->linkedProducts()->syncWithoutDetaching($links);
                    }
                }

                if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'], true)) {
                    $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';

                    if ($product->type === 'bundle') {
                        $product->bundleItems()->detach();
                    } else {
                        $product->groupedItems()->detach();
                    }

                    foreach ($request->grouped_items as $idx => $item) {
                        $pivotData = [
                            'quantity' => $item['quantity'],
                            'is_required' => $item['is_required'],
                            'link_type' => $linkType,
                            'position' => $idx,
                            'option_title' => $item['option_title'] ?? null,
                            'is_default' => $item['is_default'] ?? false,
                            'variant_id' => $item['variant_id'] ?? null,
                            'price' => $item['price'] ?? null,
                            'cost_price' => $item['cost_price'] ?? null,
                        ];

                        if ($product->type === 'bundle') {
                            $product->bundleItems()->attach($item['id'], $pivotData);
                        } else {
                            $product->groupedItems()->attach($item['id'], $pivotData);
                        }
                    }
                }

                if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
                    $attrs = [];
                    foreach ($request->super_attribute_ids as $idx => $id) {
                        $attrs[$id] = ['position' => $idx];
                    }
                    $product->superAttributes()->sync($attrs);
                }

                if (!empty($preparedVariants) && $product->type === 'configurable') {
                    foreach ($preparedVariants as $idx => $vData) {
                        $variantProduct = Product::create([
                            'account_id' => $product->account_id,
                            'type' => 'simple',
                            'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                            'sku' => $vData['sku'],
                            'price' => $vData['price'] ?? $product->price,
                            'expected_cost' => $vData['expected_cost'] ?? null,
                            'weight' => $vData['weight'] ?? null,
                            'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                            'supplier_id' => $supplierIds[0] ?? $product->supplier_id,
                            'stock_quantity' => $vData['stock_quantity'] ?? 0,
                            'category_id' => $product->category_id,
                            'status' => $product->status ?? true,
                        ]);
                        $this->syncProductSuppliers($variantProduct, $supplierIds);

                        if ($request->hasFile("variants.{$idx}.image")) {
                            $imageFile = $request->file("variants.{$idx}.image");
                            $path = $imageFile->store('products', 'public');
                            \App\Models\ProductImage::create([
                                'product_id' => $variantProduct->id,
                                'image_url' => \Illuminate\Support\Facades\Storage::disk('public')->url($path),
                                'is_primary' => true,
                                'file_name' => $imageFile->getClientOriginalName(),
                                'file_size' => $imageFile->getSize(),
                            ]);
                        }

                        $product->linkedProducts()->attach($variantProduct->id, [
                            'link_type' => 'super_link',
                            'position' => $idx,
                        ]);

                        if (isset($vData['attributes'])) {
                            $validVariantAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                            foreach ($vData['attributes'] as $attrId => $val) {
                                if (!in_array($attrId, $validVariantAttrIds)) {
                                    continue;
                                }

                                \App\Models\ProductAttributeValue::create([
                                    'product_id' => $variantProduct->id,
                                    'attribute_id' => $attrId,
                                    'value' => $val,
                                ]);
                            }
                        }
                    }
                }

                $this->syncSuppliersToVariants($product, $supplierIds);

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình lưu. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        return response()->json($this->loadProductResource($product), 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $product = Product::with($this->productResourceRelations())->findOrFail($id);

        if ($product->type === 'configurable') {
            // Get variations manually to find all used attribute values from IN-STOCK variations
            $variations = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->where('stock_quantity', '>', 0) // Only count in-stock variations for initial attribute listing
                ->with('attributeValues')
                ->get();
            
            $usedValuesByAttr = [];
            foreach ($variations as $v) {
                foreach ($v->attributeValues as $av) {
                    $usedValuesByAttr[$av->attribute_id][] = $av->value;
                }
            }

            // Filter the eager-loaded superAttributes to only include those that have valid in-stock options
            $filteredSuperAttributes = $product->superAttributes->filter(function($attribute) use ($usedValuesByAttr) {
                $relevantValues = array_unique($usedValuesByAttr[$attribute->id] ?? []);
                if (empty($relevantValues)) return false;

                $filteredOptions = $attribute->options->filter(function($opt) use ($relevantValues) {
                    return in_array($opt->value, $relevantValues);
                })->values();

                $attribute->setRelation('options', $filteredOptions);
                return $filteredOptions->count() > 0;
            })->values();

            $product->setRelation('superAttributes', $filteredSuperAttributes);

            // Also expose ALL variations (including out of stock ones if needed, 
            // but for filtering we might want to know about them, or just keep what's returned by linkedProducts)
            // Re-fetch all variations to ensure we have the full list for frontend logic if it needs to show "out of stock" instead of hiding
            // But user said "không có hàng... phải ẩn hẳn", so let's stick to in-stock variations for selection logic.
            $product->setRelation('variations', $variations);
        }

        return response()->json($this->appendSupplierMeta($product));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $product = Product::findOrFail($id);

        $validated = $request->validate([
            'type' => 'sometimes|required|string|in:simple,configurable,grouped,virtual,bundle,downloadable',
            'name' => 'sometimes|required|string|max:255',
            'category_id' => 'nullable|exists:categories,id',
            'category_ids' => 'nullable|array',
            'category_ids.*' => 'exists:categories,id',
            'price' => 'sometimes|required|numeric|min:0',
            'price_type' => 'nullable|string|in:fixed,sum',
            'expected_cost' => 'nullable|numeric|min:0',
            'special_price' => 'nullable|numeric|min:0',
            'special_price_from' => 'nullable|date',
            'special_price_to' => 'nullable|date',
            'description' => 'nullable|string',
            'is_featured' => 'boolean',
            'is_new' => 'boolean',
            'stock_quantity' => 'nullable|integer|min:0',
            'weight' => 'nullable|string',
            'inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'sku' => 'nullable|string|max:120',
            'status' => 'nullable|boolean',
            'meta_title' => 'nullable|string',
            'meta_description' => 'nullable|string',
            'meta_keywords' => 'nullable|string',
            'specifications' => 'nullable|string',
            'video_url' => 'nullable|string',
            'slug' => 'nullable|string|max:255|unique:products,slug,' . $id,
            'bundle_title' => 'nullable|string|max:255',
            'site_domain_id' => 'nullable|exists:site_domains,id',
            'supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'supplier_ids' => 'nullable|array',
            'supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'clear_supplier_ids' => 'nullable|boolean',
            'linked_product_ids' => 'nullable|array',
            'link_type' => 'nullable|string',
            'grouped_items' => 'nullable|array',
            'grouped_items.*.id' => 'required|exists:products,id',
            'grouped_items.*.quantity' => 'required|integer|min:1',
            'grouped_items.*.is_required' => 'required|boolean',
            'grouped_items.*.variant_id' => 'nullable|exists:products,id',
            'grouped_items.*.option_title' => 'nullable|string',
            'grouped_items.*.is_default' => 'nullable|boolean',
            'grouped_items.*.price' => 'nullable|numeric|min:0',
            'grouped_items.*.cost_price' => 'nullable|numeric|min:0',
            'super_attribute_ids' => 'nullable|array',
            'super_attribute_ids.*' => 'exists:attributes,id',
            // EAV custom values
            'custom_attributes' => 'nullable|array',
            'variants' => 'nullable|array',
            'variants.*.id' => 'nullable|integer',
            'variants.*.sku' => 'nullable|string|max:120',
            'variants.*.name' => 'nullable|string|max:255',
            'variants.*.price' => 'nullable|numeric|min:0',
            'variants.*.expected_cost' => 'nullable|numeric|min:0',
            'variants.*.weight' => 'nullable|string',
            'variants.*.inventory_unit_id' => 'nullable|exists:inventory_units,id',
            'variants.*.stock_quantity' => 'nullable|integer|min:0',
            'variants.*.attributes' => 'nullable|array',
        ], [
            'name.required' => 'Tên sản phẩm không được để trống.',
            'price.required' => 'Giá bán không được để trống.',
            'sku.unique' => 'Mã SKU này đã được sử dụng.',
            'slug.unique' => 'Đường dẫn (slug) này đã tồn tại, vui lòng chọn tên khác.',
            'slug.regex' => 'Đường dẫn chỉ được chứa chữ cái thường, số và dấu gạch ngang (VD: san-pham-1).',
        ]);

        $incomingSupplierIds = $request->has('supplier_ids') || $request->has('supplier_id') || $request->boolean('clear_supplier_ids');
        $supplierIds = $incomingSupplierIds
            ? ($request->boolean('clear_supplier_ids') ? [] : $this->normalizeSupplierIds($request, $validated))
            : $product->suppliers()->pluck('suppliers.id')->map(fn ($value) => (int) $value)->values()->all();

        if ($incomingSupplierIds) {
            $validated['supplier_id'] = $supplierIds[0] ?? null;
        }

        unset($validated['supplier_ids'], $validated['clear_supplier_ids']);

        if (isset($validated['slug'])) {
            $validated['slug'] = $this->productSkuService->generateUniqueSlug(
                !empty($validated['slug']) ? $validated['slug'] : ($validated['name'] ?? $product->name),
                $product->id
            );
        }

        try {
            $product = DB::transaction(function () use ($request, $validated, $product, $incomingSupplierIds, $supplierIds) {
                $this->prepareProductSku($validated, $product);
                $resolvedType = $validated['type'] ?? $product->type;
                $preparedVariants = ($request->has('variants') && $resolvedType === 'configurable')
                    ? $this->prepareVariantPayloads($request->input('variants', []), $validated['sku'], $product)
                    : [];

                $product->fill($validated);
                $nameChanged = $product->isDirty('name');
                $skuChanged = $product->isDirty('sku');
                $product->save();

                if ($incomingSupplierIds) {
                    $this->syncProductSuppliers($product, $supplierIds);
                }

        // ─── Sync snapshots on all linked order_items (batch UPDATE) ────────────
        // Runs one SQL query regardless of how many orders reference this product.
        if ($nameChanged || $skuChanged) {
            \App\Models\OrderItem::where('product_id', $product->id)
                ->update([
                'product_name_snapshot' => $product->name,
                'product_sku_snapshot' => $product->sku,
            ]);
        }
        // ────────────────────────────────────────────────────────────────────────
        // Sync categories
        if ($request->has('category_ids')) {
            $product->categories()->sync($request->category_ids);
        }
        elseif ($request->has('category_id') && !empty($request->category_id)) {
            // If only primary category changed, sync it as well
            $product->categories()->syncWithoutDetaching([$request->category_id]);
        }
        elseif ($request->has('category_id') && empty($request->category_id)) {
            // If primary category was explicitly cleared
            $product->categories()->detach();
            $product->update(['category_id' => null]);
        }
        // Sync EAV custom attributes
        if ($request->has('custom_attributes')) {
            $validAttrIds = \App\Models\Attribute::whereIn('id', array_keys($request->custom_attributes))->pluck('id')->toArray();
            foreach ($request->custom_attributes as $attrId => $val) {
                if (!in_array($attrId, $validAttrIds)) continue;
                // $val could be string, or array (for multiselect)
                $rawValue = is_array($val) ? json_encode($val) : $val;

                \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $product->id, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                );
            }
        }

        if ($request->has('linked_product_ids')) {
            $links = [];
            foreach (array_values($request->linked_product_ids) as $idx => $idOrObj) {
                if (is_array($idOrObj)) {
                    if (!empty($idOrObj['id'])) {
                        $links[$idOrObj['id']] = ['link_type' => 'related', 'position' => $idx, 'option_title' => $idOrObj['option_title'] ?? null];
                    }
                } else {
                    if (!empty($idOrObj)) {
                        $links[$idOrObj] = ['link_type' => 'related', 'position' => $idx];
                    }
                }
            }

            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();

            if (!empty($links)) {
                $product->relatedProducts()->attach($links);
            }
        } elseif ($request->get('clear_linked_products') == '1') {
            \Illuminate\Support\Facades\DB::table('product_links')
                ->where('product_id', $product->id)
                ->where('link_type', 'related')
                ->delete();
        }

        if ($request->has('grouped_items') && in_array($product->type, ['grouped', 'bundle'])) {
            $linkType = $product->type === 'bundle' ? 'bundle' : 'grouped';
            
            if ($product->type === 'bundle') {
                $product->bundleItems()->detach();
            } else {
                $product->groupedItems()->detach();
            }

            foreach ($request->grouped_items as $idx => $item) {
                $pivotData = [
                    'quantity' => $item['quantity'],
                    'is_required' => $item['is_required'],
                    'link_type' => $linkType,
                    'position' => $idx,
                    'option_title' => $item['option_title'] ?? null,
                    'is_default' => $item['is_default'] ?? false,
                    'variant_id' => $item['variant_id'] ?? null,
                    'price' => $item['price'] ?? null,
                    'cost_price' => $item['cost_price'] ?? null,
                ];

                if ($product->type === 'bundle') {
                    $product->bundleItems()->attach($item['id'], $pivotData);
                } else {
                    $product->groupedItems()->attach($item['id'], $pivotData);
                }
            }
        }

        if ($request->has('super_attribute_ids') && $product->type === 'configurable') {
            $attrs = [];
            foreach ($request->super_attribute_ids as $idx => $id) {
                $attrs[$id] = ['position' => $idx];
            }
            $product->superAttributes()->sync($attrs);
        }

        // Handle variants sync
        if ($request->has('variants') && $product->type === 'configurable') {
            $incomingVariants = $preparedVariants;
            $incomingVariantIds = [];

            // 1. Identify which variants to keep vs delete
            foreach ($incomingVariants as $vData) {
                if (isset($vData['id'])) {
                    $incomingVariantIds[] = $vData['id'];
                }
            }

            // 2. Remove variants that are no longer in the list (Clean up orphans) FIRST
            // This prevents duplicate SKU errors if a variant is recreated with the same SKU
            $existingVariantIds = $product->linkedProducts()
                ->wherePivot('link_type', 'super_link')
                ->pluck('products.id')
                ->toArray();
            
            $toDelete = array_diff($existingVariantIds, $incomingVariantIds);
            if (!empty($toDelete)) {
                $product->linkedProducts()->detach($toDelete);
                Product::whereIn('id', $toDelete)->delete();
            }

            // 3. Process remaining variants (Update or Create)
            foreach ($incomingVariants as $idx => $vData) {
                if (isset($vData['id'])) {
                    $variant = Product::findOrFail($vData['id']);
                    $variant->update([
                        'name' => $vData['name'] ?? $variant->name,
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $variant->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $supplierIds[0] ?? $product->supplier_id,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                    ]);

                    if ($incomingSupplierIds) {
                        $this->syncProductSuppliers($variant, $supplierIds);
                    }

                    // Handle variant image update/removal
                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $variant->images()->delete();
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }
                    elseif (isset($vData['remove_image']) && $vData['remove_image'] == 'true') {
                        $variant->images()->delete();
                    }

                    // Save/Update variant attribute values
                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::updateOrCreate(
                                ['product_id' => $variant->id, 'attribute_id' => $attrId],
                                ['value' => $val]
                            );
                        }
                    }

                    DB::table('product_links')
                        ->where('product_id', $product->id)
                        ->where('linked_product_id', $variant->id)
                        ->where('link_type', 'super_link')
                        ->update([
                            'position' => $idx,
                            'updated_at' => now(),
                        ]);
                }
                else {
                    // It's a "new" variant from frontend's perspective.
                    // But maybe it's actually an existing simple product by SKU?
                    // (Optional: can try to find by SKU if you want to be extra safe,
                    // but usually create is fine as long as toDelete happened)
                    $variant = Product::create([
                        'account_id' => $product->account_id,
                        'type' => 'simple',
                        'name' => $vData['name'] ?? ($product->name . ' - ' . ($vData['sku'] ?? 'Variant')),
                        'sku' => $vData['sku'],
                        'price' => $vData['price'] ?? $product->price,
                        'expected_cost' => $vData['expected_cost'] ?? null,
                        'weight' => $vData['weight'] ?? null,
                        'inventory_unit_id' => $vData['inventory_unit_id'] ?? $product->inventory_unit_id,
                        'supplier_id' => $supplierIds[0] ?? $product->supplier_id,
                        'stock_quantity' => $vData['stock_quantity'] ?? 0,
                        'category_id' => $product->category_id,
                        'status' => $product->status ?? true,
                    ]);

                    $this->syncProductSuppliers($variant, $supplierIds);

                    if ($request->hasFile("variants.{$idx}.image")) {
                        $disk = 's3';
                        $imageFile = $request->file("variants.{$idx}.image");
                        $path = Storage::disk($disk)->put('products', $imageFile, 'public');

                        // Construct Clean S3 URL
                        $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                        $url = $baseUrl . '/' . ltrim($path, '/');

                        \App\Models\ProductImage::create([
                            'product_id' => $variant->id,
                            'image_url' => $url,
                            'is_primary' => true,
                            'file_name' => $imageFile->getClientOriginalName(),
                            'file_size' => $imageFile->getSize(),
                        ]);
                    }

                    $product->linkedProducts()->attach($variant->id, [
                        'link_type' => 'super_link',
                        'position' => $idx,
                    ]);

                    if (isset($vData['attributes'])) {
                        $vValidAttrIds = \App\Models\Attribute::whereIn('id', array_keys($vData['attributes']))->pluck('id')->toArray();
                        foreach ($vData['attributes'] as $attrId => $val) {
                            if (!in_array($attrId, $vValidAttrIds)) continue;
                            \App\Models\ProductAttributeValue::create([
                                'product_id' => $variant->id,
                                'attribute_id' => $attrId,
                                'value' => $val
                            ]);
                        }
                    }
                }
            }
        }

                if ($incomingSupplierIds) {
                    $this->syncSuppliersToVariants($product, $supplierIds);
                }

                return $product;
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Đã phát hiện mã SKU bị trùng trong quá trình cập nhật. Vui lòng kiểm tra lại mã sản phẩm và biến thể.');
        }

        return response()->json($this->loadProductResource($product));
    }

    /**
     * Duplicate the specified resource.
     */
    public function duplicate($id)
    {
        try {
            $clone = DB::transaction(function () use ($id) {
                $original = Product::with([
                    'attributeValues',
                    'images',
                    'superAttributes',
                    'suppliers:id,name,code',
                    'supplierPrices',
                    'categories:id,name',
                    'relatedProducts',
                    'groupedItems',
                    'bundleItems',
                    'variations.images',
                    'variations.attributeValues',
                    'variations.suppliers:id,name,code',
                    'variations.supplierPrices',
                ])->where('id', $id)->firstOrFail();
                $originalSupplierIds = $original->suppliers
                    ->pluck('id')
                    ->map(fn ($value) => (int) $value)
                    ->values()
                    ->all();

                $clone = $original->replicate();
                $clone->name = $original->name . ' (Copy)';
                $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
                $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
                $clone->status = false;
                $clone->is_new = true;
                $clone->save();

                $this->syncProductSuppliers($clone, $originalSupplierIds);
                $this->productSkuService->copyProductDecorators($original, $clone);

                if ($original->type === 'configurable') {
                    foreach ($original->superAttributes as $superAttribute) {
                        $clone->superAttributes()->attach($superAttribute->id, [
                            'position' => $superAttribute->pivot->position,
                        ]);
                    }

                    foreach ($original->variations as $index => $variation) {
                        $this->productSkuService->cloneVariantForParent($variation, $clone, [
                            'position' => $variation->pivot->position ?? $index,
                        ]);
                    }
                }

                foreach ($original->relatedProducts as $relatedProduct) {
                    $clone->relatedProducts()->attach($relatedProduct->id, [
                        'link_type' => 'related',
                        'position' => $relatedProduct->pivot->position ?? 0,
                        'option_title' => $relatedProduct->pivot->option_title ?? null,
                    ]);
                }

                foreach ($original->groupedItems as $groupedItem) {
                    $clone->groupedItems()->attach($groupedItem->id, [
                        'link_type' => 'grouped',
                        'position' => $groupedItem->pivot->position ?? 0,
                        'quantity' => $groupedItem->pivot->quantity ?? 1,
                        'is_required' => $groupedItem->pivot->is_required ?? true,
                        'variant_id' => $groupedItem->pivot->variant_id ?? null,
                        'price' => $groupedItem->pivot->price ?? null,
                        'cost_price' => $groupedItem->pivot->cost_price ?? null,
                    ]);
                }

                foreach ($original->bundleItems as $bundleItem) {
                    $clone->bundleItems()->attach($bundleItem->id, [
                        'link_type' => 'bundle',
                        'position' => $bundleItem->pivot->position ?? 0,
                        'quantity' => $bundleItem->pivot->quantity ?? 1,
                        'is_required' => $bundleItem->pivot->is_required ?? true,
                        'option_title' => $bundleItem->pivot->option_title ?? null,
                        'is_default' => $bundleItem->pivot->is_default ?? false,
                        'variant_id' => $bundleItem->pivot->variant_id ?? null,
                        'price' => $bundleItem->pivot->price ?? null,
                        'cost_price' => $bundleItem->pivot->cost_price ?? null,
                    ]);
                }

                $clone->categories()->sync($original->categories->pluck('id')->toArray());

                return $this->loadProductResource($clone);
            });
        } catch (QueryException $exception) {
            $this->throwSkuConstraintValidation($exception, 'Không thể nhân bản sản phẩm vì mã SKU vừa phát sinh bị trùng. Vui lòng thử lại.');
        }

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        $clone = DB::transaction(function () use ($id) {
            $original = Product::with([
                'attributeValues',
                'images',
                'superAttributes',
                'suppliers:id,name,code',
                'supplierPrices',
                'categories:id,name',
                'relatedProducts',
                'groupedItems',
                'bundleItems',
                'variations.images',
                'variations.attributeValues',
                'variations.suppliers:id,name,code',
                'variations.supplierPrices',
            ])->where('id', $id)->firstOrFail();
            $originalSupplierIds = $original->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all();

            $clone = $original->replicate();
            $clone->name = $original->name . ' (Copy)';
            $clone->sku = $this->productSkuService->generateCopySku($original->sku, $original->name);
            $clone->slug = $this->productSkuService->generateUniqueSlug($clone->name);
            $clone->status = false;
            $clone->is_new = true;
            $clone->save();
            $this->syncProductSuppliers($clone, $originalSupplierIds);
            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $sa) {
                    $clone->superAttributes()->attach($sa->id, ['position' => $sa->pivot->position]);
                }
            }

            if (in_array($original->type, ['grouped', 'bundle', 'configurable'], true)) {
                foreach ($original->linkedProducts as $linkedProduct) {
                    if ($linkedProduct->pivot->link_type === 'super_link') {
                        $this->productSkuService->cloneVariantForParent($linkedProduct, $clone, [
                            'position' => $linkedProduct->pivot->position,
                        ]);
                        continue;
                    }

                    $clone->linkedProducts()->attach($linkedProduct->id, [
                        'link_type' => $linkedProduct->pivot->link_type,
                        'position' => $linkedProduct->pivot->position,
                        'quantity' => $linkedProduct->pivot->quantity ?? 1,
                        'is_required' => $linkedProduct->pivot->is_required ?? true,
                    ]);
                }
            }

            $clone->categories()->sync($original->categories->pluck('id')->toArray());

            return $this->loadProductResource($clone);
        });

        return response()->json([
            'message' => 'Sản phẩm đã được nhân bản thành công',
            'data' => $clone,
        ]);

        /*

            $this->productSkuService->copyProductDecorators($original, $clone);

            if ($original->type === 'configurable') {
                foreach ($original->superAttributes as $superAttribute) {
                    $clone->superAttributes()->attach($superAttribute->id, ['position' => $superAttribute->pivot->position]);
                }

                foreach ($original->variations as $index => $variation) {
                    $this->productSkuService->cloneVariantForParent($variation, $clone, [
                        'position' => $variation->pivot->position ?? $index,
                    ]);
                }
            }

            foreach ($original->relatedProducts as $relatedProduct) {
                $clone->relatedProducts()->attach($relatedProduct->id, [
                    'link_type' => 'related',
                    'position' => $relatedProduct->pivot->position ?? 0,
                    'option_title' => $relatedProduct->pivot->option_title ?? null,
                ]);
            }

            foreach ($original->groupedItems as $groupedItem) {
                $clone->groupedItems()->attach($groupedItem->id, [
                    'link_type' => 'grouped',
                    'position' => $groupedItem->pivot->position ?? 0,
                    'quantity' => $groupedItem->pivot->quantity ?? 1,
                    'is_required' => $groupedItem->pivot->is_required ?? true,
                    'variant_id' => $groupedItem->pivot->variant_id ?? null,
                    'price' => $groupedItem->pivot->price ?? null,
                    'cost_price' => $groupedItem->pivot->cost_price ?? null,
                ]);
            }

            foreach ($original->bundleItems as $bundleItem) {
                $clone->bundleItems()->attach($bundleItem->id, [
                    'link_type' => 'bundle',
                    'position' => $bundleItem->pivot->position ?? 0,
                    'quantity' => $bundleItem->pivot->quantity ?? 1,
                    'is_required' => $bundleItem->pivot->is_required ?? true,
                    'option_title' => $bundleItem->pivot->option_title ?? null,
                    'is_default' => $bundleItem->pivot->is_default ?? false,
                    'variant_id' => $bundleItem->pivot->variant_id ?? null,
                    'price' => $bundleItem->pivot->price ?? null,
                    'cost_price' => $bundleItem->pivot->cost_price ?? null,
                ]);
            }

        // Copy categories
        $clone->categories()->sync($original->categories->pluck('id')->toArray());

            return $clone;
        });

        return response()->json($this->loadProductResource($clone)); /*
            'message' => 'Sản phẩm đã được nhân bản thành công',
        ]);
        */
    }


    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(['message' => 'Sản phẩm đã được chuyển vào thùng rác']);
    }

    /**
     * Restore the specified resource from trash.
     */
    public function restore($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->restore();

        return response()->json(['message' => 'Sản phẩm đã được khôi phục thành công']);
    }

    /**
     * Permanently remove the specified resource from storage.
     */
    public function forceDelete($id)
    {
        $product = Product::onlyTrashed()->findOrFail($id);
        $product->forceDelete();

        return response()->json(['message' => 'Sản phẩm đã được xóa vĩnh viễn']);
    }

    /**
     * Bulk restore resources from trash.
     */
    public function bulkRestore(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->restore();
        return response()->json(['message' => 'Đã khôi phục các sản phẩm đã chọn']);
    }

    /**
     * Bulk permanently remove resources.
     */
    public function bulkForceDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::onlyTrashed()->whereIn('id', $ids)->forceDelete();
        return response()->json(['message' => 'Đã xóa vĩnh viễn các sản phẩm đã chọn']);
    }

    /**
     * Bulk move resources to trash.
     */
    public function bulkDelete(Request $request)
    {
        $ids = $request->input('ids', []);
        Product::whereIn('id', $ids)->delete();
        return response()->json(['message' => 'Đã chuyển các sản phẩm đã chọn vào thùng rác']);
    }

    /**
     * Bulk update attributes.
     */
    public function bulkUpdateAttributes(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:products,id',
            'basic_info' => 'nullable|array',
            'basic_info.cost_price' => 'nullable|numeric|min:0',
            'basic_info.supplier_id' => ['nullable', $this->supplierExistsRule($request)],
            'basic_info.supplier_ids' => 'nullable|array',
            'basic_info.supplier_ids.*' => ['nullable', $this->supplierExistsRule($request)],
            'attributes' => 'nullable|array',
        ]);

        $ids = $request->input('ids');
        $basicInfo = $request->input('basic_info', []);
        $attributesData = $request->input('attributes', []);

        if (empty($basicInfo) && empty($attributesData)) {
            return response()->json(['message' => 'Không có dữ liệu để cập nhật'], 422);
        }

        // --- Logging original data for BACKUP/UNDO ---
        $originalDataLog = [];
        $products = Product::with(['attributeValues', 'categories', 'suppliers:id,name,code'])->whereIn('id', $ids)->get();

        foreach ($products as $product) {
            $pData = [
                'id' => $product->id,
                'basic' => [],
                'attributes' => [],
                'category_ids' => $product->categories->pluck('id')->toArray(),
                'supplier_ids' => $product->suppliers->pluck('id')->map(fn ($value) => (int) $value)->values()->all(),
            ];

            // Store original basic fields that ARE being updated
            foreach (['category_id', 'price', 'cost_price', 'expected_cost', 'stock_quantity', 'supplier_id', 'is_featured', 'is_new', 'status', 'type'] as $field) {
                if (isset($basicInfo[$field]) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                    $pData['basic'][$field] = $product->{ $field};
                }
            }

            if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                $pData['basic']['supplier_id'] = $product->supplier_id;
            }

            // Store original EAV attributes that ARE being updated
            foreach ($attributesData as $attrId => $val) {
                if ($val !== null && $val !== '') {
                    $av = $product->attributeValues->where('attribute_id', $attrId)->first();
                    $pData['attributes'][$attrId] = $av ? $av->value : null;
                }
            }

            $originalDataLog[] = $pData;
        }

        $log = BulkUpdateLog::create([
            'batch_name' => 'Cập nhật hàng loạt ' . now()->format('d/m/Y H:i'),
            'product_count' => count($ids),
            'original_data' => $originalDataLog,
        ]);
        // ---------------------------------------------

        foreach ($ids as $productId) {
            $product = $products->find($productId);
            if (!$product)
                continue;

            // 1. Update basic info (direct columns)
            if (!empty($basicInfo)) {
                $toUpdate = [];
                foreach (['category_id', 'price', 'cost_price', 'expected_cost', 'stock_quantity', 'supplier_id', 'is_featured', 'is_new', 'status', 'type'] as $field) {
                    if (isset($basicInfo[$field]) && $basicInfo[$field] !== '' && $basicInfo[$field] !== null) {
                        $toUpdate[$field] = $basicInfo[$field];
                    }
                }
                if (!empty($toUpdate)) {
                    $product->update($toUpdate);
                }
                if (isset($basicInfo['category_ids']) && is_array($basicInfo['category_ids']) && !empty($basicInfo['category_ids'])) {
                    $product->categories()->sync($basicInfo['category_ids']);
                }

                if (array_key_exists('supplier_ids', $basicInfo) && is_array($basicInfo['supplier_ids'])) {
                    $this->syncProductSuppliers($product, $basicInfo['supplier_ids']);
                    $this->syncSuppliersToVariants($product, $basicInfo['supplier_ids']);
                }
            }

            // 2. Update EAV attributes
            if (!empty($attributesData)) {
                foreach ($attributesData as $attrId => $val) {
                    if ($val === null || $val === '')
                        continue;
                    $rawValue = is_array($val) ? json_encode($val) : $val;
                    \App\Models\ProductAttributeValue::updateOrCreate(
                    ['product_id' => $productId, 'attribute_id' => $attrId],
                    ['value' => $rawValue]
                    );
                }
            }
        }

        return response()->json([
            'message' => 'Cập nhật hàng loạt thành công',
            'log_id' => $log->id
        ]);
    }

    /**
     * Undo a bulk update operation.
     */
    public function undoBulkUpdate(Request $request)
    {
        $request->validate(['log_id' => 'required|exists:bulk_update_logs,id']);

        $log = BulkUpdateLog::findOrFail($request->log_id);
        $originalData = $log->original_data;

        foreach ($originalData as $pData) {
            $product = Product::find($pData['id']);
            if (!$product)
                continue;

            // Restore basic info
            if (!empty($pData['basic'])) {
                $product->update($pData['basic']);
            }

            if (array_key_exists('supplier_ids', $pData)) {
                $this->syncProductSuppliers($product, $pData['supplier_ids'] ?? []);
                $this->syncSuppliersToVariants($product, $pData['supplier_ids'] ?? []);
            }

            // Restore category sync
            if (isset($pData['category_ids'])) {
                $product->categories()->sync($pData['category_ids']);
            }

            // Restore EAV attributes
            if (!empty($pData['attributes'])) {
                foreach ($pData['attributes'] as $attrId => $originalValue) {
                    if ($originalValue === null) {
                        \App\Models\ProductAttributeValue::where('product_id', $product->id)
                            ->where('attribute_id', $attrId)
                            ->delete();
                    }
                    else {
                        \App\Models\ProductAttributeValue::updateOrCreate(
                        ['product_id' => $product->id, 'attribute_id' => $attrId],
                        ['value' => $originalValue]
                        );
                    }
                }
            }
        }

        // Optional: delete the log after undoing
        $log->delete();

        return response()->json(['message' => 'Đã hoàn tác cập nhật thành công']);
    }
}
