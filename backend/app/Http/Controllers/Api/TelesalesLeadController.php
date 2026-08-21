<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadNote;
use App\Models\LeadStaff;
use App\Models\LeadStatus;
use App\Services\Leads\LeadCaptureService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class TelesalesLeadController extends Controller
{
    private const POTENTIAL_OPTIONS = [
        ['value' => 'hot', 'label' => 'Rất tiềm năng', 'color' => '#dc2626'],
        ['value' => 'high', 'label' => 'Cao', 'color' => '#16a34a'],
        ['value' => 'medium', 'label' => 'Trung bình', 'color' => '#d97706'],
        ['value' => 'low', 'label' => 'Thấp', 'color' => '#64748b'],
        ['value' => 'unqualified', 'label' => 'Không tiềm năng', 'color' => '#475569'],
    ];

    private const FOLLOW_UP_SCRIPTS = [
        ['value' => 'same_day', 'label' => 'Gọi trong ngày', 'days' => 0],
        ['value' => '3_days', 'label' => 'Gọi lại sau 3 ngày', 'days' => 3],
        ['value' => '7_days', 'label' => 'Gọi lại sau 7 ngày', 'days' => 7],
        ['value' => '30_days', 'label' => 'Nuôi lại sau 30 ngày', 'days' => 30],
        ['value' => 'custom', 'label' => 'Ngày tùy chọn', 'days' => null],
    ];

    private const ACTIVITY_TYPES = [
        ['value' => 'note', 'label' => 'Ghi chú'],
        ['value' => 'call', 'label' => 'Gọi điện'],
        ['value' => 'zalo', 'label' => 'Nhắn Zalo'],
        ['value' => 'schedule', 'label' => 'Đặt lịch'],
        ['value' => 'status', 'label' => 'Đổi trạng thái'],
        ['value' => 'import', 'label' => 'Nhập khách'],
    ];

    public function __construct(private readonly LeadCaptureService $leadCaptureService)
    {
    }

    public function bootstrap(Request $request)
    {
        $accountId = $this->accountId($request);
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);

        return response()->json([
            'statuses' => $statuses->map(fn (LeadStatus $status) => $this->transformStatus($status))->values(),
            'staffs' => $this->staffQuery($accountId)->get()->map(fn (LeadStaff $staff) => $this->transformStaff($staff))->values(),
            'potentials' => self::POTENTIAL_OPTIONS,
            'follow_up_scripts' => self::FOLLOW_UP_SCRIPTS,
            'activity_types' => self::ACTIVITY_TYPES,
        ]);
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);

        $query = $this->scopedLeadQuery($request)
            ->with(['statusConfig', 'assignedStaff', 'latestNote'])
            ->withCount('notesTimeline');

        $this->applyFilters($query, $request);
        $this->applyQueueFilter($query, (string) $request->input('queue', 'today'));

        $sortBy = (string) $request->input('sort_by', 'next_follow_up_at');
        $sortDirection = $request->input('sort_order') === 'asc' ? 'asc' : 'desc';
        if (!in_array($sortBy, ['next_follow_up_at', 'placed_at', 'last_contacted_at', 'customer_name', 'updated_at'], true)) {
            $sortBy = 'next_follow_up_at';
        }

        if ($sortBy === 'next_follow_up_at') {
            $query->orderByRaw('CASE WHEN next_follow_up_at IS NULL THEN 1 ELSE 0 END');
        }

        $query->orderBy($sortBy, $sortDirection)->orderByDesc('id');

        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginator = $query->paginate($perPage);
        $items = collect($paginator->items());

        return response()->json([
            'data' => $items->map(fn (Lead $lead) => $this->transformLead($lead))->values(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'stats' => $this->stats($request),
            'statuses' => $statuses->map(fn (LeadStatus $status) => $this->transformStatus($status))->values(),
        ]);
    }

    public function show(Request $request, int $id)
    {
        $lead = $this->scopedLeadQuery($request)
            ->with([
                'statusConfig',
                'assignedStaff',
                'notesTimeline.statusConfig',
                'notesTimeline.assignedStaff',
                'notesTimeline.user',
            ])
            ->withCount('notesTimeline')
            ->findOrFail($id);

        return response()->json($this->transformLead($lead) + [
            'notes_timeline' => $lead->notesTimeline
                ->map(fn (LeadNote $note) => $this->transformNote($note))
                ->values(),
        ]);
    }

    public function import(Request $request)
    {
        $accountId = $this->accountId($request);
        $validated = $request->validate([
            'phones_text' => 'nullable|string|max:20000',
            'phones' => 'nullable|array',
            'phones.*' => 'nullable',
            'customer_name' => 'nullable|string|max:255',
            'source' => 'nullable|string|max:50',
            'tag' => 'nullable|string|max:120',
            'assigned_staff_id' => [
                'nullable',
                'integer',
                Rule::exists('lead_staffs', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'potential_level' => ['nullable', Rule::in($this->potentialValues())],
            'follow_up_script' => ['nullable', Rule::in($this->followUpScriptValues())],
            'note' => 'nullable|string|max:5000',
        ]);

        $rows = $this->parsePhoneRows(
            (string) ($validated['phones_text'] ?? ''),
            $validated['phones'] ?? []
        );

        if ($rows->isEmpty()) {
            return response()->json(['message' => 'Chưa tìm thấy số điện thoại hợp lệ để nhập.'], 422);
        }

        $defaultStatus = LeadStatus::ensureDefaultsForAccount($accountId)
            ->firstWhere('is_default', true)
            ?: LeadStatus::withoutGlobalScopes()->where('account_id', $accountId)->orderBy('sort_order')->first();

        $existingByPhone = $this->existingLeadMapByPhone($accountId);
        $created = collect();
        $duplicates = collect();
        $seenInBatch = [];
        $now = now();

        foreach ($rows as $row) {
            $normalizedPhone = $row['normalized_phone'];

            if (isset($seenInBatch[$normalizedPhone])) {
                $duplicates->push([
                    'phone' => $row['phone'],
                    'normalized_phone' => $normalizedPhone,
                    'reason' => 'Trùng trong danh sách vừa nhập',
                ]);
                continue;
            }

            $seenInBatch[$normalizedPhone] = true;

            if ($existingByPhone->has($normalizedPhone)) {
                $lead = $existingByPhone->get($normalizedPhone);
                $duplicates->push([
                    'phone' => $row['phone'],
                    'normalized_phone' => $normalizedPhone,
                    'reason' => 'Đã tồn tại trong hệ thống',
                    'lead' => $this->transformLead($lead),
                ]);
                continue;
            }

            $script = $validated['follow_up_script'] ?? 'same_day';
            $intervalDays = $this->daysForScript($script);

            $lead = Lead::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'lead_number' => $this->leadCaptureService->generateLeadNumber($accountId),
                'lead_status_id' => $defaultStatus?->id,
                'assigned_staff_id' => $validated['assigned_staff_id'] ?? null,
                'potential_level' => $validated['potential_level'] ?? null,
                'next_follow_up_at' => $this->followUpDateFromDays($intervalDays),
                'follow_up_script' => $script,
                'follow_up_interval_days' => $intervalDays,
                'customer_name' => $row['customer_name'] ?: ($validated['customer_name'] ?? 'Khách telesales'),
                'phone' => $normalizedPhone,
                'product_name' => 'Tư vấn telesales',
                'product_summary' => 'Khách nhập thủ công từ telesales',
                'product_summary_short' => 'Tư vấn telesales',
                'source' => $validated['source'] ?? 'telesales',
                'tag' => $validated['tag'] ?? 'Telesales',
                'status' => $defaultStatus?->code ?? 'new',
                'placed_at' => $now,
                'payload_snapshot' => [
                    'manual_telesales_import' => true,
                    'raw_phone' => $row['phone'],
                    'raw_line' => $row['raw_line'],
                ],
                'conversion_data' => [],
            ]);

            $noteContent = trim((string) ($validated['note'] ?? ''));
            $this->createLeadNote($lead, $request, $noteContent ?: 'Nhập khách telesales thủ công.', 'import');

            $lead->load(['statusConfig', 'assignedStaff', 'latestNote']);
            $created->push($this->transformLead($lead));
            $existingByPhone->put($normalizedPhone, $lead);
        }

        return response()->json([
            'created_count' => $created->count(),
            'duplicate_count' => $duplicates->count(),
            'created' => $created->values(),
            'duplicates' => $duplicates->values(),
            'stats' => $this->stats($request),
        ], 201);
    }

    public function update(Request $request, int $id)
    {
        $accountId = $this->accountId($request);
        $lead = $this->scopedLeadQuery($request)
            ->with(['statusConfig', 'assignedStaff'])
            ->findOrFail($id);

        $validated = $request->validate([
            'lead_status_id' => [
                'nullable',
                'integer',
                Rule::exists('lead_statuses', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'assigned_staff_id' => [
                'nullable',
                'integer',
                Rule::exists('lead_staffs', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'potential_level' => ['nullable', Rule::in($this->potentialValues())],
            'next_follow_up_at' => 'nullable|date',
            'follow_up_script' => ['nullable', Rule::in($this->followUpScriptValues())],
            'follow_up_interval_days' => 'nullable|integer|min:0|max:365',
            'do_not_call' => 'nullable|boolean',
            'note' => 'nullable|string|max:5000',
            'activity_type' => ['nullable', Rule::in($this->activityTypeValues())],
        ]);

        $activityType = (string) ($validated['activity_type'] ?? 'note');
        $status = null;

        if (array_key_exists('lead_status_id', $validated)) {
            $status = !empty($validated['lead_status_id'])
                ? LeadStatus::withoutGlobalScopes()
                    ->where('account_id', $accountId)
                    ->findOrFail((int) $validated['lead_status_id'])
                : null;

            $lead->lead_status_id = $status?->id;
            $lead->status = $status?->code ?? $lead->status;
            $lead->status_changed_at = now();
        }

        foreach (['assigned_staff_id', 'potential_level', 'follow_up_script', 'follow_up_interval_days'] as $field) {
            if (array_key_exists($field, $validated)) {
                $lead->{$field} = $validated[$field];
            }
        }

        if (array_key_exists('next_follow_up_at', $validated)) {
            $lead->next_follow_up_at = !empty($validated['next_follow_up_at'])
                ? Carbon::parse($validated['next_follow_up_at'])
                : null;
        } elseif (array_key_exists('follow_up_interval_days', $validated) && $validated['follow_up_interval_days'] !== null) {
            $lead->next_follow_up_at = $this->followUpDateFromDays((int) $validated['follow_up_interval_days']);
        }

        if (array_key_exists('follow_up_script', $validated) && !array_key_exists('follow_up_interval_days', $validated)) {
            $intervalDays = $this->daysForScript($validated['follow_up_script']);
            $lead->follow_up_interval_days = $intervalDays;
            if ($intervalDays !== null && !array_key_exists('next_follow_up_at', $validated)) {
                $lead->next_follow_up_at = $this->followUpDateFromDays($intervalDays);
            }
        }

        if (array_key_exists('do_not_call', $validated)) {
            $lead->do_not_call = (bool) $validated['do_not_call'];
            if ($lead->do_not_call) {
                $lead->next_follow_up_at = null;
            }
        }

        if (in_array($activityType, ['call', 'zalo'], true)) {
            $lead->last_contacted_at = now();
        }

        $lead->save();

        $noteContent = trim((string) ($validated['note'] ?? ''));
        if ($noteContent !== '' || $activityType !== 'note') {
            $this->createLeadNote($lead, $request, $noteContent ?: $this->defaultActivityContent($activityType), $activityType);
        }

        $lead->load(['statusConfig', 'assignedStaff', 'latestNote'])->loadCount('notesTimeline');

        return response()->json([
            'lead' => $this->transformLead($lead),
            'stats' => $this->stats($request),
        ]);
    }

    private function accountId(Request $request): int
    {
        return (int) $request->header('X-Account-Id');
    }

    private function scopedLeadQuery(Request $request): Builder
    {
        return Lead::withoutGlobalScopes()
            ->where('account_id', $this->accountId($request));
    }

    private function staffQuery(int $accountId): Builder
    {
        return LeadStaff::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->orderBy('sort_order')
            ->orderBy('id');
    }

    private function applyFilters(Builder $query, Request $request): void
    {
        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function (Builder $builder) use ($search) {
                $builder->where('customer_name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('lead_number', 'like', "%{$search}%")
                    ->orWhere('product_summary', 'like', "%{$search}%")
                    ->orWhere('latest_note_excerpt', 'like', "%{$search}%");
            });
        }

        if ($request->filled('staff_id')) {
            $staffId = $request->input('staff_id');
            if ($staffId === 'unassigned') {
                $query->whereNull('assigned_staff_id');
            } else {
                $query->where('assigned_staff_id', (int) $staffId);
            }
        }

        if ($request->filled('status_id')) {
            $query->where('lead_status_id', (int) $request->input('status_id'));
        }

        if ($request->filled('potential_level')) {
            $query->where('potential_level', $request->input('potential_level'));
        }

        if ($request->filled('date_from')) {
            $query->where('placed_at', '>=', Carbon::parse($request->input('date_from'))->startOfDay());
        }

        if ($request->filled('date_to')) {
            $query->where('placed_at', '<=', Carbon::parse($request->input('date_to'))->endOfDay());
        }

        if (!$request->boolean('include_stopped')) {
            $query->where('do_not_call', false);
        }
    }

    private function applyQueueFilter(Builder $query, string $queue): void
    {
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();

        match ($queue) {
            'all' => null,
            'new_today' => $query->whereBetween('placed_at', [$todayStart, $todayEnd]),
            'overdue' => $query->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<', $todayStart),
            '3_days' => $query->where('follow_up_interval_days', 3)->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<=', $todayEnd),
            '7_days' => $query->where('follow_up_interval_days', 7)->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<=', $todayEnd),
            default => $query->where(function (Builder $builder) use ($todayStart, $todayEnd) {
                $builder->whereNotNull('next_follow_up_at')
                    ->where('next_follow_up_at', '<=', $todayEnd)
                    ->orWhere(function (Builder $newLeadQuery) use ($todayStart, $todayEnd) {
                        $newLeadQuery->whereNull('last_contacted_at')
                            ->whereBetween('placed_at', [$todayStart, $todayEnd]);
                    });
            }),
        };
    }

    private function stats(Request $request): array
    {
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();
        $base = $this->scopedLeadQuery($request)->where('do_not_call', false);

        $todayDue = clone $base;
        $newToday = clone $base;
        $threeDayDue = clone $base;
        $sevenDayDue = clone $base;
        $overdue = clone $base;
        $highPotential = clone $base;
        $unassigned = clone $base;

        return [
            'today_due' => $todayDue
                ->where(function (Builder $builder) use ($todayStart, $todayEnd) {
                    $builder->whereNotNull('next_follow_up_at')
                        ->where('next_follow_up_at', '<=', $todayEnd)
                        ->orWhere(function (Builder $newLeadQuery) use ($todayStart, $todayEnd) {
                            $newLeadQuery->whereNull('last_contacted_at')
                                ->whereBetween('placed_at', [$todayStart, $todayEnd]);
                        });
                })
                ->count(),
            'new_today' => $newToday->whereBetween('placed_at', [$todayStart, $todayEnd])->count(),
            'three_day_due' => $threeDayDue->where('follow_up_interval_days', 3)->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<=', $todayEnd)->count(),
            'seven_day_due' => $sevenDayDue->where('follow_up_interval_days', 7)->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<=', $todayEnd)->count(),
            'overdue' => $overdue->whereNotNull('next_follow_up_at')->where('next_follow_up_at', '<', $todayStart)->count(),
            'high_potential' => $highPotential->whereIn('potential_level', ['hot', 'high'])->count(),
            'unassigned' => $unassigned->whereNull('assigned_staff_id')->count(),
        ];
    }

    private function parsePhoneRows(string $phonesText, array $phones): Collection
    {
        $rows = collect();

        foreach (preg_split('/\R+/', $phonesText) ?: [] as $line) {
            $row = $this->parsePhoneLine($line);
            if ($row) {
                $rows->push($row);
            }
        }

        foreach ($phones as $item) {
            if (is_array($item)) {
                $line = trim((string) ($item['phone'] ?? ''));
                $row = $this->parsePhoneLine($line);
                if ($row) {
                    $row['customer_name'] = trim((string) ($item['customer_name'] ?? $item['name'] ?? $row['customer_name']));
                    $rows->push($row);
                }
            } else {
                $row = $this->parsePhoneLine((string) $item);
                if ($row) {
                    $rows->push($row);
                }
            }
        }

        return $rows
            ->filter(fn (array $row) => $row['normalized_phone'] !== '')
            ->values();
    }

    private function parsePhoneLine(string $line): ?array
    {
        $line = trim($line);
        if ($line === '') {
            return null;
        }

        if (!preg_match('/(\+?84|0)[0-9\s.\-()]{8,18}/', $line, $matches)) {
            return null;
        }

        $rawPhone = $matches[0];
        $normalizedPhone = $this->normalizePhone($rawPhone);
        if ($normalizedPhone === '' || strlen($normalizedPhone) < 9) {
            return null;
        }

        $customerName = trim(preg_replace('/\s+/', ' ', str_replace($rawPhone, '', $line)));
        $customerName = trim($customerName, "-,;| \t\n\r\0\x0B");

        return [
            'phone' => $rawPhone,
            'normalized_phone' => $normalizedPhone,
            'customer_name' => $customerName,
            'raw_line' => $line,
        ];
    }

    private function normalizePhone(?string $value): string
    {
        $digits = preg_replace('/\D+/', '', (string) $value) ?: '';

        if (str_starts_with($digits, '84') && strlen($digits) >= 11) {
            $digits = '0' . substr($digits, 2);
        }

        if (!str_starts_with($digits, '0') && strlen($digits) === 9) {
            $digits = '0' . $digits;
        }

        return $digits;
    }

    private function existingLeadMapByPhone(int $accountId): Collection
    {
        return Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->whereNotNull('phone')
            ->with(['statusConfig', 'assignedStaff', 'latestNote'])
            ->get()
            ->mapWithKeys(function (Lead $lead) {
                $phone = $this->normalizePhone($lead->phone);

                return $phone !== '' ? [$phone => $lead] : [];
            });
    }

    private function createLeadNote(Lead $lead, Request $request, string $content, string $activityType): LeadNote
    {
        $note = LeadNote::create([
            'account_id' => $lead->account_id,
            'lead_id' => $lead->id,
            'user_id' => auth()->id(),
            'staff_name' => trim((string) (auth()->user()?->name ?? 'Nhân viên')),
            'content' => $content,
            'activity_type' => $activityType,
            'next_follow_up_at' => $lead->next_follow_up_at,
            'potential_level' => $lead->potential_level,
            'lead_status_id' => $lead->lead_status_id,
            'assigned_staff_id' => $lead->assigned_staff_id,
        ]);

        $lead->forceFill([
            'latest_note_excerpt' => mb_strimwidth($content, 0, 180, '...'),
            'last_noted_at' => now(),
        ])->save();

        return $note;
    }

    private function transformLead(Lead $lead): array
    {
        $nextFollowUpAt = $lead->next_follow_up_at;
        $daysUntilFollowUp = $nextFollowUpAt
            ? now()->startOfDay()->diffInDays($nextFollowUpAt->copy()->startOfDay(), false)
            : null;

        return [
            'id' => $lead->id,
            'lead_number' => $lead->lead_number,
            'customer_name' => $lead->customer_name,
            'phone' => $lead->phone,
            'phone_for_zalo' => $this->normalizePhone($lead->phone),
            'email' => $lead->email,
            'address' => $lead->address,
            'source' => $lead->source,
            'tag' => $lead->tag,
            'product_summary' => $lead->product_summary,
            'message' => $lead->message,
            'lead_status_id' => $lead->lead_status_id,
            'status' => $lead->status,
            'status_config' => $lead->statusConfig ? $this->transformStatus($lead->statusConfig) : null,
            'assigned_staff_id' => $lead->assigned_staff_id,
            'assigned_staff' => $lead->assignedStaff ? $this->transformStaff($lead->assignedStaff) : null,
            'potential_level' => $lead->potential_level,
            'potential_label' => $this->labelForPotential($lead->potential_level),
            'next_follow_up_at' => $this->isoDateTime($nextFollowUpAt),
            'next_follow_up_label' => $this->dateTimeLabel($nextFollowUpAt),
            'follow_up_script' => $lead->follow_up_script,
            'follow_up_interval_days' => $lead->follow_up_interval_days,
            'last_contacted_at' => $this->isoDateTime($lead->last_contacted_at),
            'last_contacted_label' => $this->dateTimeLabel($lead->last_contacted_at),
            'do_not_call' => (bool) $lead->do_not_call,
            'due_bucket' => $this->dueBucket($lead),
            'days_until_follow_up' => $daysUntilFollowUp,
            'latest_note_excerpt' => $lead->latest_note_excerpt,
            'notes_count' => (int) ($lead->notes_timeline_count ?? 0),
            'placed_at' => $this->isoDateTime($lead->placed_at),
            'placed_label' => $this->dateTimeLabel($lead->placed_at),
            'created_at' => $this->isoDateTime($lead->created_at),
            'updated_at' => $this->isoDateTime($lead->updated_at),
        ];
    }

    private function transformNote(LeadNote $note): array
    {
        return [
            'id' => $note->id,
            'staff_name' => $note->staff_name,
            'content' => $note->content,
            'activity_type' => $note->activity_type ?: 'note',
            'activity_label' => $this->labelForActivity($note->activity_type),
            'next_follow_up_at' => $this->isoDateTime($note->next_follow_up_at),
            'next_follow_up_label' => $this->dateTimeLabel($note->next_follow_up_at),
            'potential_level' => $note->potential_level,
            'potential_label' => $this->labelForPotential($note->potential_level),
            'lead_status_id' => $note->lead_status_id,
            'status_config' => $note->statusConfig ? $this->transformStatus($note->statusConfig) : null,
            'assigned_staff_id' => $note->assigned_staff_id,
            'assigned_staff' => $note->assignedStaff ? $this->transformStaff($note->assignedStaff) : null,
            'created_at' => $this->isoDateTime($note->created_at),
            'created_label' => $this->dateTimeLabel($note->created_at),
        ];
    }

    private function transformStatus(LeadStatus $status): array
    {
        return [
            'id' => $status->id,
            'code' => $status->code,
            'name' => $status->name,
            'color' => $status->color,
            'sort_order' => $status->sort_order,
            'is_default' => (bool) $status->is_default,
            'blocks_order_create' => (bool) $status->blocks_order_create,
            'is_active' => (bool) $status->is_active,
        ];
    }

    private function transformStaff(LeadStaff $staff): array
    {
        return [
            'id' => $staff->id,
            'name' => $staff->name,
            'user_id' => $staff->user_id,
            'sort_order' => $staff->sort_order,
            'is_active' => (bool) $staff->is_active,
        ];
    }

    private function dueBucket(Lead $lead): ?string
    {
        if ($lead->do_not_call) {
            return 'stopped';
        }

        if (!$lead->next_follow_up_at) {
            return null;
        }

        if ($lead->next_follow_up_at->lt(now()->startOfDay())) {
            return 'overdue';
        }

        if ($lead->next_follow_up_at->lte(now()->endOfDay())) {
            return 'today';
        }

        return 'future';
    }

    private function followUpDateFromDays(?int $days): ?Carbon
    {
        if ($days === null) {
            return null;
        }

        return now()->addDays($days)->setTime(9, 0);
    }

    private function daysForScript(?string $script): ?int
    {
        $matched = collect(self::FOLLOW_UP_SCRIPTS)->firstWhere('value', $script);

        return $matched['days'] ?? null;
    }

    private function labelForPotential(?string $value): ?string
    {
        $matched = collect(self::POTENTIAL_OPTIONS)->firstWhere('value', $value);

        return $matched['label'] ?? null;
    }

    private function labelForActivity(?string $value): string
    {
        $matched = collect(self::ACTIVITY_TYPES)->firstWhere('value', $value ?: 'note');

        return $matched['label'] ?? 'Ghi chú';
    }

    private function defaultActivityContent(string $activityType): string
    {
        return match ($activityType) {
            'call' => 'Đã gọi điện cho khách.',
            'zalo' => 'Đã nhắn Zalo cho khách.',
            'schedule' => 'Đã cập nhật lịch chăm sóc.',
            'status' => 'Đã cập nhật trạng thái khách.',
            default => 'Đã cập nhật thông tin khách.',
        };
    }

    private function potentialValues(): array
    {
        return collect(self::POTENTIAL_OPTIONS)->pluck('value')->all();
    }

    private function followUpScriptValues(): array
    {
        return collect(self::FOLLOW_UP_SCRIPTS)->pluck('value')->all();
    }

    private function activityTypeValues(): array
    {
        return collect(self::ACTIVITY_TYPES)->pluck('value')->all();
    }

    private function isoDateTime($value): ?string
    {
        if (!$value) {
            return null;
        }

        return Carbon::parse($value)->toIso8601String();
    }

    private function dateTimeLabel($value): ?string
    {
        if (!$value) {
            return null;
        }

        return Carbon::parse($value)->format('d/m/Y H:i');
    }
}
