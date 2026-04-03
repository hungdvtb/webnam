<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MediaService;
use Illuminate\Http\Request;

class MediaController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function proxy(Request $request)
    {
        $validated = $request->validate([
            'url' => 'required|string|max:2048',
        ]);

        $normalized = $this->mediaService->normalizeLegacyUrl($validated['url']);
        if ($normalized === '') {
            return response()->json(['message' => 'Invalid image path'], 422);
        }

        return redirect()->away($normalized, 302, [
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    public function upload(Request $request)
    {
        $request->validate([
            'image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,svg|max:10240',
            'images' => 'nullable|array',
            'images.*' => 'file|mimes:jpeg,png,jpg,gif,webp,avif,svg|max:10240',
            'collection' => 'nullable|string|max:80',
        ]);

        $collection = trim((string) $request->input('collection', 'editor')) ?: 'editor';
        $files = [];

        if ($request->hasFile('image')) {
            $files[] = $request->file('image');
        }

        if ($request->hasFile('images')) {
            $files = array_merge($files, $request->file('images'));
        }

        if (empty($files)) {
            return response()->json(['success' => false, 'message' => 'No image uploaded'], 400);
        }

        $assets = $this->mediaService->uploadImages($files, [
            'collection' => $collection,
            'source' => 'media-api-upload',
        ]);

        $payload = array_map(
            fn ($asset) => $this->mediaService->buildAssetPayload($asset),
            $assets
        );

        if (count($payload) === 1) {
            return response()->json([
                'success' => true,
                'url' => $payload[0]['large_url'] ?? $payload[0]['url'] ?? '',
                'image' => $payload[0],
            ]);
        }

        return response()->json([
            'success' => true,
            'images' => $payload,
        ]);
    }
}
