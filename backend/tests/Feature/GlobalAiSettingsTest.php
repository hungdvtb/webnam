<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class GlobalAiSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_ai_settings_saved_from_one_account_are_read_by_every_account(): void
    {
        [$firstAccount, $secondAccount] = $this->authenticateWithTwoAccounts();

        $response = $this
            ->withHeaders($this->headers($firstAccount))
            ->postJson('/api/site-settings', [
                'account_id' => $firstAccount->id,
                'settings' => [
                    'site_name' => 'Gom Su Dai Thanh',
                    'ai_gemini_keys' => [[
                        'id' => 'shared-key-1',
                        'key' => 'AIzaSharedGlobalKeyOne',
                        'note' => 'Key dung chung',
                        'is_active' => true,
                    ]],
                    'ai_gemini_model' => 'gemini-1.5-flash',
                    'ai_gemini_enabled' => true,
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('ai.configured', true)
            ->assertJsonPath('ai.available', true)
            ->assertJsonPath('ai.model', 'gemini-2.5-flash')
            ->assertJsonPath('ai.scope', 'global');

        $secondSettings = $this
            ->withHeaders($this->headers($secondAccount))
            ->getJson('/api/site-settings');

        $secondSettings
            ->assertOk()
            ->assertJsonPath('ai_gemini_has_api_key', true)
            ->assertJsonPath('ai_gemini_available', true)
            ->assertJsonPath('ai_gemini_model', 'gemini-2.5-flash')
            ->assertJsonPath('ai_gemini_enabled', true)
            ->assertJsonPath('ai_gemini_scope', 'global');

        $this->assertSame('shared-key-1', $secondSettings->json('ai_gemini_keys.0.id'));
        $this->assertSame('Key dung chung', $secondSettings->json('ai_gemini_keys.0.note'));
        $this->assertSame('AIza...yOne', $secondSettings->json('ai_gemini_keys.0.key'));

        $this->assertDatabaseHas('site_settings', [
            'account_id' => $firstAccount->id,
            'key' => 'site_name',
            'value' => 'Gom Su Dai Thanh',
        ]);
        $this->assertDatabaseMissing('site_settings', [
            'account_id' => $firstAccount->id,
            'key' => 'ai_gemini_keys',
        ]);
        $this->assertDatabaseHas('system_settings', [
            'key' => 'ai_gemini_model',
            'value' => 'gemini-2.5-flash',
        ]);

        $aiStatus = $this
            ->withHeaders($this->headers($secondAccount))
            ->getJson('/api/ai/status');

        $aiStatus
            ->assertOk()
            ->assertJsonPath('configured', true)
            ->assertJsonPath('available', true)
            ->assertJsonPath('key_source', 'system_setting_batch')
            ->assertJsonPath('scope', 'global');
    }

    public function test_saving_masked_global_ai_keys_preserves_the_real_key(): void
    {
        [$firstAccount, $secondAccount] = $this->authenticateWithTwoAccounts();

        $this
            ->withHeaders($this->headers($firstAccount))
            ->postJson('/api/site-settings', [
                'account_id' => $firstAccount->id,
                'settings' => [
                    'ai_gemini_keys' => [[
                        'id' => 'shared-key-1',
                        'key' => 'AIzaSharedGlobalKeyOne',
                        'note' => 'Key ban dau',
                        'is_active' => true,
                    ]],
                    'ai_gemini_enabled' => true,
                ],
            ])
            ->assertOk();

        $maskedSettings = $this
            ->withHeaders($this->headers($secondAccount))
            ->getJson('/api/site-settings')
            ->assertOk()
            ->json();

        $maskedSettings['ai_gemini_keys'][0]['note'] = 'Sua tu cua hang khac';
        $maskedSettings['ai_gemini_keys'][0]['is_active'] = false;

        $this
            ->withHeaders($this->headers($secondAccount))
            ->postJson('/api/site-settings', [
                'account_id' => $secondAccount->id,
                'settings' => [
                    'ai_gemini_keys' => $maskedSettings['ai_gemini_keys'],
                    'ai_gemini_enabled' => true,
                ],
            ])
            ->assertOk();

        $storedKeys = json_decode(
            (string) DB::table('system_settings')->where('key', 'ai_gemini_keys')->value('value'),
            true
        );

        $this->assertSame('AIzaSharedGlobalKeyOne', $storedKeys[0]['key']);
        $this->assertSame('Sua tu cua hang khac', $storedKeys[0]['note']);
        $this->assertFalse($storedKeys[0]['is_active']);
    }

    private function authenticateWithTwoAccounts(): array
    {
        $firstAccount = Account::query()->create([
            'name' => 'Gom Su Dai Thanh',
            'subdomain' => 'gom-su-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $secondAccount = Account::query()->create([
            'name' => 'Dong Dai Thanh',
            'subdomain' => 'dong-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $user = User::factory()->create(['is_admin' => true]);

        $user->accounts()->attach($firstAccount->id, ['role' => 'owner']);
        $user->accounts()->attach($secondAccount->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$firstAccount, $secondAccount];
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
