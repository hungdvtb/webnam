<?php

namespace App\Services\Leads;

use App\Models\Lead;
use App\Models\LeadItem;
use App\Models\LeadStatus;
use App\Models\LeadTagRule;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LeadCaptureService
{
    public function createWebsiteOrderLead(Request $request): Lead
    {
        $accountId = (int) $request->header('X-Account-Id');
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);
        $defaultStatus = $statuses->firstWhere('is_default', true) ?: $statuses->first();
        $bundleResolver = app(LeadBundleResolver::class);

        $itemsPayload = collect($request->input('items', []));
        $products = Product::query()
            ->whereIn('id', $itemsPayload->pluck('product_id')->filter()->unique()->values())
            ->get()
            ->keyBy('id');

        $normalizedItems = $itemsPayload->values()->map(function ($item, $index) use ($products, $bundleResolver, $request, $itemsPayload) {
            $product = $products->get((int) Arr::get($item, 'product_id'));
            $quantity = max(1, (int) Arr::get($item, 'quantity', 1));
            $unitPrice = (float) (Arr::get($item, 'unit_price') ?? Arr::get($item, 'price') ?? $product?->current_price ?? $product?->price ?? 0);
            $lineTotal = $unitPrice * $quantity;
            $productName = (string) (Arr::get($item, 'product_name') ?: $product?->name ?: 'San pham website');
            $productSlug = (string) (Arr::get($item, 'product_slug') ?: $product?->slug ?: '');
            $productUrl = (string) (Arr::get($item, 'product_url') ?: '');

            $normalizedItem = [
                'sort_order' => $index + 1,
                'product_id' => $product?->id,
                'product_name' => $productName,
                'product_sku' => (string) (Arr::get($item, 'product_sku') ?: $product?->sku ?: ''),
                'product_slug' => $productSlug,
                'product_url' => $productUrl,
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'line_total' => $lineTotal,
                'options' => Arr::get($item, 'options'),
                'bundle_items' => Arr::get($item, 'sub_items') ?: Arr::get($item, 'bundle_items'),
            ];

            $expectedSubtotal = null;
            if ($itemsPayload->count() === 1) {
                $expectedSubtotal = max(
                    0,
                    (float) ($request->input('total') ?? $request->input('total_amount') ?? 0)
                    + (float) ($request->input('discount') ?? $request->input('discount_amount') ?? 0)
                    - (float) ($request->input('shipping_fee') ?? 0)
                );
            }

            return $bundleResolver->hydrateIncomingItem($normalizedItem, $product, [
                'expected_subtotal' => $expectedSubtotal,
            ]);
        });

        $productSummary = $this->buildProductSummary($normalizedItems->all());
        $conversionData = $this->buildConversionData($request);
        $tag = $this->resolveTag($accountId, $conversionData);
        $totalAmount = (float) ($request->input('total') ?? $request->input('total_amount') ?? $normalizedItems->sum('line_total'));
        $discountAmount = (float) ($request->input('discount') ?? $request->input('discount_amount') ?? 0);
        $address = (string) ($request->input('address') ?: $request->input('shipping_address') ?: '');
        $firstItem = $normalizedItems->first();

        return DB::transaction(function () use (
            $request,
            $accountId,
            $defaultStatus,
            $normalizedItems,
            $productSummary,
            $conversionData,
            $tag,
            $totalAmount,
            $discountAmount,
            $address,
            $firstItem
        ) {
            $lead = Lead::create([
                'account_id' => $accountId,
                'lead_number' => $this->generateLeadNumber($accountId),
                'lead_status_id' => $defaultStatus?->id,
                'customer_name' => $request->input('customer_name'),
                'phone' => $request->input('phone') ?: $request->input('customer_phone'),
                'email' => $request->input('email') ?: $request->input('customer_email'),
                'address' => $address,
                'product_id' => $firstItem['product_id'] ?? null,
                'product_name' => $firstItem['product_name'] ?? null,
                'product_summary' => $productSummary['full'],
                'product_summary_short' => $productSummary['short'],
                'message' => $request->input('notes') ?: $request->input('message'),
                'source' => $this->sourceStorageKey($conversionData['source'] ?? 'Website'),
                'tag' => $tag,
                'link_url' => $firstItem['product_url'] ?: ($conversionData['landing_url'] ?? $conversionData['current_url'] ?? null),
                'utm_source' => $conversionData['utm_source'] ?? null,
                'utm_medium' => $conversionData['utm_medium'] ?? null,
                'utm_campaign' => $conversionData['utm_campaign'] ?? null,
                'status' => $defaultStatus?->code ?: 'don-moi',
                'placed_at' => now(),
                'total_amount' => $totalAmount,
                'discount_amount' => $discountAmount,
                'status_changed_at' => now(),
                'notes' => $request->input('notes') ?: null,
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'payload_snapshot' => $this->buildPayloadSnapshot($request),
                'conversion_data' => $conversionData,
            ]);

            $normalizedItems->each(function ($item) use ($lead, $accountId) {
                LeadItem::create([
                    ...$item,
                    'account_id' => $accountId,
                    'lead_id' => $lead->id,
                ]);
            });

            return $lead->load(['items', 'statusConfig']);
        });
    }

    public function createGenericLead(Request $request): Lead
    {
        $accountId = (int) $request->header('X-Account-Id');
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);
        $defaultStatus = $statuses->firstWhere('is_default', true) ?: $statuses->first();
        $conversionData = $this->buildConversionData($request);
        $tag = $this->resolveTag($accountId, $conversionData);

        return Lead::create([
            'account_id' => $accountId,
            'lead_number' => $this->generateLeadNumber($accountId),
            'lead_status_id' => $defaultStatus?->id,
            'customer_name' => $request->input('customer_name'),
            'phone' => $request->input('phone'),
            'email' => $request->input('email'),
            'product_id' => $request->input('product_id'),
            'product_name' => $request->input('product_name'),
            'product_summary' => $request->input('product_name'),
            'product_summary_short' => $request->input('product_name'),
            'message' => $request->input('message'),
            'source' => $this->sourceStorageKey($conversionData['source'] ?? $request->input('source', 'Website')),
            'tag' => $tag,
            'link_url' => $conversionData['landing_url'] ?? $conversionData['current_url'] ?? null,
            'utm_source' => $conversionData['utm_source'] ?? null,
            'utm_medium' => $conversionData['utm_medium'] ?? null,
            'utm_campaign' => $conversionData['utm_campaign'] ?? null,
            'status' => $defaultStatus?->code ?: 'don-moi',
            'placed_at' => now(),
            'status_changed_at' => now(),
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'payload_snapshot' => $this->buildPayloadSnapshot($request),
            'conversion_data' => $conversionData,
        ]);
    }

    public function generateLeadNumber(?int $accountId): string
    {
        $query = Lead::withoutGlobalScopes()->orderByDesc('id');
        if ($accountId) {
            $query->where('account_id', $accountId);
        }

        $last = $query->value('lead_number');
        $nextNumber = 10000;
        if ($last && preg_match('/LD(\d+)A0/', $last, $matches)) {
            $nextNumber = ((int) $matches[1]) + 1;
        }

        return sprintf('LD%dA0', $nextNumber);
    }

    public function buildProductSummary(array $items): array
    {
        if (empty($items)) {
            return ['short' => 'Khong co san pham', 'full' => 'Khong co san pham'];
        }

        $rows = collect($items)->map(function ($item) {
            $name = trim((string) ($item['product_name'] ?? 'San pham website'));
            $qty = (int) ($item['quantity'] ?? 1);
            $sku = trim((string) ($item['product_sku'] ?? ''));
            return $sku ? sprintf('%s (%s) x%d', $name, $sku, $qty) : sprintf('%s x%d', $name, $qty);
        })->values();

        $full = $rows->implode('; ');
        $short = $rows->take(2)->implode('; ');
        if ($rows->count() > 2) {
            $short .= sprintf(' +%d san pham', $rows->count() - 2);
        }

        return [
            'short' => Str::limit($short, 140, '...'),
            'full' => $full,
        ];
    }

    public function buildPayloadSnapshot(Request $request): array
    {
        return [
            'customer_name' => $request->input('customer_name'),
            'phone' => $request->input('phone') ?: $request->input('customer_phone'),
            'email' => $request->input('email') ?: $request->input('customer_email'),
            'address' => $request->input('address') ?: $request->input('shipping_address'),
            'province' => $request->input('province'),
            'district' => $request->input('district'),
            'ward' => $request->input('ward'),
            'notes' => $request->input('notes') ?: $request->input('message'),
            'payment_method' => $request->input('payment_method') ?: $request->input('paymentMethod'),
            'source' => $request->input('source'),
            'type' => $request->input('type'),
            'shipment_status' => $request->input('shipment_status'),
            'shipping_fee' => (float) ($request->input('shipping_fee') ?? 0),
            'discount' => (float) ($request->input('discount') ?? 0),
            'total' => (float) ($request->input('total') ?? $request->input('total_amount') ?? 0),
            'items' => $request->input('items', []),
            'custom_attributes' => $request->input('custom_attributes', []),
        ];
    }

    public function buildConversionData(Request $request): array
    {
        $data = array_filter([
            'site_code' => $request->header('X-Site-Code'),
            'landing_url' => $request->input('landing_url'),
            'current_url' => $request->input('current_url'),
            'referrer' => $request->input('referrer'),
            'utm_source' => $request->input('utm_source'),
            'utm_medium' => $request->input('utm_medium'),
            'utm_campaign' => $request->input('utm_campaign'),
            'utm_content' => $request->input('utm_content'),
            'utm_term' => $request->input('utm_term'),
            'raw_query' => $request->input('raw_query'),
            'source_label' => $request->input('source'),
        ], fn ($value) => !is_null($value) && $value !== '');

        $data['source'] = $this->resolveTrackingSource($data);

        return $data;
    }

    public function resolveTag(?int $accountId, array $conversionData): string
    {
        $haystacks = [
            Str::lower((string) ($conversionData['landing_url'] ?? '')),
            Str::lower((string) ($conversionData['current_url'] ?? '')),
            Str::lower((string) ($conversionData['referrer'] ?? '')),
            Str::lower((string) ($conversionData['utm_source'] ?? '')),
            Str::lower((string) ($conversionData['utm_medium'] ?? '')),
            Str::lower((string) ($conversionData['utm_campaign'] ?? '')),
            Str::lower((string) ($conversionData['source_label'] ?? '')),
            Str::lower((string) ($conversionData['raw_query'] ?? '')),
        ];

        if ($accountId) {
            $rules = LeadTagRule::withoutGlobalScopes()
                ->where('account_id', $accountId)
                ->where('is_active', true)
                ->orderByDesc('priority')
                ->orderBy('id')
                ->get();

            foreach ($rules as $rule) {
                foreach ($haystacks as $haystack) {
                    if ($this->matchesRule($rule->match_type, $rule->pattern, $haystack)) {
                        return $rule->tag;
                    }
                }
            }
        }

        return $this->resolveTrackingSource($conversionData);
    }

    private function resolveTrackingSource(array $conversionData): string
    {
        $directSource = $this->normalizeKnownSource($conversionData['utm_source'] ?? null)
            ?: $this->normalizeKnownSource($conversionData['source'] ?? null)
            ?: $this->normalizeKnownSource($conversionData['source_label'] ?? null);

        if ($directSource) {
            return $directSource;
        }

        $haystacks = [
            Str::lower((string) ($conversionData['landing_url'] ?? '')),
            Str::lower((string) ($conversionData['current_url'] ?? '')),
            Str::lower((string) ($conversionData['referrer'] ?? '')),
            Str::lower((string) ($conversionData['utm_source'] ?? '')),
            Str::lower((string) ($conversionData['utm_medium'] ?? '')),
            Str::lower((string) ($conversionData['utm_campaign'] ?? '')),
            Str::lower((string) ($conversionData['source_label'] ?? '')),
            Str::lower((string) ($conversionData['raw_query'] ?? '')),
        ];

        $combined = implode(' ', array_filter($haystacks));

        if (
            str_contains($combined, 'facebook')
            || str_contains($combined, 'fbclid')
            || str_contains($combined, 'meta')
            || preg_match('/\bfb\b/', $combined)
        ) {
            return 'Facebook';
        }

        if (
            str_contains($combined, 'google')
            || str_contains($combined, 'gclid')
            || str_contains($combined, 'googleads')
        ) {
            return 'Google';
        }

        if (str_contains($combined, 'tiktok') || str_contains($combined, 'ttclid')) {
            return 'TikTok';
        }

        $referrer = trim((string) ($conversionData['referrer'] ?? ''));
        if ($referrer === '') {
            return 'Direct';
        }

        return 'Website';
    }

    private function normalizeKnownSource(?string $value): ?string
    {
        $normalized = Str::lower(trim((string) $value));
        if ($normalized === '') {
            return null;
        }

        return match ($normalized) {
            'facebook', 'fb', 'meta', 'facebook_ads', 'facebook-ad', 'facebook ads' => 'Facebook',
            'google', 'google_ads', 'google-ad', 'google ads', 'ga', 'gg' => 'Google',
            'tiktok', 'tt', 'tik_tok', 'tiktok_ads', 'tiktok-ad', 'tiktok ads' => 'TikTok',
            'direct' => 'Direct',
            'website', 'website_order', 'website_lead', 'web' => 'Website',
            default => null,
        };
    }

    private function sourceStorageKey(?string $value): string
    {
        return match ($this->normalizeKnownSource($value) ?? 'Website') {
            'Facebook' => 'facebook',
            'Google' => 'google',
            'TikTok' => 'tiktok',
            'Direct' => 'direct',
            default => 'website',
        };
    }

    private function matchesRule(string $matchType, string $pattern, string $haystack): bool
    {
        $pattern = Str::lower(trim($pattern));
        if ($pattern === '' || $haystack === '') {
            return false;
        }

        return match ($matchType) {
            'exact' => $haystack === $pattern,
            'starts_with' => Str::startsWith($haystack, $pattern),
            'ends_with' => Str::endsWith($haystack, $pattern),
            'regex' => @preg_match($pattern, $haystack) === 1,
            default => str_contains($haystack, $pattern),
        };
    }
}
