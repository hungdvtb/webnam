<?php

namespace App\Services\Leads;

use App\Models\Lead;
use App\Models\LeadItem;
use App\Models\Product;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class LeadBundleResolver
{
    /** @var array<int, array<int, array<string, mixed>>> */
    protected array $bundleGroupsCache = [];

    public function hydrateIncomingItem(array $item, ?Product $product, array $context = []): array
    {
        if (!$product || $product->type !== 'bundle') {
            return $item;
        }

        $richBundleChildren = $this->normalizeRichBundleChildren(Arr::get($item, 'bundle_items', []));
        if ($richBundleChildren !== []) {
            $quantity = max(1, (int) Arr::get($item, 'quantity', 1));
            $options = Arr::get($item, 'options', []);

            if (!is_array($options)) {
                $options = [];
            }

            $optionTitle = $this->extractRequestedOptionTitle($options)
                ?: ($richBundleChildren[0]['option_title'] ?? null);
            $subtotal = collect($richBundleChildren)->sum('line_total');
            $displayName = $this->appendOptionTitle($product->name, $optionTitle);

            return [
                ...$item,
                'product_name' => $displayName,
                'unit_price' => (float) $subtotal,
                'line_total' => (float) $subtotal * $quantity,
                'options' => array_filter([
                    ...$options,
                    'bundle_option_title' => $optionTitle,
                    'bundle_parent_name' => $product->name,
                ], fn ($value) => !is_null($value) && $value !== ''),
                'bundle_items' => $richBundleChildren,
            ];
        }

        $resolved = $this->resolveBundleConfiguration(
            $product,
            Arr::get($item, 'bundle_items', []),
            [
                'options' => Arr::get($item, 'options', []),
                'expected_subtotal' => $context['expected_subtotal'] ?? null,
            ]
        );

        if (!$resolved) {
            return $item;
        }

        $displayName = $this->appendOptionTitle($product->name, $resolved['option_title'] ?? null);
        $quantity = max(1, (int) Arr::get($item, 'quantity', 1));
        $options = Arr::get($item, 'options', []);

        if (!is_array($options)) {
            $options = [];
        }

        return [
            ...$item,
            'product_name' => $displayName,
            'unit_price' => (float) $resolved['subtotal'],
            'line_total' => (float) $resolved['subtotal'] * $quantity,
            'options' => array_filter([
                ...$options,
                'bundle_option_title' => $resolved['option_title'] ?? null,
                'bundle_parent_name' => $product->name,
            ], fn ($value) => !is_null($value) && $value !== ''),
            'bundle_items' => $resolved['children'],
        ];
    }

    public function resolveStoredLeadItem(LeadItem $item, ?Lead $lead = null): array
    {
        $bundleChildren = $this->normalizeRichBundleChildren($item->bundle_items);
        $bundleOptionTitle = $this->extractRequestedOptionTitle($item->options);

        $product = $item->relationLoaded('product') ? $item->product : $item->product()->first();
        if (!$bundleChildren && $product && $product->type === 'bundle') {
            $resolved = $this->resolveBundleConfiguration(
                $product,
                is_array($item->bundle_items) ? $item->bundle_items : [],
                [
                    'options' => $item->options,
                    'expected_subtotal' => $this->determineExpectedSubtotal($item, $lead),
                ]
            );

            if ($resolved) {
                $bundleChildren = $resolved['children'];
                $bundleOptionTitle = $resolved['option_title'] ?? $bundleOptionTitle;
            }
        }

        $displayName = $item->product_name ?: 'Sản phẩm website';
        if ($bundleOptionTitle) {
            $displayName = $this->appendOptionTitle($displayName, $bundleOptionTitle);
        }

        return [
            'is_bundle' => count($bundleChildren) > 0,
            'display_name' => $displayName,
            'bundle_option_title' => $bundleOptionTitle,
            'bundle_children' => $bundleChildren,
            'bundle_subtotal' => collect($bundleChildren)->sum('line_total'),
        ];
    }

    public function expandLeadItemForOrderDraft(LeadItem $item, ?Lead $lead = null): array
    {
        $resolved = $this->resolveStoredLeadItem($item, $lead);
        if (!$resolved['is_bundle']) {
            $product = $item->relationLoaded('product') ? $item->product : $item->product()->first();

            return [[
                'product_id' => $item->product_id,
                'name' => $item->product_name,
                'sku' => $item->product_sku,
                'quantity' => (int) $item->quantity,
                'price' => (float) $item->unit_price,
                'cost_price' => (float) ($product?->cost_price ?? 0),
                'options' => $item->options,
            ]];
        }

        return collect($resolved['bundle_children'])
            ->map(fn (array $child) => [
                'product_id' => $child['product_id'] ?? $child['variant_id'] ?? $child['base_product_id'] ?? null,
                'name' => $child['product_name'] ?? 'Sản phẩm bundle',
                'sku' => $child['product_sku'] ?? 'N/A',
                'quantity' => (int) ($child['quantity'] ?? 1),
                'price' => (float) ($child['unit_price'] ?? 0),
                'cost_price' => (float) ($child['cost_price'] ?? 0),
                'options' => array_filter([
                    'bundle_parent_name' => $item->product_name,
                    'bundle_option_title' => $resolved['bundle_option_title'],
                ], fn ($value) => !is_null($value) && $value !== ''),
            ])
            ->values()
            ->all();
    }

    protected function resolveBundleConfiguration(Product $product, array $rawBundleItems, array $context = []): ?array
    {
        $groups = $this->loadBundleGroups($product);
        if ($groups === []) {
            return null;
        }

        $requestedOptionTitle = $this->extractRequestedOptionTitle($context['options'] ?? []);
        $expectedSubtotal = isset($context['expected_subtotal']) ? (float) $context['expected_subtotal'] : null;
        $normalizedBundleItems = $this->normalizeBundleItems($rawBundleItems);

        usort($groups, function (array $left, array $right) use ($requestedOptionTitle, $expectedSubtotal, $normalizedBundleItems) {
            $leftScore = $this->scoreBundleGroup($left, $normalizedBundleItems, $requestedOptionTitle, $expectedSubtotal);
            $rightScore = $this->scoreBundleGroup($right, $normalizedBundleItems, $requestedOptionTitle, $expectedSubtotal);

            if ($leftScore === $rightScore) {
                $leftDiff = $expectedSubtotal === null ? PHP_FLOAT_MAX : abs((float) $left['subtotal'] - $expectedSubtotal);
                $rightDiff = $expectedSubtotal === null ? PHP_FLOAT_MAX : abs((float) $right['subtotal'] - $expectedSubtotal);

                if ($leftDiff === $rightDiff) {
                    return strcmp((string) $left['option_title'], (string) $right['option_title']);
                }

                return $leftDiff <=> $rightDiff;
            }

            return $rightScore <=> $leftScore;
        });

        return $groups[0] ?? null;
    }

    protected function loadBundleGroups(Product $product): array
    {
        if (array_key_exists($product->id, $this->bundleGroupsCache)) {
            return $this->bundleGroupsCache[$product->id];
        }

        $bundleProduct = Product::query()
            ->with(['bundleItems' => function ($query) {
                $query->withPivot(['quantity', 'option_title', 'variant_id', 'price', 'cost_price']);
            }])
            ->find($product->id);

        if (!$bundleProduct || $bundleProduct->type !== 'bundle') {
            return $this->bundleGroupsCache[$product->id] = [];
        }

        $variantIds = $bundleProduct->bundleItems
            ->pluck('pivot.variant_id')
            ->filter()
            ->unique()
            ->values();

        $variants = Product::query()
            ->whereIn('id', $variantIds)
            ->get()
            ->keyBy('id');

        $grouped = [];
        foreach ($bundleProduct->bundleItems as $child) {
            $optionTitle = trim((string) ($child->pivot->option_title ?: 'Mặc định'));
            $variant = $variants->get((int) $child->pivot->variant_id);
            $resolvedProduct = $variant ?: $child;
            $unitPrice = (float) ($child->pivot->price
                ?? $variant?->current_price
                ?? $variant?->price
                ?? $child->current_price
                ?? $child->price
                ?? 0);

            $costPrice = (float) ($child->pivot->cost_price
                ?? $variant?->cost_price
                ?? $child->cost_price
                ?? 0);

            $grouped[$optionTitle]['option_title'] = $optionTitle;
            $grouped[$optionTitle]['children'][] = [
                'base_product_id' => $child->id,
                'product_id' => $resolvedProduct->id,
                'variant_id' => $variant?->id,
                'product_name' => $resolvedProduct->name,
                'product_sku' => $resolvedProduct->sku,
                'quantity' => (int) ($child->pivot->quantity ?: 1),
                'unit_price' => $unitPrice,
                'line_total' => $unitPrice * (int) ($child->pivot->quantity ?: 1),
                'cost_price' => $costPrice,
                'option_title' => $optionTitle,
            ];
        }

        return $this->bundleGroupsCache[$product->id] = collect($grouped)
            ->map(function (array $group) {
                $group['subtotal'] = collect($group['children'])->sum('line_total');
                return $group;
            })
            ->values()
            ->all();
    }

    protected function normalizeBundleItems(array $rawBundleItems): array
    {
        return collect($rawBundleItems)
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                return [
                    'base_product_id' => (int) (Arr::get($item, 'base_product_id')
                        ?? Arr::get($item, 'linked_product_id')
                        ?? Arr::get($item, 'id')
                        ?? Arr::get($item, 'product_id')
                        ?? 0),
                    'variant_id' => (int) (Arr::get($item, 'variant_id') ?? 0),
                    'quantity' => max(1, (int) (Arr::get($item, 'quantity') ?? Arr::get($item, 'qty') ?? 1)),
                    'product_name' => (string) (Arr::get($item, 'product_name') ?? ''),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    protected function normalizeRichBundleChildren($bundleItems): array
    {
        if (!is_array($bundleItems) || $bundleItems === []) {
            return [];
        }

        $firstItem = $bundleItems[0] ?? null;
        if (!is_array($firstItem) || (!array_key_exists('product_name', $firstItem) && !array_key_exists('unit_price', $firstItem))) {
            return [];
        }

        return collect($bundleItems)
            ->map(fn (array $item) => [
                'base_product_id' => (int) (Arr::get($item, 'base_product_id') ?? Arr::get($item, 'linked_product_id') ?? Arr::get($item, 'id') ?? 0),
                'product_id' => (int) (Arr::get($item, 'product_id') ?? Arr::get($item, 'variant_id') ?? Arr::get($item, 'id') ?? 0),
                'variant_id' => Arr::get($item, 'variant_id') ? (int) Arr::get($item, 'variant_id') : null,
                'product_name' => (string) (Arr::get($item, 'product_name') ?? Arr::get($item, 'name') ?? 'Sản phẩm bundle'),
                'product_sku' => (string) (Arr::get($item, 'product_sku') ?? Arr::get($item, 'sku') ?? ''),
                'quantity' => max(1, (int) (Arr::get($item, 'quantity') ?? Arr::get($item, 'qty') ?? 1)),
                'unit_price' => (float) (Arr::get($item, 'unit_price') ?? Arr::get($item, 'price') ?? 0),
                'line_total' => (float) (Arr::get($item, 'line_total') ?? ((float) (Arr::get($item, 'unit_price') ?? Arr::get($item, 'price') ?? 0) * max(1, (int) (Arr::get($item, 'quantity') ?? Arr::get($item, 'qty') ?? 1)))),
                'cost_price' => (float) (Arr::get($item, 'cost_price') ?? 0),
                'option_title' => Arr::get($item, 'option_title'),
            ])
            ->values()
            ->all();
    }

    protected function scoreBundleGroup(array $group, array $normalizedBundleItems, ?string $requestedOptionTitle, ?float $expectedSubtotal): float
    {
        $score = 0.0;

        if ($requestedOptionTitle) {
            $requested = Str::lower($requestedOptionTitle);
            $candidate = Str::lower((string) ($group['option_title'] ?? ''));
            if ($candidate === $requested) {
                $score += 10000;
            } elseif (str_contains($candidate, $requested) || str_contains($requested, $candidate)) {
                $score += 5000;
            }
        }

        foreach ($normalizedBundleItems as $rawItem) {
            foreach ($group['children'] as $child) {
                if ($rawItem['variant_id'] && $rawItem['variant_id'] === (int) ($child['variant_id'] ?? 0)) {
                    $score += $rawItem['quantity'] === (int) $child['quantity'] ? 600 : 350;
                }

                if ($rawItem['base_product_id'] && $rawItem['base_product_id'] === (int) ($child['base_product_id'] ?? 0)) {
                    $score += $rawItem['quantity'] === (int) $child['quantity'] ? 420 : 180;
                }

                if ($rawItem['product_name'] !== '' && Str::contains(Str::lower($child['product_name']), Str::lower($rawItem['product_name']))) {
                    $score += 80;
                }
            }
        }

        if ($normalizedBundleItems !== [] && count($normalizedBundleItems) === count($group['children'])) {
            $score += 240;
        }

        if (!is_null($expectedSubtotal)) {
            $difference = abs((float) $group['subtotal'] - $expectedSubtotal);
            if ($difference < 0.01) {
                $score += 8000;
            } elseif ($difference < 5000) {
                $score += 4000;
            } elseif ($difference < 20000) {
                $score += 1200;
            } else {
                $score -= ($difference / 1000);
            }
        }

        return $score;
    }

    protected function extractRequestedOptionTitle($options): ?string
    {
        if (is_string($options) && trim($options) !== '') {
            return trim($options);
        }

        if (!is_array($options)) {
            return null;
        }

        foreach (['bundle_option_title', 'option_title', 'selected_option', 'option_label', 'bundle_title', 'title'] as $key) {
            $value = Arr::get($options, $key);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        $iterator = new \RecursiveIteratorIterator(new \RecursiveArrayIterator($options));
        foreach ($iterator as $value) {
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
    }

    protected function determineExpectedSubtotal(LeadItem $item, ?Lead $lead): ?float
    {
        if ($lead && $lead->relationLoaded('items') && $lead->items->count() === 1) {
            $shippingFee = (float) Arr::get($lead->payload_snapshot ?: [], 'shipping_fee', 0);
            return max(0, (float) $lead->total_amount + (float) $lead->discount_amount - $shippingFee);
        }

        if ((float) $item->line_total > 0) {
            return (float) $item->line_total / max(1, (int) $item->quantity);
        }

        return null;
    }

    protected function appendOptionTitle(string $productName, ?string $optionTitle): string
    {
        $productName = trim($productName);
        $optionTitle = trim((string) $optionTitle);

        if ($optionTitle === '') {
            return $productName;
        }

        return Str::contains(Str::lower($productName), Str::lower($optionTitle))
            ? $productName
            : "{$productName} - {$optionTitle}";
    }
}
