<?php

namespace App\Services\Leads;

use App\Models\Lead;
use App\Models\LeadItem;
use App\Models\LeadStatus;
use App\Models\LeadTagRule;
use App\Models\Product;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LeadCaptureService
{
    public function createWebsiteOrderLead(Request $request): Lead
    {
        return $this->captureWebsiteCheckoutLead($request, false);
    }

    public function createWebsiteOrderDraft(Request $request): Lead
    {
        return $this->captureWebsiteCheckoutLead($request, true);
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

    protected function captureWebsiteCheckoutLead(Request $request, bool $asDraft, bool $retried = false): Lead
    {
        $accountId = (int) $request->header('X-Account-Id');
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);
        $defaultStatus = $statuses->firstWhere('is_default', true) ?: $statuses->first();
        $draftStatus = $statuses->firstWhere('code', 'don-nhap') ?: $defaultStatus;
        $normalizedItems = $this->normalizeWebsiteOrderItems($request);
        $productSummary = $this->buildProductSummary($normalizedItems->all());
        $conversionData = $this->buildConversionData($request);
        $tag = $this->resolveTag($accountId, $conversionData);
        $totalAmount = (float) ($request->input('total') ?? $request->input('total_amount') ?? $normalizedItems->sum('line_total'));
        $discountAmount = (float) ($request->input('discount') ?? $request->input('discount_amount') ?? 0);
        $address = $this->resolveLeadAddress($request);
        $draftToken = $this->normalizeDraftToken($request->input('draft_token'));
        $noteMessage = trim((string) ($request->input('notes') ?: $request->input('message') ?: ''));
        $firstItem = $normalizedItems->first();

        try {
            return DB::transaction(function () use (
                $request,
                $accountId,
                $defaultStatus,
                $draftStatus,
                $normalizedItems,
                $productSummary,
                $conversionData,
                $tag,
                $totalAmount,
                $discountAmount,
                $address,
                $draftToken,
                $noteMessage,
                $firstItem,
                $asDraft
            ) {
                $lead = null;
                if ($draftToken) {
                    $lead = Lead::withoutGlobalScopes()
                        ->where('account_id', $accountId)
                        ->where('draft_token', $draftToken)
                        ->with('statusConfig')
                        ->lockForUpdate()
                        ->first();
                }

                if ($lead && $asDraft && !$lead->is_draft) {
                    return $lead->load(['items', 'statusConfig']);
                }

                $isNewLead = !$lead;
                $wasDraft = (bool) ($lead?->is_draft ?? false);

                if (!$lead) {
                    $lead = new Lead();
                    $lead->account_id = $accountId;
                    $lead->lead_number = $this->generateLeadNumber($accountId);
                    $lead->draft_token = $draftToken;
                    $lead->draft_captured_at = $draftToken ? now() : null;
                }

                $lead->customer_name = trim((string) ($request->input('customer_name') ?? ''));
                $lead->phone = trim((string) ($request->input('phone') ?: $request->input('customer_phone') ?: ''));
                $lead->email = $request->input('email') ?: $request->input('customer_email');
                $lead->address = $address !== '' ? $address : null;
                $lead->product_id = $firstItem['product_id'] ?? null;
                $lead->product_name = $firstItem['product_name'] ?? null;
                $lead->product_summary = $productSummary['full'];
                $lead->product_summary_short = $productSummary['short'];
                $lead->message = $noteMessage !== '' ? $noteMessage : null;
                $lead->source = $this->sourceStorageKey($conversionData['source'] ?? 'Website');
                $lead->tag = $tag;
                $lead->link_url = $firstItem['product_url']
                    ?: ($conversionData['landing_url'] ?? $conversionData['current_url'] ?? null);
                $lead->utm_source = $conversionData['utm_source'] ?? null;
                $lead->utm_medium = $conversionData['utm_medium'] ?? null;
                $lead->utm_campaign = $conversionData['utm_campaign'] ?? null;
                $lead->total_amount = $totalAmount;
                $lead->discount_amount = $discountAmount;
                $lead->notes = $noteMessage !== '' ? $noteMessage : null;
                $lead->ip_address = $request->ip();
                $lead->user_agent = $request->userAgent();
                $lead->payload_snapshot = $this->buildPayloadSnapshot($request);
                $lead->conversion_data = $conversionData;
                $lead->draft_token = $draftToken ?: $lead->draft_token;

                if ($asDraft) {
                    $lead->lead_status_id = $draftStatus?->id ?? $lead->lead_status_id;
                    $lead->status = $draftStatus?->code ?? $lead->status ?? 'don-nhap';
                    $lead->is_draft = true;
                    $lead->placed_at = $lead->placed_at ?: now();
                    $lead->draft_captured_at = $lead->draft_captured_at ?: now();

                    if ($isNewLead || !$wasDraft) {
                        $lead->status_changed_at = now();
                    }
                } else {
                    if ($wasDraft || !$lead->lead_status_id) {
                        $lead->lead_status_id = $defaultStatus?->id ?? $lead->lead_status_id;
                        $lead->status = $defaultStatus?->code ?? $lead->status ?? 'don-moi';
                        $lead->status_changed_at = now();
                    }

                    $lead->is_draft = false;
                    $lead->placed_at = now();
                    $lead->draft_captured_at = $lead->draft_captured_at ?: now();
                    $lead->converted_at = now();
                }

                $lead->save();

                $this->syncLeadItems($lead, $normalizedItems, $accountId);

                return $lead->load(['items', 'statusConfig']);
            });
        } catch (QueryException $exception) {
            if (!$retried && $draftToken && $this->causedByDraftTokenConflict($exception)) {
                return $this->captureWebsiteCheckoutLead($request, $asDraft, true);
            }

            throw $exception;
        }
    }

    protected function normalizeWebsiteOrderItems(Request $request): Collection
    {
        $bundleResolver = app(LeadBundleResolver::class);
        $itemsPayload = collect($request->input('items', []));
        $products = Product::query()
            ->whereIn('id', $itemsPayload->pluck('product_id')->filter()->unique()->values())
            ->get()
            ->keyBy('id');

        return $itemsPayload->values()->map(function ($item, $index) use ($products, $bundleResolver, $request, $itemsPayload) {
            $product = $products->get((int) Arr::get($item, 'product_id'));
            $quantity = max(1, (int) Arr::get($item, 'quantity', 1));
            $unitPrice = (float) (Arr::get($item, 'unit_price') ?? Arr::get($item, 'price') ?? $product?->current_price ?? $product?->price ?? 0);
            $lineTotal = (float) (Arr::get($item, 'line_total') ?? ($unitPrice * $quantity));
            $productName = trim((string) (Arr::get($item, 'product_name') ?: $product?->name ?: 'San pham website'));
            $productSlug = trim((string) (Arr::get($item, 'product_slug') ?: $product?->slug ?: ''));
            $productUrl = trim((string) (Arr::get($item, 'product_url') ?: ''));

            $normalizedItem = [
                'sort_order' => $index + 1,
                'product_id' => $product?->id ?: (Arr::get($item, 'product_id') ? (int) Arr::get($item, 'product_id') : null),
                'product_name' => $productName,
                'product_sku' => trim((string) (Arr::get($item, 'product_sku') ?: $product?->sku ?: '')),
                'product_slug' => $productSlug,
                'product_url' => $productUrl,
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'line_total' => $lineTotal,
                'options' => Arr::get($item, 'options'),
                'bundle_items' => Arr::get($item, 'sub_items') ?? Arr::get($item, 'bundle_items') ?? [],
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
    }

    protected function syncLeadItems(Lead $lead, Collection $items, int $accountId): void
    {
        $lead->items()->delete();

        $items->each(function (array $item) use ($lead, $accountId) {
            LeadItem::create([
                ...$item,
                'account_id' => $accountId,
                'lead_id' => $lead->id,
            ]);
        });
    }

    protected function resolveLeadAddress(Request $request): string
    {
        $fullAddress = trim((string) ($request->input('address') ?: $request->input('shipping_address') ?: ''));
        $addressDetail = trim((string) ($request->input('address_detail') ?: ''));
        $province = trim((string) ($request->input('province') ?: ''));
        $district = trim((string) ($request->input('district') ?: ''));
        $ward = trim((string) ($request->input('ward') ?: ''));

        if ($fullAddress !== '') {
            return $fullAddress;
        }

        return collect([$addressDetail, $ward, $district, $province])
            ->filter(fn ($value) => $value !== '')
            ->implode(', ');
    }

    protected function normalizeDraftToken(?string $value): ?string
    {
        $normalized = trim((string) $value);
        return $normalized !== '' ? Str::limit($normalized, 120, '') : null;
    }

    protected function causedByDraftTokenConflict(QueryException $exception): bool
    {
        $message = Str::lower($exception->getMessage());

        return str_contains($message, 'draft_token')
            || ($exception->getCode() === '23000' && str_contains($message, 'unique'));
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
            'address_detail' => $request->input('address_detail'),
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
            'draft_token' => $this->normalizeDraftToken($request->input('draft_token')),
            'draft_lead_id' => $request->input('draft_lead_id'),
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
            'draft_token' => $this->normalizeDraftToken($request->input('draft_token')),
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
