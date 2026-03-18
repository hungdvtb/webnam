<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\SiteDomain;
use Illuminate\Http\Request;

class SiteDomainController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $this->getAccountId($request);
        if (!$accountId) {
             return response()->json([]);
        }

        $domains = SiteDomain::where('account_id', $accountId)->get();
        return response()->json($domains);
    }

    public function store(Request $request)
    {
        $accountId = $this->getAccountId($request);
        if (!$accountId) {
            return response()->json(['error' => 'Account Id is required'], 400);
        }

        $request->validate([
            'domain' => 'required|unique:site_domains,domain',
            'is_default' => 'boolean',
        ]);

        if ($request->is_default) {
            SiteDomain::where('account_id', $accountId)->update(['is_default' => false]);
        }

        $domain = SiteDomain::create([
            'account_id' => $accountId,
            'domain' => $request->domain,
            'is_active' => true,
            'is_default' => $request->is_default ?? false,
        ]);

        return response()->json($domain);
    }

    public function update(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $domain = SiteDomain::where('account_id', $accountId)->findOrFail($id);

        $request->validate([
            'domain' => 'required|unique:site_domains,domain,'.$id,
            'is_active' => 'boolean',
            'is_default' => 'boolean',
        ]);

        if ($request->is_default) {
            SiteDomain::where('account_id', $accountId)->update(['is_default' => false]);
        }

        $domain->update($request->only(['domain', 'is_active', 'is_default']));

        return response()->json($domain);
    }

    public function destroy(Request $request, $id)
    {
        $accountId = $this->getAccountId($request);
        $domain = SiteDomain::where('account_id', $accountId)->findOrFail($id);
        $domain->delete();

        return response()->json(['message' => 'Domain deleted successfully']);
    }

    private function getAccountId(Request $request)
    {
        $accountId = null;
        if ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $accountId = $request->header('X-Account-Id');
        }
        return $accountId;
    }
}
