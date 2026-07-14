<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\StorefrontTheme;
use App\Services\AccessControlService;
use App\Support\OrderStatusCatalog;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AccountController extends Controller
{
    private const STOREFRONT_THEME_RELATION_SELECT = 'id,name,code,folder,status,is_default,preview_image';

    private function accountRelations(): array
    {
        return [
            'users',
            'publicDomain:id,account_id,domain,is_active,is_default',
            'storefrontTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'simpleProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'configurableProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
            'bundleProductTheme:' . self::STOREFRONT_THEME_RELATION_SELECT,
        ];
    }

    public function index(Request $request)
    {
        $user = $request->user();
        $relations = $this->accountRelations();
        
        // If system admin, show all accounts. Otherwise, show user's accounts.
        if ($user->is_admin) {
            $accounts = Account::with($relations)->get();
        } else {
            $accounts = $user->accounts()->with($relations)->get();
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
            'catalog_account_id' => 'nullable|integer|exists:accounts,id',
            'inventory_account_id' => 'nullable|integer|exists:accounts,id',
            'public_domain_id' => 'nullable|integer|exists:site_domains,id',
            'storefront_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'simple_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'configurable_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'bundle_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
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
            'catalog_account_id' => $this->nullableAccountLink($request->input('catalog_account_id')),
            'inventory_account_id' => $this->nullableAccountLink($request->input('inventory_account_id')),
            'public_domain_id' => $this->nullablePublicDomainId($request->input('public_domain_id')),
            'storefront_theme_id' => $this->nullableStorefrontThemeId($request->input('storefront_theme_id')),
        ] + $this->storefrontThemeAssignmentsFromRequest($request, true, ['storefront_theme_id']));

        // Attach current user as owner
        $request->user()->accounts()->attach($account->id, $this->pivotPayloadForRole('owner'));
        OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id, true);
        app(\App\Services\BlogSystemPostService::class)->ensureForAccount((int) $account->id);

        return response()->json($account->load($this->accountRelations()), 201);
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
            'site_code' => 'nullable|string|unique:accounts,site_code',
            'ai_api_key' => 'nullable|string|max:255',
            'catalog_account_id' => 'nullable|integer|exists:accounts,id',
            'inventory_account_id' => 'nullable|integer|exists:accounts,id',
            'public_domain_id' => 'nullable|integer|exists:site_domains,id',
            'storefront_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'simple_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'configurable_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'bundle_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
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
                'catalog_account_id' => $this->nullableAccountLink($request->input('catalog_account_id')),
                'inventory_account_id' => $this->nullableAccountLink($request->input('inventory_account_id')),
                'public_domain_id' => $this->nullablePublicDomainId($request->input('public_domain_id')),
                'storefront_theme_id' => $this->nullableStorefrontThemeId($request->input('storefront_theme_id')),
            ] + $this->storefrontThemeAssignmentsFromRequest($request, true, ['storefront_theme_id']));

            $user = \App\Models\User::create([
                'name' => $request->user_name,
                'email' => $request->user_email,
                'password' => \Illuminate\Support\Facades\Hash::make($request->user_password),
                'is_admin' => false,
            ]);

            $user->accounts()->attach($account->id, $this->pivotPayloadForRole('owner'));
            OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id, true);
            app(\App\Services\BlogSystemPostService::class)->ensureForAccount((int) $account->id);

            \Illuminate\Support\Facades\DB::commit();

            return response()->json($account->load($this->accountRelations()), 201);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\DB::rollBack();
            return response()->json(['message' => 'Error: ' . $e->getMessage()], 500);
        }
    }

    public function show($id, Request $request)
    {
        $user = $request->user();
        
        if ($user->is_admin) {
            $account = Account::with($this->accountRelations())->findOrFail($id);
        } else {
            $account = $user->accounts()->with($this->accountRelations())->findOrFail($id);
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
            'catalog_account_id' => 'nullable|integer|exists:accounts,id',
            'inventory_account_id' => 'nullable|integer|exists:accounts,id',
            'public_domain_id' => 'nullable|integer|exists:site_domains,id',
            'storefront_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'simple_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'configurable_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
            'bundle_product_theme_id' => 'nullable|integer|exists:storefront_themes,id',
        ]);

        $payload = $request->only('name', 'domain', 'subdomain', 'site_code', 'status', 'ai_api_key');

        if ($request->exists('catalog_account_id')) {
            $payload['catalog_account_id'] = $this->nullableAccountLink($request->input('catalog_account_id'), (int) $account->id);
        }

        if ($request->exists('inventory_account_id')) {
            $payload['inventory_account_id'] = $this->nullableAccountLink($request->input('inventory_account_id'), (int) $account->id);
        }

        if ($request->exists('public_domain_id')) {
            $payload['public_domain_id'] = $this->nullablePublicDomainId($request->input('public_domain_id'));
        }

        $payload = array_merge($payload, $this->storefrontThemeAssignmentsFromRequest($request));

        $account->update($payload);

        return response()->json($account->fresh($this->accountRelations()));
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
            'public_domain_id' => $account->public_domain_id,
            'public_domain' => $account->publicDomain?->only(['id', 'domain', 'is_active', 'is_default']),
            'storefront_theme_id' => $account->storefront_theme_id,
            'storefront_theme' => $account->storefrontTheme?->toStorefrontPayload(),
            'simple_product_theme_id' => $account->simple_product_theme_id,
            'simple_product_theme' => $account->simpleProductTheme?->toStorefrontPayload(),
            'configurable_product_theme_id' => $account->configurable_product_theme_id,
            'configurable_product_theme' => $account->configurableProductTheme?->toStorefrontPayload(),
            'bundle_product_theme_id' => $account->bundle_product_theme_id,
            'bundle_product_theme' => $account->bundleProductTheme?->toStorefrontPayload(),
        ]);
    }

    private function pivotPayloadForRole(string $role): array
    {
        return [
            'role' => $role,
            'status' => 1,
            'permissions' => json_encode(AccessControlService::permissionsForRole($role)),
            'data_permissions' => json_encode(AccessControlService::dataPermissionsForRole($role)),
        ];
    }

    private function nullableAccountLink($value, ?int $selfAccountId = null): ?int
    {
        if ($value === null || $value === '' || $value === '0') {
            return null;
        }

        $accountId = (int) $value;

        return $accountId > 0 && $accountId !== $selfAccountId ? $accountId : null;
    }

    private function nullablePublicDomainId($value): ?int
    {
        if ($value === null || $value === '' || $value === '0') {
            return null;
        }

        return (int) $value;
    }

    private function storefrontThemeAssignmentsFromRequest(Request $request, bool $includeMissing = false, array $except = []): array
    {
        $payload = [];

        foreach ([
            'storefront_theme_id' => null,
            'simple_product_theme_id' => 'simple',
            'configurable_product_theme_id' => 'configurable',
            'bundle_product_theme_id' => 'bundle',
        ] as $field => $productType) {
            if (in_array($field, $except, true)) {
                continue;
            }

            if ($includeMissing || $request->exists($field)) {
                $payload[$field] = $this->nullableStorefrontThemeId($request->input($field), $productType);
            }
        }

        return $payload;
    }

    private function nullableStorefrontThemeId($value, ?string $productType = null): ?int
    {
        if ($value === null || $value === '' || $value === '0') {
            return null;
        }

        $themeId = (int) $value;
        $exists = StorefrontTheme::query()
            ->whereKey($themeId)
            ->where('status', true)
            ->when($productType, fn ($query) => $query->where('product_type', $productType))
            ->exists();

        abort_unless($exists, 422, 'Giao dien storefront khong ton tai.');

        return $themeId;
    }
}
