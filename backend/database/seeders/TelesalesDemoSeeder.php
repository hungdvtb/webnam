<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\Lead;
use App\Models\LeadFollowUpTask;
use App\Models\LeadItem;
use App\Models\LeadNote;
use App\Models\LeadNotificationRead;
use App\Models\LeadPotential;
use App\Models\LeadStaff;
use App\Models\LeadStatus;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

class TelesalesDemoSeeder extends Seeder
{
    private const DEMO_TAG = 'CRM-DEMO-TEST';
    private const DEFAULT_PER_ACCOUNT_COUNT = 50;

    public function run(): void
    {
        if (!app()->environment(['local', 'testing'])) {
            $this->command?->error('Refused: CRM telesales demo seeding is only available in local/testing.');
            return;
        }

        $targetAccountId = (int) env('TELESALES_DEMO_ACCOUNT_ID', 0);
        $count = max(1, min((int) env('TELESALES_DEMO_COUNT', self::DEFAULT_PER_ACCOUNT_COUNT), 500));
        $clearAll = filter_var(env('TELESALES_DEMO_CLEAR_ALL', false), FILTER_VALIDATE_BOOLEAN);

        if ($clearAll && $targetAccountId <= 0) {
            $this->command?->error('TELESALES_DEMO_CLEAR_ALL can only be used with TELESALES_DEMO_ACCOUNT_ID.');
            return;
        }

        $accounts = Account::query()
            ->when($targetAccountId > 0, fn ($query) => $query->where('id', $targetAccountId))
            ->where('status', true)
            ->orderBy('id')
            ->get();

        if ($accounts->isEmpty()) {
            $this->command?->warn('Khong tim thay account active de seed CRM telesales demo.');
            return;
        }

        foreach ($accounts as $account) {
            $createdCount = $this->seedAccount((int) $account->id, $count, $clearAll);
            $this->command?->info("Da tao {$createdCount} khach CRM demo cho account #{$account->id} - {$account->name}.");
        }
    }

    private function seedAccount(int $accountId, int $count, bool $clearAll): int
    {
        if ($clearAll) {
            $this->clearAccountLeads($accountId);
        } else {
            $this->clearExistingDemoLeads($accountId);
        }

        $statuses = LeadStatus::ensureDefaultsForAccount($accountId)->keyBy('code');
        $potentials = $this->ensureDemoPotentials($accountId);
        $staffs = $this->ensureStaffs($accountId);
        $now = now();
        $created = 0;

        for ($index = 1; $index <= $count; $index++) {
            $case = $this->caseForIndex($index);
            $status = $this->statusForCase($statuses, $case);
            $staff = $staffs[($index - 1) % max(1, $staffs->count())] ?? null;
            $placedAt = $this->placedAtForCase($now, $case, $index);
            $potential = $this->potentialForIndex($potentials, $index);
            $stopped = (bool) ($case['stopped'] ?? false) || $this->isStoppedStatus($status);
            $convertedAt = $this->isClosedStatus($status)
                ? $this->safeCompletedAt($placedAt->copy()->addDay()->setTime(16, 0), $now)
                : null;

            $lead = Lead::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'lead_number' => sprintf('CRMDEMO-A%d-%03d', $accountId, $index),
                'lead_status_id' => $status?->id,
                'assigned_staff_id' => $staff?->id,
                'potential_level' => $potential,
                'next_follow_up_at' => $this->nextFollowUpForCase($placedAt, $case, $stopped),
                'follow_up_script' => $this->scriptForCase($case, $stopped),
                'follow_up_interval_days' => $this->intervalForCase($case, $stopped),
                'last_contacted_at' => $this->lastContactForCase($placedAt, $case, $now),
                'do_not_call' => $stopped,
                'customer_name' => $this->customerName($index, $case),
                'phone' => $this->phoneForIndex($accountId, $index),
                'zalo_phone' => $index % 6 === 0 ? $this->phoneForIndex($accountId, $index + 120) : $this->phoneForIndex($accountId, $index),
                'email' => null,
                'address' => $this->addressForIndex($index),
                'product_name' => 'Tu van CRM demo',
                'product_summary' => $this->productSummaryForIndex($index),
                'product_summary_short' => 'CRM demo',
                'message' => $this->messageForCase($case),
                'source' => $this->sourceForIndex($index),
                'tag' => self::DEMO_TAG,
                'status' => $status?->code ?? 'don-moi',
                'placed_at' => $placedAt,
                'converted_at' => $convertedAt,
                'status_changed_at' => $this->safeCompletedAt($placedAt->copy()->addMinutes(40), $now),
                'notes' => null,
                'payload_snapshot' => [
                    'demo_seed' => true,
                    'demo_case' => $case['key'],
                    'days_back' => (int) $case['days_back'],
                    'workflow_hint' => $case['hint'],
                ],
                'conversion_data' => $convertedAt ? ['demo_converted' => true] : [],
            ]);

            $lead->forceFill([
                'created_at' => $placedAt,
                'updated_at' => $placedAt,
            ])->save();

            $this->createFollowUpTasks($lead, $placedAt, $case, $now);

            $latestNote = $this->createDemoNotes($lead, $status, $staff, $placedAt, $potential, $case, $now, $index);
            $lead->forceFill([
                'latest_note_excerpt' => mb_strimwidth($latestNote->content, 0, 180, '...'),
                'last_noted_at' => $latestNote->created_at,
                'updated_at' => $latestNote->created_at,
            ])->save();

            $created++;
        }

        return $created;
    }

    private function clearExistingDemoLeads(int $accountId): void
    {
        $demoLeadIds = Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('tag', self::DEMO_TAG)
            ->pluck('id');

        $this->deleteLeadsByIds($demoLeadIds);
    }

    private function clearAccountLeads(int $accountId): void
    {
        $leadIds = Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->pluck('id');

        $this->deleteLeadsByIds($leadIds);
    }

    private function deleteLeadsByIds(Collection $leadIds): void
    {
        if ($leadIds->isEmpty()) {
            return;
        }

        LeadNote::withoutGlobalScopes()
            ->whereIn('lead_id', $leadIds)
            ->delete();

        if (Schema::hasTable('lead_items')) {
            LeadItem::withoutGlobalScopes()
                ->whereIn('lead_id', $leadIds)
                ->delete();
        }

        if (Schema::hasTable('lead_notification_reads')) {
            LeadNotificationRead::query()
                ->whereIn('lead_id', $leadIds)
                ->delete();
        }

        if (Schema::hasTable('lead_follow_up_tasks')) {
            LeadFollowUpTask::withoutGlobalScopes()
                ->whereIn('lead_id', $leadIds)
                ->delete();
        }

        Lead::withoutGlobalScopes()
            ->whereIn('id', $leadIds)
            ->get()
            ->each(fn (Lead $lead) => $lead->forceDelete());
    }

    private function ensureStaffs(int $accountId): Collection
    {
        return collect(['Sale demo A', 'Sale demo B', 'Sale demo C', 'Sale demo D'])
            ->map(function (string $name, int $index) use ($accountId) {
                return LeadStaff::withoutGlobalScopes()->updateOrCreate([
                    'account_id' => $accountId,
                    'name' => $name,
                ], [
                    'user_id' => null,
                    'sort_order' => $index + 1,
                    'is_active' => true,
                ]);
            })
            ->values();
    }

    private function ensureDemoPotentials(int $accountId): Collection
    {
        $definitions = collect(LeadPotential::defaultDefinitions());
        $defaultCodes = $definitions->pluck('code')->all();

        LeadPotential::ensureDefaultsForAccount($accountId);

        foreach ($definitions as $definition) {
            LeadPotential::withoutGlobalScopes()->updateOrCreate([
                'account_id' => $accountId,
                'code' => $definition['code'],
            ], [
                'name' => $definition['name'],
                'color' => $definition['color'],
                'sort_order' => $definition['sort_order'],
                'is_default' => $definition['is_default'],
                'counts_as_potential' => $definition['counts_as_potential'],
                'is_active' => true,
            ]);
        }

        LeadPotential::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->whereNotIn('code', $defaultCodes)
            ->update(['is_active' => false]);

        return LeadPotential::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->whereIn('code', $defaultCodes)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
    }

    private function caseForIndex(int $index): array
    {
        $cases = [
            ['key' => 'new_today', 'status' => 'don-moi', 'days_back' => 0, 'current' => 'new', 'done' => [], 'stopped' => false, 'hint' => 'So moi hom nay, can goi lan dau.'],
            ['key' => 'new_yesterday', 'status' => 'don-moi', 'days_back' => 1, 'current' => 'new', 'done' => [], 'stopped' => false, 'hint' => 'So moi tu hom qua chua xu ly, van nam trong viec hom nay.'],
            ['key' => 'new_overdue', 'status' => 'don-moi', 'days_back' => 5, 'current' => 'new', 'done' => [], 'stopped' => false, 'hint' => 'So moi qua han de test tab Qua han.'],
            ['key' => 'three_today', 'status' => 'hen-goi-lai', 'days_back' => 3, 'current' => '3_days', 'done' => ['new'], 'stopped' => false, 'hint' => 'Den lich 3 ngay, cot Trang thai hien So 3 ngay truoc.'],
            ['key' => 'three_overdue', 'status' => 'knm1', 'days_back' => 4, 'current' => '3_days', 'done' => ['new'], 'stopped' => false, 'hint' => 'Lich 3 ngay bi tre 1 ngay.'],
            ['key' => 'three_overdue_more', 'status' => 'cho-xem-lai', 'days_back' => 6, 'current' => '3_days', 'done' => ['new'], 'stopped' => false, 'hint' => 'Lich 3 ngay bi tre nhieu ngay.'],
            ['key' => 'seven_today', 'status' => 'hen-goi-lai', 'days_back' => 7, 'current' => '7_days', 'done' => ['new', '3_days'], 'stopped' => false, 'hint' => 'Den lich 7 ngay, cot Trang thai hien So 7 ngay truoc.'],
            ['key' => 'seven_overdue', 'status' => 'knm2', 'days_back' => 9, 'current' => '7_days', 'done' => ['new', '3_days'], 'stopped' => false, 'hint' => 'Lich 7 ngay qua han.'],
            ['key' => 'future_3_days', 'status' => 'hen-goi-lai', 'days_back' => 2, 'current' => 'future', 'done' => ['new'], 'stopped' => false, 'hint' => 'Da goi, chua den lich 3 ngay nen chi thay trong tab Tat ca.'],
            ['key' => 'done_all_called', 'status' => 'hen-goi-lai', 'days_back' => 12, 'current' => 'done', 'done' => ['new', '3_days', '7_days'], 'stopped' => false, 'hint' => 'Da xu ly het cac luot nhac.'],
            ['key' => 'closed', 'status' => 'da-chot', 'days_back' => 8, 'current' => 'done', 'done' => ['new', '3_days', '7_days'], 'stopped' => false, 'hint' => 'Da chot de test tao don.'],
            ['key' => 'order_created', 'status' => 'da-tao-don', 'days_back' => 10, 'current' => 'stopped', 'done' => ['new', '3_days'], 'stopped' => true, 'hint' => 'Da tao don, chan nut tao don va dung nhac.'],
            ['key' => 'no_need', 'status' => 'huy-don', 'days_back' => 11, 'current' => 'stopped', 'done' => ['new'], 'stopped' => true, 'hint' => 'Khong nhu cau, dung nhac va an khoi viec hom nay.'],
            ['key' => 'wrong_phone', 'status' => 'sai-sdt', 'days_back' => 13, 'current' => 'stopped', 'done' => ['new'], 'stopped' => true, 'hint' => 'Sai so dien thoai, test loc trang thai.'],
            ['key' => 'knm3_seven', 'status' => 'knm3', 'days_back' => 14, 'current' => '7_days', 'done' => ['new', '3_days'], 'stopped' => false, 'hint' => 'Khong nghe may lan 3 nhung van den luot 7 ngay.'],
            ['key' => 'potential_three', 'status' => 'cho-xem-lai', 'days_back' => 3, 'current' => '3_days', 'done' => ['new'], 'stopped' => false, 'hint' => 'Khach tiem nang den lich 3 ngay.'],
        ];

        return $cases[($index - 1) % count($cases)];
    }

    private function statusForCase(Collection $statuses, array $case): ?LeadStatus
    {
        return $statuses->get($case['status'])
            ?: $statuses->get('don-moi')
            ?: $statuses->values()->first();
    }

    private function placedAtForCase(Carbon $now, array $case, int $index): Carbon
    {
        $date = $now->copy()
            ->startOfDay()
            ->subDays((int) $case['days_back'])
            ->addHours(8 + ($index % 10))
            ->addMinutes(($index * 7) % 50);

        if ($date->gte($now)) {
            $date = $now->copy()->subMinutes(10 + $index);
        }

        return $date;
    }

    private function potentialForIndex(Collection $potentials, int $index): ?string
    {
        $active = $potentials
            ->filter(fn (LeadPotential $potential) => $potential->is_active !== false)
            ->values();

        if ($active->isEmpty()) {
            return null;
        }

        return $active[($index - 1) % $active->count()]->code;
    }

    private function nextFollowUpForCase(Carbon $placedAt, array $case, bool $stopped): ?Carbon
    {
        if ($stopped || $case['current'] === 'done') {
            return null;
        }

        return match ($case['current']) {
            'new' => $placedAt->copy()->startOfDay(),
            '3_days' => $placedAt->copy()->startOfDay()->addDays(3)->setTime(9, 0),
            '7_days' => $placedAt->copy()->startOfDay()->addDays(7)->setTime(9, 0),
            'future' => $placedAt->copy()->startOfDay()->addDays(3)->setTime(9, 0),
            default => null,
        };
    }

    private function scriptForCase(array $case, bool $stopped): ?string
    {
        if ($stopped || $case['current'] === 'done') {
            return null;
        }

        return match ($case['current']) {
            'new', '3_days', 'future' => '3_days',
            '7_days' => '7_days',
            default => null,
        };
    }

    private function intervalForCase(array $case, bool $stopped): ?int
    {
        if ($stopped || $case['current'] === 'done') {
            return null;
        }

        return $case['current'] === '7_days' ? 7 : 3;
    }

    private function lastContactForCase(Carbon $placedAt, array $case, Carbon $now): ?Carbon
    {
        if (in_array('new', $case['done'], true) || $case['current'] === 'done') {
            return $this->safeCompletedAt($placedAt->copy()->addHours(2), $now);
        }

        return null;
    }

    private function createFollowUpTasks(Lead $lead, Carbon $placedAt, array $case, Carbon $now): void
    {
        if (!Schema::hasTable('lead_follow_up_tasks')) {
            return;
        }

        $baseDate = $placedAt->copy()->startOfDay();
        $definitions = [
            LeadFollowUpTask::TYPE_NEW => $baseDate->copy(),
            LeadFollowUpTask::TYPE_THREE_DAYS => $baseDate->copy()->addDays(3),
            LeadFollowUpTask::TYPE_SEVEN_DAYS => $baseDate->copy()->addDays(7),
        ];

        foreach ($definitions as $type => $dueDate) {
            $status = LeadFollowUpTask::STATUS_PENDING;
            $completedAt = null;
            $completedActivityType = null;

            if (in_array($type, $case['done'], true)) {
                $status = LeadFollowUpTask::STATUS_COMPLETED;
                $completedAt = $this->safeCompletedAt($dueDate->copy()->setTime(10, 0), $now);
                $completedActivityType = 'status';
            }

            if ($case['current'] === 'stopped' && !in_array($type, $case['done'], true)) {
                $status = LeadFollowUpTask::STATUS_STOPPED;
                $completedAt = $this->safeCompletedAt($placedAt->copy()->addHours(3), $now);
                $completedActivityType = 'schedule';
            }

            $task = LeadFollowUpTask::withoutGlobalScopes()->create([
                'account_id' => $lead->account_id,
                'lead_id' => $lead->id,
                'task_type' => $type,
                'due_date' => $dueDate->toDateString(),
                'status' => $status,
                'completed_at' => $completedAt,
                'completed_by' => null,
                'completed_activity_type' => $completedActivityType,
            ]);

            $task->forceFill([
                'created_at' => $placedAt,
                'updated_at' => $completedAt ?: $placedAt,
            ])->save();
        }
    }

    private function createDemoNotes(
        Lead $lead,
        ?LeadStatus $status,
        ?LeadStaff $staff,
        Carbon $placedAt,
        ?string $potential,
        array $case,
        Carbon $now,
        int $index
    ): LeadNote {
        $notes = [
            [
                'content' => "Nhap demo {$case['key']}: {$case['hint']}",
                'activity_type' => 'import',
                'created_at' => $placedAt->copy()->addMinutes(5),
            ],
            [
                'content' => $this->workflowNoteForCase($case, $status),
                'activity_type' => in_array('new', $case['done'], true) ? 'call' : 'note',
                'created_at' => $placedAt->copy()->addHours(2),
            ],
            [
                'content' => $this->latestNoteForStatus($status, $case, $index),
                'activity_type' => $index % 4 === 0 ? 'zalo' : 'note',
                'created_at' => $placedAt->copy()->addHours(4 + ($index % 3)),
            ],
        ];

        $latest = null;
        foreach ($notes as $noteData) {
            $createdAt = $this->safeCompletedAt($noteData['created_at'], $now);
            $latest = LeadNote::withoutGlobalScopes()->create([
                'account_id' => $lead->account_id,
                'lead_id' => $lead->id,
                'user_id' => null,
                'staff_name' => $staff?->name ?? 'Sale demo',
                'content' => $noteData['content'],
                'activity_type' => $noteData['activity_type'],
                'next_follow_up_at' => $lead->next_follow_up_at,
                'potential_level' => $potential,
                'lead_status_id' => $status?->id,
                'assigned_staff_id' => $staff?->id,
            ]);
            $latest->forceFill([
                'created_at' => $createdAt,
                'updated_at' => $createdAt,
            ])->save();
        }

        return $latest;
    }

    private function workflowNoteForCase(array $case, ?LeadStatus $status): string
    {
        return match ($case['current']) {
            'new' => 'Chua xu ly luot so moi. Sale doi trang thai sang Da goi sau khi goi xong.',
            '3_days' => 'Da xu ly luot moi, hien dang can goi lai theo moc 3 ngay.',
            '7_days' => 'Da xu ly luot 3 ngay, hien dang can goi lai theo moc 7 ngay.',
            'future' => 'Da goi lan dau, chua den lich 3 ngay nen chi thay trong tab Tat ca.',
            'done' => 'Da xu ly het cac luot nhac, dung de test lich su va tab Tat ca.',
            'stopped' => 'Da dung nhac theo trang thai ' . ($status?->name ?: 'dung cham soc') . '.',
            default => 'Ghi chu demo workflow telesales.',
        };
    }

    private function latestNoteForStatus(?LeadStatus $status, array $case, int $index): string
    {
        return match ($status?->code) {
            'don-moi' => "Demo #{$index}: so moi can goi, case {$case['key']}.",
            'hen-goi-lai' => "Demo #{$index}: da goi truoc do, cho luot nhac tiep theo.",
            'knm1', 'knm2', 'knm3' => "Demo #{$index}: khong nghe may, test loc qua han va trang thai.",
            'cho-xem-lai' => "Demo #{$index}: khach co nhu cau, can bam sat.",
            'da-chot' => "Demo #{$index}: khach da chot, bam Tao don de test luong sang don hang.",
            'da-tao-don' => "Demo #{$index}: da tao don, test chan tao don va dung nhac.",
            'huy-don' => "Demo #{$index}: khong nhu cau, test khach dung nhac.",
            'sai-sdt' => "Demo #{$index}: sai so, test loc va an khoi viec.",
            default => "Demo #{$index}: ghi chu moi nhat cho {$case['key']}.",
        };
    }

    private function safeCompletedAt(Carbon $value, Carbon $now): Carbon
    {
        return $value->gt($now) ? $now->copy()->subMinutes(3) : $value;
    }

    private function isStoppedStatus(?LeadStatus $status): bool
    {
        return in_array($status?->code, ['huy-don', 'sai-sdt', 'da-tao-don'], true);
    }

    private function isClosedStatus(?LeadStatus $status): bool
    {
        return in_array($status?->code, ['da-chot', 'da-tao-don'], true);
    }

    private function customerName(int $index, array $case): string
    {
        $names = [
            'Nguyen Thi Lan',
            'Tran Van Minh',
            'Le Thu Ha',
            'Pham Quoc Anh',
            'Hoang Bao Ngoc',
            'Doan Thanh Tung',
            'Vu Ngoc Nam',
            'Bui Khanh Linh',
            'Dang Minh Chau',
            'Test pancake',
        ];

        return $names[($index - 1) % count($names)] . ' #' . str_pad((string) $index, 2, '0', STR_PAD_LEFT) . ' - ' . $case['key'];
    }

    private function phoneForIndex(int $accountId, int $index): string
    {
        $prefixes = ['098', '034', '091', '094', '090', '093', '070', '076', '056', '058', '099', '087', '055'];
        $prefix = $prefixes[($index - 1) % count($prefixes)];
        $tail = (($accountId % 90) * 100000) + ($index % 100000);

        return $prefix . str_pad((string) $tail, 7, '0', STR_PAD_LEFT);
    }

    private function addressForIndex(int $index): string
    {
        $addresses = [
            'Ha Noi',
            'Hai Phong',
            'Da Nang',
            'TP Ho Chi Minh',
            'Bac Ninh',
            'Quang Ninh',
            'Nam Dinh',
            'Thanh Hoa',
        ];

        return $addresses[($index - 1) % count($addresses)];
    }

    private function sourceForIndex(int $index): string
    {
        $sources = ['website', 'facebook', 'zalo', 'hotline', 'excel', 'telesales'];

        return $sources[($index - 1) % count($sources)];
    }

    private function productSummaryForIndex(int $index): string
    {
        $summaries = [
            'Bat huong men ran',
            'Bo do tho men lam',
            'Loc binh gom su',
            'Am chen qua tang',
            'Don hang gom Bat Trang',
        ];

        return $summaries[($index - 1) % count($summaries)];
    }

    private function messageForCase(array $case): string
    {
        return 'Du lieu demo CRM telesales - ' . $case['hint'];
    }
}
