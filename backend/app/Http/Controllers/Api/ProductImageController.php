<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SyncGoogleMerchantProductJob;
use App\Models\Product;
use App\Models\ProductImage;
use App\Services\GoogleMerchant\GoogleMerchantSettingsService;
use App\Services\ProductImageBulkAppendService;
use App\Services\MediaService;
use App\Services\ProductImageRefreshService;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProductImageController extends Controller
{
    public function __construct(
        protected MediaService $mediaService,
        protected ProductImageRefreshService $productImageRefreshService,
        protected ProductImageBulkAppendService $productImageBulkAppendService
    ) {
    }

    private function queueGoogleMerchantProductSync(int $productId): void
    {
        $product = Product::query()->find($productId);
        if (!$product || !app(GoogleMerchantSettingsService::class)->enabledForAccount((int) $product->account_id ?: null)) {
            return;
        }

        SyncGoogleMerchantProductJob::dispatch($productId)->afterResponse();
    }

    private function queueGoogleMerchantProductSyncForIds(iterable $productIds): void
    {
        collect($productIds)
            ->map(fn ($productId) => (int) $productId)
            ->filter()
            ->unique()
            ->each(fn (int $productId) => $this->queueGoogleMerchantProductSync($productId));
    }

    /**
     * Upload images to R2 and associate with a product
     */
    public function store(Request $request, $productId)
    {
        @set_time_limit(120);

        $request->validate([
            'images' => 'required',
            'images.*' => 'image|mimes:jpeg,png,jpg,gif,webp|max:5120', // 5MB max each
        ]);

        $product = Product::findOrFail($productId);
        $uploadedImages = [];
        $nextSortOrder = (int) $product->images()->count();
        $shouldMarkPrimary = $nextSortOrder === 0;

        if ($request->hasFile('images')) {
            foreach ($request->file('images') as $file) {
                $asset = $this->mediaService->uploadImage($file, [
                    'collection' => 'products',
                    'source' => 'product-gallery-upload',
                ]);
                $image = ProductImage::create([
                    'product_id' => $productId,
                    'media_asset_id' => $asset->id,
                    'image_url' => $this->mediaService->buildAssetUrl($asset, 'large'),
                    'file_name' => $file->getClientOriginalName(),
                    'file_size' => $file->getSize(),
                    'is_primary' => $shouldMarkPrimary,
                    'sort_order' => $nextSortOrder,
                ])->load('mediaAsset');

                $uploadedImages[] = $image;
                $shouldMarkPrimary = false;
                $nextSortOrder++;
            }
        }

        $this->syncPrimaryImageForProduct((int) $productId);
        $this->queueGoogleMerchantProductSync((int) $productId);

        return response()->json($uploadedImages, 201);
    }

    public function syncProductImages(Request $request, $productId)
    {
        @set_time_limit(120);

        $request->validate([
            'sync_images' => 'nullable|boolean',
            'image_order' => 'nullable|array',
            'image_order.*' => 'nullable|string|max:80',
            'primary_image_token' => 'nullable|string|max:80',
            'images' => 'nullable|array',
            'images.*' => 'image|mimes:jpeg,png,jpg,gif,webp|max:5120',
        ]);

        $product = Product::query()->findOrFail($productId);
        $this->syncSubmittedProductImages($request, $product);

        $images = $product->images()
            ->get(['id', 'product_id', 'media_asset_id', 'image_url', 'is_primary', 'sort_order', 'file_name', 'file_size']);
        $this->queueGoogleMerchantProductSync((int) $product->id);

        return response()->json([
            'message' => 'Images synced successfully.',
            'images' => $images,
        ]);
    }

    public function bulkRefreshPreview(Request $request)
    {
        @set_time_limit(120);

        $validated = $request->validate([
            'images' => 'required|array|min:1',
            'images.*' => 'required|file|image|mimes:jpeg,png,jpg,gif,webp,avif|max:10240',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'integer|exists:products,id',
            'scope_selected_only' => 'nullable|boolean',
            'update_all_matches' => 'nullable|boolean',
        ]);

        $files = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof UploadedFile
        ));

        return response()->json(
            $this->productImageRefreshService->preview($files, [
                'product_ids' => $validated['product_ids'] ?? [],
                'scope_selected_only' => (bool) ($validated['scope_selected_only'] ?? false),
                'update_all_matches' => (bool) ($validated['update_all_matches'] ?? false),
            ])
        );
    }

    public function bulkRefreshApply(Request $request)
    {
        @set_time_limit(120);

        $validated = $request->validate([
            'images' => 'required|array|min:1',
            'images.*' => 'required|file|image|mimes:jpeg,png,jpg,gif,webp,avif|max:10240',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'integer|exists:products,id',
            'scope_selected_only' => 'nullable|boolean',
            'update_all_matches' => 'nullable|boolean',
        ]);

        $files = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof UploadedFile
        ));

        return response()->json(
            tap($this->productImageRefreshService->apply($files, [
                'product_ids' => $validated['product_ids'] ?? [],
                'scope_selected_only' => (bool) ($validated['scope_selected_only'] ?? false),
                'update_all_matches' => (bool) ($validated['update_all_matches'] ?? false),
            ]), function (array $result) {
                $this->queueGoogleMerchantProductSyncForIds($result['updated_product_ids'] ?? $result['changed_product_ids'] ?? $result['product_ids'] ?? []);
            })
        );
    }

    public function bulkAppendPreview(Request $request)
    {
        @set_time_limit(120);

        $validated = $request->validate([
            'images' => 'required|array|min:1',
            'images.*' => 'required|file|image|mimes:jpeg,png,jpg,gif,webp,avif|max:10240',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'integer|exists:products,id',
            'scope_selected_only' => 'nullable|boolean',
            'insertion_mode' => 'required|string|in:start,after_index,end',
            'after_index' => 'nullable|integer|min:1',
            'preview_limit' => 'nullable|integer|min:1|max:100',
        ]);

        $files = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof UploadedFile
        ));

        return response()->json(
            $this->productImageBulkAppendService->preview($files, [
                'product_ids' => $validated['product_ids'] ?? [],
                'scope_selected_only' => (bool) ($validated['scope_selected_only'] ?? false),
                'insertion_mode' => $validated['insertion_mode'],
                'after_index' => $validated['after_index'] ?? null,
                'preview_limit' => $validated['preview_limit'] ?? null,
            ])
        );
    }

    public function bulkAppendApply(Request $request)
    {
        @set_time_limit(120);

        $validated = $request->validate([
            'images' => 'required|array|min:1',
            'images.*' => 'required|file|image|mimes:jpeg,png,jpg,gif,webp,avif|max:10240',
            'product_ids' => 'nullable|array',
            'product_ids.*' => 'integer|exists:products,id',
            'scope_selected_only' => 'nullable|boolean',
            'insertion_mode' => 'required|string|in:start,after_index,end',
            'after_index' => 'nullable|integer|min:1',
            'preview_limit' => 'nullable|integer|min:1|max:100',
        ]);

        $files = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof UploadedFile
        ));

        return response()->json(
            tap($this->productImageBulkAppendService->apply($files, [
                'product_ids' => $validated['product_ids'] ?? [],
                'scope_selected_only' => (bool) ($validated['scope_selected_only'] ?? false),
                'insertion_mode' => $validated['insertion_mode'],
                'after_index' => $validated['after_index'] ?? null,
                'preview_limit' => $validated['preview_limit'] ?? null,
            ]), function (array $result) {
                $this->queueGoogleMerchantProductSyncForIds($result['applied_product_ids'] ?? $result['changed_product_ids'] ?? $result['product_ids'] ?? []);
            })
        );
    }

    /**
     * Set an image as primary (main)
     */
    public function setPrimary($id)
    {
        $image = ProductImage::findOrFail($id);

        DB::transaction(function () use ($image): void {
            ProductImage::where('product_id', $image->product_id)
                ->where('id', '!=', $image->id)
                ->update(['is_primary' => false]);

            $image->update(['is_primary' => true]);

            $this->syncPrimaryImageForProduct((int) $image->product_id, (int) $image->id);
        });
        $this->queueGoogleMerchantProductSync((int) $image->product_id);
        
        return response()->json(['message' => 'Image set as primary.']);
    }

    /**
     * Delete an image from DB and R2
     */
    public function destroy($id)
    {
        $image = ProductImage::findOrFail($id);
        $productId = (int) $image->product_id;
        $wasPrimary = (bool) $image->is_primary;
        $image->delete();

        if ($wasPrimary) {
            $this->syncPrimaryImageForProduct($productId);
        }
        $this->queueGoogleMerchantProductSync($productId);

        return response()->json(['message' => 'Image deleted successfully.']);
    }

    public function reorder(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:product_images,id'
        ]);

        $orderedIds = collect($request->ids)
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->values();

        $affectedProductIds = ProductImage::query()
            ->whereIn('id', $orderedIds)
            ->pluck('product_id')
            ->map(fn ($productId) => (int) $productId)
            ->unique()
            ->values();

        foreach ($orderedIds as $index => $id) {
            ProductImage::where('id', $id)->update([
                'sort_order' => $index,
            ]);
        }

        foreach ($affectedProductIds as $productId) {
            $this->syncPrimaryImageForProduct($productId);
        }
        $this->queueGoogleMerchantProductSyncForIds($affectedProductIds);

        return response()->json(['message' => 'Images reordered successfully.']);
    }

    private function syncSubmittedProductImages(Request $request, Product $product): void
    {
        $orderedTokens = collect((array) $request->input('image_order', []))
            ->map(fn ($token) => trim((string) $token))
            ->filter()
            ->values();

        $uploadedFiles = array_values(array_filter(
            (array) $request->file('images', []),
            fn ($file) => $file instanceof UploadedFile
        ));

        $existingImages = $product->images()->get()->keyBy(fn (ProductImage $image) => (int) $image->id);
        $orderedEntries = [];
        $keptExistingIds = [];
        $usedNewIndexes = [];

        foreach ($orderedTokens as $token) {
            if (str_starts_with($token, 'existing:')) {
                $imageId = (int) substr($token, strlen('existing:'));
                $existingImage = $existingImages->get($imageId);

                if (!$existingImage || in_array($imageId, $keptExistingIds, true)) {
                    continue;
                }

                $keptExistingIds[] = $imageId;
                $orderedEntries[] = [
                    'type' => 'existing',
                    'token' => $token,
                    'image' => $existingImage,
                ];
                continue;
            }

            if (str_starts_with($token, 'new:')) {
                $newIndex = (int) substr($token, strlen('new:'));
                if (isset($usedNewIndexes[$newIndex]) || !isset($uploadedFiles[$newIndex])) {
                    continue;
                }

                $usedNewIndexes[$newIndex] = true;
                $orderedEntries[] = [
                    'type' => 'new',
                    'token' => $token,
                    'file' => $uploadedFiles[$newIndex],
                ];
            }
        }

        DB::transaction(function () use ($product, $existingImages, $orderedEntries, $keptExistingIds, $request): void {
            $imagesToDelete = $existingImages->filter(
                fn (ProductImage $image) => !in_array((int) $image->id, $keptExistingIds, true)
            );

            foreach ($imagesToDelete as $image) {
                $image->delete();
            }

            if (empty($orderedEntries)) {
                return;
            }

            $resolvedPrimaryToken = trim((string) $request->input('primary_image_token', ''));
            if ($resolvedPrimaryToken === '' || !collect($orderedEntries)->contains(fn ($entry) => $entry['token'] === $resolvedPrimaryToken)) {
                $resolvedPrimaryToken = $orderedEntries[0]['token'];
            }

            foreach ($orderedEntries as $sortOrder => $entry) {
                $isPrimary = $entry['token'] === $resolvedPrimaryToken;

                if ($entry['type'] === 'existing') {
                    /** @var ProductImage $existingImage */
                    $existingImage = $entry['image'];
                    if ((int) $existingImage->sort_order !== (int) $sortOrder || (bool) $existingImage->is_primary !== $isPrimary) {
                        $existingImage->forceFill([
                            'sort_order' => (int) $sortOrder,
                            'is_primary' => $isPrimary,
                        ])->save();
                    }
                    continue;
                }

                /** @var UploadedFile $imageFile */
                $imageFile = $entry['file'];
                $asset = $this->mediaService->uploadImage($imageFile, [
                    'collection' => 'products',
                    'source' => 'product-form-upload',
                ]);

                ProductImage::query()->create([
                    'product_id' => $product->id,
                    'media_asset_id' => $asset->id,
                    'image_url' => $this->mediaService->buildAssetUrl($asset, 'large'),
                    'file_name' => $imageFile->getClientOriginalName(),
                    'file_size' => $imageFile->getSize(),
                    'is_primary' => $isPrimary,
                    'sort_order' => (int) $sortOrder,
                ]);
            }
        });
    }

    private function syncPrimaryImageForProduct(int $productId, ?int $preferredImageId = null): void
    {
        $images = ProductImage::query()
            ->where('product_id', $productId)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'is_primary']);

        if ($images->isEmpty()) {
            return;
        }

        $targetImage = $preferredImageId
            ? $images->firstWhere('id', $preferredImageId)
            : null;

        if (!$targetImage) {
            $targetImage = $images->firstWhere('is_primary', true) ?: $images->first();
        }

        if (!$targetImage) {
            return;
        }

        ProductImage::query()
            ->where('product_id', $productId)
            ->where('id', '!=', $targetImage->id)
            ->where('is_primary', true)
            ->update(['is_primary' => false]);

        if (!$targetImage->is_primary) {
            ProductImage::query()
                ->whereKey($targetImage->id)
                ->update(['is_primary' => true]);
        }
    }

    /**
     * Generate or serve a lightweight cached 100x100 thumbnail to save bandwidth
     */
    public function thumbnail(Request $request)
    {
        $url = $request->query('url');
        if (!$url) return abort(404);

        // If it's an S3 URL, always redirect immediately to avoid local file path issues
        if (str_contains($url, 'amazonaws.com') || !str_contains($url, url('/storage'))) {
            return redirect($url);
        }

        // Graceful fallback if PHP GD extension is not available
        if (!function_exists('imagecreatefromjpeg')) {
            return redirect($url);
        }

        // Determine path from URL dynamically
        $path = str_replace(url('/storage') . '/', '', $url);
        $path = ltrim($path, '/');

        // Simple fallback if missing
        if (empty($path) || !Storage::disk('public')->exists($path)) {
            return redirect($url);
        }

        $fullPath = Storage::disk('public')->path($path);

        $thumbDir = storage_path('app/public/thumbs');
        if (!file_exists($thumbDir)) mkdir($thumbDir, 0755, true);

        $thumbPath = $thumbDir . '/' . md5($url) . '.webp';

        if (!file_exists($thumbPath)) {
            $info = @\getimagesize($fullPath);
            if (!$info) return redirect($url);

            $mime = $info['mime'];

            switch ($mime) {
                case 'image/jpeg': $img = @\imagecreatefromjpeg($fullPath); break;
                case 'image/png':  $img = @\imagecreatefrompng($fullPath);  break;
                case 'image/webp': $img = @\imagecreatefromwebp($fullPath); break;
                default: return redirect($url);
            }

            if (!$img) return redirect($url);

            $width  = $info[0];
            $height = $info[1];

            $newWidth  = 100;
            $newHeight = (int)($height * ($newWidth / $width));

            $thumb = \imagecreatetruecolor($newWidth, $newHeight);

            if ($mime == 'image/png' || $mime == 'image/webp') {
                \imagealphablending($thumb, false);
                \imagesavealpha($thumb, true);
                $transparent = \imagecolorallocatealpha($thumb, 255, 255, 255, 127);
                \imagefilledrectangle($thumb, 0, 0, $newWidth, $newHeight, $transparent);
            }

            \imagecopyresampled($thumb, $img, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

            // Quality 60 for low size target (10-40KB)
            \imagewebp($thumb, $thumbPath, 60);

            \imagedestroy($img);
            \imagedestroy($thumb);
        }

        return response()->file($thumbPath, [
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'Content-Type'  => 'image/webp'
        ]);
    }
}
