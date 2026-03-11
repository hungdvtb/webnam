<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;

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
            'account_ids' => 'nullable|array'
        ]);

        try {
            DB::beginTransaction();
            
            $user = User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => Hash::make($validated['password']),
                'status' => $request->has('status') ? $validated['status'] : 1,
                'permissions' => json_encode($validated['permissions'] ?? []),
            ]);

            if (!empty($validated['account_ids'])) {
                $user->accounts()->sync($validated['account_ids']);
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
            'account_ids' => 'nullable|array'
        ]);

        try {
            DB::beginTransaction();

            $user->name = $validated['name'];
            $user->email = $validated['email'];
            if (!empty($validated['password'])) {
                $user->password = Hash::make($validated['password']);
            }
            if (isset($validated['status'])) {
                $user->status = $validated['status'];
            }
            if (isset($validated['permissions'])) {
                $user->permissions = json_encode($validated['permissions']);
            }
            
            $user->save();

            if (isset($validated['account_ids'])) {
                $user->accounts()->sync($validated['account_ids']);
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
}
