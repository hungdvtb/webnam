<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class WebMobileProductSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_mobile_quick_search_matches_product_text_without_leaking_sku_phrase_matches(): void
    {
        $account = $this->createAccount();

        $matching = $this->createProduct($account, [
            'name' => 'Bat huong men ran cao cap',
            'sku' => 'SKU-BH-001',
            'meta_keywords' => 'do tho, bat huong, gom bat trang',
        ]);

        $this->createProduct($account, [
            'name' => 'Nam ruou men lam',
            'sku' => 'BAT-HUONG-999',
            'meta_keywords' => 'nam ruou, do tho',
        ]);

        $response = $this
            ->withHeaders(['X-Site-Code' => $account->site_code])
            ->getJson('/api/web-api/products?mobile_search=1&search=bat%20huong&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    public function test_mobile_quick_search_matches_whole_words_so_ong_huong_does_not_match_rong(): void
    {
        $account = $this->createAccount();

        $matching = $this->createProduct($account, [
            'name' => 'Ong huong men lam ve vang 24K',
            'sku' => 'SKU-OH-001',
            'meta_keywords' => 'ong huong, do tho, gom bat trang',
        ]);

        $this->createProduct($account, [
            'name' => 'Bat huong men lam ve vang 24K rong',
            'sku' => 'SKU-BH-RONG-001',
            'meta_keywords' => 'bat huong, rong, do tho',
        ]);

        $response = $this
            ->withHeaders(['X-Site-Code' => $account->site_code])
            ->getJson('/api/web-api/products?mobile_search=1&search=ong%20huong&per_page=20');

        $response
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $matching->id);
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Mobile Search Account',
            'domain' => 'mobile-search-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'mobile-search-' . Str::lower(Str::random(6)),
            'site_code' => 'mobile-search-' . Str::lower(Str::random(8)),
            'status' => true,
        ]);
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? 'San pham test';

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(6)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'price' => 100000,
            'status' => true,
            'is_new' => false,
            'is_featured' => false,
        ], $overrides));
    }
}
