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
            $table->unsignedBigInteger('account_id')->nullable()->index();
            $table->string('name');
            $table->string('type')->default('cash');
            $table->decimal('initial_balance', 15, 2)->default(0);
            $table->decimal('balance', 15, 2)->default(0);
            $table->text('description')->nullable();
            $table->timestamps();
        });
        Schema::create('fin_categories', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('account_id')->nullable()->index();
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
            'account_id' => 1,
            'name' => 'Nhap hang',
            'type' => 'expense',
            'color' => '#f44336',
            'sort_order' => 30,
        ]);
        $second = FinCategory::query()->create([
            'account_id' => 1,
            'name' => 'Khach chuyen khoan',
            'type' => 'income',
            'color' => '#4caf50',
            'sort_order' => 10,
        ]);
        $third = FinCategory::query()->create([
            'account_id' => 1,
            'name' => 'Luong',
            'type' => 'expense',
            'color' => '#ff9800',
            'sort_order' => 20,
        ]);

        $controller = app(FundController::class);
        $listedCategories = $controller->categories($this->request('/api/finance/funds/categories'))->getData(true);

        $this->assertSame([
            $second->id,
            $third->id,
            $first->id,
        ], array_column($listedCategories['data'], 'id'));

        $reorderResponse = $controller->reorderCategories($this->request(
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

        $this->assertDatabaseHas('fin_categories', ['id' => $first->id, 'account_id' => 1, 'sort_order' => 1]);
        $this->assertDatabaseHas('fin_categories', ['id' => $second->id, 'account_id' => 1, 'sort_order' => 2]);
        $this->assertDatabaseHas('fin_categories', ['id' => $third->id, 'account_id' => 1, 'sort_order' => 3]);

        $saveResponse = $controller->saveCategory($this->request(
            '/api/finance/funds/categories',
            'POST',
            [
                'name' => 'Quang cao',
                'type' => 'expense',
                'color' => '#9c27b0',
            ]
        ))->getData(true);

        $this->assertDatabaseHas('fin_categories', [
            'id' => $saveResponse['data']['id'],
            'account_id' => 1,
            'sort_order' => 4,
        ]);
    }

    public function test_reorder_requires_the_complete_category_list_for_current_account(): void
    {
        $first = FinCategory::query()->create([
            'account_id' => 1,
            'name' => 'Thu',
            'type' => 'income',
            'sort_order' => 1,
        ]);
        FinCategory::query()->create([
            'account_id' => 1,
            'name' => 'Chi',
            'type' => 'expense',
            'sort_order' => 2,
        ]);
        FinCategory::query()->create([
            'account_id' => 2,
            'name' => 'Chi cua hang B',
            'type' => 'expense',
            'sort_order' => 1,
        ]);

        $response = app(FundController::class)->reorderCategories($this->request(
            '/api/finance/funds/categories/reorder',
            'POST',
            ['ids' => [$first->id]]
        ));

        $this->assertSame(422, $response->getStatusCode());
        $this->assertArrayHasKey('ids', $response->getData(true)['errors']);
    }

    private function request(string $uri, string $method = 'GET', array $parameters = []): Request
    {
        return Request::create($uri, $method, $parameters, [], [], [
            'HTTP_X_ACCOUNT_ID' => '1',
        ]);
    }
}
