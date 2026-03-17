<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class MediaController extends Controller
{
    public function upload(Request $request)
    {
        $request->validate([
            'image' => 'required|image|mimes:jpeg,png,jpg,gif,webp|max:5120', // 5MB max
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
