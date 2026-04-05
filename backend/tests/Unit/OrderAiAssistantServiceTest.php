<?php

namespace Tests\Unit;

use App\Services\AI\GeminiService;
use App\Services\Orders\OrderAiAssistantService;
use App\Services\Orders\OrderAiTrainingService;
use Illuminate\Support\Collection;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class OrderAiAssistantServiceTest extends TestCase
{
    public function test_it_suggests_known_context_aliases_and_rule_key_for_training_preview(): void
    {
        $service = $this->makeService();

        $contextAliases = $this->invokePrivateMethod($service, 'suggestRuleContextAliases', ['ban 1m97, men lam', '']);
        $ruleKey = $this->invokePrivateMethod($service, 'suggestTrainingRuleKey', ['1m97', $contextAliases]);

        $this->assertSame(['men lam'], $contextAliases);
        $this->assertSame('1m97-men-lam', $ruleKey);
    }

    public function test_it_falls_back_to_short_context_phrase_when_no_known_qualifier_exists(): void
    {
        $service = $this->makeService();

        $contextAliases = $this->invokePrivateMethod($service, 'suggestRuleContextAliases', ['ban 1m97, hang ky', '']);
        $ruleKey = $this->invokePrivateMethod($service, 'suggestTrainingRuleKey', ['1m97', $contextAliases]);

        $this->assertSame(['hang ky'], $contextAliases);
        $this->assertSame('1m97-hang-ky', $ruleKey);
    }

    public function test_it_prefers_structured_text_parser_for_quantity_based_lists(): void
    {
        $geminiService = $this->createMock(GeminiService::class);
        $geminiService->expects($this->never())->method('generateText');
        $trainingService = $this->createMock(OrderAiTrainingService::class);
        $service = new OrderAiAssistantService($geminiService, $trainingService);
        $input = implode("\n", [
            '1 bát 20 cả đế',
            '2 bát 18 cả đế',
            '2 bát 16 cả đế',
            '2 lục bình cao 35',
            '1 đèn',
            '1 ong',
            '3 choé',
            '2 nậm',
            '1 kỷ ngai 5',
            '1 bộ ấm tra',
        ]);

        $result = $this->invokePrivateMethod($service, 'extractRequestedItems', [1, $input, null, [], null]);

        $this->assertSame('structured_text_parser', $result['provider']);
        $this->assertCount(10, $result['items']);
    }

    public function test_it_parses_structured_order_text_and_expands_composite_items_correctly(): void
    {
        $service = $this->makeService();
        $input = implode("\n", [
            '1 bát 20 cả đế',
            '2 bát 18 cả đế',
            '2 bát 16 cả đế',
            '2 lục bình cao 35',
            '1 đèn',
            '1 ong',
            '3 choé',
            '2 nậm',
            '1 kỷ ngai 5',
            '1 bộ ấm tra',
        ]);

        $extracted = $this->invokePrivateMethod($service, 'fallbackExtractFromText', [$input]);
        $normalized = array_map(
            fn (array $item, int $index) => $this->invokePrivateMethod($service, 'normalizeRequestedItem', [$item, $index, []]),
            $extracted,
            array_keys($extracted)
        );
        /** @var Collection<int, array> $expanded */
        $expanded = $this->invokePrivateMethod($service, 'expandCompositeRequestedItems', [new Collection($normalized)]);

        $summaries = $expanded
            ->map(fn (array $item) => [
                'canonical_name' => $item['canonical_name'] ?? '',
                'quantity' => $item['quantity'] ?? 0,
                'size' => $item['size']['raw'] ?? '',
            ])
            ->values()
            ->all();

        $this->assertContains(['canonical_name' => 'bat huong', 'quantity' => 1, 'size' => '20'], $summaries);
        $this->assertContains(['canonical_name' => 'de bat huong', 'quantity' => 1, 'size' => '20'], $summaries);
        $this->assertContains(['canonical_name' => 'bat huong', 'quantity' => 2, 'size' => '18'], $summaries);
        $this->assertContains(['canonical_name' => 'de bat huong', 'quantity' => 2, 'size' => '18'], $summaries);
        $this->assertContains(['canonical_name' => 'bat huong', 'quantity' => 2, 'size' => '16'], $summaries);
        $this->assertContains(['canonical_name' => 'de bat huong', 'quantity' => 2, 'size' => '16'], $summaries);
        $this->assertContains(['canonical_name' => 'ong huong', 'quantity' => 1, 'size' => ''], $summaries);
        $this->assertContains(['canonical_name' => 'choe', 'quantity' => 3, 'size' => ''], $summaries);
        $this->assertContains(['canonical_name' => 'bo am tra', 'quantity' => 1, 'size' => ''], $summaries);
    }

    public function test_it_preserves_explicit_quantity_and_locks_mapping_inside_preferred_rule_group(): void
    {
        $service = $this->makeService();
        $normalizedItem = $this->invokePrivateMethod($service, 'normalizeRequestedItem', [[
            'source_phrase' => '1 bát 20 cả đế',
            'quantity' => 1,
            'quantity_specified' => false,
            'name' => 'bát',
            'size_text' => '20',
            'size_kind' => 'diameter',
            'qualifiers' => ['men lam', 'cả đế'],
        ], 0, []]);

        $catalogEntries = new Collection([
            [
                'entry_kind' => 'variation',
                'target_product_id' => 101,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bộ men lam 1m97',
                'name' => 'Bát hương men lam 20',
                'display_name' => 'Bát hương men lam 20',
                'sku' => 'BAT-20-ML',
                'display_sku' => 'BAT-20-ML',
                'option_label' => 'phi 20 / men lam',
                'attribute_summary' => 'phi 20 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => [],
                'search_text' => 'bat huong men lam phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 202,
                'parent_product_id' => 22,
                'parent_product_name' => 'Bộ vẽ vàng 1m97',
                'name' => 'Bát hương vẽ vàng 20',
                'display_name' => 'Bát hương vẽ vàng 20',
                'sku' => 'BAT-20-VV',
                'display_sku' => 'BAT-20-VV',
                'option_label' => 'phi 20 / ve vang',
                'attribute_summary' => 'phi 20 / ve vang',
                'attribute_text' => 've vang',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => [],
                'search_text' => 'bat huong ve vang phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
        ]);
        $altarContext = [
            'altar_size_label' => '1m97',
            'context_aliases' => ['men lam'],
            '_resolved_context_alias' => 'men lam',
            '_force_rule_group' => true,
            'items' => [
                [
                    'id' => 'rule-bat-20',
                    'aliases' => ['bát hương 20', 'bat huong 20', 'bát'],
                    'display_name' => 'Bát hương men lam 20',
                    'option_label' => 'phi 20 / men lam',
                    'default_quantity' => 4,
                    'target_product_id' => 101,
                ],
            ],
        ];

        $mapped = $this->invokePrivateMethod($service, 'mapRequestedItem', [$catalogEntries, $normalizedItem, $altarContext]);

        $this->assertTrue($normalizedItem['quantity_specified']);
        $this->assertSame(1, $mapped['quantity']);
        $this->assertSame(101, $mapped['selected_entry']['target_product_id']);
        $this->assertSame('1m97', $mapped['matched_rule']['altar_size_label']);
        $this->assertSame('men lam', $mapped['matched_rule']['context_label']);
    }

    public function test_it_falls_back_to_catalog_when_preferred_rule_group_is_missing_requested_item(): void
    {
        $service = $this->makeService();
        $normalizedItem = $this->invokePrivateMethod($service, 'normalizeRequestedItem', [[
            'source_phrase' => '1 mam bong',
            'quantity' => 1,
            'quantity_specified' => true,
            'name' => 'mam bong',
        ], 0, []]);

        $catalogEntries = new Collection([
            [
                'entry_kind' => 'variation',
                'target_product_id' => 101,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Bat huong men lam 20',
                'display_name' => 'Bat huong men lam 20',
                'sku' => 'BAT-20-ML',
                'display_sku' => 'BAT-20-ML',
                'option_label' => 'phi 20 / men lam',
                'attribute_summary' => 'phi 20 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'bat huong men lam phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 202,
                'parent_product_id' => 22,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Mam bong men lam 30',
                'display_name' => 'Mam bong men lam 30',
                'sku' => 'MAM-30-ML',
                'display_sku' => 'MAM-30-ML',
                'option_label' => 'phi 30 / men lam',
                'attribute_summary' => 'phi 30 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'mam bong men lam phi 30',
                'size_tokens' => ['30', 'phi 30'],
                'size_cm' => 30.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 203,
                'parent_product_id' => 23,
                'parent_product_name' => 'Bo ve vang 1m97',
                'name' => 'Mam bong ve vang 30',
                'display_name' => 'Mam bong ve vang 30',
                'sku' => 'MAM-30-VV',
                'display_sku' => 'MAM-30-VV',
                'option_label' => 'phi 30 / ve vang',
                'attribute_summary' => 'phi 30 / ve vang',
                'attribute_text' => 've vang',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho ve vang'],
                'search_text' => 'mam bong ve vang phi 30',
                'size_tokens' => ['30', 'phi 30'],
                'size_cm' => 30.0,
            ],
        ]);
        $altarContext = [
            'altar_size_label' => '1m97',
            'context_aliases' => ['men lam'],
            '_resolved_context_alias' => 'men lam',
            '_force_rule_group' => true,
            'items' => [
                [
                    'id' => 'rule-bat-20',
                    'aliases' => ['bat huong 20', 'bat huong', 'bat'],
                    'display_name' => 'Bat huong men lam 20',
                    'option_label' => 'phi 20 / men lam',
                    'default_quantity' => 1,
                    'target_product_id' => 101,
                ],
            ],
        ];

        $mapped = $this->invokePrivateMethod($service, 'mapRequestedItem', [$catalogEntries, $normalizedItem, $altarContext]);

        $this->assertSame(202, $mapped['selected_entry']['target_product_id']);
        $this->assertNull($mapped['matched_rule']);
    }

    public function test_it_does_not_force_mismatched_rule_size_when_user_specifies_another_size(): void
    {
        $service = $this->makeService();
        $normalizedItem = $this->invokePrivateMethod($service, 'normalizeRequestedItem', [[
            'source_phrase' => '1 bat 16 ca de',
            'quantity' => 1,
            'quantity_specified' => true,
            'name' => 'bat',
            'size_text' => '16',
            'size_kind' => 'diameter',
            'qualifiers' => ['ca de', 'men lam'],
        ], 0, []]);

        $catalogEntries = new Collection([
            [
                'entry_kind' => 'variation',
                'target_product_id' => 101,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Bat huong men lam 20',
                'display_name' => 'Bat huong men lam 20',
                'sku' => 'BAT-20-ML',
                'display_sku' => 'BAT-20-ML',
                'option_label' => 'phi 20 / men lam',
                'attribute_summary' => 'phi 20 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'bat huong men lam phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 102,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Bat huong men lam 16',
                'display_name' => 'Bat huong men lam 16',
                'sku' => 'BAT-16-ML',
                'display_sku' => 'BAT-16-ML',
                'option_label' => 'phi 16 / men lam',
                'attribute_summary' => 'phi 16 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'bat huong men lam phi 16',
                'size_tokens' => ['16', 'phi 16'],
                'size_cm' => 16.0,
            ],
        ]);
        $altarContext = [
            'altar_size_label' => '1m97',
            'context_aliases' => ['men lam'],
            '_resolved_context_alias' => 'men lam',
            '_force_rule_group' => true,
            'items' => [
                [
                    'id' => 'rule-bat-20',
                    'aliases' => ['bat huong 20', 'bat huong', 'bat'],
                    'display_name' => 'Bat huong men lam 20',
                    'option_label' => 'phi 20 / men lam',
                    'default_quantity' => 1,
                    'target_product_id' => 101,
                ],
            ],
        ];

        $mapped = $this->invokePrivateMethod($service, 'mapRequestedItem', [$catalogEntries, $normalizedItem, $altarContext]);

        $this->assertSame(102, $mapped['selected_entry']['target_product_id']);
        $this->assertNull($mapped['matched_rule']);
    }

    public function test_it_keeps_same_size_for_bat_and_de_when_expanding_ca_de_request(): void
    {
        $service = $this->makeService();
        $normalizedItem = $this->invokePrivateMethod($service, 'normalizeRequestedItem', [[
            'source_phrase' => '1 bat 16 ca de',
            'quantity' => 1,
            'quantity_specified' => true,
            'name' => 'bat',
            'size_text' => '16',
            'size_kind' => 'diameter',
            'qualifiers' => ['ca de', 'men lam'],
        ], 0, []]);

        /** @var Collection<int, array> $expanded */
        $expanded = $this->invokePrivateMethod($service, 'expandCompositeRequestedItems', [new Collection([$normalizedItem])]);

        $catalogEntries = new Collection([
            [
                'entry_kind' => 'variation',
                'target_product_id' => 101,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Bat huong men lam 20',
                'display_name' => 'Bat huong men lam 20',
                'sku' => 'BAT-20-ML',
                'display_sku' => 'BAT-20-ML',
                'option_label' => 'phi 20 / men lam',
                'attribute_summary' => 'phi 20 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'bat huong men lam phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 102,
                'parent_product_id' => 11,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'Bat huong men lam 16',
                'display_name' => 'Bat huong men lam 16',
                'sku' => 'BAT-16-ML',
                'display_sku' => 'BAT-16-ML',
                'option_label' => 'phi 16 / men lam',
                'attribute_summary' => 'phi 16 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'bat huong men lam phi 16',
                'size_tokens' => ['16', 'phi 16'],
                'size_cm' => 16.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 201,
                'parent_product_id' => 12,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'De bat huong men lam 20',
                'display_name' => 'De bat huong men lam 20',
                'sku' => 'DE-20-ML',
                'display_sku' => 'DE-20-ML',
                'option_label' => 'phi 20 / men lam',
                'attribute_summary' => 'phi 20 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'de bat huong men lam phi 20',
                'size_tokens' => ['20', 'phi 20'],
                'size_cm' => 20.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 202,
                'parent_product_id' => 12,
                'parent_product_name' => 'Bo men lam 1m97',
                'name' => 'De bat huong men lam 16',
                'display_name' => 'De bat huong men lam 16',
                'sku' => 'DE-16-ML',
                'display_sku' => 'DE-16-ML',
                'option_label' => 'phi 16 / men lam',
                'attribute_summary' => 'phi 16 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Do tho men lam'],
                'search_text' => 'de bat huong men lam phi 16',
                'size_tokens' => ['16', 'phi 16'],
                'size_cm' => 16.0,
            ],
        ]);
        $altarContext = [
            'altar_size_label' => '1m97',
            'context_aliases' => ['men lam'],
            '_resolved_context_alias' => 'men lam',
            '_force_rule_group' => true,
            'items' => [
                [
                    'id' => 'rule-bat-20',
                    'aliases' => ['bat huong 20', 'bat huong', 'bat'],
                    'display_name' => 'Bat huong men lam 20',
                    'option_label' => 'phi 20 / men lam',
                    'default_quantity' => 1,
                    'target_product_id' => 101,
                ],
                [
                    'id' => 'rule-de-20',
                    'aliases' => ['de bat huong 20', 'de bat huong', 'de bat'],
                    'display_name' => 'De bat huong men lam 20',
                    'option_label' => 'phi 20 / men lam',
                    'default_quantity' => 1,
                    'target_product_id' => 201,
                ],
            ],
        ];

        $mappedTargetIds = $expanded
            ->map(fn (array $item) => $this->invokePrivateMethod($service, 'mapRequestedItem', [$catalogEntries, $item, $altarContext]))
            ->map(fn (array $mappedItem) => $mappedItem['selected_entry']['target_product_id'] ?? null)
            ->values()
            ->all();

        $this->assertSame([102, 202], $mappedTargetIds);
    }

    public function test_it_prefers_trained_product_before_other_catalog_sizes_for_same_family(): void
    {
        $service = $this->makeService();
        $normalizedItem = $this->invokePrivateMethod($service, 'normalizeRequestedItem', [[
            'source_phrase' => '1 luc binh',
            'quantity' => 1,
            'quantity_specified' => true,
            'name' => 'luc binh',
        ], 0, []]);

        $catalogEntries = new Collection([
            [
                'entry_kind' => 'variation',
                'target_product_id' => 301,
                'parent_product_id' => 31,
                'parent_product_name' => 'Bo luc binh men lam',
                'name' => 'Luc binh men lam 25',
                'display_name' => 'Luc binh men lam 25',
                'sku' => 'LB-25-ML',
                'display_sku' => 'LB-25-ML',
                'option_label' => 'cao 25 / men lam',
                'attribute_summary' => 'cao 25 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Luc binh'],
                'search_text' => 'luc binh men lam cao 25',
                'size_tokens' => ['25', 'cao 25'],
                'size_cm' => 25.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 302,
                'parent_product_id' => 31,
                'parent_product_name' => 'Bo luc binh men lam',
                'name' => 'Luc binh men lam 30',
                'display_name' => 'Luc binh men lam 30',
                'sku' => 'LB-30-ML',
                'display_sku' => 'LB-30-ML',
                'option_label' => 'cao 30 / men lam',
                'attribute_summary' => 'cao 30 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Luc binh'],
                'search_text' => 'luc binh men lam cao 30',
                'size_tokens' => ['30', 'cao 30'],
                'size_cm' => 30.0,
            ],
            [
                'entry_kind' => 'variation',
                'target_product_id' => 303,
                'parent_product_id' => 31,
                'parent_product_name' => 'Bo luc binh men lam',
                'name' => 'Luc binh men lam 35',
                'display_name' => 'Luc binh men lam 35',
                'sku' => 'LB-35-ML',
                'display_sku' => 'LB-35-ML',
                'option_label' => 'cao 35 / men lam',
                'attribute_summary' => 'cao 35 / men lam',
                'attribute_text' => 'men lam',
                'price' => 0,
                'cost_price' => 0,
                'expected_cost' => 0,
                'main_image' => '',
                'attribute_values' => [],
                'categories' => ['Luc binh'],
                'search_text' => 'luc binh men lam cao 35',
                'size_tokens' => ['35', 'cao 35'],
                'size_cm' => 35.0,
            ],
        ]);
        $altarContext = [
            'altar_size_label' => '1m97',
            'context_aliases' => ['men lam'],
            '_resolved_context_alias' => 'men lam',
            '_force_rule_group' => true,
            'items' => [
                [
                    'id' => 'rule-luc-binh-30',
                    'aliases' => ['luc binh', 'luc binh 30'],
                    'display_name' => 'Luc binh men lam 30',
                    'option_label' => 'cao 30 / men lam',
                    'default_quantity' => 1,
                    'target_product_id' => 302,
                ],
            ],
        ];

        $mapped = $this->invokePrivateMethod($service, 'mapRequestedItem', [$catalogEntries, $normalizedItem, $altarContext]);

        $this->assertSame(302, $mapped['selected_entry']['target_product_id']);
        $this->assertSame('1m97', $mapped['matched_rule']['altar_size_label']);
    }

    private function makeService(): OrderAiAssistantService
    {
        return (new ReflectionClass(OrderAiAssistantService::class))->newInstanceWithoutConstructor();
    }

    private function invokePrivateMethod(OrderAiAssistantService $service, string $method, array $arguments): mixed
    {
        $reflection = new ReflectionClass($service);
        $reflectionMethod = $reflection->getMethod($method);
        $reflectionMethod->setAccessible(true);

        return $reflectionMethod->invokeArgs($service, $arguments);
    }
}
