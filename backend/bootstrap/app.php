<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(\Illuminate\Http\Middleware\HandleCors::class);
        $middleware->prepend(\App\Http\Middleware\ForceCorsHeaders::class);
        $middleware->append(\App\Http\Middleware\IdentifyAccount::class);
        $middleware->append(\App\Http\Middleware\AuditAdminAction::class);
        $middleware->append(\App\Http\Middleware\FilterSensitiveAdminData::class);
        $middleware->alias([
            'admin' => \App\Http\Middleware\EnsureAdmin::class,
            'admin-permission' => \App\Http\Middleware\EnsureAdminPermission::class,
        ]);
        $middleware->redirectGuestsTo(function (Request $request) {
            return '/old/login';
        });
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (AuthenticationException $exception, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'error_code' => 'UNAUTHENTICATED',
                    'message' => 'Unauthenticated.',
                ], 401);
            }

            return redirect()->guest($exception->redirectTo($request) ?: '/old/login');
        });

        $exceptions->render(function (PostTooLargeException $exception, Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'error_code' => 'FILE_TOO_LARGE',
                    'message' => 'File upload vuot qua gioi han dung luong cua may chu.',
                    'detail' => 'Tang upload_max_filesize, post_max_size va client_max_body_size tren deploy, hoac giam dung luong anh upload.',
                ], 413);
            }

            return null;
        });
    })->create();
