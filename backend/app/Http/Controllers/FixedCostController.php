<?php

namespace App\Http\Controllers;

use App\Models\FixedCost;
use App\Models\FixedCostCategory;
use App\Models\FixedCostDailySnapshot;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class FixedCostController extends Controller
{
    public function index(Request $request)
    {
        $costs = FixedCost::query()
            ->orderBy('category')
            ->orderBy('name')
            ->get();

        $this->syncCategoryCatalog($costs->pluck('category')->all());
        $totalMonthly = $costs->sum('amount');

        $month = $request->query('month', Carbon::now()->format('Y-m'));
        $startOfMonth = Carbon::parse($month . '-01')->startOfMonth();
        $endOfMonth = $startOfMonth->copy()->endOfMonth();

        $snapshots = FixedCostDailySnapshot::query()
            ->whereBetween('date', [
                $startOfMonth->toDateString(),
                $endOfMonth->toDateString(),
            ])
            ->orderBy('date')
            ->get();

        $currentDailyRate = 0;
        $todaySnapshot = FixedCostDailySnapshot::query()
            ->where('date', Carbon::now()->toDateString())
            ->first();

        if ($todaySnapshot) {
            $currentDailyRate = $todaySnapshot->amount;
        } else {
            $currentDailyRate = $totalMonthly / Carbon::now()->daysInMonth;
        }

        return response()->json([
            'status' => 'success',
            'data' => [
                'fixed_costs' => $costs,
                'categories' => $this->categoryCollection(),
                'total_monthly' => $totalMonthly,
                'current_daily_rate' => $currentDailyRate,
                'snapshots' => $snapshots,
                'days_in_month' => $startOfMonth->daysInMonth,
            ],
        ]);
    }

    public function apply(Request $request)
    {
        $request->validate([
            'apply_date' => 'required|date',
            'fixed_costs' => 'required|array',
            'fixed_costs.*.category' => 'nullable|string|max:180',
            'fixed_costs.*.name' => 'required|string|max:180',
            'fixed_costs.*.amount' => 'required|numeric|min:0',
            'fixed_costs.*.notes' => 'nullable|string',
        ]);

        $applyDate = Carbon::parse($request->input('apply_date'));
        $costsInput = $request->input('fixed_costs');

        DB::beginTransaction();

        try {
            $keptIds = [];
            $categoryNames = [];

            foreach ($costsInput as $item) {
                $normalizedCategory = $this->normalizeCategoryName($item['category'] ?? null);
                if ($normalizedCategory !== '') {
                    $categoryNames[] = $normalizedCategory;
                }

                $payload = [
                    'category' => $normalizedCategory,
                    'name' => trim((string) ($item['name'] ?? '')),
                    'amount' => $item['amount'],
                    'notes' => $item['notes'] ?? '',
                ];

                if (!empty($item['id'])) {
                    $cost = FixedCost::query()->find($item['id']);
                    if ($cost) {
                        $cost->update($payload);
                        $keptIds[] = $cost->id;
                    }
                    continue;
                }

                $cost = FixedCost::query()->create($payload);
                $keptIds[] = $cost->id;
            }

            FixedCost::query()->whereNotIn('id', $keptIds)->delete();
            $this->syncCategoryCatalog($categoryNames);

            $totalMonthly = (float) FixedCost::query()->sum('amount');

            $current = $applyDate->copy();
            $endDate = $applyDate->copy()->addDays(365);

            while ($current->lte($endDate)) {
                $daysInMonth = $current->daysInMonth;
                $dailyRate = $daysInMonth > 0 ? $totalMonthly / $daysInMonth : 0;

                FixedCostDailySnapshot::query()->updateOrCreate(
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
                'categories' => $this->categoryCollection(),
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'status' => 'error',
                'message' => 'Lỗi: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function storeCategory(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:180', Rule::unique('fixed_cost_categories', 'name')],
        ]);

        $category = FixedCostCategory::query()->create([
            'name' => $this->normalizeCategoryName($validated['name']),
            'sort_order' => $this->nextCategorySortOrder(),
        ]);

        return response()->json([
            'status' => 'success',
            'message' => 'Đã thêm danh mục chi phí.',
            'data' => [
                'category' => $this->categoryPayload($category, 0),
            ],
        ], 201);
    }

    public function updateCategory(Request $request, int $id)
    {
        $category = FixedCostCategory::query()->findOrFail($id);

        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'max:180',
                Rule::unique('fixed_cost_categories', 'name')->ignore($category->id),
            ],
        ]);

        $newName = $this->normalizeCategoryName($validated['name']);
        $oldName = $category->name;

        DB::transaction(function () use ($category, $newName, $oldName) {
            $category->update([
                'name' => $newName,
            ]);

            if ($oldName !== $newName) {
                FixedCost::query()
                    ->where('category', $oldName)
                    ->update([
                        'category' => $newName,
                        'updated_at' => now(),
                    ]);
            }
        });

        $category->refresh();
        $usageCount = (int) FixedCost::query()->where('category', $category->name)->count();

        return response()->json([
            'status' => 'success',
            'message' => 'Đã cập nhật danh mục chi phí.',
            'data' => [
                'old_name' => $oldName,
                'category' => $this->categoryPayload($category, $usageCount),
            ],
        ]);
    }

    public function destroyCategory(Request $request, int $id)
    {
        $category = FixedCostCategory::query()->findOrFail($id);
        $usageCount = (int) FixedCost::query()->where('category', $category->name)->count();

        if ($usageCount > 0) {
            return response()->json([
                'status' => 'error',
                'message' => 'Không thể xóa danh mục đang được dùng trong chi phí cố định.',
                'usage_count' => $usageCount,
            ], 422);
        }

        $category->delete();

        return response()->json([
            'status' => 'success',
            'message' => 'Đã xóa danh mục chi phí.',
            'data' => [
                'id' => $id,
            ],
        ]);
    }

    private function categoryCollection(): array
    {
        $usageCounts = FixedCost::query()
            ->selectRaw('category, COUNT(*) as usage_count')
            ->whereNotNull('category')
            ->where('category', '<>', '')
            ->groupBy('category')
            ->pluck('usage_count', 'category');

        return FixedCostCategory::query()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get()
            ->map(fn (FixedCostCategory $category) => $this->categoryPayload(
                $category,
                (int) ($usageCounts[$category->name] ?? 0)
            ))
            ->values()
            ->all();
    }

    private function categoryPayload(FixedCostCategory $category, int $usageCount): array
    {
        return [
            'id' => $category->id,
            'name' => $category->name,
            'sort_order' => (int) $category->sort_order,
            'usage_count' => $usageCount,
        ];
    }

    private function nextCategorySortOrder(): int
    {
        return ((int) FixedCostCategory::query()->max('sort_order')) + 1;
    }

    private function normalizeCategoryName(?string $value): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', (string) $value));
    }

    private function syncCategoryCatalog(iterable $names): void
    {
        $normalizedNames = collect($names)
            ->map(fn ($name) => $this->normalizeCategoryName($name))
            ->filter()
            ->unique(fn (string $name) => mb_strtolower($name))
            ->values();

        if ($normalizedNames->isEmpty()) {
            return;
        }

        $existingNames = FixedCostCategory::query()
            ->pluck('name')
            ->mapWithKeys(fn ($name) => [mb_strtolower($this->normalizeCategoryName($name)) => true]);

        $sortOrder = (int) FixedCostCategory::query()->max('sort_order');

        foreach ($normalizedNames as $name) {
            $key = mb_strtolower($name);
            if ($existingNames->has($key)) {
                continue;
            }

            $sortOrder++;

            FixedCostCategory::query()->create([
                'name' => $name,
                'sort_order' => $sortOrder,
            ]);

            $existingNames->put($key, true);
        }
    }
}
