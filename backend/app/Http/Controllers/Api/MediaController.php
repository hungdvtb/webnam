<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MediaController extends Controller
{
    public function proxy(Request $request)
    {
        $validated = $request->validate([
            'url' => 'required|string|max:2048',
        ]);

        $path = parse_url($validated['url'], PHP_URL_PATH) ?: $validated['url'];

        if (!$path || !str_starts_with($path, '/storage/')) {
            return response()->json(['message' => 'Invalid image path'], 422);
        }

        $fullPath = public_path(ltrim($path, '/'));

        if (!is_file($fullPath)) {
            return response()->json(['message' => 'Image not found'], 404);
        }

        return response()->file($fullPath, [
            'Cache-Control' => 'public, max-age=86400',
            'Content-Disposition' => 'inline; filename="' . basename($fullPath) . '"',
        ]);
    }

    public function upload(Request $request)
    {
        $request->validate([
            'image' => 'required|file|mimes:jpeg,png,jpg,gif,webp,avif,svg|max:10240',
        ]);

        if ($request->hasFile('image')) {
            $file = $request->file('image');
            $extension = $file->getClientOriginalExtension();
            $filename = Str::random(20) . '.' . $extension;
            
            // Store in public/uploads/editor
            $path = $file->storeAs('uploads/editor', $filename, 'public');
            
            return response()->json([
                'url' => asset('storage/' . $path),
                'success' => true
            ]);
        }

        return response()->json(['success' => false, 'message' => 'No image uploaded'], 400);
    }
}
