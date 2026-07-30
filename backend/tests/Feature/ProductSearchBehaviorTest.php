<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductSearchBehaviorTest extends TestCase
{
    use RefreshDatabase;

    public function test_full_sku_search_returns_only_the_exact_product_match(): void
    {
        $account = $this->authenticate();

        $exact = $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
        ]);

        $this->createProduct($account, [
            'name' => 'San pham gan ma 0061',
            'sku' => 'DEMO-GOM-0061',
        ]);

        $this->createProduct($account, [
            'name' => 'Ten co chua DEMO GOM 0060',
            'sku' => 'TEN-KHAC-001',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=DEMO-GOM-0060&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $exact->id)
            ->assertJsonPath('data.0.sku', 'DEMO-GOM-0060');
    }

    public function test_partial_sku_search_falls_back_to_related_code_matches_only(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
        ]);

        $this->createProduct($account, [
            'name' => 'Bat huong men ran 061',
            'sku' => 'DEMO-GOM-0061',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=0060&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    public function test_short_mixed_code_search_returns_all_matching_skus_and_names_case_insensitively(): void
    {
        $account = $this->authenticate();

        $exact = $this->createProduct($account, [
            'name' => 'Tron bo do tho men Lam',
            'sku' => 'ML80',
        ]);

        $skuMatchA = $this->createProduct($account, [
            'name' => 'Bat huong men Lam rong nhu y',
            'sku' => 'ML80-BATHUONGLAM',
        ]);

        $skuMatchB = $this->createProduct($account, [
            'name' => 'Den men Lam',
            'sku' => 'ml80-DENLAM',
        ]);

        $nameMatch = $this->createProduct($account, [
            'name' => 'Phu kien dong bo ML80 dac biet',
            'sku' => 'PK-LAM-001',
        ]);

        $this->createProduct($account, [
            'name' => 'San pham khong lien quan',
            'sku' => 'LAM-081',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=ml80&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 4)
            ->assertJsonPath('data.0.id', $exact->id);

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing(
            [$exact->id, $skuMatchA->id, $skuMatchB->id, $nameMatch->id],
            $returnedIds
        );
    }

    public function test_picker_search_uses_expected_cost_when_current_cost_is_missing(): void
    {
        $account = $this->authenticate();

        $product = $this->createProduct($account, [
            'name' => 'San pham picker co gia du kien',
            'sku' => 'PICKER-EXPECTED-150',
            'cost_price' => null,
            'expected_cost' => 150000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=PICKER-EXPECTED-150&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $product->id)
            ->assertJsonPath('data.0.expected_cost', 150000.0)
            ->assertJsonPath('data.0.cost_price', 150000.0);
    }

    public function test_picker_search_matches_compact_queries_for_variation_names(): void
    {
        $account = $this->authenticate();

        $parent = $this->createProduct($account, [
            'name' => 'Ong huong men lam',
            'sku' => 'ML80-ONGHUONG-LAM',
            'type' => 'configurable',
        ]);

        $variation = $this->createProduct($account, [
            'name' => 'Ong huong men LAM - S1 - Cao 22cm',
            'sku' => 'ML80-ONGHUONG-S1-22',
        ]);

        $this->attachVariation($parent, $variation);

        $compactNameResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=onghuong&per_page=20');

        $compactNameResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);

        $compactMixedResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=onghuong22&per_page=20');

        $compactMixedResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);

        $compactSkuVariationResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=ml80onghuong22&per_page=20');

        $compactSkuVariationResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);
    }

    public function test_picker_search_matches_compact_alpha_sku_fragments(): void
    {
        $account = $this->authenticate();

        $skuOnlyMatch = $this->createProduct($account, [
            'name' => 'Bo bat cung hoa mat troi kich thuoc 40cm men RAN',
            'sku' => 'MR70-BOMATTROIMENRAN-40CM',
        ]);

        $nameMatch = $this->createProduct($account, [
            'name' => 'Bo mat troi men lam kem khay go',
            'sku' => 'ML80-MAT-TROI-LAM',
        ]);

        $this->createProduct($account, [
            'name' => 'Bo bat cung hoa sen men RAN',
            'sku' => 'MR70-HOA-SEN-40CM',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=bomattroi&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 2);

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing(
            [$skuOnlyMatch->id, $nameMatch->id],
            $returnedIds
        );
    }

    public function test_picker_search_returns_every_active_variant_for_matching_configurable_product(): void
    {
        $account = $this->authenticate();
        $patternAttribute = $this->createProductAttribute($account, 'Hoa van', [
            'SEN',
            'Cuon thu',
        ]);

        $parent = $this->createProduct($account, [
            'name' => 'Bat tra sam men RAN',
            'sku' => 'MR70-BATTRASAM-RAN',
            'type' => 'configurable',
        ]);

        $senVariant = $this->createProduct($account, [
            'name' => 'Bat tra sam men RAN - SEN',
            'sku' => 'MR70-BATTRASAM-RAN-SEN',
            'price' => 110000,
        ]);
        $this->attachProductAttributeValue($senVariant, $patternAttribute, 'SEN');

        $scrollVariant = $this->createProduct($account, [
            'name' => 'Bat tra sam men RAN - Cuon thu',
            'sku' => 'MR70-BATTRASAM-RAN-CUONTHU',
            'price' => 120000,
        ]);
        $this->attachProductAttributeValue($scrollVariant, $patternAttribute, 'Cuon thu');

        $this->attachVariation($parent, $senVariant, ['position' => 0]);
        $this->attachVariation($parent, $scrollVariant, ['position' => 1]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=battra&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);

        $variations = collect($response->json('data.0.variations'));
        $variationIds = $variations
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $variationNames = $variations->pluck('display_name')->all();
        $variationSkus = $variations->pluck('sku')->all();

        $this->assertSame([$senVariant->id, $scrollVariant->id], $variationIds);
        $this->assertSame([
            'Bat tra sam men RAN - SEN',
            'Bat tra sam men RAN - Cuon thu',
        ], $variationNames);
        $this->assertSame([
            'MR70-BATTRASAM-RAN-SEN',
            'MR70-BATTRASAM-RAN-CUONTHU',
        ], $variationSkus);
    }

    public function test_picker_source_account_search_uses_bearer_user_access_on_public_product_route(): void
    {
        $activeAccount = Account::query()->create([
            'name' => 'Gom Su Dai Thanh',
            'domain' => 'gom-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'gom-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $sourceAccount = Account::query()->create([
            'name' => 'Dong Dai Thanh',
            'domain' => 'dong-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'dong-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Sales',
            'email' => 'sales-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => false,
        ]);
        $user->accounts()->attach($activeAccount->id, ['role' => 'staff']);
        $user->accounts()->attach($sourceAccount->id, ['role' => 'staff']);

        $parent = $this->createProduct($sourceAccount, [
            'name' => 'Dinh dong vang',
            'sku' => 'DINHDONGVANG',
            'type' => 'configurable',
        ]);
        $variation = $this->createProduct($sourceAccount, [
            'name' => 'Dinh dong vang 45cm',
            'sku' => 'DINH45-VANG',
        ]);
        $this->attachVariation($parent, $variation);

        $token = $user->createToken('product-source-picker-test')->plainTextToken;

        $response = $this
            ->withHeaders($this->headers($activeAccount) + [
                'Authorization' => 'Bearer ' . $token,
            ])
            ->getJson('/api/products?picker=1&fast_picker=1&search=DINHDONGVANG&source_account_ids=' . $sourceAccount->id . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('data.0.id', $parent->id)
            ->assertJsonPath('data.0.account_id', $sourceAccount->id)
            ->assertJsonPath('data.0.source_account_id', $sourceAccount->id)
            ->assertJsonPath('data.0.variations.0.id', $variation->id);
    }

    public function test_name_search_uses_name_matching_instead_of_sku_token_matching(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men ran cao cap',
            'sku' => 'SKU-BAT-001',
        ]);

        $this->createProduct($account, [
            'name' => 'Lo hoa men ngoc',
            'sku' => 'BAT-HUONG-999',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=bat huong&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    public function test_picker_search_does_not_match_bundle_from_child_item_name_or_sku(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Ong huong men lam - S1 - Cao 22cm',
            'sku' => 'ML80-ONGHUONG-S1-22',
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam 9 mon',
            'sku' => 'BUNDLE-9MON-LAM',
            'type' => 'bundle',
        ]);

        $this->attachBundleItem($bundle, $matching, [
            'option_title' => 'Bo 9 mon',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=' . urlencode('ong huong 22') . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id)
            ->assertJsonPath('data.0.sku', 'ML80-ONGHUONG-S1-22');
    }

    public function test_picker_search_can_match_bundle_by_option_title(): void
    {
        $account = $this->authenticate();

        $bundleItem = $this->createProduct($account, [
            'name' => 'Chan nen men lam',
            'sku' => 'CHAN-NEN-LAM',
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam',
            'sku' => 'BUNDLE-MEN-LAM-OPTION',
            'type' => 'bundle',
        ]);

        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ong huong 22',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?picker=1&search=' . urlencode('ong huong 22') . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $bundle->id)
            ->assertJsonPath('data.0.sku', 'BUNDLE-MEN-LAM-OPTION');
    }

    public function test_fast_picker_search_filters_bundle_options_to_matching_option_title(): void
    {
        $account = $this->authenticate();

        $bundleItem = $this->createProduct($account, [
            'name' => 'Chan nen men lam',
            'sku' => 'CHAN-NEN-LAM-FAST',
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam fast option',
            'sku' => 'BUNDLE-MEN-LAM-FAST-OPTION',
            'type' => 'bundle',
        ]);

        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ban tho 1m75-1m97 3 bat huong',
            'position' => 0,
        ]);
        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ban tho 2m17 5 bat huong',
            'position' => 1,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'filter_bundle_options_by_search' => 1,
                'search' => '1m97',
                'per_page' => 20,
            ]));

        $response
            ->assertOk()
            ->assertJsonPath('data.0.id', $bundle->id)
            ->assertJsonCount(1, 'data.0.bundle_options')
            ->assertJsonPath('data.0.bundle_options.0.option_title', 'Ban tho 1m75-1m97 3 bat huong');
    }

    public function test_fast_picker_keeps_all_bundle_options_when_search_matches_parent_only(): void
    {
        $account = $this->authenticate();

        $bundleItem = $this->createProduct($account, [
            'name' => 'Chan nen men lam',
            'sku' => 'CHAN-NEN-LAM-PARENT',
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam parent fast',
            'sku' => 'BUNDLE-PARENT-FAST-ONLY',
            'type' => 'bundle',
        ]);

        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ban tho 1m75-1m97 3 bat huong',
            'position' => 0,
        ]);
        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ban tho 2m17 5 bat huong',
            'position' => 1,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'filter_bundle_options_by_search' => 1,
                'search' => 'BUNDLE-PARENT-FAST-ONLY',
                'per_page' => 20,
            ]));

        $response
            ->assertOk()
            ->assertJsonPath('data.0.id', $bundle->id)
            ->assertJsonCount(2, 'data.0.bundle_options');
    }

    public function test_picker_selected_ids_returns_latest_bundle_option_prices(): void
    {
        $account = $this->authenticate();

        $bundleItem = $this->createProduct($account, [
            'name' => 'Chan nen men ran selected',
            'sku' => 'CHAN-NEN-RAN-SELECTED',
            'price' => 7800000,
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo do tho men ran selected',
            'sku' => 'BUNDLE-MEN-RAN-SELECTED',
            'type' => 'bundle',
        ]);

        $otherBundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam selected other',
            'sku' => 'BUNDLE-MEN-LAM-SELECTED-OTHER',
            'type' => 'bundle',
        ]);

        $this->attachBundleItem($bundle, $bundleItem, [
            'option_title' => 'Ban tho 1m75-1m97 3 bat huong',
        ]);
        $this->attachBundleItem($otherBundle, $bundleItem, [
            'option_title' => 'Bo khac',
        ]);

        $bundleItem->forceFill(['price' => 8020000])->save();

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'fast_picker' => 1,
                'selected_ids' => (string) $bundle->id,
                'per_page' => 20,
            ]));

        $response
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $bundle->id)
            ->assertJsonPath('data.0.bundle_options.0.bundle_option_total_price', 8020000)
            ->assertJsonPath('data.0.bundle_options.0.items.0.price', 8020000);
    }

    public function test_long_specific_name_search_prefers_phrase_match_over_shared_token_matches(): void
    {
        $account = $this->authenticate();

        $matching = $this->createProduct($account, [
            'name' => 'Bo do tho men lam Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-LAM-001',
            'type' => 'bundle',
        ]);

        $this->createProduct($account, [
            'name' => 'Bo do tho men trang Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-TRANG-001',
            'type' => 'bundle',
        ]);

        $this->createProduct($account, [
            'name' => 'Bo do tho men xanh Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-XANH-001',
            'type' => 'bundle',
        ]);

        $this->createProduct($account, [
            'name' => 'Bo do tho men ran co Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-RAN-001',
            'type' => 'bundle',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=' . urlencode('Bo do tho men lam Bat Trang Demo Bundle') . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id)
            ->assertJsonPath('data.0.sku', 'BUNDLE-MEN-LAM-001');
    }

    public function test_color_queries_require_matching_adjacent_phrase_not_just_shared_tokens(): void
    {
        $account = $this->authenticate();

        $lam = $this->createProduct($account, [
            'name' => 'Bo do tho men lam Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-LAM-DBY',
            'type' => 'bundle',
        ]);

        $trang = $this->createProduct($account, [
            'name' => 'Bo do tho men trang Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-TRANG-YDD',
            'type' => 'bundle',
        ]);

        $this->createProduct($account, [
            'name' => 'Bo do tho men xanh Bat Trang Demo Bundle',
            'sku' => 'BUNDLE-MEN-XANH-L9U',
            'type' => 'bundle',
        ]);

        $lamResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=' . urlencode('men lam bundle') . '&per_page=20');

        $lamResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $lam->id)
            ->assertJsonPath('data.0.sku', 'BUNDLE-MEN-LAM-DBY');

        $trangResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=' . urlencode('men trang bundle') . '&per_page=20');

        $trangResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $trang->id)
            ->assertJsonPath('data.0.sku', 'BUNDLE-MEN-TRANG-YDD');
    }

    public function test_full_sku_search_respects_active_category_filters_before_falling_back(): void
    {
        $account = $this->authenticate();
        $categoryA = $this->createCategory($account, 'Danh muc A');
        $categoryB = $this->createCategory($account, 'Danh muc B');

        $this->createProduct($account, [
            'name' => 'Bat huong men ran 060',
            'sku' => 'DEMO-GOM-0060',
            'category_id' => $categoryA->id,
        ]);

        $fallback = $this->createProduct($account, [
            'name' => 'Bat huong bien the 060',
            'sku' => 'DEMO-GOM-0060-ALT',
            'category_id' => $categoryB->id,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=DEMO-GOM-0060&category_ids=' . $categoryB->id . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $fallback->id)
            ->assertJsonPath('data.0.sku', 'DEMO-GOM-0060-ALT');
    }

    public function test_attribute_filter_can_be_combined_with_search(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
            'Men trang',
        ]);

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men lam size 18',
            'sku' => 'BAT-HUONG-LAM-018',
        ]);
        $this->attachProductAttributeValue($matching, $glazeAttribute, 'Men lam');

        $other = $this->createProduct($account, [
            'name' => 'Bat huong men ran size 18',
            'sku' => 'BAT-HUONG-RAN-018',
        ]);
        $this->attachProductAttributeValue($other, $glazeAttribute, 'Men ran');

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'search' => 'bat huong',
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id)
            ->assertJsonPath('data.0.sku', 'BAT-HUONG-LAM-018');
    }

    public function test_picker_quick_filter_disabled_ignores_stale_attribute_filters(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
        ]);

        $lamProduct = $this->createProduct($account, [
            'name' => 'Ong huong quicktoggle men lam',
            'sku' => 'QTOGGLE-LAM',
        ]);
        $this->attachProductAttributeValue($lamProduct, $glazeAttribute, 'Men lam');

        $ranProduct = $this->createProduct($account, [
            'name' => 'Ong huong quicktoggle men ran',
            'sku' => 'QTOGGLE-RAN',
        ]);
        $this->attachProductAttributeValue($ranProduct, $glazeAttribute, 'Men ran');

        $enabledResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'search' => 'quicktoggle',
                'per_page' => 20,
                'quick_filter_enabled' => 1,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $enabledResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $lamProduct->id);

        $disabledResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'search' => 'quicktoggle',
                'per_page' => 20,
                'quick_filter_enabled' => 0,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $disabledResponse
            ->assertOk()
            ->assertJsonPath('total', 2);

        $returnedIds = collect($disabledResponse->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing(
            [$lamProduct->id, $ranProduct->id],
            $returnedIds
        );
    }

    public function test_picker_attribute_filter_keeps_only_variations_matching_combined_parent_and_variant_values(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men rạn',
            'Men lam',
        ]);
        $patternAttribute = $this->createProductAttribute($account, 'Mẫu', [
            'Sen',
            'Rồng',
        ]);

        $parent = $this->createProduct($account, [
            'name' => 'Bat tra sam men ran',
            'sku' => 'MR70-BATTRASAM-RAN',
            'type' => 'configurable',
        ]);
        $this->attachProductAttributeValue($parent, $glazeAttribute, 'Men rạn');

        $senVariant = $this->createProduct($account, [
            'name' => 'Bat tra sam men ran - Sen',
            'sku' => 'MR70-BATTRASAM-RAN-SEN',
        ]);
        $this->attachProductAttributeValue($senVariant, $patternAttribute, 'Sen');

        $rongVariant = $this->createProduct($account, [
            'name' => 'Bat tra sam men ran - Rong',
            'sku' => 'MR70-BATTRASAM-RAN-RONG',
        ]);
        $this->attachProductAttributeValue($rongVariant, $patternAttribute, 'Rồng');

        $this->attachVariation($parent, $senVariant, ['position' => 0]);
        $this->attachVariation($parent, $rongVariant, ['position' => 1]);

        $rongResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men rạn',
                    $patternAttribute->id => 'Rồng',
                ],
            ]));

        $rongResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);

        $rongVariationIds = collect($rongResponse->json('data.0.variations'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertSame([$rongVariant->id], $rongVariationIds);

        $senResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men rạn',
                    $patternAttribute->id => 'Sen',
                ],
            ]));

        $senResponse
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $parent->id);

        $senVariationIds = collect($senResponse->json('data.0.variations'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertSame([$senVariant->id], $senVariationIds);
    }

    public function test_attribute_filter_matches_only_exact_attribute_values(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
            'Men lam ve vang',
        ], [
            'frontend_type' => 'multiselect',
        ]);

        $matching = $this->createProduct($account, [
            'name' => 'Bo do tho men lam',
            'sku' => 'BUNDLE-MEN-LAM',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($matching, $glazeAttribute, 'Men lam');

        $matchingSingleJson = $this->createProduct($account, [
            'name' => 'Bo do tho men lam json',
            'sku' => 'BUNDLE-MEN-LAM-JSON',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($matchingSingleJson, $glazeAttribute, ['Men lam']);

        $mixed = $this->createProduct($account, [
            'name' => 'Bo do tho nhieu loai men',
            'sku' => 'BUNDLE-MEN-LAM-RAN',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($mixed, $glazeAttribute, ['Men lam', 'Men ran']);

        $closeMatch = $this->createProduct($account, [
            'name' => 'Bo do tho men lam ve vang',
            'sku' => 'BUNDLE-MEN-LAM-VE-VANG',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($closeMatch, $glazeAttribute, 'Men lam ve vang');

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing(
            [$matching->id, $matchingSingleJson->id],
            $returnedIds
        );
        $this->assertNotContains($mixed->id, $returnedIds);
        $this->assertNotContains($closeMatch->id, $returnedIds);
    }

    public function test_admin_attribute_filter_does_not_match_bundle_parent_by_child_item_attributes(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
        ]);

        $matching = $this->createProduct($account, [
            'name' => 'Bo do tho men lam chuan',
            'sku' => 'BUNDLE-MEN-LAM-EXACT',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($matching, $glazeAttribute, 'Men lam');

        $child = $this->createProduct($account, [
            'name' => 'Chan nen men lam',
            'sku' => 'CHAN-NEN-MEN-LAM-CHILD',
        ]);
        $this->attachProductAttributeValue($child, $glazeAttribute, 'Men lam');

        $leakingBundle = $this->createProduct($account, [
            'name' => 'Bo do tho men ran',
            'sku' => 'BUNDLE-MEN-RAN-LEAK',
            'type' => 'bundle',
        ]);
        $this->attachProductAttributeValue($leakingBundle, $glazeAttribute, 'Men ran');
        $this->attachBundleItem($leakingBundle, $child, [
            'option_title' => 'Ban 1m',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($matching->id, $returnedIds);
        $this->assertNotContains($leakingBundle->id, $returnedIds);
    }

    public function test_picker_attribute_filter_can_match_bundle_by_child_item_attributes(): void
    {
        $account = $this->authenticate();
        $glazeAttribute = $this->createProductAttribute($account, 'Loai men', [
            'Men lam',
            'Men ran',
        ]);

        $matchingChild = $this->createProduct($account, [
            'name' => 'Chan nen men lam',
            'sku' => 'CHAN-NEN-MEN-LAM',
        ]);
        $this->attachProductAttributeValue($matchingChild, $glazeAttribute, 'Men lam');

        $matchingBundle = $this->createProduct($account, [
            'name' => 'Bo do tho men lam demo bundle',
            'sku' => 'BUNDLE-CHILD-MEN-LAM',
            'type' => 'bundle',
        ]);
        $this->attachBundleItem($matchingBundle, $matchingChild, [
            'option_title' => 'Ban 1m',
        ]);

        $otherChild = $this->createProduct($account, [
            'name' => 'Chan nen men ran',
            'sku' => 'CHAN-NEN-MEN-RAN',
        ]);
        $this->attachProductAttributeValue($otherChild, $glazeAttribute, 'Men ran');

        $otherBundle = $this->createProduct($account, [
            'name' => 'Bo do tho men ran demo bundle',
            'sku' => 'BUNDLE-CHILD-MEN-RAN',
            'type' => 'bundle',
        ]);
        $this->attachBundleItem($otherBundle, $otherChild, [
            'option_title' => 'Ban 1m',
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?' . http_build_query([
                'picker' => 1,
                'search' => 'Bo do tho men lam demo bundle',
                'per_page' => 20,
                'attributes' => [
                    $glazeAttribute->id => 'Men lam',
                ],
            ]));

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matchingBundle->id)
            ->assertJsonPath('data.0.sku', 'BUNDLE-CHILD-MEN-LAM');
    }

    public function test_admin_search_returns_matching_variant_row_instead_of_parent(): void
    {
        $account = $this->authenticate();

        $parent = $this->createProduct($account, [
            'name' => 'Ong huong men lam',
            'sku' => 'ML80-ONGHUONG-LAM',
            'type' => 'configurable',
        ]);

        $matchingVariant = $this->createProduct($account, [
            'name' => 'Ong huong men lam - S1 - Cao 22cm',
            'sku' => 'ML80-ONGHUONG-S1-22',
        ]);

        $otherVariant = $this->createProduct($account, [
            'name' => 'Ong huong men lam - S2 - Cao 18cm',
            'sku' => 'ML80-ONGHUONG-S2-18',
        ]);

        $this->attachVariation($parent, $matchingVariant);
        $this->attachVariation($parent, $otherVariant);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=ML80-ONGHUONG-S1-22&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matchingVariant->id)
            ->assertJsonPath('data.0.sku', 'ML80-ONGHUONG-S1-22')
            ->assertJsonPath('data.0.parent_configurable.0.id', $parent->id);
    }

    public function test_admin_search_keeps_parent_filters_but_renders_matching_variant_directly(): void
    {
        $account = $this->authenticate();
        $category = $this->createCategory($account, 'Danh muc ong huong');

        $parent = $this->createProduct($account, [
            'name' => 'Ong huong men lam',
            'sku' => 'ML80-ONGHUONG-LAM',
            'type' => 'configurable',
            'category_id' => $category->id,
        ]);

        $matchingVariant = $this->createProduct($account, [
            'name' => 'Ong huong men lam - S1 - Cao 22cm',
            'sku' => 'ML80-ONGHUONG-S1-22',
        ]);

        $nonMatchingVariant = $this->createProduct($account, [
            'name' => 'Ong huong men lam - S2 - Cao 18cm',
            'sku' => 'ML80-ONGHUONG-S2-18',
        ]);

        $this->attachVariation($parent, $matchingVariant);
        $this->attachVariation($parent, $nonMatchingVariant);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=' . urlencode('cao 22') . '&category_ids=' . $category->id . '&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matchingVariant->id)
            ->assertJsonPath('data.0.parent_configurable.0.id', $parent->id);
    }

    public function test_admin_search_keeps_matching_parent_and_matching_variants_without_duplicate_parent_rows(): void
    {
        $account = $this->authenticate();

        $parent = $this->createProduct($account, [
            'name' => 'Lo hoa ve vang',
            'sku' => 'VE8KVYFO',
            'type' => 'configurable',
        ]);

        $variantSmall = $this->createProduct($account, [
            'name' => 'Lo hoa ve vang - nho',
            'sku' => 'VE8KVYFO-NHO',
        ]);

        $variantMedium = $this->createProduct($account, [
            'name' => 'Lo hoa ve vang - trung',
            'sku' => 'VE8KVYFO-TRUNG',
        ]);

        $this->attachVariation($parent, $variantSmall, ['position' => 0]);
        $this->attachVariation($parent, $variantMedium, ['position' => 1]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/products?search=VE8KVYFO&per_page=20');

        $response->assertOk();

        $returnedIds = collect($response->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertEqualsCanonicalizing(
            [$parent->id, $variantSmall->id, $variantMedium->id],
            $returnedIds
        );
        $this->assertSame(1, count(array_keys($returnedIds, $parent->id, true)));
    }

    private function authenticate(): Account
    {
        $account = Account::query()->create([
            'name' => 'Test Account',
            'domain' => 'test-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'test-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return $account;
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }

    private function createCategory(Account $account, string $name): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(4)),
            'status' => 1,
        ]);
    }

    private function createProductAttribute(Account $account, string $name, array $options = [], array $overrides = []): Attribute
    {
        $attribute = Attribute::query()->create(array_merge([
            'account_id' => $account->id,
            'name' => $name,
            'code' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'entity_type' => 'product',
            'frontend_type' => 'select',
            'is_filterable' => true,
            'is_filterable_backend' => true,
            'status' => true,
        ], $overrides));

        foreach (array_values($options) as $index => $option) {
            AttributeOption::query()->create([
                'attribute_id' => $attribute->id,
                'value' => $option,
                'order' => $index,
            ]);
        }

        return $attribute->fresh('options');
    }

    private function attachProductAttributeValue(Product $product, Attribute $attribute, string|array $value): ProductAttributeValue
    {
        return ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $attribute->id,
            'value' => is_array($value) ? json_encode(array_values($value)) : $value,
        ]);
    }

    private function attachVariation(Product $parent, Product $variation, array $overrides = []): void
    {
        $parent->linkedProducts()->attach($variation->id, array_merge([
            'link_type' => 'super_link',
            'position' => 0,
        ], $overrides));
    }

    private function attachBundleItem(Product $bundle, Product $item, array $overrides = []): void
    {
        $bundle->bundleItems()->attach($item->id, array_merge([
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => 1,
            'option_title' => 'Mac dinh',
        ], $overrides));
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));
        $sku = $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
