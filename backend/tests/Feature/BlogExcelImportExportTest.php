<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\BlogCategory;
use App\Models\Post;
use App\Models\PostSeoKeyword;
use App\Models\User;
use App\Services\BlogMediaGallerySupport;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class BlogExcelImportExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_blog_posts_can_round_trip_through_a_single_excel_file(): void
    {
        $account = Account::create([
            'name' => 'Blog Export Store',
            'domain' => 'blog-export.local',
            'subdomain' => 'blog-export-store',
            'site_code' => 'BLOG_EXPORT_STORE',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $category = BlogCategory::create([
            'account_id' => $account->id,
            'name' => 'Kien thuc gom',
            'slug' => 'kien-thuc-gom',
            'sort_order' => 1,
        ]);

        $galleryPayload = BlogMediaGallerySupport::encodeMediaGalleryPayload([
            [
                'type' => 'image',
                'src' => '/storage/uploads/blog/gallery-1.jpg',
                'alt' => 'Gallery 1',
            ],
            [
                'type' => 'image',
                'src' => 'https://cdn.example.com/gallery-2.jpg',
                'alt' => 'Gallery 2',
            ],
            [
                'type' => 'video',
                'url' => 'https://www.youtube.com/watch?v=abcdEF12',
                'title' => 'Video huong dan',
            ],
        ]);

        $regularPost = Post::create([
            'account_id' => $account->id,
            'blog_category_id' => $category->id,
            'title' => 'Bai thuong xuat excel',
            'slug' => 'bai-thuong-xuat-excel',
            'excerpt' => 'Mo ta ngan bai thuong',
            'content' => '<h2>Tieu de</h2><p><strong>Noi dung</strong> <a href="/blog/chinh-sach-demo">Xem chi tiet</a></p><p><img src="/storage/uploads/blog/body-inline.jpg" alt="Inline"></p><div class="ql-bdt-media-gallery" data-gallery-payload="' . $galleryPayload . '">Block media</div>',
            'featured_image' => '/storage/uploads/blog/featured.jpg',
            'seo_keyword' => 'gom bat trang',
            'is_published' => true,
            'is_starred' => true,
            'is_system' => false,
            'sort_order' => 3,
            'published_at' => now()->subHour(),
        ]);

        $systemPost = Post::create([
            'account_id' => $account->id,
            'title' => 'Bai he thong excel',
            'slug' => 'bai-he-thong-excel',
            'excerpt' => 'Mo ta bai he thong',
            'content' => '<p><a href="https://example.com/guide">Huong dan</a></p>',
            'featured_image' => 'https://cdn.example.com/system-cover.jpg',
            'seo_keyword' => 'chinh sach',
            'is_published' => false,
            'is_starred' => false,
            'is_system' => true,
            'sort_order' => 9,
            'published_at' => now()->subDay(),
        ]);

        $exportResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/export-excel', [
            'ids' => [$regularPost->id, $systemPost->id],
        ]);

        $exportResponse->assertOk();
        $this->assertStringContainsString('.xlsx', (string) $exportResponse->headers->get('content-disposition'));

        $tempPath = tempnam(sys_get_temp_dir(), 'blog_excel_');
        file_put_contents($tempPath, $exportResponse->getContent());

        $rows = SimpleXlsx::readRows($tempPath);
        $binary = (string) file_get_contents($tempPath);
        @unlink($tempPath);

        $headers = $rows[0] ?? [];
        $headerIndex = array_flip($headers);
        $this->assertArrayHasKey('content_html', $headerIndex);
        $this->assertArrayHasKey('featured_image_url', $headerIndex);
        $this->assertArrayHasKey('content_image_urls', $headerIndex);
        $this->assertArrayHasKey('content_link_urls', $headerIndex);
        $this->assertArrayHasKey('post_type', $headerIndex);

        $regularExportRow = collect(array_slice($rows, 1))
            ->first(fn (array $row) => ($row[$headerIndex['slug']] ?? null) === $regularPost->slug);

        $this->assertIsArray($regularExportRow);
        $this->assertSame(url('/storage/uploads/blog/featured.jpg'), $regularExportRow[$headerIndex['featured_image_url']]);
        $this->assertStringContainsString(url('/storage/uploads/blog/body-inline.jpg'), $regularExportRow[$headerIndex['content_image_urls']]);
        $this->assertStringContainsString(url('/storage/uploads/blog/gallery-1.jpg'), $regularExportRow[$headerIndex['content_image_urls']]);
        $this->assertStringContainsString('https://cdn.example.com/gallery-2.jpg', $regularExportRow[$headerIndex['content_image_urls']]);
        $this->assertStringContainsString(url('/blog/chinh-sach-demo'), $regularExportRow[$headerIndex['content_link_urls']]);
        $this->assertStringContainsString('<strong>Noi dung</strong>', $regularExportRow[$headerIndex['content_html']]);
        $this->assertSame('regular', $regularExportRow[$headerIndex['post_type']]);

        Post::query()->forceDelete();
        BlogCategory::query()->delete();
        PostSeoKeyword::query()->delete();

        $importFile = UploadedFile::fake()->createWithContent('blog-roundtrip.xlsx', $binary);

        $importResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/import-excel', [
            'file' => $importFile,
        ]);

        $importResponse
            ->assertCreated()
            ->assertJsonPath('created', 2)
            ->assertJsonPath('updated', 0)
            ->assertJsonPath('categories_created', 1);

        $importedRegularPost = Post::where('account_id', $account->id)
            ->where('slug', $regularPost->slug)
            ->firstOrFail();

        $this->assertSame('Mo ta ngan bai thuong', $importedRegularPost->excerpt);
        $this->assertSame(url('/storage/uploads/blog/featured.jpg'), $importedRegularPost->featured_image);
        $this->assertTrue((bool) $importedRegularPost->is_published);
        $this->assertTrue((bool) $importedRegularPost->is_starred);
        $this->assertFalse((bool) $importedRegularPost->is_system);
        $this->assertStringContainsString(url('/storage/uploads/blog/body-inline.jpg'), (string) $importedRegularPost->content);
        $this->assertStringContainsString(url('/blog/chinh-sach-demo'), (string) $importedRegularPost->content);
        $this->assertSame('gom bat trang', $importedRegularPost->seo_keyword);
        $this->assertSame('kien-thuc-gom', $importedRegularPost->category?->slug);

        $importedSystemPost = Post::where('account_id', $account->id)
            ->where('slug', $systemPost->slug)
            ->firstOrFail();

        $this->assertTrue((bool) $importedSystemPost->is_system);
        $this->assertFalse((bool) $importedSystemPost->is_published);
        $this->assertSame('https://cdn.example.com/system-cover.jpg', $importedSystemPost->featured_image);
        $this->assertStringContainsString('https://example.com/guide', (string) $importedSystemPost->content);

        $this->assertDatabaseHas('post_seo_keywords', [
            'account_id' => $account->id,
            'keyword' => 'gom bat trang',
        ]);

        $this->assertDatabaseHas('post_seo_keywords', [
            'account_id' => $account->id,
            'keyword' => 'chinh sach',
        ]);

        $reimportFile = UploadedFile::fake()->createWithContent('blog-roundtrip.xlsx', $binary);

        $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->post('/api/blog/import-excel', [
            'file' => $reimportFile,
        ])->assertCreated()
            ->assertJsonPath('created', 0)
            ->assertJsonPath('updated', 2);
    }
}
