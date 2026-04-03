<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MediaAsset;
use App\Services\MediaService;
use Illuminate\Http\Request;

class MediaAssetController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function show(Request $request, string $publicId, string $variant = 'large')
    {
        $asset = MediaAsset::query()->where('public_id', $publicId)->firstOrFail();

        return $this->mediaService->stream($asset, $variant);
    }
}
