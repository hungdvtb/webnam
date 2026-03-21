<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class BlogSystemPostsTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_auto_creates_and_pins_system_posts_to_the_top(): void
    {
        $account = Account::create([
            'name' => 'Demo Blog',
            'domain' => 'demo.local',
            'subdomain' => 'demo-blog',
            'site_code' => 'DEMO_BLOG',
        ]);

        Post::create([
            'account_id' => $account->id,
            'title' => 'Bài thường',
            'slug' => 'bai-thuong',
            'content' => '<p>Bai thuong</p>',
            'excerpt' => 'Bai thuong',
            'is_published' => true,
            'is_starred' => false,
            'is_system' => false,
            'sort_order' => 99,
            'published_at' => now(),
        ]);

        $response = $this->getJson('/api/blog?site_code=DEMO_BLOG&per_page=20');

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
        $this->assertTrue((bool) $payload[0]['is_system']);
        $this->assertTrue((bool) $payload[4]['is_system']);
        $this->assertFalse((bool) $payload[5]['is_system']);
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
}
