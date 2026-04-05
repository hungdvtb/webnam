<?php

namespace App\Services\Orders;

use App\Models\Product;
use App\Models\SiteSetting;
use App\Services\AI\GeminiService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrderAiAssistantService
{
    public const RULES_SETTING_KEY = 'order_ai_altar_rules';

    private const SEARCH_ENTRY_PRODUCT = 'product';
    private const SEARCH_ENTRY_VARIATION = 'variation';
    private const MAX_RULE_GROUPS = 24;
    private const MAX_RULE_ITEMS_PER_GROUP = 40;
    private const MAX_SUGGESTIONS = 5;
    private const AUTO_SELECT_MIN_SCORE = 60;           // Ngưỡng tối thiểu để auto-select (đã tăng mạnh)
    private const TRAIN_PRIORITY_BONUS = 200;             // Bonus tuyệt đối khi khớp chính xác trong train
    private const WRONG_FAMILY_PENALTY = 100;             // Phạt nặng khi sai loại sản phẩm
    private const CONFIDENT_MATCH_THRESHOLD = 90;         // Ngưỡng để tự động thêm vào đơn (tăng lên 90)
    private const AI_MODEL = 'gemini-2.5-flash';

    private const KNOWN_ITEM_ALIASES = [
        'de bat huong' => ['de bat huong', 'de bat', 'chan de bat huong', 'de bat tho'],
        'bat huong' => ['bat', 'bat huong', 'bat tho'],
        'ong huong' => ['ong', 'ong huong', 'ong tho'],
        'den tho' => ['den', 'den tho'],
        'choe' => ['choe'],
        'nam' => ['nam'],
        'mam bong' => ['mam bong', 'dia qua'],
        'lo hoa' => ['lo hoa'],
        'luc binh' => ['luc binh'],
        'ky ngai 5' => ['ky ngai', 'ky ngai 5', 'ky 5 chen'],
        'bo am tra' => ['bo am tra', 'am tra', 'bo am chen'],
        'chen' => ['chen'],
    ];

    private const KNOWN_ATTRIBUTE_QUALIFIERS = [
        'men lam' => ['men lam'],
        'men ran' => ['men ran'],
        've vang' => ['ve vang'],
        'men ngoc' => ['men ngoc'],
        'men nau' => ['men nau'],
        'men xanh' => ['men xanh'],
        'men trang' => ['men trang'],
        'men hoang thach' => ['men hoang thach'],
        'ca de' => ['ca de', 'kem de', 'co de'],
    ];

    private const CANONICAL_ITEM_DISPLAY_NAMES = [
        'de bat huong' => 'de bat huong',
        'bat huong' => 'bat huong',
        'ong huong' => 'ong huong',
        'den tho' => 'den tho',
        'choe' => 'choe',
        'nam' => 'nam',
        'mam bong' => 'mam bong',
        'lo hoa' => 'lo hoa',
        'luc binh' => 'luc binh',
        'ky ngai 5' => 'ky ngai 5',
        'bo am tra' => 'bo am tra',
        'chen' => 'chen',
    ];

    public function __construct(
        private readonly GeminiService $geminiService,
        private readonly OrderAiTrainingService $orderAiTrainingService,
    ) {
    }

    public function getRules(int $accountId): array
    {
        return $this->normalizeRules($this->orderAiTrainingService->buildRuleGroups($accountId));
    }

    public function saveRules(int $accountId, array $rules): array
    {
        return $this->normalizeRules(
            $this->orderAiTrainingService->replaceFromRuleGroups($accountId, $rules)
        );
    }

    public function preview(
        int $accountId,
        ?string $message,
        ?UploadedFile $attachment = null,
        ?string $preferredRuleKey = null
    ): array
    {
        $normalizedMessage = trim((string) $message);
        $resolvedPreferredRuleKey = trim((string) $preferredRuleKey);
        $rules = $this->getRules($accountId);
        $sharedDefinitionText = $this->orderAiTrainingService->getSharedDefinitionText($accountId);
        $preferredRuleGroup = $this->resolvePreferredRuleGroup($accountId, $resolvedPreferredRuleKey, $rules);
        $promptRules = $preferredRuleGroup === null
            ? $rules
            : [
                $preferredRuleGroup,
                ...collect($rules)
                    ->reject(fn (array $group) => trim((string) ($group['rule_key'] ?? '')) === trim((string) ($preferredRuleGroup['rule_key'] ?? '')))
                    ->values()
                    ->all(),
            ];
        if ($normalizedMessage === '' && $attachment === null && $preferredRuleGroup === null) {
            throw ValidationException::withMessages([
                'message' => 'Cần nhập nội dung hoặc gửi ảnh để AI đọc đơn hàng.',
            ]);
        }

        $promptDefinitionText = $this->orderAiTrainingService->mergeDefinitionTexts(
            $sharedDefinitionText,
            (string) ($preferredRuleGroup['definition_text'] ?? '')
        );
        $extraction = ($normalizedMessage === '' && $attachment === null)
            ? ['items' => [], 'raw_text' => '', 'provider' => null]
            : $this->extractRequestedItems($accountId, $normalizedMessage, $attachment, $promptRules, $promptDefinitionText);
        $rawText = trim((string) ($extraction['raw_text'] ?? $normalizedMessage));
        $altarSignal = $preferredRuleGroup !== null
            ? $this->extractAltarSizeSignal($preferredRuleGroup['altar_size_label'] ?? null)
            : ($this->extractAltarSizeSignal($extraction['altar_size'] ?? null)
                ?? $this->extractAltarSizeSignal($rawText));
        $altarContext = $preferredRuleGroup ?? $this->matchAltarRuleGroup($rules, $altarSignal, $rawText);
        $contextDefinitionEntries = $this->parseDefinitionEntries(
            $this->orderAiTrainingService->mergeDefinitionTexts(
                $sharedDefinitionText,
                (string) ($altarContext['definition_text'] ?? '')
            )
        );
        $globalQualifiers = $this->extractLeadingGlobalQualifiers(
            $this->applyDefinitionEntriesToText($rawText, $contextDefinitionEntries)
        );
        $requestedItems = collect($extraction['items'] ?? [])
            ->map(function ($item, $index) use ($contextDefinitionEntries, $globalQualifiers) {
                if ($globalQualifiers !== []) {
                    $item['qualifiers'] = [
                        ...$globalQualifiers,
                        ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                    ];
                }

                return $this->normalizeRequestedItem($item, (int) $index, $contextDefinitionEntries);
            })
            ->filter(fn (array $item) => $item['parsed_name'] !== '')
            ->values();

        if ($requestedItems->isEmpty() && $normalizedMessage !== '') {
            $requestedItems = collect($this->fallbackExtractFromText($normalizedMessage))
                ->map(function ($item, $index) use ($contextDefinitionEntries, $globalQualifiers) {
                    if ($globalQualifiers !== []) {
                        $item['qualifiers'] = [
                            ...$globalQualifiers,
                            ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                        ];
                    }

                    return $this->normalizeRequestedItem($item, (int) $index, $contextDefinitionEntries);
                })
                ->filter(fn (array $item) => $item['parsed_name'] !== '')
                ->values();
        }

        $requestedItems = $this->expandCompositeRequestedItems($requestedItems);

        if ($requestedItems->isEmpty() && $altarContext && !empty($altarContext['items'])) {
            $mappedItems = $this->buildMappedItemsFromRuleGroup($altarContext);

            return [
                'raw_text' => $rawText,
                'provider' => $extraction['provider'] ?? null,
                'altar_size' => $this->formatAltarContext($altarContext, $altarSignal),
                'items' => $mappedItems->all(),
                'summary' => [
                    'total' => $mappedItems->count(),
                    'matched' => $mappedItems->where('match_status', 'matched')->count(),
                    'needs_review' => 0,
                    'unresolved' => 0,
                ],
            ];
        }

        if ($requestedItems->isEmpty()) {
            return [
                'raw_text' => $rawText,
                'provider' => $extraction['provider'] ?? null,
                'altar_size' => $this->formatAltarContext($altarContext, $altarSignal),
                'items' => [],
                'summary' => [
                    'total' => 0,
                    'matched' => 0,
                    'needs_review' => 0,
                    'unresolved' => 0,
                ],
            ];
        }

        $catalogEntries = $this->loadCatalogEntries($accountId);
        $mappedItems = $requestedItems
            ->map(fn (array $item) => $this->mapRequestedItem($catalogEntries, $item, $altarContext))
            ->values();

        return [
            'raw_text' => $rawText,
            'provider' => $extraction['provider'] ?? null,
            'altar_size' => $this->formatAltarContext($altarContext, $altarSignal),
            'items' => $mappedItems->all(),
            'summary' => [
                'total' => $mappedItems->count(),
                'matched' => $mappedItems->where('match_status', 'matched')->count(),
                'needs_review' => $mappedItems->where('match_status', 'review')->count(),
                'unresolved' => $mappedItems->where('match_status', 'unresolved')->count(),
            ],
        ];
    }

    public function trainRulePreview(
        int $accountId,
        string $altarSizeLabel,
        ?string $message,
        ?UploadedFile $attachment = null,
        ?string $definitionText = null
    ): array {
        $normalizedAltarSizeLabel = trim($altarSizeLabel);
        if ($normalizedAltarSizeLabel === '') {
            throw ValidationException::withMessages([
                'altar_size_label' => "C\u{1ea7}n nh\u{1ead}p k\u{ed}ch th\u{1b0}\u{1edbc} ban th\u{1edd} tr\u{1b0}\u{1edbc} khi d\u{1ea1}y AI.",
            ]);
        }

        if ($attachment === null) {
            throw ValidationException::withMessages([
                'attachment' => "C\u{1ea7}n t\u{1ea3}i \u{1ea3}nh ho\u{1eb7}c t\u{1ec7}p \u{111}\u{1ec3} AI h\u{1ecdc} nhanh b\u{1ed9} s\u{1ea3}n ph\u{1ea9}m.",
            ]);
        }

        $normalizedMessage = trim((string) $message);
        $normalizedDefinitionText = trim((string) $definitionText);
        $definitionEntries = $this->parseDefinitionEntries($normalizedDefinitionText);
        $rules = $this->getRules($accountId);
        $contextMessage = trim(implode("\n", array_filter([
            "K\u{ed}ch th\u{1b0}\u{1edbc} ban th\u{1edd} c\u{1ea7}n h\u{1ecdc}: {$normalizedAltarSizeLabel}",
            $normalizedMessage,
        ])));
        $extraction = $this->extractRequestedItems($accountId, $contextMessage, $attachment, $rules, $normalizedDefinitionText);
        $rawText = trim((string) ($extraction['raw_text'] ?? $normalizedMessage));
        $globalQualifiers = $this->extractLeadingGlobalQualifiers(
            $this->applyDefinitionEntriesToText($rawText, $definitionEntries)
        );
        $requestedItems = collect($extraction['items'] ?? [])
            ->map(function ($item, $index) use ($definitionEntries, $globalQualifiers) {
                if ($globalQualifiers !== []) {
                    $item['qualifiers'] = [
                        ...$globalQualifiers,
                        ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                    ];
                }

                return $this->normalizeRequestedItem($item, (int) $index, $definitionEntries);
            })
            ->filter(fn (array $item) => $item['parsed_name'] !== '')
            ->values();

        if ($requestedItems->isEmpty() && $rawText !== '') {
            $requestedItems = collect($this->fallbackExtractFromText($rawText))
                ->map(function ($item, $index) use ($definitionEntries, $globalQualifiers) {
                    if ($globalQualifiers !== []) {
                        $item['qualifiers'] = [
                            ...$globalQualifiers,
                            ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                        ];
                    }

                    return $this->normalizeRequestedItem($item, (int) $index, $definitionEntries);
                })
                ->filter(fn (array $item) => $item['parsed_name'] !== '')
                ->values();
        }

        $requestedItems = $this->expandCompositeRequestedItems($requestedItems);
        $catalogEntries = $this->loadCatalogEntries($accountId);
        $mappedItems = $requestedItems
            ->map(fn (array $item) => $this->mapRequestedItem($catalogEntries, $item, null))
            ->values();

        $ruleItems = $mappedItems
            ->map(fn (array $item, int $index) => $this->buildRulePreviewItemFromMappedLine($item, $index))
            ->filter()
            ->values();
        $unresolvedItems = $mappedItems
            ->filter(fn (array $item) => empty($item['selected_entry']))
            ->map(fn (array $item) => [
                'line_key' => $item['line_key'],
                'source_phrase' => $item['source_phrase'],
                'parsed_name' => $item['parsed_name'],
                'confidence' => (int) ($item['confidence'] ?? 0),
                'confidence_label' => $item['confidence_label'] ?? $this->confidenceLabel((int) ($item['confidence'] ?? 0)),
                'suggestions' => array_slice($item['suggestions'] ?? [], 0, 3),
            ])
            ->values();
        $contextAliases = $this->suggestRuleContextAliases($normalizedMessage, $rawText);

        $previewPayload = [
            'rule_key_suggestion' => $this->suggestTrainingRuleKey($normalizedAltarSizeLabel, $contextAliases),
            'altar_size' => [
                'label' => $normalizedAltarSizeLabel,
                'aliases' => $this->normalizeAliasList([$normalizedAltarSizeLabel], 12),
            ],
            'context_aliases' => $contextAliases,
            'definition_text' => $normalizedDefinitionText,
            'provider' => $extraction['provider'] ?? null,
            'raw_text' => $rawText,
            'source' => [
                'type' => 'image',
                'name' => trim((string) $attachment->getClientOriginalName()),
                'note' => $normalizedMessage,
            ],
            'extracted_items' => $requestedItems
                ->map(fn (array $item) => [
                    'line_key' => $item['line_key'],
                    'source_phrase' => $item['source_phrase'],
                    'quantity' => $item['quantity'],
                    'parsed_name' => $item['parsed_name'],
                    'canonical_name' => $item['canonical_name'],
                    'qualifiers' => $item['qualifiers'],
                    'size' => $item['size'],
                ])
                ->values()
                ->all(),
            'items' => $ruleItems->all(),
            'unresolved_items' => $unresolvedItems->all(),
            'summary' => [
                'total' => $requestedItems->count(),
                'mapped' => $ruleItems->count(),
                'review' => $ruleItems->where('match_status', 'review')->count(),
                'unresolved' => $unresolvedItems->count(),
            ],
        ];
        $previewPayload['parsed_result'] = [
            'provider' => $previewPayload['provider'],
            'raw_text' => $previewPayload['raw_text'],
            'altar_size' => $previewPayload['altar_size'],
            'context_aliases' => $previewPayload['context_aliases'],
            'definition_text' => $previewPayload['definition_text'],
            'extracted_items' => $previewPayload['extracted_items'],
            'items' => $previewPayload['items'],
            'unresolved_items' => $previewPayload['unresolved_items'],
            'summary' => $previewPayload['summary'],
        ];

        return $previewPayload;
    }

    public function buildTrainingPreview(
        int $accountId,
        string $altarSizeLabel,
        ?string $message,
        ?UploadedFile $attachment = null,
        string $inputType = 'image',
        ?string $definitionText = null
    ): array {
        $normalizedInputType = trim($inputType) === 'image' ? 'image' : 'text';

        if ($normalizedInputType === 'image') {
            return $this->trainRulePreview($accountId, $altarSizeLabel, $message, $attachment, $definitionText);
        }

        $normalizedAltarSizeLabel = trim($altarSizeLabel);
        if ($normalizedAltarSizeLabel === '') {
            throw ValidationException::withMessages([
                'altar_size_label' => "C\u{1ea7}n nh\u{1ead}p k\u{ed}ch th\u{1b0}\u{1edbc} ban th\u{1edd} tr\u{1b0}\u{1edbc} khi d\u{1ea1}y AI.",
            ]);
        }

        $normalizedMessage = trim((string) $message);
        $normalizedDefinitionText = trim((string) $definitionText);
        $definitionEntries = $this->parseDefinitionEntries($normalizedDefinitionText);
        if ($normalizedMessage === '') {
            throw ValidationException::withMessages([
                'input_text' => "C\u{1ea7}n nh\u{1ead}p text \u{111}\u{1ec3} AI ph\u{e2}n t\u{ed}ch v\u{e0} l\u{1b0}u rule.",
            ]);
        }

        $rules = $this->getRules($accountId);
        $contextMessage = trim(implode("\n", array_filter([
            "K\u{ed}ch th\u{1b0}\u{1edbc} ban th\u{1edd} c\u{1ea7}n h\u{1ecdc}: {$normalizedAltarSizeLabel}",
            $normalizedMessage,
        ])));
        $extraction = $this->extractRequestedItems($accountId, $contextMessage, null, $rules, $normalizedDefinitionText);
        $rawText = trim((string) ($extraction['raw_text'] ?? $normalizedMessage));
        $globalQualifiers = $this->extractLeadingGlobalQualifiers(
            $this->applyDefinitionEntriesToText($rawText, $definitionEntries)
        );
        $requestedItems = collect($extraction['items'] ?? [])
            ->map(function ($item, $index) use ($definitionEntries, $globalQualifiers) {
                if ($globalQualifiers !== []) {
                    $item['qualifiers'] = [
                        ...$globalQualifiers,
                        ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                    ];
                }

                return $this->normalizeRequestedItem($item, (int) $index, $definitionEntries);
            })
            ->filter(fn (array $item) => $item['parsed_name'] !== '')
            ->values();

        if ($requestedItems->isEmpty() && $rawText !== '') {
            $requestedItems = collect($this->fallbackExtractFromText($rawText))
                ->map(function ($item, $index) use ($definitionEntries, $globalQualifiers) {
                    if ($globalQualifiers !== []) {
                        $item['qualifiers'] = [
                            ...$globalQualifiers,
                            ...(is_array($item['qualifiers'] ?? null) ? $item['qualifiers'] : []),
                        ];
                    }

                    return $this->normalizeRequestedItem($item, (int) $index, $definitionEntries);
                })
                ->filter(fn (array $item) => $item['parsed_name'] !== '')
                ->values();
        }

        $requestedItems = $this->expandCompositeRequestedItems($requestedItems);
        $catalogEntries = $this->loadCatalogEntries($accountId);
        $mappedItems = $requestedItems
            ->map(fn (array $item) => $this->mapRequestedItem($catalogEntries, $item, null))
            ->values();

        $ruleItems = $mappedItems
            ->map(fn (array $item, int $index) => $this->buildRulePreviewItemFromMappedLine($item, $index))
            ->filter()
            ->values();
        $unresolvedItems = $mappedItems
            ->filter(fn (array $item) => empty($item['selected_entry']))
            ->map(fn (array $item) => [
                'line_key' => $item['line_key'],
                'source_phrase' => $item['source_phrase'],
                'parsed_name' => $item['parsed_name'],
                'confidence' => (int) ($item['confidence'] ?? 0),
                'confidence_label' => $item['confidence_label'] ?? $this->confidenceLabel((int) ($item['confidence'] ?? 0)),
                'suggestions' => array_slice($item['suggestions'] ?? [], 0, 3),
            ])
            ->values();
        $contextAliases = $this->suggestRuleContextAliases($normalizedMessage, $rawText);

        $previewPayload = [
            'rule_key_suggestion' => $this->suggestTrainingRuleKey($normalizedAltarSizeLabel, $contextAliases),
            'altar_size' => [
                'label' => $normalizedAltarSizeLabel,
                'aliases' => $this->normalizeAliasList([$normalizedAltarSizeLabel], 12),
            ],
            'context_aliases' => $contextAliases,
            'definition_text' => $normalizedDefinitionText,
            'provider' => $extraction['provider'] ?? null,
            'raw_text' => $rawText,
            'source' => [
                'type' => 'text',
                'name' => "N\u{1ed9}i dung nh\u{1ead}p tay",
                'note' => $normalizedMessage,
            ],
            'extracted_items' => $requestedItems
                ->map(fn (array $item) => [
                    'line_key' => $item['line_key'],
                    'source_phrase' => $item['source_phrase'],
                    'quantity' => $item['quantity'],
                    'parsed_name' => $item['parsed_name'],
                    'canonical_name' => $item['canonical_name'],
                    'qualifiers' => $item['qualifiers'],
                    'size' => $item['size'],
                ])
                ->values()
                ->all(),
            'items' => $ruleItems->all(),
            'unresolved_items' => $unresolvedItems->all(),
            'summary' => [
                'total' => $requestedItems->count(),
                'mapped' => $ruleItems->count(),
                'review' => $ruleItems->where('match_status', 'review')->count(),
                'unresolved' => $unresolvedItems->count(),
            ],
        ];
        $previewPayload['parsed_result'] = [
            'provider' => $previewPayload['provider'],
            'raw_text' => $previewPayload['raw_text'],
            'altar_size' => $previewPayload['altar_size'],
            'context_aliases' => $previewPayload['context_aliases'],
            'definition_text' => $previewPayload['definition_text'],
            'extracted_items' => $previewPayload['extracted_items'],
            'items' => $previewPayload['items'],
            'unresolved_items' => $previewPayload['unresolved_items'],
            'summary' => $previewPayload['summary'],
        ];

        return $previewPayload;
    }

    private function readStoredRules(int $accountId): array
    {
        $rawValue = SiteSetting::getValue(self::RULES_SETTING_KEY, $accountId, '[]');
        if (is_array($rawValue)) {
            return $rawValue;
        }

        $decoded = json_decode((string) $rawValue, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function normalizeRules(array $rules): array
    {
        return collect($rules)
            ->map(function ($group, $groupIndex) {
                if (!is_array($group)) {
                    return null;
                }

                $label = trim((string) ($group['altar_size_label'] ?? $group['size_label'] ?? ''));
                if ($label === '') {
                    return null;
                }

                $aliases = $this->normalizeAliasList([
                    $label,
                    ...$this->normalizeAliasList($group['altar_size_aliases'] ?? []),
                ], 12);
                $contextAliases = $this->normalizeAliasList($group['context_aliases'] ?? [], 16);
                $ruleKey = trim((string) ($group['rule_key'] ?? ''));

                $items = collect($group['items'] ?? [])
                    ->map(function ($item, $itemIndex) {
                        if (!is_array($item)) {
                            return null;
                        }

                        $targetProductId = (int) ($item['target_product_id'] ?? $item['product_id'] ?? 0);
                        if ($targetProductId <= 0) {
                            return null;
                        }

                        $parentProductId = (int) ($item['parent_product_id'] ?? 0);
                        $entryKind = trim((string) ($item['entry_kind'] ?? $item['type'] ?? self::SEARCH_ENTRY_PRODUCT));
                        $defaultQuantity = max(1, (int) ($item['default_quantity'] ?? $item['quantity'] ?? 1));

                        return [
                            'id' => trim((string) ($item['id'] ?? '')) ?: "order-ai-rule-item-{$targetProductId}-" . ($itemIndex + 1),
                            'aliases' => $this->normalizeAliasList([
                                ...$this->normalizeAliasList($item['aliases'] ?? [], 12),
                                $item['display_name'] ?? '',
                                $item['option_label'] ?? '',
                            ], 12),
                            'default_quantity' => $defaultQuantity,
                            'target_product_id' => $targetProductId,
                            'parent_product_id' => $parentProductId > 0 ? $parentProductId : null,
                            'parent_product_name' => trim((string) ($item['parent_product_name'] ?? '')),
                            'entry_kind' => $entryKind === self::SEARCH_ENTRY_VARIATION ? self::SEARCH_ENTRY_VARIATION : self::SEARCH_ENTRY_PRODUCT,
                            'display_name' => trim((string) ($item['display_name'] ?? $item['name'] ?? '')),
                            'display_sku' => trim((string) ($item['display_sku'] ?? $item['sku'] ?? '')),
                            'option_label' => trim((string) ($item['option_label'] ?? '')),
                            'main_image' => trim((string) ($item['main_image'] ?? '')),
                            'price' => round((float) ($item['price'] ?? 0), 2),
                            'cost_price' => round((float) ($item['cost_price'] ?? 0), 2),
                            'order' => $itemIndex + 1,
                        ];
                    })
                    ->filter()
                    ->take(self::MAX_RULE_ITEMS_PER_GROUP)
                    ->values()
                    ->all();

                return [
                    'id' => trim((string) ($group['id'] ?? '')) ?: "order-ai-rule-group-" . ($groupIndex + 1),
                    'rule_key' => $ruleKey !== '' ? $ruleKey : Str::slug(implode('-', array_filter([$label, $contextAliases[0] ?? ''])), '-'),
                    'altar_size_label' => $label,
                    'altar_size_aliases' => $aliases,
                    'context_aliases' => $contextAliases,
                    'training_source_type' => in_array(trim((string) ($group['training_source_type'] ?? '')), ['manual', 'image'], true)
                        ? trim((string) ($group['training_source_type'] ?? ''))
                        : null,
                    'training_source_name' => trim((string) ($group['training_source_name'] ?? '')),
                    'training_note' => trim((string) ($group['training_note'] ?? '')),
                    'definition_text' => trim((string) ($group['definition_text'] ?? '')),
                    'training_raw_text' => trim((string) ($group['training_raw_text'] ?? '')),
                    'trained_at' => trim((string) ($group['trained_at'] ?? '')),
                    'items' => $items,
                ];
            })
            ->filter()
            ->take(self::MAX_RULE_GROUPS)
            ->values()
            ->all();
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
            ->map(fn ($item) => trim((string) $item))
            ->filter()
            ->unique(fn ($item) => $this->normalizeText($item))
            ->take($maxItems)
            ->values()
            ->all();
    }

    private function suggestRuleContextAliases(?string $message, ?string $rawText): array
    {
        $preferredSource = trim((string) $message);
        $fallbackSource = trim((string) $rawText);

        $knownAliases = $this->normalizeAliasList([
            ...$this->extractImplicitQualifiersFromText($preferredSource),
            ...$this->extractImplicitQualifiersFromText($fallbackSource),
        ], 16);
        if ($knownAliases !== []) {
            return $knownAliases;
        }

        $source = $preferredSource !== '' ? $preferredSource : $fallbackSource;

        return collect(preg_split('/[\n,;]+/u', $source) ?: [])
            ->map(fn ($segment) => $this->sanitizeContextAliasCandidate($segment))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText((string) $value))
            ->take(16)
            ->values()
            ->all();
    }

    private function sanitizeContextAliasCandidate(mixed $value): ?string
    {
        $segment = trim((string) $value);
        if ($segment === '') {
            return null;
        }

        $cleaned = preg_replace('/\bkich\s*thuoc\s*ban\s*tho\s*can\s*hoc\s*:?\s*/iu', ' ', $segment) ?? $segment;
        $cleaned = preg_replace('/\bban(?:\s+tho)?\s*\d+(?:[.,]\d+)?\s*m\s*\d{0,2}\b/iu', ' ', $cleaned) ?? $cleaned;
        $cleaned = preg_replace('/\b\d+(?:[.,]\d+)?\s*m\s*\d{0,2}\b/iu', ' ', $cleaned) ?? $cleaned;
        $cleaned = preg_replace('/\b\d{3,4}\b/u', ' ', $cleaned) ?? $cleaned;
        $cleaned = preg_replace('/\s+/u', ' ', $cleaned) ?? $cleaned;
        $cleaned = trim($cleaned);

        if ($cleaned === '') {
            return null;
        }

        if (preg_match('/\d/u', $cleaned) === 1) {
            return null;
        }

        if (count($this->tokenize($cleaned)) > 4) {
            return null;
        }

        if ($this->detectKnownItemCanonicalName([$cleaned]) !== null) {
            return null;
        }

        return $this->normalizeAliasList([$cleaned], 1)[0] ?? null;
    }

    private function suggestTrainingRuleKey(string $altarSizeLabel, array $contextAliases): string
    {
        $parts = [
            trim($altarSizeLabel),
            ...collect($this->normalizeAliasList($contextAliases, 16))
                ->sortBy(fn ($value) => $this->normalizeText((string) $value))
                ->values()
                ->all(),
        ];

        $candidate = Str::slug(implode('-', array_filter($parts)), '-');

        return Str::limit($candidate !== '' ? $candidate : 'order-ai-rule-' . Str::lower(Str::random(8)), 160, '');
    }

    private function extractRequestedItems(
        int $accountId,
        string $message,
        ?UploadedFile $attachment,
        array $rules,
        ?string $definitionText = null
    ): array
    {
        if ($attachment !== null) {
            $bytes = $attachment->get();
            if ($bytes === false) {
                throw ValidationException::withMessages([
                    'attachment' => 'Không thể đọc ảnh/tệp vừa tải lên.',
                ]);
            }

            $result = $this->geminiService->readImage(
                base64_encode($bytes),
                $attachment->getMimeType() ?: 'image/png',
                $this->buildExtractionPrompt($message, $rules, true, $definitionText),
                $accountId,
                self::AI_MODEL
            );

            $decoded = $this->decodeAiJson((string) ($result['text'] ?? ''));
            $decoded['provider'] = $result['model'] ?? null;
            $decoded['raw_text'] = trim((string) ($decoded['raw_text'] ?? $message));

            return $decoded;
        }

        $structuredTextItems = $this->fallbackExtractFromText($message);
        if ($this->shouldPreferStructuredTextParser($message, $structuredTextItems)) {
            return [
                'provider' => 'structured_text_parser',
                'raw_text' => $message,
                'altar_size' => $this->extractAltarSizeSignal($message),
                'items' => $structuredTextItems,
            ];
        }

        try {
            $result = $this->geminiService->generateText(
                $this->buildExtractionPrompt($message, $rules, false, $definitionText),
                $accountId,
                self::AI_MODEL
            );
            $decoded = $this->decodeAiJson((string) ($result['text'] ?? ''));
            $decoded['provider'] = $result['model'] ?? null;
            $decoded['raw_text'] = trim((string) ($decoded['raw_text'] ?? $message));

            return $decoded;
        } catch (\Throwable $exception) {
            $fallbackItems = $this->fallbackExtractFromText($message);
            if ($fallbackItems !== []) {
                return [
                    'provider' => 'fallback_text_parser',
                    'raw_text' => $message,
                    'altar_size' => $this->extractAltarSizeSignal($message),
                    'items' => $fallbackItems,
                ];
            }

            throw $exception;
        }
    }

    private function shouldPreferStructuredTextParser(string $message, array $fallbackItems): bool
    {
        if ($fallbackItems === []) {
            return false;
        }

        $segments = collect(preg_split('/[\n,;]+/u', $message) ?: [])
            ->map(fn ($segment) => trim((string) $segment))
            ->filter()
            ->values();

        if ($segments->isEmpty()) {
            return false;
        }

        $structuredCount = 0;
        $qualifierOnlyCount = 0;

        foreach ($segments as $segment) {
            $hasExplicitQuantity = preg_match('/^\s*(?:tang\s+)?\d+\b/iu', $segment) === 1;
            $hasKnownItem = $this->detectKnownItemCanonicalName([$segment]) !== null;
            $hasAnyDigit = preg_match('/\d/u', $segment) === 1;
            $segmentQualifiers = $this->extractImplicitQualifiersFromText($segment);

            if ($hasExplicitQuantity || ($hasKnownItem && $hasAnyDigit)) {
                $structuredCount += 1;
                continue;
            }

            if ($segmentQualifiers !== [] && !$hasKnownItem && !$hasAnyDigit) {
                $qualifierOnlyCount += 1;
            }
        }

        $relevantSegmentCount = max(1, $segments->count() - $qualifierOnlyCount);
        $requiredStructuredCount = max(1, (int) ceil($relevantSegmentCount * 0.6));

        return $structuredCount >= $requiredStructuredCount;
    }

    private function buildExtractionPrompt(
        string $message,
        array $rules,
        bool $hasAttachment,
        ?string $definitionText = null
    ): string
    {
        $ruleHints = collect($rules)
            ->take(12)
            ->map(function (array $group) {
                $aliases = collect($group['items'] ?? [])
                    ->flatMap(fn (array $item) => $item['aliases'] ?? [])
                    ->filter()
                    ->take(16)
                    ->implode(', ');

                return "- {$group['altar_size_label']}: {$aliases}";
            })
            ->filter()
            ->implode("\n");
        $definitionHints = $this->buildDefinitionPromptBlock($rules, $definitionText);

        $inputHint = $hasAttachment
            ? "Ban can OCR noi dung trong anh/tai lieu dinh kem roi parse thanh cau truc du lieu."
            : "Ban can doc noi dung van ban nguoi dung vua nhap va parse thanh cau truc du lieu.";

        $messageBlock = $message !== ''
            ? "Noi dung nguoi dung bo sung:\n{$message}\n"
            : "Nguoi dung khong go them van ban.\n";

        return <<<PROMPT
Ban la tro ly nhap don hang do tho.
{$inputHint}
Tra ve DUY NHAT mot JSON hop le, khong markdown, khong giai thich.

Schema:
{
  "raw_text": "string",
  "altar_size": {
    "raw": "string|null",
    "normalized_label": "string|null"
  },
  "items": [
    {
      "source_phrase": "string",
      "quantity": 1,
      "quantity_specified": true,
      "name": "string",
      "normalized_name": "string|null",
      "category_hint": "string|null",
      "size_text": "string|null",
      "size_kind": "diameter|height|width|depth|altar|unknown",
      "qualifiers": ["string"],
      "bonus": false,
      "notes": "string|null"
    }
  ]
}

Quy tac:
- Tach tung dong san pham, khong gop nhieu mon vao 1 dong.
- quantity phai la so nguyen duong.
- quantity_specified=true neu khach co ghi ro so luong; neu khong ghi thi quantity=1 va quantity_specified=false.
- Cac thuoc tinh xuat hien truoc danh sach mon, vi du "men lam, 2 bat 18 ca de", phai duoc ap dung cho cac mon phia sau neu phu hop.
- Neu gap cum nhu "ca de", "kem de" voi bat huong thi tach thanh 2 dong: bat huong va de bat huong, giu nguyen size/men/so luong.
- Neu thay "ban 1m27", "ban 1m53", "ban 1m75", "ban 1m97"... thi dua vao altar_size, khong dua vao size cua mon hang.
- Neu size cua mon duoc viet kieu "20", "phi 20", "cao 35", "35cm" thi dua vao size_text va size_kind phu hop.
- Neu dong la qua tang/bonus/tang kem thi dat bonus=true nhung van giu quantity va name.
- Neu khong chac chan category_hint thi de null.
- Neu khong chac chan size_text thi de null.
- Neu co "Dinh nghia tu goi/viet tat", hay quy doi ve ten chuan truoc khi parse va map.

Dinh nghia tu goi / viet tat:
{$definitionHints}

Rule ban tho da hoc:
{$ruleHints}

{$messageBlock}
PROMPT;
    }

    private function buildDefinitionPromptBlock(array $rules, ?string $definitionText = null): string
    {
        $lines = [];
        $normalizedAdHocDefinitions = trim((string) $definitionText);

        if ($normalizedAdHocDefinitions !== '') {
            $lines[] = '- Tu dien dang ap dung: ' . $this->condenseDefinitionText($normalizedAdHocDefinitions);
        }

        foreach (collect($rules)->filter(fn (array $group) => trim((string) ($group['definition_text'] ?? '')) !== '')->take(8) as $group) {
            $labelParts = array_filter([
                trim((string) ($group['altar_size_label'] ?? '')),
                trim((string) (($group['context_aliases'][0] ?? ''))),
            ]);
            $label = implode(' / ', $labelParts);
            $lines[] = '- ' . ($label !== '' ? $label : 'Rule da hoc') . ': ' . $this->condenseDefinitionText((string) ($group['definition_text'] ?? ''));
        }

        return $lines === [] ? '- Khong co khai bao bo sung.' : implode("\n", $lines);
    }

    private function condenseDefinitionText(string $text): string
    {
        return Str::limit(
            collect(preg_split('/[\r\n;]+/u', $text) ?: [])
                ->map(fn ($line) => trim((string) $line))
                ->filter()
                ->implode(' | '),
            420,
            '...'
        );
    }

    private function parseDefinitionEntries(?string $text): array
    {
        $segments = collect(preg_split('/[\r\n;]+/u', trim((string) $text)) ?: [])
            ->map(fn ($segment) => trim((string) $segment))
            ->filter()
            ->values();

        if ($segments->isEmpty()) {
            return [];
        }

        $entries = [];

        foreach ($segments as $segment) {
            if (preg_match('/^(.+?)\s*(?:=|=>|->|:|la|là|nghia la|nghĩa là|co nghia la|có nghĩa là)\s*(.+)$/iu', $segment, $matches) !== 1) {
                continue;
            }

            $aliases = collect(preg_split('/[,|\/]+/u', trim((string) ($matches[1] ?? ''))) ?: [])
                ->map(fn ($alias) => trim((string) $alias))
                ->filter()
                ->values()
                ->all();
            $canonical = trim((string) ($matches[2] ?? ''));

            if ($canonical === '' || $aliases === []) {
                continue;
            }

            $entries[] = [
                'canonical' => $canonical,
                'aliases' => $this->normalizeAliasList($aliases, 24),
            ];
        }

        return collect($entries)
            ->filter(fn (array $entry) => $entry['canonical'] !== '' && $entry['aliases'] !== [])
            ->values()
            ->all();
    }

    private function applyDefinitionEntriesToText(string $text, array $definitionEntries): string
    {
        $resolved = trim($text);
        if ($resolved === '' || $definitionEntries === []) {
            return $resolved;
        }

        $replacements = collect($definitionEntries)
            ->flatMap(fn (array $entry) => collect($entry['aliases'] ?? [])->map(fn ($alias) => [
                'alias' => trim((string) $alias),
                'canonical' => trim((string) ($entry['canonical'] ?? '')),
            ]))
            ->filter(fn (array $entry) => $entry['alias'] !== '' && $entry['canonical'] !== '')
            ->sortByDesc(fn (array $entry) => mb_strlen($entry['alias']))
            ->values();

        foreach ($replacements as $replacement) {
            $pattern = '/(?<![\pL\pN])' . preg_quote($replacement['alias'], '/') . '(?![\pL\pN])/iu';
            $resolved = preg_replace($pattern, $replacement['canonical'], $resolved) ?? $resolved;
        }

        return trim($resolved);
    }

    private function expandValuesWithDefinitionEntries(array $values, array $definitionEntries): array
    {
        if ($definitionEntries === []) {
            return collect($values)->map(fn ($value) => trim((string) $value))->filter()->values()->all();
        }

        $expanded = [];

        foreach ($values as $value) {
            $normalizedValue = trim((string) $value);
            if ($normalizedValue === '') {
                continue;
            }

            $expanded[] = $normalizedValue;
            $replacedValue = $this->applyDefinitionEntriesToText($normalizedValue, $definitionEntries);
            if ($replacedValue !== '' && $replacedValue !== $normalizedValue) {
                $expanded[] = $replacedValue;
            }

            foreach ($definitionEntries as $entry) {
                foreach (($entry['aliases'] ?? []) as $alias) {
                    if ($this->containsNormalizedPhrase($normalizedValue, (string) $alias)) {
                        $expanded[] = trim((string) ($entry['canonical'] ?? ''));
                    }
                }
            }
        }

        return collect($expanded)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();
    }

    private function resolveDefinitionCanonicalPhrase(array $values, array $definitionEntries): ?string
    {
        if ($definitionEntries === []) {
            return null;
        }

        $normalizedValues = collect($values)
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->values()
            ->all();

        foreach ($definitionEntries as $entry) {
            $canonical = trim((string) ($entry['canonical'] ?? ''));
            if ($canonical === '') {
                continue;
            }

            foreach (($entry['aliases'] ?? []) as $alias) {
                $normalizedAlias = $this->normalizeText((string) $alias);
                if ($normalizedAlias === '') {
                    continue;
                }

                foreach ($normalizedValues as $normalizedValue) {
                    if ($normalizedValue === $normalizedAlias) {
                        return $canonical;
                    }
                }
            }
        }

        return null;
    }

    private function containsNormalizedPhrase(string $haystack, string $needle): bool
    {
        $normalizedHaystack = $this->normalizeText($haystack);
        $normalizedNeedle = $this->normalizeText($needle);
        if ($normalizedHaystack === '' || $normalizedNeedle === '') {
            return false;
        }

        if ($normalizedHaystack === $normalizedNeedle) {
            return true;
        }

        return preg_match('/(?<![a-z0-9])' . preg_quote($normalizedNeedle, '/') . '(?![a-z0-9])/u', $normalizedHaystack) === 1
            || str_contains($normalizedHaystack, $normalizedNeedle);
    }

    private function decodeAiJson(string $text): array
    {
        $normalized = trim($text);
        $normalized = preg_replace('/^```json\s*/i', '', $normalized) ?? $normalized;
        $normalized = preg_replace('/```$/', '', $normalized) ?? $normalized;

        $decoded = json_decode($normalized, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        if (preg_match('/\{.*\}/s', $normalized, $matches) === 1) {
            $decoded = json_decode($matches[0], true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        throw ValidationException::withMessages([
            'message' => 'AI trả về dữ liệu chưa hợp lệ, vui lòng thử lại.',
        ]);
    }

    private function fallbackExtractFromText(string $message): array
    {
        $segments = collect(preg_split('/[\n,;]+/u', $message) ?: [])
            ->map(fn ($segment) => trim((string) $segment))
            ->filter()
            ->values();

        return $segments->map(function (string $segment) {
            $normalizedSegment = $this->normalizeText($segment);
            if ($normalizedSegment === '') {
                return null;
            }

            $segmentQualifiers = $this->extractImplicitQualifiersFromText($segment);
            if (
                $segmentQualifiers !== []
                && $this->detectKnownItemCanonicalName([$segment]) === null
                && preg_match('/\d/u', $segment) !== 1
            ) {
                return null;
            }

            if (preg_match('/\bban\b/u', $normalizedSegment) === 1 && preg_match('/\d/', $normalizedSegment) === 1 && !preg_match('/^\d+\s+/u', $normalizedSegment)) {
                return null;
            }

            $quantity = 1;
            $quantitySpecified = false;
            $body = $segment;

            if (preg_match('/^(?:tang\s+)?(\d+)\s+(.+)$/iu', $segment, $matches) === 1) {
                $quantity = max(1, (int) $matches[1]);
                $quantitySpecified = true;
                $body = trim((string) $matches[2]);
            }

            $bonus = str_contains($normalizedSegment, 'tang ') || str_contains($normalizedSegment, 'qua tang');
            $sizeMatch = [];
            if (preg_match('/(?:phi|dk|duong kinh|cao|size)\s*(\d+(?:[.,]\d+)?(?:\s*m\s*\d{1,2})?)/iu', $body, $sizeMatch) !== 1) {
                preg_match('/\b(\d{2,3})(?:\s*cm)?\b/u', $body, $sizeMatch);
            }
            $sizeText = isset($sizeMatch[1]) ? trim((string) $sizeMatch[1]) : null;
            $name = $body;
            if ($sizeText) {
                $name = trim((string) preg_replace(
                    '/(?:phi|dk|duong kinh|cao|size)?\s*' . preg_quote((string) $sizeMatch[1], '/') . '(?:\s*cm)?/iu',
                    '',
                    $body,
                    1
                ));
                $name = preg_replace('/\s+/u', ' ', $name) ?: $name;
            }

            return [
                'source_phrase' => $segment,
                'quantity' => $quantity,
                'quantity_specified' => $quantitySpecified,
                'name' => $name,
                'normalized_name' => $name,
                'category_hint' => null,
                'size_text' => $sizeText,
                'size_kind' => str_contains($this->normalizeText($body), 'cao') ? 'height' : 'unknown',
                'qualifiers' => [],
                'bonus' => $bonus,
                'notes' => null,
            ];
        })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeRequestedItem(mixed $item, int $index, array $definitionEntries = []): array
    {
        $source = is_array($item) ? $item : [];
        $sourcePhrase = trim((string) ($source['source_phrase'] ?? ''));
        $rawParsedName = trim((string) ($source['name'] ?? $source['normalized_name'] ?? ''));
        $parsedName = $this->sanitizeRequestedNameText($rawParsedName !== '' ? $rawParsedName : $sourcePhrase);
        $definitionExpandedValues = $this->expandValuesWithDefinitionEntries([
            $parsedName,
            $rawParsedName,
            $source['normalized_name'] ?? '',
            $source['category_hint'] ?? '',
            $sourcePhrase,
            (string) ($source['notes'] ?? ''),
        ], $definitionEntries);
        $canonicalName = $this->detectKnownItemCanonicalName([
            $parsedName,
            $rawParsedName,
            $source['normalized_name'] ?? '',
            $source['category_hint'] ?? '',
            $sourcePhrase,
            ...$definitionExpandedValues,
        ]);
        $definitionResolvedName = $this->resolveDefinitionCanonicalPhrase([
            $parsedName,
            $rawParsedName,
            $source['normalized_name'] ?? '',
            $sourcePhrase,
        ], $definitionEntries);
        $resolvedName = $definitionResolvedName
            ?: $this->resolveRequestedItemName($parsedName, $canonicalName);
        $sizeInfo = $this->extractDimensionInfo((string) ($source['size_text'] ?? ''));
        $qualifiers = collect([
            ...(is_array($source['qualifiers'] ?? null) ? $source['qualifiers'] : []),
            ...$this->extractImplicitQualifiersFromText(implode(' ', array_filter([
                $sourcePhrase,
                $rawParsedName,
                $parsedName,
                ...$definitionExpandedValues,
                (string) ($source['notes'] ?? ''),
            ]))),
        ])
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();
        $quantitySpecified = $this->inferQuantitySpecified($source, $sourcePhrase);

        return [
            'line_key' => trim((string) ($source['line_key'] ?? '')) ?: 'ai-line-' . ($index + 1),
            'source_phrase' => trim((string) ($sourcePhrase ?: $resolvedName)),
            'quantity' => max(1, (int) ($source['quantity'] ?? 1)),
            'quantity_specified' => $quantitySpecified,
            'parsed_name' => $resolvedName,
            'canonical_name' => $canonicalName,
            'normalized_name' => $this->normalizeText($resolvedName),
            'category_hint' => trim((string) ($source['category_hint'] ?? '')),
            'qualifiers' => $qualifiers,
            'bonus' => (bool) ($source['bonus'] ?? false),
            'notes' => trim((string) ($source['notes'] ?? '')),
            'size' => [
                'raw' => trim((string) ($source['size_text'] ?? '')),
                'kind' => $this->normalizeSizeKind((string) ($source['size_kind'] ?? 'unknown')),
                'normalized_cm' => $sizeInfo['normalized_cm'],
                'tokens' => $sizeInfo['tokens'],
            ],
            'aliases' => $this->expandKnownAliases([
                $resolvedName,
                $canonicalName ?? '',
                $rawParsedName,
                $source['normalized_name'] ?? '',
                $source['category_hint'] ?? '',
                $sourcePhrase,
                ...$definitionExpandedValues,
            ]),
        ];
    }

    private function mapRequestedItem(Collection $catalogEntries, array $item, ?array $altarContext): array
    {
        $matchedRuleItem = $this->resolveMatchedRuleItem($item, $altarContext);
        $contextProfile = $this->buildAltarContextProfile($catalogEntries, $altarContext);
        // Cham diem tat ca entries, kem tier uu tien
        $scoredCandidates = $catalogEntries
            ->map(function (array $entry) use ($item, $matchedRuleItem, $contextProfile) {
                $scored = $this->scoreCatalogEntryWithFamilyGuard($entry, $item, $matchedRuleItem, $contextProfile);

                return [
                    ...$entry,
                    'match_score'   => $scored['score'],
                    'match_reasons' => $scored['reasons'],
                    'tier'          => $scored['tier'] ?? 3,
                ];
            })
            ->filter(fn (array $entry) => $entry['match_score'] > 0)
            // Sap xep: tier thap truoc (1=train, 2=cung nhom, 3=ngoai), roi score cao truoc
            ->sortBy([['tier', 'asc'], ['match_score', 'desc']])
            ->values();

        $topCandidate    = $scoredCandidates->get(0);
        $secondCandidate = $scoredCandidates->get(1);
        $topScore        = (int) ($topCandidate['match_score'] ?? 0);
        $topTier         = (int) ($topCandidate['tier'] ?? 3);
        $gapScore        = $topScore - (int) ($secondCandidate['match_score'] ?? 0);
        $confidence      = $this->resolveConfidence($topScore, $gapScore, $matchedRuleItem !== null, $topTier);

        // Chi danh dau matched khi vuot nguong confidence cao.
        // Cac ket qua nam trong tier uu tien (rule/train hoac cung nhom train)
        // van duoc giu selected_entry o trang thai review de nguoi dung xac nhan.
        $isConfidentMatch = $confidence >= self::CONFIDENT_MATCH_THRESHOLD;
        $shouldKeepReviewedSelection = $topCandidate !== null
            && $topScore >= self::AUTO_SELECT_MIN_SCORE
            && ($matchedRuleItem !== null || $topTier <= 2);

        $selectedEntry = null;
        $matchStatus   = 'unresolved';

        if ($topCandidate !== null && $topScore >= self::AUTO_SELECT_MIN_SCORE && ($isConfidentMatch || $shouldKeepReviewedSelection)) {
            $selectedEntry = $this->trimCatalogEntry($topCandidate);
            $matchStatus   = $isConfidentMatch ? 'matched' : 'review';
        }
        // Cac ket qua ngoai tier uu tien van de unresolved de nguoi dung tu them tay.

        $resolvedQuantity = $item['quantity'];
        if (
            !$item['quantity_specified']
            && $matchedRuleItem !== null
            && (int) ($matchedRuleItem['default_quantity'] ?? 0) > 0
        ) {
            $resolvedQuantity = max(1, (int) ($matchedRuleItem['default_quantity'] ?? 1));
        }

        return [
            'line_key' => $item['line_key'],
            'source_phrase' => $item['source_phrase'],
            'quantity' => $resolvedQuantity,
            'bonus' => $item['bonus'],
            'notes' => $item['notes'],
            'parsed_name' => $item['parsed_name'],
            'parsed_size' => [
                'raw' => $item['size']['raw'],
                'kind' => $item['size']['kind'],
                'normalized_cm' => $item['size']['normalized_cm'],
            ],
            'match_status' => $matchStatus,
            'confidence' => $confidence,
            'confidence_label' => $this->confidenceLabel($confidence),
            'selected_entry' => $selectedEntry,
            'match_reasons' => $topCandidate['match_reasons'] ?? [],
            'suggestions' => $scoredCandidates
                ->take(self::MAX_SUGGESTIONS)
                ->map(function (array $entry) {
                    $confidence = min(99, max(10, (int) round($entry['match_score'])));

                    return [
                        ...$this->trimCatalogEntry($entry),
                        'confidence' => $confidence,
                        'confidence_label' => $this->confidenceLabel($confidence),
                        'match_score' => (int) $entry['match_score'],
                        'match_reasons' => $entry['match_reasons'],
                    ];
                })
                ->values()
                ->all(),
            'matched_rule' => $matchedRuleItem
                ? [
                    'id' => $matchedRuleItem['id'],
                    'alias' => $matchedRuleItem['aliases'][0] ?? $matchedRuleItem['display_name'] ?? '',
                    'altar_size_label' => $altarContext['altar_size_label'] ?? '',
                    'context_label' => $altarContext['_resolved_context_alias'] ?? ($altarContext['context_aliases'][0] ?? ''),
                ]
                : null,
        ];
    }

    private function buildMappedItemsFromRuleGroup(array $altarContext): Collection
    {
        return collect($altarContext['items'] ?? [])
            ->map(function (array $ruleItem, int $index) use ($altarContext) {
                $quantity = max(1, (int) ($ruleItem['default_quantity'] ?? 1));
                $seedLabel = trim((string) ($ruleItem['aliases'][0] ?? $ruleItem['display_name'] ?? $ruleItem['option_label'] ?? ''));
                $sizeInfo = $this->extractDimensionInfo(implode(' ', array_filter([
                    $ruleItem['display_name'] ?? '',
                    $ruleItem['option_label'] ?? '',
                    $seedLabel,
                ])));

                return [
                    'line_key' => trim((string) ($ruleItem['id'] ?? '')) ?: 'altar-rule-line-' . ($index + 1),
                    'source_phrase' => $seedLabel !== '' ? $seedLabel : trim((string) ($ruleItem['display_name'] ?? '')),
                    'quantity' => $quantity,
                    'bonus' => false,
                    'notes' => '',
                    'parsed_name' => $seedLabel !== '' ? $seedLabel : trim((string) ($ruleItem['display_name'] ?? '')),
                    'parsed_size' => [
                        'raw' => trim((string) ($ruleItem['option_label'] ?? '')),
                        'kind' => 'unknown',
                        'normalized_cm' => $sizeInfo['normalized_cm'],
                    ],
                    'match_status' => 'matched',
                    'confidence' => 99,
                    'confidence_label' => $this->confidenceLabel(99),
                    'selected_entry' => [
                        'entry_kind' => $ruleItem['entry_kind'] ?? self::SEARCH_ENTRY_PRODUCT,
                        'target_product_id' => (int) ($ruleItem['target_product_id'] ?? 0),
                        'parent_product_id' => !empty($ruleItem['parent_product_id']) ? (int) $ruleItem['parent_product_id'] : null,
                        'parent_product_name' => $ruleItem['parent_product_name'] ?? '',
                        'name' => $ruleItem['display_name'] ?? '',
                        'display_name' => $ruleItem['display_name'] ?? '',
                        'sku' => $ruleItem['display_sku'] ?? '',
                        'display_sku' => $ruleItem['display_sku'] ?? '',
                        'option_label' => $ruleItem['option_label'] ?? '',
                        'attribute_summary' => $ruleItem['option_label'] ?? '',
                        'price' => round((float) ($ruleItem['price'] ?? 0), 2),
                        'cost_price' => round((float) ($ruleItem['cost_price'] ?? 0), 2),
                        'expected_cost' => isset($ruleItem['cost_price']) ? round((float) ($ruleItem['cost_price'] ?? 0), 2) : null,
                        'main_image' => $ruleItem['main_image'] ?? '',
                        'attribute_values' => [],
                        'categories' => [],
                    ],
                    'match_reasons' => ['Theo rule ban thờ đã học'],
                    'suggestions' => [],
                    'matched_rule' => [
                        'id' => $ruleItem['id'] ?? '',
                        'alias' => $ruleItem['aliases'][0] ?? $ruleItem['display_name'] ?? '',
                        'altar_size_label' => $altarContext['altar_size_label'] ?? '',
                        'context_label' => $altarContext['_resolved_context_alias'] ?? ($altarContext['context_aliases'][0] ?? ''),
                    ],
                ];
            })
            ->filter(fn (array $item) => !empty($item['selected_entry']['target_product_id']))
            ->values();
    }

    private function buildRulePreviewItemFromMappedLine(array $mappedItem, int $index): ?array
    {
        $selectedEntry = $mappedItem['selected_entry'] ?? null;
        $targetProductId = (int) ($selectedEntry['target_product_id'] ?? 0);
        if ($targetProductId <= 0) {
            return null;
        }

        $sourcePhrase = trim((string) ($mappedItem['source_phrase'] ?? ''));
        $parsedName = trim((string) ($mappedItem['parsed_name'] ?? ''));
        $optionLabel = trim((string) ($selectedEntry['option_label'] ?? ''));
        $displayName = trim((string) ($selectedEntry['display_name'] ?? $selectedEntry['name'] ?? ''));

        return [
            'id' => trim((string) ($mappedItem['line_key'] ?? '')) ?: "order-ai-rule-preview-" . ($index + 1),
            'aliases' => $this->normalizeAliasList([
                $parsedName,
                $sourcePhrase,
                $displayName,
                $optionLabel,
            ], 12),
            'default_quantity' => max(1, (int) ($mappedItem['quantity'] ?? 1)),
            'target_product_id' => $targetProductId,
            'parent_product_id' => !empty($selectedEntry['parent_product_id']) ? (int) $selectedEntry['parent_product_id'] : null,
            'entry_kind' => trim((string) ($selectedEntry['entry_kind'] ?? self::SEARCH_ENTRY_PRODUCT)) === self::SEARCH_ENTRY_VARIATION
                ? self::SEARCH_ENTRY_VARIATION
                : self::SEARCH_ENTRY_PRODUCT,
            'display_name' => $displayName,
            'display_sku' => trim((string) ($selectedEntry['display_sku'] ?? $selectedEntry['sku'] ?? '')),
            'option_label' => $optionLabel,
            'main_image' => trim((string) ($selectedEntry['main_image'] ?? '')),
            'price' => round((float) ($selectedEntry['price'] ?? 0), 2),
            'cost_price' => round((float) ($selectedEntry['cost_price'] ?? 0), 2),
            'confidence' => (int) ($mappedItem['confidence'] ?? 0),
            'confidence_label' => $mappedItem['confidence_label'] ?? $this->confidenceLabel((int) ($mappedItem['confidence'] ?? 0)),
            'match_status' => $mappedItem['match_status'] ?? 'matched',
            'source_phrase' => $sourcePhrase,
            'parsed_name' => $parsedName,
        ];
    }

    private function resolveMatchedRuleItem(array $item, ?array $altarContext): ?array
    {
        if (!$altarContext || empty($altarContext['items'])) {
            return null;
        }

        $queryTerms = collect([
            $item['parsed_name'],
            $item['normalized_name'],
            $item['canonical_name'],
            $item['category_hint'],
            ...$item['aliases'],
        ])
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values();
        $itemQualifiers = collect($item['qualifiers'] ?? [])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->unique()
            ->values()
            ->all();
        $itemSizeRaw = $this->normalizeText((string) ($item['size']['raw'] ?? ''));
        $itemSizeCm = $item['size']['normalized_cm'] ?? null;

        $bestItem = null;
        $bestScore = 0;
        $bestSizeCompatibility = 'unknown';

        foreach ($altarContext['items'] as $ruleItem) {
            $score = 0;
            $sizeCompatibility = 'unknown';

            foreach (($ruleItem['aliases'] ?? []) as $alias) {
                $normalizedAlias = $this->normalizeText($alias);
                if ($normalizedAlias === '') {
                    continue;
                }

                foreach ($queryTerms as $queryTerm) {
                    $normalizedQuery = $this->normalizeText($queryTerm);
                    if ($normalizedQuery === '') {
                        continue;
                    }

                    if ($normalizedAlias === $normalizedQuery) {
                        $score = max($score, 100);
                        break 2;
                    }

                    if (str_contains($normalizedAlias, $normalizedQuery) || str_contains($normalizedQuery, $normalizedAlias)) {
                        $score = max($score, 72);
                    } else {
                        $overlap = count(array_intersect($this->tokenize($normalizedAlias), $this->tokenize($normalizedQuery)));
                        if ($overlap > 0) {
                            $score = max($score, 30 + ($overlap * 12));
                        }
                    }
                }
            }

            $ruleText = $this->normalizeText(implode(' ', array_filter([
                $ruleItem['display_name'] ?? '',
                $ruleItem['option_label'] ?? '',
                implode(' ', $ruleItem['aliases'] ?? []),
            ])));

            foreach ($itemQualifiers as $qualifier) {
                if ($qualifier !== '' && str_contains($ruleText, $qualifier)) {
                    $score += 18;
                }
            }

            if ($itemSizeRaw !== '') {
                $ruleSize = $this->extractDimensionInfo($ruleText);
                $ruleSizeCm = $ruleSize['normalized_cm'] ?? null;
                $ruleHasSizeSignal = $ruleSizeCm !== null || !empty($ruleSize['tokens']);

                if ($itemSizeCm !== null && $ruleSizeCm !== null) {
                    if (abs((float) $itemSizeCm - (float) $ruleSizeCm) < 0.1) {
                        $score += 48;
                        $sizeCompatibility = 'match';
                    } else {
                        $score -= 42;
                        $sizeCompatibility = 'mismatch';
                    }
                } elseif (in_array($itemSizeRaw, $ruleSize['tokens'] ?? [], true)) {
                    $score += 40;
                    $sizeCompatibility = 'match';
                } elseif ($ruleHasSizeSignal) {
                    $score -= 42;
                    $sizeCompatibility = 'mismatch';
                }
            }

            if (
                $score > $bestScore
                || ($score === $bestScore && $sizeCompatibility === 'match' && $bestSizeCompatibility !== 'match')
            ) {
                $bestScore = $score;
                $bestItem = $ruleItem;
                $bestSizeCompatibility = $sizeCompatibility;
            }
        }

        if ($bestScore < 42) {
            return null;
        }

        if ($itemSizeRaw !== '' && $bestSizeCompatibility === 'mismatch') {
            return null;
        }

        return $bestItem;
    }

    private function matchAltarRuleGroup(array $rules, mixed $altarSignal, string $rawText): ?array
    {
        $candidates = array_filter([
            $this->extractAltarSizeSignal($altarSignal),
            $this->extractAltarSizeSignal($rawText),
        ]);

        if ($candidates === []) {
            return null;
        }

        $normalizedRawText = $this->normalizeText($rawText);
        $rawTokens = $this->tokenize($normalizedRawText);
        $rawContextTerms = $this->suggestRuleContextAliases('', $rawText);
        $scoredGroups = [];

        foreach ($rules as $group) {
            $groupAliases = [
                $group['altar_size_label'] ?? '',
                ...($group['altar_size_aliases'] ?? []),
            ];
            $groupKeys = collect($groupAliases)
                ->map(fn ($value) => $this->normalizeAltarSizeToken($value))
                ->filter()
                ->unique()
                ->values()
                ->all();
            $sizeScore = 0;

            foreach ($candidates as $candidate) {
                $candidateKey = $this->normalizeAltarSizeToken($candidate['label'] ?? '');
                if ($candidateKey === '') {
                    continue;
                }

                if (in_array($candidateKey, $groupKeys, true)) {
                    $sizeScore = max($sizeScore, 100);
                    continue;
                }

                foreach ($groupKeys as $groupKey) {
                    if ($groupKey !== '' && str_contains($groupKey, $candidateKey)) {
                        $sizeScore = max($sizeScore, 72);
                    }
                }
            }

            if ($sizeScore <= 0) {
                continue;
            }

            $groupContextAliases = collect($group['context_aliases'] ?? [])
                ->map(fn ($value) => trim((string) $value))
                ->filter()
                ->unique(fn ($value) => $this->normalizeText($value))
                ->values()
                ->all();
            $contextScore = 0;
            $matchedContextAlias = '';

            if ($groupContextAliases !== []) {
                foreach ($groupContextAliases as $contextAlias) {
                    $normalizedAlias = $this->normalizeText($contextAlias);
                    if ($normalizedAlias === '') {
                        continue;
                    }

                    if (str_contains($normalizedRawText, $normalizedAlias)) {
                        $contextScore = max($contextScore, 64 + min(16, count($this->tokenize($normalizedAlias)) * 4));
                        $matchedContextAlias = $contextAlias;
                        continue;
                    }

                    $overlap = count(array_intersect($this->tokenize($normalizedAlias), $rawTokens));
                    if ($overlap > 0) {
                        $contextScore = max($contextScore, 18 + ($overlap * 12));
                        if ($matchedContextAlias === '') {
                            $matchedContextAlias = $contextAlias;
                        }
                    }
                }

                if ($contextScore === 0) {
                    $contextScore = -38;
                }
            } else {
                $contextScore = $rawContextTerms === [] ? 14 : -6;
            }

            $scoredGroups[] = [
                'group' => $group,
                'score' => $sizeScore + $contextScore,
                'size_score' => $sizeScore,
                'context_score' => $contextScore,
                'matched_context_alias' => $matchedContextAlias,
                'has_context_aliases' => $groupContextAliases !== [],
            ];
        }

        if ($scoredGroups === []) {
            return null;
        }

        usort($scoredGroups, fn (array $left, array $right) => ($right['score'] <=> $left['score']));
        $bestGroup = $scoredGroups[0] ?? null;
        $secondGroup = $scoredGroups[1] ?? null;
        if ($bestGroup === null) {
            return null;
        }

        $bestScore = (int) ($bestGroup['score'] ?? 0);
        $gapScore = $bestScore - (int) ($secondGroup['score'] ?? 0);
        $sameSizeCandidatesCount = count(array_filter($scoredGroups, fn (array $entry) => (int) ($entry['size_score'] ?? 0) >= 72));

        if ($bestScore < 80 && !($sameSizeCandidatesCount === 1 && $bestScore >= 60)) {
            return null;
        }

        if ($sameSizeCandidatesCount > 1 && $gapScore <= 8 && (int) ($bestGroup['context_score'] ?? 0) <= 0) {
            return null;
        }

        $resolvedGroup = $bestGroup['group'];
        $resolvedGroup['_resolved_context_alias'] = trim((string) ($bestGroup['matched_context_alias'] ?? ''));
        $resolvedGroup['_force_rule_group'] = false;

        return $resolvedGroup;
    }

    private function resolvePreferredRuleGroup(int $accountId, string $preferredRuleKey, array $rules): ?array
    {
        if ($preferredRuleKey === '') {
            return null;
        }

        $directMatch = collect($rules)
            ->first(fn (array $group) => trim((string) ($group['rule_key'] ?? '')) === $preferredRuleKey);

        if (is_array($directMatch)) {
            $directMatch['_resolved_context_alias'] = trim((string) (($directMatch['context_aliases'][0] ?? '')));
            $directMatch['_force_rule_group'] = true;
            return $directMatch;
        }

        $datasetRule = $this->orderAiTrainingService->findRuleGroupByKey($accountId, $preferredRuleKey);
        if (!is_array($datasetRule)) {
            return null;
        }

        $resolvedRule = $this->normalizeRules([$datasetRule])[0] ?? null;
        if (!is_array($resolvedRule)) {
            return null;
        }

        $resolvedRule['_resolved_context_alias'] = trim((string) (($resolvedRule['context_aliases'][0] ?? '')));
        $resolvedRule['_force_rule_group'] = true;
        return $resolvedRule;
    }

    private function extractAltarSizeSignal(mixed $value): ?array
    {
        if (is_array($value)) {
            $raw = trim((string) ($value['raw'] ?? $value['normalized_label'] ?? $value['label'] ?? ''));
            if ($raw !== '') {
                return ['label' => $raw];
            }

            return null;
        }

        $text = trim((string) $value);
        if ($text === '') {
            return null;
        }

        $normalizedText = $this->normalizeText($text);

        if (preg_match('/(?:ban)(?:\s+tho)?\s*(\d+(?:[.,]\d+)?\s*m\s*\d{0,2}|\d{3})/u', $normalizedText, $matches) === 1) {
            return ['label' => trim((string) $matches[1])];
        }

        if (preg_match('/\b(\d\s*[.,]?\s*\d{0,2}\s*m\s*\d{1,2})\b/u', $normalizedText, $matches) === 1) {
            return ['label' => trim((string) $matches[1])];
        }

        return null;
    }

    private function normalizeAltarSizeToken(mixed $value): string
    {
        $text = $this->normalizeText((string) $value);
        if ($text === '') {
            return '';
        }

        if (preg_match('/(\d)\s*m\s*(\d{1,2})/u', $text, $matches) === 1) {
            return (string) (((int) $matches[1]) * 100 + ((int) $matches[2]));
        }

        $digits = preg_replace('/\D+/', '', $text) ?: '';
        if (strlen($digits) >= 3 && strlen($digits) <= 4) {
            return ltrim($digits, '0');
        }

        return $digits;
    }

    private function loadCatalogEntries(int $accountId): Collection
    {
        $products = Product::query()
            ->where('account_id', $accountId)
            ->whereDoesntHave('parentConfigurable')
            ->with([
                'images:id,product_id,image_url,is_primary,sort_order',
                'categories:id,name',
                'attributeValues:id,product_id,attribute_id,value',
                'variations:id,sku,name,price,cost_price,expected_cost,type',
                'variations.attributeValues:id,product_id,attribute_id,value',
                'variations.images:id,product_id,image_url,is_primary,sort_order',
            ])
            ->get();

        $entries = [];

        foreach ($products as $product) {
            $baseEntry = $this->makeCatalogEntry($product);
            $hasVariations = $product->type === 'configurable' && $product->variations->isNotEmpty();

            if (!$hasVariations) {
                $entries[] = $baseEntry;
            }

            foreach ($product->variations as $variation) {
                $entries[] = $this->makeCatalogEntry($variation, $product);
            }
        }

        return collect($entries);
    }

    private function makeCatalogEntry(Product $product, ?Product $parentProduct = null): array
    {
        $attributeSummary = $this->attributeSummary($product);
        $displayName = $parentProduct
            ? trim($parentProduct->name . ($attributeSummary !== '' ? " - {$attributeSummary}" : ''))
            : trim((string) $product->name);
        $categories = $parentProduct
            ? $parentProduct->categories->pluck('name')->filter()->values()->all()
            : $product->categories->pluck('name')->filter()->values()->all();
        $sizeSource = implode(' ', array_filter([
            $displayName,
            $attributeSummary,
            trim((string) $product->name),
        ]));
        $sizeInfo = $this->extractDimensionInfo($sizeSource);

        return [
            'entry_kind' => $parentProduct ? self::SEARCH_ENTRY_VARIATION : self::SEARCH_ENTRY_PRODUCT,
            'target_product_id' => (int) $product->id,
            'parent_product_id' => $parentProduct ? (int) $parentProduct->id : null,
            'parent_product_name' => $parentProduct ? trim((string) $parentProduct->name) : '',
            'name' => trim((string) $product->name),
            'display_name' => $displayName,
            'sku' => trim((string) $product->sku),
            'display_sku' => trim((string) ($product->sku ?: $parentProduct?->sku)),
            'option_label' => $parentProduct ? $attributeSummary : '',
            'attribute_summary' => $attributeSummary,
            'attribute_text' => $this->normalizeText($attributeSummary),
            'price' => round((float) ($product->price ?? 0), 2),
            'cost_price' => round((float) ($product->cost_price ?? $product->expected_cost ?? 0), 2),
            'expected_cost' => $product->expected_cost !== null ? round((float) $product->expected_cost, 2) : null,
            'main_image' => $this->primaryImage($product) ?: ($parentProduct ? $this->primaryImage($parentProduct) : ''),
            'attribute_values' => $this->attributePayload($product),
            'categories' => $categories,
            'search_text' => $this->normalizeText(implode(' ', array_filter([
                $displayName,
                $product->name,
                $product->sku,
                $attributeSummary,
                implode(' ', $categories),
            ]))),
            'size_tokens' => $sizeInfo['tokens'],
            'size_cm' => $sizeInfo['normalized_cm'],
        ];
    }

    private function primaryImage(Product $product): string
    {
        $primaryImage = $product->images->firstWhere('is_primary', true)
            ?: $product->images->sortBy('sort_order')->first();

        return trim((string) ($primaryImage?->image_url ?? ''));
    }

    private function attributePayload(Product $product): array
    {
        return $product->attributeValues
            ->map(fn ($attributeValue) => [
                'attribute_id' => (int) $attributeValue->attribute_id,
                'value' => $attributeValue->value,
            ])
            ->values()
            ->all();
    }

    private function attributeSummary(Product $product): string
    {
        return collect($this->attributePayload($product))
            ->flatMap(function (array $attributeValue) {
                $rawValue = $attributeValue['value'] ?? null;

                if (is_string($rawValue)) {
                    $trimmed = trim($rawValue);
                    if ($trimmed !== '' && (
                        (str_starts_with($trimmed, '[') && str_ends_with($trimmed, ']'))
                        || (str_starts_with($trimmed, '{') && str_ends_with($trimmed, '}'))
                    )) {
                        $decoded = json_decode($trimmed, true);
                        if (is_array($decoded)) {
                            return collect($decoded)->flatten(1)->map(fn ($value) => trim((string) $value))->filter();
                        }
                    }
                }

                return [trim((string) $rawValue)];
            })
            ->filter()
            ->unique()
            ->implode(' / ');
    }

    private function buildAltarContextProfile(Collection $catalogEntries, ?array $altarContext): array
    {
        $preferredTargetIds = collect($altarContext['items'] ?? [])
            ->map(fn (array $ruleItem) => (int) ($ruleItem['target_product_id'] ?? 0))
            ->filter(fn (int $targetProductId) => $targetProductId > 0)
            ->unique()
            ->values()
            ->all();
        $contextEntries = $preferredTargetIds === []
            ? collect()
            : $catalogEntries
                ->filter(fn (array $entry) => in_array((int) ($entry['target_product_id'] ?? 0), $preferredTargetIds, true))
                ->values();
        $categoryTerms = $contextEntries
            ->flatMap(fn (array $entry) => $this->normalizeEntryCategories($entry))
            ->countBy()
            ->sortDesc()
            ->keys()
            ->take(8)
            ->values()
            ->all();
        $attributeTerms = collect([
            trim((string) ($altarContext['_resolved_context_alias'] ?? '')),
            ...($altarContext['context_aliases'] ?? []),
            ...$contextEntries
                ->flatMap(fn (array $entry) => [
                    $entry['attribute_summary'] ?? '',
                    $entry['option_label'] ?? '',
                ])
                ->all(),
        ])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter(fn (string $value) => $value !== '' && strlen($value) >= 3)
            ->unique()
            ->take(12)
            ->values()
            ->all();

        return [
            'preferred_target_ids' => $preferredTargetIds,
            'attribute_terms' => $attributeTerms,
            'category_terms' => $categoryTerms,
            'force_rule_group' => (bool) ($altarContext['_force_rule_group'] ?? false),
        ];
    }

    private function normalizeEntryCategories(array $entry): array
    {
        return collect($entry['categories'] ?? [])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function resolveKnownAttributeQualifierLabel(string $normalizedQualifier): ?string
    {
        $needle = trim($normalizedQualifier);
        if ($needle === '') {
            return null;
        }

        foreach (self::KNOWN_ATTRIBUTE_QUALIFIERS as $label => $aliases) {
            foreach ([$label, ...$aliases] as $candidate) {
                if ($this->normalizeText((string) $candidate) === $needle) {
                    return $this->normalizeText($label);
                }
            }
        }

        return null;
    }

    /**
     * Cham diem voi he thong uu tien 3 tang:
     * Tier 1: Train data chinh xac (matchedRuleItem hoac preferredTargetIds)
     * Tier 2: Cung danh muc / thuoc tinh voi bo train
     * Tier 3: Ngoai nhom (fallback)
     *
     * Phat nang khi sai size (tra 0 diem) hoac sai attribute (tra 0 diem).
     */
    private function scoreCatalogEntry(array $entry, array $item, ?array $matchedRuleItem, array $contextProfile = []): array
    {
        $score         = 0;
        $reasons       = [];
        $tier          = 3;
        $searchText    = $entry['search_text'] ?? '';
        $attributeText = $entry['attribute_text'] ?? '';
        $entryTargetId = (int) ($entry['target_product_id'] ?? 0);

        $preferredTargetIds = collect($contextProfile['preferred_target_ids'] ?? [])
            ->map(fn ($value) => (int) $value)
            ->filter()
            ->values()
            ->all();

        $contextAttributeTerms = collect($contextProfile['attribute_terms'] ?? [])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->values()
            ->all();

        $contextCategoryTerms = collect($contextProfile['category_terms'] ?? [])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->values()
            ->all();

        $entryCategories = $this->normalizeEntryCategories($entry);
        $itemName        = $this->normalizeText($item['parsed_name']);
        $canonicalName   = $this->normalizeText($item['canonical_name'] ?? '');
        $categoryHint    = $this->normalizeText($item['category_hint']);
        $qualifiers      = collect($item['qualifiers'] ?? [])
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();

        $queryTokens = collect([
            ...$this->tokenize($itemName),
            ...$this->tokenize($canonicalName),
            ...$this->tokenize($categoryHint),
            ...collect($qualifiers)->flatMap(fn ($value) => $this->tokenize($value))->all(),
        ])->filter()->unique()->values()->all();

        // ===== KIEM TRA SIZE: Phat nang neu sai size =====
        $sizeRaw         = $this->normalizeText($item['size']['raw'] ?? '');
        $itemSizeCm      = $item['size']['normalized_cm'] ?? null;
        $entrySizeTokens = collect($entry['size_tokens'] ?? [])
            ->map(fn ($value) => $this->normalizeText($value))
            ->filter()
            ->all();
        $entrySizeCm     = $entry['size_cm'] ?? null;
        $entryHasSize    = $entrySizeCm !== null || !empty($entrySizeTokens);

        $sizeMatched    = false;
        $sizeMismatched = false;

        if ($sizeRaw !== '') {
            if ($itemSizeCm !== null && $entrySizeCm !== null) {
                if (abs((float) $itemSizeCm - (float) $entrySizeCm) < 0.1) {
                    $sizeMatched = true;
                } else {
                    $sizeMismatched = true;
                }
            } elseif (in_array($sizeRaw, $entrySizeTokens, true)) {
                $sizeMatched = true;
            } elseif ($entryHasSize) {
                $sizeMismatched = true;
            }
        }

        if ($sizeMismatched) {
            return ['score' => 0, 'reasons' => ['Sai kich thuoc - bo qua'], 'tier' => 3];
        }

        if ($sizeMatched) {
            $score    += 50;
            $reasons[] = 'Khop kich thuoc';
        }

        // ===== KIEM TRA ATTRIBUTE: Phat nang neu sai attribute =====
        $itemQualifierNorms = collect($qualifiers)
            ->map(fn ($value) => $this->normalizeText($value))
            ->filter()
            ->values()
            ->all();

        $attributeMismatch = false;
        $attributeMatch    = false;

        if ($itemQualifierNorms !== []) {
            foreach ($itemQualifierNorms as $qNorm) {
                if (str_contains($attributeText, $qNorm) || str_contains($searchText, $qNorm)) {
                    $attributeMatch = true;
                    $score    += 30;
                    $reasons[] = 'Khop thuoc tinh';
                } else {
                    $matchedQualifierLabel = $this->resolveKnownAttributeQualifierLabel($qNorm);
                    if ($matchedQualifierLabel === null || $matchedQualifierLabel === 'ca de') {
                        continue;
                    }

                    $hasConflictingAttribute = false;
                    foreach (self::KNOWN_ATTRIBUTE_QUALIFIERS as $attrLabel => $attrAliases) {
                        if ($this->normalizeText($attrLabel) === $matchedQualifierLabel) {
                            continue;
                        }
                        foreach ($attrAliases as $attrAlias) {
                            $normalizedAttrAlias = $this->normalizeText($attrAlias);
                            if ($normalizedAttrAlias !== '' && str_contains($attributeText, $normalizedAttrAlias)) {
                                $hasConflictingAttribute = true;
                                break 2;
                            }
                        }
                    }

                    if ($hasConflictingAttribute) {
                        $attributeMismatch = true;
                        break;
                    }
                }
            }
        }

        if ($attributeMismatch) {
            return ['score' => 0, 'reasons' => ['Sai thuoc tinh (men/mau) - bo qua'], 'tier' => 3];
        }

        // ===== MATCHING TEN =====
        if ($itemName !== '' && str_contains($searchText, $itemName)) {
            $score    += 60;
            $reasons[] = 'Trung ten chinh';
        } else {
            $nameOverlap = count(array_intersect($this->tokenize($searchText), $this->tokenize($itemName)));
            if ($nameOverlap > 0) {
                $score    += 20 + ($nameOverlap * 10);
                $reasons[] = 'Khop token ten';
            }
        }

        foreach ($item['aliases'] as $alias) {
            $normalizedAlias = $this->normalizeText($alias);
            if ($normalizedAlias !== '' && str_contains($searchText, $normalizedAlias)) {
                $score    += 15;
                $reasons[] = 'Khop alias';
                break;
            }
        }

        if ($canonicalName !== '' && $canonicalName !== $itemName && str_contains($searchText, $canonicalName)) {
            $score    += 25;
            $reasons[] = 'Khop ten chuan';
        }

        if ($categoryHint !== '' && str_contains($searchText, $categoryHint)) {
            $score    += 12;
            $reasons[] = 'Khop nhom/ten phu';
        }

        // ===== UU TIEN 1: Train data - bonus tuyet doi =====
        $isInTrainData = false;

        if ($matchedRuleItem !== null && (int) ($matchedRuleItem['target_product_id'] ?? 0) === $entryTargetId) {
            $score        += self::TRAIN_PRIORITY_BONUS;
            $tier          = 1;
            $reasons[]     = 'Theo rule ban tho (train chinh xac)';
            $isInTrainData = true;
        } elseif ($matchedRuleItem === null && in_array($entryTargetId, $preferredTargetIds, true)) {
            $trainBonus    = (bool) ($contextProfile['force_rule_group'] ?? false) ? 80 : 60;
            $score        += $trainBonus;
            $tier          = 1;
            $reasons[]     = 'Co trong du lieu train';
            $isInTrainData = true;
        }

        // ===== UU TIEN 2: Cung danh muc / thuoc tinh voi bo train =====
        if (!$isInTrainData) {
            $hasSameCategoryAsTrain  = $contextCategoryTerms !== [] && array_intersect($entryCategories, $contextCategoryTerms) !== [];
            $hasSameAttributeAsTrain = false;

            if ($contextAttributeTerms !== []) {
                foreach ($contextAttributeTerms as $contextAttributeTerm) {
                    if ($contextAttributeTerm === '' || str_contains($itemName, $contextAttributeTerm)) {
                        continue;
                    }
                    if (str_contains($attributeText, $contextAttributeTerm) || str_contains($searchText, $contextAttributeTerm)) {
                        $hasSameAttributeAsTrain = true;
                        $score    += str_contains($attributeText, $contextAttributeTerm) ? 25 : 15;
                        $reasons[] = 'Cung thuoc tinh bo train';
                        break;
                    }
                }
            }

            if ($hasSameCategoryAsTrain) {
                $score    += 20;
                $tier      = 2;
                $reasons[] = 'Cung danh muc bo train';
            } elseif ($hasSameAttributeAsTrain) {
                $tier = 2;
            }
        }

        foreach ($queryTokens as $token) {
            if (str_contains($searchText, $token)) {
                $score += 3;
            }
        }

        if ($item['size']['kind'] === 'height' && str_contains($searchText, 'cao')) {
            $score += 8;
        }

        if ($entry['entry_kind'] === self::SEARCH_ENTRY_VARIATION && $sizeRaw !== '') {
            $score += 6;
        }

        return [
            'score'   => max(0, $score),
            'reasons' => collect($reasons)->unique()->values()->all(),
            'tier'    => $tier,
        ];
    }

    private function scoreCatalogEntryWithFamilyGuard(array $entry, array $item, ?array $matchedRuleItem, array $contextProfile = []): array
    {
        $scored        = $this->scoreCatalogEntry($entry, $item, $matchedRuleItem, $contextProfile);
        $searchText    = $entry['search_text'] ?? '';
        $canonicalName = $this->normalizeText((string) ($item['canonical_name'] ?? ''));

        if ($canonicalName === '') {
            return $scored;
        }

        // Phát hiện loại sản phẩm của entry (canonical family)
        $entryCanonicalName = $this->detectKnownItemCanonicalName([
            $entry['display_name'] ?? '',
            $entry['name'] ?? '',
            $entry['parent_product_name'] ?? '',
        ]);

        // Sai loại sản phẩm (vd: tìm đèn nhưng entry là bát hương) → loại hoàn toàn
        if ($entryCanonicalName !== null && $entryCanonicalName !== $canonicalName) {
            $scored['score'] = 0;
            $scored['tier']  = 3;
            return $scored;
        }

        $hasFamilyMatch = str_contains($searchText, $canonicalName);

        if (!$hasFamilyMatch) {
            foreach ($this->canonicalFamilyPhrases($canonicalName) as $alias) {
                $normalizedAlias = $this->normalizeText((string) $alias);
                if ($normalizedAlias !== '' && str_contains($searchText, $normalizedAlias)) {
                    $hasFamilyMatch = true;
                    break;
                }
            }
        }

        if (!$hasFamilyMatch) {
            // Phạt nặng hơn khi không thuộc cùng family (sai loại)
            $scored['score'] = max(0, (int) ($scored['score'] ?? 0) - self::WRONG_FAMILY_PENALTY);
        }

        return $scored;
    }

    private function resolveConfidence(int $topScore, int $gapScore, bool $hasRuleMatch, int $tier = 3): int
    {
        // Score toi da theo tier:
        // Tier 1 (train): max ~400 (TRAIN_PRIORITY_BONUS=200 + matching ~200)
        // Tier 2 (cung nhom): max ~150
        // Tier 3 (ngoai nhom): max ~100
        $maxPossibleScore = match ($tier) {
            1 => 400,
            2 => 150,
            default => 100,
        };

        $normalizedScore = min(100, max(0, (int) round(($topScore / $maxPossibleScore) * 100)));

        // Gioi han toi da confidence theo tier
        $base = match ($tier) {
            1 => min(99, max(10, $normalizedScore)),
            2 => min(85, max(10, $normalizedScore)),
            default => min(75, max(10, $normalizedScore)),
        };

        if ($gapScore >= 30) {
            $base += 5;
        } elseif ($gapScore >= 15) {
            $base += 2;
        } elseif ($gapScore <= 5 && $topScore < 150) {
            $base -= 8;
        }

        if ($hasRuleMatch) {
            $base += 4;
        }

        return max(0, min(99, $base));
    }

    private function confidenceLabel(int $confidence): string
    {
        return match (true) {
            $confidence >= 85 => 'Rất cao',
            $confidence >= 70 => 'Cao',
            $confidence >= 50 => 'Cần rà',
            $confidence > 0 => 'Thấp',
            default => 'Chưa rõ',
        };
    }

    private function trimCatalogEntry(array $entry): array
    {
        return [
            'entry_kind' => $entry['entry_kind'],
            'target_product_id' => (int) ($entry['target_product_id'] ?? 0),
            'parent_product_id' => !empty($entry['parent_product_id']) ? (int) $entry['parent_product_id'] : null,
            'parent_product_name' => $entry['parent_product_name'] ?? '',
            'name' => $entry['name'] ?? '',
            'display_name' => $entry['display_name'] ?? '',
            'sku' => $entry['sku'] ?? '',
            'display_sku' => $entry['display_sku'] ?? '',
            'option_label' => $entry['option_label'] ?? '',
            'attribute_summary' => $entry['attribute_summary'] ?? '',
            'price' => round((float) ($entry['price'] ?? 0), 2),
            'cost_price' => round((float) ($entry['cost_price'] ?? 0), 2),
            'expected_cost' => isset($entry['expected_cost']) ? round((float) ($entry['expected_cost'] ?? 0), 2) : null,
            'main_image' => $entry['main_image'] ?? '',
            'attribute_values' => $entry['attribute_values'] ?? [],
            'categories' => $entry['categories'] ?? [],
        ];
    }

    private function formatAltarContext(?array $altarContext, ?array $altarSignal = null): ?array
    {
        if ($altarContext) {
            return [
                'label' => $altarContext['altar_size_label'] ?? '',
                'aliases' => $altarContext['altar_size_aliases'] ?? [],
            ];
        }

        $signalLabel = trim((string) ($altarSignal['label'] ?? ''));
        if ($signalLabel === '') {
            return null;
        }

        return [
            'label' => $signalLabel,
            'aliases' => [],
        ];
    }

    private function sanitizeRequestedNameText(string $value): string
    {
        $normalized = $this->normalizeText($value);
        if ($normalized === '') {
            return '';
        }

        $normalized = preg_replace('/\b(?:ca de|kem de|co de)\b/u', ' ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;
        $normalized = trim($normalized);

        return match ($normalized) {
            'ong' => 'ong huong',
            'den' => 'den tho',
            'am tra', 'bo am chen', 'am chen' => 'bo am tra',
            default => $normalized,
        };
    }

    private function resolveRequestedItemName(string $parsedName, ?string $canonicalName): string
    {
        $normalizedParsedName = $this->normalizeText($parsedName);
        if ($canonicalName === null) {
            return $normalizedParsedName;
        }

        if (
            $normalizedParsedName === ''
            || count($this->tokenize($normalizedParsedName)) <= 2
            || in_array($normalizedParsedName, ['ong', 'den', 'am tra', 'bo am chen', 'am chen'], true)
            || (
                $canonicalName === 'bat huong'
                && !str_contains($normalizedParsedName, 'huong')
            )
        ) {
            return $this->canonicalDisplayName($canonicalName);
        }

        return $normalizedParsedName;
    }

    private function canonicalDisplayName(string $canonicalName): string
    {
        return self::CANONICAL_ITEM_DISPLAY_NAMES[$canonicalName] ?? $canonicalName;
    }

    private function canonicalFamilyPhrases(string $canonicalName): array
    {
        return collect([
            $canonicalName,
            ...(self::KNOWN_ITEM_ALIASES[$canonicalName] ?? []),
        ])
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter(fn ($value) => $value !== '' && (count($this->tokenize($value)) > 1 || strlen($value) >= 8))
            ->unique()
            ->values()
            ->all();
    }

    private function expandKnownAliases(array $values): array
    {
        $expanded = collect($values)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->values()
            ->all();

        foreach ($expanded as $value) {
            $canonicalName = $this->detectKnownItemCanonicalName([$value]);
            if ($canonicalName !== null) {
                $expanded = [
                    ...$expanded,
                    $canonicalName,
                    ...(self::KNOWN_ITEM_ALIASES[$canonicalName] ?? []),
                ];
            }
        }

        return collect($expanded)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();
    }

    private function extractLeadingGlobalQualifiers(string $rawText): array
    {
        $segments = collect(preg_split('/[\n,;]+/u', $rawText) ?: [])
            ->map(fn ($segment) => trim((string) $segment))
            ->filter()
            ->values();

        $qualifiers = [];

        foreach ($segments as $segment) {
            $segmentQualifiers = $this->extractImplicitQualifiersFromText($segment);
            $hasKnownItem = $this->detectKnownItemCanonicalName([$segment]) !== null;
            $hasSizeOrQuantitySignal = preg_match('/\d/u', $segment) === 1;

            if ($segmentQualifiers === [] || $hasKnownItem || $hasSizeOrQuantitySignal) {
                break;
            }

            $qualifiers = [...$qualifiers, ...$segmentQualifiers];
        }

        return collect($qualifiers)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();
    }

    private function extractImplicitQualifiersFromText(string $text): array
    {
        $normalizedText = $this->normalizeText($text);
        if ($normalizedText === '') {
            return [];
        }

        $qualifiers = [];

        foreach (self::KNOWN_ATTRIBUTE_QUALIFIERS as $label => $aliases) {
            foreach ($aliases as $alias) {
                $normalizedAlias = $this->normalizeText($alias);
                if ($normalizedAlias !== '' && str_contains($normalizedText, $normalizedAlias)) {
                    $qualifiers[] = $label;
                    break;
                }
            }
        }

        return collect($qualifiers)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique(fn ($value) => $this->normalizeText($value))
            ->values()
            ->all();
    }

    private function expandCompositeRequestedItems(Collection $items): Collection
    {
        return $items
            ->flatMap(function (array $item) {
                $expandedItems = [$item];
                $normalizedSource = $this->normalizeText(implode(' ', array_filter([
                    $item['source_phrase'] ?? '',
                    $item['parsed_name'] ?? '',
                    implode(' ', $item['qualifiers'] ?? []),
                ])));
                $hasBaseQualifier = str_contains($normalizedSource, 'ca de')
                    || str_contains($normalizedSource, 'kem de')
                    || str_contains($normalizedSource, 'co de');

                if (($item['canonical_name'] ?? '') === 'bat huong' && $hasBaseQualifier) {
                    $expandedItems[] = [
                        ...$item,
                        'line_key' => trim((string) $item['line_key']) . '-de',
                        'source_phrase' => trim((string) ($item['source_phrase'] ?? '')) . ' - de',
                        'parsed_name' => 'de bat huong',
                        'canonical_name' => 'de bat huong',
                        'normalized_name' => $this->normalizeText('de bat huong'),
                        'aliases' => $this->expandKnownAliases([
                            'de bat huong',
                            'de bat',
                            'chan de bat huong',
                        ]),
                    ];
                }

                return $expandedItems;
            })
            ->values();
    }

    private function detectKnownItemCanonicalName(array $values): ?string
    {
        $normalizedValues = collect($values)
            ->map(fn ($value) => $this->normalizeText((string) $value))
            ->filter()
            ->values()
            ->all();

        if ($normalizedValues === []) {
            return null;
        }

        $bestCanonical = null;
        $bestAliasLength = 0;

        foreach (self::KNOWN_ITEM_ALIASES as $canonicalName => $aliases) {
            foreach (array_unique([$canonicalName, ...$aliases]) as $alias) {
                $normalizedAlias = $this->normalizeText($alias);
                if ($normalizedAlias === '') {
                    continue;
                }

                foreach ($normalizedValues as $normalizedValue) {
                    if ($normalizedValue === $normalizedAlias || str_contains($normalizedValue, $normalizedAlias)) {
                        $aliasLength = strlen($normalizedAlias);
                        if ($aliasLength > $bestAliasLength) {
                            $bestAliasLength = $aliasLength;
                            $bestCanonical = $canonicalName;
                        }
                    }
                }
            }
        }

        return $bestCanonical;
    }

    private function extractDimensionInfo(string $text): array
    {
        $normalizedText = $this->normalizeText($text);
        $tokens = [];
        $normalizedCm = null;

        if ($normalizedText === '') {
            return [
                'tokens' => [],
                'normalized_cm' => null,
            ];
        }

        if (preg_match('/(\d)\s*m\s*(\d{1,2})/u', $normalizedText, $matches) === 1) {
            $normalizedCm = ((int) $matches[1] * 100) + (int) $matches[2];
            $tokens[] = (string) $normalizedCm;
            $tokens[] = trim((string) $matches[0]);
        }

        if (preg_match('/(?:phi|dk|duong kinh|cao|cm|size)\s*(\d+(?:[.,]\d+)?)/u', $normalizedText, $matches) === 1) {
            $normalizedCm = (float) str_replace(',', '.', (string) $matches[1]);
            $tokens[] = (string) $normalizedCm;
            $tokens[] = trim((string) $matches[0]);
        } elseif ($normalizedCm === null && preg_match('/\b(\d{2,3})(?:cm)?\b/u', $normalizedText, $matches) === 1) {
            $normalizedCm = (float) $matches[1];
            $tokens[] = (string) $normalizedCm;
        }

        return [
            'tokens' => collect($tokens)
                ->map(fn ($token) => $this->normalizeText((string) $token))
                ->filter()
                ->unique()
                ->values()
                ->all(),
            'normalized_cm' => $normalizedCm,
        ];
    }

    private function normalizeSizeKind(string $value): string
    {
        $normalized = $this->normalizeText($value);

        return match ($normalized) {
            'diameter' => 'diameter',
            'height' => 'height',
            'width' => 'width',
            'depth' => 'depth',
            'altar' => 'altar',
            default => 'unknown',
        };
    }

    private function tokenize(string $value): array
    {
        return collect(explode(' ', $this->normalizeText($value)))
            ->map(fn ($token) => trim((string) $token))
            ->filter(fn ($token) => strlen($token) >= 2)
            ->values()
            ->all();
    }

    private function inferQuantitySpecified(array $source, string $sourcePhrase): bool
    {
        if ($this->hasExplicitQuantitySignal($source, $sourcePhrase)) {
            return true;
        }

        if (array_key_exists('quantity_specified', $source)) {
            return (bool) $source['quantity_specified'];
        }

        return false;
    }

    private function hasExplicitQuantitySignal(array $source, string $sourcePhrase): bool
    {
        $candidates = array_filter([
            $sourcePhrase,
            trim((string) ($source['source_phrase'] ?? '')),
            trim((string) ($source['normalized_name'] ?? '')),
        ]);

        foreach ($candidates as $candidate) {
            if (preg_match('/^\s*(?:tang\s+)?\d+\b/iu', $candidate) === 1) {
                return true;
            }
        }

        return false;
    }

    private function normalizeText(string $value): string
    {
        return (string) Str::of($value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/u', ' ')
            ->squish();
    }
}
