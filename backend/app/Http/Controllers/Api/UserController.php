<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AccessControlService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    public function index()
    {
        $users = User::with('accounts')->get();
        return response()->json($users);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:6',
            'status' => 'boolean',
            'permissions' => 'nullable|array',
            'permissions.*' => 'string',
            'account_ids' => 'nullable|array',
            'account_ids.*' => 'integer|exists:accounts,id',
            'account_accesses' => 'nullable|array',
            'account_accesses.*.account_id' => 'required_with:account_accesses|integer|exists:accounts,id',
            'account_accesses.*.role' => ['nullable', 'string', 'max:50', Rule::in(['owner', 'manager', 'staff', 'sale', 'warehouse', 'employee', 'viewer', 'custom'])],
            'account_accesses.*.permission_label' => 'nullable|string|max:255',
            'account_accesses.*.status' => 'nullable|boolean',
            'account_accesses.*.permissions' => 'nullable|array',
            'account_accesses.*.permissions.*' => 'string',
            'account_accesses.*.data_permissions' => 'nullable|array',
            'account_accesses.*.data_permissions.*' => 'string',
        ]);

        try {
            DB::beginTransaction();

            $accountSyncPayload = $this->buildAccountSyncPayload($validated, $request->input('permissions'));
            $legacyPermissions = $validated['permissions']
                ?? AccessControlService::moduleIdsFromPermissions(
                    collect($accountSyncPayload)
                        ->flatMap(fn ($payload) => $payload['permissions'] ?? [])
                        ->all()
                );
            
            $user = User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => Hash::make($validated['password']),
                'status' => $request->has('status') ? $validated['status'] : 1,
                'permissions' => $legacyPermissions,
            ]);

            if ($accountSyncPayload !== []) {
                $user->accounts()->sync($accountSyncPayload);
            }

            DB::commit();
            return response()->json($user->load('accounts'), 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['message' => 'Lỗi tạo user: ' . $e->getMessage()], 500);
        }
    }

    public function update(Request $request, $id)
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email,'.$id,
            'password' => 'nullable|string|min:6',
            'status' => 'boolean',
            'permissions' => 'nullable|array',
            'permissions.*' => 'string',
            'account_ids' => 'nullable|array',
            'account_ids.*' => 'integer|exists:accounts,id',
            'account_accesses' => 'nullable|array',
            'account_accesses.*.account_id' => 'required_with:account_accesses|integer|exists:accounts,id',
            'account_accesses.*.role' => ['nullable', 'string', 'max:50', Rule::in(['owner', 'manager', 'staff', 'sale', 'warehouse', 'employee', 'viewer', 'custom'])],
            'account_accesses.*.permission_label' => 'nullable|string|max:255',
            'account_accesses.*.status' => 'nullable|boolean',
            'account_accesses.*.permissions' => 'nullable|array',
            'account_accesses.*.permissions.*' => 'string',
            'account_accesses.*.data_permissions' => 'nullable|array',
            'account_accesses.*.data_permissions.*' => 'string',
        ]);

        if ($request->filled('password')) {
            if ($user->is_admin && !$request->user()?->is_admin) {
                return response()->json(['message' => 'Không thể đổi mật khẩu super admin.'], 403);
            }

            if (!$this->requesterCanChangePasswords($request)) {
                return response()->json([
                    'message' => 'Bạn không có quyền đổi mật khẩu quản trị viên.',
                    'required_permission' => AccessControlService::USER_CHANGE_PASSWORD_PERMISSION,
                ], 403);
            }
        }

        try {
            DB::beginTransaction();

            $accountSyncPayload = $this->buildAccountSyncPayload($validated, $request->input('permissions'));

            $user->name = $validated['name'];
            $user->email = $validated['email'];
            if (!empty($validated['password'])) {
                $user->password = Hash::make($validated['password']);
            }
            if (isset($validated['status'])) {
                $user->status = $validated['status'];
            }
            if (isset($validated['permissions'])) {
                $user->permissions = $validated['permissions'];
            } elseif ($accountSyncPayload !== []) {
                $user->permissions = AccessControlService::moduleIdsFromPermissions(
                    collect($accountSyncPayload)
                        ->flatMap(fn ($payload) => $payload['permissions'] ?? [])
                        ->all()
                );
            }
            
            $user->save();

            if (array_key_exists('account_accesses', $validated) || array_key_exists('account_ids', $validated)) {
                $user->accounts()->sync($accountSyncPayload);
            }

            DB::commit();
            return response()->json($user->load('accounts'));
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['message' => 'Lỗi cập nhật user: ' . $e->getMessage()], 500);
        }
    }

    public function destroy($id)
    {
        // Maybe don't delete, or allow delete if needed.
        // User requested to simply be able to create, edit, lock/unlock. So no delete needed, but can provide.
        $user = User::findOrFail($id);
        if ($user->is_admin) {
            return response()->json(['message' => 'Không thể xoá super admin'], 403);
        }
        $user->delete();
        return response()->json(['message' => 'Xoá thành công']);
    }

    public function changePassword(Request $request, $id)
    {
        $user = User::findOrFail($id);

        if ($user->is_admin && !$request->user()?->is_admin) {
            return response()->json(['message' => 'Không thể đổi mật khẩu super admin.'], 403);
        }

        $validated = $request->validate([
            'password' => 'required|string|min:6',
            'password_confirmation' => 'nullable|string|same:password',
        ]);

        $user->password = Hash::make($validated['password']);
        $user->save();

        return response()->json(['message' => 'Đổi mật khẩu thành công.']);
    }

    private function requesterCanChangePasswords(Request $request): bool
    {
        $requester = $request->user();
        if (!$requester) {
            return false;
        }

        $access = app(AccessControlService::class);

        return $access->can(
            $requester,
            AccessControlService::USER_CHANGE_PASSWORD_PERMISSION,
            $access->resolveAccountIdFromRequest($request)
        );
    }

    private function buildAccountSyncPayload(array $validated, mixed $legacyPermissions): array
    {
        if (!empty($validated['account_accesses'])) {
            $payload = [];

            foreach ($validated['account_accesses'] as $access) {
                $accountId = (int) $access['account_id'];
                $role = $access['role'] ?? 'custom';
                $permissions = $access['permissions'] ?? AccessControlService::permissionsForRole($role);
                $dataPermissions = $access['data_permissions'] ?? AccessControlService::dataPermissionsForRole($role);
                $permissionLabel = trim((string) ($access['permission_label'] ?? ''));

                $payload[$accountId] = [
                    'role' => $role,
                    'permission_label' => $permissionLabel !== '' ? $permissionLabel : null,
                    'status' => array_key_exists('status', $access) ? (int) (bool) $access['status'] : 1,
                    'permissions' => json_encode(AccessControlService::sanitizePermissionsForStorage($permissions)),
                    'data_permissions' => json_encode(AccessControlService::normalizeDataPermissions($dataPermissions)),
                ];
            }

            return $payload;
        }

        if (empty($validated['account_ids'])) {
            return [];
        }

        $permissions = AccessControlService::sanitizePermissionsForStorage(
            AccessControlService::expandLegacyPermissions(
                is_array($legacyPermissions) ? $legacyPermissions : []
            )
        );

        $payload = [];
        foreach ($validated['account_ids'] as $accountId) {
            $payload[(int) $accountId] = [
                'role' => 'custom',
                'permission_label' => null,
                'status' => 1,
                'permissions' => json_encode($permissions),
                'data_permissions' => json_encode([]),
            ];
        }

        return $payload;
    }
}
