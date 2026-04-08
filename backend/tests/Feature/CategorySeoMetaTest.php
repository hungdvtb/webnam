<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategorySeoMetaTest extends TestCase
{
    use RefreshDatabase;

    public function test_category_store_and_update_persist_meta_fields(): void
    {
        Account::query()->create([
            'name' => 'Main account',
            'site_code' => 'MAIN',
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $storeResponse = $this->postJson('/api/categories', [
            'name' => 'Bo do tho men lam',
            'description' => "Line 1\n- Line 2",
            'meta_title' => 'Meta title category',
            'meta_description' => 'Meta description category',
            'meta_keywords' => 'men lam, bat trang',
        ])->assertCreated();

        $categoryId = (int) $storeResponse->json('id');
        $category = Category::withoutGlobalScopes()->findOrFail($categoryId);

        $this->assertSame('Meta title category', $category->meta_title);
        $this->assertSame('Meta description category', $category->meta_description);
        $this->assertSame('men lam, bat trang', $category->meta_keywords);

        $this->postJson("/api/categories/{$categoryId}", [
            'meta_title' => 'Updated title',
            'meta_description' => 'Updated description',
            'meta_keywords' => 'updated, keywords',
        ])->assertOk()
            ->assertJsonPath('meta_title', 'Updated title')
            ->assertJsonPath('meta_description', 'Updated description')
            ->assertJsonPath('meta_keywords', 'updated, keywords');
    }

    public function test_web_api_category_returns_meta_fields(): void
    {
        Category::withoutGlobalScopes()->create([
            'account_id' => null,
            'name' => 'Danh muc seo',
            'code' => 'danh-muc-seo',
            'slug' => 'danh-muc-seo',
            'description' => 'Mo ta chi tiet',
            'meta_title' => 'Meta title public',
            'meta_description' => 'Meta description public',
            'meta_keywords' => 'seo, public',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        $this->getJson('/api/web-api/categories/danh-muc-seo')
            ->assertOk()
            ->assertJsonPath('meta_title', 'Meta title public')
            ->assertJsonPath('meta_description', 'Meta description public')
            ->assertJsonPath('meta_keywords', 'seo, public');
    }
}
