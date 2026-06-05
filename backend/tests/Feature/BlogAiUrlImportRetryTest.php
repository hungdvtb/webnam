<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BlogAiBulkJob;
use App\Models\BlogAiUrlImportItem;
use App\Models\Post;
use App\Models\User;
use App\Services\AI\GeminiService;
use App\Services\BlogAi\BlogAiUrlImportService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class BlogAiUrlImportRetryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware([
            \App\Http\Middleware\EnsureAdminPermission::class,
            \App\Http\Middleware\AuditAdminAction::class,
            \App\Http\Middleware\FilterSensitiveAdminData::class,
        ]);

        $this->createDatabaseSchema();
    }

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    public function test_retry_failed_processes_only_failed_items_without_resetting_completed_or_pending_items(): void
    {
        $account = Account::create([
            'name' => 'AI URL Retry Store',
            'domain' => 'ai-url-retry.local',
            'subdomain' => 'ai-url-retry',
            'site_code' => 'AI_URL_RETRY',
        ]);

        $user = User::query()->create([
            'name' => 'Retry Tester',
            'email' => 'retry-tester@example.test',
            'password' => 'secret',
            'is_admin' => true,
            'status' => 1,
        ]);
        Sanctum::actingAs($user);

        $completedPost = Post::query()->create([
            'account_id' => $account->id,
            'title' => 'Bai da tao thanh cong',
            'slug' => 'bai-da-tao-thanh-cong',
            'content' => '<p>Noi dung da tao.</p>',
            'is_published' => false,
        ]);

        $job = BlogAiBulkJob::query()->create([
            'account_id' => $account->id,
            'created_by' => $user->id,
            'status' => BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS,
            'source_filename' => 'URL: competitor.test',
            'source_disk' => 'url',
            'source_path' => 'https://competitor.test/blog',
            'total_keywords' => 3,
            'unique_keywords' => 3,
            'cluster_count' => 3,
            'processed_clusters' => 2,
            'posts_created' => 1,
            'posts_failed' => 1,
            'summary' => [
                'ai_requests_used' => 0,
                'max_ai_requests' => 20,
                'pending_items' => 1,
                'completed_items' => 1,
                'failed_items' => 1,
                'total_items' => 3,
            ],
            'metadata' => [
                'source_type' => BlogAiUrlImportService::SOURCE_TYPE,
                'source_url' => 'https://competitor.test/blog',
                'max_ai_requests' => 20,
            ],
        ]);

        $pendingItem = BlogAiUrlImportItem::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'position' => 1,
            'source_url' => 'https://competitor.test/pending-source',
            'source_hash' => sha1('https://competitor.test/pending-source'),
            'source_title' => 'Bai chua chay',
            'status' => BlogAiUrlImportItem::STATUS_PENDING,
        ]);

        $failedUrl = 'https://competitor.test/failed-source';
        $failedItem = BlogAiUrlImportItem::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'position' => 2,
            'source_url' => $failedUrl,
            'source_hash' => sha1($failedUrl),
            'source_title' => 'Bai dang loi',
            'status' => BlogAiUrlImportItem::STATUS_FAILED,
            'last_error' => 'Loi lan chay truoc.',
            'finished_at' => now(),
        ]);

        $completedItem = BlogAiUrlImportItem::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'position' => 3,
            'source_url' => 'https://competitor.test/completed-source',
            'source_hash' => sha1('https://competitor.test/completed-source'),
            'source_title' => 'Bai OK',
            'status' => BlogAiUrlImportItem::STATUS_COMPLETED,
            'post_id' => $completedPost->id,
            'generated_title' => $completedPost->title,
            'finished_at' => now(),
        ]);

        Http::preventStrayRequests();
        Http::fake([
            $failedUrl => Http::response($this->sourceArticleHtml(), 200),
        ]);

        $gemini = Mockery::mock(GeminiService::class);
        $gemini->shouldReceive('generateText')
            ->once()
            ->andReturn([
                'text' => json_encode([
                    'title' => 'Bai chay lai thanh cong',
                    'slug_hint' => 'bai-chay-lai-thanh-cong',
                    'excerpt' => 'Mo ta ngan sau khi chay lai.',
                    'seo_title' => 'Bai chay lai thanh cong',
                    'seo_description' => 'Mo ta SEO sau khi chay lai.',
                    'seo_keywords' => ['gom su', 'bat trang', 'do tho', 'qua tang'],
                    'category_name' => 'Kien thuc gom su',
                    'sections' => [
                        [
                            'heading' => 'Tong quan',
                            'paragraphs' => ['Noi dung moi sau khi retry thanh cong.'],
                            'list_items' => ['Y chinh thu nhat'],
                        ],
                        [
                            'heading' => 'Lua chon',
                            'paragraphs' => ['Thong tin duoc viet lai tu nguon nghien cuu.'],
                            'list_items' => ['Y chinh thu hai'],
                        ],
                        [
                            'heading' => 'Ung dung',
                            'paragraphs' => ['Goi y ung dung phu hop voi nguoi mua.'],
                            'list_items' => [],
                        ],
                    ],
                    'faq' => [
                        ['question' => 'Co can tu van them khong?', 'answer' => 'Nen lien he de duoc tu van ro hon.'],
                        ['question' => 'Bai viet co xuat ban ngay khong?', 'answer' => 'Bai retry duoc luu nhap de kiem tra truoc.'],
                    ],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'model' => 'gemini-test',
            ]);
        $this->app->instance(GeminiService::class, $gemini);

        $headers = ['X-Account-Id' => (string) $account->id];

        $firstResponse = $this->withHeaders($headers)->postJson(
            "/api/blog/ai-url/jobs/{$job->id}/process-next",
            ['retry_failed' => true, 'retry_item_ids' => [$failedItem->id]]
        );
        $secondResponse = $this->withHeaders($headers)->postJson(
            "/api/blog/ai-url/jobs/{$job->id}/process-next",
            ['retry_failed' => true, 'retry_item_ids' => []]
        );

        $firstResponse->assertOk();
        $secondResponse->assertOk();

        $this->assertSame($failedItem->id, $firstResponse->json('item.id'));
        $this->assertFalse((bool) $firstResponse->json('done'));
        $this->assertTrue((bool) $secondResponse->json('done'));

        $this->assertSame(BlogAiUrlImportItem::STATUS_PENDING, $pendingItem->refresh()->status);
        $this->assertNull($pendingItem->post_id);

        $this->assertSame(BlogAiUrlImportItem::STATUS_COMPLETED, $completedItem->refresh()->status);
        $this->assertSame($completedPost->id, $completedItem->post_id);
        $this->assertSame($completedPost->title, $completedItem->generated_title);

        $this->assertSame(BlogAiUrlImportItem::STATUS_COMPLETED, $failedItem->refresh()->status);
        $this->assertNotNull($failedItem->post_id);
        $this->assertSame('Bai chay lai thanh cong', $failedItem->generated_title);

        $this->assertSame(2, $secondResponse->json('data.summary.completed_items'));
        $this->assertSame(1, $secondResponse->json('data.summary.pending_items'));
        $this->assertSame(0, $secondResponse->json('data.summary.failed_items'));
    }

    public function test_pending_items_are_processed_in_batches_of_three_with_one_ai_request(): void
    {
        $account = Account::create([
            'name' => 'AI URL Batch Store',
            'domain' => 'ai-url-batch.local',
            'subdomain' => 'ai-url-batch',
            'site_code' => 'AI_URL_BATCH',
        ]);

        $user = User::query()->create([
            'name' => 'Batch Tester',
            'email' => 'batch-tester@example.test',
            'password' => 'secret',
            'is_admin' => true,
            'status' => 1,
        ]);
        Sanctum::actingAs($user);

        $job = BlogAiBulkJob::query()->create([
            'account_id' => $account->id,
            'created_by' => $user->id,
            'status' => BlogAiBulkJob::STATUS_SCANNED,
            'source_filename' => 'URL: competitor.test',
            'source_disk' => 'url',
            'source_path' => 'https://competitor.test/blog',
            'total_keywords' => 3,
            'unique_keywords' => 3,
            'cluster_count' => 3,
            'summary' => [
                'ai_requests_used' => 0,
                'max_ai_requests' => 20,
                'pending_items' => 3,
                'completed_items' => 0,
                'failed_items' => 0,
                'total_items' => 3,
            ],
            'metadata' => [
                'source_type' => BlogAiUrlImportService::SOURCE_TYPE,
                'source_url' => 'https://competitor.test/blog',
                'max_ai_requests' => 20,
            ],
        ]);

        $urls = [
            'https://competitor.test/source-1',
            'https://competitor.test/source-2',
            'https://competitor.test/source-3',
        ];

        foreach ($urls as $index => $url) {
            BlogAiUrlImportItem::query()->create([
                'blog_ai_bulk_job_id' => $job->id,
                'position' => $index + 1,
                'source_url' => $url,
                'source_hash' => sha1($url),
                'source_title' => 'Bai nguon ' . ($index + 1),
                'status' => BlogAiUrlImportItem::STATUS_PENDING,
            ]);
        }

        Http::preventStrayRequests();
        Http::fake(collect($urls)
            ->mapWithKeys(fn (string $url) => [$url => Http::response($this->sourceArticleHtml(), 200)])
            ->all());

        $usage = [
            'promptTokenCount' => 120,
            'candidatesTokenCount' => 80,
            'totalTokenCount' => 200,
            'cachedContentTokenCount' => 0,
        ];

        $gemini = Mockery::mock(GeminiService::class);
        $gemini->shouldReceive('generateText')
            ->once()
            ->andReturnUsing(function (string $prompt, ?int $accountId, ?string $model, array $options) use ($account, $usage) {
                $this->assertSame($account->id, $accountId);
                $this->assertStringContainsString('"source_id": "article_1"', $prompt);
                $this->assertStringContainsString('"source_id": "article_2"', $prompt);
                $this->assertStringContainsString('"source_id": "article_3"', $prompt);
                $this->assertIsCallable($options['on_request_attempt'] ?? null);

                $options['on_request_attempt']([
                    'status' => 'success',
                    'model' => 'gemini-test',
                    'attempt' => 1,
                    'key_index' => 1,
                    'usage' => $usage,
                ]);

                return [
                    'text' => json_encode([
                        'articles' => [
                            $this->generatedArticlePayload('article_1', 'Bai batch 1'),
                            $this->generatedArticlePayload('article_2', 'Bai batch 2'),
                            $this->generatedArticlePayload('article_3', 'Bai batch 3'),
                        ],
                    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'model' => 'gemini-test',
                    'usage' => $usage,
                ];
            });
        $this->app->instance(GeminiService::class, $gemini);

        $response = $this->withHeaders(['X-Account-Id' => (string) $account->id])->postJson(
            "/api/blog/ai-url/jobs/{$job->id}/process-next"
        );

        $response->assertOk();
        $this->assertCount(3, $response->json('items'));
        $this->assertSame(1, $response->json('data.summary.ai_requests_used'));
        $this->assertSame(3, $response->json('data.summary.completed_items'));
        $this->assertSame(0, $response->json('data.summary.failed_items'));
        $this->assertSame(3, $response->json('data.summary.ai_articles_created'));
        $this->assertEquals(3.0, $response->json('data.summary.avg_articles_per_ai_request'));
        $this->assertSame(200, $response->json('data.summary.ai_total_tokens_used'));
    }

    public function test_retry_failed_with_empty_retry_batch_does_not_pick_up_remaining_failed_items(): void
    {
        $account = Account::create([
            'name' => 'AI URL Retry Empty Batch Store',
            'domain' => 'ai-url-retry-empty.local',
            'subdomain' => 'ai-url-retry-empty',
            'site_code' => 'AI_URL_RETRY_EMPTY',
        ]);

        $user = User::query()->create([
            'name' => 'Retry Empty Tester',
            'email' => 'retry-empty-tester@example.test',
            'password' => 'secret',
            'is_admin' => true,
            'status' => 1,
        ]);
        Sanctum::actingAs($user);

        $job = BlogAiBulkJob::query()->create([
            'account_id' => $account->id,
            'created_by' => $user->id,
            'status' => BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS,
            'source_filename' => 'URL: competitor.test',
            'source_disk' => 'url',
            'source_path' => 'https://competitor.test/blog',
            'total_keywords' => 1,
            'unique_keywords' => 1,
            'cluster_count' => 1,
            'processed_clusters' => 1,
            'posts_created' => 0,
            'posts_failed' => 1,
            'summary' => [
                'ai_requests_used' => 0,
                'max_ai_requests' => 20,
                'pending_items' => 0,
                'completed_items' => 0,
                'failed_items' => 1,
                'total_items' => 1,
            ],
            'metadata' => [
                'source_type' => BlogAiUrlImportService::SOURCE_TYPE,
                'source_url' => 'https://competitor.test/blog',
                'max_ai_requests' => 20,
            ],
        ]);

        $failedItem = BlogAiUrlImportItem::query()->create([
            'blog_ai_bulk_job_id' => $job->id,
            'position' => 1,
            'source_url' => 'https://competitor.test/still-failed-source',
            'source_hash' => sha1('https://competitor.test/still-failed-source'),
            'source_title' => 'Bai van dang loi',
            'status' => BlogAiUrlImportItem::STATUS_FAILED,
            'last_error' => 'Loi sau khi retry.',
            'finished_at' => now(),
        ]);

        $response = $this->withHeaders(['X-Account-Id' => (string) $account->id])->postJson(
            "/api/blog/ai-url/jobs/{$job->id}/process-next",
            ['retry_failed' => true, 'retry_item_ids' => []]
        );

        $response->assertOk();
        $this->assertTrue((bool) $response->json('done'));
        $this->assertNull($response->json('item'));
        $this->assertSame(BlogAiUrlImportItem::STATUS_FAILED, $failedItem->refresh()->status);
        $this->assertSame(0, $response->json('data.summary.completed_items'));
        $this->assertSame(0, $response->json('data.summary.pending_items'));
        $this->assertSame(1, $response->json('data.summary.failed_items'));
        $this->assertSame(BlogAiBulkJob::STATUS_COMPLETED_WITH_ERRORS, $response->json('data.status'));
    }

    private function sourceArticleHtml(): string
    {
        $paragraph = 'Bai viet nguon mo ta nhieu kinh nghiem lua chon gom su, cach xem chat men, hoa tiet, cong nang, va cach can nhac ngan sach truoc khi mua de nguoi doc co co so tham khao day du.';

        return '<html><body><main>'
            . '<h1>Kinh nghiem chon gom su tu nguon doi thu</h1>'
            . '<p>' . $paragraph . '</p>'
            . '<p>' . $paragraph . '</p>'
            . '<p>' . $paragraph . '</p>'
            . '<p>' . $paragraph . '</p>'
            . '</main></body></html>';
    }

    private function generatedArticlePayload(string $sourceId, string $title): array
    {
        return [
            'source_id' => $sourceId,
            'title' => $title,
            'slug_hint' => Str::slug($title),
            'excerpt' => 'Mo ta ngan cho bai viet batch.',
            'seo_title' => $title,
            'seo_description' => 'Mo ta SEO cho bai viet batch.',
            'seo_keywords' => ['gom su', 'bat trang', 'do tho', 'qua tang'],
            'category_name' => 'Kien thuc gom su',
            'content_html' => '<h2>Tong quan</h2><p>Noi dung batch duoc viet moi tu nguon nghien cuu.</p>',
            'faq' => [
                ['question' => 'Co luu nhap khong?', 'answer' => 'Co, bai AI URL duoc luu nhap.'],
                ['question' => 'Co goi AI phu khong?', 'answer' => 'Khong, SEO va HTML nam trong cung request.'],
            ],
        ];
    }

    private function createDatabaseSchema(): void
    {
        foreach ([
            'blog_ai_url_import_items',
            'blog_ai_bulk_job_logs',
            'blog_ai_bulk_jobs',
            'posts',
            'blog_categories',
            'site_domains',
            'site_settings',
            'accounts',
            'users',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->boolean('is_admin')->default(false);
            $table->unsignedTinyInteger('status')->default(1);
            $table->json('permissions')->nullable();
            $table->timestamps();
        });

        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('domain')->nullable();
            $table->string('subdomain')->nullable();
            $table->string('site_code')->nullable();
            $table->boolean('status')->default(true);
            $table->text('ai_api_key')->nullable();
            $table->timestamps();
        });

        Schema::create('site_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable();
            $table->string('key');
            $table->text('value')->nullable();
            $table->timestamps();
        });

        Schema::create('site_domains', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id');
            $table->string('domain');
            $table->boolean('is_active')->default(true);
            $table->boolean('is_default')->default(false);
            $table->timestamps();
        });

        Schema::create('blog_categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id');
            $table->string('name');
            $table->string('slug');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('posts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id');
            $table->foreignId('blog_category_id')->nullable();
            $table->string('title');
            $table->string('slug');
            $table->string('seo_keyword')->nullable();
            $table->longText('content');
            $table->text('excerpt')->nullable();
            $table->string('meta_title')->nullable();
            $table->text('meta_description')->nullable();
            $table->text('meta_keywords')->nullable();
            $table->string('featured_image')->nullable();
            $table->foreignId('featured_media_asset_id')->nullable();
            $table->boolean('is_ai_generated')->default(false);
            $table->boolean('is_system')->default(false);
            $table->boolean('is_published')->default(false);
            $table->boolean('is_starred')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamp('published_at')->nullable();
            $table->longText('search_text')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });

        Schema::create('blog_ai_bulk_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id');
            $table->foreignId('created_by')->nullable();
            $table->string('status', 40)->default('pending');
            $table->string('source_filename', 255);
            $table->string('source_disk', 50)->default('local');
            $table->string('source_path', 500);
            $table->unsignedInteger('total_keywords')->default(0);
            $table->unsignedInteger('unique_keywords')->default(0);
            $table->unsignedInteger('cluster_count')->default(0);
            $table->unsignedInteger('processed_clusters')->default(0);
            $table->unsignedInteger('categories_created')->default(0);
            $table->unsignedInteger('posts_created')->default(0);
            $table->unsignedInteger('posts_failed')->default(0);
            $table->string('ai_model', 120)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->json('summary')->nullable();
            $table->json('errors')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();
        });

        Schema::create('blog_ai_bulk_job_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blog_ai_bulk_job_id');
            $table->string('level', 20)->default('info');
            $table->string('step', 80)->nullable();
            $table->text('message');
            $table->json('context')->nullable();
            $table->timestamps();
        });

        Schema::create('blog_ai_url_import_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('blog_ai_bulk_job_id');
            $table->unsignedInteger('position')->default(0);
            $table->string('source_url', 1000);
            $table->string('source_hash', 64);
            $table->string('source_title', 500)->nullable();
            $table->string('status', 40)->default('pending');
            $table->foreignId('post_id')->nullable();
            $table->string('generated_title', 500)->nullable();
            $table->string('last_model', 120)->nullable();
            $table->text('source_brief')->nullable();
            $table->text('last_error')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });
    }
}
