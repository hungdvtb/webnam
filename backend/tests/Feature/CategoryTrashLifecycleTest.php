<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CategoryTrashLifecycleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Category::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();

        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('category_product');
        Schema::dropIfExists('products');
        Schema::dropIfExists('categories');
        Schema::dropIfExists('users');
        Schema::enableForeignKeyConstraints();

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->boolean('is_admin')->default(false);
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('name');
            $table->string('code')->nullable();
            $table->string('slug')->unique();
            $table->foreignId('parent_id')->nullable()->constrained('categories')->onDelete('cascade');
            $table->text('description')->nullable();
            $table->string('banner_path')->nullable();
            $table->unsignedBigInteger('banner_media_asset_id')->nullable();
            $table->string('logo_path')->nullable();
            $table->unsignedBigInteger('logo_media_asset_id')->nullable();
            $table->boolean('status')->default(true);
            $table->unsignedInteger('order')->default(0);
            $table->string('display_layout')->nullable();
            $table->json('filterable_attribute_ids')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('type')->default('simple');
            $table->string('name')->nullable();
            $table->string('slug')->nullable();
            $table->string('sku')->nullable();
            $table->boolean('status')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('category_product', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('category_id');
            $table->unsignedBigInteger('product_id');
            $table->string('item_type')->default('product');
            $table->string('bundle_option_key')->nullable();
            $table->unsignedBigInteger('bundle_option_post_id')->nullable();
            $table->string('bundle_option_title')->nullable();
            $table->unsignedInteger('sort_order')->nullable();
            $table->timestamps();
        });

        Category::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();
    }

    protected function tearDown(): void
    {
        Category::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();

        parent::tearDown();
    }

    public function test_destroying_parent_moves_entire_branch_to_trash(): void
    {
        [$root, $child, $grandchild, $sibling] = $this->makeBasicTree();
        $admin = $this->authenticateAdmin();

        $this->deleteJson("/api/categories/{$root->id}")
            ->assertOk()
            ->assertJsonPath('trashed_count', 3);

        $this->assertSoftDeleted('categories', ['id' => $root->id]);
        $this->assertSoftDeleted('categories', ['id' => $child->id]);
        $this->assertSoftDeleted('categories', ['id' => $grandchild->id]);
        $this->assertDatabaseHas('categories', ['id' => $root->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $child->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $grandchild->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $sibling->id, 'deleted_at' => null]);

        $activeIds = collect($this->getJson('/api/categories')->assertOk()->json())
            ->pluck('id')
            ->all();
        $trashIds = collect($this->getJson('/api/categories?is_trash=1')->assertOk()->json())
            ->pluck('id')
            ->all();

        $this->assertSame([$sibling->id], $activeIds);
        $this->assertSame([$root->id, $child->id, $grandchild->id], $trashIds);
    }

    public function test_destroying_child_branch_only_moves_that_branch_to_trash(): void
    {
        [$root, $child, $grandchild, $sibling] = $this->makeBasicTree();
        $secondChild = $this->createCategory('Danh mục con còn lại', $root, 1);

        $admin = $this->authenticateAdmin();

        $this->deleteJson("/api/categories/{$child->id}")
            ->assertOk()
            ->assertJsonPath('trashed_count', 2);

        $this->assertDatabaseHas('categories', ['id' => $root->id, 'deleted_at' => null]);
        $this->assertSoftDeleted('categories', ['id' => $child->id]);
        $this->assertSoftDeleted('categories', ['id' => $grandchild->id]);
        $this->assertDatabaseHas('categories', ['id' => $child->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $grandchild->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $secondChild->id, 'deleted_at' => null]);
        $this->assertDatabaseHas('categories', ['id' => $sibling->id, 'deleted_at' => null]);
    }

    public function test_restoring_deleted_child_branch_returns_it_to_original_parent(): void
    {
        [$root, $child, $grandchild] = $this->makeBasicTreeWithoutSibling();

        $this->authenticateAdmin();

        $this->deleteJson("/api/categories/{$child->id}")
            ->assertOk();

        $this->postJson("/api/categories/{$child->id}/restore")
            ->assertOk()
            ->assertJsonPath('restored_count', 2);

        $child = Category::withTrashed()->findOrFail($child->id);
        $grandchild = Category::withTrashed()->findOrFail($grandchild->id);

        $this->assertNull($child->deleted_at);
        $this->assertNull($grandchild->deleted_at);
        $this->assertNull($child->deleted_by);
        $this->assertNull($grandchild->deleted_by);
        $this->assertSame($root->id, (int) $child->parent_id);
        $this->assertSame($child->id, (int) $grandchild->parent_id);
        $this->assertSame(0, (int) $child->order);
        $this->assertSame(0, (int) $grandchild->order);
    }

    public function test_restoring_parent_restores_full_descendant_tree_with_original_structure(): void
    {
        [$root, $child, $grandchild, $sibling] = $this->makeBasicTree();

        $this->authenticateAdmin();

        $this->deleteJson("/api/categories/{$root->id}")
            ->assertOk();

        $this->postJson("/api/categories/{$root->id}/restore")
            ->assertOk()
            ->assertJsonPath('restored_count', 3);

        $root = Category::withTrashed()->findOrFail($root->id);
        $child = Category::withTrashed()->findOrFail($child->id);
        $grandchild = Category::withTrashed()->findOrFail($grandchild->id);

        $this->assertNull($root->deleted_at);
        $this->assertNull($child->deleted_at);
        $this->assertNull($grandchild->deleted_at);
        $this->assertNull($root->deleted_by);
        $this->assertNull($child->deleted_by);
        $this->assertNull($grandchild->deleted_by);
        $this->assertNull($root->parent_id);
        $this->assertSame($root->id, (int) $child->parent_id);
        $this->assertSame($child->id, (int) $grandchild->parent_id);

        $activeIds = collect($this->getJson('/api/categories')->assertOk()->json())
            ->pluck('id')
            ->all();

        $this->assertSame([$root->id, $child->id, $grandchild->id, $sibling->id], $activeIds);
    }

    public function test_bulk_restore_recovers_multiple_deleted_branches_and_tree_nodes(): void
    {
        $rootA = $this->createCategory('Danh mục cha A', null, 0);
        $childA = $this->createCategory('Danh mục con A', $rootA, 0);
        $rootB = $this->createCategory('Danh mục cha B', null, 1);
        $childB = $this->createCategory('Danh mục con B', $rootB, 0);
        $grandchildB = $this->createCategory('Danh mục cháu B', $childB, 0);

        $this->authenticateAdmin();

        $this->deleteJson('/api/categories/bulk-delete', [
            'ids' => [$rootA->id, $childB->id],
        ])->assertOk()->assertJsonPath('trashed_count', 4);

        $this->postJson('/api/categories/bulk-restore', [
            'ids' => [$rootA->id, $childB->id],
        ])->assertOk()->assertJsonPath('restored_count', 4);

        $this->assertFalse(Category::withTrashed()->findOrFail($rootA->id)->trashed());
        $this->assertFalse(Category::withTrashed()->findOrFail($childA->id)->trashed());
        $this->assertFalse(Category::withTrashed()->findOrFail($childB->id)->trashed());
        $this->assertFalse(Category::withTrashed()->findOrFail($grandchildB->id)->trashed());
        $this->assertNull(Category::withTrashed()->findOrFail($rootA->id)->deleted_by);
        $this->assertNull(Category::withTrashed()->findOrFail($childA->id)->deleted_by);
        $this->assertNull(Category::withTrashed()->findOrFail($childB->id)->deleted_by);
        $this->assertNull(Category::withTrashed()->findOrFail($grandchildB->id)->deleted_by);
        $this->assertSame($rootA->id, (int) Category::findOrFail($childA->id)->parent_id);
        $this->assertSame($rootB->id, (int) Category::findOrFail($childB->id)->parent_id);
        $this->assertSame($childB->id, (int) Category::findOrFail($grandchildB->id)->parent_id);
    }

    public function test_trash_listing_works_on_public_get_route_with_bearer_token_like_frontend(): void
    {
        [$root, $child, $grandchild, $sibling] = $this->makeBasicTree();
        $admin = User::factory()->create(['is_admin' => true]);
        $token = $admin->createToken('category-trash-test')->plainTextToken;

        $headers = [
            'Authorization' => 'Bearer ' . $token,
            'Accept' => 'application/json',
        ];

        $this->withHeaders($headers)
            ->deleteJson("/api/categories/{$root->id}")
            ->assertOk()
            ->assertJsonPath('trashed_count', 3);

        $trashIds = collect(
            $this->withHeaders($headers)
                ->getJson('/api/categories?is_trash=1')
                ->assertOk()
                ->json()
        )->pluck('id')->all();

        $activeIds = collect(
            $this->withHeaders($headers)
                ->getJson('/api/categories')
                ->assertOk()
                ->json()
        )->pluck('id')->all();

        $this->assertSame([$root->id, $child->id, $grandchild->id], $trashIds);
        $this->assertSame([$sibling->id], $activeIds);
    }

    private function authenticateAdmin(): User
    {
        $user = User::factory()->create(['is_admin' => true]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function makeBasicTree(): array
    {
        $root = $this->createCategory('Danh mục cha', null, 0);
        $child = $this->createCategory('Danh mục con', $root, 0);
        $grandchild = $this->createCategory('Danh mục cháu', $child, 0);
        $sibling = $this->createCategory('Danh mục ngang hàng', null, 1);

        return [$root, $child, $grandchild, $sibling];
    }

    private function makeBasicTreeWithoutSibling(): array
    {
        $root = $this->createCategory('Danh mục cha riêng', null, 0);
        $child = $this->createCategory('Danh mục con riêng', $root, 0);
        $grandchild = $this->createCategory('Danh mục cháu riêng', $child, 0);

        return [$root, $child, $grandchild];
    }

    private function createCategory(string $name, ?Category $parent = null, int $order = 0): Category
    {
        $slugBase = Str::slug($name) ?: 'danh-muc';
        $suffix = Str::lower(Str::random(6));

        return Category::query()->create([
            'name' => $name,
            'code' => "{$slugBase}-{$suffix}",
            'slug' => "{$slugBase}-{$suffix}",
            'parent_id' => $parent?->id,
            'status' => true,
            'order' => $order,
            'display_layout' => 'layout_1',
            'filterable_attribute_ids' => [],
        ]);
    }
}
