<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;


class ProductImageController extends Controller
{
    /**
     * Upload images to S3 and associate with a product
     */
    public function store(Request $request, $productId)
    {
        $request->validate([
            'images' => 'required',
            'images.*' => 'image|mimes:jpeg,png,jpg,gif,webp|max:5120', // 5MB max each
        ]);

        $product = Product::findOrFail($productId);
        $uploadedImages = [];

        if($request->hasFile('images')) {
            foreach ($request->file('images') as $file) {
                // Use Storage::disk() as requested
                $disk = 's3';
                $path = Storage::disk($disk)->put('products', $file, 'public');
                
                // Construct Clean S3 URL
                $baseUrl = rtrim(config('filesystems.disks.s3.url'), '/');
                $url = $baseUrl . '/' . ltrim($path, '/');

                // Check if this is the first image, if so set as default primary
                $isPrimary = $product->images()->count() === 0;

                $image = ProductImage::create([
                    'product_id' => $productId,
                    'image_url' => $url,
                    'file_name' => $file->getClientOriginalName(),
                    'file_size' => $file->getSize(),
                    'is_primary' => $isPrimary,
                    'sort_order' => $product->images()->count()
                ]);

                $uploadedImages[] = $image;
            }
        }

        return response()->json($uploadedImages, 201);
    }

    /**
     * Set an image as primary (main)
     */
    public function setPrimary($id)
    {
        $image = ProductImage::findOrFail($id);
        
        // Reset all other images for this product
        ProductImage::where('product_id', $image->product_id)
            ->update(['is_primary' => false]);
            
        $image->update(['is_primary' => true]);
        
        return response()->json(['message' => 'Image set as primary.']);
    }

    /**
     * Delete an image from DB and S3
     */
    public function destroy($id)
    {
        $image = ProductImage::findOrFail($id);
        
        $disk = 's3';
        
        // Try to determine the path from the URL
        $url = $image->image_url;
        $path = '';

        // Case 1: URL starts with the disk's base URL
        $baseUrl = Storage::disk($disk)->url('');
        if (str_starts_with($url, $baseUrl)) {
            $path = str_replace($baseUrl, '', $url);
        } 
        // Case 2: Fallback for local storage URL format
        elseif (str_contains($url, '/storage/')) {
            $path = substr($url, strpos($url, '/storage/') + 9);
        }
        // Case 3: S3 direct URL format fallback
        elseif ($disk === 's3' && str_contains($url, '.amazonaws.com/')) {
            $path = substr($url, strrpos($url, '.amazonaws.com/') + 15);
        }

        $path = ltrim($path, '/');
        
        // Only attempt deletion if we have a valid non-empty path/key
        if (!empty($path) && Storage::disk($disk)->exists($path)) {
            Storage::disk($disk)->delete($path);
        }
        
        $image->delete();
        
        return response()->json(['message' => 'Image deleted successfully.']);
    }
    public function reorder(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:product_images,id'
        ]);

        foreach ($request->ids as $index => $id) {
            $isPrimary = $index === 0;
            ProductImage::where('id', $id)->update([
                'sort_order' => $index,
                'is_primary' => $isPrimary
            ]);
            
            // If we just set a new primary, make sure others for that product are not primary
            if ($isPrimary) {
                $img = ProductImage::find($id);
                ProductImage::where('product_id', $img->product_id)
                    ->where('id', '!=', $id)
                    ->update(['is_primary' => false]);
            }
        }

        return response()->json(['message' => 'Images reordered successfully.']);
    }

    /**
     * Generate or serve a lightweight cached 100x100 thumbnail to save bandwidth
     */
    public function thumbnail(Request $request)
    {
        $url = $request->query('url');
        if (!$url) return abort(404);

        // If it's an S3 URL, always redirect immediately to avoid local file path issues
        if (str_contains($url, 'amazonaws.com') || !str_contains($url, url('/storage'))) {
            return redirect($url);
        }

        // Graceful fallback if PHP GD extension is not available
        if (!function_exists('imagecreatefromjpeg')) {
            return redirect($url);
        }

        // Determine path from URL dynamically
        $path = str_replace(url('/storage') . '/', '', $url);
        $path = ltrim($path, '/');

        // Simple fallback if missing
        if (empty($path) || !Storage::disk('public')->exists($path)) {
            return redirect($url);
        }

        $fullPath = Storage::disk('public')->path($path);

        $thumbDir = storage_path('app/public/thumbs');
        if (!file_exists($thumbDir)) mkdir($thumbDir, 0755, true);

        $thumbPath = $thumbDir . '/' . md5($url) . '.webp';

        if (!file_exists($thumbPath)) {
            $info = @\getimagesize($fullPath);
            if (!$info) return redirect($url);

            $mime = $info['mime'];

            switch ($mime) {
                case 'image/jpeg': $img = @\imagecreatefromjpeg($fullPath); break;
                case 'image/png':  $img = @\imagecreatefrompng($fullPath);  break;
                case 'image/webp': $img = @\imagecreatefromwebp($fullPath); break;
                default: return redirect($url);
            }

            if (!$img) return redirect($url);

            $width  = $info[0];
            $height = $info[1];

            $newWidth  = 100;
            $newHeight = (int)($height * ($newWidth / $width));

            $thumb = \imagecreatetruecolor($newWidth, $newHeight);

            if ($mime == 'image/png' || $mime == 'image/webp') {
                \imagealphablending($thumb, false);
                \imagesavealpha($thumb, true);
                $transparent = \imagecolorallocatealpha($thumb, 255, 255, 255, 127);
                \imagefilledrectangle($thumb, 0, 0, $newWidth, $newHeight, $transparent);
            }

            \imagecopyresampled($thumb, $img, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

            // Quality 60 for low size target (10-40KB)
            \imagewebp($thumb, $thumbPath, 60);

            \imagedestroy($img);
            \imagedestroy($thumb);
        }

        return response()->file($thumbPath, [
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'Content-Type'  => 'image/webp'
        ]);
    }
}

