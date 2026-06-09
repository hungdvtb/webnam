<?php

namespace Tests\Feature;

use App\Http\Controllers\FundController;
use App\Models\FinCategory;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class FundCategoryOrderingTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('fin_accounts');
        Schema::dropIfExists('fin_categories');
        Schema::create('fin_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type')->default('cash');
            $table->decimal('initial_balance', 15, 2)->default(0);
            $table->decimal('balance', 15, 2)->default(0);
            $table->text('description')->nullable();
            $table->timestamps();
        });
        Schema::create('fin_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type')->default('expense');
            $table->string('color')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('fin_categories');
        Schema::dropIfExists('fin_accounts');
        parent::tearDown();
    }

    public function test_categories_can_be_reordered_and_new_categories_are_appended(): void
    {
        $first = FinCategory::query()->create([
            'name' => 'Nhập hàng',
            'type' => 'expense',
            'color' => '#f44336',
            'sort_order' => 30,
        ]);
        $second = FinCategory::query()->create([
            'name' => 'Khách chuyển khoản',
            'type' => 'income',
            'color' => '#4caf50',
            'sort_order' => 10,
        ]);
        $third = FinCategory::query()->create([
            'name' => 'Lương',
            'type' => 'expense',
            'color' => '#ff9800',
            'sort_order' => 20,
        ]);

        $controller = app(FundController::class);
        $listedCategories = $controller->categories()->getData(true);

        $this->assertSame([
            $second->id,
            $third->id,
            $first->id,
        ], array_column($listedCategories['data'], 'id'));

        $reorderResponse = $controller->reorderCategories(Request::create(
            '/api/finance/funds/categories/reorder',
            'POST',
            [
                'ids' => [$first->id, $second->id, $third->id],
            ]
        ))->getData(true);

        $this->assertSame([
            $first->id,
            $second->id,
            $third->id,
        ], array_column($reorderResponse['data'], 'id'));

        $this->assertDatabaseHas('fin_categories', ['id' => $first->id, 'sort_order' => 1]);
        $this->assertDatabaseHas('fin_categories', ['id' => $second->id, 'sort_order' => 2]);
        $this->assertDatabaseHas('fin_categories', ['id' => $third->id, 'sort_order' => 3]);

        $saveResponse = $controller->saveCategory(Request::create(
            '/api/finance/funds/categories',
            'POST',
            [
                'name' => 'Quảng cáo',
                'type' => 'expense',
                'color' => '#9c27b0',
            ]
        ))->getData(true);

        $this->assertDatabaseHas('fin_categories', [
            'id' => $saveResponse['data']['id'],
            'sort_order' => 4,
        ]);
    }

    public function test_reorder_requires_the_complete_category_list(): void
    {
        $first = FinCategory::query()->create([
            'name' => 'Thu',
            'type' => 'income',
            'sort_order' => 1,
        ]);
        FinCategory::query()->create([
            'name' => 'Chi',
            'type' => 'expense',
            'sort_order' => 2,
        ]);

        $response = app(FundController::class)->reorderCategories(Request::create(
            '/api/finance/funds/categories/reorder',
            'POST',
            ['ids' => [$first->id]]
        ));

        $this->assertSame(422, $response->getStatusCode());
        $this->assertArrayHasKey('ids', $response->getData(true)['errors']);
    }
}
