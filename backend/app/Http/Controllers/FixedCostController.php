<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

use App\Models\FixedCost;
use App\Models\FixedCostDailySnapshot;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class FixedCostController extends Controller
{
    public function index(Request $request)
    {
        $costs = FixedCost::all();
        $totalMonthly = $costs->sum('amount');

        $month = $request->query('month', Carbon::now()->format('Y-m'));
        $startOfMonth = Carbon::parse($month . '-01')->startOfMonth();
        $endOfMonth = $startOfMonth->copy()->endOfMonth();

        $snapshots = FixedCostDailySnapshot::whereBetween('date', [
            $startOfMonth->toDateString(),
            $endOfMonth->toDateString()
        ])->orderBy('date')->get();

        $currentDailyRate = 0;
        $todaySnapshot = FixedCostDailySnapshot::where('date', Carbon::now()->toDateString())->first();
        if ($todaySnapshot) {
            $currentDailyRate = $todaySnapshot->amount;
        } else {
            $currentDailyRate = $totalMonthly / Carbon::now()->daysInMonth;
        }

        return response()->json([
            'status' => 'success',
            'data' => [
                'fixed_costs' => $costs,
                'total_monthly' => $totalMonthly,
                'current_daily_rate' => $currentDailyRate,
                'snapshots' => $snapshots,
                'days_in_month' => $startOfMonth->daysInMonth,
            ]
        ]);
    }

    public function apply(Request $request)
    {
        $request->validate([
            'apply_date' => 'required|date',
            'fixed_costs' => 'required|array',
            'fixed_costs.*.category' => 'nullable|string',
            'fixed_costs.*.name' => 'required|string',
            'fixed_costs.*.amount' => 'required|numeric|min:0',
            'fixed_costs.*.notes' => 'nullable|string',
        ]);

        $applyDate = Carbon::parse($request->input('apply_date'));
        $costsInput = $request->input('fixed_costs');

        DB::beginTransaction();
        try {
            // Update or Create
            $keptIds = [];
            foreach ($costsInput as $item) {
                if (isset($item['id']) && $item['id']) {
                    $cost = FixedCost::find($item['id']);
                    if ($cost) {
                        $cost->update($item);
                        $keptIds[] = $cost->id;
                    }
                } else {
                    $cost = FixedCost::create([
                        'category' => $item['category'] ?? '',
                        'name' => $item['name'],
                        'amount' => $item['amount'],
                        'notes' => $item['notes'] ?? '',
                    ]);
                    $keptIds[] = $cost->id;
                }
            }

            // Delete removed
            FixedCost::whereNotIn('id', $keptIds)->delete();

            // Calculate total monthly
            $totalMonthly = FixedCost::sum('amount');

            // Update snapshots for the next 365 days
            $current = $applyDate->copy();
            $endDate = $applyDate->copy()->addDays(365);

            $snapshotsData = [];
            while ($current->lte($endDate)) {
                $daysInMonth = $current->daysInMonth;
                $dailyRate = $daysInMonth > 0 ? $totalMonthly / $daysInMonth : 0;

                FixedCostDailySnapshot::updateOrCreate(
                    ['date' => $current->toDateString()],
                    ['amount' => round($dailyRate, 2)]
                );

                $current->addDay();
            }

            DB::commit();

            return response()->json([
                'status' => 'success',
                'message' => 'Đã áp dụng thay đổi thành công.',
                'total_monthly' => $totalMonthly,
            ]);

        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'status' => 'error',
                'message' => 'Lỗi: ' . $e->getMessage()
            ], 500);
        }
    }
}
