<?php

namespace Tests\Unit;

use App\Models\Lead;
use App\Models\LeadItem;
use App\Services\Analytics\MetaConversionsApiService;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MetaConversionsApiServiceTest extends TestCase
{
    public function test_it_sends_purchase_with_deduplication_and_hashed_customer_data(): void
    {
        config([
            'meta_conversions.enabled' => true,
            'meta_conversions.pixel_id' => '2786270608428787',
            'meta_conversions.access_token' => 'test-token',
            'meta_conversions.graph_api_version' => 'v25.0',
            'meta_conversions.verify_ssl' => false,
        ]);

        Http::fake([
            'graph.facebook.com/*' => Http::response(['events_received' => 1], 200),
        ]);

        $request = Request::create('/api/storefront/order', 'POST', [
            'meta_event_id' => 'webgom_Purchase_checkout-token',
            'current_url' => 'https://gomdaithanh.com/cart',
            '_fbp' => 'fb.1.1710000000000.1234567890',
            '_fbc' => 'fb.1.1710000000000.fbclid-test',
        ], [], [], [
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTP_USER_AGENT' => 'Meta CAPI Test UA',
        ]);

        $lead = new Lead([
            'lead_number' => 'LD10001A0',
            'email' => 'Buyer@Example.COM ',
            'phone' => '0987654321',
            'total_amount' => 1500000,
            'link_url' => 'https://gomdaithanh.com/cart',
        ]);
        $lead->setRelation('items', collect([
            new LeadItem([
                'product_id' => 123,
                'product_sku' => 'GDT-123',
                'quantity' => 2,
                'unit_price' => 750000,
                'line_total' => 1500000,
            ]),
        ]));

        $sent = app(MetaConversionsApiService::class)->sendPurchaseFromLead($request, $lead);

        $this->assertTrue($sent);
        Http::assertSent(function (HttpRequest $request): bool {
            $payload = json_decode($request->body(), true);
            $event = $payload['data'][0] ?? [];
            $userData = $event['user_data'] ?? [];
            $customData = $event['custom_data'] ?? [];

            return str_contains($request->url(), '/v25.0/2786270608428787/events')
                && str_contains($request->url(), 'access_token=test-token')
                && $event['event_name'] === 'Purchase'
                && $event['event_id'] === 'webgom_Purchase_checkout-token'
                && $event['event_source_url'] === 'https://gomdaithanh.com/cart'
                && ($userData['client_ip_address'] ?? '') !== ''
                && $userData['client_user_agent'] === 'Meta CAPI Test UA'
                && $userData['fbp'] === 'fb.1.1710000000000.1234567890'
                && $userData['fbc'] === 'fb.1.1710000000000.fbclid-test'
                && $userData['em'] === [hash('sha256', 'buyer@example.com')]
                && $userData['ph'] === [hash('sha256', '84987654321')]
                && $customData['currency'] === 'VND'
                && (float) $customData['value'] === 1500000.0
                && $customData['content_ids'] === ['GDT-123']
                && $customData['contents'][0]['id'] === 'GDT-123';
        });
    }
}
