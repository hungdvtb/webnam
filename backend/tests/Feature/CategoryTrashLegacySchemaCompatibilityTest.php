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

class CategoryTrashLegacySchemaCompatibilityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Category::forgetOptionalSoftDeleteSupportCache();
        Model::clearBootedModels();

        Schema::disableForeignKeyConstraints();
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
            $table->timestamps();
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

    public function test_destroy_and_restore_bootstrap_trash_columns_for_legacy_schema(): void
    {
        [$root, $child, $grandchild, $sibling] = $this->makeBasicTree();
        $admin = $this->authenticateAdmin();

        $this->assertFalse(Schema::hasColumn('categories', 'deleted_at'));
        $this->assertFalse(Schema::hasColumn('categories', 'deleted_by'));

        $this->deleteJson("/api/categories/{$root->id}")
            ->assertOk()
            ->assertJsonPath('trashed_count', 3);

        $this->assertTrue(Schema::hasColumn('categories', 'deleted_at'));
        $this->assertTrue(Schema::hasColumn('categories', 'deleted_by'));
        $this->assertSoftDeleted('categories', ['id' => $root->id]);
        $this->assertSoftDeleted('categories', ['id' => $child->id]);
        $this->assertSoftDeleted('categories', ['id' => $grandchild->id]);
        $this->assertDatabaseHas('categories', ['id' => $root->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $child->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $grandchild->id, 'deleted_by' => $admin->id]);
        $this->assertDatabaseHas('categories', ['id' => $sibling->id, 'deleted_at' => null, 'deleted_by' => null]);

        $trashIds = collect($this->getJson('/api/categories?is_trash=1')->assertOk()->json())
            ->pluck('id')
            ->all();

        $this->assertSame([$root->id, $child->id, $grandchild->id], $trashIds);

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

    private function authenticateAdmin(): User
    {
        $user = User::factory()->create(['is_admin' => true]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function makeBasicTree(): array
    {
        $root = $this->createCategory('legacy-parent', null, 0);
        $child = $this->createCategory('legacy-child', $root, 0);
        $grandchild = $this->createCategory('legacy-grandchild', $child, 0);
        $sibling = $this->createCategory('legacy-sibling', null, 1);

        return [$root, $child, $grandchild, $sibling];
    }

    private function createCategory(string $name, ?Category $parent = null, int $order = 0): Category
    {
        $slugBase = Str::slug($name) ?: 'category';
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
