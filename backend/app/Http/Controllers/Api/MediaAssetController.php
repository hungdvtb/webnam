<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MediaAsset;
use App\Services\MediaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class MediaAssetController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function show(Request $request, string $publicId, string $variant = 'large')
    {
        $asset = MediaAsset::query()->where('public_id', $publicId)->first();

        if ($asset) {
            return $this->mediaService->stream($asset, $variant);
        }

        // Fallback: if the DB row is missing, stream from the managed media path.
        // Some imported blog images only have original.* generated, even when the
        // content still asks for /large.
        $disk = Storage::disk(config('media.disk', 'r2'));
        $extensions = ['jpg', 'png', 'webp', 'jpeg', 'gif', 'svg'];

        $variantNames = array_values(array_unique(array_filter([
            $variant,
            'original',
        ])));

        foreach ($variantNames as $variantName) {
            $basePath = 'media-assets/' . $publicId . '/' . $variantName;

            foreach ($extensions as $ext) {
                $path = $basePath . '.' . $ext;

                if ($disk->exists($path)) {
                    $stream = $disk->readStream($path);
                    if (is_resource($stream)) {
                        $mime = match ($ext) {
                            'png' => 'image/png',
                            'webp' => 'image/webp',
                            'gif' => 'image/gif',
                            'svg' => 'image/svg+xml',
                            default => 'image/jpeg',
                        };
                        return response()->stream(function () use ($stream) {
                            fpassthru($stream);
                            fclose($stream);
                        }, 200, array_filter([
                            'Content-Type' => $mime,
                            'Cache-Control' => 'public, max-age=31536000, immutable',
                        ]));
                    }
                }
            }
        }

        abort(404);
    }
}
