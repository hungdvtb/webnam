<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AccessControlService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

class BackupOrderController extends Controller
{
    public function index(Request $request, AccessControlService $accessControl)
    {
        $rawAccountId = trim((string) $request->header('X-Account-Id', ''));
        if ($rawAccountId === '' || !ctype_digit($rawAccountId) || (int) $rawAccountId < 1) {
            return response()->json([
                'message' => 'Hãy chọn một tài khoản cụ thể để xem đơn backup.',
            ], 422);
        }

        $accountId = (int) $rawAccountId;
        $user = $request->user();
        if (!$user || !$accessControl->can($user, 'orders.view', $accountId)) {
            return response()->json(['message' => 'Bạn không có quyền xem đơn hàng của tài khoản này.'], 403);
        }

        $connectionConfig = config('database.connections.backup_orders', []);
        if (!filled($connectionConfig['host'] ?? null)
            || !filled($connectionConfig['database'] ?? null)
            || !filled($connectionConfig['username'] ?? null)
            || !filled($connectionConfig['password'] ?? null)) {
            return response()->json([
                'message' => 'Nguồn đơn hàng backup chưa được cấu hình trên máy chủ ứng dụng.',
            ], 503);
        }

        $validated = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $search = trim((string) ($validated['q'] ?? ''));
        $perPage = (int) ($validated['per_page'] ?? 25);
        $canViewPhone = $accessControl->canViewData($user, 'customer_phone.view', $accountId);

        try {
            $result = DB::connection('backup_orders')->transaction(function ($connection) use ($accountId, $search, $perPage, $canViewPhone) {
                $connection->statement('SET TRANSACTION READ ONLY');

                $baseQuery = $connection->table('orders')->where('account_id', $accountId);
                $summary = (clone $baseQuery)
                    ->selectRaw('COUNT(*) AS total, MIN(created_at) AS first_order, MAX(created_at) AS last_order')
                    ->first();

                $query = clone $baseQuery;
                if ($search !== '') {
                    $query->where(function ($searchQuery) use ($search, $canViewPhone) {
                        $pattern = '%' . $search . '%';
                        $searchQuery
                            ->where('order_number', 'ilike', $pattern)
                            ->orWhere('customer_name', 'ilike', $pattern);

                        if ($canViewPhone) {
                            $searchQuery->orWhere('customer_phone', 'ilike', $pattern);
                        }
                    });
                }

                $columns = ['id', 'order_number', 'customer_name', 'total_price', 'status', 'created_at', 'deleted_at'];
                if ($canViewPhone) {
                    $columns[] = 'customer_phone';
                }

                $orders = $query
                    ->select($columns)
                    ->orderByDesc('created_at')
                    ->orderByDesc('id')
                    ->paginate($perPage)
                    ->toArray();

                return [
                    'orders' => $orders,
                    'summary' => [
                        'total' => (int) ($summary->total ?? 0),
                        'first_order' => $summary->first_order,
                        'last_order' => $summary->last_order,
                    ],
                ];
            });

            return response()->json([
                ...$result['orders'],
                'summary' => $result['summary'],
                'source' => 'backup_orders',
                'read_only' => true,
            ]);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'message' => 'Không thể đọc nguồn đơn hàng backup. Kiểm tra cấu hình kết nối và quyền SELECT.',
            ], 503);
        }
    }
}
