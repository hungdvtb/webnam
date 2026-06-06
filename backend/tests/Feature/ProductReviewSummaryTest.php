<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductReview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProductReviewSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_review_summary_uses_actual_decimal_average_and_visible_top_level_count(): void
    {
        $account = Account::query()->create([
            'name' => 'Review Summary ' . Str::upper(Str::random(4)),
            'domain' => 'review-summary-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'review-summary-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham test review',
            'slug' => 'san-pham-test-review-' . Str::lower(Str::random(5)),
            'sku' => 'REVIEW-SUMMARY-' . Str::upper(Str::random(4)),
            'price' => 100000,
            'expected_cost' => 80000,
            'cost_price' => 80000,
            'stock_quantity' => 0,
            'status' => true,
        ]);

        $firstReview = $this->createReview($account, $product, 4.8);
        $this->createReview($account, $product, 4.9);
        $this->createReview($account, $product, 5.0);

        $this->createReview($account, $product, 1.0, [
            'status' => ProductReview::STATUS_HIDDEN,
            'is_approved' => false,
        ]);
        $this->createReview($account, $product, 5.0, [
            'parent_id' => $firstReview->id,
            'author_type' => 'admin',
        ]);

        $summary = $product->reviewSummary();

        $this->assertSame(4.9, $summary['average_rating']);
        $this->assertSame(3, $summary['total_reviews']);
        $this->assertSame(3, $summary['distribution'][5]);
    }

    private function createReview(Account $account, Product $product, float $rating, array $overrides = []): ProductReview
    {
        return ProductReview::query()->create(array_merge([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'parent_id' => null,
            'author_type' => 'guest',
            'source_type' => ProductReview::SOURCE_ADMIN_AI,
            'customer_name' => 'Nguyen Van A',
            'rating' => $rating,
            'comment' => 'hang dep',
            'status' => ProductReview::STATUS_VISIBLE,
            'is_approved' => true,
            'helpful_count' => 0,
        ], $overrides));
    }
}
