<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class ForceCorsHeaders
{
    private const ALLOWED_ORIGINS = [
        'https://admin.gomdaithanh.com',
        'https://gomdaithanh.com',
        'https://www.gomdaithanh.com',
    ];

    private const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

    private const DEFAULT_ALLOWED_HEADERS = 'Authorization, Content-Type, X-Requested-With, X-XSRF-TOKEN, X-CSRF-TOKEN, X-Account-Id, X-Site-Code, Accept, Origin';

    public function handle(Request $request, Closure $next): Response
    {
        if (!$this->shouldHandle($request)) {
            return $next($request);
        }

        $origin = $this->allowedOrigin($request);
        if ($request->isMethod('OPTIONS')) {
            return $this->withCorsHeaders(response()->noContent(), $request, $origin);
        }

        try {
            $response = $next($request);
        } catch (Throwable $exception) {
            app(ExceptionHandler::class)->report($exception);
            $response = app(ExceptionHandler::class)->render($request, $exception);
        }

        return $this->withCorsHeaders($response, $request, $origin);
    }

    private function shouldHandle(Request $request): bool
    {
        return $request->is('api/*') || $request->is('sanctum/csrf-cookie');
    }

    private function allowedOrigin(Request $request): ?string
    {
        $origin = rtrim((string) $request->headers->get('Origin'), '/');

        return in_array($origin, self::ALLOWED_ORIGINS, true) ? $origin : null;
    }

    private function withCorsHeaders(Response $response, Request $request, ?string $origin): Response
    {
        if ($origin === null) {
            return $response;
        }

        $requestHeaders = trim((string) $request->headers->get('Access-Control-Request-Headers'));

        $response->headers->set('Access-Control-Allow-Origin', $origin);
        $response->headers->set('Access-Control-Allow-Credentials', 'true');
        $response->headers->set('Access-Control-Allow-Methods', self::ALLOWED_METHODS);
        $response->headers->set('Access-Control-Allow-Headers', $requestHeaders !== '' ? $requestHeaders : self::DEFAULT_ALLOWED_HEADERS);
        $response->headers->set('Access-Control-Max-Age', '3600');
        $response->headers->set('Access-Control-Expose-Headers', 'Server-Timing, X-Webgom-Timing');
        $response->headers->set('Vary', trim($response->headers->get('Vary') . ', Origin', ', '));

        return $response;
    }
}
