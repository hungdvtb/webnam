<?php

namespace App\Services\Orders;

use App\Models\OrderAiTrainingDataset;
use App\Models\OrderAiTrainingDatasetItem;
use App\Models\SiteSetting;
use App\Support\Utf8Sanitizer;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrderAiTrainingService
{
    private const IMAGE_DISK = 'public';
    private const IMAGE_DIRECTORY = 'order-ai-training';
    private const MAX_DATASETS = 24;
    private const MAX_ITEMS_PER_DATASET = 40;

    public function listDatasets(int $accountId, array $filters = []): LengthAwarePaginator
    {
        $this->migrateLegacyRulesIfNeeded($accountId);

        $search = trim((string) ($filters['search'] ?? ''));
        $altarSize = trim((string) ($filters['altar_size'] ?? ''));
        $inputType = trim((string) ($filters['input_type'] ?? ''));
        $perPage = min(100, max(1, (int) ($filters['per_page'] ?? 20)));

        $query = OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->with(['items' => fn ($relation) => $relation->orderBy('sort_order')->orderBy('id')])
            ->orderByDesc('updated_at')
            ->orderByDesc('id');

        if ($search !== '') {
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('rule_key', 'like', '%' . $search . '%')
                    ->orWhere('altar_size_label', 'like', '%' . $search . '%')
                    ->orWhere('source_name', 'like', '%' . $search . '%')
                    ->orWhere('input_text', 'like', '%' . $search . '%')
                    ->orWhere('parsed_raw_text', 'like', '%' . $search . '%')
                    ->orWhere('training_note', 'like', '%' . $search . '%');
            });
        }

        if ($altarSize !== '') {
            $query->where('altar_size_label', 'like', '%' . $altarSize . '%');
        }

        if (in_array($inputType, ['text', 'image'], true)) {
            $query->where('input_type', $inputType);
        }

        $paginator = $query->paginate($perPage);
        $paginator->setCollection(
            $paginator->getCollection()->map(fn (OrderAiTrainingDataset $dataset) => $this->serializeDataset($dataset, false))
        );

        return $paginator;
    }

    public function getDatasetPayload(int $accountId, int $datasetId): array
    {
        $this->migrateLegacyRulesIfNeeded($accountId);

        $dataset = OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->with(['items' => fn ($relation) => $relation->orderBy('sort_order')->orderBy('id')])
            ->findOrFail($datasetId);

        return $this->serializeDataset($dataset, true);
    }

    public function upsertDataset(int $accountId, array $payload, ?UploadedFile $attachment = null, ?int $datasetId = null): array
    {
        $this->migrateLegacyRulesIfNeeded($accountId);
        $payload = Utf8Sanitizer::normalize($payload);

        return DB::transaction(function () use ($accountId, $payload, $attachment, $datasetId) {
            $existingRecord = $datasetId
                ? OrderAiTrainingDataset::query()->where('account_id', $accountId)->findOrFail($datasetId)
                : null;

            $normalizedRuleKey = $this->normalizeRuleKey(
                $payload['rule_key'] ?? '',
                $payload['altar_size_label'] ?? '',
                $payload['context_aliases'] ?? []
            );

            $conflictRecord = OrderAiTrainingDataset::query()
                ->where('account_id', $accountId)
                ->where('rule_key', $normalizedRuleKey)
                ->when($existingRecord !== null, fn ($query) => $query->where('id', '!=', $existingRecord->id))
                ->first();

            $targetRecord = $conflictRecord ?: $existingRecord ?: new OrderAiTrainingDataset();
            $recordToDelete = ($existingRecord !== null && $conflictRecord !== null && $existingRecord->id !== $conflictRecord->id)
                ? $existingRecord
                : null;

            [$imagePath, $sourceName, $imageMime] = $this->storeDatasetImage(
                $accountId,
                $attachment,
                $targetRecord->exists ? $targetRecord : null,
                $payload['source_name'] ?? null
            );

            if ($this->normalizeInputType($payload['input_type'] ?? 'text') === 'image' && $imagePath === '') {
                throw ValidationException::withMessages([
                    'attachment' => "C\u{1ea7}n t\u{1ea3}i \u{1ea3}nh cho d\u{1eef} li\u{1ec7}u train lo\u{1ea1}i image.",
                ]);
            }

            $targetRecord->fill([
                'account_id' => $accountId,
                'rule_key' => $normalizedRuleKey,
                'altar_size_label' => Utf8Sanitizer::normalizeString(trim((string) ($payload['altar_size_label'] ?? ''))),
                'altar_size_aliases' => $this->normalizeAliasList($payload['altar_size_aliases'] ?? [], 12),
                'context_aliases' => $this->normalizeAliasList($payload['context_aliases'] ?? [], 16),
                'input_type' => $this->normalizeInputType($payload['input_type'] ?? 'text'),
                'source_name' => Utf8Sanitizer::normalizeString($sourceName),
                'training_note' => Utf8Sanitizer::normalizeString(trim((string) ($payload['training_note'] ?? ''))),
                'input_text' => Utf8Sanitizer::normalizeString(trim((string) ($payload['input_text'] ?? ''))),
                'input_image_path' => $imagePath,
                'input_image_mime' => $imageMime,
                'parsed_result' => is_array($payload['parsed_result'] ?? null) ? Utf8Sanitizer::normalize($payload['parsed_result']) : null,
                'parsed_raw_text' => Utf8Sanitizer::normalizeString(trim((string) ($payload['parsed_raw_text'] ?? ''))),
                'parsed_provider' => Utf8Sanitizer::normalizeString(trim((string) ($payload['parsed_provider'] ?? ''))),
                'trained_at' => $this->resolveTrainedAt($payload['trained_at'] ?? null),
            ]);
            $targetRecord->account_id = $accountId;
            $targetRecord->save();

            $this->syncDatasetItems($targetRecord, $payload['mapping_items'] ?? []);

            if ($recordToDelete !== null) {
                $this->deleteDatasetModel($recordToDelete);
            }

            $targetRecord->load(['items' => fn ($relation) => $relation->orderBy('sort_order')->orderBy('id')]);

            return $this->serializeDataset($targetRecord, true);
        });
    }

    public function deleteDataset(int $accountId, int $datasetId): void
    {
        $dataset = OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->with(['items'])
            ->findOrFail($datasetId);

        $this->deleteDatasetModel($dataset);
    }

    public function buildRuleGroups(int $accountId): array
    {
        $this->migrateLegacyRulesIfNeeded($accountId);

        return OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->with(['items' => fn ($relation) => $relation->orderBy('sort_order')->orderBy('id')])
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->limit(self::MAX_DATASETS)
            ->get()
            ->map(fn (OrderAiTrainingDataset $dataset) => $this->serializeRuleGroup($dataset))
            ->values()
            ->all();
    }

    public function findRuleGroupByKey(int $accountId, string $ruleKey): ?array
    {
        $this->migrateLegacyRulesIfNeeded($accountId);

        $normalizedRuleKey = trim($ruleKey);
        if ($normalizedRuleKey === '') {
            return null;
        }

        $dataset = OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->where('rule_key', $normalizedRuleKey)
            ->with(['items' => fn ($relation) => $relation->orderBy('sort_order')->orderBy('id')])
            ->first();

        return $dataset ? $this->serializeRuleGroup($dataset) : null;
    }

    public function replaceFromRuleGroups(int $accountId, array $groups): array
    {
        DB::transaction(function () use ($accountId, $groups) {
            $keptIds = [];

            foreach (collect($groups)->take(self::MAX_DATASETS) as $group) {
                if (!is_array($group)) {
                    continue;
                }

                $altarSizeLabel = trim((string) ($group['altar_size_label'] ?? $group['size_label'] ?? ''));
                if ($altarSizeLabel === '') {
                    continue;
                }

                $ruleKey = $this->normalizeRuleKey(
                    $group['rule_key'] ?? $group['id'] ?? '',
                    $altarSizeLabel,
                    $group['context_aliases'] ?? []
                );

                $dataset = OrderAiTrainingDataset::query()
                    ->where('account_id', $accountId)
                    ->where('rule_key', $ruleKey)
                    ->first();

                if ($dataset === null) {
                    $dataset = new OrderAiTrainingDataset();
                    $dataset->account_id = $accountId;
                }

                $dataset->fill([
                    'account_id' => $accountId,
                    'rule_key' => $ruleKey,
                    'altar_size_label' => $altarSizeLabel,
                    'altar_size_aliases' => $this->normalizeAliasList($group['altar_size_aliases'] ?? [$altarSizeLabel], 12),
                    'context_aliases' => $this->normalizeAliasList($group['context_aliases'] ?? [], 16),
                    'input_type' => trim((string) ($group['training_source_type'] ?? '')) === 'image' ? 'image' : 'text',
                    'source_name' => trim((string) ($group['training_source_name'] ?? '')),
                    'training_note' => trim((string) ($group['training_note'] ?? '')),
                    'input_text' => trim((string) ($group['training_raw_text'] ?? '')),
                    'parsed_raw_text' => trim((string) ($group['training_raw_text'] ?? '')),
                    'parsed_provider' => trim((string) ($group['parsed_provider'] ?? '')),
                    'trained_at' => $this->resolveTrainedAt($group['trained_at'] ?? null),
                ]);
                $dataset->save();

                $this->syncDatasetItems($dataset, $group['items'] ?? []);
                $keptIds[] = $dataset->id;
            }

            OrderAiTrainingDataset::query()
                ->where('account_id', $accountId)
                ->when($keptIds !== [], fn ($query) => $query->whereNotIn('id', $keptIds))
                ->get()
                ->each(fn (OrderAiTrainingDataset $dataset) => $this->deleteDatasetModel($dataset));
        });

        return $this->buildRuleGroups($accountId);
    }

    private function serializeRuleItem(OrderAiTrainingDatasetItem $item): array
    {
        return [
            'id' => 'order-ai-dataset-item-' . $item->id,
            'aliases' => $this->normalizeAliasList($item->aliases ?? [], 12),
            'default_quantity' => max(1, (int) $item->default_quantity),
            'target_product_id' => (int) $item->target_product_id,
            'parent_product_id' => $item->parent_product_id ? (int) $item->parent_product_id : null,
            'entry_kind' => trim((string) ($item->entry_kind ?: 'product')),
            'display_name' => Utf8Sanitizer::normalizeString(trim((string) ($item->display_name ?? ''))),
            'display_sku' => Utf8Sanitizer::normalizeString(trim((string) ($item->display_sku ?? ''))),
            'option_label' => Utf8Sanitizer::normalizeString(trim((string) ($item->option_label ?? ''))),
            'main_image' => Utf8Sanitizer::normalizeString(trim((string) ($item->main_image ?? ''))),
            'price' => round((float) ($item->price ?? 0), 2),
            'cost_price' => round((float) ($item->cost_price ?? 0), 2),
        ];
    }

    private function serializeRuleGroup(OrderAiTrainingDataset $dataset): array
    {
        return [
            'id' => 'order-ai-dataset-' . $dataset->id,
            'rule_key' => Utf8Sanitizer::normalizeString((string) $dataset->rule_key),
            'altar_size_label' => Utf8Sanitizer::normalizeString(trim((string) $dataset->altar_size_label)),
            'altar_size_aliases' => $this->normalizeAliasList($dataset->altar_size_aliases ?? [], 12),
            'context_aliases' => $this->normalizeAliasList($dataset->context_aliases ?? [], 16),
            'training_source_type' => $dataset->input_type === 'image' ? 'image' : 'manual',
            'training_source_name' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->source_name ?? ''))),
            'training_note' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->training_note ?? ''))),
            'training_raw_text' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->parsed_raw_text ?? $dataset->input_text ?? ''))),
            'trained_at' => optional($dataset->trained_at)->toIso8601String() ?: optional($dataset->updated_at)->toIso8601String(),
            'items' => $dataset->items
                ->map(fn (OrderAiTrainingDatasetItem $item) => $this->serializeRuleItem($item))
                ->take(self::MAX_ITEMS_PER_DATASET)
                ->values()
                ->all(),
        ];
    }

    private function syncDatasetItems(OrderAiTrainingDataset $dataset, array $items): void
    {
        $dataset->items()->delete();

        collect($items)
            ->filter(fn ($item) => is_array($item))
            ->map(function (array $item, int $index) {
                $targetProductId = (int) ($item['target_product_id'] ?? $item['product_id'] ?? 0);
                if ($targetProductId <= 0) {
                    return null;
                }

                $parentProductId = (int) ($item['parent_product_id'] ?? 0);

                return [
                    'aliases' => $this->normalizeAliasList($item['aliases'] ?? [], 12),
                    'default_quantity' => max(1, (int) ($item['default_quantity'] ?? $item['quantity'] ?? 1)),
                    'target_product_id' => $targetProductId,
                    'parent_product_id' => $parentProductId > 0 ? $parentProductId : null,
                    'entry_kind' => trim((string) ($item['entry_kind'] ?? $item['type'] ?? 'product')) === 'variation'
                        ? 'variation'
                        : 'product',
                    'display_name' => Utf8Sanitizer::normalizeString(trim((string) ($item['display_name'] ?? $item['name'] ?? ''))),
                    'display_sku' => Utf8Sanitizer::normalizeString(trim((string) ($item['display_sku'] ?? $item['sku'] ?? ''))),
                    'option_label' => Utf8Sanitizer::normalizeString(trim((string) ($item['option_label'] ?? ''))),
                    'main_image' => Utf8Sanitizer::normalizeString(trim((string) ($item['main_image'] ?? ''))),
                    'price' => round((float) ($item['price'] ?? 0), 2),
                    'cost_price' => round((float) ($item['cost_price'] ?? 0), 2),
                    'sort_order' => $index + 1,
                ];
            })
            ->filter()
            ->take(self::MAX_ITEMS_PER_DATASET)
            ->values()
            ->each(fn (array $item) => $dataset->items()->create($item));
    }

    private function serializeDataset(OrderAiTrainingDataset $dataset, bool $detailed): array
    {
        $items = ($dataset->relationLoaded('items') ? $dataset->items : $dataset->items()->orderBy('sort_order')->orderBy('id')->get())
            ->map(fn (OrderAiTrainingDatasetItem $item) => [
                'id' => $item->id,
                'aliases' => $this->normalizeAliasList($item->aliases ?? [], 12),
                'default_quantity' => max(1, (int) $item->default_quantity),
                'target_product_id' => (int) $item->target_product_id,
                'parent_product_id' => $item->parent_product_id ? (int) $item->parent_product_id : null,
                'entry_kind' => trim((string) ($item->entry_kind ?: 'product')),
                'display_name' => Utf8Sanitizer::normalizeString(trim((string) ($item->display_name ?? ''))),
                'display_sku' => Utf8Sanitizer::normalizeString(trim((string) ($item->display_sku ?? ''))),
                'option_label' => Utf8Sanitizer::normalizeString(trim((string) ($item->option_label ?? ''))),
                'main_image' => Utf8Sanitizer::normalizeString(trim((string) ($item->main_image ?? ''))),
                'price' => round((float) ($item->price ?? 0), 2),
                'cost_price' => round((float) ($item->cost_price ?? 0), 2),
                'sort_order' => (int) ($item->sort_order ?? 0),
            ])
            ->values();

        $parsedResult = is_array($dataset->parsed_result) ? Utf8Sanitizer::normalize($dataset->parsed_result) : null;
        $inputText = Utf8Sanitizer::normalizeString(trim((string) ($dataset->input_text ?? '')));
        $parsedRawText = Utf8Sanitizer::normalizeString(trim((string) ($dataset->parsed_raw_text ?? '')));
        $imageUrl = $this->buildImageUrl($dataset->input_image_path);

        $payload = [
            'id' => $dataset->id,
            'rule_key' => Utf8Sanitizer::normalizeString(trim((string) $dataset->rule_key)),
            'altar_size_label' => Utf8Sanitizer::normalizeString(trim((string) $dataset->altar_size_label)),
            'altar_size_aliases' => $this->normalizeAliasList($dataset->altar_size_aliases ?? [], 12),
            'context_aliases' => $this->normalizeAliasList($dataset->context_aliases ?? [], 16),
            'input_type' => trim((string) $dataset->input_type),
            'source_name' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->source_name ?? ''))),
            'training_note' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->training_note ?? ''))),
            'input_text' => $inputText,
            'input_excerpt' => $this->buildInputExcerpt($dataset),
            'input_image_url' => $imageUrl,
            'input_image_mime' => trim((string) ($dataset->input_image_mime ?? '')),
            'parsed_result' => $parsedResult,
            'parsed_raw_text' => $parsedRawText,
            'parsed_provider' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->parsed_provider ?? ''))),
            'mapping_items' => $items->all(),
            'mapping_summary' => $items->take(4)->map(fn (array $item) => $item['display_name'])->filter()->values()->all(),
            'items_count' => $items->count(),
            'created_at' => optional($dataset->created_at)->toIso8601String(),
            'updated_at' => optional($dataset->updated_at)->toIso8601String(),
            'trained_at' => optional($dataset->trained_at)->toIso8601String(),
        ];

        if (!$detailed) {
            return $payload;
        }

        $payload['input'] = [
            'type' => trim((string) $dataset->input_type),
            'text' => $inputText,
            'image_url' => $imageUrl,
            'image_mime' => trim((string) ($dataset->input_image_mime ?? '')),
            'source_name' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->source_name ?? ''))),
        ];
        $payload['ai_result'] = [
            'provider' => Utf8Sanitizer::normalizeString(trim((string) ($dataset->parsed_provider ?? ''))),
            'raw_text' => $parsedRawText,
            'result' => $parsedResult,
        ];

        return $payload;
    }

    private function storeDatasetImage(
        int $accountId,
        ?UploadedFile $attachment,
        ?OrderAiTrainingDataset $existingRecord,
        mixed $requestedSourceName,
    ): array {
        $currentPath = trim((string) ($existingRecord?->input_image_path ?? ''));
        $currentSourceName = Utf8Sanitizer::normalizeString(trim((string) ($existingRecord?->source_name ?? '')));
        $currentMime = trim((string) ($existingRecord?->input_image_mime ?? ''));
        $requestedName = Utf8Sanitizer::normalizeString(trim((string) $requestedSourceName));

        if ($attachment === null) {
            return [$currentPath, $requestedName !== '' ? $requestedName : $currentSourceName, $currentMime];
        }

        if ($currentPath !== '') {
            Storage::disk(self::IMAGE_DISK)->delete($currentPath);
        }

        $path = $attachment->store(self::IMAGE_DIRECTORY . '/' . $accountId, self::IMAGE_DISK);

        return [
            trim((string) $path),
            Utf8Sanitizer::normalizeString(trim((string) $attachment->getClientOriginalName())),
            trim((string) ($attachment->getMimeType() ?: '')),
        ];
    }

    private function buildImageUrl(?string $path): ?string
    {
        $normalizedPath = trim((string) $path);
        if ($normalizedPath === '') {
            return null;
        }

        if (str_starts_with($normalizedPath, 'http://') || str_starts_with($normalizedPath, 'https://')) {
            return $normalizedPath;
        }

        return Storage::disk(self::IMAGE_DISK)->url($normalizedPath);
    }

    private function buildInputExcerpt(OrderAiTrainingDataset $dataset): string
    {
        if ($dataset->input_type === 'image') {
            return Utf8Sanitizer::normalizeString(trim((string) ($dataset->source_name ?: 'Ảnh train AI')));
        }

        $source = Utf8Sanitizer::normalizeString(trim((string) ($dataset->input_text ?: $dataset->parsed_raw_text ?: $dataset->training_note ?: '')));
        return Str::limit($source, 140, '...');
    }

    private function normalizeAliasList(mixed $value, int $maxItems = 16): array
    {
        $values = [];

        if (is_array($value)) {
            $values = $value;
        } elseif (is_string($value)) {
            $values = preg_split('/[,;\n]+/u', $value) ?: [];
        } elseif ($value !== null && $value !== '') {
            $values = [(string) $value];
        }

        return collect($values)
            ->map(fn ($item) => Utf8Sanitizer::normalizeString(trim((string) $item)))
            ->filter()
            ->unique(fn ($item) => Str::lower(Str::ascii($item)))
            ->take($maxItems)
            ->values()
            ->all();
    }

    private function normalizeRuleKey(mixed $candidate, mixed $altarSizeLabel, mixed $contextAliases): string
    {
        $normalizedCandidate = Str::slug(trim((string) $candidate), '-');
        if ($normalizedCandidate !== '') {
            return Str::limit($normalizedCandidate, 160, '');
        }

        $parts = array_filter([
            trim((string) $altarSizeLabel),
            $this->normalizeAliasList($contextAliases, 1)[0] ?? '',
        ]);
        $fallback = Str::slug(implode('-', $parts), '-');

        return Str::limit($fallback !== '' ? $fallback : 'order-ai-rule-' . Str::lower(Str::random(8)), 160, '');
    }

    private function normalizeInputType(mixed $value): string
    {
        return trim((string) $value) === 'image' ? 'image' : 'text';
    }

    private function resolveTrainedAt(mixed $value): ?Carbon
    {
        if ($value instanceof Carbon) {
            return $value;
        }

        $normalized = trim((string) $value);
        if ($normalized === '') {
            return now();
        }

        try {
            return Carbon::parse($normalized);
        } catch (\Throwable) {
            return now();
        }
    }

    private function migrateLegacyRulesIfNeeded(int $accountId): void
    {
        if ($accountId <= 0) {
            return;
        }

        $hasDatasets = OrderAiTrainingDataset::query()
            ->where('account_id', $accountId)
            ->exists();

        if ($hasDatasets) {
            return;
        }

        $rawValue = SiteSetting::getValue(OrderAiAssistantService::RULES_SETTING_KEY, $accountId, '[]');
        if (is_array($rawValue)) {
            $legacyRules = Utf8Sanitizer::normalize($rawValue);
        } else {
            $decoded = json_decode((string) $rawValue, true);
            $legacyRules = is_array($decoded) ? Utf8Sanitizer::normalize($decoded) : [];
        }

        if ($legacyRules === []) {
            return;
        }

        $this->replaceFromRuleGroups($accountId, $legacyRules);
    }

    private function deleteDatasetModel(OrderAiTrainingDataset $dataset): void
    {
        $imagePath = trim((string) ($dataset->input_image_path ?? ''));
        if ($imagePath !== '') {
            Storage::disk(self::IMAGE_DISK)->delete($imagePath);
        }

        $dataset->items()->delete();
        $dataset->delete();
    }
}
