<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MediaAsset;
use App\Services\MediaService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Throwable;

class MediaAssetController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function show(Request $request, string $publicId, string $variant = 'large')
    {
        if (!preg_match('/^[0-9a-z]{26}$/', $publicId)) {
            abort(404);
        }

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

                try {
                    $exists = $disk->exists($path);
                } catch (Throwable $exception) {
                    if ($this->storageExceptionStatusCode($exception) === 404) {
                        continue;
                    }

                    report($exception);
                    abort(503, 'Media storage is temporarily unavailable.');
                }

                if ($exists) {
                    try {
                        $stream = $disk->readStream($path);
                    } catch (Throwable $exception) {
                        if ($this->storageExceptionStatusCode($exception) === 404) {
                            continue;
                        }

                        report($exception);
                        abort(503, 'Media storage is temporarily unavailable.');
                    }

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

    private function storageExceptionStatusCode(Throwable $exception): ?int
    {
        $current = $exception;

        while ($current) {
            if (method_exists($current, 'getStatusCode')) {
                $statusCode = $current->getStatusCode();

                if (is_numeric($statusCode)) {
                    return (int) $statusCode;
                }
            }

            $current = $current->getPrevious();
        }

        return null;
    }
}
