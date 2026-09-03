<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\MediaAsset;
use App\Models\QuickReply;
use App\Models\QuickReplyContent;
use App\Models\QuickReplyImage;
use App\Models\QuickReplyTopic;
use App\Services\MediaService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\Process\Process;

class QuickReplyController extends Controller
{
    private const DEFAULT_TOPIC_COLORS = [
        '#22c55e',
        '#0ea5e9',
        '#e11d48',
        '#8b5cf6',
        '#f97316',
        '#14b8a6',
        '#2563eb',
        '#db2777',
    ];

    public function __construct(
        private MediaService $mediaService
    ) {
    }

    public function bootstrap(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json([
                'topics' => [],
                'stats' => $this->emptyStats(),
            ]);
        }

        return response()->json([
            'topics' => $this->topicQuery($accountId)
                ->withCount('replies')
                ->get()
                ->map(fn (QuickReplyTopic $topic) => $this->topicPayload($topic))
                ->values(),
            'stats' => $this->stats($accountId),
        ]);
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json([
                'data' => [],
                'total' => 0,
                'current_page' => 1,
                'last_page' => 1,
                'per_page' => 50,
            ]);
        }

        $query = QuickReply::query()
            ->where('account_id', $accountId)
            ->with(['topic', 'contents.images', 'images']);

        $this->applyFilters($query, $request);

        $query
            ->orderBy('sort_order')
            ->orderBy('shortcut')
            ->orderBy('id');

        $perPage = min(max((int) $request->query('per_page', 50), 1), 100);
        $paginator = $query->paginate($perPage);

        $paginator->setCollection(
            $paginator->getCollection()
                ->map(fn (QuickReply $reply) => $this->replyPayload($reply))
        );

        return response()->json($paginator);
    }

    public function store(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để lưu câu trả lời nhanh.'], 400);
        }

        $request->merge([
            'shortcut' => $this->normalizeShortcut($request->input('shortcut')),
        ]);
        $validated = $this->validateReplyPayload($request, $accountId);
        $contents = $this->normalizeReplyContents(
            array_key_exists('contents', $validated)
                ? ($validated['contents'] ?? [])
                : [[
                    'body' => $validated['body'] ?? '',
                    'images' => $validated['images'] ?? [],
                ]]
        );
        $body = $this->combinedContentBody($contents);
        $images = $this->flattenContentImages($contents);

        $this->ensureReplyHasContent($body, $images);

        $reply = DB::transaction(function () use ($accountId, $validated, $contents, $body) {
            $reply = QuickReply::query()->create([
                'account_id' => $accountId,
                'topic_id' => $validated['topic_id'] ?? null,
                'shortcut' => $validated['shortcut'],
                'title' => $this->normalizeTitle($validated['title'] ?? '', $body, $validated['shortcut']),
                'body' => $body,
                'tags' => $this->normalizeTags($validated['tags'] ?? []),
                'search_text' => $this->buildReplySearchText(
                    $validated['shortcut'],
                    $validated['title'] ?? '',
                    $body,
                    $validated['tags'] ?? []
                ),
                'sort_order' => (int) ($validated['sort_order'] ?? $this->nextReplySortOrder($accountId)),
                'is_active' => $validated['is_active'] ?? true,
            ]);

            $this->syncContents($reply, $contents);

            return $reply;
        });

        return response()->json([
            'message' => 'Đã tạo câu trả lời nhanh.',
            'reply' => $this->replyPayload($reply->load(['topic', 'contents.images', 'images'])),
        ], 201);
    }

    public function update(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để cập nhật câu trả lời nhanh.'], 400);
        }

        $reply = QuickReply::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        if ($request->has('shortcut')) {
            $request->merge([
                'shortcut' => $this->normalizeShortcut($request->input('shortcut')),
            ]);
        }

        $validated = $this->validateReplyPayload($request, $accountId, $reply);
        $hasContentFields = array_key_exists('contents', $validated)
            || array_key_exists('body', $validated)
            || array_key_exists('images', $validated);

        $contents = $hasContentFields
            ? $this->contentsFromValidatedPayload($validated, $reply)
            : $this->existingContentPayloads($reply);
        $body = $this->combinedContentBody($contents);
        $images = $this->flattenContentImages($contents);

        $this->ensureReplyHasContent($body, $images);

        DB::transaction(function () use ($reply, $validated, $contents, $body, $hasContentFields) {
            $shortcut = $validated['shortcut'] ?? $reply->shortcut;
            $title = array_key_exists('title', $validated)
                ? $this->normalizeTitle($validated['title'] ?? '', $body, $shortcut)
                : $reply->title;
            $tags = array_key_exists('tags', $validated) ? $this->normalizeTags($validated['tags'] ?? []) : ($reply->tags ?: []);

            $reply->fill([
                'topic_id' => array_key_exists('topic_id', $validated) ? ($validated['topic_id'] ?? null) : $reply->topic_id,
                'shortcut' => $shortcut,
                'title' => $title,
                'body' => $body,
                'tags' => $tags,
                'search_text' => $this->buildReplySearchText($shortcut, $title ?? '', $body, $tags),
                'sort_order' => array_key_exists('sort_order', $validated) ? (int) $validated['sort_order'] : $reply->sort_order,
                'is_active' => array_key_exists('is_active', $validated) ? (bool) $validated['is_active'] : $reply->is_active,
            ]);
            $reply->save();

            if ($hasContentFields) {
                $this->syncContents($reply, $contents);
            }
        });

        return response()->json([
            'message' => 'Đã cập nhật câu trả lời nhanh.',
            'reply' => $this->replyPayload($reply->refresh()->load(['topic', 'contents.images', 'images'])),
        ]);
    }

    public function destroy(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $reply = QuickReply::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $reply->delete();

        return response()->json(['message' => 'Đã chuyển câu trả lời nhanh vào thùng rác.']);
    }

    public function bulkDestroy(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để xóa câu trả lời nhanh.'], 400);
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['required', 'integer', 'distinct'],
        ], [
            'ids.required' => 'Chọn ít nhất một mẫu cần xóa.',
            'ids.min' => 'Chọn ít nhất một mẫu cần xóa.',
            'ids.max' => 'Mỗi lần chỉ xóa tối đa 500 mẫu.',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        $deletedCount = DB::transaction(function () use ($accountId, $ids) {
            $deleteIds = QuickReply::query()
                ->where('account_id', $accountId)
                ->whereIn('id', $ids)
                ->pluck('id');

            if ($deleteIds->isEmpty()) {
                return 0;
            }

            QuickReply::query()
                ->where('account_id', $accountId)
                ->whereIn('id', $deleteIds)
                ->delete();

            return $deleteIds->count();
        });

        return response()->json([
            'message' => 'Đã chuyển ' . $deletedCount . ' mẫu trả lời nhanh vào thùng rác.',
            'deleted_count' => $deletedCount,
            'requested_count' => count($ids),
        ]);
    }

    public function restore(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $reply = QuickReply::withTrashed()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        if (!$reply->trashed()) {
            return response()->json([
                'message' => 'Mẫu này chưa nằm trong thùng rác.',
                'reply' => $this->replyPayload($reply->load(['topic', 'contents.images', 'images'])),
            ]);
        }

        $reply->restore();

        return response()->json([
            'message' => 'Đã khôi phục câu trả lời nhanh.',
            'reply' => $this->replyPayload($reply->refresh()->load(['topic', 'contents.images', 'images'])),
        ]);
    }

    public function bulkRestore(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để khôi phục câu trả lời nhanh.'], 400);
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['required', 'integer', 'distinct'],
        ], [
            'ids.required' => 'Chọn ít nhất một mẫu cần khôi phục.',
            'ids.min' => 'Chọn ít nhất một mẫu cần khôi phục.',
            'ids.max' => 'Mỗi lần chỉ khôi phục tối đa 500 mẫu.',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        $restoredCount = DB::transaction(function () use ($accountId, $ids) {
            $restoreIds = QuickReply::onlyTrashed()
                ->where('account_id', $accountId)
                ->whereIn('id', $ids)
                ->pluck('id');

            if ($restoreIds->isEmpty()) {
                return 0;
            }

            QuickReply::onlyTrashed()
                ->where('account_id', $accountId)
                ->whereIn('id', $restoreIds)
                ->restore();

            return $restoreIds->count();
        });

        return response()->json([
            'message' => 'Đã khôi phục ' . $restoredCount . ' mẫu trả lời nhanh.',
            'restored_count' => $restoredCount,
            'requested_count' => count($ids),
        ]);
    }

    public function duplicate(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $source = QuickReply::query()
            ->where('account_id', $accountId)
            ->with(['contents.images', 'images'])
            ->findOrFail($id);

        $reply = DB::transaction(function () use ($accountId, $source) {
            $copy = $source->replicate([
                'shortcut',
                'use_count',
                'last_used_at',
            ]);
            $copy->shortcut = $this->nextShortcutCopy($accountId, $source->shortcut);
            $copy->title = trim((string) $source->title) !== '' ? $source->title . ' copy' : null;
            $copy->use_count = 0;
            $copy->last_used_at = null;
            $copy->sort_order = $this->nextReplySortOrder($accountId);
            $copy->save();

            $this->syncContents($copy, $this->existingContentPayloads($source));

            return $copy;
        });

        return response()->json([
            'message' => 'Đã nhân bản câu trả lời nhanh.',
            'reply' => $this->replyPayload($reply->load(['topic', 'contents.images', 'images'])),
        ], 201);
    }

    public function recordUse(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $reply = QuickReply::query()
            ->where('account_id', $accountId)
            ->with(['topic', 'contents.images', 'images'])
            ->findOrFail($id);

        $reply->forceFill([
            'use_count' => ((int) $reply->use_count) + 1,
            'last_used_at' => now(),
        ])->save();

        return response()->json([
            'message' => 'Đã ghi nhận lượt dùng.',
            'reply' => $this->replyPayload($reply->refresh()->load(['topic', 'contents.images', 'images'])),
        ]);
    }

    public function copyImages(Request $request, int $id)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Copy nhiều ảnh một lần chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        $accountId = $this->accountId($request);
        $reply = QuickReply::query()
            ->where('account_id', $accountId)
            ->with(['topic', 'contents.images.mediaAsset', 'images.mediaAsset'])
            ->findOrFail($id);

        if ($reply->images->isEmpty()) {
            return response()->json(['message' => 'Mẫu này chưa có ảnh để copy.'], 422);
        }

        try {
            $this->pruneClipboardTempDirectories();
            $paths = $this->exportReplyImagesForClipboard($reply);
            $this->setWindowsClipboardFileDropList($paths);

            if ($request->boolean('record_use', true)) {
                $reply->forceFill([
                    'use_count' => ((int) $reply->use_count) + 1,
                    'last_used_at' => now(),
                ])->save();
            }

            return response()->json([
                'message' => 'Đã copy ' . count($paths) . ' ảnh vào clipboard. Sang Zalo bấm Ctrl+V để dán cùng lúc.',
                'copied_images' => count($paths),
                'reply' => $this->replyPayload($reply->refresh()->load(['topic', 'contents.images', 'images'])),
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function sendToZalo(Request $request, int $id)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Gửi trực tiếp sang Zalo cá nhân chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        $accountId = $this->accountId($request);
        $reply = QuickReply::query()
            ->where('account_id', $accountId)
            ->with(['topic', 'contents.images.mediaAsset', 'images.mediaAsset'])
            ->findOrFail($id);

        $validated = $request->validate([
            'zalo_target' => ['sometimes', 'nullable', 'in:pc,web'],
            'contents' => ['sometimes', 'array', 'max:10'],
            'contents.*.id' => ['nullable', 'integer'],
            'contents.*.body' => ['nullable', 'string', 'max:60000'],
            'contents.*.images' => ['nullable', 'array', 'max:120'],
            'contents.*.images.*.id' => ['nullable', 'integer'],
            'contents.*.images.*.media_asset_id' => ['nullable', 'integer'],
            'contents.*.images.*.url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.image_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.thumbnail_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.medium_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.large_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.original_url' => ['nullable', 'string', 'max:2048'],
        ]);

        $steps = array_key_exists('contents', $validated)
            ? $this->zaloSendStepsFromPayload($reply, $validated['contents'] ?? [])
            : $this->zaloSendSteps($reply);
        if ($steps === []) {
            return response()->json(['message' => 'Mẫu này chưa có nội dung hoặc ảnh để gửi.'], 422);
        }
        $zaloTarget = $this->zaloTarget($request);

        try {
            $this->pruneClipboardTempDirectories();
            $this->sendReplyToOpenZaloChat($steps, $zaloTarget);

            $reply->forceFill([
                'use_count' => ((int) $reply->use_count) + 1,
                'last_used_at' => now(),
            ])->save();

            return response()->json([
                'message' => 'Đã gửi mẫu sang chat Zalo đang mở.',
                'sent_steps' => count($steps),
                'sent_text' => collect($steps)->filter(fn (array $step) => trim((string) ($step['text'] ?? '')) !== '')->count(),
                'sent_images' => collect($steps)->sum(fn (array $step) => count($step['images'] ?? [])),
                'reply' => $this->replyPayload($reply->refresh()->load(['topic', 'contents.images', 'images'])),
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function splitZaloWindows(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Chia màn hình Zalo chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        try {
            $result = $this->splitQuickRepliesAndZaloWindows($request);

            return response()->json([
                'message' => $request->input('mode') === 'sidebar'
                    ? 'Đã đặt Zalo bên trái, panel trả lời nhanh bên phải.'
                    : 'Đã chia màn hình: phần mềm bên trái, Zalo bên phải.',
                'result' => $result,
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function localWindowBridgeOptions(Request $request)
    {
        return response('', 204)->withHeaders($this->localWindowBridgeCorsHeaders($request));
    }

    public function localWindowBridgeSplitZalo(Request $request)
    {
        $headers = $this->localWindowBridgeCorsHeaders($request);

        if (!$this->isLocalWindowBridgeRequestAllowed($request)) {
            return response()->json([
                'message' => 'Local bridge trả lời nhanh chỉ nhận lệnh từ chính máy đang chạy backend.',
            ], 403)->withHeaders($headers);
        }

        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Local bridge chỉ kéo được Zalo khi backend local đang chạy trên Windows.',
            ], 422)->withHeaders($headers);
        }

        try {
            $result = $this->splitQuickRepliesAndZaloWindows($request);

            return response()->json([
                'message' => $request->input('mode') === 'sidebar'
                    ? 'Đã đặt Zalo bên trái, panel trả lời nhanh bên phải qua local bridge.'
                    : 'Đã chia màn hình qua local bridge.',
                'result' => $result,
            ])->withHeaders($headers);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422)->withHeaders($headers);
        }
    }

    public function zaloMirrorScreenshot(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Zalo live chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        try {
            $this->pruneClipboardTempDirectories();
            $root = storage_path('app/quick-reply-clipboard/zalo-mirror');
            File::ensureDirectoryExists($root);
            $outputPath = $root . DIRECTORY_SEPARATOR . 'zalo-' . now()->format('Ymd-His') . '-' . Str::lower(Str::random(8)) . '.bmp';

            $zaloTarget = $this->zaloTarget($request);
            $this->runZaloMirrorHelper([
                'action' => 'screenshot',
                'output_path' => $outputPath,
                'zalo_target' => $zaloTarget,
                'window_keywords' => $this->zaloWindowKeywords($zaloTarget),
            ]);

            if (!is_file($outputPath)) {
                throw new RuntimeException('Không chụp được màn hình Zalo.');
            }

            return response()->file($outputPath, [
                'Content-Type' => 'image/bmp',
                'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function zaloMirrorClick(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Click Zalo live chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        $validated = $request->validate([
            'x_ratio' => ['required', 'numeric', 'min:0', 'max:1'],
            'y_ratio' => ['required', 'numeric', 'min:0', 'max:1'],
            'double' => ['nullable', 'boolean'],
        ]);

        try {
            $zaloTarget = $this->zaloTarget($request);
            $result = $this->runZaloMirrorHelper([
                'action' => 'click',
                'zalo_target' => $zaloTarget,
                'window_keywords' => $this->zaloWindowKeywords($zaloTarget),
                'x_ratio' => (float) $validated['x_ratio'],
                'y_ratio' => (float) $validated['y_ratio'],
                'double' => (bool) ($validated['double'] ?? false),
            ]);

            return response()->json([
                'message' => 'Đã click vào Zalo live.',
                'result' => $result,
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function zaloMirrorType(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json([
                'message' => 'Gõ vào Zalo live chỉ hỗ trợ khi backend đang chạy trên Windows.',
            ], 422);
        }

        $validated = $request->validate([
            'text' => ['nullable', 'string', 'max:60000'],
            'enter' => ['nullable', 'boolean'],
        ]);
        $text = trim((string) ($validated['text'] ?? ''));
        $enter = (bool) ($validated['enter'] ?? false);

        if ($text === '' && !$enter) {
            return response()->json(['message' => 'Nhập nội dung hoặc chọn gửi Enter.'], 422);
        }

        try {
            $zaloTarget = $this->zaloTarget($request);
            $result = $this->runZaloMirrorHelper([
                'action' => 'type',
                'zalo_target' => $zaloTarget,
                'window_keywords' => $this->zaloWindowKeywords($zaloTarget),
                'text' => $text,
                'enter' => $enter,
            ]);

            return response()->json([
                'message' => $enter ? 'Đã gõ và gửi vào Zalo live.' : 'Đã gõ vào Zalo live.',
                'result' => $result,
            ]);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }
    }

    public function storeTopic(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để lưu chủ đề.'], 400);
        }

        $validated = $this->validateTopicPayload($request);
        $slug = $this->uniqueTopicSlug($accountId, $validated['name']);

        $topic = QuickReplyTopic::query()->create([
            'account_id' => $accountId,
            'name' => trim((string) $validated['name']),
            'slug' => $slug,
            'color' => $this->normalizeColor($validated['color'] ?? null),
            'sort_order' => (int) ($validated['sort_order'] ?? $this->nextTopicSortOrder($accountId)),
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return response()->json([
            'message' => 'Đã tạo chủ đề.',
            'topic' => $this->topicPayload($topic->loadCount('replies')),
        ], 201);
    }

    public function updateTopic(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $topic = QuickReplyTopic::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);
        $validated = $this->validateTopicPayload($request, true);

        $topic->fill([
            'name' => array_key_exists('name', $validated) ? trim((string) $validated['name']) : $topic->name,
            'color' => array_key_exists('color', $validated) ? $this->normalizeColor($validated['color']) : $topic->color,
            'sort_order' => array_key_exists('sort_order', $validated) ? (int) $validated['sort_order'] : $topic->sort_order,
            'is_active' => array_key_exists('is_active', $validated) ? (bool) $validated['is_active'] : $topic->is_active,
        ]);

        if (array_key_exists('name', $validated)) {
            $topic->slug = $this->uniqueTopicSlug($accountId, $validated['name'], $topic->id);
        }

        $topic->save();

        return response()->json([
            'message' => 'Đã cập nhật chủ đề.',
            'topic' => $this->topicPayload($topic->loadCount('replies')),
        ]);
    }

    public function destroyTopic(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $topic = QuickReplyTopic::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $topic->delete();

        return response()->json(['message' => 'Đã xóa chủ đề. Các mẫu cũ vẫn được giữ lại.']);
    }

    public function importPancakeExcel(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để import câu trả lời nhanh.'], 400);
        }

        $validated = $request->validate([
            'file' => ['required', 'file', 'mimes:xlsx', 'max:30720'],
            'mode' => ['nullable', Rule::in(['merge', 'replace'])],
        ], [
            'file.required' => 'Chọn file Excel Pancake cần import.',
            'file.mimes' => 'File import phải là định dạng .xlsx.',
            'mode.in' => 'Chọn đúng chế độ import Pancake.',
        ]);
        $importMode = $validated['mode'] ?? 'merge';

        try {
            $filePath = $request->file('file')->getRealPath();
            $topicRows = $this->readPancakeWorksheetRows($filePath, 'topics');
            $replyRows = $this->readPancakeWorksheetRows($filePath, 'quick_replies');
            $topics = $this->parsePancakeTopicRows($topicRows);
            [$records, $errors] = $this->parsePancakeReplyRows($replyRows);
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => 'Không thể đọc file Excel Pancake. Vui lòng kiểm tra đúng file export từ Pancake.',
                'errors' => [[
                    'row' => 1,
                    'column' => 'File',
                    'message' => $exception->getMessage(),
                ]],
            ], 422);
        }

        if ($records === []) {
            return response()->json([
                'message' => 'File Pancake không có mẫu trả lời nhanh hợp lệ để import.',
                'errors' => $errors ?: [[
                    'row' => 1,
                    'column' => 'quick_replies',
                    'message' => 'Không tìm thấy dòng nào có ký tự tắt và nội dung/ảnh.',
                ]],
            ], 422);
        }

        $summary = DB::transaction(function () use ($accountId, $topics, $records, $importMode) {
            $trashedBeforeImport = 0;

            if ($importMode === 'replace') {
                $trashedBeforeImport = QuickReply::query()
                    ->where('account_id', $accountId)
                    ->count();

                QuickReply::query()
                    ->where('account_id', $accountId)
                    ->delete();
            }

            return array_merge(
                $this->applyPancakeImport($accountId, $topics, $records),
                [
                    'mode' => $importMode,
                    'trashed_before_import' => $trashedBeforeImport,
                ]
            );
        });

        $message = sprintf(
            '%sImport Pancake xong: %d tạo mới, %d cập nhật, %d khôi phục từ thùng rác, %d nội dung, %d ảnh, %d chủ đề.',
            $importMode === 'replace'
                ? sprintf('Đã chuyển %d mẫu cũ vào thùng rác. ', $summary['trashed_before_import'])
                : '',
            $summary['created'],
            $summary['updated'],
            $summary['restored'],
            $summary['content_blocks'],
            $summary['images'],
            $summary['topics_touched']
        );

        return response()->json([
            'message' => $message,
            'summary' => $summary,
            'errors' => $errors,
        ]);
    }

    private function readPancakeWorksheetRows(string $filePath, string $sheetName): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($filePath) !== true) {
            throw new RuntimeException('Không mở được file Excel.');
        }

        try {
            $sheetPath = $this->resolvePancakeWorksheetPath($zip, $sheetName);
            $sheetXml = $zip->getFromName($sheetPath);
            if ($sheetXml === false) {
                throw new RuntimeException('Không đọc được dữ liệu sheet ' . $sheetName . '.');
            }

            $sharedStrings = $this->parsePancakeSharedStrings($zip->getFromName('xl/sharedStrings.xml') ?: null);

            return $this->parsePancakeWorksheetXmlRows($sheetXml, $sharedStrings);
        } finally {
            $zip->close();
        }
    }

    private function resolvePancakeWorksheetPath(\ZipArchive $zip, string $sheetName): string
    {
        $workbookXml = $zip->getFromName('xl/workbook.xml');
        $workbookRelsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
        if ($workbookXml === false || $workbookRelsXml === false) {
            throw new RuntimeException('File Excel thiếu thông tin workbook.');
        }

        $workbook = $this->loadPancakeSpreadsheetXml($workbookXml);
        $relationships = $this->loadPancakeSpreadsheetXml($workbookRelsXml);

        $targetsById = [];
        foreach ($this->spreadsheetXpath($relationships, '//*[local-name()="Relationship"]') as $relationshipNode) {
            $targetsById[(string) $relationshipNode['Id']] = (string) $relationshipNode['Target'];
        }

        $needle = Str::lower(trim($sheetName));
        foreach ($this->spreadsheetXpath($workbook, '//*[local-name()="sheet"]') as $sheetNode) {
            $name = Str::lower(trim((string) ($sheetNode['name'] ?? '')));
            if ($name !== $needle) {
                continue;
            }

            $relationshipId = (string) ($sheetNode->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')->id ?? '');
            $target = $targetsById[$relationshipId] ?? null;
            if (!$target) {
                break;
            }

            $target = ltrim($target, '/');

            return str_starts_with($target, 'xl/')
                ? $target
                : 'xl/' . ltrim($target, '/');
        }

        throw new RuntimeException('Không tìm thấy sheet ' . $sheetName . ' trong file Pancake.');
    }

    private function parsePancakeSharedStrings(?string $xml): array
    {
        if ($xml === null || trim($xml) === '') {
            return [];
        }

        $document = $this->loadPancakeSpreadsheetXml($xml);
        $items = [];

        foreach ($this->spreadsheetXpath($document, '//*[local-name()="si"]') as $item) {
            $parts = [];
            foreach ($this->spreadsheetXpath($item, './/*[local-name()="t"]') as $textNode) {
                $parts[] = (string) $textNode;
            }
            $items[] = implode('', $parts);
        }

        return $items;
    }

    private function parsePancakeWorksheetXmlRows(string $xml, array $sharedStrings): array
    {
        $document = $this->loadPancakeSpreadsheetXml($xml);
        $rows = [];

        foreach ($this->spreadsheetXpath($document, '//*[local-name()="sheetData"]/*[local-name()="row"]') as $rowNode) {
            $cells = [];
            $maxIndex = 0;

            foreach ($this->spreadsheetXpath($rowNode, './*[local-name()="c"]') as $cellNode) {
                $reference = (string) $cellNode['r'];
                $columnName = preg_replace('/\d+/', '', $reference) ?: 'A';
                $columnIndex = $this->spreadsheetColumnIndex($columnName);
                $cells[$columnIndex] = $this->parsePancakeCellValue($cellNode, $sharedStrings);
                $maxIndex = max($maxIndex, $columnIndex);
            }

            $row = [];
            for ($columnIndex = 1; $columnIndex <= $maxIndex; $columnIndex++) {
                $row[] = $cells[$columnIndex] ?? '';
            }
            $rows[] = $row;
        }

        return $rows;
    }

    private function parsePancakeCellValue(\SimpleXMLElement $cellNode, array $sharedStrings): string
    {
        $type = (string) $cellNode['t'];

        if ($type === 'inlineStr') {
            $parts = [];
            foreach ($this->spreadsheetXpath($cellNode, './/*[local-name()="t"]') as $textNode) {
                $parts[] = (string) $textNode;
            }

            return implode('', $parts);
        }

        $valueNodes = $this->spreadsheetXpath($cellNode, './*[local-name()="v"]');
        $value = isset($valueNodes[0]) ? (string) $valueNodes[0] : '';

        if ($type === 's') {
            $index = is_numeric($value) ? (int) $value : -1;

            return $sharedStrings[$index] ?? '';
        }

        if ($type === 'b') {
            return $value === '1' ? '1' : '0';
        }

        return $value;
    }

    private function loadPancakeSpreadsheetXml(string $xml): \SimpleXMLElement
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $document = simplexml_load_string($xml);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        if (!$document instanceof \SimpleXMLElement) {
            throw new RuntimeException('Không đọc được XML trong file Excel.');
        }

        return $document;
    }

    private function spreadsheetXpath(\SimpleXMLElement $element, string $expression): array
    {
        return $element->xpath($expression) ?: [];
    }

    private function spreadsheetColumnIndex(string $name): int
    {
        $index = 0;
        foreach (str_split(Str::upper($name)) as $character) {
            if ($character < 'A' || $character > 'Z') {
                continue;
            }
            $index = ($index * 26) + (ord($character) - 64);
        }

        return max($index, 1);
    }

    private function parsePancakeTopicRows(array $rows): array
    {
        if (count($rows) < 2) {
            return [];
        }

        $headers = $this->spreadsheetHeaderMap($rows[0] ?? []);
        $nameIndex = $headers['name'] ?? 0;
        $colorIndex = $headers['color'] ?? 1;
        $topics = [];

        foreach (array_slice($rows, 1) as $row) {
            $name = $this->spreadsheetCell($row, $nameIndex);
            if ($name === '') {
                continue;
            }

            $topics[$this->pancakeLookupKey($name)] = [
                'name' => $name,
                'color' => $this->spreadsheetCell($row, $colorIndex),
            ];
        }

        return $topics;
    }

    private function parsePancakeReplyRows(array $rows): array
    {
        if (count($rows) < 2) {
            throw new RuntimeException('Sheet quick_replies không có dữ liệu.');
        }

        $headers = $this->spreadsheetHeaderMap($rows[0] ?? []);
        foreach (['shortcut', 'message', 'topic'] as $requiredHeader) {
            if (!array_key_exists($requiredHeader, $headers)) {
                throw new RuntimeException('Sheet quick_replies thiếu cột ' . $requiredHeader . '.');
            }
        }

        $indexColumn = $headers['quickreplyindex'] ?? null;
        $topicColumn = $headers['topic'];
        $shortcutColumn = $headers['shortcut'];
        $messageColumn = $headers['message'];
        $photosColumn = $headers['photos'] ?? null;
        $records = [];
        $errors = [];

        foreach (array_slice($rows, 1) as $offset => $row) {
            $rowNumber = $offset + 2;
            $shortcut = $this->normalizeShortcut($this->spreadsheetCell($row, $shortcutColumn));
            $message = trim((string) $this->spreadsheetCell($row, $messageColumn));
            $photos = $photosColumn !== null ? $this->spreadsheetCell($row, $photosColumn) : '';
            $images = $this->pancakeImagePayloads($photos);

            if ($shortcut === '') {
                if ($message !== '' || $images !== []) {
                    $errors[] = $this->pancakeImportError($rowNumber, 'shortcut', 'Dòng này có nội dung/ảnh nhưng thiếu ký tự tắt.');
                }
                continue;
            }

            if ($message === '' && $images === []) {
                continue;
            }

            if (!isset($records[$shortcut])) {
                $records[$shortcut] = [
                    'pancake_index' => $indexColumn !== null ? $this->spreadsheetCell($row, $indexColumn) : null,
                    'topic' => $this->spreadsheetCell($row, $topicColumn),
                    'shortcut' => $shortcut,
                    'contents' => [],
                    'first_row' => $rowNumber,
                ];
            }

            if ($records[$shortcut]['topic'] === '') {
                $records[$shortcut]['topic'] = $this->spreadsheetCell($row, $topicColumn);
            }

            if (count($records[$shortcut]['contents']) >= 10) {
                $errors[] = $this->pancakeImportError($rowNumber, 'message', 'Mẫu này vượt quá 10 nội dung nên dòng này bị bỏ qua.');
                continue;
            }

            $records[$shortcut]['contents'][] = [
                'body' => $message,
                'images' => $images,
            ];
        }

        return [array_values($records), $errors];
    }

    private function applyPancakeImport(int $accountId, array $topics, array $records): array
    {
        $topicModels = $this->upsertPancakeTopics($accountId, $topics, $records);
        $created = 0;
        $updated = 0;
        $restored = 0;
        $contentBlocks = 0;
        $imageCount = 0;
        $nextSortOrder = $this->nextReplySortOrder($accountId);

        foreach ($records as $record) {
            $contents = $this->normalizeReplyContents($record['contents']);
            if ($contents === []) {
                continue;
            }

            $shortcut = $record['shortcut'];
            $topicName = trim((string) ($record['topic'] ?? ''));
            $topic = $topicName !== '' ? ($topicModels[$this->pancakeLookupKey($topicName)] ?? null) : null;
            $body = $this->combinedContentBody($contents);
            $images = $this->flattenContentImages($contents);
            $existing = QuickReply::withTrashed()
                ->where('account_id', $accountId)
                ->where('shortcut', $shortcut)
                ->first();
            $wasTrashed = $existing?->trashed() ?? false;
            $reply = $existing ?: new QuickReply([
                'account_id' => $accountId,
                'shortcut' => $shortcut,
                'sort_order' => $nextSortOrder++,
                'use_count' => 0,
            ]);
            $title = $existing && trim((string) $existing->title) !== ''
                ? $existing->title
                : $this->normalizeTitle('', $body, $shortcut);
            $tags = $this->pancakeImportTags($topicName, $shortcut, $contents);

            if ($wasTrashed) {
                $reply->restore();
                $restored++;
            }

            $reply->fill([
                'account_id' => $accountId,
                'topic_id' => $topic?->id,
                'shortcut' => $shortcut,
                'title' => $title,
                'body' => $body,
                'tags' => $tags,
                'search_text' => $this->buildReplySearchText($shortcut, $title, $body, $tags),
                'is_active' => $existing ? (bool) $existing->is_active : true,
            ]);
            $reply->save();

            $this->syncContents($reply, $contents);

            $existing ? $updated++ : $created++;
            $contentBlocks += count($contents);
            $imageCount += count($images);
        }

        return [
            'created' => $created,
            'updated' => $updated,
            'restored' => $restored,
            'content_blocks' => $contentBlocks,
            'images' => $imageCount,
            'topics_touched' => count($topicModels),
        ];
    }

    private function upsertPancakeTopics(int $accountId, array $topics, array $records): array
    {
        foreach ($records as $record) {
            $topicName = trim((string) ($record['topic'] ?? ''));
            $key = $this->pancakeLookupKey($topicName);
            if ($key !== '' && !isset($topics[$key])) {
                $topics[$key] = [
                    'name' => $topicName,
                    'color' => null,
                ];
            }
        }

        $existingTopics = QuickReplyTopic::query()
            ->where('account_id', $accountId)
            ->get()
            ->keyBy(fn (QuickReplyTopic $topic) => $this->pancakeLookupKey($topic->name));
        $topicModels = [];

        foreach ($topics as $key => $topicData) {
            $name = trim((string) ($topicData['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $topic = $existingTopics->get($key);
            if ($topic) {
                if (trim((string) ($topicData['color'] ?? '')) !== '') {
                    $topic->color = $this->normalizeColor($topicData['color']);
                    $topic->save();
                }
            } else {
                $topic = QuickReplyTopic::query()->create([
                    'account_id' => $accountId,
                    'name' => $name,
                    'slug' => $this->uniqueTopicSlug($accountId, $name),
                    'color' => $this->normalizeColor($topicData['color'] ?? null),
                    'sort_order' => $this->nextTopicSortOrder($accountId),
                    'is_active' => true,
                ]);
            }

            $topicModels[$key] = $topic;
        }

        return $topicModels;
    }

    private function pancakeImagePayloads(string $value): array
    {
        return collect($this->pancakeImageUrls($value))
            ->map(fn (string $url) => [
                'url' => $url,
                'image_url' => $url,
                'thumbnail_url' => $url,
                'medium_url' => $url,
                'large_url' => $url,
                'original_url' => $url,
            ])
            ->values()
            ->all();
    }

    private function pancakeImageUrls(string $value): array
    {
        $value = trim($value);
        if ($value === '') {
            return [];
        }

        $urls = [];
        $decoded = json_decode($value, true);
        if (is_array($decoded)) {
            $urls = array_merge($urls, $this->extractPancakeUrls($decoded));
        }

        if (preg_match_all('/https?:\/\/[^\s"\'\]\)>;,]+/u', $value, $matches)) {
            $urls = array_merge($urls, $matches[0]);
        }

        return collect($urls)
            ->map(fn ($url) => rtrim(trim((string) $url), '.'))
            ->filter(fn ($url) => filter_var($url, FILTER_VALIDATE_URL))
            ->unique()
            ->values()
            ->all();
    }

    private function extractPancakeUrls(array $value): array
    {
        $urls = [];

        foreach ($value as $key => $item) {
            if (is_string($item) && in_array($key, ['url', 'image_url', 'thumbnail_url', 'medium_url', 'large_url', 'original_url'], true)) {
                $urls[] = $item;
                continue;
            }

            if (is_array($item)) {
                $urls = array_merge($urls, $this->extractPancakeUrls($item));
            } elseif (is_string($item) && str_starts_with($item, 'http')) {
                $urls = array_merge($urls, $this->pancakeImageUrls($item));
            }
        }

        return $urls;
    }

    private function pancakeImportTags(string $topicName, string $shortcut, array $contents): array
    {
        $hasImages = collect($contents)->contains(fn (array $content) => !empty($content['images']));

        return array_values(array_filter([
            'pancake',
            $topicName !== '' ? $this->normalizeSearchText($topicName) : null,
            ltrim($shortcut, '/'),
            $hasImages ? 'co-anh' : null,
            count($contents) > 1 ? 'nhieu-noi-dung' : null,
        ]));
    }

    private function spreadsheetHeaderMap(array $row): array
    {
        $headers = [];
        foreach ($row as $index => $value) {
            $key = Str::of((string) $value)
                ->ascii()
                ->lower()
                ->replaceMatches('/[^a-z0-9]+/', '')
                ->toString();

            if ($key !== '') {
                $headers[$key] = $index;
            }
        }

        return $headers;
    }

    private function spreadsheetCell(array $row, ?int $index): string
    {
        if ($index === null) {
            return '';
        }

        return trim((string) ($row[$index] ?? ''));
    }

    private function pancakeLookupKey(string $value): string
    {
        return $this->normalizeSearchText($value);
    }

    private function pancakeImportError(int $row, string $column, string $message): array
    {
        return [
            'row' => $row,
            'column' => $column,
            'message' => $message,
        ];
    }

    /**
     * @return array<int, string>
     */
    private function exportReplyImagesForClipboard(QuickReply $reply, $images = null): array
    {
        $directory = storage_path(
            'app/quick-reply-clipboard/'
            . now()->format('Ymd-His')
            . '-reply-' . $reply->id
            . '-' . Str::lower(Str::random(6))
        );
        File::ensureDirectoryExists($directory);

        $paths = [];
        $imageItems = collect($images ?? $reply->images)->values();
        foreach ($imageItems as $index => $image) {
            [$contents, $extension, $mimeType] = $this->clipboardImageBinary($image);
            $extension = $this->clipboardImageExtension($extension, $mimeType);
            $path = $directory . DIRECTORY_SEPARATOR . $this->clipboardImageFileName($reply, $index, $extension);

            File::put($path, $contents);

            if (!is_file($path) || filesize($path) <= 0) {
                throw new RuntimeException('Không tạo được file ảnh tạm để copy.');
            }

            $paths[] = $path;
        }

        return $paths;
    }

    private function zaloSendSteps(QuickReply $reply): array
    {
        $reply->loadMissing(['contents.images.mediaAsset', 'images.mediaAsset']);
        $steps = [];

        if ($reply->contents->isNotEmpty()) {
            foreach ($reply->contents as $content) {
                $body = trim((string) $content->body);
                $images = $content->images;

                if ($body === '' && $images->isEmpty()) {
                    continue;
                }

                $steps[] = [
                    'text' => $body,
                    'images' => $images->isNotEmpty()
                        ? $this->exportReplyImagesForClipboard($reply, $images)
                        : [],
                ];
            }

            return $steps;
        }

        $body = trim((string) $reply->body);
        if ($body !== '' || $reply->images->isNotEmpty()) {
            $steps[] = [
                'text' => $body,
                'images' => $reply->images->isNotEmpty()
                    ? $this->exportReplyImagesForClipboard($reply)
                    : [],
            ];
        }

        return $steps;
    }

    private function zaloSendStepsFromPayload(QuickReply $reply, array $contents): array
    {
        $reply->loadMissing(['contents.images.mediaAsset', 'images.mediaAsset']);

        $availableImages = collect($reply->images);
        foreach ($reply->contents as $content) {
            $availableImages = $availableImages->merge($content->images);
        }

        $availableImages = $availableImages
            ->filter(fn ($image) => $image instanceof QuickReplyImage)
            ->unique(fn (QuickReplyImage $image) => (int) $image->id)
            ->values();

        $imagesById = $availableImages->keyBy(fn (QuickReplyImage $image) => (string) $image->id);
        $imagesByUrl = [];
        foreach ($availableImages as $image) {
            foreach ([$image->url, $image->thumbnail_url, $image->medium_url, $image->large_url, $image->original_url] as $url) {
                $url = trim((string) $url);
                if ($url !== '') {
                    $imagesByUrl[$url] = $image;
                }
            }
        }

        $steps = [];
        foreach (array_values($contents) as $content) {
            $body = trim((string) ($content['body'] ?? $content['content'] ?? ''));
            $imageModels = [];
            $usedImageIds = [];

            foreach (array_values($content['images'] ?? []) as $imageData) {
                if (!is_array($imageData)) {
                    continue;
                }

                $image = null;
                $imageId = $imageData['id'] ?? null;
                if (is_numeric($imageId)) {
                    $image = $imagesById->get((string) ((int) $imageId));
                }

                if (!$image) {
                    foreach ([$imageData['url'] ?? null, $imageData['image_url'] ?? null, $imageData['thumbnail_url'] ?? null, $imageData['medium_url'] ?? null, $imageData['large_url'] ?? null, $imageData['original_url'] ?? null] as $url) {
                        $url = trim((string) $url);
                        if ($url !== '' && isset($imagesByUrl[$url])) {
                            $image = $imagesByUrl[$url];
                            break;
                        }
                    }
                }

                if (!$image) {
                    continue;
                }

                $key = (int) $image->id;
                if (isset($usedImageIds[$key])) {
                    continue;
                }

                $usedImageIds[$key] = true;
                $imageModels[] = $image;
            }

            if ($body === '' && $imageModels === []) {
                continue;
            }

            $steps[] = [
                'text' => $body,
                'images' => $imageModels !== []
                    ? $this->exportReplyImagesForClipboard($reply, $imageModels)
                    : [],
            ];
        }

        return $steps;
    }
    private function clipboardImageBinary(QuickReplyImage $image): array
    {
        $asset = $image->relationLoaded('mediaAsset') ? $image->mediaAsset : null;
        if (!$asset && $image->media_asset_id) {
            $asset = MediaAsset::query()->find($image->media_asset_id);
        }

        if (!$asset) {
            foreach ([$image->large_url, $image->original_url, $image->url] as $url) {
                $publicId = $this->mediaService->extractPublicIdFromUrl($url);
                if ($publicId) {
                    $asset = MediaAsset::query()->where('public_id', $publicId)->first();
                    if ($asset) {
                        break;
                    }
                }
            }
        }

        if ($asset) {
            return $this->mediaAssetBinary($asset);
        }

        return $this->urlImageBinary($image->large_url ?: $image->original_url ?: $image->url);
    }

    private function mediaAssetBinary(MediaAsset $asset): array
    {
        $descriptor = $this->mediaService->resolveVariantDescriptor($asset, 'large', true)
            ?? $this->mediaService->resolveVariantDescriptor($asset, 'original', true);

        if ($descriptor === null) {
            throw new RuntimeException('Không tìm thấy dữ liệu ảnh để copy.');
        }

        $path = ltrim((string) ($descriptor['path'] ?? ''), '/');
        if ($path === '') {
            throw new RuntimeException('Ảnh đang thiếu đường dẫn file.');
        }

        $disk = Storage::disk($asset->disk ?: config('media.disk', 'r2'));
        $contents = $disk->get($path);
        if (!is_string($contents) || $contents === '') {
            throw new RuntimeException('Không đọc được file ảnh để copy.');
        }

        return [
            $contents,
            $descriptor['extension'] ?? $asset->original_extension,
            $descriptor['mime'] ?? $asset->mime_type,
        ];
    }

    private function urlImageBinary(?string $url): array
    {
        $url = trim((string) $url);
        if ($url === '') {
            throw new RuntimeException('Ảnh này chưa có URL hợp lệ.');
        }

        if (preg_match('#^data:(image/[^;]+);base64,(.+)$#i', $url, $matches) === 1) {
            $contents = base64_decode((string) $matches[2], true);
            if (!is_string($contents) || $contents === '') {
                throw new RuntimeException('Không đọc được dữ liệu ảnh base64.');
            }

            return [$contents, null, $matches[1]];
        }

        $localPath = $this->localImagePathFromUrl($url);
        if ($localPath) {
            $contents = File::get($localPath);
            if (!is_string($contents) || $contents === '') {
                throw new RuntimeException('Không đọc được file ảnh local.');
            }

            return [
                $contents,
                pathinfo($localPath, PATHINFO_EXTENSION),
                @mime_content_type($localPath) ?: null,
            ];
        }

        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            throw new RuntimeException('Không tìm thấy file ảnh local để copy.');
        }

        $response = Http::connectTimeout((float) config('media.http.connect_timeout', 5))
            ->timeout((float) config('media.http.timeout', 15))
            ->withOptions([
                'verify' => config('media.http.verify', true),
            ])
            ->withHeaders(['Accept' => 'image/*,*/*;q=0.8'])
            ->get($url);

        if (!$response->successful() || $response->body() === '') {
            throw new RuntimeException('Không tải được ảnh để copy.');
        }

        $path = parse_url($url, PHP_URL_PATH) ?: '';

        return [
            $response->body(),
            pathinfo((string) $path, PATHINFO_EXTENSION),
            $response->header('Content-Type'),
        ];
    }

    private function localImagePathFromUrl(string $url): ?string
    {
        $path = parse_url($url, PHP_URL_PATH) ?: $url;
        $relativePath = ltrim(str_replace('\\', '/', (string) $path), '/');
        if ($relativePath === '' || str_contains($relativePath, '..')) {
            return null;
        }

        $candidates = [
            public_path($relativePath),
        ];

        if (str_starts_with($relativePath, 'storage/')) {
            $candidates[] = storage_path('app/public/' . substr($relativePath, strlen('storage/')));
        }

        foreach ($candidates as $candidate) {
            $resolved = realpath($candidate);
            if (!$resolved || !is_file($resolved)) {
                continue;
            }

            if ($this->isInsideDirectory($resolved, public_path()) || $this->isInsideDirectory($resolved, storage_path('app/public'))) {
                return $resolved;
            }
        }

        return null;
    }

    private function isInsideDirectory(string $path, string $directory): bool
    {
        $resolvedDirectory = realpath($directory);
        if (!$resolvedDirectory) {
            return false;
        }

        $normalizedPath = rtrim(str_replace('\\', '/', realpath($path) ?: $path), '/') . '/';
        $normalizedDirectory = rtrim(str_replace('\\', '/', $resolvedDirectory), '/') . '/';

        return str_starts_with($normalizedPath, $normalizedDirectory);
    }

    private function clipboardImageExtension(?string $extension, ?string $mimeType): string
    {
        $extension = Str::lower(trim((string) $extension, ". \t\n\r\0\x0B"));

        if (in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'], true)) {
            return $extension === 'jpeg' ? 'jpg' : $extension;
        }

        return match (Str::lower(trim((string) $mimeType))) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/bmp', 'image/x-ms-bmp' => 'bmp',
            default => 'jpg',
        };
    }

    private function clipboardImageFileName(QuickReply $reply, int $index, string $extension): string
    {
        $base = Str::slug(trim($reply->shortcut . ' ' . ($reply->title ?: 'anh')));
        if ($base === '') {
            $base = 'quick-reply-image';
        }

        return sprintf('%02d-%s.%s', $index + 1, Str::limit($base, 70, ''), $extension);
    }

    private function sendReplyToOpenZaloChat(array $steps, string $zaloTarget = 'pc'): void
    {
        $steps = collect($steps)
            ->map(function (array $step) {
                return [
                    'text' => trim((string) ($step['text'] ?? '')),
                    'images' => array_values(array_filter($step['images'] ?? [], fn (string $path) => is_file($path))),
                ];
            })
            ->filter(fn (array $step) => $step['text'] !== '' || $step['images'] !== [])
            ->values()
            ->all();

        if ($steps === []) {
            throw new RuntimeException('Không có nội dung hoặc ảnh để gửi sang Zalo.');
        }

        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'send_quick_reply_to_zalo.py';
        $payloadPath = $root . DIRECTORY_SEPARATOR . 'zalo-payload-' . Str::lower(Str::random(12)) . '.json';
        $textPasteDelayMs = (int) env('QUICK_REPLY_ZALO_TEXT_PASTE_DELAY_MS', $zaloTarget === 'web' ? 700 : 250);
        $imagePasteDelayMs = (int) env('QUICK_REPLY_ZALO_IMAGE_PASTE_DELAY_MS', $zaloTarget === 'web' ? 2400 : 1600);
        $betweenStepsDelayMs = (int) env('QUICK_REPLY_ZALO_BETWEEN_STEPS_DELAY_MS', $zaloTarget === 'web' ? 750 : 450);
        $payload = [
            'steps' => $steps,
            'zalo_target' => $zaloTarget,
            'window_keywords' => $this->zaloWindowKeywords($zaloTarget),
            'text_paste_delay_ms' => $textPasteDelayMs,
            'after_text_send_delay_ms' => (int) env('QUICK_REPLY_ZALO_AFTER_TEXT_DELAY_MS', 700),
            'image_paste_delay_ms' => $imagePasteDelayMs,
            'between_steps_delay_ms' => $betweenStepsDelayMs,
        ];

        File::put($scriptPath, $this->zaloAutomationPythonScript());
        File::put($payloadPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $process = new Process([
            $this->clipboardPythonExecutable(),
            $scriptPath,
            $payloadPath,
        ]);
        $process->setEnv(['PYTHONIOENCODING' => 'utf-8']);
        $process->setTimeout((float) env('QUICK_REPLY_ZALO_SEND_TIMEOUT', 90));
        $process->run();
        File::delete($payloadPath);

        if (!$process->isSuccessful()) {
            $output = trim($process->getErrorOutput() ?: $process->getOutput());
            throw new RuntimeException($output !== ''
                ? 'Không gửi được sang Zalo: ' . $output
                : 'Không gửi được sang Zalo. Hãy mở đúng cửa sổ chat Zalo rồi thử lại.');
        }
    }

    private function splitQuickRepliesAndZaloWindows(Request $request): array
    {
        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'split_quick_replies_zalo.py';
        $payloadPath = $root . DIRECTORY_SEPARATOR . 'split-zalo-payload-' . Str::lower(Str::random(12)) . '.json';
        $mode = $request->input('mode') === 'sidebar' ? 'sidebar' : 'split';
        $browserRatio = (float) $request->input('browser_ratio', env('QUICK_REPLY_SPLIT_BROWSER_RATIO', 0.58));
        $zaloTarget = $this->zaloTarget($request);
        $payload = [
            'zalo_target' => $zaloTarget,
            'zalo_window_keywords' => $this->zaloWindowKeywords($zaloTarget),
            'browser_window_keywords' => $this->requestWindowKeywords($request->input('browser_window_keywords'), $this->browserWindowKeywords()),
            'mode' => $mode,
            'browser_ratio' => min(max($browserRatio, 0.35), 0.72),
            'sidebar_width' => min(max((int) $request->input('sidebar_width', env('QUICK_REPLY_SIDEBAR_WIDTH', 360)), 300), 520),
            'strict_browser_keywords' => $mode === 'sidebar',
            'sidebar_url' => $this->safeQuickReplySidebarUrl($request->input('sidebar_url')),
            'require_browser' => $request->boolean('require_browser', $mode !== 'sidebar'),
            'manage_browser' => $request->boolean('manage_browser', $mode !== 'sidebar'),
            'gap' => min(max((int) $request->input('gap', env('QUICK_REPLY_SPLIT_GAP', 12)), 0), 48),
            'margin' => min(max((int) $request->input('margin', env('QUICK_REPLY_SPLIT_MARGIN', 0)), 0), 80),
        ];

        File::put($scriptPath, $this->splitZaloPythonScript());
        File::put($payloadPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $process = new Process([
            $this->clipboardPythonExecutable(),
            $scriptPath,
            $payloadPath,
        ]);
        $process->setEnv(['PYTHONIOENCODING' => 'utf-8']);
        $process->setTimeout((float) env('QUICK_REPLY_SPLIT_TIMEOUT', 20));
        $process->run();
        File::delete($payloadPath);

        if (!$process->isSuccessful()) {
            $output = trim($process->getErrorOutput() ?: $process->getOutput());
            throw new RuntimeException($output !== ''
                ? 'Không chia được màn hình Zalo: ' . $output
                : 'Không chia được màn hình Zalo. Hãy mở Zalo Desktop rồi thử lại.');
        }

        $decoded = json_decode(trim($process->getOutput()), true);

        return is_array($decoded) ? $decoded : [];
    }

    private function runZaloMirrorHelper(array $payload): array
    {
        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'zalo_mirror_helper.py';
        $payloadPath = $root . DIRECTORY_SEPARATOR . 'zalo-mirror-payload-' . Str::lower(Str::random(12)) . '.json';
        File::put($scriptPath, $this->zaloMirrorPythonScript());
        File::put($payloadPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $process = new Process([
            $this->clipboardPythonExecutable(),
            $scriptPath,
            $payloadPath,
        ]);
        $process->setEnv(['PYTHONIOENCODING' => 'utf-8']);
        $process->setTimeout((float) env('QUICK_REPLY_ZALO_MIRROR_TIMEOUT', 20));
        $process->run();
        File::delete($payloadPath);

        $rawOutput = trim($process->getOutput());
        if (!$process->isSuccessful()) {
            $output = trim($process->getErrorOutput() ?: $rawOutput);
            throw new RuntimeException($output !== ''
                ? 'Zalo live lỗi: ' . $output
                : 'Zalo live lỗi. Hãy mở Zalo Desktop rồi thử lại.');
        }

        $decoded = json_decode($rawOutput, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function zaloWindowKeywords(string $target = 'pc'): array
    {
        $target = $this->normalizeZaloTarget($target);
        $raw = $target === 'web'
            ? trim((string) env('QUICK_REPLY_ZALO_WEB_WINDOW_KEYWORDS', 'Zalo -,Zalo - Google Chrome,My Z.com - Google Chrome,chat.zalo.me - Google Chrome,web.zalo.me - Google Chrome'))
            : trim((string) env('QUICK_REPLY_ZALO_WINDOW_KEYWORDS', 'Zalo'));
        $keywords = preg_split('/[,;|]+/', $raw) ?: [];

        return collect($keywords)
            ->map(fn ($keyword) => trim((string) $keyword))
            ->filter()
            ->values()
            ->all() ?: ($target === 'web' ? ['Zalo - Google Chrome', 'My Z.com - Google Chrome'] : ['Zalo']);
    }

    private function zaloTarget(Request $request): string
    {
        return $this->normalizeZaloTarget($request->input('zalo_target', $request->input('target', 'pc')));
    }

    private function normalizeZaloTarget($target): string
    {
        $normalized = Str::lower(trim((string) $target));

        return in_array($normalized, ['web', 'chrome', 'zalo_web', 'zalo-web'], true) ? 'web' : 'pc';
    }

    private function browserWindowKeywords(): array
    {
        $raw = trim((string) env('QUICK_REPLY_BROWSER_WINDOW_KEYWORDS', 'Trả lời nhanh,GÔM ĐẠI THÀNH,localhost'));
        $keywords = preg_split('/[,;|]+/', $raw) ?: [];

        return collect($keywords)
            ->map(fn ($keyword) => trim((string) $keyword))
            ->filter()
            ->values()
            ->all() ?: ['Trả lời nhanh', 'GÔM ĐẠI THÀNH', 'localhost'];
    }

    private function requestWindowKeywords($value, array $fallback): array
    {
        if (is_string($value)) {
            $items = preg_split('/[,;|]+/', $value) ?: [];
        } elseif (is_array($value)) {
            $items = $value;
        } else {
            return $fallback;
        }

        $keywords = collect($items)
            ->map(fn ($keyword) => trim((string) $keyword))
            ->filter()
            ->values()
            ->all();

        return $keywords ?: $fallback;
    }

    private function safeQuickReplySidebarUrl($value): string
    {
        $url = trim((string) $value);
        if ($url === '' || !filter_var($url, FILTER_VALIDATE_URL)) {
            return '';
        }

        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $path = (string) ($parts['path'] ?? '');

        if (!in_array($host, ['localhost', '127.0.0.1', '::1', 'admin.gomdaithanh.com'], true)) {
            return '';
        }

        if ($path !== '/admin/quick-replies') {
            return '';
        }

        return $url;
    }

    private function localWindowBridgeCorsHeaders(Request $request): array
    {
        $headers = [
            'Access-Control-Allow-Methods' => 'POST, OPTIONS',
            'Access-Control-Allow-Headers' => 'Accept, Content-Type, X-Requested-With, X-Quick-Reply-Local-Bridge',
            'Access-Control-Max-Age' => '600',
            'Access-Control-Allow-Private-Network' => 'true',
        ];

        $origin = trim((string) $request->headers->get('Origin', ''));
        if ($origin !== '' && $this->isLocalWindowBridgeOriginAllowed($origin)) {
            $headers['Access-Control-Allow-Origin'] = $origin;
            $headers['Vary'] = 'Origin';
        }

        return $headers;
    }

    private function isLocalWindowBridgeRequestAllowed(Request $request): bool
    {
        $bridgeHeader = trim((string) $request->headers->get('X-Quick-Reply-Local-Bridge', ''));
        if ($bridgeHeader !== '1') {
            return false;
        }

        $origin = trim((string) $request->headers->get('Origin', ''));
        if ($origin !== '' && !$this->isLocalWindowBridgeOriginAllowed($origin)) {
            return false;
        }

        if (!$this->isLoopbackAddress($request->getHost())) {
            return false;
        }

        return collect([(string) $request->server('REMOTE_ADDR'), (string) $request->ip()])
            ->contains(fn (string $address) => $this->isLoopbackAddress($address));
    }

    private function isLocalWindowBridgeOriginAllowed(string $origin): bool
    {
        $configured = trim((string) env('QUICK_REPLY_LOCAL_BRIDGE_ALLOWED_ORIGINS', ''));
        $origins = $configured !== ''
            ? preg_split('/[,;|]+/', $configured)
            : [
                'http://localhost:3003',
                'http://127.0.0.1:3003',
                'https://admin.gomdaithanh.com',
                'http://admin.gomdaithanh.com',
            ];

        return collect($origins ?: [])
            ->map(fn ($allowedOrigin) => rtrim(trim((string) $allowedOrigin), '/'))
            ->filter()
            ->contains(rtrim($origin, '/'));
    }

    private function isLoopbackAddress(string $address): bool
    {
        $normalized = Str::lower(trim($address, "[] \t\n\r\0\x0B"));

        return $normalized === 'localhost'
            || $normalized === '::1'
            || preg_match('/^127(?:\.\d{1,3}){3}$/', $normalized) === 1;
    }

    private function setWindowsClipboardFileDropList(array $paths): void
    {
        $paths = array_values(array_filter($paths, fn (string $path) => is_file($path)));
        if ($paths === []) {
            throw new RuntimeException('Không có file ảnh hợp lệ để copy.');
        }

        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $pathsJson = json_encode($paths, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($pathsJson)) {
            throw new RuntimeException('Không chuẩn bị được danh sách ảnh để copy.');
        }

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'set_windows_clipboard_files.py';
        $pathsPath = $root . DIRECTORY_SEPARATOR . 'paths-' . Str::lower(Str::random(12)) . '.json';
        File::put($scriptPath, $this->windowsClipboardPythonScript());
        File::put($pathsPath, $pathsJson);

        $process = new Process([
            $this->clipboardPythonExecutable(),
            $scriptPath,
            $pathsPath,
        ]);
        $process->setEnv(['PYTHONIOENCODING' => 'utf-8']);
        $process->setTimeout(20);
        $process->run();
        File::delete($pathsPath);

        if (!$process->isSuccessful()) {
            $output = trim($process->getErrorOutput() ?: $process->getOutput());
            throw new RuntimeException($output !== ''
                ? 'Không set được clipboard Windows qua Python: ' . $output
                : 'Không set được clipboard Windows qua Python. Kiểm tra QUICK_REPLY_CLIPBOARD_PYTHON nếu máy chưa có Python trong PATH.');
        }
    }

    private function clipboardPythonExecutable(): string
    {
        $candidates = [];
        $configured = trim((string) env('QUICK_REPLY_CLIPBOARD_PYTHON', ''));
        if ($configured !== '') {
            $candidates[] = $configured;
        }

        $userProfile = getenv('USERPROFILE') ?: '';
        if ($userProfile !== '') {
            $candidates[] = rtrim($userProfile, '\\/') . '\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
        }

        $candidates[] = 'C:\\Users\\HLC2023\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';

        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return 'python.exe';
    }

    private function zaloAutomationPythonScript(): string
    {
        return <<<'PYTHON'
import ctypes
import json
import os
import struct
import sys
import time
from ctypes import wintypes

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CF_HDROP = 15
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
KEYEVENTF_KEYUP = 0x0002
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
SW_RESTORE = 9
VK_CONTROL = 0x11
VK_RETURN = 0x0D
VK_MENU = 0x12
VK_V = 0x56

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


GlobalAlloc = kernel32.GlobalAlloc
GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
GlobalAlloc.restype = wintypes.HGLOBAL

GlobalLock = kernel32.GlobalLock
GlobalLock.argtypes = [wintypes.HGLOBAL]
GlobalLock.restype = wintypes.LPVOID

GlobalUnlock = kernel32.GlobalUnlock
GlobalUnlock.argtypes = [wintypes.HGLOBAL]
GlobalUnlock.restype = wintypes.BOOL

GlobalFree = kernel32.GlobalFree
GlobalFree.argtypes = [wintypes.HGLOBAL]
GlobalFree.restype = wintypes.HGLOBAL

OpenClipboard = user32.OpenClipboard
OpenClipboard.argtypes = [wintypes.HWND]
OpenClipboard.restype = wintypes.BOOL

EmptyClipboard = user32.EmptyClipboard
EmptyClipboard.argtypes = []
EmptyClipboard.restype = wintypes.BOOL

SetClipboardData = user32.SetClipboardData
SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
SetClipboardData.restype = wintypes.HANDLE

CloseClipboard = user32.CloseClipboard
CloseClipboard.argtypes = []
CloseClipboard.restype = wintypes.BOOL

EnumWindows = user32.EnumWindows
EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
EnumWindows.restype = wintypes.BOOL

IsWindowVisible = user32.IsWindowVisible
IsWindowVisible.argtypes = [wintypes.HWND]
IsWindowVisible.restype = wintypes.BOOL

GetWindowTextW = user32.GetWindowTextW
GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
GetWindowTextW.restype = ctypes.c_int

GetWindowTextLengthW = user32.GetWindowTextLengthW
GetWindowTextLengthW.argtypes = [wintypes.HWND]
GetWindowTextLengthW.restype = ctypes.c_int

ShowWindow = user32.ShowWindow
ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
ShowWindow.restype = wintypes.BOOL

SetForegroundWindow = user32.SetForegroundWindow
SetForegroundWindow.argtypes = [wintypes.HWND]
SetForegroundWindow.restype = wintypes.BOOL

GetForegroundWindow = user32.GetForegroundWindow
GetForegroundWindow.argtypes = []
GetForegroundWindow.restype = wintypes.HWND

BringWindowToTop = user32.BringWindowToTop
BringWindowToTop.argtypes = [wintypes.HWND]
BringWindowToTop.restype = wintypes.BOOL

GetWindowRect = user32.GetWindowRect
GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
GetWindowRect.restype = wintypes.BOOL

SetCursorPos = user32.SetCursorPos
SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
SetCursorPos.restype = wintypes.BOOL

mouse_event = user32.mouse_event
mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.ULONG]
mouse_event.restype = None

GetWindowThreadProcessId = user32.GetWindowThreadProcessId
GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
GetWindowThreadProcessId.restype = wintypes.DWORD

AttachThreadInput = user32.AttachThreadInput
AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
AttachThreadInput.restype = wintypes.BOOL

GetCurrentThreadId = kernel32.GetCurrentThreadId
GetCurrentThreadId.argtypes = []
GetCurrentThreadId.restype = wintypes.DWORD

keybd_event = user32.keybd_event
keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, wintypes.ULONG]
keybd_event.restype = None

WEB_BROWSER_TITLE_PARTS = [
    "google chrome",
    "chrome",
    "microsoft edge",
    "edge",
    "firefox",
    "coc coc",
]

QUICK_REPLY_TITLE_PARTS = [
    "trả lời nhanh",
    "tra loi nhanh",
    "quick-replies",
    "localhost",
    "sidebar",
]

ZALO_WEB_TITLE_PARTS = [
    "zalo",
    "my z.com",
    "chat.zalo.me",
    "web.zalo.me",
]


def win32_error(message):
    return RuntimeError(f"{message}. Win32 error {ctypes.get_last_error()}")


def sleep_ms(value):
    time.sleep(max(int(value or 0), 0) / 1000)


def payload_delay_ms(payload, key, default_value, minimum_value=0):
    try:
        delay = int(payload.get(key, default_value) or default_value)
    except Exception:
        delay = default_value
    return max(delay, minimum_value)


def window_text(hwnd):
    length = GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def window_process_id(hwnd):
    if not hwnd:
        return 0
    process_id = wintypes.DWORD()
    GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
    return int(process_id.value or 0)


def foreground_belongs_to_window(hwnd):
    foreground = GetForegroundWindow()
    if foreground == hwnd:
        return True
    target_process_id = window_process_id(hwnd)
    foreground_process_id = window_process_id(foreground)
    return bool(target_process_id and target_process_id == foreground_process_id)


def wants_web_target(target):
    normalized = str(target or "pc").strip().lower()
    return normalized in ("web", "chrome", "zalo_web", "zalo-web")


def looks_like_browser(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in WEB_BROWSER_TITLE_PARTS)


def looks_like_quick_reply_window(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in QUICK_REPLY_TITLE_PARTS)


def looks_like_zalo_web_window(title):
    lowered = str(title or "").lower()
    return looks_like_browser(title) and not looks_like_quick_reply_window(title) and any(part in lowered for part in ZALO_WEB_TITLE_PARTS)


def effective_zalo_target(requested_target, title):
    if wants_web_target(requested_target) or looks_like_zalo_web_window(title):
        return "web"
    return "pc"


def find_zalo_window(keywords, target="pc"):
    needles = [str(keyword).lower() for keyword in keywords if str(keyword).strip()]
    target_web = wants_web_target(target)
    if not needles:
        needles = ["zalo"] if not target_web else ["zalo - google chrome", "my z.com - google chrome", "chat.zalo.me", "web.zalo.me"]

    matches = []
    fallback = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        if not IsWindowVisible(hwnd):
            return True
        title = window_text(hwnd)
        if not title:
            return True
        lowered = title.lower()
        if any(needle in lowered for needle in needles):
            item = (hwnd, title)
            if target_web:
                if looks_like_browser(title) and not looks_like_quick_reply_window(title):
                    matches.append(item)
                else:
                    fallback.append(item)
            elif looks_like_browser(title):
                fallback.append(item)
            else:
                matches.append(item)
        return True

    EnumWindows(callback, 0)

    if not matches:
        if target_web:
            if fallback:
                raise RuntimeError("Đang thấy cửa sổ có chữ Zalo nhưng chưa đúng Zalo Web Chrome. Hãy mở tab Zalo web trên Chrome rồi thử lại.")
            raise RuntimeError("Không tìm thấy cửa sổ Zalo Web Chrome. Hãy mở Zalo web trên Chrome và mở đúng khung chat khách trước.")
        if fallback:
            web_fallback = [item for item in fallback if looks_like_zalo_web_window(item[1])]
            if web_fallback:
                chrome = [item for item in web_fallback if "google chrome" in item[1].lower()]
                return (chrome or web_fallback)[0]
            raise RuntimeError("Đang chỉ thấy cửa sổ trình duyệt/panel có chữ Zalo, chưa thấy Zalo Desktop hoặc Zalo Web Chrome. Hãy mở đúng khung chat Zalo rồi thử lại.")
        raise RuntimeError("Không tìm thấy cửa sổ Zalo. Hãy mở Zalo Desktop hoặc Zalo Web Chrome và mở đúng khung chat khách trước.")

    if target_web:
        chrome = [item for item in matches if "google chrome" in item[1].lower()]
        zalo_web = [item for item in matches if any(part in item[1].lower() for part in ZALO_WEB_TITLE_PARTS)]
        return (chrome or zalo_web or matches)[0]

    exact = [item for item in matches if item[1].strip().lower() == "zalo"]
    starts_with_zalo = [item for item in matches if item[1].strip().lower().startswith("zalo")]
    return (exact or starts_with_zalo or matches)[0]

def focus_window(hwnd, title):
    ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.15)

    foreground = GetForegroundWindow()
    current_thread = GetCurrentThreadId()
    foreground_thread = GetWindowThreadProcessId(foreground, None) if foreground else 0
    target_thread = GetWindowThreadProcessId(hwnd, None)

    attached_foreground = False
    attached_target = False
    try:
        if foreground_thread and foreground_thread != current_thread:
            attached_foreground = bool(AttachThreadInput(current_thread, foreground_thread, True))
        if target_thread and target_thread != current_thread:
            attached_target = bool(AttachThreadInput(current_thread, target_thread, True))

        keybd_event(VK_MENU, 0, 0, 0)
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
        BringWindowToTop(hwnd)
        SetForegroundWindow(hwnd)
    finally:
        if attached_target:
            AttachThreadInput(current_thread, target_thread, False)
        if attached_foreground:
            AttachThreadInput(current_thread, foreground_thread, False)

    for _ in range(4):
        time.sleep(0.18)
        if foreground_belongs_to_window(hwnd):
            return
        BringWindowToTop(hwnd)
        SetForegroundWindow(hwnd)

    raise RuntimeError(f"Không đưa được cửa sổ Zalo lên trước: {title}")


def click_chat_input(hwnd, target="pc"):
    rect = RECT()
    if not GetWindowRect(hwnd, ctypes.byref(rect)):
        return

    width = max(rect.right - rect.left, 1)
    height = max(rect.bottom - rect.top, 1)
    y_ratios = [0.955, 0.965] if wants_web_target(target) else [0.965]

    for y_ratio in y_ratios:
        x = rect.left + int(width * 0.50)
        y = rect.top + int(height * y_ratio)
        if SetCursorPos(x, y):
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.04)
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            time.sleep(0.12)


def alloc_clipboard_payload(payload):
    handle = GlobalAlloc(GMEM_MOVEABLE, len(payload))
    if not handle:
        raise win32_error("GlobalAlloc failed")

    locked = GlobalLock(handle)
    if not locked:
        GlobalFree(handle)
        raise win32_error("GlobalLock failed")

    ctypes.memmove(locked, payload, len(payload))
    GlobalUnlock(handle)
    return handle


def set_clipboard(format_id, payload):
    handle = alloc_clipboard_payload(payload)

    if not OpenClipboard(None):
        GlobalFree(handle)
        raise win32_error("OpenClipboard failed")

    try:
        if not EmptyClipboard():
            raise win32_error("EmptyClipboard failed")
        if not SetClipboardData(format_id, handle):
            raise win32_error("SetClipboardData failed")
        handle = None
    finally:
        CloseClipboard()
        if handle:
            GlobalFree(handle)


def set_clipboard_text(text):
    payload = (text + "\0").encode("utf-16le")
    set_clipboard(CF_UNICODETEXT, payload)


def build_hdrop_payload(paths):
    resolved = []
    for path in paths:
        normalized = os.path.abspath(str(path))
        if not os.path.isfile(normalized):
            raise RuntimeError(f"File not found: {normalized}")
        resolved.append(normalized)
    if not resolved:
        raise RuntimeError("No files to copy.")

    file_list = "\0".join(resolved) + "\0\0"
    encoded = file_list.encode("utf-16le")
    header = struct.pack("<IiiII", 20, 0, 0, 0, 1)
    return header + encoded


def set_clipboard_files(paths):
    set_clipboard(CF_HDROP, build_hdrop_payload(paths))


def key_down(vk):
    keybd_event(vk, 0, 0, 0)


def key_up(vk):
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def ctrl_v():
    key_down(VK_CONTROL)
    time.sleep(0.03)
    key_down(VK_V)
    time.sleep(0.03)
    key_up(VK_V)
    time.sleep(0.03)
    key_up(VK_CONTROL)


def press_enter():
    key_down(VK_RETURN)
    time.sleep(0.03)
    key_up(VK_RETURN)


def load_payload(path):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid Zalo send payload.")
    return payload


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: send_quick_reply_to_zalo.py <payload.json>")

    payload = load_payload(sys.argv[1])
    steps = payload.get("steps")
    if not isinstance(steps, list):
        steps = [{
            "text": payload.get("text") or "",
            "images": payload.get("images") or [],
        }]
    keywords = payload.get("window_keywords") or ["Zalo"]
    target = payload.get("zalo_target") or payload.get("target") or "pc"

    hwnd, title = find_zalo_window(keywords, target)
    target = effective_zalo_target(target, title)
    focus_window(hwnd, title)
    click_chat_input(hwnd, target)

    web_target = wants_web_target(target)
    text_paste_delay_ms = payload_delay_ms(payload, "text_paste_delay_ms", 700 if web_target else 250, 700 if web_target else 0)
    image_paste_delay_ms = payload_delay_ms(payload, "image_paste_delay_ms", 2400 if web_target else 1600, 2400 if web_target else 0)
    between_steps_delay_ms = payload_delay_ms(payload, "between_steps_delay_ms", 750 if web_target else 450, 750 if web_target else 0)

    sent_text = 0
    sent_images = 0
    sent_steps = 0

    for step in steps:
        if not isinstance(step, dict):
            continue

        text = str(step.get("text") or "").strip()
        images = step.get("images") or []
        if not text and not images:
            continue

        if text:
            set_clipboard_text(text)
            ctrl_v()
            sleep_ms(text_paste_delay_ms)

        if images:
            set_clipboard_files(images)
            ctrl_v()
            sleep_ms(image_paste_delay_ms)

        press_enter()
        sent_steps += 1
        if text:
            sent_text += 1
        if images:
            sent_images += len(images)

        sleep_ms(between_steps_delay_ms)

    if sent_steps == 0:
        raise RuntimeError("Không có nội dung hoặc ảnh để gửi sang Zalo.")

    print(json.dumps({"ok": True, "window_title": title, "zalo_target": target, "sent_steps": sent_steps, "sent_text": sent_text, "sent_images": sent_images}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
PYTHON;
    }

    private function splitZaloPythonScript(): string
    {
        return <<<'PYTHON'
import ctypes
import json
import os
import subprocess
import sys
import time
from ctypes import wintypes

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SW_RESTORE = 9
SWP_NOACTIVATE = 0x0010
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040
SPI_GETWORKAREA = 0x0030

HWND_TOPMOST = wintypes.HWND(-1)

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


EnumWindows = user32.EnumWindows
EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
EnumWindows.restype = wintypes.BOOL

IsWindowVisible = user32.IsWindowVisible
IsWindowVisible.argtypes = [wintypes.HWND]
IsWindowVisible.restype = wintypes.BOOL

GetWindowTextW = user32.GetWindowTextW
GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
GetWindowTextW.restype = ctypes.c_int

GetWindowTextLengthW = user32.GetWindowTextLengthW
GetWindowTextLengthW.argtypes = [wintypes.HWND]
GetWindowTextLengthW.restype = ctypes.c_int

GetForegroundWindow = user32.GetForegroundWindow
GetForegroundWindow.argtypes = []
GetForegroundWindow.restype = wintypes.HWND

ShowWindow = user32.ShowWindow
ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
ShowWindow.restype = wintypes.BOOL

SetWindowPos = user32.SetWindowPos
SetWindowPos.argtypes = [
    wintypes.HWND,
    wintypes.HWND,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
]
SetWindowPos.restype = wintypes.BOOL

SetForegroundWindow = user32.SetForegroundWindow
SetForegroundWindow.argtypes = [wintypes.HWND]
SetForegroundWindow.restype = wintypes.BOOL

SystemParametersInfoW = user32.SystemParametersInfoW
SystemParametersInfoW.argtypes = [wintypes.UINT, wintypes.UINT, ctypes.POINTER(RECT), wintypes.UINT]
SystemParametersInfoW.restype = wintypes.BOOL

ShellExecuteW = shell32.ShellExecuteW
ShellExecuteW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int]
ShellExecuteW.restype = wintypes.HINSTANCE


def win32_error(message):
    return RuntimeError(f"{message}. Win32 error {ctypes.get_last_error()}")


def window_text(hwnd):
    length = GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value



def window_matches(title, keywords):
    lowered = title.lower()
    needles = [str(keyword).strip().lower() for keyword in keywords if str(keyword).strip()]
    return any(needle in lowered for needle in needles)


def window_match_score(title, keywords):
    lowered = title.lower()
    needles = [str(keyword).strip().lower() for keyword in keywords if str(keyword).strip()]
    scores = []
    for index, needle in enumerate(needles):
        if needle and needle in lowered:
            scores.append((len(needles) - index, len(needle)))
    return max(scores, default=(0, 0))


def should_ignore_window_title(title):
    lowered = title.lower()
    return "devtools" in lowered or "developer tools" in lowered


def list_windows():
    windows = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        if not IsWindowVisible(hwnd):
            return True
        title = window_text(hwnd)
        if title and not should_ignore_window_title(title):
            windows.append((hwnd, title))
        return True

    EnumWindows(callback, 0)
    return windows


WEB_BROWSER_TITLE_PARTS = ["google chrome", "chrome", "microsoft edge", "edge", "firefox", "coc coc"]
QUICK_REPLY_TITLE_PARTS = ["trả lời nhanh", "tra loi nhanh", "quick-replies", "localhost", "sidebar"]
ZALO_WEB_TITLE_PARTS = ["zalo", "my z.com", "chat.zalo.me", "web.zalo.me"]


def wants_web_target(target):
    normalized = str(target or "pc").strip().lower()
    return normalized in ("web", "chrome", "zalo_web", "zalo-web")


def looks_like_browser(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in WEB_BROWSER_TITLE_PARTS)


def looks_like_quick_reply_window(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in QUICK_REPLY_TITLE_PARTS)


def looks_like_zalo_web_window(title):
    lowered = str(title or "").lower()
    return looks_like_browser(title) and not looks_like_quick_reply_window(title) and any(part in lowered for part in ZALO_WEB_TITLE_PARTS)


def find_zalo_window(keywords, target, label):
    target_web = wants_web_target(target)
    matches = []
    fallback = []

    for hwnd, title in list_windows():
        score = window_match_score(title, keywords)
        if score[0] <= 0:
            continue
        item = (score, hwnd, title)
        if target_web:
            if looks_like_zalo_web_window(title):
                matches.append(item)
            else:
                fallback.append(item)
        elif looks_like_browser(title):
            fallback.append(item)
        else:
            matches.append(item)

    if not matches:
        if target_web:
            if fallback:
                raise RuntimeError("Đang thấy cửa sổ có chữ Zalo nhưng chưa đúng Zalo Web Chrome. Hãy mở tab Zalo web trên Chrome rồi thử lại.")
            raise RuntimeError("Không tìm thấy cửa sổ Zalo Web Chrome. Hãy mở Zalo web trên Chrome rồi thử lại.")

        web_fallback = [item for item in fallback if looks_like_zalo_web_window(item[2])]
        if web_fallback:
            web_fallback.sort(key=lambda item: item[0], reverse=True)
            chrome = [item for item in web_fallback if "google chrome" in item[2].lower()]
            choice = (chrome or web_fallback)[0]
            return choice[1], choice[2]

        if fallback:
            raise RuntimeError("Đang chỉ thấy cửa sổ trình duyệt/panel có chữ Zalo, chưa thấy Zalo Desktop hoặc Zalo Web Chrome. Hãy mở đúng khung chat Zalo rồi thử lại.")
        raise RuntimeError(f"Không tìm thấy cửa sổ {label}. Hãy mở {label} rồi thử lại.")

    matches.sort(key=lambda item: item[0], reverse=True)
    if target_web:
        chrome = [item for item in matches if "google chrome" in item[2].lower()]
        choice = (chrome or matches)[0]
        return choice[1], choice[2]

    exact = [item for item in matches if item[2].strip().lower() == "zalo"]
    starts_with_zalo = [item for item in matches if item[2].strip().lower().startswith("zalo")]
    choice = (exact or starts_with_zalo or matches)[0]
    return choice[1], choice[2]

def find_window(keywords, label, exclude=None):
    exclude = set(exclude or [])
    matches = []
    for hwnd, title in list_windows():
        if hwnd in exclude:
            continue
        score = window_match_score(title, keywords)
        if score[0] > 0:
            matches.append((score, hwnd, title))
    if not matches:
        raise RuntimeError(f"Không tìm thấy cửa sổ {label}. Hãy mở {label} rồi thử lại.")
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1], matches[0][2]


def find_window_retry(keywords, label, exclude=None, timeout_seconds=5.0):
    deadline = time.time() + max(float(timeout_seconds), 0.2)
    last_error = None
    while time.time() < deadline:
        try:
            return find_window(keywords, label, exclude)
        except RuntimeError as exc:
            last_error = exc
            time.sleep(0.2)
    if last_error:
        raise last_error
    return find_window(keywords, label, exclude)


def browser_executable():
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", "")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)", "")
    candidates = [
        os.path.join(local_app_data, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(program_files, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(program_files_x86, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(program_files, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(program_files_x86, "Microsoft", "Edge", "Application", "msedge.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]

    try:
        import winreg
        registry_locations = [
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
        ]
        for root, key_path in registry_locations:
            try:
                with winreg.OpenKey(root, key_path) as key:
                    path, _ = winreg.QueryValueEx(key, "")
                    candidates.insert(0, path)
            except OSError:
                pass
    except Exception:
        pass

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate

    return ""


def launch_sidebar_browser(url, x, y, width, height):
    executable = browser_executable()
    window_args = f'--app="{url}" --window-size={int(width)},{int(height)} --window-position={int(x)},{int(y)}'

    if executable:
        subprocess.Popen([
            executable,
            f"--app={url}",
            f"--window-size={int(width)},{int(height)}",
            f"--window-position={int(x)},{int(y)}",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        return executable

    for app_name in ["chrome.exe", "msedge.exe"]:
        result = ShellExecuteW(None, "open", app_name, window_args, None, 1)
        if int(result) > 32:
            return app_name

    raise RuntimeError("Không tìm thấy Chrome hoặc Edge để mở panel trả lời nhanh.")


def work_area():
    rect = RECT()
    if not SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0):
        raise win32_error("Không đọc được vùng làm việc màn hình")
    return rect


def move_window(hwnd, x, y, width, height, topmost=False):
    ShowWindow(hwnd, SW_RESTORE)
    insert_after = HWND_TOPMOST if topmost else None
    flags = SWP_SHOWWINDOW | (SWP_NOACTIVATE if topmost else 0)
    if not SetWindowPos(hwnd, insert_after, int(x), int(y), int(width), int(height), flags):
        raise win32_error("Không resize được cửa sổ")


def keep_window_topmost(hwnd):
    if not SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW):
        raise win32_error("Không ghim được panel bên phải")


def foreground_or_browser(browser_keywords, zalo_keywords, zalo_hwnd, prefer_foreground=True):
    if prefer_foreground:
        foreground = GetForegroundWindow()
        if foreground and foreground != zalo_hwnd:
            title = window_text(foreground)
            if not title or not window_matches(title, zalo_keywords):
                return foreground, title
    return find_window(browser_keywords, "trình duyệt", exclude=[zalo_hwnd])


def load_payload(path):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid split payload.")
    return payload


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: split_quick_replies_zalo.py <payload.json>")

    payload = load_payload(sys.argv[1])
    zalo_keywords = payload.get("zalo_window_keywords") or ["Zalo"]
    browser_keywords = payload.get("browser_window_keywords") or ["Trả lời nhanh", "localhost"]
    mode = str(payload.get("mode") or "split").strip().lower()
    sidebar_width = min(max(int(payload.get("sidebar_width", 360)), 300), 520)
    sidebar_url = str(payload.get("sidebar_url") or "").strip()
    require_browser = bool(payload.get("require_browser", mode != "sidebar"))
    manage_browser = bool(payload.get("manage_browser", mode != "sidebar"))
    strict_browser_keywords = bool(payload.get("strict_browser_keywords", False))
    browser_ratio = min(max(float(payload.get("browser_ratio", 0.58)), 0.35), 0.72)
    gap = max(int(payload.get("gap", 12)), 0)
    margin = max(int(payload.get("margin", 0)), 0)
    zalo_target = str(payload.get("zalo_target") or "pc").strip().lower()
    zalo_label = "Zalo Web Chrome" if zalo_target == "web" else "Zalo"

    zalo_hwnd, zalo_title = find_zalo_window(zalo_keywords, zalo_target, zalo_label)
    browser_hwnd = None
    browser_title = ""
    browser_error = ""

    if mode != "sidebar":
        browser_hwnd, browser_title = foreground_or_browser(browser_keywords, zalo_keywords, zalo_hwnd, not strict_browser_keywords)

        if browser_hwnd == zalo_hwnd:
            raise RuntimeError("Không xác định được cửa sổ trình duyệt riêng với Zalo.")

    rect = work_area()
    x = rect.left + margin
    y = rect.top + margin
    width = max(rect.right - rect.left - margin * 2, 900)
    height = max(rect.bottom - rect.top - margin * 2, 600)
    usable_width = max(width - gap, 900)

    if mode == "sidebar":
        sidebar_width = min(sidebar_width, max(300, usable_width - 620))
        zalo_width = max(usable_width - sidebar_width, 620)
        if zalo_width + sidebar_width > usable_width:
            zalo_width = max(usable_width - sidebar_width, 520)

        move_window(zalo_hwnd, x, y, zalo_width, height)
        if sidebar_url:
            launch_sidebar_browser(sidebar_url, x + zalo_width + gap, y, sidebar_width, height)
            time.sleep(0.8)

        if manage_browser or sidebar_url:
            try:
                if sidebar_url or strict_browser_keywords:
                    browser_hwnd, browser_title = find_window_retry(browser_keywords, "trình duyệt", exclude=[zalo_hwnd], timeout_seconds=8.0)
                else:
                    browser_hwnd, browser_title = foreground_or_browser(browser_keywords, zalo_keywords, zalo_hwnd, True)
                if browser_hwnd and browser_hwnd != zalo_hwnd:
                    move_window(browser_hwnd, x + zalo_width + gap, y, sidebar_width, height, True)
                    keep_window_topmost(browser_hwnd)
            except Exception as exc:
                browser_error = str(exc)
                if require_browser:
                    raise RuntimeError(f"Không đặt được panel trả lời nhanh bên phải: {exc}")
                browser_title = ""
        SetForegroundWindow(zalo_hwnd)
        time.sleep(0.1)

        print(json.dumps({
            "ok": True,
            "mode": mode,
            "browser_title": browser_title,
            "browser_found": bool(browser_title),
            "browser_error": browser_error,
            "zalo_title": zalo_title,
            "browser_rect": [x + zalo_width + gap, y, sidebar_width, height],
            "zalo_rect": [x, y, zalo_width, height],
        }, ensure_ascii=True))
        return

    left_width = max(int(usable_width * browser_ratio), 520)
    right_width = max(usable_width - left_width, 420)

    if left_width + right_width > usable_width:
        right_width = max(usable_width - left_width, 360)

    move_window(browser_hwnd, x, y, left_width, height)
    move_window(zalo_hwnd, x + left_width + gap, y, right_width, height)
    SetForegroundWindow(browser_hwnd)
    time.sleep(0.1)

    print(json.dumps({
        "ok": True,
        "browser_title": browser_title,
        "zalo_title": zalo_title,
        "browser_rect": [x, y, left_width, height],
        "zalo_rect": [x + left_width + gap, y, right_width, height],
    }, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
PYTHON;
    }

    private function zaloMirrorPythonScript(): string
    {
        return <<<'PYTHON'
import ctypes
import json
import os
import struct
import sys
import time
from ctypes import wintypes

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BI_RGB = 0
CF_UNICODETEXT = 13
DIB_RGB_COLORS = 0
GMEM_MOVEABLE = 0x0002
KEYEVENTF_KEYUP = 0x0002
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
PW_RENDERFULLCONTENT = 0x00000002
SRCCOPY = 0x00CC0020
SW_RESTORE = 9
VK_CONTROL = 0x11
VK_RETURN = 0x0D
VK_V = 0x56

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


EnumWindows = user32.EnumWindows
EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM), wintypes.LPARAM]
EnumWindows.restype = wintypes.BOOL

IsWindowVisible = user32.IsWindowVisible
IsWindowVisible.argtypes = [wintypes.HWND]
IsWindowVisible.restype = wintypes.BOOL

GetWindowTextW = user32.GetWindowTextW
GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
GetWindowTextW.restype = ctypes.c_int

GetWindowTextLengthW = user32.GetWindowTextLengthW
GetWindowTextLengthW.argtypes = [wintypes.HWND]
GetWindowTextLengthW.restype = ctypes.c_int

GetWindowRect = user32.GetWindowRect
GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
GetWindowRect.restype = wintypes.BOOL

ShowWindow = user32.ShowWindow
ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
ShowWindow.restype = wintypes.BOOL

SetForegroundWindow = user32.SetForegroundWindow
SetForegroundWindow.argtypes = [wintypes.HWND]
SetForegroundWindow.restype = wintypes.BOOL

SetCursorPos = user32.SetCursorPos
SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
SetCursorPos.restype = wintypes.BOOL

mouse_event = user32.mouse_event
mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.ULONG]
mouse_event.restype = None

keybd_event = user32.keybd_event
keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, wintypes.ULONG]
keybd_event.restype = None

PrintWindow = user32.PrintWindow
PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
PrintWindow.restype = wintypes.BOOL

GetWindowDC = user32.GetWindowDC
GetWindowDC.argtypes = [wintypes.HWND]
GetWindowDC.restype = wintypes.HDC

ReleaseDC = user32.ReleaseDC
ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
ReleaseDC.restype = ctypes.c_int

CreateCompatibleDC = gdi32.CreateCompatibleDC
CreateCompatibleDC.argtypes = [wintypes.HDC]
CreateCompatibleDC.restype = wintypes.HDC

CreateCompatibleBitmap = gdi32.CreateCompatibleBitmap
CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
CreateCompatibleBitmap.restype = wintypes.HBITMAP

SelectObject = gdi32.SelectObject
SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
SelectObject.restype = wintypes.HGDIOBJ

BitBlt = gdi32.BitBlt
BitBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
BitBlt.restype = wintypes.BOOL

GetDIBits = gdi32.GetDIBits
GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, wintypes.LPVOID, ctypes.POINTER(BITMAPINFO), wintypes.UINT]
GetDIBits.restype = ctypes.c_int

DeleteObject = gdi32.DeleteObject
DeleteObject.argtypes = [wintypes.HGDIOBJ]
DeleteObject.restype = wintypes.BOOL

DeleteDC = gdi32.DeleteDC
DeleteDC.argtypes = [wintypes.HDC]
DeleteDC.restype = wintypes.BOOL

GlobalAlloc = kernel32.GlobalAlloc
GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
GlobalAlloc.restype = wintypes.HGLOBAL

GlobalLock = kernel32.GlobalLock
GlobalLock.argtypes = [wintypes.HGLOBAL]
GlobalLock.restype = wintypes.LPVOID

GlobalUnlock = kernel32.GlobalUnlock
GlobalUnlock.argtypes = [wintypes.HGLOBAL]
GlobalUnlock.restype = wintypes.BOOL

GlobalFree = kernel32.GlobalFree
GlobalFree.argtypes = [wintypes.HGLOBAL]
GlobalFree.restype = wintypes.HGLOBAL

OpenClipboard = user32.OpenClipboard
OpenClipboard.argtypes = [wintypes.HWND]
OpenClipboard.restype = wintypes.BOOL

EmptyClipboard = user32.EmptyClipboard
EmptyClipboard.argtypes = []
EmptyClipboard.restype = wintypes.BOOL

SetClipboardData = user32.SetClipboardData
SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
SetClipboardData.restype = wintypes.HANDLE

CloseClipboard = user32.CloseClipboard
CloseClipboard.argtypes = []
CloseClipboard.restype = wintypes.BOOL


def win32_error(message):
    return RuntimeError(f"{message}. Win32 error {ctypes.get_last_error()}")


def window_text(hwnd):
    length = GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value



WEB_BROWSER_TITLE_PARTS = ["google chrome", "chrome", "microsoft edge", "edge", "firefox", "coc coc"]
QUICK_REPLY_TITLE_PARTS = ["trả lời nhanh", "tra loi nhanh", "quick-replies", "localhost", "sidebar"]
ZALO_WEB_TITLE_PARTS = ["zalo", "my z.com", "chat.zalo.me", "web.zalo.me"]


def wants_web_target(target):
    normalized = str(target or "pc").strip().lower()
    return normalized in ("web", "chrome", "zalo_web", "zalo-web")


def looks_like_browser(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in WEB_BROWSER_TITLE_PARTS)


def looks_like_quick_reply_window(title):
    lowered = str(title or "").lower()
    return any(part in lowered for part in QUICK_REPLY_TITLE_PARTS)


def looks_like_zalo_web_window(title):
    lowered = str(title or "").lower()
    return looks_like_browser(title) and not looks_like_quick_reply_window(title) and any(part in lowered for part in ZALO_WEB_TITLE_PARTS)


def effective_zalo_target(requested_target, title):
    if wants_web_target(requested_target) or looks_like_zalo_web_window(title):
        return "web"
    return "pc"


def find_zalo_window(keywords, target="pc"):
    needles = [str(keyword).strip().lower() for keyword in keywords if str(keyword).strip()]
    target_web = wants_web_target(target)
    if not needles:
        needles = ["zalo"] if not target_web else ["zalo - google chrome", "my z.com - google chrome", "chat.zalo.me", "web.zalo.me"]
    matches = []
    fallback = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _lparam):
        if not IsWindowVisible(hwnd):
            return True
        title = window_text(hwnd)
        if not title:
            return True
        lowered = title.lower()
        if any(needle in lowered for needle in needles):
            item = (hwnd, title)
            if target_web:
                if looks_like_browser(title) and not looks_like_quick_reply_window(title):
                    matches.append(item)
                else:
                    fallback.append(item)
            elif looks_like_browser(title):
                fallback.append(item)
            else:
                matches.append(item)
        return True

    EnumWindows(callback, 0)
    if not matches:
        if target_web:
            if fallback:
                raise RuntimeError("Đang thấy cửa sổ có chữ Zalo nhưng chưa đúng Zalo Web Chrome. Hãy mở tab Zalo web trên Chrome rồi thử lại.")
            raise RuntimeError("Không tìm thấy cửa sổ Zalo Web Chrome. Hãy mở Zalo web trên Chrome rồi thử lại.")
        if fallback:
            web_fallback = [item for item in fallback if looks_like_zalo_web_window(item[1])]
            if web_fallback:
                chrome = [item for item in web_fallback if "google chrome" in item[1].lower()]
                return (chrome or web_fallback)[0]
            raise RuntimeError("Đang chỉ thấy cửa sổ trình duyệt/panel có chữ Zalo, chưa thấy Zalo Desktop hoặc Zalo Web Chrome. Hãy mở đúng khung chat Zalo rồi thử lại.")
        raise RuntimeError("Không tìm thấy cửa sổ Zalo. Hãy mở Zalo Desktop hoặc Zalo Web Chrome và mở đúng khung chat khách trước.")

    if target_web:
        chrome = [item for item in matches if "google chrome" in item[1].lower()]
        zalo_web = [item for item in matches if any(part in item[1].lower() for part in ZALO_WEB_TITLE_PARTS)]
        return (chrome or zalo_web or matches)[0]

    exact = [item for item in matches if item[1].strip().lower() == "zalo"]
    starts_with_zalo = [item for item in matches if item[1].strip().lower().startswith("zalo")]
    return (exact or starts_with_zalo or matches)[0]


def window_rect(hwnd):
    rect = RECT()
    if not GetWindowRect(hwnd, ctypes.byref(rect)):
        raise win32_error("Không đọc được kích thước cửa sổ Zalo")
    width = max(rect.right - rect.left, 1)
    height = max(rect.bottom - rect.top, 1)
    return rect, width, height


def focus_window(hwnd):
    ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.08)
    SetForegroundWindow(hwnd)
    time.sleep(0.12)


def capture_window(hwnd, output_path):
    ShowWindow(hwnd, SW_RESTORE)
    time.sleep(0.03)
    rect, width, height = window_rect(hwnd)
    window_dc = GetWindowDC(hwnd)
    if not window_dc:
        raise win32_error("Không lấy được DC của Zalo")

    memory_dc = CreateCompatibleDC(window_dc)
    if not memory_dc:
        ReleaseDC(hwnd, window_dc)
        raise win32_error("Không tạo được memory DC")

    bitmap = CreateCompatibleBitmap(window_dc, width, height)
    if not bitmap:
        DeleteDC(memory_dc)
        ReleaseDC(hwnd, window_dc)
        raise win32_error("Không tạo được bitmap")

    old_object = SelectObject(memory_dc, bitmap)
    try:
        ok = PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT)
        if not ok:
            ok = BitBlt(memory_dc, 0, 0, width, height, window_dc, 0, 0, SRCCOPY)
        if not ok:
            raise win32_error("Không chụp được cửa sổ Zalo")

        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = width
        bmi.bmiHeader.biHeight = -height
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = BI_RGB
        bmi.bmiHeader.biSizeImage = width * height * 4

        buffer = ctypes.create_string_buffer(width * height * 4)
        lines = GetDIBits(memory_dc, bitmap, 0, height, buffer, ctypes.byref(bmi), DIB_RGB_COLORS)
        if lines == 0:
            raise win32_error("Không đọc được bitmap Zalo")

        pixel_data = buffer.raw
        file_size = 14 + 40 + len(pixel_data)
        file_header = b"BM" + struct.pack("<IHHI", file_size, 0, 0, 54)
        dib_header = struct.pack("<IiiHHIIiiII", 40, width, -height, 1, 32, BI_RGB, len(pixel_data), 0, 0, 0, 0)

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "wb") as handle:
            handle.write(file_header)
            handle.write(dib_header)
            handle.write(pixel_data)
    finally:
        SelectObject(memory_dc, old_object)
        DeleteObject(bitmap)
        DeleteDC(memory_dc)
        ReleaseDC(hwnd, window_dc)

    return {"width": width, "height": height, "output_path": output_path}


def click_window(hwnd, x_ratio, y_ratio, double=False):
    focus_window(hwnd)
    rect, width, height = window_rect(hwnd)
    x = rect.left + max(0, min(width - 1, int(width * float(x_ratio))))
    y = rect.top + max(0, min(height - 1, int(height * float(y_ratio))))
    if not SetCursorPos(x, y):
        raise win32_error("Không di chuyển được chuột vào Zalo")

    for _ in range(2 if double else 1):
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        time.sleep(0.04)
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        time.sleep(0.08)

    return {"x": x, "y": y}


def alloc_clipboard_payload(payload):
    handle = GlobalAlloc(GMEM_MOVEABLE, len(payload))
    if not handle:
        raise win32_error("GlobalAlloc failed")
    locked = GlobalLock(handle)
    if not locked:
        GlobalFree(handle)
        raise win32_error("GlobalLock failed")
    ctypes.memmove(locked, payload, len(payload))
    GlobalUnlock(handle)
    return handle


def set_clipboard_text(text):
    payload = (text + "\0").encode("utf-16le")
    handle = alloc_clipboard_payload(payload)
    if not OpenClipboard(None):
        GlobalFree(handle)
        raise win32_error("OpenClipboard failed")
    try:
        if not EmptyClipboard():
            raise win32_error("EmptyClipboard failed")
        if not SetClipboardData(CF_UNICODETEXT, handle):
            raise win32_error("SetClipboardData failed")
        handle = None
    finally:
        CloseClipboard()
        if handle:
            GlobalFree(handle)


def key_down(vk):
    keybd_event(vk, 0, 0, 0)


def key_up(vk):
    keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def ctrl_v():
    key_down(VK_CONTROL)
    time.sleep(0.03)
    key_down(VK_V)
    time.sleep(0.03)
    key_up(VK_V)
    time.sleep(0.03)
    key_up(VK_CONTROL)


def press_enter():
    key_down(VK_RETURN)
    time.sleep(0.03)
    key_up(VK_RETURN)


def type_into_window(hwnd, text, enter=False):
    focus_window(hwnd)
    if text:
        set_clipboard_text(text)
        ctrl_v()
        time.sleep(0.12)
    if enter:
        press_enter()
    return {"typed": bool(text), "enter": bool(enter)}


def load_payload(path):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid Zalo mirror payload.")
    return payload


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: zalo_mirror_helper.py <payload.json>")

    payload = load_payload(sys.argv[1])
    hwnd, title = find_zalo_window(payload.get("window_keywords") or ["Zalo"], payload.get("zalo_target") or "pc")
    action = payload.get("action")

    if action == "screenshot":
        result = capture_window(hwnd, payload.get("output_path"))
    elif action == "click":
        result = click_window(hwnd, payload.get("x_ratio", 0.5), payload.get("y_ratio", 0.5), bool(payload.get("double", False)))
    elif action == "type":
        result = type_into_window(hwnd, str(payload.get("text") or ""), bool(payload.get("enter", False)))
    else:
        raise RuntimeError("Unknown Zalo mirror action.")

    result["ok"] = True
    result["window_title"] = title
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
PYTHON;
    }

    private function windowsClipboardPythonScript(): string
    {
        return <<<'PYTHON'
import ctypes
import json
import os
import struct
import sys
from ctypes import wintypes

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CF_HDROP = 15
GMEM_MOVEABLE = 0x0002

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)

GlobalAlloc = kernel32.GlobalAlloc
GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
GlobalAlloc.restype = wintypes.HGLOBAL

GlobalLock = kernel32.GlobalLock
GlobalLock.argtypes = [wintypes.HGLOBAL]
GlobalLock.restype = wintypes.LPVOID

GlobalUnlock = kernel32.GlobalUnlock
GlobalUnlock.argtypes = [wintypes.HGLOBAL]
GlobalUnlock.restype = wintypes.BOOL

GlobalFree = kernel32.GlobalFree
GlobalFree.argtypes = [wintypes.HGLOBAL]
GlobalFree.restype = wintypes.HGLOBAL

OpenClipboard = user32.OpenClipboard
OpenClipboard.argtypes = [wintypes.HWND]
OpenClipboard.restype = wintypes.BOOL

EmptyClipboard = user32.EmptyClipboard
EmptyClipboard.argtypes = []
EmptyClipboard.restype = wintypes.BOOL

SetClipboardData = user32.SetClipboardData
SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
SetClipboardData.restype = wintypes.HANDLE

CloseClipboard = user32.CloseClipboard
CloseClipboard.argtypes = []
CloseClipboard.restype = wintypes.BOOL


def win32_error(message):
    return RuntimeError(f"{message}. Win32 error {ctypes.get_last_error()}")


def load_paths(json_path):
    with open(json_path, "r", encoding="utf-8") as handle:
        paths = json.load(handle)

    if not isinstance(paths, list):
        raise RuntimeError("Clipboard payload must be a list of file paths.")

    resolved = []
    for path in paths:
        normalized = os.path.abspath(str(path))
        if not os.path.isfile(normalized):
            raise RuntimeError(f"File not found: {normalized}")
        resolved.append(normalized)

    if not resolved:
        raise RuntimeError("No files to copy.")

    return resolved


def build_hdrop_payload(paths):
    file_list = "\0".join(paths) + "\0\0"
    encoded = file_list.encode("utf-16le")
    header = struct.pack("<IiiII", 20, 0, 0, 0, 1)
    return header + encoded


def set_clipboard_file_drop_list(paths):
    payload = build_hdrop_payload(paths)
    handle = GlobalAlloc(GMEM_MOVEABLE, len(payload))
    if not handle:
        raise win32_error("GlobalAlloc failed")

    locked = GlobalLock(handle)
    if not locked:
        GlobalFree(handle)
        raise win32_error("GlobalLock failed")

    ctypes.memmove(locked, payload, len(payload))
    GlobalUnlock(handle)

    if not OpenClipboard(None):
        GlobalFree(handle)
        raise win32_error("OpenClipboard failed")

    try:
        if not EmptyClipboard():
            raise win32_error("EmptyClipboard failed")

        if not SetClipboardData(CF_HDROP, handle):
            raise win32_error("SetClipboardData failed")

        handle = None
    finally:
        CloseClipboard()
        if handle:
            GlobalFree(handle)


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: set_windows_clipboard_files.py <paths.json>")

    paths = load_paths(sys.argv[1])
    set_clipboard_file_drop_list(paths)
    print(json.dumps({"copied_files": len(paths)}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
PYTHON;
    }

    private function pruneClipboardTempDirectories(): void
    {
        $root = storage_path('app/quick-reply-clipboard');
        if (!is_dir($root)) {
            return;
        }

        $cutoff = now()->subDays(2)->getTimestamp();
        foreach (File::directories($root) as $directory) {
            $modifiedAt = @filemtime($directory) ?: time();
            if ($modifiedAt < $cutoff) {
                File::deleteDirectory($directory);
            }
        }
    }

    private function applyFilters(Builder $query, Request $request): void
    {
        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $like = '%' . Str::lower($search) . '%';
            $asciiLike = '%' . $this->normalizeSearchText($search) . '%';
            $query->where(function (Builder $searchQuery) use ($like, $asciiLike) {
                $searchQuery
                    ->whereRaw('LOWER(shortcut) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(title, \'\')) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(body, \'\')) LIKE ?', [$like])
                    ->orWhere('search_text', 'like', $asciiLike);
            });
        }

        $topicId = $request->query('topic_id');
        if (is_numeric($topicId) && (int) $topicId > 0) {
            $query->where('topic_id', (int) $topicId);
        }

        $status = (string) $request->query('status', 'active');
        if ($status === 'trashed') {
            $query->onlyTrashed();
        } elseif ($status === 'active') {
            $query->where('is_active', true);
        } elseif ($status === 'disabled') {
            $query->where('is_active', false);
        }
    }

    private function validateReplyPayload(Request $request, int $accountId, ?QuickReply $reply = null): array
    {
        return $request->validate([
            'topic_id' => [
                'nullable',
                'integer',
                Rule::exists('quick_reply_topics', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'shortcut' => [
                $reply ? 'sometimes' : 'required',
                'string',
                'max:80',
                'regex:/^\/[A-Za-z0-9][A-Za-z0-9._-]*$/',
                Rule::unique('quick_replies', 'shortcut')
                    ->where(fn ($query) => $query->where('account_id', $accountId))
                    ->ignore($reply?->id),
            ],
            'title' => ['nullable', 'string', 'max:255'],
            'body' => ['nullable', 'string', 'max:60000'],
            'tags' => ['nullable', 'array', 'max:20'],
            'tags.*' => ['nullable', 'string', 'max:80'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:999999'],
            'is_active' => ['nullable', 'boolean'],
            'images' => ['nullable', 'array', 'max:120'],
            'images.*.id' => ['nullable', 'integer'],
            'images.*.media_asset_id' => ['nullable', 'integer'],
            'images.*.url' => ['nullable', 'string', 'max:2048'],
            'images.*.image_url' => ['nullable', 'string', 'max:2048'],
            'images.*.thumbnail_url' => ['nullable', 'string', 'max:2048'],
            'images.*.medium_url' => ['nullable', 'string', 'max:2048'],
            'images.*.large_url' => ['nullable', 'string', 'max:2048'],
            'images.*.original_url' => ['nullable', 'string', 'max:2048'],
            'images.*.width' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'images.*.height' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'contents' => ['nullable', 'array', 'max:10'],
            'contents.*.id' => ['nullable', 'integer'],
            'contents.*.body' => ['nullable', 'string', 'max:60000'],
            'contents.*.images' => ['nullable', 'array', 'max:120'],
            'contents.*.images.*.id' => ['nullable', 'integer'],
            'contents.*.images.*.media_asset_id' => ['nullable', 'integer'],
            'contents.*.images.*.url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.image_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.thumbnail_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.medium_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.large_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.original_url' => ['nullable', 'string', 'max:2048'],
            'contents.*.images.*.width' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'contents.*.images.*.height' => ['nullable', 'integer', 'min:0', 'max:100000'],
        ], [
            'shortcut.regex' => 'Ký tự tắt chỉ dùng chữ không dấu, số, dấu chấm, gạch ngang hoặc gạch dưới. Ví dụ: /c1 hoặc /bao-gia.',
            'shortcut.unique' => 'Ký tự tắt này đã tồn tại trong cửa hàng hiện tại. Nếu mẫu đang ở thùng rác, hãy vào Thùng rác để khôi phục.',
        ]);
    }

    private function validateTopicPayload(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'min:2', 'max:120'],
            'color' => ['nullable', 'string', 'max:20'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:999999'],
            'is_active' => ['nullable', 'boolean'],
        ]);
    }

    private function ensureReplyHasContent(string $body, array $images): void
    {
        if ($body === '' && $images === []) {
            throw ValidationException::withMessages([
                'body' => ['Nhập nội dung hoặc thêm ít nhất một ảnh cho câu trả lời nhanh.'],
            ]);
        }
    }

    private function contentsFromValidatedPayload(array $validated, QuickReply $reply): array
    {
        if (array_key_exists('contents', $validated)) {
            return $this->normalizeReplyContents($validated['contents'] ?? []);
        }

        $images = array_key_exists('images', $validated)
            ? $validated['images']
            : collect($this->existingContentPayloads($reply))->flatMap(fn (array $content) => $content['images'])->values()->all();

        return $this->normalizeReplyContents([[
            'body' => array_key_exists('body', $validated) ? ($validated['body'] ?? '') : (string) $reply->body,
            'images' => $images,
        ]]);
    }

    private function existingContentPayloads(QuickReply $reply): array
    {
        $reply->loadMissing(['contents.images', 'images']);

        $contents = $reply->contents
            ->map(fn (QuickReplyContent $content) => [
                'id' => (int) $content->id,
                'body' => (string) $content->body,
                'images' => $content->images->map(fn (QuickReplyImage $image) => $this->imagePayload($image))->values()->all(),
            ])
            ->filter(fn (array $content) => trim($content['body']) !== '' || $content['images'] !== [])
            ->values()
            ->all();

        if ($contents !== []) {
            return $this->normalizeReplyContents($contents);
        }

        return $this->normalizeReplyContents([[
            'body' => (string) $reply->body,
            'images' => $reply->images->map(fn (QuickReplyImage $image) => $this->imagePayload($image))->values()->all(),
        ]]);
    }

    private function normalizeReplyContents(array $contents): array
    {
        $normalized = [];
        $totalImages = 0;

        foreach (array_values($contents) as $content) {
            if (!is_array($content)) {
                continue;
            }

            $body = trim((string) ($content['body'] ?? $content['content'] ?? ''));
            $images = $this->normalizeImages($content['images'] ?? []);
            $remainingImages = max(120 - $totalImages, 0);
            $images = array_slice($images, 0, $remainingImages);
            $totalImages += count($images);

            if ($body === '' && $images === []) {
                continue;
            }

            $normalized[] = [
                'id' => isset($content['id']) && is_numeric($content['id']) ? (int) $content['id'] : null,
                'body' => $body,
                'images' => $images,
                'position' => count($normalized),
            ];

            if (count($normalized) >= 10) {
                break;
            }
        }

        return $normalized;
    }

    private function combinedContentBody(array $contents): string
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
        $existing = $reply->contents()->get()->keyBy('id');
        $keptIds = [];

        foreach ($contents as $index => $contentData) {
            $contentId = $contentData['id'] ?? null;
            $content = $contentId && $existing->has($contentId)
                ? $existing->get($contentId)
                : new QuickReplyContent(['quick_reply_id' => $reply->id]);

            $content->fill([
                'quick_reply_id' => $reply->id,
                'body' => $contentData['body'] ?? '',
                'position' => $index,
                'is_active' => true,
            ]);
            $content->save();

            $keptIds[] = (int) $content->id;
            $this->syncImages($reply, $contentData['images'] ?? [], $content);
        }

        if ($keptIds !== []) {
            $reply->contents()->whereNotIn('id', $keptIds)->delete();
        } else {
            $reply->contents()->delete();
        }

        $reply->images()->whereNull('quick_reply_content_id')->delete();
    }

    private function syncImages(QuickReply $reply, array $images, ?QuickReplyContent $content = null): void
    {
        $imageQuery = $reply->images();
        if ($content) {
            $imageQuery->where('quick_reply_content_id', $content->id);
        } else {
            $imageQuery->whereNull('quick_reply_content_id');
        }
        $imageQuery->delete();

        foreach ($images as $index => $image) {
            QuickReplyImage::query()->create([
                'quick_reply_id' => $reply->id,
                'quick_reply_content_id' => $content?->id,
                'media_asset_id' => $image['media_asset_id'] ?? null,
                'url' => $image['url'],
                'thumbnail_url' => $image['thumbnail_url'] ?? null,
                'medium_url' => $image['medium_url'] ?? null,
                'large_url' => $image['large_url'] ?? null,
                'original_url' => $image['original_url'] ?? null,
                'width' => $image['width'] ?? null,
                'height' => $image['height'] ?? null,
                'sort_order' => $index,
                'metadata' => $image['metadata'] ?? null,
            ]);
        }
    }

    private function normalizeImages(array $images): array
    {
        return collect($images)
            ->map(function ($image) {
                if (is_string($image)) {
                    $image = ['url' => trim($image)];
                }

                if (!is_array($image)) {
                    return null;
                }

                $url = trim((string) (
                    $image['url']
                    ?? $image['large_url']
                    ?? $image['image_url']
                    ?? $image['medium_url']
                    ?? $image['original_url']
                    ?? ''
                ));

                if ($url === '') {
                    return null;
                }

                $mediaAssetId = $image['media_asset_id'] ?? null;
                if ($mediaAssetId === null && !array_key_exists('media_asset_id', $image)) {
                    $mediaAssetId = $image['id'] ?? null;
                }

                return [
                    'media_asset_id' => is_numeric($mediaAssetId) ? (int) $mediaAssetId : null,
                    'url' => $url,
                    'thumbnail_url' => $this->nullableString($image['thumbnail_url'] ?? null),
                    'medium_url' => $this->nullableString($image['medium_url'] ?? null),
                    'large_url' => $this->nullableString($image['large_url'] ?? $url),
                    'original_url' => $this->nullableString($image['original_url'] ?? null),
                    'width' => isset($image['width']) && is_numeric($image['width']) ? (int) $image['width'] : null,
                    'height' => isset($image['height']) && is_numeric($image['height']) ? (int) $image['height'] : null,
                    'metadata' => array_filter([
                        'public_id' => $image['public_id'] ?? null,
                        'srcset' => $image['srcset'] ?? null,
                        'original_name' => $image['original_name'] ?? null,
                    ]),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeTags($tags): array
    {
        if (is_string($tags)) {
            $tags = preg_split('/[,;\n]+/', $tags) ?: [];
        }

        if (!is_array($tags)) {
            return [];
        }

        return collect($tags)
            ->map(fn ($tag) => trim((string) $tag))
            ->filter()
            ->unique(fn ($tag) => Str::lower($tag))
            ->take(20)
            ->values()
            ->all();
    }

    private function normalizeShortcut($value): string
    {
        $shortcut = Str::lower(trim((string) $value));
        $shortcut = preg_replace('/\s+/', '', $shortcut) ?: '';

        if ($shortcut !== '' && !str_starts_with($shortcut, '/')) {
            $shortcut = '/' . $shortcut;
        }

        return $shortcut;
    }

    private function buildReplySearchText(string $shortcut, string $title, string $body, $tags = []): string
    {
        $tagText = is_array($tags) ? implode(' ', $tags) : (string) $tags;

        return $this->normalizeSearchText(trim($shortcut . ' ' . $title . ' ' . $body . ' ' . $tagText));
    }

    private function normalizeSearchText(string $value): string
    {
        return Str::of($value)
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9\/._-]+/', ' ')
            ->squish()
            ->toString();
    }

    private function normalizeTitle(string $title, string $body, string $shortcut): string
    {
        $title = trim($title);
        if ($title !== '') {
            return $title;
        }

        $fallback = trim(preg_replace('/\s+/', ' ', $body) ?: '');
        if ($fallback !== '') {
            return mb_strimwidth($fallback, 0, 90, '...');
        }

        return $shortcut;
    }

    private function normalizeColor(?string $color): string
    {
        $color = trim((string) $color);

        if (preg_match('/^#[0-9a-f]{6}$/i', $color) === 1) {
            return Str::lower($color);
        }

        return self::DEFAULT_TOPIC_COLORS[array_rand(self::DEFAULT_TOPIC_COLORS)];
    }

    private function uniqueTopicSlug(int $accountId, string $name, ?int $ignoreId = null): string
    {
        $base = Str::slug($name);
        if ($base === '') {
            $base = Str::lower(Str::random(8));
        }

        $slug = $base;
        $suffix = 2;

        while (
            QuickReplyTopic::query()
                ->where('account_id', $accountId)
                ->where('slug', $slug)
                ->when($ignoreId, fn (Builder $query) => $query->whereKeyNot($ignoreId))
                ->exists()
        ) {
            $slug = $base . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function nextShortcutCopy(int $accountId, string $shortcut): string
    {
        $base = preg_replace('/-copy-\d+$/', '', $shortcut) ?: '/mau';

        for ($index = 2; $index < 1000; $index++) {
            $candidate = $base . '-copy-' . $index;
            $exists = QuickReply::query()
                ->where('account_id', $accountId)
                ->where('shortcut', $candidate)
                ->exists();

            if (!$exists) {
                return $candidate;
            }
        }

        return $base . '-' . Str::lower(Str::random(6));
    }

    private function topicQuery(int $accountId)
    {
        return QuickReplyTopic::query()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id');
    }

    private function nextTopicSortOrder(int $accountId): int
    {
        return ((int) QuickReplyTopic::query()->where('account_id', $accountId)->max('sort_order')) + 1;
    }

    private function nextReplySortOrder(int $accountId): int
    {
        return ((int) QuickReply::query()->where('account_id', $accountId)->max('sort_order')) + 1;
    }

    private function stats(int $accountId): array
    {
        return [
            'topics' => QuickReplyTopic::query()->where('account_id', $accountId)->count(),
            'replies' => QuickReply::query()->where('account_id', $accountId)->count(),
            'active_replies' => QuickReply::query()->where('account_id', $accountId)->where('is_active', true)->count(),
            'trashed_replies' => QuickReply::onlyTrashed()->where('account_id', $accountId)->count(),
            'images' => QuickReplyImage::query()
                ->whereHas('quickReply', fn (Builder $query) => $query->where('account_id', $accountId))
                ->count(),
        ];
    }

    private function emptyStats(): array
    {
        return [
            'topics' => 0,
            'replies' => 0,
            'active_replies' => 0,
            'trashed_replies' => 0,
            'images' => 0,
        ];
    }

    private function replyPayload(QuickReply $reply): array
    {
        $contents = $this->replyContentPayloads($reply);
        $images = collect($contents)
            ->flatMap(fn (array $content) => $content['images'] ?? [])
            ->values()
            ->all();

        return [
            'id' => (int) $reply->id,
            'account_id' => (int) $reply->account_id,
            'topic_id' => $reply->topic_id ? (int) $reply->topic_id : null,
            'topic' => $reply->relationLoaded('topic') && $reply->topic ? $this->topicPayload($reply->topic) : null,
            'shortcut' => $reply->shortcut,
            'title' => $reply->title,
            'body' => $reply->body,
            'content' => $reply->body,
            'tags' => $reply->tags ?: [],
            'contents' => $contents,
            'content_count' => count($contents),
            'images' => $images,
            'sort_order' => (int) $reply->sort_order,
            'use_count' => (int) $reply->use_count,
            'is_active' => (bool) $reply->is_active,
            'is_trashed' => $reply->trashed(),
            'last_used_at' => optional($reply->last_used_at)->toIso8601String(),
            'deleted_at' => optional($reply->deleted_at)->toIso8601String(),
            'created_at' => optional($reply->created_at)->toIso8601String(),
            'updated_at' => optional($reply->updated_at)->toIso8601String(),
        ];
    }

    private function replyContentPayloads(QuickReply $reply): array
    {
        $reply->loadMissing(['contents.images', 'images']);

        $contents = $reply->contents
            ->map(fn (QuickReplyContent $content) => [
                'id' => (int) $content->id,
                'body' => $content->body,
                'content' => $content->body,
                'images' => $content->images->map(fn (QuickReplyImage $image) => $this->imagePayload($image))->values()->all(),
                'position' => (int) $content->position,
                'is_active' => (bool) $content->is_active,
            ])
            ->filter(fn (array $content) => trim((string) $content['body']) !== '' || $content['images'] !== [])
            ->values();

        if ($contents->isNotEmpty()) {
            return $contents->all();
        }

        $legacyImages = $reply->images
            ->map(fn (QuickReplyImage $image) => $this->imagePayload($image))
            ->values()
            ->all();

        if (trim((string) $reply->body) === '' && $legacyImages === []) {
            return [];
        }

        return [[
            'id' => null,
            'body' => $reply->body,
            'content' => $reply->body,
            'images' => $legacyImages,
            'position' => 0,
            'is_active' => true,
        ]];
    }

    private function topicPayload(QuickReplyTopic $topic): array
    {
        return [
            'id' => (int) $topic->id,
            'account_id' => (int) $topic->account_id,
            'name' => $topic->name,
            'slug' => $topic->slug,
            'color' => $topic->color,
            'sort_order' => (int) $topic->sort_order,
            'is_active' => (bool) $topic->is_active,
            'replies_count' => (int) ($topic->replies_count ?? 0),
        ];
    }

    private function imagePayload(QuickReplyImage $image): array
    {
        return [
            'id' => (int) $image->id,
            'quick_reply_content_id' => $image->quick_reply_content_id ? (int) $image->quick_reply_content_id : null,
            'media_asset_id' => $image->media_asset_id ? (int) $image->media_asset_id : null,
            'url' => $image->url,
            'image_url' => $image->url,
            'thumbnail_url' => $image->thumbnail_url,
            'medium_url' => $image->medium_url,
            'large_url' => $image->large_url ?: $image->url,
            'original_url' => $image->original_url,
            'width' => $image->width,
            'height' => $image->height,
            'sort_order' => (int) $image->sort_order,
            'metadata' => $image->metadata ?: [],
        ];
    }

    private function nullableString($value): ?string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private function accountId(Request $request): ?int
    {
        $headerAccountId = $request->header('X-Account-Id');
        if (is_numeric($headerAccountId) && (int) $headerAccountId > 0) {
            return (int) $headerAccountId;
        }

        $user = $request->user();
        if ($user) {
            $accountId = $user->accounts()->orderBy('accounts.id')->value('accounts.id');
            if ($accountId) {
                return (int) $accountId;
            }

            if ($user->is_admin) {
                return Account::query()->orderBy('id')->value('id');
            }
        }

        return null;
    }
}
