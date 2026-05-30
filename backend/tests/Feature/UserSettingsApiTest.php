<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserSetting;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserSettingsApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_bootstraps_an_empty_settings_document_for_the_authenticated_user(): void
    {
        $user = $this->authenticate();

        $response = $this->getJson('/api/user-settings')->assertOk();

        $response->assertJson([
            'localStorage' => [],
            'sessionStorage' => [],
        ]);

        $this->assertDatabaseHas('user_settings', [
            'user_id' => $user->id,
        ]);
    }

    public function test_it_merges_incremental_storage_changes_without_losing_existing_settings(): void
    {
        $user = $this->authenticate();

        UserSetting::query()->create([
            'user_id' => $user->id,
            'settings' => [
                'localStorage' => [
                    'activeAccountId' => '12',
                    'product_list_sort' => '{"key":"created_at","direction":"desc"}',
                ],
                'sessionStorage' => [],
            ],
        ]);

        $response = $this->patchJson('/api/user-settings', [
            'localStorage' => [
                'product_list_sort' => '{"key":"price","direction":"asc"}',
                'shipment_list_filters_v2' => '{"search":"abc"}',
            ],
            'sessionStorage' => [
                'lead_list_view_state_v1' => '{"page":2}',
            ],
        ])->assertOk();

        $response->assertJsonPath('localStorage.activeAccountId', '12');
        $response->assertJsonPath('localStorage.product_list_sort', '{"key":"price","direction":"asc"}');
        $response->assertJsonPath('localStorage.shipment_list_filters_v2', '{"search":"abc"}');
        $response->assertJsonPath('sessionStorage.lead_list_view_state_v1', '{"page":2}');
    }

    public function test_it_can_remove_specific_keys_and_reject_reserved_auth_keys(): void
    {
        $user = $this->authenticate();

        UserSetting::query()->create([
            'user_id' => $user->id,
            'settings' => [
                'localStorage' => [
                    'activeAccountId' => '99',
                    'token' => 'should-not-survive',
                ],
                'sessionStorage' => [],
            ],
        ]);

        $response = $this->patchJson('/api/user-settings', [
            'localStorage' => [
                'activeAccountId' => null,
                'token' => 'secret',
                'user' => '{"id":1}',
            ],
        ])->assertOk();

        $response->assertJsonMissingPath('localStorage.activeAccountId');
        $response->assertJsonMissingPath('localStorage.token');
        $response->assertJsonMissingPath('localStorage.user');
    }

    public function test_settings_are_isolated_per_user_account(): void
    {
        $firstUser = $this->authenticate();

        $this->patchJson('/api/user-settings', [
            'localStorage' => [
                'activeAccountId' => '321',
            ],
        ])->assertOk();

        $secondUser = User::query()->create([
            'name' => 'Settings User 2',
            'email' => 'settings-' . Str::lower(Str::random(8)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        Sanctum::actingAs($secondUser, ['*']);

        $this->getJson('/api/user-settings')
            ->assertOk()
            ->assertJson([
                'localStorage' => [],
                'sessionStorage' => [],
            ]);

        Sanctum::actingAs($firstUser, ['*']);

        $this->getJson('/api/user-settings')
            ->assertOk()
            ->assertJsonPath('localStorage.activeAccountId', '321');
    }

    public function test_it_persists_order_form_product_quick_filter_settings(): void
    {
        $user = $this->authenticate();
        $filterKey = 'order_form_product_quick_filter_state_v1::' . $user->id . '::12::gom::order-form';
        $filterPayload = json_encode([
            'attributeId' => '8',
            'values' => ['Men lam'],
            'attributeId2' => '12',
            'values2' => ['Size M'],
            'quickModeEnabled' => true,
        ], JSON_UNESCAPED_UNICODE);
        $setupPayload = json_encode([
            $user->id . '::12::gom::order-form' => [
                '8::men lam|12::size m' => [
                    ['product_id' => 123, 'sku' => 'SP-123', 'name' => 'San pham test'],
                ],
            ],
        ], JSON_UNESCAPED_UNICODE);

        $this->patchJson('/api/user-settings', [
            'localStorage' => [
                $filterKey => $filterPayload,
                'order_form_product_quick_setup_map_v1' => $setupPayload,
            ],
        ])->assertOk();

        $this->getJson('/api/user-settings')
            ->assertOk()
            ->assertJsonPath('localStorage.' . $filterKey, $filterPayload)
            ->assertJsonPath('localStorage.order_form_product_quick_setup_map_v1', $setupPayload);

        $this->patchJson('/api/user-settings', [
            'localStorage' => [
                $filterKey => null,
            ],
        ])->assertOk();

        $this->getJson('/api/user-settings')
            ->assertOk()
            ->assertJsonMissingPath('localStorage.' . $filterKey);
    }

    protected function authenticate(): User
    {
        $user = User::query()->create([
            'name' => 'Settings Tester',
            'email' => 'settings-' . Str::lower(Str::random(8)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }
}
