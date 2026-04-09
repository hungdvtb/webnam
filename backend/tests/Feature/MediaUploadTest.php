<?php

namespace Tests\Feature;

use App\Services\MediaService;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\UploadedFile;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

class MediaUploadTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('r2');
        $this->withoutMiddleware(Authenticate::class);
    }

    public function test_media_upload_options_request_returns_cors_headers_for_admin_origin(): void
    {
        $origin = 'https://admin.gomdaithanh.com';

        $response = $this->withHeaders([
            'Origin' => $origin,
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'authorization,content-type,x-account-id,x-site-code',
        ])->options('/api/media/upload');

        $response->assertNoContent();
        $this->assertSame($origin, $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertSame('true', $response->headers->get('Access-Control-Allow-Credentials'));
    }

    public function test_media_upload_rejects_unsupported_file_type_with_clear_message(): void
    {
        $response = $this->withHeaders([
            'Accept' => 'application/json',
        ])->post('/api/media/upload', [
            'image' => UploadedFile::fake()->create('bundle.pdf', 200, 'application/pdf'),
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonPath('message', 'Dinh dang anh khong duoc ho tro. Chi chap nhan JPEG, PNG, JPG, GIF, WEBP, AVIF hoac SVG.')
            ->assertJsonPath('errors.image.0', 'Dinh dang anh khong duoc ho tro. Chi chap nhan JPEG, PNG, JPG, GIF, WEBP, AVIF hoac SVG.');
    }

    public function test_media_upload_returns_storage_failure_code_with_json_payload(): void
    {
        $this->mock(MediaService::class, function ($mock): void {
            $mock->shouldReceive('uploadImages')
                ->once()
                ->andThrow(new RuntimeException('Khong the luu anh len Cloudflare R2.'));
        });

        $response = $this->withHeaders([
            'Accept' => 'application/json',
        ])->post('/api/media/upload', [
            'image' => UploadedFile::fake()->create('bundle.png', 20, 'image/png'),
        ]);

        $response
            ->assertStatus(503)
            ->assertJsonPath('error_code', 'UPLOAD_STORAGE_FAILED')
            ->assertJsonPath('message', 'API upload khong the ghi anh len kho luu tru.');
    }

    public function test_post_too_large_exception_returns_structured_json_payload(): void
    {
        Route::post('/api/test-post-too-large', static function () {
            throw new PostTooLargeException('payload too large');
        });

        $response = $this->withHeaders([
            'Accept' => 'application/json',
        ])->post('/api/test-post-too-large');

        $response
            ->assertStatus(413)
            ->assertJsonPath('error_code', 'FILE_TOO_LARGE')
            ->assertJsonPath('message', 'File upload vuot qua gioi han dung luong cua may chu.');
    }
}
