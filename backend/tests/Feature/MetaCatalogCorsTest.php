<?php

namespace Tests\Feature;

use Tests\TestCase;

class MetaCatalogCorsTest extends TestCase
{
    public function test_meta_catalog_preflight_allows_admin_origin_with_credentials(): void
    {
        $origin = 'https://admin.gomdaithanh.com';

        foreach ([
            ['POST', '/api/meta-catalog/dry-run'],
            ['POST', '/api/meta-catalog/sync'],
            ['GET', '/api/meta-catalog/settings'],
            ['POST', '/api/meta-catalog/feed-check'],
        ] as [$method, $path]) {
            $response = $this->withHeaders([
                'Origin' => $origin,
                'Access-Control-Request-Method' => $method,
                'Access-Control-Request-Headers' => 'authorization,content-type,x-account-id,x-site-code,x-xsrf-token',
            ])->options($path);

            $response->assertNoContent();
            $this->assertSame($origin, $response->headers->get('Access-Control-Allow-Origin'), $path);
            $this->assertSame('true', $response->headers->get('Access-Control-Allow-Credentials'), $path);
            $this->assertStringContainsString($method, (string) $response->headers->get('Access-Control-Allow-Methods'), $path);
        }
    }

    public function test_meta_catalog_auth_response_keeps_cors_headers_for_admin_origin(): void
    {
        $origin = 'https://admin.gomdaithanh.com';

        $response = $this->withHeaders([
            'Origin' => $origin,
            'Accept' => 'application/json',
        ])->postJson('/api/meta-catalog/dry-run', [
            'check_remote_urls' => false,
        ]);

        $response->assertUnauthorized();
        $this->assertSame($origin, $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertSame('true', $response->headers->get('Access-Control-Allow-Credentials'));
    }

    public function test_meta_catalog_cors_and_session_config_include_production_domains(): void
    {
        $this->assertContains('https://admin.gomdaithanh.com', config('cors.allowed_origins'));
        $this->assertContains('https://gomdaithanh.com', config('cors.allowed_origins'));
        $this->assertContains('https://www.gomdaithanh.com', config('cors.allowed_origins'));
        $this->assertSame(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], config('cors.allowed_methods'));
        $this->assertSame(['*'], config('cors.allowed_headers'));
        $this->assertTrue((bool) config('cors.supports_credentials'));
        $this->assertContains('admin.gomdaithanh.com', config('sanctum.stateful'));
        $this->assertContains('gomdaithanh.com', config('sanctum.stateful'));
        $this->assertContains('www.gomdaithanh.com', config('sanctum.stateful'));
    }
}
