<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fixed_cost_categories', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        $defaultNames = [
            'Mặt bằng',
            'Nhân sự',
            'Tiện ích (Điện/Nước/Net)',
            'Phần mềm/Dịch vụ',
            'Khấu hao tài sản',
            'Khác',
        ];

        $existingNames = Schema::hasTable('fixed_costs')
            ? DB::table('fixed_costs')
                ->whereNotNull('category')
                ->pluck('category')
                ->all()
            : [];

        $normalizedNames = collect($defaultNames)
            ->concat($existingNames)
            ->map(function ($name) {
                return trim((string) preg_replace('/\s+/u', ' ', (string) $name));
            })
            ->filter()
            ->unique(fn (string $name) => mb_strtolower($name))
            ->values();

        if ($normalizedNames->isEmpty()) {
            return;
        }

        $timestamp = now();

        DB::table('fixed_cost_categories')->insert(
            $normalizedNames
                ->map(fn (string $name, int $index) => [
                    'name' => $name,
                    'sort_order' => $index + 1,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ])
                ->all()
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('fixed_cost_categories');
    }
};
