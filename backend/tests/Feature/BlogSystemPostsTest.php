<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\MediaAsset;
use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class BlogSystemPostsTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_keeps_system_posts_after_regular_posts_in_authenticated_lists(): void
    {
        $account = Account::create([
            'name' => 'Demo Blog',
            'domain' => 'demo.local',
            'subdomain' => 'demo-blog',
            'site_code' => 'DEMO_BLOG',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        Post::create([
            'account_id' => $account->id,
            'title' => 'Bai thuong',
            'slug' => 'bai-thuong',
            'content' => '<p>Bai thuong</p>',
            'excerpt' => 'Bai thuong',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 99,
            'published_at' => now(),
        ]);

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->getJson('/api/blog?per_page=20');

        $response->assertOk();
        $response->assertJsonCount(6, 'data');

        $systemPosts = Post::where('account_id', $account->id)
            ->where('is_system', true)
            ->orderBy('sort_order')
            ->get();

        $this->assertCount(5, $systemPosts);
        $this->assertSame(
            [
                'chinh-sach-bao-hanh',
                'chinh-sach-giao-hang',
                'chinh-sach-kiem-hang',
                'chinh-sach-doi-tra-hang-va-hoan-tien',
                'chinh-sach-bao-mat',
            ],
            $systemPosts->pluck('slug')->all()
        );

        $payload = $response->json('data');
        $this->assertNotEmpty($payload);
        $this->assertFalse((bool) $payload[0]['is_system']);
        $this->assertSame('bai-thuong', $payload[0]['slug']);
        $this->assertTrue((bool) $payload[1]['is_system']);
        $this->assertTrue((bool) $payload[5]['is_system']);
    }

    public function test_it_places_new_regular_posts_at_the_top_without_moving_system_posts_ahead(): void
    {
        $account = Account::create([
            'name' => 'Editorial Store',
            'domain' => 'editorial.local',
            'subdomain' => 'editorial-store',
            'site_code' => 'EDITORIAL_STORE',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $systemPost = Post::create([
            'account_id' => $account->id,
            'title' => 'Chinh sach demo',
            'slug' => 'chinh-sach-demo',
            'content' => '<p>System</p>',
            'excerpt' => 'System',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => true,
            'sort_order' => 1,
            'published_at' => now(),
        ]);

        $olderPost = Post::create([
            'account_id' => $account->id,
            'title' => 'Bai cu',
            'slug' => 'bai-cu',
            'content' => '<p>Older</p>',
            'excerpt' => 'Older',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 1,
            'published_at' => now()->subDay(),
        ]);

        $existingPost = Post::create([
            'account_id' => $account->id,
            'title' => 'Bai dang co',
            'slug' => 'bai-dang-co',
            'content' => '<p>Existing</p>',
            'excerpt' => 'Existing',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 2,
            'published_at' => now()->subHours(12),
        ]);

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->postJson('/api/blog', [
            'title' => 'Bai moi nhat',
            'content' => '<p>Newest</p>',
            'excerpt' => 'Newest',
            'is_published' => true,
        ]);

        $response->assertCreated();

        $createdId = (int) $response->json('id');

        $this->assertDatabaseHas('posts', [
            'id' => $createdId,
            'account_id' => $account->id,
            'is_system' => false,
            'sort_order' => 1,
        ]);

        $this->assertDatabaseHas('posts', [
            'id' => $olderPost->id,
            'sort_order' => 2,
        ]);

        $this->assertDatabaseHas('posts', [
            'id' => $existingPost->id,
            'sort_order' => 3,
        ]);

        $this->assertDatabaseHas('posts', [
            'id' => $systemPost->id,
            'sort_order' => 1,
        ]);

        $listResponse = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->getJson('/api/blog?per_page=20');

        $listResponse->assertOk();
        $payload = $listResponse->json('data');

        $this->assertSame('bai-moi-nhat', $payload[0]['slug']);
        $this->assertFalse((bool) $payload[0]['is_system']);
        $this->assertSame('bai-cu', $payload[1]['slug']);
        $this->assertSame('bai-dang-co', $payload[2]['slug']);
        $this->assertTrue((bool) $payload[array_key_last($payload)]['is_system']);
    }

    public function test_it_blocks_deleting_system_posts(): void
    {
        $account = Account::create([
            'name' => 'Policy Store',
            'domain' => 'policy.local',
            'subdomain' => 'policy-store',
            'site_code' => 'POLICY_STORE',
        ]);

        $this->getJson('/api/blog?site_code=POLICY_STORE&per_page=20')->assertOk();

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $systemPost = Post::where('account_id', $account->id)
            ->where('is_system', true)
            ->firstOrFail();

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->deleteJson("/api/blog/{$systemPost->id}");

        $response
            ->assertStatus(422)
            ->assertJson([
                'error' => 'System posts cannot be deleted.',
            ]);

        $this->assertDatabaseHas('posts', [
            'id' => $systemPost->id,
            'account_id' => $account->id,
            'is_system' => true,
        ]);
    }

    public function test_it_accepts_uploaded_media_asset_urls_without_variant_when_updating_featured_image(): void
    {
        $account = Account::create([
            'name' => 'Blog Media Store',
            'domain' => 'blog-media.local',
            'subdomain' => 'blog-media',
            'site_code' => 'BLOG_MEDIA',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $post = Post::create([
            'account_id' => $account->id,
            'title' => 'Bai can gan anh',
            'slug' => 'bai-can-gan-anh',
            'content' => '<p>Noi dung</p>',
            'excerpt' => 'Noi dung',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 1,
            'published_at' => now(),
        ]);

        $publicId = Str::lower((string) Str::ulid());
        $asset = MediaAsset::create([
            'public_id' => $publicId,
            'disk' => 'r2',
            'collection' => 'blog-featured',
            'original_name' => 'featured.jpg',
            'original_extension' => 'jpg',
            'mime_type' => 'image/jpeg',
            'width' => 1200,
            'height' => 800,
            'size_bytes' => 1024,
            'variants' => [
                'large' => [
                    'width' => 1200,
                    'height' => 800,
                    'formats' => [
                        'source' => [
                            'path' => 'media-assets/' . $publicId . '/large.jpg',
                            'mime' => 'image/jpeg',
                            'extension' => 'jpg',
                            'size_bytes' => 1024,
                        ],
                    ],
                ],
            ],
        ]);

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->putJson('/api/blog/' . $post->id, [
            'featured_image' => '/api/media/assets/' . $publicId,
        ]);

        $response->assertOk();
        $this->assertStringContainsString('/api/media/assets/' . $publicId . '/large', $response->json('featured_image'));
        $this->assertDatabaseHas('posts', [
            'id' => $post->id,
            'featured_media_asset_id' => $asset->id,
        ]);
    }

    public function test_it_keeps_missing_managed_featured_image_urls_instead_of_returning_server_error(): void
    {
        $account = Account::create([
            'name' => 'Missing Media Store',
            'domain' => 'missing-media.local',
            'subdomain' => 'missing-media',
            'site_code' => 'MISSING_MEDIA',
        ]);

        $user = User::factory()->create();
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user);

        $post = Post::create([
            'account_id' => $account->id,
            'title' => 'Bai giu link anh',
            'slug' => 'bai-giu-link-anh',
            'content' => '<p>Noi dung</p>',
            'excerpt' => 'Noi dung',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 1,
            'published_at' => now(),
        ]);

        $missingUrl = '/api/media/assets/' . Str::lower((string) Str::ulid());

        $response = $this->withHeaders([
            'X-Account-Id' => (string) $account->id,
        ])->putJson('/api/blog/' . $post->id, [
            'featured_image' => $missingUrl,
        ]);

        $response->assertOk();
        $this->assertSame($missingUrl, $post->fresh()->getRawOriginal('featured_image'));
        $this->assertDatabaseHas('posts', [
            'id' => $post->id,
            'featured_media_asset_id' => null,
        ]);
    }
}
