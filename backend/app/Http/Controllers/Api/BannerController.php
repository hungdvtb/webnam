<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Banner;
use App\Models\Account;
use Illuminate\Http\Request;

class BannerController extends Controller
{
    public function index(Request $request)
    {
        $query = Banner::query()->orderBy('sort_order', 'asc');

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
            'image_url' => 'required|string',
            'title' => 'nullable|string',
            'subtitle' => 'nullable|string',
            'link_url' => 'nullable|string',
            'button_text' => 'nullable|string',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ]);

        $banner = Banner::create($validated);
        return response()->json($banner, 201);
    }

    public function show($id)
    {
        return Banner::findOrFail($id);
    }

    public function update(Request $request, $id)
    {
        $banner = Banner::findOrFail($id);
        $validated = $request->validate([
            'image_url' => 'sometimes|required|string',
            'title' => 'nullable|string',
            'subtitle' => 'nullable|string',
            'link_url' => 'nullable|string',
            'button_text' => 'nullable|string',
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ]);

        $banner->update($validated);
        return response()->json($banner);
    }

    public function destroy($id)
    {
        $banner = Banner::findOrFail($id);
        $banner->delete();
        return response()->json(['message' => 'Banner deleted successfully']);
    }
}
