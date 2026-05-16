<?php

namespace App\Services\Analytics;

use App\Models\Lead;
use App\Models\SiteAnalyticsEvent;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class MetaConversionsApiService
{
    private const EVENT_MAP = [
        SiteAnalyticsEvent::EVENT_PAGE_VIEW => 'PageView',
        SiteAnalyticsEvent::EVENT_PRODUCT_VIEW => 'ViewContent',
        SiteAnalyticsEvent::EVENT_ADD_TO_CART => 'AddToCart',
        SiteAnalyticsEvent::EVENT_CHECKOUT_STARTED => 'InitiateCheckout',
        SiteAnalyticsEvent::EVENT_ORDER_PLACED => 'Purchase',
        SiteAnalyticsEvent::EVENT_LEAD => 'Lead',
    ];

    public function sendFromRequest(Request $request, string $siteEventName, array $overrides = []): bool
    {
        $eventName = $overrides['event_name'] ?? self::EVENT_MAP[$siteEventName] ?? null;
        if (!$eventName) {
            Log::debug('Meta Conversions API event skipped: unsupported event.', [
                'site_event_name' => $siteEventName,
            ]);

            return false;
        }

        if (!$this->isConfigured()) {
            $this->logConfigurationIssue($eventName);

            return false;
        }

        $event = $this->buildEvent($request, $eventName, $overrides);
        if ($event === null) {
            Log::warning('Meta Conversions API event skipped: missing event source URL.', [
                'event_name' => $eventName,
                'site_event_name' => $siteEventName,
            ]);

            return false;
        }

        return $this->sendEvents([$event]);
    }

    public function sendPurchaseFromLead(Request $request, Lead $lead): bool
    {
        $lead->loadMissing('items');
        $items = $this->leadItems($lead);
        $contentIds = $items
            ->pluck('id')
            ->filter()
            ->values()
            ->all();

        return $this->sendFromRequest($request, SiteAnalyticsEvent::EVENT_ORDER_PLACED, [
            'event_id' => $this->firstFilled(
                $request->input('meta_event_id'),
                $request->input('event_id'),
                $lead->lead_number ? 'purchase_' . $lead->lead_number : null,
            ),
            'value' => (float) ($lead->total_amount ?? 0),
            'currency' => config('meta_conversions.currency', 'VND'),
            'order_id' => $lead->lead_number,
            'content_ids' => $contentIds,
            'content_type' => 'product',
            'contents' => $items->all(),
            'num_items' => (int) $items->sum('quantity'),
            'email' => $lead->email,
            'phone' => $lead->phone,
            'event_source_url' => $this->firstFilled($lead->link_url, $request->input('current_url'), $request->input('landing_url')),
        ]);
    }

    public function sendLeadFromLead(Request $request, Lead $lead): bool
    {
        return $this->sendFromRequest($request, SiteAnalyticsEvent::EVENT_LEAD, [
            'event_id' => $this->firstFilled(
                $request->input('meta_event_id'),
                $request->input('event_id'),
                $lead->lead_number ? 'lead_' . $lead->lead_number : null,
            ),
            'content_ids' => $lead->product_id ? [(string) $lead->product_id] : [],
            'content_name' => $lead->product_name,
            'content_type' => $lead->product_id ? 'product' : null,
            'email' => $lead->email,
            'phone' => $lead->phone,
            'event_source_url' => $this->firstFilled($lead->link_url, $request->input('current_url'), $request->input('landing_url')),
        ]);
    }

    private function buildEvent(Request $request, string $eventName, array $overrides): ?array
    {
        $eventSourceUrl = $this->normalizeUrl($this->firstFilled(
            $overrides['event_source_url'] ?? null,
            $request->input('event_source_url'),
            $request->input('current_url'),
            $request->input('url'),
            $request->input('landing_url'),
            $request->headers->get('referer'),
            config('app.frontend_url'),
        ));

        if (!$eventSourceUrl) {
            return null;
        }

        $event = [
            'event_name' => $eventName,
            'event_time' => (int) ($overrides['event_time'] ?? time()),
            'action_source' => 'website',
            'event_source_url' => $eventSourceUrl,
            'user_data' => $this->buildUserData($request, $overrides),
        ];

        $eventId = $this->normalizeIdentifier($this->firstFilled(
            $overrides['event_id'] ?? null,
            $request->input('meta_event_id'),
            $request->input('event_id'),
            $request->input('eventID'),
            Arr::get($request->input('metadata', []), 'meta_event_id'),
        ));

        if ($eventId) {
            $event['event_id'] = $eventId;
        }

        $customData = $this->buildCustomData($request, $overrides);
        if ($customData !== []) {
            $event['custom_data'] = $customData;
        }

        return $event;
    }

    private function buildUserData(Request $request, array $overrides): array
    {
        $fbc = $this->firstFilled($overrides['fbc'] ?? null, $request->input('_fbc'), $request->input('fbc'), $request->cookie('_fbc'));
        if (!$fbc) {
            $fbclid = $this->firstFilled($request->input('fbclid'), Arr::get($request->input('metadata', []), 'fbclid'));
            if ($fbclid) {
                $fbc = 'fb.1.' . ((int) floor(microtime(true) * 1000)) . '.' . $fbclid;
            }
        }

        $userData = array_filter([
            'client_ip_address' => $this->firstFilled($overrides['client_ip_address'] ?? null, $request->ip()),
            'client_user_agent' => $this->firstFilled($overrides['client_user_agent'] ?? null, $request->userAgent()),
            'fbp' => $this->firstFilled($overrides['fbp'] ?? null, $request->input('_fbp'), $request->input('fbp'), $request->cookie('_fbp')),
            'fbc' => $fbc,
        ], fn ($value) => $value !== null && $value !== '');

        $emailHash = $this->hashEmail($this->firstFilled(
            $overrides['email'] ?? null,
            $request->input('email'),
            $request->input('customer_email'),
            Arr::get($request->input('metadata', []), 'email'),
        ));
        if ($emailHash) {
            $userData['em'] = [$emailHash];
        }

        $phoneHash = $this->hashPhone($this->firstFilled(
            $overrides['phone'] ?? null,
            $request->input('phone'),
            $request->input('customer_phone'),
            Arr::get($request->input('metadata', []), 'phone'),
        ));
        if ($phoneHash) {
            $userData['ph'] = [$phoneHash];
        }

        $externalId = $this->hashGeneric($this->firstFilled(
            $overrides['external_id'] ?? null,
            $request->input('visitor_id'),
            Arr::get($request->input('metadata', []), 'visitor_id'),
        ));
        if ($externalId) {
            $userData['external_id'] = [$externalId];
        }

        return $userData;
    }

    private function buildCustomData(Request $request, array $overrides): array
    {
        $metadata = Arr::wrap($request->input('metadata', []));
        $items = $this->normalizeCommerceItems($this->firstFilled(
            $overrides['contents'] ?? null,
            $request->input('contents'),
            Arr::get($metadata, 'contents'),
            Arr::get($metadata, 'items'),
        ));

        $contentIds = $this->normalizeStringArray($this->firstFilled(
            $overrides['content_ids'] ?? null,
            $request->input('content_ids'),
            Arr::get($metadata, 'content_ids'),
            $items !== [] ? array_column($items, 'id') : null,
            $request->input('product_id') ? [(string) $request->input('product_id')] : null,
        ));

        $contentName = $this->firstFilled(
            $overrides['content_name'] ?? null,
            $request->input('content_name'),
            $request->input('product_name'),
            Arr::get($metadata, 'content_name'),
            Arr::get($metadata, 'product_name'),
        );

        $value = $this->numericValue($this->firstFilled(
            $overrides['value'] ?? null,
            $request->input('value'),
            Arr::get($metadata, 'value'),
        ));

        $numItems = $this->positiveInteger($this->firstFilled(
            $overrides['num_items'] ?? null,
            $request->input('num_items'),
            $request->input('quantity'),
            Arr::get($metadata, 'num_items'),
            Arr::get($metadata, 'items_count'),
            $items !== [] ? array_sum(array_column($items, 'quantity')) : null,
        ));

        $customData = [];
        if ($contentIds !== []) {
            $customData['content_ids'] = $contentIds;
        }
        if ($contentName) {
            $customData['content_name'] = Str::limit((string) $contentName, 255, '');
        }

        $contentType = $this->firstFilled($overrides['content_type'] ?? null, $request->input('content_type'), Arr::get($metadata, 'content_type'));
        if ($contentType) {
            $customData['content_type'] = Str::limit((string) $contentType, 80, '');
        }

        if ($items !== []) {
            $customData['contents'] = $items;
        }
        if ($numItems !== null) {
            $customData['num_items'] = $numItems;
        }
        if ($value !== null) {
            $customData['value'] = $value;
        }

        $currency = $this->firstFilled($overrides['currency'] ?? null, $request->input('currency'), Arr::get($metadata, 'currency'), config('meta_conversions.currency', 'VND'));
        if ($currency) {
            $customData['currency'] = Str::upper(Str::limit((string) $currency, 3, ''));
        }

        $orderId = $this->firstFilled($overrides['order_id'] ?? null, $request->input('order_number'), $request->input('order_id'), Arr::get($metadata, 'order_number'));
        if ($orderId) {
            $customData['order_id'] = Str::limit((string) $orderId, 100, '');
        }

        return $customData;
    }

    private function sendEvents(array $events): bool
    {
        $payload = ['data' => array_values($events)];
        $testEventCode = trim((string) config('meta_conversions.test_event_code', ''));
        if ($testEventCode !== '') {
            $payload['test_event_code'] = $testEventCode;
        }

        try {
            $url = sprintf(
                'https://graph.facebook.com/%s/%s/events?access_token=%s',
                trim((string) config('meta_conversions.graph_api_version', 'v25.0'), '/'),
                rawurlencode((string) config('meta_conversions.pixel_id')),
                rawurlencode((string) config('meta_conversions.access_token')),
            );

            $response = Http::asJson()
                ->acceptJson()
                ->timeout((int) config('meta_conversions.timeout', 10))
                ->connectTimeout((int) config('meta_conversions.connect_timeout', 5))
                ->withOptions(['verify' => (bool) config('meta_conversions.verify_ssl', true)])
                ->post($url, $payload);

            Log::info('Meta Conversions API response.', [
                'status' => $response->status(),
                'events' => collect($payload['data'])
                    ->map(fn (array $event) => [
                        'event_name' => $event['event_name'] ?? null,
                        'event_time' => $event['event_time'] ?? null,
                        'action_source' => $event['action_source'] ?? null,
                        'event_id' => $event['event_id'] ?? null,
                        'event_source_url' => $event['event_source_url'] ?? null,
                        'has_client_ip_address' => $this->isFilled(Arr::get($event, 'user_data.client_ip_address')),
                        'has_client_user_agent' => $this->isFilled(Arr::get($event, 'user_data.client_user_agent')),
                    ])
                    ->values()
                    ->all(),
                'has_test_event_code' => isset($payload['test_event_code']),
                'body' => Str::limit($this->sanitizeForLog($response->body()), 1000, '...'),
            ]);

            if ($response->failed()) {
                Log::warning('Meta Conversions API request failed.', [
                    'status' => $response->status(),
                    'events' => collect($payload['data'])->pluck('event_name')->values()->all(),
                    'has_test_event_code' => isset($payload['test_event_code']),
                    'body' => Str::limit($this->sanitizeForLog($response->body()), 1000, '...'),
                ]);

                return false;
            }

            return true;
        } catch (\Throwable $exception) {
            Log::warning('Unable to send Meta Conversions API event.', [
                'message' => $this->sanitizeForLog($exception->getMessage()),
            ]);

            return false;
        }
    }

    private function leadItems(Lead $lead): Collection
    {
        return $lead->items
            ->map(function ($item) {
                $id = $this->firstFilled($item->product_sku, $item->product_id);
                if (!$id) {
                    return null;
                }

                $quantity = max(1, (int) ($item->quantity ?? 1));
                $lineTotal = (float) ($item->line_total ?? 0);
                $unitPrice = (float) ($item->unit_price ?? ($quantity > 0 ? $lineTotal / $quantity : 0));

                return array_filter([
                    'id' => (string) $id,
                    'quantity' => $quantity,
                    'item_price' => $unitPrice > 0 ? $unitPrice : null,
                ], fn ($value) => $value !== null && $value !== '');
            })
            ->filter()
            ->values();
    }

    private function normalizeCommerceItems(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = json_last_error() === JSON_ERROR_NONE ? $decoded : [];
        }

        if (!is_array($value)) {
            return [];
        }

        return collect($value)
            ->map(function ($item) {
                if (!is_array($item)) {
                    return null;
                }

                $id = $this->firstFilled(
                    Arr::get($item, 'id'),
                    Arr::get($item, 'content_id'),
                    Arr::get($item, 'product_sku'),
                    Arr::get($item, 'sku'),
                    Arr::get($item, 'product_id'),
                    Arr::get($item, 'item_id'),
                );

                if (!$id) {
                    return null;
                }

                $quantity = max(1, (int) $this->firstFilled(Arr::get($item, 'quantity'), Arr::get($item, 'qty'), 1));
                $price = $this->numericValue($this->firstFilled(
                    Arr::get($item, 'item_price'),
                    Arr::get($item, 'price'),
                    Arr::get($item, 'unit_price'),
                    Arr::get($item, 'line_total') && $quantity > 0 ? ((float) Arr::get($item, 'line_total') / $quantity) : null,
                ));

                return array_filter([
                    'id' => (string) $id,
                    'quantity' => $quantity,
                    'item_price' => $price,
                ], fn ($entry) => $entry !== null && $entry !== '');
            })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeStringArray(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = json_last_error() === JSON_ERROR_NONE ? $decoded : explode(',', $value);
        }

        return collect(Arr::wrap($value))
            ->flatten()
            ->map(fn ($entry) => trim((string) $entry))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function hashEmail(mixed $value): ?string
    {
        $email = Str::lower(trim((string) $value));
        return filter_var($email, FILTER_VALIDATE_EMAIL) ? hash('sha256', $email) : null;
    }

    private function hashPhone(mixed $value): ?string
    {
        $phone = preg_replace('/\D+/', '', (string) $value) ?: '';
        if ($phone === '') {
            return null;
        }

        if (str_starts_with($phone, '0') && strlen($phone) === 10) {
            $phone = '84' . substr($phone, 1);
        }

        return hash('sha256', $phone);
    }

    private function hashGeneric(mixed $value): ?string
    {
        $normalized = trim((string) $value);
        return $normalized !== '' ? hash('sha256', $normalized) : null;
    }

    private function normalizeUrl(mixed $value): ?string
    {
        $url = trim((string) $value);
        if ($url === '' || !preg_match('/^https?:\/\//i', $url)) {
            return null;
        }

        return Str::limit($url, 2000, '');
    }

    private function normalizeIdentifier(mixed $value): ?string
    {
        $id = trim((string) $value);
        if ($id === '') {
            return null;
        }

        $id = preg_replace('/[^A-Za-z0-9:_-]+/', '_', $id) ?: '';
        return $id !== '' ? Str::limit($id, 255, '') : null;
    }

    private function firstFilled(mixed ...$values): mixed
    {
        foreach ($values as $value) {
            if (is_array($value) && $value !== []) {
                return $value;
            }

            if (!is_array($value) && $value !== null && trim((string) $value) !== '') {
                return $value;
            }
        }

        return null;
    }

    private function numericValue(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        $number = (float) $value;
        return is_finite($number) ? max(0, $number) : null;
    }

    private function positiveInteger(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $number = (int) $value;
        return $number > 0 ? $number : null;
    }

    private function isConfigured(): bool
    {
        return (bool) config('meta_conversions.enabled', true)
            && trim((string) config('meta_conversions.pixel_id')) !== ''
            && trim((string) config('meta_conversions.access_token')) !== '';
    }

    private function logConfigurationIssue(string $eventName): void
    {
        Log::warning('Meta Conversions API is not configured.', [
            'event_name' => $eventName,
            'enabled' => (bool) config('meta_conversions.enabled', true),
            'has_pixel_id' => $this->isFilled(config('meta_conversions.pixel_id')),
            'has_access_token' => $this->isFilled(config('meta_conversions.access_token')),
            'has_test_event_code' => $this->isFilled(config('meta_conversions.test_event_code')),
        ]);
    }

    private function isFilled(mixed $value): bool
    {
        return trim((string) $value) !== '';
    }

    private function sanitizeForLog(mixed $value): string
    {
        $message = (string) $value;
        $accessToken = trim((string) config('meta_conversions.access_token'));

        if ($accessToken !== '') {
            $message = str_replace($accessToken, '[redacted]', $message);
        }

        return preg_replace('/(access_token=)[^&\s"]+/i', '$1[redacted]', $message) ?? $message;
    }
}
