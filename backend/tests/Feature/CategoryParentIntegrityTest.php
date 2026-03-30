<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryParentIntegrityTest extends TestCase
{
    use RefreshDatabase;

    public function test_category_update_rejects_self_parent_and_descendant_cycles(): void
    {
        $root = Category::query()->create([
            'name' => 'Danh muc goc',
            'slug' => 'danh-muc-goc',
            'status' => true,
        ]);

        $child = Category::query()->create([
            'name' => 'Danh muc con',
            'slug' => 'danh-muc-con',
            'parent_id' => $root->id,
            'status' => true,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->postJson("/api/categories/{$root->id}", [
            'parent_id' => $root->id,
        ])->assertStatus(422)->assertJsonValidationErrors('parent_id');

        $this->postJson("/api/categories/{$root->id}", [
            'parent_id' => $child->id,
        ])->assertStatus(422)->assertJsonValidationErrors('parent_id');

        $root->refresh();
        $child->refresh();

        $this->assertNull($root->parent_id);
        $this->assertSame($root->id, $child->parent_id);
    }

    public function test_category_update_preserves_parent_when_parent_is_not_sent(): void
    {
        $root = Category::query()->create([
            'name' => 'Danh muc goc',
            'slug' => 'danh-muc-goc',
            'status' => true,
        ]);

        $child = Category::query()->create([
            'name' => 'Danh muc con',
            'slug' => 'danh-muc-con',
            'parent_id' => $root->id,
            'status' => true,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->postJson("/api/categories/{$child->id}", [
            'name' => 'Danh muc con da doi ten',
        ])->assertOk();

        $child->refresh();

        $this->assertSame($root->id, $child->parent_id);
        $this->assertSame('Danh muc con da doi ten', $child->name);
    }

    public function test_category_reorder_rejects_parent_cycles(): void
    {
        $root = Category::query()->create([
            'name' => 'Danh muc goc',
            'slug' => 'danh-muc-goc',
            'status' => true,
            'order' => 0,
        ]);

        $child = Category::query()->create([
            'name' => 'Danh muc con',
            'slug' => 'danh-muc-con',
            'parent_id' => $root->id,
            'status' => true,
            'order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->postJson('/api/categories/reorder', [
            'items' => [
                ['id' => $root->id, 'parent_id' => $child->id, 'order' => 0],
                ['id' => $child->id, 'parent_id' => $root->id, 'order' => 1],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors('items');

        $root->refresh();
        $child->refresh();

        $this->assertNull($root->parent_id);
        $this->assertSame($root->id, $child->parent_id);
    }
}
