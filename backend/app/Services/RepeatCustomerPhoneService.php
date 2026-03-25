<?php

namespace App\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class RepeatCustomerPhoneService
{
    public function buildLeadMeta(Collection $leads, int $accountId): array
    {
        return $this->buildMeta($leads, $accountId, 'lead', 'phone', fn ($lead) => $lead->placed_at ?: $lead->created_at);
    }

    public function buildOrderMeta(Collection $orders, int $accountId): array
    {
        return $this->buildMeta($orders, $accountId, 'order', 'customer_phone', fn ($order) => $order->created_at);
    }

    protected function buildMeta(Collection $records, int $accountId, string $recordType, string $phoneField, callable $dateResolver): array
    {
        if ($accountId <= 0 || $records->isEmpty()) {
            return [];
        }

        $targets = $records
            ->filter(fn ($record) => !empty($record?->id))
            ->map(function ($record) use ($recordType, $phoneField, $dateResolver) {
                $normalizedPhone = $this->normalizePhone($record->{$phoneField} ?? '');
                $eventAt = $dateResolver($record);

                return [
                    'key' => $this->recordKey($recordType, (int) $record->id),
                    'normalized_phone' => $normalizedPhone,
                    'event_at' => $eventAt ? strtotime((string) $eventAt) : 0,
                ];
            })
            ->filter(fn (array $row) => $row['normalized_phone'] !== '')
            ->values();

        if ($targets->isEmpty()) {
            return [];
        }

        $historyRows = $this->loadHistoryRows(
            $accountId,
            $targets->pluck('normalized_phone')->unique()->values()->all()
        );

        $seenCounts = [];
        $historyMeta = [];

        foreach ($historyRows as $row) {
            $phone = $row['normalized_phone'];
            $previousCount = $seenCounts[$phone] ?? 0;

            $historyMeta[$row['key']] = [
                'is_repeat_customer_phone' => $previousCount > 0,
                'repeat_phone_previous_count' => $previousCount,
            ];

            $seenCounts[$phone] = $previousCount + 1;
        }

        return $targets
            ->mapWithKeys(function (array $target) use ($historyMeta) {
                return [
                    $target['key'] => array_merge(
                        [
                            'is_repeat_customer_phone' => false,
                            'repeat_phone_previous_count' => 0,
                        ],
                        $historyMeta[$target['key']] ?? [],
                        ['normalized_phone' => $target['normalized_phone']]
                    ),
                ];
            })
            ->all();
    }

    protected function loadHistoryRows(int $accountId, array $normalizedPhones): Collection
    {
        if ($accountId <= 0 || empty($normalizedPhones)) {
            return collect();
        }

        $leadPhoneSql = $this->normalizedPhoneSql('phone');
        $orderPhoneSql = $this->normalizedPhoneSql('customer_phone');

        $leadRows = DB::table('leads')
            ->selectRaw("id, {$leadPhoneSql} as normalized_phone, COALESCE(placed_at, created_at) as event_at, 'lead' as record_type")
            ->where('account_id', $accountId)
            ->where(function ($query) use ($leadPhoneSql, $normalizedPhones) {
                foreach ($normalizedPhones as $phone) {
                    $query->orWhereRaw("{$leadPhoneSql} = ?", [$phone]);
                }
            })
            ->get();

        $orderRows = DB::table('orders')
            ->selectRaw("id, {$orderPhoneSql} as normalized_phone, created_at as event_at, 'order' as record_type")
            ->where('account_id', $accountId)
            ->where(function ($query) use ($orderPhoneSql, $normalizedPhones) {
                foreach ($normalizedPhones as $phone) {
                    $query->orWhereRaw("{$orderPhoneSql} = ?", [$phone]);
                }
            })
            ->get();

        return $leadRows
            ->concat($orderRows)
            ->filter(fn ($row) => filled($row->normalized_phone))
            ->sort(function ($left, $right) {
                $phoneCompare = strcmp((string) $left->normalized_phone, (string) $right->normalized_phone);
                if ($phoneCompare !== 0) {
                    return $phoneCompare;
                }

                $leftTime = $left->event_at ? strtotime((string) $left->event_at) : 0;
                $rightTime = $right->event_at ? strtotime((string) $right->event_at) : 0;
                if ($leftTime !== $rightTime) {
                    return $leftTime <=> $rightTime;
                }

                $typeCompare = strcmp((string) $left->record_type, (string) $right->record_type);
                if ($typeCompare !== 0) {
                    return $typeCompare;
                }

                return (int) $left->id <=> (int) $right->id;
            })
            ->values()
            ->map(function ($row) {
                return [
                    'key' => $this->recordKey((string) $row->record_type, (int) $row->id),
                    'normalized_phone' => (string) $row->normalized_phone,
                ];
            });
    }

    protected function recordKey(string $recordType, int $id): string
    {
        return "{$recordType}:{$id}";
    }

    protected function normalizePhone(string $value): string
    {
        $digits = preg_replace('/\D+/', '', trim($value));
        if (!$digits) {
            return '';
        }

        if (str_starts_with($digits, '84') && !str_starts_with($digits, '840') && strlen($digits) >= 10 && strlen($digits) <= 11) {
            return '0' . substr($digits, 2);
        }

        return $digits;
    }

    protected function normalizedPhoneSql(string $column): string
    {
        $digitsOnlySql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE({$column}, '')), ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '+', '')";

        return "CASE WHEN LEFT({$digitsOnlySql}, 2) = '84' AND LEFT({$digitsOnlySql}, 3) <> '840' AND CHAR_LENGTH({$digitsOnlySql}) BETWEEN 10 AND 11 THEN CONCAT('0', SUBSTRING({$digitsOnlySql}, 3)) ELSE {$digitsOnlySql} END";
    }
}
