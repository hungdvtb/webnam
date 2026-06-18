<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Post;
use App\Models\Product;
use App\Models\ProductFaq;
use App\Models\SiteDomain;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductFaqApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_product_faqs_only_return_visible_items_in_sort_order(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham co hoi dap',
            'slug' => 'san-pham-co-hoi-dap-' . Str::lower(Str::random(5)),
            'sku' => 'FAQ-' . Str::upper(Str::random(4)),
            'price' => 100000,
            'expected_cost' => 70000,
            'cost_price' => 70000,
            'stock_quantity' => 0,
            'status' => true,
        ]);

        $this->createFaq(
            $account,
            $product,
            'Cau hoi thu hai?',
            20,
            ProductFaq::STATUS_VISIBLE,
            'Tra loi thu hai tu admin.',
            [['url' => '/storage/faqs/second.jpg', 'thumbnail_url' => '/storage/faqs/second-thumb.jpg']],
            'https://www.youtube.com/watch?v=abc12345678'
        );
        $this->createFaq($account, $product, 'Cau hoi thu nhat?', 10, ProductFaq::STATUS_VISIBLE, 'Tra loi thu nhat tu admin.');
        $this->createFaq($account, $product, 'Cau hoi bi an?', 5, ProductFaq::STATUS_HIDDEN);

        $response = $this->getJson("/api/products/{$product->id}/faqs");

        $response
            ->assertOk()
            ->assertJsonPath('count', 2)
            ->assertJsonPath('items.0.question', 'Cau hoi thu nhat?')
            ->assertJsonPath('items.0.answer', 'Tra loi thu nhat tu admin.')
            ->assertJsonPath('items.0.status', ProductFaq::STATUS_VISIBLE)
            ->assertJsonPath('items.0.sort_order', 10)
            ->assertJsonPath('items.1.question', 'Cau hoi thu hai?')
            ->assertJsonPath('items.1.answer', 'Tra loi thu hai tu admin.')
            ->assertJsonPath('items.1.images.0.url', '/storage/faqs/second.jpg')
            ->assertJsonPath('items.1.youtube_url', 'https://www.youtube.com/watch?v=abc12345678')
            ->assertJsonPath('items.1.video_url', 'https://www.youtube.com/watch?v=abc12345678')
            ->assertJsonMissingPath('items.2');
    }

    public function test_admin_created_faq_is_returned_by_admin_list_for_the_same_product(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Admin Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-admin-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-admin-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham admin tao FAQ',
            'slug' => 'san-pham-admin-tao-faq-' . Str::lower(Str::random(5)),
            'sku' => 'FAQ-ADMIN-' . Str::upper(Str::random(4)),
            'price' => 120000,
            'expected_cost' => 80000,
            'cost_price' => 80000,
            'stock_quantity' => 0,
            'status' => true,
        ]);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $createResponse = $this->postJson('/api/admin/product-faqs', [
            'product_id' => $product->id,
            'question' => 'Cau hoi moi tu admin?',
            'answer' => 'Tra loi moi duoc luu day du cho dung san pham.',
            'sort_order' => 7,
            'status' => ProductFaq::STATUS_VISIBLE,
        ]);

        $faqId = $createResponse->json('faq.id');

        $createResponse
            ->assertCreated()
            ->assertJsonPath('faq.product_id', $product->id)
            ->assertJsonPath('faq.question', 'Cau hoi moi tu admin?')
            ->assertJsonPath('faq.answer', 'Tra loi moi duoc luu day du cho dung san pham.')
            ->assertJsonPath('faq.sort_order', 7);

        $this->assertDatabaseHas('product_faqs', [
            'id' => $faqId,
            'account_id' => $account->id,
            'product_id' => $product->id,
            'question' => 'Cau hoi moi tu admin?',
            'answer' => 'Tra loi moi duoc luu day du cho dung san pham.',
            'status' => ProductFaq::STATUS_VISIBLE,
        ]);

        $adminListResponse = $this->getJson("/api/admin/product-faqs?product_id={$product->id}");

        $adminListResponse
            ->assertOk()
            ->assertJsonPath('product.id', $product->id)
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $faqId)
            ->assertJsonPath('data.0.product_id', $product->id)
            ->assertJsonPath('data.0.question', 'Cau hoi moi tu admin?')
            ->assertJsonPath('data.0.answer', 'Tra loi moi duoc luu day du cho dung san pham.');

        $publicListResponse = $this->getJson("/api/products/{$product->id}/faqs");

        $publicListResponse
            ->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('items.0.id', $faqId)
            ->assertJsonPath('items.0.question', 'Cau hoi moi tu admin?');
    }

    public function test_faq_answer_html_preserves_required_media_and_link_tags(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Html Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-html-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-html-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $product = $this->createProduct($account, 'San pham co HTML FAQ', 'FAQ-HTML-' . Str::upper(Str::random(4)));

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $answerHtml = implode('', [
            '<p class="chatgpt-copy" style="background:#0084ff;color:#fff;font-family:Arial;font-size:22px">Dong mo dau <span style="color:white;background:blue">bi dinh mau</span> <strong>duoc in dam</strong>.</p>',
            '<p data-testid="source-web"><a href="https://example.com/huong-dan" target="_blank" style="color:red">Xem huong dan</a></p>',
            '<p><img src="/storage/faqs/answer.jpg" alt="Anh minh hoa" style="width: 50%; height: auto;" class="fb-image" onerror="alert(1)"></p>',
            '<video controls poster="/storage/faqs/poster.jpg"><source src="/storage/faqs/clip.mp4" type="video/mp4"></video>',
            '<iframe src="https://www.youtube.com/embed/abc12345678" allowfullscreen="true"></iframe>',
            '<script>alert("bad")</script>',
        ]);

        $createResponse = $this->postJson('/api/admin/product-faqs', [
            'product_id' => $product->id,
            'product_ids' => [$product->id],
            'question' => 'FAQ co HTML media va link?',
            'answer' => $answerHtml,
            'status' => ProductFaq::STATUS_VISIBLE,
        ]);

        $createResponse->assertCreated();
        $storedAnswer = (string) $createResponse->json('faq.answer');

        $this->assertStringContainsString('<a href="https://example.com/huong-dan"', $storedAnswer);
        $this->assertStringContainsString('rel="noopener noreferrer"', $storedAnswer);
        $this->assertStringContainsString('<img', $storedAnswer);
        $this->assertStringContainsString('/storage/faqs/answer.jpg', $storedAnswer);
        $this->assertStringContainsString('<video', $storedAnswer);
        $this->assertStringContainsString('controls', $storedAnswer);
        $this->assertStringContainsString('<source', $storedAnswer);
        $this->assertStringContainsString('/storage/faqs/clip.mp4', $storedAnswer);
        $this->assertStringContainsString('<iframe', $storedAnswer);
        $this->assertStringNotContainsString('<script', $storedAnswer);
        $this->assertStringNotContainsString('onerror', $storedAnswer);
        $this->assertStringNotContainsString('style=', $storedAnswer);
        $this->assertStringNotContainsString('class=', $storedAnswer);
        $this->assertStringNotContainsString('data-testid', $storedAnswer);
        $this->assertStringNotContainsString('background:', $storedAnswer);
        $this->assertStringNotContainsString('color:', $storedAnswer);
        $this->assertStringNotContainsString('font-family', $storedAnswer);
        $this->assertStringNotContainsString('font-size', $storedAnswer);

        $this->getJson("/api/products/{$product->id}/faqs")
            ->assertOk()
            ->assertJsonPath('items.0.answer', $storedAnswer);
    }

    public function test_admin_can_apply_one_faq_to_multiple_products_and_update_shared_content(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Shared Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-shared-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-shared-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $firstProduct = $this->createProduct($account, 'San pham dung FAQ chung A', 'FAQ-SHARED-A-' . Str::upper(Str::random(4)));
        $secondProduct = $this->createProduct($account, 'San pham dung FAQ chung B', 'FAQ-SHARED-B-' . Str::upper(Str::random(4)));

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $createResponse = $this->postJson('/api/admin/product-faqs', [
            'product_id' => $firstProduct->id,
            'product_ids' => [$firstProduct->id, $secondProduct->id],
            'question' => 'Cau hoi dung chung cho nhieu san pham?',
            'answer' => 'Cau tra loi ban dau cho FAQ dung chung.',
            'sort_order' => 4,
            'status' => ProductFaq::STATUS_VISIBLE,
        ]);

        $faqId = $createResponse->json('faq.id');

        $createResponse
            ->assertCreated()
            ->assertJsonPath('faq.product_id', $firstProduct->id)
            ->assertJsonPath('faq.applied_count', 2)
            ->assertJsonPath('faq.is_shared', true);

        $this->assertDatabaseHas('product_faqs', [
            'id' => $faqId,
            'question' => 'Cau hoi dung chung cho nhieu san pham?',
        ]);
        $this->assertDatabaseCount('product_faqs', 1);
        $this->assertDatabaseHas('product_faq_product', [
            'product_faq_id' => $faqId,
            'product_id' => $firstProduct->id,
        ]);
        $this->assertDatabaseHas('product_faq_product', [
            'product_faq_id' => $faqId,
            'product_id' => $secondProduct->id,
        ]);

        $this->getJson("/api/products/{$secondProduct->id}/faqs")
            ->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('items.0.id', $faqId)
            ->assertJsonPath('items.0.answer', 'Cau tra loi ban dau cho FAQ dung chung.');

        $this->postJson("/api/admin/product-faqs/{$faqId}", [
            'product_id' => $firstProduct->id,
            'product_ids' => [$firstProduct->id, $secondProduct->id],
            'question' => 'Cau hoi dung chung cho nhieu san pham?',
            'answer' => 'Cau tra loi da duoc cap nhat dong loat.',
            'sort_order' => 4,
            'status' => ProductFaq::STATUS_VISIBLE,
        ])
            ->assertOk()
            ->assertJsonPath('faq.applied_count', 2)
            ->assertJsonPath('faq.answer', 'Cau tra loi da duoc cap nhat dong loat.');

        $this->getJson("/api/products/{$firstProduct->id}/faqs")
            ->assertOk()
            ->assertJsonPath('items.0.answer', 'Cau tra loi da duoc cap nhat dong loat.');
        $this->getJson("/api/products/{$secondProduct->id}/faqs")
            ->assertOk()
            ->assertJsonPath('items.0.answer', 'Cau tra loi da duoc cap nhat dong loat.');

        $this->getJson("/api/admin/product-faqs?product_id={$secondProduct->id}")
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $faqId)
            ->assertJsonPath('data.0.applied_count', 2);
    }

    public function test_admin_can_save_preuploaded_faq_media_metadata_without_duplicate_uploads(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Media Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-media-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-media-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $firstProduct = $this->createProduct($account, 'San pham FAQ media A', 'FAQ-MEDIA-A-' . Str::upper(Str::random(4)));
        $secondProduct = $this->createProduct($account, 'San pham FAQ media B', 'FAQ-MEDIA-B-' . Str::upper(Str::random(4)));
        $images = [
            [
                'public_id' => '01faqpreuploadedimage000001',
                'url' => 'https://api.example.test/api/media/assets/01faqpreuploadedimage000001/large',
                'thumbnail_url' => 'https://api.example.test/api/media/assets/01faqpreuploadedimage000001/thumbnail',
                'large_url' => 'https://api.example.test/api/media/assets/01faqpreuploadedimage000001/large',
            ],
            [
                'url' => '/storage/faqs/manual-existing.jpg',
                'thumbnail_url' => '/storage/faqs/manual-existing-thumb.jpg',
            ],
        ];

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $createResponse = $this->postJson('/api/admin/product-faqs', [
            'product_id' => $firstProduct->id,
            'product_ids' => [$firstProduct->id, $secondProduct->id],
            'question' => 'FAQ luu media da upload?',
            'answer' => 'Cau tra loi co anh va link Youtube.',
            'existing_images' => $images,
            'youtube_url' => 'https://www.youtube.com/watch?v=abc12345678',
            'status' => ProductFaq::STATUS_VISIBLE,
        ]);

        $faqId = $createResponse->json('faq.id');

        $createResponse
            ->assertCreated()
            ->assertJsonCount(2, 'faq.images')
            ->assertJsonPath('faq.youtube_url', 'https://www.youtube.com/watch?v=abc12345678')
            ->assertJsonPath('faq.applied_count', 2);

        $this->postJson("/api/admin/product-faqs/{$faqId}", [
            'product_id' => $firstProduct->id,
            'product_ids' => [$firstProduct->id, $secondProduct->id],
            'question' => 'FAQ luu media da upload?',
            'answer' => 'Cap nhat text, giu nguyen media da upload.',
            'existing_images' => $createResponse->json('faq.images'),
            'youtube_url' => 'https://www.youtube.com/watch?v=abc12345678',
            'status' => ProductFaq::STATUS_VISIBLE,
        ])
            ->assertOk()
            ->assertJsonCount(2, 'faq.images')
            ->assertJsonPath('faq.applied_count', 2)
            ->assertJsonPath('faq.answer', 'Cap nhat text, giu nguyen media da upload.');

        $this->assertDatabaseHas('product_faqs', [
            'id' => $faqId,
            'youtube_url' => 'https://www.youtube.com/watch?v=abc12345678',
        ]);
        $this->assertDatabaseCount('product_faqs', 1);
        $this->assertDatabaseHas('product_faq_product', [
            'product_faq_id' => $faqId,
            'product_id' => $firstProduct->id,
        ]);
        $this->assertDatabaseHas('product_faq_product', [
            'product_faq_id' => $faqId,
            'product_id' => $secondProduct->id,
        ]);

        $storedImages = ProductFaq::query()->findOrFail($faqId)->images;
        $this->assertCount(2, $storedImages);
    }

    public function test_admin_product_faq_products_endpoint_filters_with_and_without_faqs(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Product Filter Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-filter-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-filter-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);
        $withFaq = $this->createProduct($account, 'San pham co FAQ filter', 'FAQ-FILTER-WITH-' . Str::upper(Str::random(4)));
        $withoutFaq = $this->createProduct($account, 'San pham chua co FAQ filter', 'FAQ-FILTER-WITHOUT-' . Str::upper(Str::random(4)));

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->postJson('/api/admin/product-faqs', [
            'product_id' => $withFaq->id,
            'product_ids' => [$withFaq->id],
            'question' => 'FAQ de test bo loc san pham?',
            'answer' => 'Cau tra loi cho san pham co FAQ.',
            'status' => ProductFaq::STATUS_VISIBLE,
        ])->assertCreated();

        $withResponse = $this->getJson('/api/admin/product-faqs/products?faq_filter=with&search=FAQ-FILTER');
        $withIds = collect($withResponse->json('data'))->pluck('id')->all();

        $withResponse->assertOk();
        $this->assertContains($withFaq->id, $withIds);
        $this->assertNotContains($withoutFaq->id, $withIds);

        $withoutResponse = $this->getJson('/api/admin/product-faqs/products?faq_filter=without&search=FAQ-FILTER');
        $withoutIds = collect($withoutResponse->json('data'))->pluck('id')->all();

        $withoutResponse->assertOk();
        $this->assertContains($withoutFaq->id, $withoutIds);
        $this->assertNotContains($withFaq->id, $withoutIds);
    }

    public function test_bundle_parent_lists_faqs_attached_to_related_bundle_products(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Bundle Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-bundle-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'faq-bundle-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $bundle = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'bundle',
            'name' => 'Bo san pham FAQ bundle',
            'slug' => 'bo-san-pham-faq-bundle-' . Str::lower(Str::random(5)),
            'sku' => 'FAQ-BUNDLE-' . Str::upper(Str::random(4)),
            'price' => 200000,
            'expected_cost' => 120000,
            'cost_price' => 120000,
            'stock_quantity' => 0,
            'status' => true,
        ]);
        $child = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Thanh phan co FAQ',
            'slug' => 'thanh-phan-co-faq-' . Str::lower(Str::random(5)),
            'sku' => 'FAQ-CHILD-' . Str::upper(Str::random(4)),
            'price' => 80000,
            'expected_cost' => 50000,
            'cost_price' => 50000,
            'stock_quantity' => 0,
            'status' => true,
        ]);

        DB::table('product_links')->insert([
            'account_id' => $account->id,
            'product_id' => $bundle->id,
            'linked_product_id' => $child->id,
            'link_type' => 'bundle',
            'quantity' => 1,
            'position' => 1,
            'is_required' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $faq = $this->createFaq($account, $child, 'Cau hoi cua thanh phan bundle?', 3);

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this->getJson("/api/admin/product-faqs?product_id={$bundle->id}")
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $faq->id)
            ->assertJsonPath('data.0.product_id', $child->id);

        $this->getJson("/api/products/{$bundle->id}/faqs")
            ->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('items.0.id', $faq->id)
            ->assertJsonPath('items.0.question', 'Cau hoi cua thanh phan bundle?');
    }

    public function test_related_articles_follow_post_changes_and_hide_deleted_posts_on_public_api(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Related Article Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-related.example',
            'subdomain' => 'faq-related',
            'status' => true,
        ]);
        SiteDomain::query()->create([
            'account_id' => $account->id,
            'domain' => 'https://faq-related.example',
            'is_active' => true,
            'is_default' => true,
        ]);
        $product = $this->createProduct(
            $account,
            'San pham co bai viet lien quan',
            'FAQ-RELATED-' . Str::upper(Str::random(4))
        );
        $selectedPost = $this->createPost($account, 'Huong dan su dung', 'huong-dan-su-dung');
        $manualPost = $this->createPost($account, 'Cach bao quan', 'cach-bao-quan');

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $createResponse = $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->postJson('/api/admin/product-faqs', [
                'product_id' => $product->id,
                'question' => 'Nen doc bai nao truoc khi su dung?',
                'answer' => 'Vui long xem cac bai viet lien quan ben duoi.',
                'related_articles' => [
                    [
                        'source' => 'post',
                        'post_id' => $selectedPost->id,
                    ],
                    [
                        'source' => 'manual',
                        'url' => 'https://faq-related.example/blog/' . $manualPost->slug,
                        'title' => 'Snapshot se duoc thay bang du lieu hien tai',
                    ],
                ],
            ]);

        $faqId = $createResponse->json('faq.id');

        $createResponse
            ->assertCreated()
            ->assertJsonCount(2, 'faq.related_articles')
            ->assertJsonPath('faq.related_articles.0.post_id', $selectedPost->id)
            ->assertJsonPath('faq.related_articles.1.post_id', $manualPost->id);

        $this->getJson("/api/products/{$product->id}/faqs")
            ->assertOk()
            ->assertJsonCount(2, 'items.0.related_articles')
            ->assertJsonPath('items.0.related_articles.0.title', 'Huong dan su dung')
            ->assertJsonPath(
                'items.0.related_articles.0.url',
                'https://faq-related.example/blog/huong-dan-su-dung'
            )
            ->assertJsonPath('items.0.related_articles.1.title', 'Cach bao quan');

        $selectedPost->update([
            'title' => 'Huong dan su dung moi',
            'slug' => 'huong-dan-su-dung-moi',
        ]);
        $manualPost->delete();

        $this->getJson("/api/products/{$product->id}/faqs")
            ->assertOk()
            ->assertJsonCount(1, 'items.0.related_articles')
            ->assertJsonPath('items.0.related_articles.0.title', 'Huong dan su dung moi')
            ->assertJsonPath(
                'items.0.related_articles.0.url',
                'https://faq-related.example/blog/huong-dan-su-dung-moi'
            );

        $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->getJson("/api/admin/product-faqs?product_id={$product->id}")
            ->assertOk()
            ->assertJsonCount(2, 'data.0.related_articles')
            ->assertJsonPath('data.0.related_articles.1.available', false);

        $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->postJson("/api/admin/product-faqs/{$faqId}", [
                'question' => 'Nen doc bai nao truoc khi su dung?',
                'answer' => 'Cap nhat noi dung nhung khong gui related_articles.',
            ])
            ->assertOk()
            ->assertJsonCount(2, 'faq.related_articles');

        $this->assertDatabaseCount('product_faq_related_articles', 2);
    }

    public function test_admin_can_preview_an_internal_blog_link(): void
    {
        $account = Account::query()->create([
            'name' => 'FAQ Preview Account ' . Str::upper(Str::random(4)),
            'domain' => 'faq-preview.example',
            'subdomain' => 'faq-preview',
            'status' => true,
        ]);
        SiteDomain::query()->create([
            'account_id' => $account->id,
            'domain' => 'https://faq-preview.example',
            'is_active' => true,
            'is_default' => true,
        ]);
        $post = $this->createPost($account, 'Bai viet preview', 'bai-viet-preview');

        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->postJson('/api/admin/product-faqs/preview-article-link', [
                'url' => 'https://faq-preview.example/blog/bai-viet-preview',
            ])
            ->assertOk()
            ->assertJsonPath('article.post_id', $post->id)
            ->assertJsonPath('article.source', 'manual')
            ->assertJsonPath('article.title', 'Bai viet preview')
            ->assertJsonPath('article.url', 'https://faq-preview.example/blog/bai-viet-preview');
    }

    private function createFaq(
        Account $account,
        Product $product,
        string $question,
        int $sortOrder,
        string $status = ProductFaq::STATUS_VISIBLE,
        string $answer = 'Tra loi cua shop cho san pham nay.',
        array $images = [],
        ?string $youtubeUrl = null
    ): ProductFaq {
        return ProductFaq::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'question' => $question,
            'answer' => $answer,
            'images' => $images,
            'youtube_url' => $youtubeUrl,
            'sort_order' => $sortOrder,
            'status' => $status,
        ]);
    }

    private function createProduct(Account $account, string $name, string $sku): Product
    {
        return Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'expected_cost' => 70000,
            'cost_price' => 70000,
            'stock_quantity' => 0,
            'status' => true,
        ]);
    }

    private function createPost(Account $account, string $title, string $slug): Post
    {
        return Post::query()->create([
            'account_id' => $account->id,
            'title' => $title,
            'slug' => $slug,
            'content' => '<p>Noi dung bai viet.</p>',
            'excerpt' => 'Mo ta ngan cho ' . $title,
            'featured_image' => '/storage/blog/' . $slug . '.jpg',
            'is_published' => true,
            'published_at' => now()->subMinute(),
        ]);
    }
}
