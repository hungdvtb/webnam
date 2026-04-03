<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Banner;
use App\Models\Account;
use App\Services\MediaService;
use Illuminate\Http\Request;

class BannerController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function index(Request $request)
    {
        $query = Banner::query()->with('mediaAsset')->orderBy('sort_order', 'asc');

        if ($request->has('site_code')) {
            $account = Account::where('site_code', $request->site_code)->first();
            if ($account) {
                $query->where('account_id', $account->id);
            }
        } elseif ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $query->where('account_id', $request->header('X-Account-Id'));
        }

        // Public see only active ones
        if (!$request->user() || !$request->header('X-Account-Id')) {
             $query->where('is_active', true);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'image_url' => 'nullable|string|max:2048',
            'image' => 'nullable|image|max:10240',
            'title' => 'nullable|string',
            'subtitle' => 'nullable|string',
            'link_url' => 'nullable|string',
            'button_text' => 'nullable|string',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ]);

        $asset = $request->hasFile('image')
            ? $this->mediaService->uploadImage($request->file('image'), [
                'collection' => 'banners',
                'source' => 'banner-form-upload',
            ])
            : $this->mediaService->importFromReference($validated['image_url'] ?? null, [
                'collection' => 'banners',
                'source' => 'banner-url-import',
            ]);

        if (!$asset) {
            return response()->json(['message' => 'Banner image is required.'], 422);
        }

        $banner = Banner::create(array_merge($validated, [
            'media_asset_id' => $asset->id,
            'image_url' => $this->mediaService->buildAssetUrl($asset, 'large'),
        ]));

        $banner->load('mediaAsset');
        return response()->json($banner, 201);
    }

    public function show($id)
    {
        return Banner::with('mediaAsset')->findOrFail($id);
    }

    public function update(Request $request, $id)
    {
        $banner = Banner::findOrFail($id);
        $validated = $request->validate([
            'image_url' => 'nullable|string|max:2048',
            'image' => 'nullable|image|max:10240',
            'title' => 'nullable|string',
            'subtitle' => 'nullable|string',
            'link_url' => 'nullable|string',
            'button_text' => 'nullable|string',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ]);

        $nextAsset = null;

        if ($request->hasFile('image')) {
            $nextAsset = $this->mediaService->uploadImage($request->file('image'), [
                'collection' => 'banners',
                'source' => 'banner-form-upload',
            ]);
        } elseif (array_key_exists('image_url', $validated) && trim((string) $validated['image_url']) !== '') {
            $nextAsset = $this->mediaService->importFromReference($validated['image_url'], [
                'collection' => 'banners',
                'source' => 'banner-url-import',
            ]);
        }

        $previousAssetId = $banner->media_asset_id;

        if ($nextAsset) {
            $validated['media_asset_id'] = $nextAsset->id;
            $validated['image_url'] = $this->mediaService->buildAssetUrl($nextAsset, 'large');
        } elseif (array_key_exists('image_url', $validated) && trim((string) $validated['image_url']) === '') {
            $validated['media_asset_id'] = null;
            $validated['image_url'] = null;
        }

        $banner->update($validated);

        if ($nextAsset && $previousAssetId && $previousAssetId !== $nextAsset->id) {
            $this->mediaService->deleteAsset($previousAssetId);
        }

        if (($validated['media_asset_id'] ?? $banner->media_asset_id) === null && $previousAssetId) {
            $this->mediaService->deleteAsset($previousAssetId);
        }

        return response()->json($banner->load('mediaAsset'));
    }

    public function destroy($id)
    {
        $banner = Banner::findOrFail($id);
        $banner->delete();
        return response()->json(['message' => 'Banner deleted successfully']);
    }
}
