<?php

use App\Support\Utf8Sanitizer;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const LEGACY_RULES_SETTING_KEY = 'order_ai_altar_rules';

    public function up(): void
    {
        $this->normalizeDatasets();
        $this->normalizeDatasetItems();
        $this->normalizeLegacySiteSetting();
    }

    public function down(): void
    {
        // Data normalization migration: nothing to roll back safely.
    }

    private function normalizeDatasets(): void
    {
        if (!Schema::hasTable('order_ai_training_datasets')) {
            return;
        }

        DB::table('order_ai_training_datasets')
            ->orderBy('id')
            ->chunkById(50, function ($rows) {
                foreach ($rows as $row) {
                    $update = [];

                    $this->syncString($update, 'rule_key', $row->rule_key ?? null);
                    $this->syncString($update, 'altar_size_label', $row->altar_size_label ?? null);
                    $this->syncJson($update, 'altar_size_aliases', $row->altar_size_aliases ?? null, []);
                    $this->syncJson($update, 'context_aliases', $row->context_aliases ?? null, []);
                    $this->syncString($update, 'source_name', $row->source_name ?? null);
                    $this->syncString($update, 'training_note', $row->training_note ?? null);
                    $this->syncString($update, 'input_text', $row->input_text ?? null);
                    $this->syncJson($update, 'parsed_result', $row->parsed_result ?? null, null);
                    $this->syncString($update, 'parsed_raw_text', $row->parsed_raw_text ?? null);
                    $this->syncString($update, 'parsed_provider', $row->parsed_provider ?? null);

                    if ($update !== []) {
                        DB::table('order_ai_training_datasets')
                            ->where('id', $row->id)
                            ->update($update);
                    }
                }
            });
    }

    private function normalizeDatasetItems(): void
    {
        if (!Schema::hasTable('order_ai_training_dataset_items')) {
            return;
        }

        DB::table('order_ai_training_dataset_items')
            ->orderBy('id')
            ->chunkById(100, function ($rows) {
                foreach ($rows as $row) {
                    $update = [];

                    $this->syncJson($update, 'aliases', $row->aliases ?? null, []);
                    $this->syncString($update, 'display_name', $row->display_name ?? null);
                    $this->syncString($update, 'display_sku', $row->display_sku ?? null);
                    $this->syncString($update, 'option_label', $row->option_label ?? null);
                    $this->syncString($update, 'main_image', $row->main_image ?? null);

                    if ($update !== []) {
                        DB::table('order_ai_training_dataset_items')
                            ->where('id', $row->id)
                            ->update($update);
                    }
                }
            });
    }

    private function normalizeLegacySiteSetting(): void
    {
        if (!Schema::hasTable('site_settings')) {
            return;
        }

        DB::table('site_settings')
            ->where('key', self::LEGACY_RULES_SETTING_KEY)
            ->orderBy('id')
            ->chunkById(50, function ($rows) {
                foreach ($rows as $row) {
                    $decoded = $this->decodeJson($row->value ?? null, []);
                    $normalized = Utf8Sanitizer::normalize($decoded);
                    $encoded = $this->encodeJson($normalized, []);

                    if ($encoded !== (string) ($row->value ?? '')) {
                        DB::table('site_settings')
                            ->where('id', $row->id)
                            ->update(['value' => $encoded]);
                    }
                }
            });
    }

    private function syncString(array &$update, string $column, mixed $value): void
    {
        $original = $value === null ? null : (string) $value;
        $normalized = $value === null ? null : Utf8Sanitizer::normalizeString((string) $value);

        if ($normalized !== $original) {
            $update[$column] = $normalized;
        }
    }

    private function syncJson(array &$update, string $column, mixed $value, mixed $default): void
    {
        $decoded = $this->decodeJson($value, $default);
        $encoded = $this->encodeJson(Utf8Sanitizer::normalize($decoded), $default);

        if ($encoded !== (string) ($value ?? '')) {
            $update[$column] = $encoded;
        }
    }

    private function decodeJson(mixed $value, mixed $default): mixed
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                return $decoded;
            }
        }

        return $default;
    }

    private function encodeJson(mixed $value, mixed $default): string
    {
        $payload = $value ?? $default;

        return (string) (json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: json_encode($default));
    }
};
