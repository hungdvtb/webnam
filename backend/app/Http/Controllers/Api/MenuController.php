<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Menu;
use App\Models\MenuItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MenuController extends Controller
{
    public function index(Request $request)
    {
        $accountId = $request->header('X-Account-Id');
        $menus = Menu::where('account_id', $accountId)->get();
        return response()->json($menus);
    }

    public function show($id)
    {
        $menu = Menu::with(['rootItems.children.children'])->findOrFail($id);
        return response()->json($menu);
    }

    public function getActive(Request $request)
    {
        $accountId = $request->header('X-Account-Id') ?: session()->get('active_account_id');

        $menu = Menu::where('account_id', $accountId)
            ->where('is_active', true)
            ->with(['rootItems.children.children'])
            ->first();

        return response()->json($menu);
    }

    public function getByCode($code)
    {
        $menu = Menu::where('code', $code)
            ->where('is_active', true)
            ->with(['rootItems.children.children'])
            ->firstOrFail();
            
        return response()->json($menu);
    }

    public function store(Request $request)
    {
        $accountId = $request->header('X-Account-Id') ?: session()->get('active_account_id');

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:255',
            'is_active' => 'boolean'
        ]);

        if (!empty($validated['is_active'])) {
             Menu::where('account_id', $accountId)->update(['is_active' => false]);
        }

        $menu = Menu::create(array_merge($validated, ['account_id' => $accountId]));
        return response()->json($menu, 201);
    }

    public function update(Request $request, $id)
    {
        $menu = Menu::findOrFail($id);
        $accountId = $menu->account_id;

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => 'sometimes|required|string|max:255',
            'is_active' => 'boolean'
        ]);

        if (isset($validated['is_active']) && $validated['is_active'] == true) {
            Menu::where('account_id', $accountId)->where('id', '!=', $id)->update(['is_active' => false]);
        }

        $menu->update($validated);
        return response()->json($menu);
    }

    public function destroy($id)
    {
        $menu = Menu::findOrFail($id);
        $menu->delete();
        return response()->json(null, 204);
    }

    /**
     * Save/Sync all menu items at once.
     * This is an efficient way to handle menu reordering/nesting from the frontend.
     */
    public function saveItems(Request $request, $id)
    {
        $menu = Menu::findOrFail($id);
        $items = $request->input('items', []);

        DB::transaction(function () use ($menu, $items) {
            // Option 1: Delete all and re-create (simple, works well for menus which aren't huge)
            $menu->items()->delete();
            $this->createItemsRecursively($menu->id, $items);
        });

        return response()->json($menu->load('rootItems.children.children'));
    }

    private function createItemsRecursively($menuId, $items, $parentId = null)
    {
        foreach ($items as $index => $itemData) {
            $item = MenuItem::create([
                'menu_id' => $menuId,
                'parent_id' => $parentId,
                'title' => $itemData['title'],
                'url' => $itemData['url'] ?? null,
                'target' => $itemData['target'] ?? '_self',
                'icon' => $itemData['icon'] ?? null,
                'order' => $index
            ]);

            if (!empty($itemData['children'])) {
                $this->createItemsRecursively($menuId, $itemData['children'], $item->id);
            }
        }
    }
}
