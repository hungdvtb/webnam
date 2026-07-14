<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use App\Services\AccessControlService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
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

    public function test_user_update_permission_cannot_change_password_through_password_endpoint(): void
    {
        $operator = User::factory()->create(['is_admin' => false, 'status' => 1]);
        $target = User::factory()->create(['password' => Hash::make('old-secret')]);
        $this->attachAccountPermissions($operator, ['users.update']);

        Sanctum::actingAs($operator, ['*']);

        $this->putJson("/api/users/{$target->id}/password", [
            'password' => 'new-secret',
            'password_confirmation' => 'new-secret',
        ])
            ->assertForbidden()
            ->assertJsonPath('required_permission', AccessControlService::USER_CHANGE_PASSWORD_PERMISSION);

        $this->assertTrue(Hash::check('old-secret', $target->refresh()->password));
    }

    public function test_user_update_permission_cannot_change_password_through_general_update_endpoint(): void
    {
        $operator = User::factory()->create(['is_admin' => false, 'status' => 1]);
        $target = User::factory()->create([
            'name' => 'Target User',
            'email' => 'target@example.com',
            'password' => Hash::make('old-secret'),
        ]);
        $this->attachAccountPermissions($operator, ['users.update']);

        Sanctum::actingAs($operator, ['*']);

        $this->putJson("/api/users/{$target->id}", [
            'name' => $target->name,
            'email' => $target->email,
            'password' => 'new-secret',
            'status' => 1,
        ])
            ->assertForbidden()
            ->assertJsonPath('required_permission', AccessControlService::USER_CHANGE_PASSWORD_PERMISSION);

        $this->assertTrue(Hash::check('old-secret', $target->refresh()->password));
    }

    public function test_change_password_permission_can_change_password(): void
    {
        $operator = User::factory()->create(['is_admin' => false, 'status' => 1]);
        $target = User::factory()->create(['password' => Hash::make('old-secret')]);
        $this->attachAccountPermissions($operator, [AccessControlService::USER_CHANGE_PASSWORD_PERMISSION]);

        Sanctum::actingAs($operator, ['*']);

        $this->putJson("/api/users/{$target->id}/password", [
            'password' => 'new-secret',
            'password_confirmation' => 'new-secret',
        ])->assertOk();

        $this->assertTrue(Hash::check('new-secret', $target->refresh()->password));
    }

    public function test_non_super_admin_cannot_change_super_admin_password(): void
    {
        $operator = User::factory()->create(['is_admin' => false, 'status' => 1]);
        $target = User::factory()->create([
            'is_admin' => true,
            'password' => Hash::make('old-secret'),
        ]);
        $this->attachAccountPermissions($operator, [
            'users.update',
            AccessControlService::USER_CHANGE_PASSWORD_PERMISSION,
        ]);

        Sanctum::actingAs($operator, ['*']);

        $this->putJson("/api/users/{$target->id}", [
            'name' => $target->name,
            'email' => $target->email,
            'password' => 'new-secret',
            'status' => 1,
        ])->assertForbidden();

        $this->assertTrue(Hash::check('old-secret', $target->refresh()->password));
    }

    private function attachAccountPermissions(User $user, array $permissions): Account
    {
        $account = Account::query()->create([
            'name' => 'Test Account ' . uniqid(),
            'domain' => uniqid('account-', true) . '.test',
            'status' => true,
        ]);

        $user->accounts()->attach($account->id, [
            'role' => 'custom',
            'status' => 1,
            'permissions' => json_encode($permissions),
            'data_permissions' => json_encode([]),
        ]);

        return $account;
    }
}
