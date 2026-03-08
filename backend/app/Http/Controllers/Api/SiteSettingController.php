<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use App\Models\Account;
use Illuminate\Http\Request;

class SiteSettingController extends Controller
{
    public function index(Request $request)
    {
        $accountId = null;
        if ($request->has('site_code')) {
            $account = Account::where('site_code', $request->site_code)->first();
            if ($account) {
                $accountId = $account->id;
            }
        } elseif ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $accountId = $request->header('X-Account-Id');
        }

        if (!$accountId) {
            return response()->json([]);
        }

        $settings = SiteSetting::where('account_id', $accountId)->get()->pluck('value', 'key');
        return response()->json($settings);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'account_id' => 'required|exists:accounts,id',
            'settings' => 'required|array',
        ]);

        foreach ($validated['settings'] as $key => $value) {
            SiteSetting::setValue($key, $value, $validated['account_id']);
        }

        return response()->json(['message' => 'Settings updated successfully']);
    }
}
