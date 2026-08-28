<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use App\Support\SimpleXlsx;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class QuickReplyApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_quick_reply_can_store_images_search_and_record_usage(): void
    {
        [$account] = $this->authenticate();

        $topicResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-reply-topics', [
                'name' => 'Báo giá',
                'color' => '#22c55e',
            ])
            ->assertCreated();

        $topicId = $topicResponse->json('topic.id');

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies', [
                'topic_id' => $topicId,
                'shortcut' => 'c1',
                'title' => 'Xin kích thước ban thờ',
                'contents' => [
                    [
                        'body' => 'Dạ anh chị cho em xin kích thước ban thờ nhà mình là bao nhiêu vậy ạ?',
                        'images' => [
                            [
                                'url' => '/api/media/assets/0123456789abcdefghijklmnop/large',
                                'thumbnail_url' => '/api/media/assets/0123456789abcdefghijklmnop/thumbnail',
                                'width' => 800,
                                'height' => 600,
                            ],
                        ],
                    ],
                    [
                        'body' => 'Mình đo giúp em chiều dài ban thờ để em báo giá cho mình bộ phù hợp ạ.',
                        'images' => [],
                    ],
                ],
            ])
            ->assertCreated();

        $replyId = $createResponse->json('reply.id');
        $this->assertSame('/c1', $createResponse->json('reply.shortcut'));
        $this->assertSame(2, count($createResponse->json('reply.contents')));
        $this->assertSame(1, count($createResponse->json('reply.images')));

        $listResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies?search=kich%20thuoc')
            ->assertOk();

        $this->assertSame(1, $listResponse->json('total'));
        $this->assertSame($replyId, $listResponse->json('data.0.id'));

        $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/quick-replies/{$replyId}/use")
            ->assertOk()
            ->assertJsonPath('reply.use_count', 1);

        $this->assertDatabaseHas('quick_reply_images', [
            'quick_reply_id' => $replyId,
            'width' => 800,
            'height' => 600,
        ]);
        $this->assertDatabaseHas('quick_reply_contents', [
            'quick_reply_id' => $replyId,
            'position' => 1,
        ]);
    }

    public function test_shortcut_is_unique_inside_each_account_only(): void
    {
        [$firstAccount] = $this->authenticate();
        $secondAccount = $this->createAccount('Quick Reply Second');

        $this
            ->withHeaders($this->headers($firstAccount))
            ->postJson('/api/quick-replies', [
                'shortcut' => '/baogia',
                'body' => 'Báo giá cho khách A.',
            ])
            ->assertCreated();

        $this
            ->withHeaders($this->headers($firstAccount))
            ->postJson('/api/quick-replies', [
                'shortcut' => 'baogia',
                'body' => 'Báo giá trùng.',
            ])
            ->assertUnprocessable();

        $this
            ->withHeaders($this->headers($secondAccount))
            ->postJson('/api/quick-replies', [
                'shortcut' => 'baogia',
                'body' => 'Báo giá ở cửa hàng khác.',
            ])
            ->assertCreated();
    }

    public function test_can_bulk_delete_selected_quick_replies_to_trash_and_restore(): void
    {
        [$account] = $this->authenticate();
        $replyIds = [];

        foreach (['/xoa-1', '/xoa-2', '/giu-lai'] as $shortcut) {
            $response = $this
                ->withHeaders($this->headers($account))
                ->postJson('/api/quick-replies', [
                    'shortcut' => $shortcut,
                    'body' => 'Nội dung ' . $shortcut,
                ])
                ->assertCreated();

            $replyIds[$shortcut] = $response->json('reply.id');
        }

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies/bulk-delete', [
                'ids' => [
                    $replyIds['/xoa-1'],
                    $replyIds['/xoa-2'],
                ],
            ])
            ->assertOk()
            ->assertJsonPath('deleted_count', 2);

        $this->assertSoftDeleted('quick_replies', [
            'id' => $replyIds['/xoa-1'],
            'account_id' => $account->id,
        ]);
        $this->assertSoftDeleted('quick_replies', [
            'id' => $replyIds['/xoa-2'],
            'account_id' => $account->id,
        ]);
        $this->assertDatabaseHas('quick_replies', [
            'id' => $replyIds['/giu-lai'],
            'account_id' => $account->id,
            'deleted_at' => null,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies?status=active')
            ->assertOk()
            ->assertJsonPath('total', 1);

        $trashResponse = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies?status=trashed')
            ->assertOk();

        $this->assertSame(2, $trashResponse->json('total'));
        $this->assertTrue($trashResponse->json('data.0.is_trashed'));

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies/' . $replyIds['/xoa-1'] . '/restore')
            ->assertOk()
            ->assertJsonPath('reply.is_trashed', false);

        $this->assertDatabaseHas('quick_replies', [
            'id' => $replyIds['/xoa-1'],
            'account_id' => $account->id,
            'deleted_at' => null,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies/bulk-restore', [
                'ids' => [
                    $replyIds['/xoa-2'],
                ],
            ])
            ->assertOk()
            ->assertJsonPath('restored_count', 1);

        $this->assertDatabaseHas('quick_replies', [
            'id' => $replyIds['/xoa-2'],
            'account_id' => $account->id,
            'deleted_at' => null,
        ]);
    }

    public function test_can_import_pancake_excel_with_multiple_content_blocks(): void
    {
        [$account] = $this->authenticate();
        $path = tempnam(sys_get_temp_dir(), 'pancake_quick_replies_') . '.xlsx';

        file_put_contents($path, SimpleXlsx::buildWorkbook([
            [
                'name' => 'topics',
                'rows' => [
                    ['name', 'color'],
                    ['ML- KT ban', '#0de1e1'],
                ],
            ],
            [
                'name' => 'quick_replies',
                'rows' => [
                    ['quickReplyIndex', 'topic', 'shortcut', 'message', 'photos', 'folders', 'files'],
                    [77, 'ML- KT ban', 'combo', 'Tin thứ nhất', 'https://content.pancake.vn/a/one.jpg', '', '[]'],
                    [77, 'ML- KT ban', 'combo', 'Tin thứ hai', 'https://content.pancake.vn/a/two.jpg https://content.pancake.vn/a/three.png', '', '[]'],
                ],
            ],
        ]));

        try {
            $file = new UploadedFile(
                $path,
                'pancake.xlsx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                null,
                true
            );

            $this
                ->withHeaders($this->headers($account))
                ->post('/api/quick-replies/import-pancake', [
                    'file' => $file,
                ])
                ->assertOk()
                ->assertJsonPath('summary.created', 1)
                ->assertJsonPath('summary.content_blocks', 2)
                ->assertJsonPath('summary.images', 3);

            $listResponse = $this
                ->withHeaders($this->headers($account))
                ->getJson('/api/quick-replies?search=combo')
                ->assertOk();

            $this->assertSame('/combo', $listResponse->json('data.0.shortcut'));
            $this->assertSame(2, count($listResponse->json('data.0.contents')));
            $this->assertSame(1, count($listResponse->json('data.0.contents.0.images')));
            $this->assertSame(2, count($listResponse->json('data.0.contents.1.images')));
        } finally {
            @unlink($path);
        }
    }

    public function test_pancake_import_restores_trashed_reply_with_same_shortcut(): void
    {
        [$account] = $this->authenticate();

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies', [
                'shortcut' => '/c1',
                'body' => 'Nội dung cũ.',
            ])
            ->assertCreated();

        $replyId = $createResponse->json('reply.id');

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson("/api/quick-replies/{$replyId}")
            ->assertOk();

        $this->assertSoftDeleted('quick_replies', [
            'id' => $replyId,
            'account_id' => $account->id,
        ]);

        $path = tempnam(sys_get_temp_dir(), 'pancake_restore_quick_reply_') . '.xlsx';

        file_put_contents($path, SimpleXlsx::buildWorkbook([
            [
                'name' => 'topics',
                'rows' => [
                    ['name', 'color'],
                    ['Men lam', '#db2777'],
                ],
            ],
            [
                'name' => 'quick_replies',
                'rows' => [
                    ['quickReplyIndex', 'topic', 'shortcut', 'message', 'photos', 'folders', 'files'],
                    [1, 'Men lam', 'c1', 'Nội dung import mới.', 'https://content.pancake.vn/a/new.jpg', '', '[]'],
                ],
            ],
        ]));

        try {
            $file = new UploadedFile(
                $path,
                'pancake.xlsx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                null,
                true
            );

            $this
                ->withHeaders($this->headers($account))
                ->post('/api/quick-replies/import-pancake', [
                    'file' => $file,
                ])
                ->assertOk()
                ->assertJsonPath('summary.created', 0)
                ->assertJsonPath('summary.updated', 1)
                ->assertJsonPath('summary.restored', 1);

            $this->assertDatabaseHas('quick_replies', [
                'id' => $replyId,
                'account_id' => $account->id,
                'shortcut' => '/c1',
                'body' => 'Nội dung import mới.',
                'deleted_at' => null,
            ]);

            $listResponse = $this
                ->withHeaders($this->headers($account))
                ->getJson('/api/quick-replies?search=c1')
                ->assertOk();

            $this->assertSame(1, $listResponse->json('total'));
            $this->assertFalse($listResponse->json('data.0.is_trashed'));
            $this->assertSame(1, count($listResponse->json('data.0.images')));
        } finally {
            @unlink($path);
        }
    }

    public function test_can_manage_gallery_folders_and_upload_multiple_images(): void
    {
        config(['media.disk' => 'public']);
        Storage::fake('public');
        [$account] = $this->authenticate();

        $folderResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/quick-replies/gallery/folders', [
                'name' => 'Men vàng kim',
            ])
            ->assertCreated()
            ->assertJsonPath('folder.name', 'Men vàng kim');

        $folderId = $folderResponse->json('folder.id');

        $uploadResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/quick-replies/gallery/images', [
                'folder_id' => $folderId,
                'images' => [
                    UploadedFile::fake()->createWithContent('am-tra.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')),
                    UploadedFile::fake()->createWithContent('bo-do-tho.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')),
                ],
            ])
            ->assertCreated()
            ->assertJsonPath('created_count', 2);

        $imageIds = collect($uploadResponse->json('images'))->pluck('id')->all();
        $this->assertCount(2, $imageIds);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies/gallery?folder_id=' . $folderId)
            ->assertOk()
            ->assertJsonPath('images.total', 2)
            ->assertJsonPath('folders.0.images_count', 2)
            ->assertJsonPath('stats.images', 2);

        $this
            ->withHeaders($this->headers($account))
            ->putJson('/api/quick-replies/gallery/images/' . $imageIds[0], [
                'is_favorite' => true,
            ])
            ->assertOk()
            ->assertJsonPath('image.is_favorite', true);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies/gallery?folder_id=favorite')
            ->assertOk()
            ->assertJsonPath('images.total', 1)
            ->assertJsonPath('stats.favorite_images', 1);

        $this
            ->withHeaders($this->headers($account))
            ->deleteJson('/api/quick-replies/gallery/images/' . $imageIds[0])
            ->assertOk();

        $this->assertSoftDeleted('quick_reply_gallery_images', [
            'id' => $imageIds[0],
            'account_id' => $account->id,
        ]);

        $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/quick-replies/gallery?folder_id=' . $folderId)
            ->assertOk()
            ->assertJsonPath('images.total', 1)
            ->assertJsonPath('stats.images', 1);
    }

    private function authenticate(): array
    {
        $account = $this->createAccount('Quick Reply Main');
        $user = User::query()->create([
            'name' => 'Quick Reply Admin',
            'email' => 'quick-reply-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$account, $user];
    }

    private function createAccount(string $name): Account
    {
        $suffix = Str::lower(Str::random(6));

        return Account::query()->create([
            'name' => $name,
            'domain' => 'quick-reply-' . $suffix . '.local',
            'subdomain' => 'quick-reply-' . $suffix,
            'status' => true,
        ]);
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
