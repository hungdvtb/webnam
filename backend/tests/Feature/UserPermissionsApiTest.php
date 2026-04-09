<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserPermissionsApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_persists_permissions_when_creating_a_user(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->postJson('/api/users', [
            'name' => 'Inventory Staff',
            'email' => 'inventory.staff@example.com',
            'password' => 'secret123',
            'status' => 1,
            'permissions' => ['products', 'inventory'],
        ])->assertCreated();

        $createdUser = User::query()->findOrFail($response->json('id'));

        $this->assertSame(1, $createdUser->status);
        $this->assertSame(['products', 'inventory'], $createdUser->permissions);
        $response->assertJsonPath('permissions.0', 'products');
        $response->assertJsonPath('permissions.1', 'inventory');
    }

    public function test_it_returns_authenticated_user_permissions_as_an_array(): void
    {
        $user = User::factory()->create([
            'is_admin' => false,
            'status' => 1,
            'permissions' => ['products'],
        ]);

        Sanctum::actingAs($user, ['*']);

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('permissions.0', 'products')
            ->assertJsonPath('is_admin', false);
    }
}
