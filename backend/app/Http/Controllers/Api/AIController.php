<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Services\AI\GeminiService;
use App\Services\Inventory\InvoiceAnalysisService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AIController extends Controller
{
    public function __construct(
        private readonly GeminiService $geminiService,
        private readonly InvoiceAnalysisService $invoiceAnalysisService,
    ) {
    }

    public function status(Request $request): JsonResponse
    {
        return response()->json(
            $this->geminiService->status($this->resolveAccountId($request))
        );
    }

    public function generateContent(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => 'required|string',
            'model' => 'nullable|string|max:120',
        ]);

        try {
            $result = $this->geminiService->generateText(
                $validated['prompt'],
                $this->resolveAccountId($request),
                $validated['model'] ?? null
            );

            return response()->json([
                'text' => $result['text'],
                'response' => $result['text'],
                'model' => $result['model'],
                'status' => 'success',
            ]);
        } catch (\Throwable $exception) {
            return $this->handleAiException($exception);
        }
    }

    public function readInvoice(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'supplier_id' => 'nullable|integer|exists:suppliers,id',
            'invoice_file' => 'required|file|max:12288|mimes:pdf,jpg,jpeg,png,webp,txt,csv,json',
        ]);

        return response()->json(
            $this->invoiceAnalysisService->analyzeUploadedInvoice(
                $request->file('invoice_file'),
                $this->resolveAccountId($request) ?? 0,
                $validated['supplier_id'] ?? null,
                auth()->id()
            )
        );
    }

    public function chat(Request $request): JsonResponse
    {
        $request->validate([
            'message' => 'required|string',
            'chat_id' => 'nullable|string',
        ]);

        $chatId = $request->input('chat_id') ?: Str::uuid()->toString();
        $sessionPath = "ai/sessions/{$chatId}.json";
        $knowledge = Storage::disk('local')->exists('ai/knowledge.md')
            ? Storage::disk('local')->get('ai/knowledge.md')
            : '';
        $history = Storage::disk('local')->exists($sessionPath)
            ? json_decode(Storage::disk('local')->get($sessionPath), true)
            : [];
        $prompt = $this->buildChatPrompt($knowledge, is_array($history) ? $history : [], (string) $request->input('message'));

        try {
            $result = $this->geminiService->generateText($prompt, $this->resolveAccountId($request));
            $aiAnswer = $result['text'];

            $history = is_array($history) ? $history : [];
            $history[] = ['role' => 'user', 'text' => $request->input('message'), 'time' => now()->toIso8601String()];
            $history[] = ['role' => 'ai', 'text' => $aiAnswer, 'time' => now()->toIso8601String()];
            Storage::disk('local')->put($sessionPath, json_encode($history, JSON_UNESCAPED_UNICODE));

            return response()->json([
                'answer' => $aiAnswer,
                'response' => $aiAnswer,
                'text' => $aiAnswer,
                'chat_id' => $chatId,
                'model' => $result['model'],
                'status' => 'success',
            ]);
        } catch (\Throwable $exception) {
            return $this->handleAiException($exception);
        }
    }

    public function getHistory(string $chatId): JsonResponse
    {
        $sessionPath = "ai/sessions/{$chatId}.json";

        if (!Storage::disk('local')->exists($sessionPath)) {
            return response()->json([]);
        }

        return response()->json(
            json_decode(Storage::disk('local')->get($sessionPath), true) ?: []
        );
    }

    public function generateProductDescription(Request $request): JsonResponse
    {
        $request->validate([
            'name' => 'required|string',
            'category' => 'nullable|string',
            'attributes' => 'nullable|array',
            'custom_instruction' => 'nullable|string|max:2000',
        ]);

        $attrString = '';
        $inputAttributes = $request->input('attributes');
        if (!empty($inputAttributes) && is_array($inputAttributes)) {
            foreach ($inputAttributes as $key => $val) {
                if ($val) {
                    $attrString .= "- {$key}: {$val}\n";
                }
            }
        }

        $customInstruction = trim((string) $request->input('custom_instruction', ''));
        $customInstructionBlock = $customInstruction !== ''
            ? "Yeu cau bo sung tu nguoi dung (uu tien lam theo neu khong mau thuan):\n{$customInstruction}\n"
            : '';

        $prompt = "Ban la mot chuyen gia ve nghe thuat gom su Bat Trang va marketing cao cap.\n"
            . "Hay viet mot doan mo ta san pham quyen ru, dam chat nghe thuat va tam linh cho san pham sau:\n"
            . "Ten: {$request->input('name')}\n"
            . "Danh muc: {$request->input('category')}\n"
            . "Thong so:\n{$attrString}\n"
            . $customInstructionBlock
            . "Yeu cau mac dinh:\n"
            . "1. Ngon ngu: Tieng Viet, my mieu va tinh te.\n"
            . "2. Cau truc: dep tong the, ky thuat che tac-chat lieu, y nghia phong thuy-va goi y bai tri.\n"
            . "3. Khong dung cac cum khoa trang.\n"
            . "4. Tra loi truc tiep noi dung mo ta, khong gioi thieu la AI.\n"
            . "5. Neu nguoi dung muon them anh minh hoa, khong tu tao URL anh; hay chen dong goi y ro rang theo dang [Goi y anh minh hoa: ...] tai vi tri phu hop.";

        try {
            $result = $this->geminiService->generateText($prompt, $this->resolveAccountId($request));

            return response()->json([
                'description' => $result['text'],
                'text' => $result['text'],
                'model' => $result['model'],
                'status' => 'success',
            ]);
        } catch (\Throwable $exception) {
            return $this->handleAiException($exception);
        }
    }

    public function rewriteProductDescription(Request $request): JsonResponse
    {
        $request->validate([
            'content' => 'required|string',
            'custom_instruction' => 'nullable|string|max:2000',
        ]);

        $customInstruction = trim((string) $request->input('custom_instruction', ''));
        $customInstructionBlock = $customInstruction !== ''
            ? "Yeu cau bo sung tu nguoi dung (uu tien lam theo neu khong mau thuan):\n{$customInstruction}\n\n"
            : '';

        $prompt = "Ban la mot bien tap vien chuyen nghiep ve nghe thuat gom su Bat Trang va marketing cao cap.\n"
            . "Toi co mot doan mo ta noi dung san pham dang HTML. Hay viet lai phan van ban hien thi sao cho muot ma, cam xuc va hap dan hon.\n\n"
            . "YEU CAU QUAN TRONG NHAT: GIU NGUYEN HOAN TOAN cac the <img>, cac duong link <a href>, cac placeholder he thong va khong doi thuoc tinh HTML hien co.\n"
            . "Ban chi duoc sap xep lai cac the van ban nhu <p>, <h2>, <h3>, <ul>, <li> neu nguoi dung co yeu cau ro ve bo cuc/trinh bay.\n\n"
            . $customInstructionBlock
            . "Noi dung HTML dau vao:\n"
            . $request->input('content')
            . "\n\nLuu y:\n"
            . "1. Ngon ngu: Tieng Viet, tinh te, sac sao.\n"
            . "2. Khong thay doi thuoc tinh cua the HTML (src, class, style...).\n"
            . "3. Neu nguoi dung muon them anh minh hoa, khong tu tao URL anh; hay chen dong goi y ro rang theo dang [Goi y anh minh hoa: ...] tai vi tri phu hop.\n"
            . "4. Tra ve dung HTML ket qua, khong can markdown html.";

        try {
            $result = $this->geminiService->generateText($prompt, $this->resolveAccountId($request));
            $rewrittenContent = preg_replace('/```html\s*/', '', $result['text']) ?? $result['text'];
            $rewrittenContent = preg_replace('/```\s*$/', '', $rewrittenContent) ?? $rewrittenContent;

            return response()->json([
                'description' => $rewrittenContent,
                'text' => $rewrittenContent,
                'model' => $result['model'],
                'status' => 'success',
            ]);
        } catch (\Throwable $exception) {
            return $this->handleAiException($exception);
        }
    }

    private function buildChatPrompt(string $knowledge, array $history, string $message): string
    {
        $lines = [
            "Ban la tro ly ao cua 'Gom Su Dai Thanh'.",
            'Tra loi bang tieng Viet, gon gang, lich su va huong den ban hang/tu van.',
            'Neu thong tin khong ro, hay noi that rang ban can them chi tiet.',
        ];

        if (trim($knowledge) !== '') {
            $lines[] = "Du lieu tri thuc noi bo:\n{$knowledge}";
        }

        if (!empty($history)) {
            $conversation = collect(array_slice($history, -10))
                ->map(function ($msg) {
                    $role = ($msg['role'] ?? 'user') === 'user' ? 'Khach' : 'AI';

                    return $role . ': ' . trim((string) ($msg['text'] ?? ''));
                })
                ->filter()
                ->values()
                ->all();

            if (!empty($conversation)) {
                $lines[] = "Lich su hoi thoai gan day:\n" . implode("\n", $conversation);
            }
        }

        $lines[] = "Khach: {$message}";
        $lines[] = 'AI:';

        return implode("\n\n", $lines);
    }

    private function resolveAccountId(Request $request): ?int
    {
        $accountId = $request->input('account_id');
        if ($accountId) {
            return (int) $accountId;
        }

        $headerAccountId = $request->header('X-Account-Id');
        if ($headerAccountId && $headerAccountId !== 'all') {
            return (int) $headerAccountId;
        }

        $siteCode = $request->query('site_code') ?: $request->header('X-Site-Code');
        if ($siteCode) {
            return Account::query()->where('site_code', $siteCode)->value('id');
        }

        return null;
    }

    private function handleAiException(\Throwable $exception): JsonResponse
    {
        if ($exception instanceof ValidationException) {
            throw $exception;
        }

        $message = $exception->getMessage();
        $status = str_contains($message, 'Chưa cấu hình API key Gemini')
            || str_contains($message, 'AI đang tạm tắt')
            ? 503
            : 500;

        return response()->json([
            'message' => $message !== '' ? $message : 'Không thể xử lý yêu cầu AI lúc này.',
        ], $status);
    }
}
