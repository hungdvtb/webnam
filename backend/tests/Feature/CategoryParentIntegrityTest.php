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

    public function test_category_reorder_keeps_order_separate_for_each_level_and_persists_after_reload(): void
    {
        $rootA = Category::query()->create([
            'name' => 'Danh muc A',
            'slug' => 'danh-muc-a',
            'status' => true,
            'order' => 1,
        ]);

        $rootB = Category::query()->create([
            'name' => 'Danh muc B',
            'slug' => 'danh-muc-b',
            'status' => true,
            'order' => 0,
        ]);

        $childA1 = Category::query()->create([
            'name' => 'Danh muc A1',
            'slug' => 'danh-muc-a1',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 0,
        ]);

        $childA2 = Category::query()->create([
            'name' => 'Danh muc A2',
            'slug' => 'danh-muc-a2',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 1,
        ]);

        $childB1 = Category::query()->create([
            'name' => 'Danh muc B1',
            'slug' => 'danh-muc-b1',
            'parent_id' => $rootB->id,
            'status' => true,
            'order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->postJson('/api/categories/reorder', [
            'items' => [
                ['id' => $rootA->id, 'parent_id' => null, 'order' => 0],
                ['id' => $rootB->id, 'parent_id' => null, 'order' => 1],
                ['id' => $childA2->id, 'parent_id' => $rootA->id, 'order' => 0],
                ['id' => $childA1->id, 'parent_id' => $rootA->id, 'order' => 1],
                ['id' => $childB1->id, 'parent_id' => $rootB->id, 'order' => 0],
            ],
        ])->assertOk();

        $rootA->refresh();
        $rootB->refresh();
        $childA1->refresh();
        $childA2->refresh();
        $childB1->refresh();

        $this->assertNull($rootA->parent_id);
        $this->assertNull($rootB->parent_id);
        $this->assertSame(0, (int) $rootA->order);
        $this->assertSame(1, (int) $rootB->order);
        $this->assertSame($rootA->id, $childA1->parent_id);
        $this->assertSame($rootA->id, $childA2->parent_id);
        $this->assertSame(0, (int) $childA2->order);
        $this->assertSame(1, (int) $childA1->order);
        $this->assertSame($rootB->id, $childB1->parent_id);
        $this->assertSame(0, (int) $childB1->order);

        $responseIds = collect($response->json('categories'))->pluck('id')->all();
        $this->assertSame([$rootA->id, $childA2->id, $childA1->id, $rootB->id, $childB1->id], $responseIds);

        $reloadIds = collect($this->getJson('/api/categories')->assertOk()->json())->pluck('id')->all();
        $this->assertSame([$rootA->id, $childA2->id, $childA1->id, $rootB->id, $childB1->id], $reloadIds);
    }

    public function test_category_reorder_can_move_child_to_another_parent_and_keep_descendants(): void
    {
        $rootA = Category::query()->create([
            'name' => 'Danh muc cha A',
            'slug' => 'danh-muc-cha-a',
            'status' => true,
            'order' => 0,
        ]);

        $rootB = Category::query()->create([
            'name' => 'Danh muc cha B',
            'slug' => 'danh-muc-cha-b',
            'status' => true,
            'order' => 1,
        ]);

        $childA1 = Category::query()->create([
            'name' => 'Danh muc con A1',
            'slug' => 'danh-muc-con-a1',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 0,
        ]);

        $childA2 = Category::query()->create([
            'name' => 'Danh muc con A2',
            'slug' => 'danh-muc-con-a2',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 1,
        ]);

        $childB1 = Category::query()->create([
            'name' => 'Danh muc con B1',
            'slug' => 'danh-muc-con-b1',
            'parent_id' => $rootB->id,
            'status' => true,
            'order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->postJson('/api/categories/reorder', [
            'items' => [
                ['id' => $rootB->id, 'parent_id' => null, 'order' => 0],
                ['id' => $childB1->id, 'parent_id' => $rootB->id, 'order' => 0],
                ['id' => $rootA->id, 'parent_id' => $rootB->id, 'order' => 1],
                ['id' => $childA2->id, 'parent_id' => $rootA->id, 'order' => 0],
                ['id' => $childA1->id, 'parent_id' => $rootB->id, 'order' => 2],
            ],
        ])->assertOk();

        $rootA->refresh();
        $rootB->refresh();
        $childA1->refresh();
        $childA2->refresh();
        $childB1->refresh();

        $this->assertNull($rootB->parent_id);
        $this->assertSame(0, (int) $rootB->order);
        $this->assertSame($rootB->id, $rootA->parent_id);
        $this->assertSame(1, (int) $rootA->order);
        $this->assertSame($rootB->id, $childB1->parent_id);
        $this->assertSame(0, (int) $childB1->order);
        $this->assertSame($rootA->id, $childA2->parent_id);
        $this->assertSame(0, (int) $childA2->order);
        $this->assertSame($rootB->id, $childA1->parent_id);
        $this->assertSame(2, (int) $childA1->order);

        $responseIds = collect($response->json('categories'))->pluck('id')->all();
        $this->assertSame([$rootB->id, $childB1->id, $rootA->id, $childA2->id, $childA1->id], $responseIds);

        $reloadIds = collect($this->getJson('/api/categories')->assertOk()->json())->pluck('id')->all();
        $this->assertSame([$rootB->id, $childB1->id, $rootA->id, $childA2->id, $childA1->id], $reloadIds);
    }

    public function test_category_reorder_can_update_only_direct_children_of_selected_parent(): void
    {
        $rootA = Category::query()->create([
            'name' => 'Danh muc cha A',
            'slug' => 'danh-muc-cha-a-2',
            'status' => true,
            'order' => 0,
        ]);

        $rootB = Category::query()->create([
            'name' => 'Danh muc cha B',
            'slug' => 'danh-muc-cha-b-2',
            'status' => true,
            'order' => 1,
        ]);

        $childA1 = Category::query()->create([
            'name' => 'Danh muc con A1',
            'slug' => 'danh-muc-con-a1-2',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 0,
        ]);

        $childA2 = Category::query()->create([
            'name' => 'Danh muc con A2',
            'slug' => 'danh-muc-con-a2-2',
            'parent_id' => $rootA->id,
            'status' => true,
            'order' => 1,
        ]);

        $childB1 = Category::query()->create([
            'name' => 'Danh muc con B1',
            'slug' => 'danh-muc-con-b1-2',
            'parent_id' => $rootB->id,
            'status' => true,
            'order' => 0,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $response = $this->postJson('/api/categories/reorder', [
            'items' => [
                ['id' => $childA2->id, 'parent_id' => $rootA->id, 'order' => 0],
                ['id' => $childA1->id, 'parent_id' => $rootA->id, 'order' => 1],
            ],
        ])->assertOk();

        $rootA->refresh();
        $rootB->refresh();
        $childA1->refresh();
        $childA2->refresh();
        $childB1->refresh();

        $this->assertNull($rootA->parent_id);
        $this->assertNull($rootB->parent_id);
        $this->assertSame(0, (int) $rootA->order);
        $this->assertSame(1, (int) $rootB->order);
        $this->assertSame($rootA->id, $childA1->parent_id);
        $this->assertSame($rootA->id, $childA2->parent_id);
        $this->assertSame(1, (int) $childA1->order);
        $this->assertSame(0, (int) $childA2->order);
        $this->assertSame($rootB->id, $childB1->parent_id);
        $this->assertSame(0, (int) $childB1->order);

        $responseIds = collect($response->json('categories'))->pluck('id')->all();
        $this->assertSame([$rootA->id, $childA2->id, $childA1->id, $rootB->id, $childB1->id], $responseIds);

        $reloadIds = collect($this->getJson('/api/categories')->assertOk()->json())->pluck('id')->all();
        $this->assertSame([$rootA->id, $childA2->id, $childA1->id, $rootB->id, $childB1->id], $reloadIds);
    }
}
