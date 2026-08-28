<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\QuickReply;
use App\Models\QuickReplyContent;
use App\Models\QuickReplyImage;
use App\Models\QuickReplyTopic;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class QuickReplyDemoSeeder extends Seeder
{
    private const TOPICS = [
        ['name' => 'Báo giá', 'color' => '#22c55e', 'sort_order' => 1],
        ['name' => 'Tư Vấn', 'color' => '#0ea5e9', 'sort_order' => 2],
        ['name' => 'Men lam', 'color' => '#db2777', 'sort_order' => 3],
        ['name' => 'Men rạn', 'color' => '#8b5cf6', 'sort_order' => 4],
        ['name' => 'Mua hàng', 'color' => '#14b8a6', 'sort_order' => 5],
        ['name' => 'Vận chuyển', 'color' => '#f97316', 'sort_order' => 6],
        ['name' => 'Khiếu nại', 'color' => '#e11d48', 'sort_order' => 7],
        ['name' => 'Chủ đề tắt demo', 'color' => '#64748b', 'sort_order' => 99, 'is_active' => false],
    ];

    private const IMAGES = [
        [
            'url' => '/logo-brand.jpg',
            'thumbnail_url' => '/logo-brand.jpg',
            'medium_url' => '/logo-brand.jpg',
            'large_url' => '/logo-brand.jpg',
            'original_url' => '/logo-brand.jpg',
            'width' => 800,
            'height' => 800,
        ],
        [
            'url' => '/logo-dai-thanh.jpg',
            'thumbnail_url' => '/logo-dai-thanh.jpg',
            'medium_url' => '/logo-dai-thanh.jpg',
            'large_url' => '/logo-dai-thanh.jpg',
            'original_url' => '/logo-dai-thanh.jpg',
            'width' => 800,
            'height' => 800,
        ],
        [
            'url' => '/logo-dai-thanh.png',
            'thumbnail_url' => '/logo-dai-thanh.png',
            'medium_url' => '/logo-dai-thanh.png',
            'large_url' => '/logo-dai-thanh.png',
            'original_url' => '/logo-dai-thanh.png',
            'width' => 800,
            'height' => 800,
        ],
        [
            'url' => '/logo.png',
            'thumbnail_url' => '/logo.png',
            'medium_url' => '/logo.png',
            'large_url' => '/logo.png',
            'original_url' => '/logo.png',
            'width' => 1024,
            'height' => 1024,
        ],
    ];

    private const REPLIES = [
        [
            'topic' => 'Men lam',
            'shortcut' => '/c1',
            'title' => 'Xin kích thước ban thờ',
            'body' => 'Dạ anh chị cho em xin kích thước ban thờ nhà mình là bao nhiêu vậy ạ? Mình đo giúp em chiều dài ban thờ ạ, để em báo giá cho mình bộ phù hợp ạ.',
            'images' => [],
            'sort_order' => 1,
        ],
        [
            'topic' => 'Báo giá',
            'shortcut' => '/c2-banthohayphukien',
            'title' => 'Hỏi nhu cầu đặt mua',
            'body' => 'Dạ anh chị cho em hỏi mình đang đặt mua đồ thờ cho ban thờ mới hay mình đã có sẵn ban thờ và chỉ cần tìm thêm phụ kiện ạ?',
            'images' => [],
            'sort_order' => 2,
        ],
        [
            'topic' => 'Tư Vấn',
            'shortcut' => '/c3',
            'title' => 'Tư vấn size bát hương',
            'body' => 'Dạ kích thước bát hương và phụ kiện to nhỏ phụ thuộc kích thước ban thờ ạ, giá nó cũng khác nhau ạ. Bát hương em có từ size 14-30, anh chị muốn lấy size nào ạ?',
            'images' => [],
            'sort_order' => 3,
        ],
        [
            'topic' => 'Báo giá',
            'shortcut' => '/c4',
            'title' => 'Hỏi mua riêng hay cả bộ',
            'body' => 'Dạ anh chị chỉ cần bát hương hay cả bộ đồ thờ ạ?',
            'images' => [],
            'sort_order' => 4,
        ],
        [
            'topic' => 'Tư Vấn',
            'shortcut' => '/c5',
            'title' => 'Trấn an khách khó tính',
            'body' => 'Nhà em là hàng đẹp nên khách hàng khó tính nhận hàng bên em cũng hài lòng đó ạ.',
            'images' => [0],
            'sort_order' => 5,
        ],
        [
            'topic' => 'Tư Vấn',
            'shortcut' => '/c6',
            'title' => 'Hỏi số lượng bát hương',
            'body' => 'Dạ mình thờ 1 hay 3 bát vậy ạ?',
            'images' => [],
            'sort_order' => 6,
        ],
        [
            'topic' => 'Tư Vấn',
            'shortcut' => '/c7',
            'title' => 'Chốt chất lượng loại 1',
            'body' => 'Dạ nhà em chỉ bán hàng loại 1 thôi ạ, vì ngoài cửa hàng em cũng bán online nhiều nữa.',
            'images' => [],
            'sort_order' => 7,
        ],
        [
            'topic' => 'Men rạn',
            'shortcut' => '/mr01-guitruocbaogiasanpham',
            'title' => 'Giải thích men rạn loại 1',
            'body' => 'Hàng bên em là hàng loại 1, sản xuất thủ công. Trong lòng bát hương sẽ có vân vuốt tay ạ. Còn hàng sản xuất máy thì lòng bát hương sẽ trơn ạ.',
            'images' => [1, 2],
            'sort_order' => 8,
        ],
        [
            'topic' => 'Men rạn',
            'shortcut' => '/mr01-phanbiet',
            'title' => 'Phân biệt hàng kỹ',
            'body' => 'Nhà em là hàng loại 1, làm kỹ, không cong vênh, không đổ nước, không chảy men ạ. Em để hình thực tế để anh chị xem kỹ hơn nhé.',
            'images' => [2, 0],
            'contents' => [
                [
                    'body' => 'Nhà em là hàng loại 1, làm kỹ, không cong vênh, không đổ nước, không chảy men ạ.',
                    'images' => [2],
                ],
                [
                    'body' => 'Em gửi thêm ảnh thực tế để anh chị xem kỹ hơn nhé.',
                    'images' => [0],
                ],
                [
                    'body' => 'Anh chị quan tâm thì cho em xin sđt Zalo, em gửi video cả bộ mình nhìn kỹ hơn ạ.',
                    'images' => [],
                ],
            ],
            'sort_order' => 9,
        ],
        [
            'topic' => 'Vận chuyển',
            'shortcut' => '/ship',
            'title' => 'Tư vấn vận chuyển',
            'body' => 'Dạ bên em đóng hàng chống sốc kỹ, gửi đơn vị vận chuyển quen. Hàng gốm sứ trước khi gửi đều được kiểm tra và chụp ảnh lại cho mình ạ.',
            'images' => [0, 1, 2],
            'contents' => [
                [
                    'body' => 'Dạ bên em đóng hàng chống sốc kỹ, gửi đơn vị vận chuyển quen.',
                    'images' => [0],
                ],
                [
                    'body' => 'Hàng gốm sứ trước khi gửi đều được kiểm tra và chụp ảnh lại cho mình ạ.',
                    'images' => [1, 2],
                ],
            ],
            'sort_order' => 10,
        ],
        [
            'topic' => 'Khiếu nại',
            'shortcut' => '/vo-hang',
            'title' => 'Xử lý hàng vỡ',
            'body' => 'Dạ anh chị chụp giúp em ảnh thùng hàng, tem vận đơn và phần sản phẩm bị vỡ nhé. Em kiểm tra lại với kho và báo hướng xử lý cho mình ngay ạ.',
            'images' => [],
            'sort_order' => 11,
        ],
        [
            'topic' => 'Mua hàng',
            'shortcut' => '/chot-don',
            'title' => 'Xin thông tin chốt đơn',
            'body' => 'Dạ anh chị cho em xin tên, số điện thoại và địa chỉ nhận hàng. Em lên đơn và gửi mình kiểm tra lại trước khi chuyển đi ạ.',
            'images' => [],
            'sort_order' => 12,
        ],
        [
            'topic' => 'Báo giá',
            'shortcut' => '/anh-demo',
            'title' => 'Mẫu chỉ có ảnh',
            'body' => '',
            'images' => [0, 1, 2, 3],
            'sort_order' => 13,
        ],
        [
            'topic' => 'Chủ đề tắt demo',
            'shortcut' => '/mau-tat',
            'title' => 'Mẫu đang tắt để test bộ lọc',
            'body' => 'Mẫu này đang tắt để anh chị test bộ lọc trạng thái Đã tắt/Tất cả.',
            'images' => [3],
            'sort_order' => 99,
            'is_active' => false,
        ],
    ];

    public function run(): void
    {
        $accounts = Account::query()->orderBy('id')->get();

        if ($accounts->isEmpty()) {
            $accounts = collect([
                Account::query()->create([
                    'name' => 'Demo Trả lời nhanh',
                    'domain' => 'quick-reply-demo.local',
                    'subdomain' => 'quick-reply-demo',
                    'status' => true,
                ]),
            ]);
        }

        foreach ($accounts as $account) {
            $this->seedAccount((int) $account->id);
        }
    }

    private function seedAccount(int $accountId): void
    {
        DB::transaction(function () use ($accountId) {
            $topicsByName = [];

            foreach (self::TOPICS as $topicData) {
                $slug = Str::slug($topicData['name']);
                $topic = QuickReplyTopic::query()->updateOrCreate(
                    [
                        'account_id' => $accountId,
                        'slug' => $slug,
                    ],
                    [
                        'name' => $topicData['name'],
                        'color' => $topicData['color'],
                        'sort_order' => $topicData['sort_order'],
                        'is_active' => $topicData['is_active'] ?? true,
                    ]
                );

                $topicsByName[$topicData['name']] = $topic;
            }

            foreach (self::REPLIES as $replyData) {
                $topic = $topicsByName[$replyData['topic']] ?? null;
                $contents = $this->replyContents($replyData);
                $body = $this->joinedBody($contents);
                $imageIndexes = $this->flattenContentImages($contents);
                $tags = $this->replyTags(array_merge($replyData, [
                    'body' => $body,
                    'images' => $imageIndexes,
                ]));
                $reply = QuickReply::query()->updateOrCreate(
                    [
                        'account_id' => $accountId,
                        'shortcut' => $replyData['shortcut'],
                    ],
                    [
                        'topic_id' => $topic?->id,
                        'title' => $replyData['title'],
                        'body' => $body,
                        'tags' => $tags,
                        'search_text' => $this->searchText(
                            $replyData['shortcut'],
                            $replyData['title'],
                            $body,
                            $tags
                        ),
                        'sort_order' => $replyData['sort_order'],
                        'is_active' => $replyData['is_active'] ?? true,
                    ]
                );

                $this->syncContents($reply, $contents);
            }
        });
    }

    private function replyContents(array $replyData): array
    {
        $rawContents = $replyData['contents'] ?? [[
            'body' => $replyData['body'] ?? '',
            'images' => $replyData['images'] ?? [],
        ]];

        return collect($rawContents)
            ->map(fn (array $content) => [
                'body' => trim((string) ($content['body'] ?? '')),
                'images' => array_values($content['images'] ?? []),
            ])
            ->filter(fn (array $content) => $content['body'] !== '' || $content['images'] !== [])
            ->values()
            ->all();
    }

    private function joinedBody(array $contents): string
    {
        return collect($contents)
            ->map(fn (array $content) => trim((string) ($content['body'] ?? '')))
            ->filter()
            ->implode("\n\n");
    }

    private function flattenContentImages(array $contents): array
    {
        return collect($contents)
            ->flatMap(fn (array $content) => $content['images'] ?? [])
            ->values()
            ->all();
    }

    private function syncContents(QuickReply $reply, array $contents): void
    {
        $reply->contents()->delete();
        $reply->images()->delete();

        foreach ($contents as $position => $contentData) {
            $content = QuickReplyContent::query()->create([
                'quick_reply_id' => $reply->id,
                'body' => $contentData['body'] ?? '',
                'position' => $position,
                'is_active' => true,
            ]);

            $this->syncImages($reply, $contentData['images'] ?? [], $content);
        }
    }

    private function syncImages(QuickReply $reply, array $imageIndexes, QuickReplyContent $content): void
    {
        foreach ($imageIndexes as $sortOrder => $imageIndex) {
            $image = self::IMAGES[$imageIndex] ?? null;
            if (!$image) {
                continue;
            }

            QuickReplyImage::query()->create($image + [
                'quick_reply_id' => $reply->id,
                'quick_reply_content_id' => $content->id,
                'sort_order' => $sortOrder,
                'metadata' => [
                    'demo' => true,
                ],
            ]);
        }
    }

    private function replyTags(array $replyData): array
    {
        return array_values(array_filter([
            Str::of($replyData['topic'])->ascii()->lower()->replace(' ', '-')->toString(),
            ltrim($replyData['shortcut'], '/'),
            Str::contains($replyData['body'], 'kích thước') ? 'kich-thuoc' : null,
            !empty($replyData['images']) ? 'co-anh' : null,
        ]));
    }

    private function searchText(string $shortcut, string $title, string $body, array $tags): string
    {
        return Str::of(trim($shortcut . ' ' . $title . ' ' . $body . ' ' . implode(' ', $tags)))
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9\/._-]+/', ' ')
            ->squish()
            ->toString();
    }
}
