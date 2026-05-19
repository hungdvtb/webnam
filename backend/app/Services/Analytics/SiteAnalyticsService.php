<?php

namespace App\Services\Analytics;

use App\Models\Account;
use App\Models\Lead;
use App\Models\SiteAnalyticsEvent;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class SiteAnalyticsService
{
    private static ?bool $eventsTableExists = null;

    public function recordFromRequest(Request $request, string $eventName, array $overrides = []): ?SiteAnalyticsEvent
    {
        if (!$this->canRecordEvents()) {
            return null;
        }

        $eventName = $this->normalizeEventName($eventName);
        if ($eventName === '') {
            return null;
        }

        try {
            $occurredAt = now();
            $metadata = array_filter([
                'site_code' => $this->truncate($request->input('site_code') ?: $request->header('X-Site-Code'), 80),
                'title' => $this->truncate($request->input('title'), 255),
                'product_name' => $this->truncate($request->input('product_name'), 255),
                'product_sku' => $this->truncate($request->input('product_sku'), 120),
                'product_slug' => $this->truncate($request->input('product_slug'), 255),
                'source' => $this->truncate($request->input('source'), 80),
                'source_label' => $this->truncate($request->input('source_label'), 80),
                'utm_source' => $this->truncate($request->input('utm_source'), 255),
                'utm_medium' => $this->truncate($request->input('utm_medium'), 255),
                'utm_campaign' => $this->truncate($request->input('utm_campaign'), 255),
                'utm_content' => $this->truncate($request->input('utm_content'), 255),
                'utm_term' => $this->truncate($request->input('utm_term'), 255),
                'fbclid' => $this->truncate($request->input('fbclid'), 255),
                'gclid' => $this->truncate($request->input('gclid'), 255),
                'ttclid' => $this->truncate($request->input('ttclid'), 255),
                'raw_query' => $this->truncate($request->input('raw_query'), 2000),
            ], fn ($value) => $value !== null && $value !== '');

            $metadata = array_replace($metadata, Arr::wrap($request->input('metadata', [])), Arr::wrap($overrides['metadata'] ?? []));

            return SiteAnalyticsEvent::create([
                'account_id' => $overrides['account_id'] ?? $this->resolveAccountId($request),
                'event_name' => $eventName,
                'event_date' => $occurredAt->toDateString(),
                'occurred_at' => $occurredAt,
                'product_id' => $this->positiveInteger($overrides['product_id'] ?? $request->input('product_id')),
                'lead_id' => $this->positiveInteger($overrides['lead_id'] ?? $request->input('lead_id')),
                'order_id' => $this->positiveInteger($overrides['order_id'] ?? $request->input('order_id')),
                'visitor_id' => $this->normalizeIdentifier($overrides['visitor_id'] ?? $request->input('visitor_id')),
                'session_id' => $this->normalizeIdentifier($overrides['session_id'] ?? $request->input('session_id')),
                'ip_hash' => $this->hashIp($request),
                'quantity' => max(0, (int) ($overrides['quantity'] ?? $request->input('quantity', 0))),
                'value' => $this->decimalValue($overrides['value'] ?? $request->input('value')),
                'path' => $this->truncate($overrides['path'] ?? $request->input('path') ?: $this->pathFromUrl($request->input('current_url') ?: $request->input('url')), 2000),
                'url' => $this->truncate($overrides['url'] ?? $request->input('current_url') ?: $request->input('url'), 2000),
                'referrer' => $this->truncate($overrides['referrer'] ?? $request->input('referrer') ?: $request->headers->get('referer'), 2000),
                'user_agent' => $this->truncate($request->userAgent(), 2000),
                'metadata' => $metadata ?: null,
            ]);
        } catch (\Throwable $exception) {
            Log::warning('Unable to record site analytics event.', [
                'event_name' => $eventName,
                'message' => $exception->getMessage(),
            ]);

            return null;
        }
    }

    public function recordOrderPlaced(Request $request, Lead $lead): ?SiteAnalyticsEvent
    {
        $lead->loadMissing('items');
        $items = $lead->items
            ->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'product_sku' => $item->product_sku,
                'product_slug' => $item->product_slug,
                'quantity' => (int) $item->quantity,
                'line_total' => (float) $item->line_total,
            ])
            ->values()
            ->all();

        return $this->recordFromRequest($request, SiteAnalyticsEvent::EVENT_ORDER_PLACED, [
            'account_id' => $lead->account_id,
            'lead_id' => $lead->id,
            'product_id' => $lead->product_id,
            'quantity' => (int) $lead->items->sum('quantity'),
            'value' => (float) $lead->total_amount,
            'metadata' => [
                'lead_number' => $lead->lead_number,
                'discount_amount' => (float) $lead->discount_amount,
                'items' => $items,
            ],
        ]);
    }

    private function canRecordEvents(): bool
    {
        if (self::$eventsTableExists !== null) {
            return self::$eventsTableExists;
        }

        try {
            self::$eventsTableExists = Schema::hasTable('site_analytics_events');
        } catch (\Throwable) {
            self::$eventsTableExists = false;
        }

        return self::$eventsTableExists;
    }

    private function resolveAccountId(Request $request): ?int
    {
        $headerAccountId = $request->header('X-Account-Id');
        if (is_numeric($headerAccountId) && (int) $headerAccountId > 0) {
            return (int) $headerAccountId;
        }

        $siteCode = trim((string) ($request->input('site_code') ?: $request->header('X-Site-Code')));
        if ($siteCode !== '') {
            $accountId = Account::query()->where('site_code', $siteCode)->value('id');
            if ($accountId) {
                return (int) $accountId;
            }
        }

        return null;
    }

    private function normalizeEventName(?string $value): string
    {
        $normalized = Str::of((string) $value)
            ->lower()
            ->replaceMatches('/[^a-z0-9_:-]+/', '_')
            ->trim('_')
            ->value();

        return Str::limit($normalized, 50, '');
    }

    private function normalizeIdentifier($value): ?string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        $normalized = preg_replace('/[^A-Za-z0-9:_-]/', '', $normalized) ?: '';
        return $normalized !== '' ? Str::limit($normalized, 100, '') : null;
    }

    private function positiveInteger($value): ?int
    {
        $normalized = (int) $value;
        return $normalized > 0 ? $normalized : null;
    }

    private function decimalValue($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        $normalized = (float) $value;
        return is_finite($normalized) ? $normalized : null;
    }

    private function truncate($value, int $length): ?string
    {
        $normalized = trim((string) $value);
        if ($normalized === '') {
            return null;
        }

        return Str::limit($normalized, $length, '');
    }

    private function pathFromUrl(?string $url): ?string
    {
        $normalized = trim((string) $url);
        if ($normalized === '') {
            return null;
        }

        $path = parse_url($normalized, PHP_URL_PATH);
        return is_string($path) && $path !== '' ? $path : null;
    }

    private function hashIp(Request $request): ?string
    {
        $ip = trim((string) $request->ip());
        if ($ip === '') {
            return null;
        }

        return hash('sha256', $ip . '|' . (string) config('app.key'));
    }
}
