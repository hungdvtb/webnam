<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;

use App\Models\Post;
use App\Models\Account;
use Illuminate\Support\Str;

class BlogController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Post::query();

        // Multi-tenancy filter
        if ($request->has('site_code')) {
            $account = Account::where('site_code', $request->site_code)->first();
            if ($account) {
                $query->where('account_id', $account->id);
            }
        } elseif ($request->header('X-Account-Id') && $request->header('X-Account-Id') !== 'all') {
            $query->where('account_id', $request->header('X-Account-Id'));
        }

        // Public only see published posts
        if (!$request->user()) {
            $query->published();
        }

        // Search by title
        if ($request->has('search')) {
            $query->where('title', 'like', '%' . $request->search . '%');
        }

        $perPage = $request->get('per_page', 9);
        $posts = $query->orderBy('created_at', 'desc')->paginate($perPage);

        return response()->json($posts);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'content' => 'required|string',
            'excerpt' => 'nullable|string',
            'featured_image' => 'nullable|string',
            'is_published' => 'boolean',
            'published_at' => 'nullable|date',
        ]);

        $accountId = $request->header('X-Account-Id');
        if (!$accountId) {
            return response()->json(['error' => 'Account ID is required'], 400);
        }

        $validated['account_id'] = $accountId;
        $validated['slug'] = Str::slug($validated['title']) . '-' . rand(1000, 9999);

        $post = Post::create($validated);

        return response()->json($post, 201);
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $post = Post::where('id', $id)
            ->orWhere('slug', $id)
            ->firstOrFail();

        return response()->json($post);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, $id)
    {
        $post = Post::findOrFail($id);

        $validated = $request->validate([
            'title' => 'sometimes|required|string|max:255',
            'content' => 'sometimes|required|string',
            'excerpt' => 'nullable|string',
            'featured_image' => 'nullable|string',
            'is_published' => 'sometimes|boolean',
            'published_at' => 'nullable|date',
        ]);

        if (isset($validated['title']) && $validated['title'] !== $post->title) {
            $validated['slug'] = Str::slug($validated['title']) . '-' . rand(1000, 9999);
        }

        $post->update($validated);

        return response()->json($post);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id)
    {
        $post = Post::findOrFail($id);
        $post->delete();

        return response()->json(['message' => 'Post deleted successfully']);
    }
}
