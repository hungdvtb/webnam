<?php

namespace App\Services\AI;

use Illuminate\Support\Str;

class AiExceptionClassifier
{
    public function classify(\Throwable $exception): array
    {
        $rawMessage = trim((string) $exception->getMessage());
        $normalizedMessage = $this->normalizeMessage($rawMessage);
        $detail = $this->sanitizeDetail($rawMessage);

        if ($this->containsAny($normalizedMessage, [
            'api key gemini',
            'gemini api key hop le',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_NOT_CONFIGURED',
                'message' => 'AI chưa được cấu hình API key Gemini trên máy chủ deploy.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'dang tam tat',
            'tam tat trong cai dat web',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_DISABLED',
                'message' => 'AI đang bị tắt trong Cài đặt web của tài khoản hiện tại.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'ssl certificate problem',
            'certificate verify failed',
            'unable to get local issuer certificate',
            'self signed certificate',
            'c url error 60',
            'curl error 60',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_SSL_CERTIFICATE',
                'message' => 'Máy chủ deploy không kết nối được Gemini vì lỗi xác thực chứng chỉ SSL.',
                'detail' => $detail ?: 'Cần kiểm tra ca-certificates, CURL_CA_BUNDLE, SSL_CERT_FILE hoặc GEMINI_CA_BUNDLE_PATH trên server.',
                'retryable' => false,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'curl error 28',
            'c url error 28',
            'operation timed out',
            'connection timed out',
            'timed out',
            'timeout',
        ])) {
            return [
                'status' => 504,
                'error_code' => 'AI_TIMEOUT',
                'message' => 'Yêu cầu tạo SEO AI bị timeout khi gọi sang Gemini.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'curl error 6',
            'c url error 6',
            'curl error 7',
            'c url error 7',
            'could not resolve host',
            'name or service not known',
            'failed to connect',
            'connection refused',
            'network is unreachable',
            'getaddrinfo',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_UPSTREAM_UNREACHABLE',
                'message' => 'Máy chủ deploy không kết nối được tới Gemini.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'currently experiencing high demand',
            'high demand',
            'spikes in demand',
            'temporarily unavailable',
            'service unavailable',
            'overloaded',
            'please try again later',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_UPSTREAM_BUSY',
                'message' => 'Gemini đang quá tải tạm thời khi tạo SEO hàng loạt. Hệ thống sẽ thử lại tự động.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'resource_exhausted',
            'quota',
            'rate limit',
            'too many requests',
        ])) {
            return [
                'status' => 429,
                'error_code' => 'AI_RATE_LIMITED',
                'message' => 'Tài khoản Gemini đang vượt quota hoặc bị giới hạn tần suất.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'api key not valid',
            'invalid api key',
            'permission denied',
            'permission_denied',
            'unauthenticated',
            'authentication',
            'forbidden',
        ])) {
            return [
                'status' => 503,
                'error_code' => 'AI_AUTH_FAILED',
                'message' => 'Gemini từ chối API key hoặc quyền truy cập model trên máy chủ deploy.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        if (
            str_contains($normalizedMessage, 'model')
            && $this->containsAny($normalizedMessage, [
                'not found',
                'not supported',
                'unsupported',
                'unknown',
                'does not exist',
                '404',
                'listmodels',
            ])
        ) {
            return [
                'status' => 503,
                'error_code' => 'AI_MODEL_UNAVAILABLE',
                'message' => 'Model Gemini đang cấu hình trên deploy không tồn tại hoặc không được hỗ trợ.',
                'detail' => $detail,
                'retryable' => false,
            ];
        }

        if ($this->containsAny($normalizedMessage, [
            'khong dung dinh dang json',
            'json khong hop le',
            'valid json only',
        ])) {
            return [
                'status' => 502,
                'error_code' => 'AI_INVALID_RESPONSE',
                'message' => 'Gemini trả về nội dung sai định dạng JSON nên backend không thể dùng để tạo SEO.',
                'detail' => $detail,
                'retryable' => true,
            ];
        }

        return [
            'status' => 500,
            'error_code' => 'AI_INTERNAL_ERROR',
            'message' => 'Không thể tạo SEO AI vì backend gặp lỗi nội bộ.',
            'detail' => $detail,
            'retryable' => false,
        ];
    }

    private function normalizeMessage(string $message): string
    {
        $normalized = Str::lower(Str::ascii($message));
        $normalized = preg_replace('/\s+/u', ' ', $normalized) ?? $normalized;

        return trim($normalized);
    }

    private function sanitizeDetail(string $message): ?string
    {
        $detail = trim($message);
        if ($detail === '') {
            return null;
        }

        $detail = preg_replace('/([?&](?:key|api_key|x-goog-api-key)=)[^&\s]+/i', '$1***', $detail) ?? $detail;
        $detail = preg_replace('/(Bearer\s+)[A-Za-z0-9._-]+/i', '$1***', $detail) ?? $detail;

        return Str::limit($detail, 500, '...');
    }

    private function containsAny(string $haystack, array $needles): bool
    {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($haystack, $needle)) {
                return true;
            }
        }

        return false;
    }
}
