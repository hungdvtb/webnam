<?php

use App\Services\AI\GeminiService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('system_settings')) {
            Schema::create('system_settings', function (Blueprint $table) {
                $table->id();
                $table->string('key')->unique();
                $table->text('value')->nullable();
                $table->timestamps();
            });
        }

        $this->backfillAiSettings();
        $this->backfillLegacyAccountApiKey();
    }

    public function down(): void
    {
        Schema::dropIfExists('system_settings');
    }

    private function backfillAiSettings(): void
    {
        if (!Schema::hasTable('site_settings')) {
            return;
        }

        foreach ($this->aiSettingKeys() as $key) {
            $row = DB::table('site_settings')
                ->where('key', $key)
                ->whereNotNull('value')
                ->where('value', '!=', '')
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->first();

            if (!$row) {
                continue;
            }

            DB::table('system_settings')->updateOrInsert(
                ['key' => $key],
                [
                    'value' => $row->value,
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }
    }

    private function backfillLegacyAccountApiKey(): void
    {
        if (
            !Schema::hasTable('accounts')
            || !Schema::hasColumn('accounts', 'ai_api_key')
            || DB::table('system_settings')->where('key', GeminiService::SETTING_API_KEY)->exists()
        ) {
            return;
        }

        $apiKey = DB::table('accounts')
            ->whereNotNull('ai_api_key')
            ->where('ai_api_key', '!=', '')
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->value('ai_api_key');

        if (!$apiKey) {
            return;
        }

        DB::table('system_settings')->insert([
            'key' => GeminiService::SETTING_API_KEY,
            'value' => $apiKey,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function aiSettingKeys(): array
    {
        return [
            GeminiService::SETTING_API_KEY,
            GeminiService::SETTING_KEYS,
            GeminiService::SETTING_MODEL,
            GeminiService::SETTING_ENABLED,
        ];
    }
};
