<?php

namespace App\Http\Controllers;

use App\Models\Account;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AccountController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        
        // If system admin, show all accounts. Otherwise, show user's accounts.
        if ($user->is_admin) {
            $accounts = Account::with('users')->get();
        } else {
            $accounts = $user->accounts()->with('users')->get();
        }

        return response()->json($accounts);
    }

    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'domain' => 'nullable|string|unique:accounts,domain',
            'subdomain' => 'nullable|string|unique:accounts,subdomain',
            'site_code' => 'nullable|string|unique:accounts,site_code',
            'ai_api_key' => 'nullable|string|max:255',
        ]);

        $subdomain = $request->subdomain ?: Str::slug($request->name);

        if (Account::where('subdomain', $subdomain)->exists()) {
            $subdomain .= '-' . time();
        }

        $account = Account::create([
            'name' => $request->name,
            'domain' => $request->domain,
            'subdomain' => $subdomain,
            'site_code' => $request->site_code,
            'ai_api_key' => $request->ai_api_key,
        ]);

        // Attach current user as owner
        $request->user()->accounts()->attach($account->id, ['role' => 'owner']);
        app(\App\Services\BlogSystemPostService::class)->ensureForAccount((int) $account->id);

        return response()->json($account->load('users'), 201);
    }

    public function storeWithUser(Request $request)
    {
        if (!$request->user()->is_admin) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'account_name' => 'required|string|max:255',
            'domain' => 'nullable|string|unique:accounts,domain',
            'subdomain' => 'nullable|string|unique:accounts,subdomain',
            'ai_api_key' => 'nullable|string|max:255',
            'user_name' => 'required|string|max:255',
            'user_email' => 'required|string|email|unique:users,email',
            'user_password' => 'required|string|min:6',
        ]);

        \Illuminate\Support\Facades\DB::beginTransaction();
        try {
            $subdomain = $request->subdomain ?: Str::slug($request->account_name);
            if (Account::where('subdomain', $subdomain)->exists()) {
                $subdomain .= '-' . time();
            }

            $account = Account::create([
                'name' => $request->account_name,
                'domain' => $request->domain,
                'subdomain' => $subdomain,
                'site_code' => $request->site_code,
                'ai_api_key' => $request->ai_api_key,
            ]);

            $user = \App\Models\User::create([
                'name' => $request->user_name,
                'email' => $request->user_email,
                'password' => \Illuminate\Support\Facades\Hash::make($request->user_password),
                'is_admin' => false,
            ]);

            $user->accounts()->attach($account->id, ['role' => 'owner']);
            app(\App\Services\BlogSystemPostService::class)->ensureForAccount((int) $account->id);

            \Illuminate\Support\Facades\DB::commit();

            return response()->json($account->load('users'), 201);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\DB::rollBack();
            return response()->json(['message' => 'Error: ' . $e->getMessage()], 500);
        }
    }

    public function show($id, Request $request)
    {
        $user = $request->user();
        
        if ($user->is_admin) {
            $account = Account::with('users')->findOrFail($id);
        } else {
            $account = $user->accounts()->with('users')->findOrFail($id);
        }

        return response()->json($account);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();

        if ($user->is_admin) {
            $account = Account::findOrFail($id);
        } else {
            $account = $user->accounts()->wherePivot('role', 'owner')->findOrFail($id);
        }

        $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'domain' => 'nullable|string|unique:accounts,domain,' . $account->id,
            'subdomain' => 'nullable|string|unique:accounts,subdomain,' . $account->id,
            'site_code' => 'nullable|string|unique:accounts,site_code,' . $account->id,
            'status' => 'boolean',
            'ai_api_key' => 'nullable|string|max:255',
        ]);

        $account->update($request->only('name', 'domain', 'subdomain', 'site_code', 'status', 'ai_api_key'));

        return response()->json($account);
    }

    public function destroy($id, Request $request)
    {
        $user = $request->user();

        if ($user->is_admin) {
            $account = Account::findOrFail($id);
        } else {
            $account = $user->accounts()->wherePivot('role', 'owner')->findOrFail($id);
        }

        $account->delete();

        return response()->json(['message' => 'Account deleted']);
    }

    /**
     * Public: resolve account by site_code for frontend
     */
    public function resolveBySiteCode($code)
    {
        $account = Account::where('site_code', $code)->first();
        if (!$account) {
            return response()->json(['message' => 'Account not found'], 404);
        }
        return response()->json([
            'id' => $account->id,
            'name' => $account->name,
            'site_code' => $account->site_code,
            'subdomain' => $account->subdomain,
            'domain' => $account->domain,
        ]);
    }
}
