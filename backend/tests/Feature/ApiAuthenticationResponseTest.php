<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiAuthenticationResponseTest extends TestCase
{
    public function test_protected_api_route_returns_json_401_without_named_login_route(): void
    {
        $response = $this->withHeaders([
            'Accept' => 'text/html,application/xhtml+xml',
        ])->post('/api/orders', []);

        $response
            ->assertUnauthorized()
            ->assertJson([
                'message' => 'Unauthenticated.',
            ]);
    }
}
