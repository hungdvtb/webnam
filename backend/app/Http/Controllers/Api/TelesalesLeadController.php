<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Models\LeadFollowUpTask;
use App\Models\LeadNote;
use App\Models\LeadPotential;
use App\Models\LeadStaff;
use App\Models\LeadStatus;
use App\Services\Leads\LeadCaptureService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class TelesalesLeadController extends Controller
{
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

    private const STOP_FOLLOW_UP_STATUS_PATTERNS = [
        'khong co nhu cau',
        'khong nhu cau',
        'chua co nhu cau',
        'chi tham khao',
        'tham khao',
        'khong tiem nang',
        'khong goi nua',
        'tu choi',
        'huy',
        'sai sdt',
        'sai so',
        'so rac',
        'spam',
    ];

    private const STOP_FOLLOW_UP_STATUS_CODE_PATTERNS = [
        'khong-co-nhu-cau',
        'khong-nhu-cau',
        'chua-co-nhu-cau',
        'chi-tham-khao',
        'tham-khao',
        'khong-tiem-nang',
        'khong-goi-nua',
        'tu-choi',
        'huy',
        'sai-sdt',
        'sai-so',
        'so-rac',
        'spam',
    ];

    private const NEW_LEAD_STATUS_CODE_PATTERNS = [
        'don-moi',
        'so-moi',
        'khach-moi',
    ];

    private const TASK_TYPE_LABELS = [
        LeadFollowUpTask::TYPE_NEW => 'Số mới',
        LeadFollowUpTask::TYPE_THREE_DAYS => 'Số 3 ngày trước',
        LeadFollowUpTask::TYPE_SEVEN_DAYS => 'Số 7 ngày trước',
    ];

    public function __construct(private readonly LeadCaptureService $leadCaptureService)
    {
    }

    public function bootstrap(Request $request)
    {
        $accountId = $this->accountId($request);
        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);
        $potentials = LeadPotential::ensureDefaultsForAccount($accountId);

        return response()->json([
            'statuses' => $statuses->map(fn (LeadStatus $status) => $this->transformStatus($status))->values(),
            'staffs' => $this->staffQuery($accountId)->get()->map(fn (LeadStaff $staff) => $this->transformStaff($staff))->values(),
            'potentials' => $potentials->map(fn (LeadPotential $potential) => $this->transformPotential($potential))->values(),
            'follow_up_scripts' => self::FOLLOW_UP_SCRIPTS,
            'activity_types' => self::ACTIVITY_TYPES,
        ]);
    }

    public function index(Request $request)
    {
        $accountId = $this->accountId($request);
        $this->ensureFollowUpTasksForAccount($accountId);

        $statuses = LeadStatus::ensureDefaultsForAccount($accountId);
        $potentials = LeadPotential::ensureDefaultsForAccount($accountId);

        $query = $this->scopedLeadQuery($request)
            ->with([
                'statusConfig',
                'assignedStaff',
                'latestNote',
                'followUpTasks' => fn ($taskQuery) => $taskQuery
                    ->where('status', LeadFollowUpTask::STATUS_PENDING)
                    ->orderBy('due_date')
                    ->orderBy('id'),
            ])
            ->withCount('notesTimeline');

        $this->applyFilters($query, $request);
        $this->applyQueueFilter($query, (string) $request->input('queue', 'today'));

        $sortBy = (string) $request->input('sort_by', 'placed_at');
        $sortDirection = $request->input('sort_order') === 'asc' ? 'asc' : 'desc';
        if (!in_array($sortBy, ['next_follow_up_at', 'placed_at', 'last_contacted_at', 'customer_name', 'updated_at'], true)) {
            $sortBy = 'placed_at';
        }

        if ($sortBy === 'next_follow_up_at') {
            $query->orderByRaw('CASE WHEN next_follow_up_at IS NULL THEN 1 ELSE 0 END');
            $query->orderBy($sortBy, $sortDirection);
        } elseif ($sortBy === 'placed_at') {
            $query->orderByRaw("COALESCE(placed_at, created_at) {$sortDirection}");
        } else {
            $query->orderBy($sortBy, $sortDirection);
        }

        $query->orderBy('id', $sortDirection);

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
            'potentials' => $potentials->map(fn (LeadPotential $potential) => $this->transformPotential($potential))->values(),
        ]);
    }

    public function show(Request $request, int $id)
    {
        $lead = $this->scopedLeadQuery($request)
            ->with([
                'statusConfig',
                'assignedStaff',
                'latestNote',
                'followUpTasks' => fn ($taskQuery) => $taskQuery
                    ->where('status', LeadFollowUpTask::STATUS_PENDING)
                    ->orderBy('due_date')
                    ->orderBy('id'),
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
            'zalo_phone' => 'nullable|string|max:20',
            'source' => 'nullable|string|max:50',
            'tag' => 'nullable|string|max:120',
            'assigned_staff_id' => [
                'nullable',
                'integer',
                Rule::exists('lead_staffs', 'id')->where(fn ($query) => $query->where('account_id', $accountId)),
            ],
            'potential_level' => ['nullable', Rule::in($this->potentialValues($accountId))],
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
        $defaultPotential = LeadPotential::defaultForAccount($accountId);

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

            $script = '3_days';
            $intervalDays = $this->daysForScript($script);

            $lead = Lead::withoutGlobalScopes()->create([
                'account_id' => $accountId,
                'lead_number' => $this->leadCaptureService->generateLeadNumber($accountId),
                'lead_status_id' => $defaultStatus?->id,
                'assigned_staff_id' => $validated['assigned_staff_id'] ?? null,
                'potential_level' => $validated['potential_level'] ?? $defaultPotential?->code,
                'next_follow_up_at' => $this->followUpDateFromDays($intervalDays),
                'follow_up_script' => $script,
                'follow_up_interval_days' => $intervalDays,
                'customer_name' => $row['customer_name'] ?: ($validated['customer_name'] ?? 'Khách telesales'),
                'phone' => $normalizedPhone,
                'zalo_phone' => $row['normalized_zalo_phone'] ?: $normalizedPhone,
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
                    'raw_zalo_phone' => $row['zalo_phone'],
                    'raw_line' => $row['raw_line'],
                ],
                'conversion_data' => [],
            ]);

            $noteContent = trim((string) ($validated['note'] ?? ''));
            $this->createLeadNote($lead, $request, $noteContent ?: 'Nhập khách telesales thủ công.', 'import');
            $this->ensureLeadFollowUpTasks($lead);

            $lead->load([
                'statusConfig',
                'assignedStaff',
                'latestNote',
                'followUpTasks' => fn ($taskQuery) => $taskQuery
                    ->where('status', LeadFollowUpTask::STATUS_PENDING)
                    ->orderBy('due_date')
                    ->orderBy('id'),
            ]);
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
        $previousFollowUpInterval = (int) ($lead->follow_up_interval_days ?: 0);

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
            'potential_level' => ['nullable', Rule::in($this->potentialValues($accountId))],
            'next_follow_up_at' => 'nullable|date',
            'follow_up_script' => ['nullable', Rule::in($this->followUpScriptValues())],
            'follow_up_interval_days' => 'nullable|integer|min:0|max:365',
            'do_not_call' => 'nullable|boolean',
            'note' => 'nullable|string|max:5000',
            'activity_type' => ['nullable', Rule::in($this->activityTypeValues())],
            'complete_current_task' => 'nullable|boolean',
            'customer_name' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:20',
            'zalo_phone' => 'nullable|string|max:20',
        ]);

        $activityType = (string) ($validated['activity_type'] ?? 'note');
        $this->ensureLeadFollowUpTasks($lead);
        $taskToComplete = $this->currentDueTaskForLead($lead);
        $status = null;
        $hasExplicitFollowUpAt = array_key_exists('next_follow_up_at', $validated);

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

        foreach (['assigned_staff_id', 'potential_level', 'follow_up_script', 'follow_up_interval_days', 'customer_name'] as $field) {
            if (array_key_exists($field, $validated)) {
                $lead->{$field} = $validated[$field];
            }
        }

        if (array_key_exists('phone', $validated)) {
            $lead->phone = $this->normalizePhone($validated['phone']);
        }

        if (array_key_exists('zalo_phone', $validated)) {
            $lead->zalo_phone = $this->normalizePhone($validated['zalo_phone']) ?: null;
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

        $explicitDoNotCall = array_key_exists('do_not_call', $validated)
            ? (bool) $validated['do_not_call']
            : (bool) $lead->do_not_call;
        $statusForFollowUp = array_key_exists('lead_status_id', $validated)
            ? $status
            : $lead->statusConfig;
        $statusStopsFollowUp = $this->statusStopsFollowUp($statusForFollowUp);

        if ($explicitDoNotCall || $statusStopsFollowUp) {
            $lead->do_not_call = true;
            $lead->next_follow_up_at = null;
            $lead->follow_up_script = null;
            $lead->follow_up_interval_days = null;
            $this->stopPendingTasksForLead($lead, $activityType);
        } else {
            $lead->do_not_call = false;
            $this->ensureLeadFollowUpTasks($lead);

            if (in_array($activityType, ['call', 'zalo', 'status', 'note', 'schedule'], true)) {
                if ($hasExplicitFollowUpAt) {
                    $lead->follow_up_script = $lead->next_follow_up_at ? ($validated['follow_up_script'] ?? 'custom') : null;
                    $lead->follow_up_interval_days = $lead->next_follow_up_at ? ($validated['follow_up_interval_days'] ?? null) : null;
                } else {
                    $nextIntervalDays = $this->nextAutomaticFollowUpInterval($previousFollowUpInterval);
                    $lead->follow_up_script = $this->scriptForFollowUpInterval($nextIntervalDays);
                    $lead->follow_up_interval_days = $nextIntervalDays;
                    $lead->next_follow_up_at = $this->followUpDateFromDays($nextIntervalDays);
                }
            }
        }

        if (in_array($activityType, ['call', 'zalo'], true)) {
            $lead->last_contacted_at = now();
        }

        $lead->save();

        $noteContent = trim((string) ($validated['note'] ?? ''));
        $shouldCompleteTask = (bool) ($validated['complete_current_task'] ?? false)
            || in_array($activityType, ['status', 'schedule'], true);

        if (!$lead->do_not_call && $shouldCompleteTask) {
            if ($taskToComplete) {
                $freshTask = LeadFollowUpTask::withoutGlobalScopes()
                    ->where('account_id', $lead->account_id)
                    ->where('lead_id', $lead->id)
                    ->where('id', $taskToComplete->id)
                    ->where('status', LeadFollowUpTask::STATUS_PENDING)
                    ->first();

                if ($freshTask) {
                    $this->completeTaskRecord($freshTask, $activityType);
                }
            } else {
                $this->completeCurrentTaskForLead($lead, $activityType);
            }
        }

        if ($noteContent !== '' || $activityType !== 'note') {
            $this->createLeadNote($lead, $request, $noteContent ?: $this->defaultActivityContent($activityType), $activityType);
        }

        $lead->load([
            'statusConfig',
            'assignedStaff',
            'latestNote',
            'followUpTasks' => fn ($taskQuery) => $taskQuery
                ->where('status', LeadFollowUpTask::STATUS_PENDING)
                ->orderBy('due_date')
                ->orderBy('id'),
        ])->loadCount('notesTimeline');

        return response()->json([
            'lead' => $this->transformLead($lead),
            'stats' => $this->stats($request),
        ]);
    }

    public function deleteLatestNote(Request $request, int $id)
    {
        $lead = $this->scopedLeadQuery($request)
            ->with(['latestNote'])
            ->findOrFail($id);

        $latestNote = $lead->latestNote;
        if (!$latestNote) {
            return response()->json(['message' => 'Khách này chưa có ghi chú để xóa.'], 422);
        }

        $latestNote->delete();

        $this->syncLatestNoteSnapshot($lead);

        $lead->load(['statusConfig', 'assignedStaff', 'latestNote'])->loadCount('notesTimeline');

        return response()->json([
            'lead' => $this->transformLead($lead),
            'stats' => $this->stats($request),
        ]);
    }

    public function deleteNote(Request $request, int $id, int $noteId)
    {
        $lead = $this->scopedLeadQuery($request)->findOrFail($id);

        $note = LeadNote::withoutGlobalScopes()
            ->where('account_id', $this->accountId($request))
            ->where('lead_id', $lead->id)
            ->where('id', $noteId)
            ->firstOrFail();

        $note->delete();

        $this->syncLatestNoteSnapshot($lead);

        $lead->load(['statusConfig', 'assignedStaff', 'latestNote'])->loadCount('notesTimeline');

        return response()->json([
            'lead' => $this->transformLead($lead),
            'stats' => $this->stats($request),
        ]);
    }

    public function completeTask(Request $request, int $id, int $taskId)
    {
        $lead = $this->scopedLeadQuery($request)
            ->with(['statusConfig', 'assignedStaff'])
            ->findOrFail($id);

        $task = LeadFollowUpTask::withoutGlobalScopes()
            ->where('account_id', $this->accountId($request))
            ->where('lead_id', $lead->id)
            ->where('id', $taskId)
            ->where('status', LeadFollowUpTask::STATUS_PENDING)
            ->firstOrFail();

        $this->completeTaskRecord($task, (string) $request->input('activity_type', 'note'));

        $lead->load([
            'statusConfig',
            'assignedStaff',
            'latestNote',
            'followUpTasks' => fn ($taskQuery) => $taskQuery
                ->where('status', LeadFollowUpTask::STATUS_PENDING)
                ->orderBy('due_date')
                ->orderBy('id'),
        ])->loadCount('notesTimeline');

        return response()->json([
            'lead' => $this->transformLead($lead),
            'stats' => $this->stats($request),
        ]);
    }

    private function syncLatestNoteSnapshot(Lead $lead): void
    {
        $nextLatestNote = $lead->notesTimeline()->first();

        $lead->forceFill([
            'latest_note_excerpt' => $nextLatestNote ? mb_strimwidth($nextLatestNote->content, 0, 180, '...') : null,
            'last_noted_at' => $nextLatestNote?->created_at,
        ])->save();
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
        $this->applyFilterControls($query, $request);

        if (!$request->boolean('include_stopped') && (string) $request->input('queue', 'today') !== 'all') {
            $this->applyActiveFollowUpScope($query);
        }
    }

    private function applyFilterControls(Builder $query, Request $request): void
    {
        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function (Builder $builder) use ($search) {
                $builder->where('customer_name', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%")
                    ->orWhere('zalo_phone', 'like', "%{$search}%")
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

        if ($request->filled('date_from') || $request->filled('date_to')) {
            $start = $request->filled('date_from')
                ? Carbon::parse($request->input('date_from'))->startOfDay()
                : Carbon::create(1970, 1, 1)->startOfDay();
            $end = $request->filled('date_to')
                ? Carbon::parse($request->input('date_to'))->endOfDay()
                : now()->copy()->addYears(50)->endOfDay();

            if ($start->gt($end)) {
                [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
            }

            $this->whereAddedBetween($query, $start, $end);
        }
    }

    private function applyQueueFilter(Builder $query, string $queue): void
    {
        match ($queue) {
            'all' => null,
            'new_today' => $this->whereHasCurrentDueTask($query, LeadFollowUpTask::TYPE_NEW, false),
            'overdue' => $this->whereHasCurrentDueTask($query, null, true),
            '3_days' => $this->whereHasCurrentDueTask($query, LeadFollowUpTask::TYPE_THREE_DAYS, false),
            '7_days' => $this->whereHasCurrentDueTask($query, LeadFollowUpTask::TYPE_SEVEN_DAYS, false),
            default => $this->whereHasCurrentDueTask($query, null, false),
        };
    }

    private function whereHasCurrentDueTask(Builder $query, ?string $taskType = null, bool $overdueOnly = false): void
    {
        $today = now()->toDateString();
        $leadTable = $query->getModel()->getTable();
        $taskTable = (new LeadFollowUpTask())->getTable();

        $query->whereExists(function ($taskQuery) use ($leadTable, $taskTable, $taskType, $overdueOnly, $today) {
            $taskQuery->selectRaw('1')
                ->from("{$taskTable} as current_tasks")
                ->whereColumn('current_tasks.account_id', "{$leadTable}.account_id")
                ->whereColumn('current_tasks.lead_id', "{$leadTable}.id")
                ->where('current_tasks.status', LeadFollowUpTask::STATUS_PENDING)
                ->where('current_tasks.due_date', $overdueOnly ? '<' : '<=', $today)
                ->when($taskType, fn ($builder) => $builder->where('current_tasks.task_type', $taskType))
                ->whereNotExists(function ($priorQuery) use ($today) {
                    $priorQuery->selectRaw('1')
                        ->from('lead_follow_up_tasks as prior_tasks')
                        ->whereColumn('prior_tasks.account_id', 'current_tasks.account_id')
                        ->whereColumn('prior_tasks.lead_id', 'current_tasks.lead_id')
                        ->where('prior_tasks.status', LeadFollowUpTask::STATUS_PENDING)
                        ->where('prior_tasks.due_date', '<=', $today)
                        ->where(function ($orderQuery) {
                            $orderQuery->whereColumn('prior_tasks.due_date', '<', 'current_tasks.due_date')
                                ->orWhere(function ($tieQuery) {
                                    $tieQuery->whereColumn('prior_tasks.due_date', 'current_tasks.due_date')
                                        ->whereColumn('prior_tasks.id', '<', 'current_tasks.id');
                                });
                        });
                });
        });
    }

    private function applyAddedDateBucket(Builder $query, int $daysBack): void
    {
        $targetStart = now()->startOfDay()->subDays($daysBack);

        $this->whereAddedBetween($query, $targetStart, $targetStart->copy()->endOfDay());
    }

    private function applyTodayWorkBuckets(Builder $query): void
    {
        $todayStart = now()->startOfDay();
        $threeDaysAgoStart = $todayStart->copy()->subDays(3);
        $sevenDaysAgoStart = $todayStart->copy()->subDays(7);

        $query->where(function (Builder $builder) use ($todayStart, $threeDaysAgoStart, $sevenDaysAgoStart) {
            $builder->where(function (Builder $newLeadQuery) use ($todayStart, $sevenDaysAgoStart) {
                $this->applyNewLeadScope($newLeadQuery);
                $this->whereAddedBetween($newLeadQuery, $sevenDaysAgoStart, $todayStart->copy()->endOfDay());
            });
            $this->orWhereAddedBetween($builder, $threeDaysAgoStart, $threeDaysAgoStart->copy()->endOfDay());
            $this->orWhereAddedBetween($builder, $sevenDaysAgoStart, $sevenDaysAgoStart->copy()->endOfDay());
        });
    }

    private function applyNewLeadScope(Builder $query): void
    {
        $query->where(function (Builder $builder) {
            $builder->whereNull('lead_status_id')
                ->orWhereIn('status', self::NEW_LEAD_STATUS_CODE_PATTERNS)
                ->orWhereHas('statusConfig', function (Builder $statusQuery) {
                    $statusQuery->where('is_default', true)
                        ->orWhereIn('code', self::NEW_LEAD_STATUS_CODE_PATTERNS);
                });
        });
    }

    private function whereAddedBetween(Builder $query, Carbon $start, Carbon $end): void
    {
        $query->where(function (Builder $builder) use ($start, $end) {
            $this->addAddedBetweenClause($builder, $start, $end);
        });
    }

    private function orWhereAddedBetween(Builder $query, Carbon $start, Carbon $end): void
    {
        $query->orWhere(function (Builder $builder) use ($start, $end) {
            $this->addAddedBetweenClause($builder, $start, $end);
        });
    }

    private function addAddedBetweenClause(Builder $query, Carbon $start, Carbon $end): void
    {
        $query->whereBetween('placed_at', [$start, $end])
            ->orWhere(function (Builder $fallbackQuery) use ($start, $end) {
                $fallbackQuery->whereNull('placed_at')
                    ->whereBetween('created_at', [$start, $end]);
            });
    }

    private function whereAddedBefore(Builder $query, Carbon $before): void
    {
        $query->where(function (Builder $builder) use ($before) {
            $builder->where('placed_at', '<', $before)
                ->orWhere(function (Builder $fallbackQuery) use ($before) {
                    $fallbackQuery->whereNull('placed_at')
                        ->where('created_at', '<', $before);
                });
        });
    }

    private function ensureFollowUpTasksForAccount(int $accountId): void
    {
        Lead::withoutGlobalScopes()
            ->where('account_id', $accountId)
            ->with('statusConfig')
            ->orderBy('id')
            ->chunkById(200, function (Collection $leads) {
                $leads->each(fn (Lead $lead) => $this->ensureLeadFollowUpTasks($lead));
            });
    }

    private function ensureLeadFollowUpTasks(Lead $lead): void
    {
        $lead->loadMissing('statusConfig');

        if ($lead->do_not_call || $this->statusStopsFollowUp($lead->statusConfig)) {
            $this->stopPendingTasksForLead($lead, 'schedule');
            return;
        }

        $addedAt = $this->leadAddedAt($lead);
        if (!$addedAt) {
            return;
        }

        $baseDate = $addedAt->copy()->startOfDay();
        $tasks = [];

        if ($this->leadHasNewStatus($lead)) {
            $tasks[] = [LeadFollowUpTask::TYPE_NEW, $baseDate->copy()];
        } else {
            LeadFollowUpTask::withoutGlobalScopes()
                ->where('account_id', $lead->account_id)
                ->where('lead_id', $lead->id)
                ->where('task_type', LeadFollowUpTask::TYPE_NEW)
                ->where('status', LeadFollowUpTask::STATUS_PENDING)
                ->update([
                    'status' => LeadFollowUpTask::STATUS_COMPLETED,
                    'completed_at' => now(),
                    'completed_by' => auth()->id(),
                    'completed_activity_type' => 'status',
                    'updated_at' => now(),
                ]);
        }

        $tasks[] = [LeadFollowUpTask::TYPE_THREE_DAYS, $baseDate->copy()->addDays(3)];
        $tasks[] = [LeadFollowUpTask::TYPE_SEVEN_DAYS, $baseDate->copy()->addDays(7)];

        foreach ($tasks as [$taskType, $dueDate]) {
            $dueDateString = $dueDate->toDateString();
            $exists = LeadFollowUpTask::withoutGlobalScopes()
                ->where('account_id', $lead->account_id)
                ->where('lead_id', $lead->id)
                ->where('task_type', $taskType)
                ->whereDate('due_date', $dueDateString)
                ->exists();

            if ($exists) {
                continue;
            }

            LeadFollowUpTask::withoutGlobalScopes()->create([
                'account_id' => $lead->account_id,
                'lead_id' => $lead->id,
                'task_type' => $taskType,
                'due_date' => $dueDateString,
                'status' => LeadFollowUpTask::STATUS_PENDING,
            ]);
        }
    }

    private function stopPendingTasksForLead(Lead $lead, string $activityType): void
    {
        LeadFollowUpTask::withoutGlobalScopes()
            ->where('account_id', $lead->account_id)
            ->where('lead_id', $lead->id)
            ->where('status', LeadFollowUpTask::STATUS_PENDING)
            ->update([
                'status' => LeadFollowUpTask::STATUS_STOPPED,
                'completed_at' => now(),
                'completed_by' => auth()->id(),
                'completed_activity_type' => $activityType,
                'updated_at' => now(),
            ]);
    }

    private function completeCurrentTaskForLead(Lead $lead, string $activityType): ?LeadFollowUpTask
    {
        $task = $this->currentDueTaskForLead($lead);

        if (!$task) {
            return null;
        }

        $this->completeTaskRecord($task, $activityType);

        return $task;
    }

    private function currentDueTaskForLead(Lead $lead): ?LeadFollowUpTask
    {
        return LeadFollowUpTask::withoutGlobalScopes()
            ->where('account_id', $lead->account_id)
            ->where('lead_id', $lead->id)
            ->where('status', LeadFollowUpTask::STATUS_PENDING)
            ->where('due_date', '<=', now()->toDateString())
            ->orderBy('due_date')
            ->orderBy('id')
            ->first();
    }

    private function completeTaskRecord(LeadFollowUpTask $task, string $activityType): void
    {
        $task->forceFill([
            'status' => LeadFollowUpTask::STATUS_COMPLETED,
            'completed_at' => now(),
            'completed_by' => auth()->id(),
            'completed_activity_type' => $activityType,
        ])->save();
    }

    private function filteredStatsBaseQuery(Request $request): Builder
    {
        $query = $this->scopedLeadQuery($request);
        $this->applyFilterControls($query, $request);

        return $query;
    }

    private function pendingTaskLeadCount(Request $request, ?string $taskType = null, bool $overdueOnly = false): int
    {
        $query = $this->filteredStatsBaseQuery($request);

        if (!$request->boolean('include_stopped')) {
            $this->applyActiveFollowUpScope($query);
        }

        $this->whereHasCurrentDueTask($query, $taskType, $overdueOnly);

        return $query->count();
    }

    private function applyActiveFollowUpScope(Builder $query): void
    {
        $query->where('do_not_call', false)
            ->where(function (Builder $builder) {
                $builder->whereNull('lead_status_id')
                    ->orWhereDoesntHave('statusConfig', function (Builder $statusQuery) {
                        $statusQuery->where(function (Builder $stopStatusQuery) {
                            foreach (self::STOP_FOLLOW_UP_STATUS_CODE_PATTERNS as $pattern) {
                                $stopStatusQuery->orWhereRaw('LOWER(code) LIKE ?', ["%{$pattern}%"]);
                            }
                        });
                    });
            });
    }

    private function stats(Request $request): array
    {
        $accountId = $this->accountId($request);

        $base = $this->filteredStatsBaseQuery($request);
        $highPotential = clone $base;
        $unassigned = clone $base;
        $total = (clone $base)->count();
        $potentialCodes = LeadPotential::ensureDefaultsForAccount($accountId)
            ->where('counts_as_potential', true)
            ->pluck('code')
            ->all();

        $periodQuery = $this->scopedLeadQuery($request)
            ->with('statusConfig');
        $periodMeta = $this->applyStatsDateScope($periodQuery, $request);
        $periodLeads = $periodQuery
            ->get(['id', 'account_id', 'lead_status_id', 'potential_level', 'status', 'converted_at', 'order_id']);
        $periodTotal = $periodLeads->count();
        $closedCount = $periodLeads->filter(fn (Lead $lead) => $this->isClosedLead($lead))->count();
        $potentialCount = $periodLeads->filter(fn (Lead $lead) => $this->isPotentialLead($lead, $potentialCodes))->count();
        $statusBreakdown = $periodLeads
            ->groupBy(fn (Lead $lead) => (string) ($lead->lead_status_id ?: 'none'))
            ->map(function (Collection $items) use ($periodTotal) {
                $lead = $items->first();
                $status = $lead?->statusConfig;
                $count = $items->count();

                return [
                    'id' => $status?->id,
                    'name' => $status?->name ?: 'Chưa chọn',
                    'color' => $status?->color ?: '#94a3b8',
                    'count' => $count,
                    'rate' => $periodTotal > 0 ? round(($count / $periodTotal) * 100, 1) : 0,
                ];
            })
            ->sortByDesc('count')
            ->values();

        return [
            'total' => $total,
            'today_due' => $this->pendingTaskLeadCount($request),
            'new_today' => $this->pendingTaskLeadCount($request, LeadFollowUpTask::TYPE_NEW),
            'three_day_due' => $this->pendingTaskLeadCount($request, LeadFollowUpTask::TYPE_THREE_DAYS),
            'seven_day_due' => $this->pendingTaskLeadCount($request, LeadFollowUpTask::TYPE_SEVEN_DAYS),
            'overdue' => $this->pendingTaskLeadCount($request, null, true),
            'high_potential' => !empty($potentialCodes) ? $highPotential->whereIn('potential_level', $potentialCodes)->count() : 0,
            'unassigned' => $unassigned->whereNull('assigned_staff_id')->count(),
            'conversion' => [
                'mode' => $periodMeta['mode'],
                'date_label' => $periodMeta['label'],
                'date_from' => $periodMeta['date_from'],
                'date_to' => $periodMeta['date_to'],
                'total' => $periodTotal,
                'closed_count' => $closedCount,
                'close_rate' => $periodTotal > 0 ? round(($closedCount / $periodTotal) * 100, 1) : 0,
                'potential_count' => $potentialCount,
                'potential_rate' => $periodTotal > 0 ? round(($potentialCount / $periodTotal) * 100, 1) : 0,
            ],
            'status_breakdown' => $statusBreakdown,
        ];
    }

    private function applyStatsDateScope(Builder $query, Request $request): array
    {
        $mode = (string) $request->input('stats_mode', 'day');
        $today = now();

        if ($mode === 'month') {
            $monthValue = (string) $request->input('stats_month', $today->format('Y-m'));
            $start = Carbon::parse($monthValue . '-01')->startOfMonth();
            $end = $start->copy()->endOfMonth();
            $label = 'Tháng ' . $start->format('m/Y');
        } elseif ($mode === 'custom') {
            $from = (string) ($request->input('stats_date_from') ?: $request->input('date_from') ?: $today->toDateString());
            $to = (string) ($request->input('stats_date_to') ?: $request->input('date_to') ?: $from);
            $start = Carbon::parse($from)->startOfDay();
            $end = Carbon::parse($to)->endOfDay();

            if ($start->gt($end)) {
                [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
            }

            $label = $start->format('d/m/Y') . ' - ' . $end->format('d/m/Y');
        } else {
            $mode = 'day';
            $dateValue = (string) $request->input('stats_date', $today->toDateString());
            $start = Carbon::parse($dateValue)->startOfDay();
            $end = $start->copy()->endOfDay();
            $label = $start->format('d/m/Y');
        }

        $this->whereAddedBetween($query, $start, $end);

        return [
            'mode' => $mode,
            'label' => $label,
            'date_from' => $start->toDateString(),
            'date_to' => $end->toDateString(),
        ];
    }

    private function isClosedLead(Lead $lead): bool
    {
        if ($lead->converted_at || $lead->order_id) {
            return true;
        }

        $normalized = $this->normalizedStatusText($lead);

        return str_contains($normalized, 'da chot')
            || str_contains($normalized, 'da tao don')
            || str_contains($normalized, 'chot');
    }

    private function isPotentialLead(Lead $lead, array $potentialCodes): bool
    {
        if ($lead->potential_level && in_array($lead->potential_level, $potentialCodes, true)) {
            return true;
        }

        $normalized = $this->normalizedStatusText($lead);

        return str_contains($normalized, 'tiem nang');
    }

    private function normalizedStatusText(Lead $lead): string
    {
        return Str::of(trim(($lead->status ?? '') . ' ' . ($lead->statusConfig?->code ?? '') . ' ' . ($lead->statusConfig?->name ?? '')))
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->toString();
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
                    $zaloSameAsPhone = ($item['zalo_same_as_phone'] ?? true) !== false;
                    $rawZaloPhone = $zaloSameAsPhone ? $line : trim((string) ($item['zalo_phone'] ?? ''));
                    $row['zalo_phone'] = $rawZaloPhone;
                    $row['normalized_zalo_phone'] = $this->normalizePhone($rawZaloPhone);
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
            'zalo_phone' => $rawPhone,
            'normalized_zalo_phone' => $normalizedPhone,
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
        $addedAt = $this->leadAddedAt($lead);
        $careBucket = $this->careBucket($lead);
        $currentTask = $this->currentTaskForLead($lead);
        $daysUntilFollowUp = $nextFollowUpAt
            ? now()->startOfDay()->diffInDays($nextFollowUpAt->copy()->startOfDay(), false)
            : null;

        return [
            'id' => $lead->id,
            'lead_number' => $lead->lead_number,
            'customer_name' => $lead->customer_name,
            'phone' => $lead->phone,
            'zalo_phone' => $lead->zalo_phone,
            'phone_for_zalo' => $this->normalizePhone($lead->zalo_phone ?: $lead->phone),
            'zalo_phone_for_zalo' => $this->normalizePhone($lead->zalo_phone ?: $lead->phone),
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
            'potential_label' => $this->labelForPotential($lead->potential_level, (int) $lead->account_id),
            'next_follow_up_at' => $this->isoDateTime($nextFollowUpAt),
            'next_follow_up_label' => $this->dateTimeLabel($nextFollowUpAt),
            'follow_up_script' => $lead->follow_up_script,
            'follow_up_interval_days' => $lead->follow_up_interval_days,
            'last_contacted_at' => $this->isoDateTime($lead->last_contacted_at),
            'last_contacted_label' => $this->dateTimeLabel($lead->last_contacted_at),
            'do_not_call' => (bool) $lead->do_not_call,
            'due_bucket' => $this->dueBucket($lead),
            'care_bucket' => $careBucket['value'],
            'care_bucket_label' => $careBucket['label'],
            'current_task' => $currentTask ? $this->transformFollowUpTask($currentTask, $lead) : null,
            'days_until_follow_up' => $daysUntilFollowUp,
            'latest_note_id' => $lead->latestNote?->id,
            'latest_note_excerpt' => $lead->latest_note_excerpt,
            'latest_note_content' => $lead->latestNote?->content,
            'notes_count' => (int) ($lead->notes_timeline_count ?? 0),
            'last_noted_at' => $this->isoDateTime($lead->last_noted_at),
            'last_noted_label' => $this->dateTimeLabel($lead->last_noted_at),
            'added_at' => $this->isoDateTime($addedAt),
            'added_label' => $this->dateTimeLabel($addedAt),
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
            'potential_label' => $this->labelForPotential($note->potential_level, (int) $note->account_id),
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

    private function transformPotential(LeadPotential $potential): array
    {
        return [
            'id' => $potential->id,
            'code' => $potential->code,
            'value' => $potential->code,
            'name' => $potential->name,
            'label' => $potential->name,
            'color' => $potential->color,
            'sort_order' => $potential->sort_order,
            'is_default' => (bool) $potential->is_default,
            'counts_as_potential' => (bool) $potential->counts_as_potential,
            'is_active' => (bool) $potential->is_active,
        ];
    }

    private function transformFollowUpTask(LeadFollowUpTask $task, ?Lead $lead = null): array
    {
        $today = now()->startOfDay();
        $dueDate = $task->due_date?->copy()->startOfDay();
        $daysOverdue = $dueDate ? max(0, (int) $dueDate->diffInDays($today, false)) : 0;
        $isDue = $dueDate ? $dueDate->lte($today) : false;
        $isOverdue = $daysOverdue > 0;
        $typeLabel = self::TASK_TYPE_LABELS[$task->task_type] ?? 'Việc chăm sóc';

        if ($task->status !== LeadFollowUpTask::STATUS_PENDING) {
            $label = 'Đã xử lý';
            $statusLabel = 'Đã xử lý';
        } elseif ($isOverdue) {
            $label = "Quá {$daysOverdue} ngày - {$typeLabel}";
            $statusLabel = 'Chưa xử lý';
        } elseif ($isDue) {
            $label = $typeLabel;
            $statusLabel = 'Chưa xử lý';
        } else {
            $addedAt = $lead ? $this->leadAddedAt($lead) : null;
            $ageDays = $addedAt
                ? (int) $addedAt->copy()->startOfDay()->diffInDays($today, false)
                : null;
            $label = $ageDays !== null ? $this->leadAgeLabel($ageDays) : 'Chưa đến lịch';
            $statusLabel = 'Chưa đến lịch';
        }

        return [
            'id' => $task->id,
            'task_type' => $task->task_type,
            'task_type_label' => $typeLabel,
            'status' => $task->status,
            'status_label' => $statusLabel,
            'label' => $label,
            'due_date' => $task->due_date?->toDateString(),
            'due_label' => $task->due_date ? $task->due_date->format('d/m/Y') : null,
            'is_due' => $isDue,
            'is_overdue' => $isOverdue,
            'days_overdue' => $daysOverdue,
            'completed_at' => $this->isoDateTime($task->completed_at),
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

    private function leadAddedAt(Lead $lead): ?Carbon
    {
        return $lead->placed_at ?: $lead->created_at;
    }

    private function currentTaskForLead(Lead $lead): ?LeadFollowUpTask
    {
        $today = now()->toDateString();
        $tasks = $lead->relationLoaded('followUpTasks')
            ? $lead->followUpTasks
            : $lead->followUpTasks()
                ->where('status', LeadFollowUpTask::STATUS_PENDING)
                ->orderBy('due_date')
                ->orderBy('id')
                ->get();

        if ($tasks->isEmpty()) {
            return null;
        }

        return $tasks->first(fn (LeadFollowUpTask $task) => $task->due_date?->toDateString() <= $today)
            ?: $tasks->first();
    }

    private function leadHasNewStatus(Lead $lead): bool
    {
        $statusCode = Str::lower((string) ($lead->statusConfig?->code ?: $lead->status));

        return !$lead->lead_status_id
            || (bool) ($lead->statusConfig?->is_default ?? false)
            || in_array($statusCode, self::NEW_LEAD_STATUS_CODE_PATTERNS, true);
    }

    private function careBucket(Lead $lead): array
    {
        if ($lead->do_not_call) {
            return ['value' => 'stopped', 'label' => 'Đã dừng nhắc'];
        }

        $addedAt = $this->leadAddedAt($lead);

        if (!$addedAt) {
            return ['value' => null, 'label' => 'Chưa có ngày thêm'];
        }

        $ageDays = (int) $addedAt->copy()->startOfDay()->diffInDays(now()->startOfDay(), false);

        return match ($ageDays) {
            0 => ['value' => 'today', 'label' => 'Khách hôm nay'],
            3 => ['value' => '3_days', 'label' => 'Khách 3 hôm trước'],
            7 => ['value' => '7_days', 'label' => 'Khách 7 hôm trước'],
            default => $ageDays > 7
                ? ['value' => 'overdue', 'label' => 'Quá hạn']
                : ['value' => $this->leadHasNewStatus($lead) ? 'new' : 'waiting', 'label' => $this->leadAgeLabel($ageDays)],
        };
    }

    private function leadAgeLabel(int $ageDays): string
    {
        if ($ageDays <= 0) {
            return 'Khách hôm nay';
        }

        if ($ageDays === 1) {
            return 'Khách hôm qua';
        }

        return "Khách {$ageDays} hôm trước";
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

    private function nextAutomaticFollowUpInterval(int $previousIntervalDays): int
    {
        return $previousIntervalDays >= 3 ? 7 : 3;
    }

    private function scriptForFollowUpInterval(int $intervalDays): string
    {
        return match ($intervalDays) {
            7 => '7_days',
            30 => '30_days',
            default => '3_days',
        };
    }

    private function labelForPotential(?string $value, ?int $accountId = null): ?string
    {
        if (!$value) {
            return null;
        }

        $matched = $this->potentialDefinitionsForAccount($accountId)->firstWhere('code', $value);
        if ($matched) {
            return $matched->name;
        }

        $default = collect(LeadPotential::defaultDefinitions())->firstWhere('code', $value);

        return $default['name'] ?? Str::of($value)->replace(['-', '_'], ' ')->headline()->toString();
    }

    private function labelForActivity(?string $value): string
    {
        $matched = collect(self::ACTIVITY_TYPES)->firstWhere('value', $value ?: 'note');

        return $matched['label'] ?? 'Ghi chú';
    }

    private function statusStopsFollowUp(?LeadStatus $status): bool
    {
        if (!$status) {
            return false;
        }

        $normalized = Str::of(trim(($status->code ?? '') . ' ' . ($status->name ?? '')))
            ->ascii()
            ->lower()
            ->replaceMatches('/[^a-z0-9]+/', ' ')
            ->squish()
            ->toString();

        foreach (self::STOP_FOLLOW_UP_STATUS_PATTERNS as $pattern) {
            if (str_contains($normalized, $pattern)) {
                return true;
            }
        }

        return false;
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

    private function potentialDefinitionsForAccount(?int $accountId): Collection
    {
        static $cache = [];

        if (!$accountId) {
            return collect();
        }

        if (!isset($cache[$accountId])) {
            $cache[$accountId] = LeadPotential::ensureDefaultsForAccount($accountId);
        }

        return $cache[$accountId];
    }

    private function potentialValues(int $accountId): array
    {
        return $this->potentialDefinitionsForAccount($accountId)->pluck('code')->all();
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
