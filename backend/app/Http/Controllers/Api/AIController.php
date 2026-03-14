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
        $inputAttributes = $request->input('attributes');
        if (!empty($inputAttributes) && is_array($inputAttributes)) {
            foreach ($inputAttributes as $key => $val) {
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

    public function rewriteProductDescription(Request $request)
    {
        $request->validate([
            'content' => 'required|string',
        ]);

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

        $prompt = "Bạn là một biên tập viên chuyên nghiệp về nghệ thuật gốm sứ Bát Tràng và Marketing cao cấp. 
        Tôi có một đoạn mô tả nội dung sản phẩm bên dưới được lưu dưới dạng HTML. 
        Hãy viết lại nội dung dạng text của đoạn HTML này sao cho chuyên nghiệp, mượt mà, cảm xúc và hấp dẫn hơn.
        
        YÊU CẦU QUAN TRỌNG NHẤT: BẠN PHẢI GIỮ NGUYÊN HOÀN TOÀN CẤU TRÚC HTML, CÁC THẺ <img>, CÁC ĐƯỜNG LINK <a href>... 
        Chỉ thay đổi và làm mượt mà phần văn bản hiển thị. 
        Đặc biệt chú ý: Các thẻ <img src=\"__IMG_PLACEHOLDER_x__\" /> là dữ liệu hệ thống, tuyệt đối GIỮ NGUYÊN HOÀN TOÀN cấu trúc, không sửa thành URL khác và không được xóa.
        
        Nội dung HTML đầu vào:
        " . $request->input('content') . "
        
        Lưu ý:
        1. Ngôn ngữ: Tiếng Việt, sử dụng các từ ngữ tinh tế, sắc sảo.
        2. Không thay đổi bất kỳ thuộc tính nào của các thẻ HTML (src, class, style...).
        3. Trả về đúng mã HTML kết quả, không cần có câu chào hỏi hay Markdown dạng ```html.";

        try {
            $response = $client->generativeModel('gemini-pro-latest')->generateContent($prompt);
            $rewrittenContent = $response->text();
            
            // Dọn dẹp markdown nếu có
            $rewrittenContent = preg_replace('/```html\s*/', '', $rewrittenContent);
            $rewrittenContent = preg_replace('/```\s*$/', '', $rewrittenContent);

            return response()->json([
                'description' => $rewrittenContent,
                'status' => 'success'
            ]);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Lỗi AI: ' . $e->getMessage()], 500);
        }
    }
}
