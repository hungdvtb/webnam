<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\MediaAsset;
use App\Models\QuickReplyGalleryImage;
use App\Models\QuickReplyImageFolder;
use App\Services\MediaService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\Process\Process;

class QuickReplyGalleryController extends Controller
{
    public function __construct(
        private MediaService $mediaService
    ) {
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json([
                'folders' => [],
                'images' => [
                    'data' => [],
                    'total' => 0,
                    'current_page' => 1,
                    'last_page' => 1,
                    'per_page' => 60,
                ],
                'stats' => $this->emptyStats(),
            ]);
        }

        $folders = QuickReplyImageFolder::query()
            ->where('account_id', $accountId)
            ->withCount(['images as images_count' => fn (Builder $query) => $query->where('account_id', $accountId)])
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->get()
            ->map(fn (QuickReplyImageFolder $folder) => $this->folderPayload($folder))
            ->values();

        $query = QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->with(['folder', 'mediaAsset']);

        $this->applyFilters($query, $request);

        if ((string) $request->query('folder_id', 'all') === 'recent') {
            $query->orderByDesc('created_at')->orderByDesc('id');
        } else {
            $query->orderBy('sort_order')->orderByDesc('created_at')->orderByDesc('id');
        }

        $perPage = min(max((int) $request->query('per_page', 60), 1), 120);
        $paginator = $query->paginate($perPage);
        $paginator->setCollection(
            $paginator->getCollection()
                ->map(fn (QuickReplyGalleryImage $image) => $this->imagePayload($image))
        );

        return response()->json([
            'folders' => $folders,
            'images' => $paginator,
            'stats' => $this->stats($accountId),
        ]);
    }

    public function storeFolder(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để tạo thư mục ảnh.'], 400);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:140'],
        ], [
            'name.required' => 'Nhập tên thư mục ảnh.',
        ]);

        $folder = QuickReplyImageFolder::query()->create([
            'account_id' => $accountId,
            'name' => trim((string) $validated['name']),
            'sort_order' => $this->nextFolderSortOrder($accountId),
            'is_active' => true,
        ]);

        return response()->json([
            'message' => 'Đã tạo thư mục ảnh.',
            'folder' => $this->folderPayload($folder->loadCount('images')),
        ], 201);
    }

    public function updateFolder(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $folder = QuickReplyImageFolder::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:140'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('name', $validated)) {
            $folder->name = trim((string) $validated['name']);
        }
        if (array_key_exists('is_active', $validated)) {
            $folder->is_active = (bool) $validated['is_active'];
        }
        $folder->save();

        return response()->json([
            'message' => 'Đã cập nhật thư mục ảnh.',
            'folder' => $this->folderPayload($folder->loadCount('images')),
        ]);
    }

    public function destroyFolder(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $folder = QuickReplyImageFolder::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->where('folder_id', $folder->id)
            ->update(['folder_id' => null]);

        $folder->delete();

        return response()->json(['message' => 'Đã xóa thư mục. Ảnh trong thư mục vẫn được giữ lại.']);
    }

    public function uploadImages(Request $request)
    {
        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để tải ảnh lên kho.'], 400);
        }

        $validated = $request->validate([
            'folder_id' => [
                'nullable',
                'integer',
                Rule::exists('quick_reply_image_folders', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'image' => ['nullable', 'file', 'mimes:jpeg,png,jpg,gif,webp,avif,svg', 'max:10240'],
            'images' => ['nullable', 'array', 'max:60'],
            'images.*' => ['file', 'mimes:jpeg,png,jpg,gif,webp,avif,svg', 'max:10240'],
        ], [
            'image.mimes' => 'Chỉ tải lên file ảnh JPEG, PNG, GIF, WEBP, AVIF hoặc SVG.',
            'images.*.mimes' => 'Có file không phải ảnh hợp lệ.',
            'images.max' => 'Mỗi lần chỉ tải lên tối đa 60 ảnh.',
        ]);

        $files = [];
        if ($request->hasFile('image')) {
            $files[] = $request->file('image');
        }
        if ($request->hasFile('images')) {
            $files = array_merge($files, $request->file('images'));
        }

        if ($files === []) {
            return response()->json(['message' => 'Chọn ít nhất một ảnh để tải lên kho.'], 422);
        }

        $folderId = isset($validated['folder_id']) ? (int) $validated['folder_id'] : null;
        $assets = $this->mediaService->uploadImages($files, [
            'collection' => 'quick-reply-gallery',
            'source' => 'quick-reply-gallery',
        ]);

        $nextSortOrder = $this->nextImageSortOrder($accountId, $folderId);
        $images = [];

        foreach ($assets as $asset) {
            $name = trim((string) ($asset->original_name ?: 'Ảnh ' . ($nextSortOrder + 1)));
            $image = QuickReplyGalleryImage::query()->create([
                'account_id' => $accountId,
                'folder_id' => $folderId,
                'media_asset_id' => $asset->id,
                'name' => $name,
                'search_text' => $this->buildImageSearchText($name, $asset),
                'sort_order' => $nextSortOrder++,
                'use_count' => 0,
                'is_favorite' => false,
                'metadata' => [
                    'original_name' => $asset->original_name,
                    'public_id' => $asset->public_id,
                ],
            ]);

            $images[] = $this->imagePayload($image->load(['folder', 'mediaAsset']));
        }

        return response()->json([
            'message' => 'Đã tải ' . count($images) . ' ảnh vào kho.',
            'created_count' => count($images),
            'images' => $images,
        ], 201);
    }

    public function updateImage(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $image = QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->with(['mediaAsset'])
            ->findOrFail($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'folder_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('quick_reply_image_folders', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'is_favorite' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('name', $validated)) {
            $image->name = trim((string) $validated['name']);
        }
        if (array_key_exists('folder_id', $validated)) {
            $image->folder_id = $validated['folder_id'] ? (int) $validated['folder_id'] : null;
        }
        if (array_key_exists('is_favorite', $validated)) {
            $image->is_favorite = (bool) $validated['is_favorite'];
        }

        $image->search_text = $this->buildImageSearchText($image->name, $image->mediaAsset);
        $image->save();

        return response()->json([
            'message' => 'Đã cập nhật ảnh.',
            'image' => $this->imagePayload($image->refresh()->load(['folder', 'mediaAsset'])),
        ]);
    }

    public function destroyImage(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $image = QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->findOrFail($id);

        $image->delete();

        return response()->json(['message' => 'Đã xóa ảnh khỏi kho.']);
    }

    public function copyImages(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json(['message' => 'Copy nhiều ảnh một lần chỉ hỗ trợ khi backend đang chạy trên Windows.'], 422);
        }

        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để copy ảnh.'], 400);
        }

        $images = $this->selectedImages($request, $accountId);

        try {
            $this->pruneTempDirectories();
            $paths = $this->exportImagesForClipboard($images);
            $this->setWindowsClipboardFileDropList($paths);
            $this->recordImageUse($images);

            return response()->json([
                'message' => 'Đã copy ' . count($paths) . ' ảnh. Sang Zalo bấm Ctrl+V để dán cùng lúc.',
                'copied_images' => count($paths),
            ]);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    public function sendImagesToZalo(Request $request)
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return response()->json(['message' => 'Gửi ảnh trực tiếp sang Zalo chỉ hỗ trợ khi backend đang chạy trên Windows.'], 422);
        }

        $accountId = $this->accountId($request);
        if (!$accountId) {
            return response()->json(['message' => 'Chưa chọn cửa hàng để gửi ảnh.'], 400);
        }

        $images = $this->selectedImages($request, $accountId);

        try {
            $this->pruneTempDirectories();
            $paths = $this->exportImagesForClipboard($images);
            $this->sendImagePathsToOpenZaloChat($paths, $this->zaloTarget($request));
            $this->recordImageUse($images);

            return response()->json([
                'message' => 'Đã gửi ' . count($paths) . ' ảnh sang chat Zalo đang mở.',
                'sent_images' => count($paths),
            ]);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }
    }

    private function applyFilters(Builder $query, Request $request): void
    {
        $folderId = (string) $request->query('folder_id', 'all');
        if ($folderId === 'favorite') {
            $query->where('is_favorite', true);
        } elseif (is_numeric($folderId) && (int) $folderId > 0) {
            $query->where('folder_id', (int) $folderId);
        }

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $like = '%' . Str::lower($search) . '%';
            $asciiLike = '%' . $this->normalizeSearchText($search) . '%';
            $query->where(function (Builder $searchQuery) use ($like, $asciiLike) {
                $searchQuery
                    ->whereRaw('LOWER(name) LIKE ?', [$like])
                    ->orWhere('search_text', 'like', $asciiLike);
            });
        }
    }

    private function selectedImages(Request $request, int $accountId)
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:60'],
            'ids.*' => ['required', 'integer', 'distinct'],
        ], [
            'ids.required' => 'Chọn ít nhất một ảnh.',
            'ids.min' => 'Chọn ít nhất một ảnh.',
            'ids.max' => 'Mỗi lần chỉ chọn tối đa 60 ảnh.',
        ]);

        $ids = collect($validated['ids'])
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values();

        $imagesById = QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->whereIn('id', $ids)
            ->with(['mediaAsset'])
            ->get()
            ->keyBy('id');

        $images = $ids
            ->map(fn (int $id) => $imagesById->get($id))
            ->filter()
            ->values();

        if ($images->isEmpty()) {
            throw ValidationException::withMessages([
                'ids' => 'Không tìm thấy ảnh đã chọn trong kho.',
            ]);
        }

        return $images;
    }

    private function exportImagesForClipboard($images): array
    {
        $directory = storage_path(
            'app/quick-reply-clipboard/'
            . now()->format('Ymd-His')
            . '-gallery-' . Str::lower(Str::random(6))
        );
        File::ensureDirectoryExists($directory);

        $paths = [];
        foreach ($images->values() as $index => $image) {
            [$contents, $extension, $mimeType] = $this->imageBinary($image);
            $extension = $this->clipboardImageExtension($extension, $mimeType);
            $path = $directory . DIRECTORY_SEPARATOR . $this->clipboardImageFileName($image, $index, $extension);

            File::put($path, $contents);

            if (!is_file($path) || filesize($path) <= 0) {
                throw new RuntimeException('Không tạo được file ảnh tạm để gửi.');
            }

            $paths[] = $path;
        }

        return $paths;
    }

    private function imageBinary(QuickReplyGalleryImage $image): array
    {
        $asset = $image->relationLoaded('mediaAsset') ? $image->mediaAsset : null;
        if (!$asset && $image->media_asset_id) {
            $asset = MediaAsset::query()->find($image->media_asset_id);
        }

        if (!$asset) {
            throw new RuntimeException('Ảnh "' . $image->name . '" đang thiếu file gốc.');
        }

        $descriptor = $this->mediaService->resolveVariantDescriptor($asset, 'large', true)
            ?? $this->mediaService->resolveVariantDescriptor($asset, 'original', true);

        if ($descriptor === null) {
            throw new RuntimeException('Không tìm thấy dữ liệu ảnh "' . $image->name . '".');
        }

        $path = ltrim((string) ($descriptor['path'] ?? ''), '/');
        if ($path === '') {
            throw new RuntimeException('Ảnh "' . $image->name . '" đang thiếu đường dẫn file.');
        }

        $disk = Storage::disk($asset->disk ?: config('media.disk', 'r2'));
        $contents = $disk->get($path);
        if (!is_string($contents) || $contents === '') {
            throw new RuntimeException('Không đọc được file ảnh "' . $image->name . '".');
        }

        return [
            $contents,
            $descriptor['extension'] ?? $asset->original_extension,
            $descriptor['mime'] ?? $asset->mime_type,
        ];
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

    private function clipboardImageFileName(QuickReplyGalleryImage $image, int $index, string $extension): string
    {
        $base = Str::slug($image->name ?: 'anh-kho');
        if ($base === '') {
            $base = 'gallery-image';
        }

        return sprintf('%02d-%s.%s', $index + 1, Str::limit($base, 70, ''), $extension);
    }

    private function setWindowsClipboardFileDropList(array $paths): void
    {
        $paths = array_values(array_filter($paths, fn (string $path) => is_file($path)));
        if ($paths === []) {
            throw new RuntimeException('Không có file ảnh hợp lệ để copy.');
        }

        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'set_gallery_clipboard_files.py';
        $pathsPath = $root . DIRECTORY_SEPARATOR . 'gallery-paths-' . Str::lower(Str::random(12)) . '.json';
        File::put($scriptPath, $this->windowsClipboardPythonScript());
        File::put($pathsPath, json_encode($paths, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

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
                ? 'Không set được clipboard Windows: ' . $output
                : 'Không set được clipboard Windows. Kiểm tra Python trên máy.');
        }
    }

    private function sendImagePathsToOpenZaloChat(array $paths, string $zaloTarget = 'pc'): void
    {
        $paths = array_values(array_filter($paths, fn (string $path) => is_file($path)));
        if ($paths === []) {
            throw new RuntimeException('Không có ảnh hợp lệ để gửi sang Zalo.');
        }

        $this->setWindowsClipboardFileDropList($paths);

        $root = storage_path('app/quick-reply-clipboard');
        File::ensureDirectoryExists($root);

        $scriptPath = $root . DIRECTORY_SEPARATOR . 'send_gallery_images_to_zalo.py';
        $payloadPath = $root . DIRECTORY_SEPARATOR . 'send-gallery-images-' . Str::lower(Str::random(12)) . '.json';
        $pasteDelayMs = (int) env('QUICK_REPLY_ZALO_IMAGE_PASTE_DELAY_MS', $zaloTarget === 'web' ? 2400 : 1600);
        File::put($scriptPath, $this->zaloPastePythonScript());
        File::put($payloadPath, json_encode([
            'zalo_target' => $zaloTarget,
            'window_keywords' => $this->zaloWindowKeywords($zaloTarget),
            'paste_delay_ms' => $pasteDelayMs,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

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
                ? 'Không gửi được ảnh sang Zalo: ' . $output
                : 'Không gửi được ảnh sang Zalo. Hãy mở đúng cửa sổ chat Zalo rồi thử lại.');
        }
    }

    private function recordImageUse($images): void
    {
        foreach ($images as $image) {
            $image->forceFill([
                'use_count' => ((int) $image->use_count) + 1,
                'last_used_at' => now(),
            ])->save();
        }
    }

    private function stats(int $accountId): array
    {
        return [
            'folders' => QuickReplyImageFolder::query()->where('account_id', $accountId)->count(),
            'images' => QuickReplyGalleryImage::query()->where('account_id', $accountId)->count(),
            'favorite_images' => QuickReplyGalleryImage::query()->where('account_id', $accountId)->where('is_favorite', true)->count(),
        ];
    }

    private function emptyStats(): array
    {
        return [
            'folders' => 0,
            'images' => 0,
            'favorite_images' => 0,
        ];
    }

    private function folderPayload(QuickReplyImageFolder $folder): array
    {
        return [
            'id' => (int) $folder->id,
            'account_id' => (int) $folder->account_id,
            'name' => $folder->name,
            'images_count' => (int) ($folder->images_count ?? 0),
            'sort_order' => (int) $folder->sort_order,
            'is_active' => (bool) $folder->is_active,
            'created_at' => optional($folder->created_at)->toIso8601String(),
            'updated_at' => optional($folder->updated_at)->toIso8601String(),
        ];
    }

    private function imagePayload(QuickReplyGalleryImage $image): array
    {
        $asset = $image->relationLoaded('mediaAsset') ? $image->mediaAsset : null;
        $assetPayload = $this->mediaService->buildAssetPayload($asset) ?: [];

        return [
            'id' => (int) $image->id,
            'account_id' => (int) $image->account_id,
            'folder_id' => $image->folder_id ? (int) $image->folder_id : null,
            'folder' => $image->relationLoaded('folder') && $image->folder ? $this->folderPayload($image->folder) : null,
            'media_asset_id' => $image->media_asset_id ? (int) $image->media_asset_id : null,
            'name' => $image->name,
            'url' => $assetPayload['url'] ?? '',
            'image_url' => $assetPayload['image_url'] ?? '',
            'thumbnail_url' => $assetPayload['thumbnail_url'] ?? '',
            'medium_url' => $assetPayload['medium_url'] ?? '',
            'large_url' => $assetPayload['large_url'] ?? '',
            'original_url' => $assetPayload['original_url'] ?? '',
            'width' => $assetPayload['width'] ?? null,
            'height' => $assetPayload['height'] ?? null,
            'srcset' => $assetPayload['srcset'] ?? '',
            'is_favorite' => (bool) $image->is_favorite,
            'use_count' => (int) $image->use_count,
            'last_used_at' => optional($image->last_used_at)->toIso8601String(),
            'created_at' => optional($image->created_at)->toIso8601String(),
            'updated_at' => optional($image->updated_at)->toIso8601String(),
        ];
    }

    private function buildImageSearchText(string $name, ?MediaAsset $asset): string
    {
        return $this->normalizeSearchText(trim(implode(' ', array_filter([
            $name,
            $asset?->original_name,
            $asset?->public_id,
        ]))));
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

    private function nextFolderSortOrder(int $accountId): int
    {
        return ((int) QuickReplyImageFolder::query()->where('account_id', $accountId)->max('sort_order')) + 1;
    }

    private function nextImageSortOrder(int $accountId, ?int $folderId = null): int
    {
        return ((int) QuickReplyGalleryImage::query()
            ->where('account_id', $accountId)
            ->when($folderId, fn (Builder $query) => $query->where('folder_id', $folderId))
            ->max('sort_order')) + 1;
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

    private function pruneTempDirectories(): void
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


def payload_delay_ms(payload, key, default_value, minimum_value=0):
    try:
        delay = int(payload.get(key, default_value) or default_value)
    except Exception:
        delay = default_value
    return max(delay, minimum_value)


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
        raise RuntimeError("Usage: set_gallery_clipboard_files.py <paths.json>")

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

    private function zaloPastePythonScript(): string
    {
        return <<<'PYTHON'
import ctypes
import json
import sys
import time
from ctypes import wintypes

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SW_RESTORE = 9
KEYEVENTF_KEYUP = 0x0002
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
VK_CONTROL = 0x11
VK_RETURN = 0x0D
VK_MENU = 0x12
VK_V = 0x56

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


IsWindowVisible = user32.IsWindowVisible
IsWindowVisible.argtypes = [wintypes.HWND]
IsWindowVisible.restype = wintypes.BOOL

GetWindowTextLengthW = user32.GetWindowTextLengthW
GetWindowTextLengthW.argtypes = [wintypes.HWND]
GetWindowTextLengthW.restype = ctypes.c_int

GetWindowTextW = user32.GetWindowTextW
GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
GetWindowTextW.restype = ctypes.c_int

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


def window_title(hwnd):
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
    needles = [str(item).lower() for item in keywords if str(item).strip()]
    target_web = wants_web_target(target)
    if not needles:
        needles = ["zalo"] if not target_web else ["zalo - google chrome", "my z.com - google chrome", "chat.zalo.me", "web.zalo.me"]

    matches = []
    fallback = []

    @EnumWindowsProc
    def callback(hwnd, _):
        if not IsWindowVisible(hwnd):
            return True
        title = window_title(hwnd)
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

    user32.EnumWindows(callback, 0)
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


def key_down(key):
    keybd_event(key, 0, 0, 0)


def key_up(key):
    keybd_event(key, 0, KEYEVENTF_KEYUP, 0)


def tap_key(key):
    key_down(key)
    time.sleep(0.03)
    key_up(key)


def ctrl_v():
    key_down(VK_CONTROL)
    time.sleep(0.03)
    key_down(VK_V)
    time.sleep(0.03)
    key_up(VK_V)
    time.sleep(0.03)
    key_up(VK_CONTROL)


def payload_delay_ms(payload, key, default_value, minimum_value=0):
    try:
        delay = int(payload.get(key, default_value) or default_value)
    except Exception:
        delay = default_value
    return max(delay, minimum_value)


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: send_gallery_images_to_zalo.py <payload.json>")

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    target = payload.get("zalo_target") or payload.get("target") or "pc"
    hwnd, title = find_zalo_window(payload.get("window_keywords") or ["Zalo"], target)
    target = effective_zalo_target(target, title)
    focus_window(hwnd, title)
    click_chat_input(hwnd, target)
    ctrl_v()
    web_target = wants_web_target(target)
    paste_delay_ms = payload_delay_ms(payload, "paste_delay_ms", 2400 if web_target else 1600, 2400 if web_target else 200)
    time.sleep(paste_delay_ms / 1000)
    tap_key(VK_RETURN)
    print(json.dumps({"window": title, "zalo_target": target}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
PYTHON;
    }}
