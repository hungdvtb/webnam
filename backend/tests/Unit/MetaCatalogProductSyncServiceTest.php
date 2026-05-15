<?php

namespace Tests\Unit;

use App\Services\MetaCatalog\MetaCatalogProductSyncService;
use Tests\TestCase;

class MetaCatalogProductSyncServiceTest extends TestCase
{
    public function test_it_maps_feed_entries_to_meta_catalog_batch_requests(): void
    {
        config([
            'meta_catalog.brand' => 'Gốm Đại Thành',
            'meta_catalog.currency' => 'VND',
        ]);

        $requests = app(MetaCatalogProductSyncService::class)->buildUpsertRequests([
            [
                'id' => 'GDT-001',
                'title' => 'Bo do tho men lam',
                'description' => 'Mo ta san pham',
                'availability' => 'out of stock',
                'condition' => 'used',
                'price' => '1500000 VND',
                'link' => 'https://gomdaithanh.com/product/bo-do-tho-men-lam',
                'image_link' => 'https://cdn.gomdaithanh.com/gdt-001.jpg',
                'brand' => 'Other brand',
                'product_type' => 'Bo do tho',
                'custom_label_0' => 'Bo do tho',
            ],
        ], ['GDT-001']);

        $this->assertCount(1, $requests);
        $this->assertSame('UPDATE', $requests[0]['method']);
        $this->assertSame('GDT-001', $requests[0]['retailer_id']);
        $this->assertSame('Bo do tho men lam', $requests[0]['data']['name']);
        $this->assertSame('Mo ta san pham', $requests[0]['data']['description']);
        $this->assertSame('in stock', $requests[0]['data']['availability']);
        $this->assertSame('new', $requests[0]['data']['condition']);
        $this->assertSame('150000000', $requests[0]['data']['price']);
        $this->assertSame('VND', $requests[0]['data']['currency']);
        $this->assertSame('https://gomdaithanh.com/product/bo-do-tho-men-lam', $requests[0]['data']['url']);
        $this->assertSame('https://cdn.gomdaithanh.com/gdt-001.jpg', $requests[0]['data']['image_url']);
        $this->assertSame('Gốm Đại Thành', $requests[0]['data']['brand']);
        $this->assertSame('Bo do tho', $requests[0]['data']['product_type']);
        $this->assertSame('Bo do tho', $requests[0]['data']['custom_label_0']);
        $this->assertArrayNotHasKey('stock_quantity', $requests[0]['data']);
        $this->assertArrayNotHasKey('inventory', $requests[0]['data']);
    }

    public function test_it_builds_delete_requests_for_catalog_items_missing_from_the_feed(): void
    {
        $requests = app(MetaCatalogProductSyncService::class)
            ->buildDeleteRequests(['GDT-001', 'OLD-001', ''], ['GDT-001']);

        $this->assertSame([
            [
                'method' => 'DELETE',
                'retailer_id' => 'OLD-001',
            ],
        ], $requests);
    }
}
