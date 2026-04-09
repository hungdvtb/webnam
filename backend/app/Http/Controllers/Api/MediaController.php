<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MediaService;
use Illuminate\Http\Request;
use RuntimeException;
use Throwable;

class MediaController extends Controller
{
    public function __construct(
        protected MediaService $mediaService
    ) {
    }

    public function proxy(Request $request)
    {
        $validated = $request->validate([
            'url' => 'required|string|max:2048',
        ]);

        $normalized = $this->mediaService->normalizeLegacyUrl($validated['url']);
        if ($normalized === '') {
            return response()->json(['message' => 'Invalid image path'], 422);
        }

        return redirect()->away($normalized, 302, [
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    public function upload(Request $request)
    {
        $request->validate([
            'image' => 'nullable|file|mimes:jpeg,png,jpg,gif,webp,avif,svg|max:10240',
            'images' => 'nullable|array',
            'images.*' => 'file|mimes:jpeg,png,jpg,gif,webp,avif,svg|max:10240',
            'collection' => 'nullable|string|max:80',
        ], [
            'image.file' => 'File upload khong hop le.',
            'image.mimes' => 'Dinh dang anh khong duoc ho tro. Chi chap nhan JPEG, PNG, JPG, GIF, WEBP, AVIF hoac SVG.',
            'image.max' => 'Anh vuot qua 10MB. Hay nen nho hon roi thu lai.',
            'images.array' => 'Danh sach anh upload khong hop le.',
            'images.*.file' => 'Co file trong danh sach upload khong hop le.',
            'images.*.mimes' => 'Co anh co dinh dang khong duoc ho tro. Chi chap nhan JPEG, PNG, JPG, GIF, WEBP, AVIF hoac SVG.',
            'images.*.max' => 'Co anh vuot qua 10MB. Hay giam dung luong roi thu lai.',
        ]);

        $collection = trim((string) $request->input('collection', 'editor')) ?: 'editor';
        $files = [];

        if ($request->hasFile('image')) {
            $files[] = $request->file('image');
        }

        if ($request->hasFile('images')) {
            $files = array_merge($files, $request->file('images'));
        }

        if (empty($files)) {
            return response()->json([
                'success' => false,
                'error_code' => 'NO_FILE_UPLOADED',
                'message' => 'Chua co file anh nao duoc gui len API upload.',
            ], 400);
        }

        try {
            $assets = $this->mediaService->uploadImages($files, [
                'collection' => $collection,
                'source' => 'media-api-upload',
            ]);
        } catch (RuntimeException $exception) {
            return $this->renderUploadRuntimeException($exception);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'success' => false,
                'error_code' => 'UPLOAD_API_FAILED',
                'message' => 'API upload anh dang loi may chu.',
                'detail' => 'Kiem tra backend, env luu tru, domain va reverse proxy tren deploy.',
            ], 500);
        }

        $payload = array_map(
            fn ($asset) => $this->mediaService->buildAssetPayload($asset),
            $assets
        );

        if (count($payload) === 1) {
            return response()->json([
                'success' => true,
                'url' => $payload[0]['large_url'] ?? $payload[0]['url'] ?? '',
                'image' => $payload[0],
            ]);
        }

        return response()->json([
            'success' => true,
            'images' => $payload,
        ]);
    }

    private function renderUploadRuntimeException(RuntimeException $exception)
    {
        $message = trim($exception->getMessage());

        if (str_contains($message, 'Khong the luu anh len Cloudflare R2')) {
            report($exception);

            return response()->json([
                'success' => false,
                'error_code' => 'UPLOAD_STORAGE_FAILED',
                'message' => 'API upload khong the ghi anh len kho luu tru.',
                'detail' => 'Kiem tra R2/S3, bien moi truong, quyen ghi va ket noi tu backend.',
            ], 503);
        }

        if (
            str_contains($message, 'Khong the doc tep anh')
            || str_contains($message, 'Du lieu anh dau vao dang rong')
        ) {
            return response()->json([
                'success' => false,
                'error_code' => 'INVALID_IMAGE_FILE',
                'message' => $message !== '' ? $message : 'File anh upload khong hop le.',
            ], 422);
        }

        report($exception);

        return response()->json([
            'success' => false,
            'error_code' => 'UPLOAD_RUNTIME_FAILED',
            'message' => $message !== '' ? $message : 'Upload anh that bai tren may chu.',
        ], 500);
    }
}
