<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BlogAiBulkJob;
use App\Models\BlogCategory;
use App\Models\Category;
use App\Models\Post;
use App\Models\Product;
use App\Models\User;
use App\Services\AI\GeminiService;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class BlogAiBulkGenerationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Storage::fake('r2');
        config([
            'media.disk' => 'r2',
            'media.public_base_url' => '',
        ]);
    }

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    public function test_it_creates_draft_blog_posts_from_keyword_excel(): void
    {
        $account = Account::create([
            'name' => 'SEO Blog Store',
            'domain' => 'seo-blog.local',
            'subdomain' => 'seo-blog',
            'site_code' => 'SEO_BLOG',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $productCategory = Category::query()->create([
            'account_id' => $account->id,
            'name' => 'Do tho Bat Trang',
            'slug' => 'do-tho-bat-trang',
            'status' => 1,
            'order' => 1,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Bo do tho Bat Trang men lam',
            'slug' => 'bo-do-tho-bat-trang-men-lam',
            'category_id' => $productCategory->id,
            'status' => true,
            'sku' => 'DDT-001',
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Qua tang gom su doanh nghiep',
            'slug' => 'qua-tang-gom-su-doanh-nghiep',
            'category_id' => $productCategory->id,
            'status' => true,
            'sku' => 'QTGS-001',
        ]);

        $gemini = Mockery::mock(GeminiService::class);
        $gemini->shouldReceive('generateText')
            ->andReturnUsing(function () {
                return [
                    'text' => json_encode([
                        'title' => 'Bai viet AI gom su Bat Trang',
                        'slug_hint' => 'bai-viet-ai-gom-su-bat-trang',
                        'excerpt' => 'Mo ta ngan gon, ro y va dung search intent cho nguoi doc.',
                        'seo_title' => 'Bai viet AI gom su Bat Trang',
                        'seo_description' => 'Mo ta SEO ngan gon va du thuyet phuc.',
                        'seo_keywords' => ['gom Bat Trang', 'do tho Bat Trang', 'qua tang gom su', 'gom su dep'],
                        'category_name' => 'Kien thuc gom su Bat Trang',
                        'image_brief' => 'Anh bia phong cach gom su Bat Trang.',
                        'sections' => [
                            [
                                'heading' => 'Tong quan',
                                'paragraphs' => ['Doan mo ta thu nhat.', 'Doan mo ta thu hai.'],
                                'list_items' => ['Y thu nhat', 'Y thu hai'],
                            ],
                            [
                                'heading' => 'Lua chon',
                                'paragraphs' => ['Doan mo ta thu ba.'],
                                'list_items' => ['Y thu ba', 'Y thu tu'],
                            ],
                            [
                                'heading' => 'Ung dung',
                                'paragraphs' => ['Doan mo ta thu tu.'],
                                'list_items' => [],
                            ],
                        ],
                        'faq' => [
                            ['question' => 'Cau hoi 1?', 'answer' => 'Tra loi 1.'],
                            ['question' => 'Cau hoi 2?', 'answer' => 'Tra loi 2.'],
                        ],
                    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'model' => 'gemini-test',
                ];
            });
        $this->app->instance(GeminiService::class, $gemini);

        $binary = SimpleXlsx::buildWorkbook([
            [
                'name' => 'Keywords',
                'rows' => [
                    ['keyword', 'search volume'],
                    ['bo do tho bat trang', 1200],
                    ['cach chon bo do tho bat trang', 450],
                    ['qua tang gom su doanh nghiep', 920],
                    ['kinh nghiem chon qua tang gom su', 310],
                ],
            ],
        ]);

        $file = UploadedFile::fake()->createWithContent('seo-keywords.xlsx', $binary);

        $createResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/ai-bulk/jobs', [
            'file' => $file,
        ]);

        $createResponse->assertCreated();
        $jobId = (int) $createResponse->json('data.id');

        $runResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson("/api/blog/ai-bulk/jobs/{$jobId}/run");

        $runResponse
            ->assertOk()
            ->assertJsonPath('data.status', BlogAiBulkJob::STATUS_COMPLETED)
            ->assertJsonPath('data.posts_created', 2)
            ->assertJsonPath('data.categories_created', 2);

        $posts = Post::query()
            ->where('account_id', $account->id)
            ->where('is_system', false)
            ->orderBy('id')
            ->get();

        $this->assertCount(2, $posts);
        $this->assertTrue($posts->every(fn (Post $post) => !$post->is_published));
        $this->assertTrue($posts->every(fn (Post $post) => filled($post->meta_title)));
        $this->assertTrue($posts->every(fn (Post $post) => filled($post->meta_description)));
        $this->assertTrue($posts->every(fn (Post $post) => filled($post->meta_keywords)));
        $this->assertTrue($posts->every(fn (Post $post) => filled($post->featured_image)));
        $this->assertTrue($posts->every(fn (Post $post) => $post->featured_media_asset_id !== null));
        $this->assertTrue($posts->contains(fn (Post $post) => str_contains((string) $post->content, '/blog?category=')));

        $categories = BlogCategory::query()->where('account_id', $account->id)->pluck('name')->all();
        $this->assertContains('Kien thuc do tho Bat Trang', $categories);
        $this->assertContains('Kinh nghiem chon qua tang gom su', $categories);

        $this->assertDatabaseHas('blog_ai_bulk_job_logs', [
            'blog_ai_bulk_job_id' => $jobId,
            'step' => 'save_post',
        ]);

        $showResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->getJson("/api/blog/ai-bulk/jobs/{$jobId}");

        $showResponse
            ->assertOk()
            ->assertJsonCount(2, 'data.summary.created_post_ids')
            ->assertJsonPath('data.summary.posts_updated', 0);
    }

    public function test_it_marks_job_failed_when_required_columns_are_missing(): void
    {
        $account = Account::create([
            'name' => 'Invalid SEO Blog',
            'domain' => 'invalid-seo.local',
            'subdomain' => 'invalid-seo',
            'site_code' => 'INVALID_SEO',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $binary = SimpleXlsx::buildWorkbook([
            [
                'name' => 'Keywords',
                'rows' => [
                    ['keyword', 'note'],
                    ['bo do tho bat trang', 'missing volume'],
                ],
            ],
        ]);

        $file = UploadedFile::fake()->createWithContent('invalid-keywords.xlsx', $binary);

        $createResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/ai-bulk/jobs', [
            'file' => $file,
        ]);

        $createResponse->assertCreated();
        $jobId = (int) $createResponse->json('data.id');

        $runResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson("/api/blog/ai-bulk/jobs/{$jobId}/run");

        $runResponse
            ->assertOk()
            ->assertJsonPath('data.status', BlogAiBulkJob::STATUS_FAILED);

        $this->assertSame(0, Post::query()->where('account_id', $account->id)->where('is_system', false)->count());
        $this->assertDatabaseHas('blog_ai_bulk_job_logs', [
            'blog_ai_bulk_job_id' => $jobId,
            'step' => 'failed',
        ]);
    }

    public function test_it_respects_requested_post_count_when_running_bulk_generation(): void
    {
        $account = Account::create([
            'name' => 'Limited SEO Blog',
            'domain' => 'limited-seo.local',
            'subdomain' => 'limited-seo',
            'site_code' => 'LIMITED_SEO',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $counter = 0;
        $gemini = Mockery::mock(GeminiService::class);
        $gemini->shouldReceive('generateText')
            ->twice()
            ->andReturnUsing(function () use (&$counter) {
                $counter++;

                return [
                    'text' => json_encode([
                        'title' => 'Bai viet AI gioi han so ' . $counter,
                        'slug_hint' => 'bai-viet-ai-gioi-han-so-' . $counter,
                        'excerpt' => 'Noi dung duoc tao theo so bai da chon.',
                        'seo_title' => 'Bai viet AI gioi han so ' . $counter,
                        'seo_description' => 'Mo ta SEO cho bai viet gioi han so ' . $counter . '.',
                        'seo_keywords' => ['gom Bat Trang', 'seo blog', 'keyword cluster', 'bai viet ai'],
                        'category_name' => 'Kien thuc gom su Bat Trang',
                        'image_brief' => 'Anh bia blog gom su Bat Trang.',
                        'sections' => [
                            [
                                'heading' => 'Tong quan',
                                'paragraphs' => ['Noi dung mo ta chinh.'],
                                'list_items' => ['Y 1', 'Y 2'],
                            ],
                            [
                                'heading' => 'Chi tiet',
                                'paragraphs' => ['Noi dung bo sung.'],
                                'list_items' => ['Y 3', 'Y 4'],
                            ],
                            [
                                'heading' => 'Ket luan',
                                'paragraphs' => ['Tong hop va goi y.'],
                                'list_items' => [],
                            ],
                        ],
                        'faq' => [
                            ['question' => 'Cau hoi 1?', 'answer' => 'Tra loi 1.'],
                            ['question' => 'Cau hoi 2?', 'answer' => 'Tra loi 2.'],
                        ],
                    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'model' => 'gemini-limit-test',
                ];
            });
        $this->app->instance(GeminiService::class, $gemini);

        $binary = SimpleXlsx::buildWorkbook([
            [
                'name' => 'Keywords',
                'rows' => [
                    ['keyword', 'search volume'],
                    ['bo do tho bat trang', 1500],
                    ['qua tang gom su doanh nghiep', 1200],
                    ['y nghia loc binh bat trang', 950],
                    ['cach bao quan am chen bat trang', 720],
                ],
            ],
        ]);

        $file = UploadedFile::fake()->createWithContent('limited-keywords.xlsx', $binary);

        $createResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/ai-bulk/jobs', [
            'file' => $file,
            'requested_post_count' => 2,
        ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('data.requested_post_count', 2);

        $jobId = (int) $createResponse->json('data.id');

        $runResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson("/api/blog/ai-bulk/jobs/{$jobId}/run");

        $runResponse
            ->assertOk()
            ->assertJsonPath('data.status', BlogAiBulkJob::STATUS_COMPLETED)
            ->assertJsonPath('data.cluster_count', 2)
            ->assertJsonPath('data.posts_created', 2)
            ->assertJsonPath('data.requested_post_count', 2)
            ->assertJsonPath('data.metadata.total_cluster_candidates', 4)
            ->assertJsonPath('data.summary.selected_cluster_count', 2);

        $this->assertSame(
            2,
            Post::query()->where('account_id', $account->id)->where('is_system', false)->count()
        );
    }

    public function test_it_skips_semantically_duplicate_clusters_against_existing_posts(): void
    {
        $account = Account::create([
            'name' => 'Duplicate Guard Store',
            'domain' => 'duplicate-guard.local',
            'subdomain' => 'duplicate-guard',
            'site_code' => 'DUPLICATE_GUARD',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $blogCategory = BlogCategory::query()->create([
            'account_id' => $account->id,
            'name' => 'Kien thuc do tho Bat Trang',
            'slug' => 'kien-thuc-do-tho-bat-trang',
            'sort_order' => 1,
        ]);

        Post::query()->create([
            'account_id' => $account->id,
            'blog_category_id' => $blogCategory->id,
            'title' => 'Cach chon bo do tho Bat Trang phu hop ban tho gia tien',
            'slug' => 'cach-chon-bo-do-tho-bat-trang-phu-hop-ban-tho-gia-tien',
            'seo_keyword' => 'bo do tho bat trang phu hop ban tho',
            'excerpt' => 'Huong dan chon bo do tho Bat Trang phu hop khong gian tho cung gia tien.',
            'meta_title' => 'Cach chon bo do tho Bat Trang phu hop ban tho gia tien',
            'meta_description' => 'Goi y chon bo do tho Bat Trang, can doi kich thuoc, men su va bo cuc ban tho.',
            'meta_keywords' => 'kinh nghiem chon bo do tho bat trang, bo do tho bat trang phu hop ban tho, cach chon bo do tho bat trang',
            'content' => '<p>Noi dung cu.</p>',
            'is_system' => false,
            'is_published' => false,
            'sort_order' => 1,
        ]);

        $gemini = Mockery::mock(GeminiService::class);
        $gemini->shouldNotReceive('generateText');
        $this->app->instance(GeminiService::class, $gemini);

        $binary = SimpleXlsx::buildWorkbook([
            [
                'name' => 'Keywords',
                'rows' => [
                    ['keyword', 'search volume'],
                    ['kinh nghiem chon bo do tho bat trang', 760],
                    ['bo do tho bat trang phu hop ban tho gia tien', 520],
                ],
            ],
        ]);

        $file = UploadedFile::fake()->createWithContent('duplicate-keywords.xlsx', $binary);

        $createResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/ai-bulk/jobs', [
            'file' => $file,
        ]);

        $createResponse->assertCreated();
        $jobId = (int) $createResponse->json('data.id');

        $runResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson("/api/blog/ai-bulk/jobs/{$jobId}/run");

        $runResponse
            ->assertOk()
            ->assertJsonPath('data.status', BlogAiBulkJob::STATUS_COMPLETED)
            ->assertJsonPath('data.posts_created', 0)
            ->assertJsonPath('data.summary.posts_updated', 0)
            ->assertJsonPath('data.summary.skipped_duplicates', 1);

        $this->assertSame(
            1,
            Post::query()->where('account_id', $account->id)->where('is_system', false)->count()
        );

        $this->assertDatabaseHas('blog_ai_bulk_job_logs', [
            'blog_ai_bulk_job_id' => $jobId,
            'step' => 'duplicate_cluster',
        ]);
    }
}
