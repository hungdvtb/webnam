<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

    public function test_category_store_and_update_normalize_mojibake_text_fields(): void
    {
        Account::query()->create([
            'name' => 'Main account',
            'site_code' => 'MAIN',
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $storeResponse = $this->postJson('/api/categories', [
            'name' => 'Äá»“ thá» men lam',
            'description' => 'MÃ´ táº£ danh má»¥c men lam',
            'meta_title' => 'TiÃªu Ä‘á» SEO danh má»¥c',
            'meta_description' => 'MÃ´ táº£ SEO cho danh má»¥c Ä‘á»“ thá»',
            'meta_keywords' => 'Ä‘á»“ thá», men lam, bÃ¡t trÃ ng',
        ])->assertCreated()
            ->assertJsonPath('name', 'Đồ thờ men lam')
            ->assertJsonPath('slug', 'do-tho-men-lam')
            ->assertJsonPath('description', 'Mô tả danh mục men lam')
            ->assertJsonPath('meta_title', 'Tiêu đề SEO danh mục')
            ->assertJsonPath('meta_description', 'Mô tả SEO cho danh mục đồ thờ')
            ->assertJsonPath('meta_keywords', 'đồ thờ, men lam, bát tràng');

        $categoryId = (int) $storeResponse->json('id');

        $this->assertDatabaseHas('categories', [
            'id' => $categoryId,
            'name' => 'Đồ thờ men lam',
            'slug' => 'do-tho-men-lam',
            'description' => 'Mô tả danh mục men lam',
            'meta_title' => 'Tiêu đề SEO danh mục',
            'meta_description' => 'Mô tả SEO cho danh mục đồ thờ',
            'meta_keywords' => 'đồ thờ, men lam, bát tràng',
        ]);

        $this->postJson("/api/categories/{$categoryId}", [
            'name' => 'BÃ n thá» cao cáº¥p',
            'description' => 'MÃ´ táº£ má»›i cho ban thá»',
            'meta_title' => 'TiÃªu Ä‘á» má»›i',
            'meta_description' => 'MÃ´ táº£ SEO má»›i',
            'meta_keywords' => 'bÃ n thá», men ráº¡n',
        ])->assertOk()
            ->assertJsonPath('name', 'Bàn thờ cao cấp')
            ->assertJsonPath('slug', 'ban-tho-cao-cap')
            ->assertJsonPath('description', 'Mô tả mới cho ban thờ')
            ->assertJsonPath('meta_title', 'Tiêu đề mới')
            ->assertJsonPath('meta_description', 'Mô tả SEO mới')
            ->assertJsonPath('meta_keywords', 'ban thờ, men rạn');
    }

    public function test_category_api_reads_clean_utf8_from_existing_mojibake_storage(): void
    {
        Account::query()->create([
            'name' => 'Main account',
            'site_code' => 'MAIN',
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $category = Category::withoutGlobalScopes()->create([
            'account_id' => null,
            'name' => 'Danh muc tho cung',
            'code' => 'danh-muc-tho-cung',
            'slug' => 'danh-muc-tho-cung',
            'description' => 'Mo ta goc',
            'meta_title' => 'Meta title goc',
            'meta_description' => 'Meta description goc',
            'meta_keywords' => 'meta, goc',
            'status' => true,
            'order' => 0,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);

        DB::table('categories')->where('id', $category->id)->update([
            'name' => 'Danh má»¥c thá» cÃºng',
            'description' => 'MÃ´ táº£ hiá»ƒn thá»‹',
            'meta_title' => 'TiÃªu Ä‘á» danh má»¥c',
            'meta_description' => 'MÃ´ táº£ SEO hiá»ƒn thá»‹',
            'meta_keywords' => 'Ä‘á»“ thá», bÃ¡t trÃ ng',
        ]);

        $this->getJson('/api/categories')
            ->assertOk()
            ->assertJsonPath('0.name', 'Danh mục thờ cúng')
            ->assertJsonPath('0.description', 'Mô tả hiển thị')
            ->assertJsonPath('0.meta_title', 'Tiêu đề danh mục')
            ->assertJsonPath('0.meta_description', 'Mô tả SEO hiển thị')
            ->assertJsonPath('0.meta_keywords', 'đồ thờ, bát tràng');

        $this->getJson("/api/categories/{$category->id}")
            ->assertOk()
            ->assertJsonPath('name', 'Danh mục thờ cúng')
            ->assertJsonPath('description', 'Mô tả hiển thị')
            ->assertJsonPath('meta_title', 'Tiêu đề danh mục')
            ->assertJsonPath('meta_description', 'Mô tả SEO hiển thị')
            ->assertJsonPath('meta_keywords', 'đồ thờ, bát tràng');
    }
}
