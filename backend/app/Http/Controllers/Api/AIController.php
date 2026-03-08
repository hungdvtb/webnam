<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Gemini;

class AIController extends Controller
{
    public function chat(Request $request)
    {
        $request->validate([
            'message' => 'required|string',
            'chat_id' => 'nullable|string'
        ]);
        
        $chatId = $request->chat_id ?? Str::uuid()->toString();
        $sessionPath = "ai/sessions/{$chatId}.json";

        // Get Account-specific API Key
        $accountId = $request->header('X-Account-Id');
        $account = \App\Models\Account::find($accountId);
        $apiKey = $account->ai_api_key ?? env('GEMINI_API_KEY');

        if (!$apiKey) {
            return response()->json(['message' => 'AI System busy (No API Key configured for this store)'], 503);
        }

        $client = Gemini::factory()
            ->withApiKey($apiKey)
            ->withBaseUrl('https://generativelanguage.googleapis.com/v1beta/')
            ->make();

        // Load Knowledge Base
        $knowledge = Storage::disk('local')->exists('ai/knowledge.md') 
            ? Storage::disk('local')->get('ai/knowledge.md') 
            : "";

        // Load Session History
        $history = Storage::disk('local')->exists($sessionPath)
            ? json_decode(Storage::disk('local')->get($sessionPath), true)
            : [];

        $systemPrompt = "Bạn là trợ lý ảo của 'Gốm Sứ Đại Thành'. Trình độ: Chuyên gia gốm sứ. 
        Sử dụng tri thức dưới đây để trả lời. Trả lời ngắn gọn, tinh tế.
        DỮ LIỆU TRI THỨC:\n" . $knowledge;

        // Construct context for Gemini
        $context = [$systemPrompt];
        foreach (array_slice($history, -10) as $msg) { // Last 10 messages for context
            $context[] = ($msg['role'] === 'user' ? "Khách: " : "AI: ") . $msg['text'];
        }
        $context[] = "Khách: " . $request->message;

        try {
            $response = $client->generativeModel('gemini-pro-latest')->generateContent($context);
            $aiAnswer = $response->text();

            // Save to History
            $history[] = ['role' => 'user', 'text' => $request->message, 'time' => now()];
            $history[] = ['role' => 'ai', 'text' => $aiAnswer, 'time' => now()];
            Storage::disk('local')->put($sessionPath, json_encode($history));

            return response()->json([
                'answer' => $aiAnswer,
                'chat_id' => $chatId,
                'status' => 'success'
            ]);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Lỗi kết nối AI: ' . $e->getMessage()], 500);
        }
    }

    public function generateProductDescription(Request $request)
    {
        $request->validate([
            'name' => 'required|string',
            'category' => 'nullable|string',
            'attributes' => 'nullable|array'
        ]);

        // Get Account-specific API Key
        $accountId = $request->header('X-Account-Id');
        $account = \App\Models\Account::find($accountId);
        $apiKey = $account->ai_api_key ?? env('GEMINI_API_KEY');

        if (!$apiKey) {
            return response()->json(['message' => 'AI System busy (No API Key configured)'], 503);
        }

        $client = Gemini::factory()
            ->withApiKey($apiKey)
            ->withBaseUrl('https://generativelanguage.googleapis.com/v1beta/')
            ->make();

        $attrString = "";
        if ($request->has('attributes')) {
            foreach ($request->attributes as $key => $val) {
                if ($val) $attrString .= "- {$key}: {$val}\n";
            }
        }

        $prompt = "Bạn là một chuyên gia về nghệ thuật gốm sứ Bát Tràng và Marketing cao cấp. 
        Hãy viết một đoạn mô tả sản phẩm quyến rũ, đậm chất nghệ thuật và tâm linh cho sản phẩm sau:
        Tên: {$request->name}
        Danh mục: {$request->category}
        Thông số:
        {$attrString}
        
        Yêu cầu:
        1. Ngôn ngữ: Tiếng Việt, sử dụng các từ ngữ mỹ miều, tinh tế (VD: chế tác thủ công, men màu độc bản, cốt gốm cao lanh, linh hồn của đất, nung ở 1300 độ C...).
        2. Cấu trúc: 
           - Đoạn 1: Cảm xúc và vẻ đẹp tổng thể.
           - Đoạn 2: Chi tiết về kỹ thuật chế tác và chất liệu.
           - Đoạn 3: Ý nghĩa phong thủy và lời khuyên bài trí.
        3. Không dùng các từ sáo rỗng như 'số 1', 'tốt nhất'. Hãy để khách hàng tự cảm nhận vẻ đẹp qua mô tả.
        4. Trả lời trực tiếp nội dung mô tả, không có phần giới thiệu của AI.";

        try {
            $response = $client->generativeModel('gemini-pro-latest')->generateContent($prompt);
            return response()->json([
                'description' => $response->text(),
                'status' => 'success'
            ]);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Lỗi AI: ' . $e->getMessage()], 500);
        }
    }

    public function getHistory($chatId)
    {
        $sessionPath = "ai/sessions/{$chatId}.json";
        if (Storage::disk('local')->exists($sessionPath)) {
            return response()->json(json_decode(Storage::disk('local')->get($sessionPath), true));
        }
        return response()->json([]);
    }
}
