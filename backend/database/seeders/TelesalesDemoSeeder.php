<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\Lead;
use App\Models\LeadNote;
use App\Models\LeadPotential;
use App\Models\LeadStaff;
use App\Models\LeadStatus;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;

class TelesalesDemoSeeder extends Seeder
{
    private const DEMO_TAG = 'CRM-DEMO-TEST';
    private const PER_ACCOUNT_COUNT = 50;

    public function run(): void
    {
        $targetAccountId = (int) env('TELESALES_DEMO_ACCOUNT_ID', 0);
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
            $createdCount = $this->seedAccount((int) $account->id);
            $this->command?->info("Da tao {$createdCount} khach CRM demo cho account #{$account->id} - {$account->name}.");
        }
    }

    private function seedAccount(int $accountId): int
    {
        Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->where('tag', self::DEMO_TAG)
            ->get()
            ->each(fn (Lead $lead) => $lead->forceDelete());

        $statuses = LeadStatus::ensureDefaultsForAccount($accountId)->keyBy('code');
        LeadPotential::ensureDefaultsForAccount($accountId);
        $staffs = $this->ensureStaffs($accountId);
        $now = now();
        $created = 0;

        for ($index = 1; $index <= self::PER_ACCOUNT_COUNT; $index++) {
            $status = $this->statusForIndex($statuses, $index);
            $staff = $staffs[($index - 1) % $staffs->count()] ?? null;
            $daysBack = $this->daysBackForIndex($index);
            $placedAt = $now->copy()->subDays($daysBack)->setTime(8 + ($index % 9), ($index * 7) % 60);
            $stopped = $this->isStoppedStatus($status);
            $followUpAt = $stopped ? null : $this->followUpAtForIndex($now, $index);
            $intervalDays = $followUpAt ? ($index % 2 === 0 ? 7 : 3) : null;
            $potential = $this->potentialForIndex($index);
            $convertedAt = $this->isClosedStatus($status) ? $placedAt->copy()->addDays(min(2, max(0, $daysBack)))->setTime(16, 0) : null;

            $lead = Lead::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'lead_number' => sprintf('CRMDEMO-A%d-%03d', $accountId, $index),
                'lead_status_id' => $status?->id,
                'assigned_staff_id' => $staff?->id,
                'potential_level' => $potential,
                'next_follow_up_at' => $followUpAt,
                'follow_up_script' => $intervalDays ? ($intervalDays === 7 ? '7_days' : '3_days') : null,
                'follow_up_interval_days' => $intervalDays,
                'last_contacted_at' => $index % 4 === 0 ? null : $placedAt->copy()->addHours(2),
                'do_not_call' => $stopped,
                'customer_name' => $this->customerName($index),
                'phone' => sprintf('09%02d%06d', $accountId % 100, 1000 + $index),
                'zalo_phone' => $index % 5 === 0 ? sprintf('08%02d%06d', $accountId % 100, 1000 + $index) : sprintf('09%02d%06d', $accountId % 100, 1000 + $index),
                'email' => null,
                'address' => $this->addressForIndex($index),
                'product_name' => 'Tu van CRM demo',
                'product_summary' => $this->productSummaryForIndex($index),
                'product_summary_short' => 'CRM demo',
                'message' => 'Du lieu demo CRM telesales de test trang thai, nhac lai, ghi chu va tao don.',
                'source' => $this->sourceForIndex($index),
                'tag' => self::DEMO_TAG,
                'status' => $status?->code ?? 'don-moi',
                'placed_at' => $placedAt,
                'converted_at' => $convertedAt,
                'status_changed_at' => $placedAt->copy()->addHours(1),
                'notes' => null,
                'payload_snapshot' => [
                    'demo_seed' => true,
                    'days_back' => $daysBack,
                    'follow_up_case' => $followUpAt?->toDateTimeString(),
                ],
                'conversion_data' => $convertedAt ? ['demo_converted' => true] : [],
            ]);

            $lead->forceFill([
                'created_at' => $placedAt,
                'updated_at' => $placedAt,
            ])->save();

            $latestNote = $this->createDemoNotes($lead, $status, $staff, $placedAt, $potential, $followUpAt, $index);
            $lead->forceFill([
                'latest_note_excerpt' => mb_strimwidth($latestNote->content, 0, 180, '...'),
                'last_noted_at' => $latestNote->created_at,
                'updated_at' => $latestNote->created_at,
            ])->save();

            $created++;
        }

        return $created;
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

    private function statusForIndex(Collection $statuses, int $index): ?LeadStatus
    {
        $codes = [
            'don-moi',
            'hen-goi-lai',
            'knm1',
            'cho-xem-lai',
            'da-chot',
            'huy-don',
            'da-tao-don',
            'sai-sdt',
            'knm2',
            'knm3',
        ];

        return $statuses->get($codes[($index - 1) % count($codes)])
            ?: $statuses->values()->get(($index - 1) % max(1, $statuses->count()));
    }

    private function daysBackForIndex(int $index): int
    {
        $days = [0, 1, 2, 3, 3, 4, 5, 7, 7, 10, 10, 12, 14, 16, 18, 20];

        return $days[($index - 1) % count($days)];
    }

    private function followUpAtForIndex(Carbon $now, int $index): ?Carbon
    {
        return match ($index % 12) {
            0 => $now->copy()->subDays(10)->setTime(9, 0),
            1 => $now->copy()->subDays(7)->setTime(9, 0),
            2 => $now->copy()->subDays(3)->setTime(9, 0),
            3 => $now->copy()->subDay()->setTime(9, 0),
            4 => $now->copy()->setTime(9, 0),
            5 => $now->copy()->setTime(14, 0),
            6 => $now->copy()->addDays(3)->setTime(9, 0),
            7 => $now->copy()->addDays(7)->setTime(9, 0),
            8 => $now->copy()->addDays(10)->setTime(9, 0),
            default => null,
        };
    }

    private function potentialForIndex(int $index): ?string
    {
        $potentials = ['hot', 'high', 'medium', 'low', 'unqualified', null];

        return $potentials[($index - 1) % count($potentials)];
    }

    private function createDemoNotes(
        Lead $lead,
        ?LeadStatus $status,
        ?LeadStaff $staff,
        Carbon $placedAt,
        ?string $potential,
        ?Carbon $followUpAt,
        int $index
    ): LeadNote {
        $notes = [
            [
                'content' => 'Nhap khach demo tu danh sach test CRM telesales.',
                'activity_type' => 'import',
                'created_at' => $placedAt->copy()->addMinutes(5),
            ],
            [
                'content' => $index % 3 === 0
                    ? 'Khach chua nghe may, can goi lai theo lich.'
                    : 'Da goi tu van nhanh, ghi nhan nhu cau va phan loai khach.',
                'activity_type' => 'call',
                'created_at' => $placedAt->copy()->addHours(2),
            ],
            [
                'content' => $this->latestNoteForStatus($status, $index),
                'activity_type' => $index % 4 === 0 ? 'zalo' : 'note',
                'created_at' => $placedAt->copy()->addHours(5 + ($index % 4)),
            ],
        ];

        $latest = null;
        foreach ($notes as $noteData) {
            $latest = LeadNote::withoutGlobalScopes()->create([
                'account_id' => $lead->account_id,
                'lead_id' => $lead->id,
                'user_id' => null,
                'staff_name' => $staff?->name ?? 'Sale demo',
                'content' => $noteData['content'],
                'activity_type' => $noteData['activity_type'],
                'next_follow_up_at' => $followUpAt,
                'potential_level' => $potential,
                'lead_status_id' => $status?->id,
                'assigned_staff_id' => $staff?->id,
            ]);
            $latest->forceFill([
                'created_at' => $noteData['created_at'],
                'updated_at' => $noteData['created_at'],
            ])->save();
        }

        return $latest;
    }

    private function latestNoteForStatus(?LeadStatus $status, int $index): string
    {
        $name = $status?->name ?: 'Chua chon';

        return match ($status?->code) {
            'don-moi' => 'Khach moi can cham lan dau, uu tien goi trong hom nay.',
            'hen-goi-lai' => 'Da goi va hen khach xem mau, tiep tuc bam sat nhu cau.',
            'knm1', 'knm2', 'knm3' => "Trang thai {$name}, can test loc qua han va nhac lai.",
            'cho-xem-lai' => 'Khach co nhu cau that, dang can bao gia va hinh anh san pham.',
            'da-chot' => 'Khach da chot, bam Tao don de test luong sang bang tao don.',
            'da-tao-don' => 'Da tao don demo, dung de test trang thai chan tao don.',
            'huy-don' => 'Khach khong co nhu cau, dung nhac lai de test an khoi viec hom nay.',
            'sai-sdt' => 'Sai so dien thoai, dung nhac lai va test loc trang thai.',
            default => "Ghi chu moi nhat demo #{$index} cho trang thai {$name}.",
        };
    }

    private function isStoppedStatus(?LeadStatus $status): bool
    {
        return in_array($status?->code, ['huy-don', 'sai-sdt'], true);
    }

    private function isClosedStatus(?LeadStatus $status): bool
    {
        return in_array($status?->code, ['da-chot', 'da-tao-don'], true);
    }

    private function customerName(int $index): string
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

        return $names[($index - 1) % count($names)] . ' #' . str_pad((string) $index, 2, '0', STR_PAD_LEFT);
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
}
