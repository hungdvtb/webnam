<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('lead_potentials')) {
            return;
        }

        $definitions = [
            ['name' => 'Khách tiềm năng', 'code' => 'khach-tiem-nang', 'color' => '#16a34a', 'sort_order' => 1, 'is_default' => false, 'counts_as_potential' => true],
            ['name' => 'Khách chỉ tham khảo', 'code' => 'khach-chi-tham-khao', 'color' => '#f59e0b', 'sort_order' => 2, 'is_default' => false, 'counts_as_potential' => false],
            ['name' => 'Khách chê đắt', 'code' => 'khach-che-dat', 'color' => '#ef4444', 'sort_order' => 3, 'is_default' => false, 'counts_as_potential' => false],
        ];
        $legacyCodes = ['hot', 'high', 'medium', 'low', 'unqualified'];
        $now = now();

        DB::table('accounts')
            ->orderBy('id')
            ->pluck('id')
            ->each(function ($accountId) use ($definitions, $legacyCodes, $now) {
                foreach ($definitions as $definition) {
                    $existing = DB::table('lead_potentials')
                        ->where('account_id', $accountId)
                        ->where('code', $definition['code'])
                        ->first();

                    $payload = [
                        'name' => $definition['name'],
                        'color' => $definition['color'],
                        'sort_order' => $definition['sort_order'],
                        'is_default' => $definition['is_default'],
                        'counts_as_potential' => $definition['counts_as_potential'],
                        'is_active' => true,
                        'updated_at' => $now,
                    ];

                    if ($existing) {
                        DB::table('lead_potentials')
                            ->where('id', $existing->id)
                            ->update($payload);
                        continue;
                    }

                    DB::table('lead_potentials')->insert($payload + [
                        'account_id' => $accountId,
                        'code' => $definition['code'],
                        'created_at' => $now,
                    ]);
                }

                DB::table('lead_potentials')
                    ->where('account_id', $accountId)
                    ->whereIn('code', $legacyCodes)
                    ->update([
                        'is_default' => false,
                        'is_active' => false,
                        'updated_at' => $now,
                    ]);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('lead_potentials')) {
            return;
        }

        DB::table('lead_potentials')
            ->whereIn('code', ['hot', 'high', 'medium', 'low', 'unqualified'])
            ->update([
                'is_active' => true,
                'updated_at' => now(),
            ]);
    }
};
