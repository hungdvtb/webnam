# Ad Account Profit-Center History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators assign connected Facebook/Google advertising accounts to profit centers in non-overlapping effective-date ranges, and ensure stored daily spend and scoped reports follow the correct range.

**Architecture:** Keep `ad_account_profit_centers` as the assignment-history table by adding an effective start/end interval. `ProfitCenterController` owns interval normalization, connected-account discovery, and backfilling `daily_ads_spends.profit_center_id`. Ads sync resolves the assignment for the date being saved; reports filter stored spend by its date-correct profit center.

**Tech Stack:** Laravel migrations, Eloquent, PHPUnit feature tests, React, Axios, Tailwind utility classes.

---

## File structure

- Create: `backend/database/migrations/2026_06_24_000001_add_effective_dates_to_ad_account_profit_centers.php`
- Modify: `backend/app/Models/AdAccountProfitCenter.php`
- Modify: `backend/app/Http/Controllers/Api/ProfitCenterController.php`
- Modify: `backend/app/Services/FacebookAdsSyncService.php`
- Modify: `backend/app/Services/GoogleAdsSyncService.php`
- Modify: `backend/app/Http/Controllers/FinDailyProfitReportController.php`
- Modify: `frontend/src/pages/admin/ProfitCenterManager.jsx`
- Create: `backend/tests/Feature/AdAccountProfitCenterEffectiveDateTest.php`
- Create: `backend/tests/Feature/DailyProfitReportProfitCenterScopeTest.php`

### Task 1: Add temporal mapping support

**Files:**
- Create: `backend/database/migrations/2026_06_24_000001_add_effective_dates_to_ad_account_profit_centers.php`
- Modify: `backend/app/Models/AdAccountProfitCenter.php`
- Test: `backend/tests/Feature/AdAccountProfitCenterEffectiveDateTest.php`

- [ ] Write a failing feature test that seeds an existing 1900-01-01 mapping for TK3/Mảng A, posts a 2026-06-01 mapping for TK3/Mảng B, and asserts the old row ends 2026-05-31 while a new row starts 2026-06-01.
- [ ] Run `..\\php84\\php.exe artisan test tests/Feature/AdAccountProfitCenterEffectiveDateTest.php` and confirm it fails because the legacy unique index permits only one mapping per account.
- [ ] Add `effective_from` (date, default 1900-01-01) and nullable `effective_to` to the mapping table. Replace `ad_pc_account_platform_external_unique` with a unique index on `account_id, platform, external_account_id, effective_from`.
- [ ] Add both date fields to `$fillable` and casts in the model. Change `resolveProfitCenterId($platform, $externalAccountId, ?$date = null)` to match `effective_from <= date <= effective_to` and return the newest matching interval.
- [ ] Re-run the model/API test and commit the migration, model, and test.

### Task 2: Persist non-overlapping intervals and repair saved spend

**Files:**
- Modify: `backend/app/Http/Controllers/Api/ProfitCenterController.php`
- Modify: `backend/app/Services/FacebookAdsSyncService.php`
- Modify: `backend/app/Services/GoogleAdsSyncService.php`
- Test: `backend/tests/Feature/AdAccountProfitCenterEffectiveDateTest.php`

- [ ] Extend API validation with `effective_from => nullable|date` and `effective_to => nullable|date|after_or_equal:effective_from`; default missing starts to 1900-01-01 for legacy callers.
- [ ] Replace the current destructive “save list then delete omitted IDs” block with an interval upsert. An incoming start date updates the matching start row, otherwise it creates a row, closes the prior interval at the preceding day, and ends itself at the day before the next interval. Lock rows for the account/platform/ID inside the transaction.
- [ ] After each saved row, reassign matching `DailyAdsSpend` rows by platform, normalized external account ID, and effective dates. Recompute the predecessor’s affected period through the date-aware resolver so no old spend retains the new center.
- [ ] Pass the loop’s `$date` to `resolveProfitCenterId` in both Ads sync services.
- [ ] Extend the test with stored spends for 2026-05-31 and 2026-06-01; after saving B, assert they reference A and B respectively.
- [ ] Run `..\\php84\\php.exe artisan test tests/Feature/AdAccountProfitCenterEffectiveDateTest.php` and commit.

### Task 3: Provide connected-account candidates and correct report scoping

**Files:**
- Modify: `backend/app/Http/Controllers/Api/ProfitCenterController.php`
- Modify: `backend/app/Http/Controllers/FinDailyProfitReportController.php`
- Test: `backend/tests/Feature/DailyProfitReportProfitCenterScopeTest.php`

- [ ] In the profit-center index response add `available_ad_accounts`, merged and deduplicated from configured Facebook IDs, Google customer IDs, existing history rows, and saved per-account spend. Return only platform, normalized external ID, remembered name, and whether the account has history; never return secrets.
- [ ] Include `effective_from`, `effective_to`, and `is_current` in the mapping payload.
- [ ] In `dailyAdsSpendTotalsByDate`, keep the existing configured-account/null-account fallback for unscoped reports. For restricted or explicitly selected profit centers, filter the query by date-correct `daily_ads_spends.profit_center_id` instead of selecting account IDs from timeless mappings.
- [ ] Write a report test with the same account’s 100 spend on 2026-05-31 in A and 200 spend on 2026-06-01 in B. Assert a report scoped to A returns 100 and B returns 200.
- [ ] Run `..\\php84\\php.exe artisan test tests/Feature/DailyProfitReportProfitCenterScopeTest.php tests/Feature/DailyProfitReportSpecialProfitTest.php` and commit.

### Task 4: Add a fast dated assignment interface

**Files:**
- Modify: `frontend/src/pages/admin/ProfitCenterManager.jsx`

- [ ] Add local state for candidates, search text, selected account keys, quick-assignment profit center, and an effective-start date defaulting to today.
- [ ] Replace the manual-only draft block with a “Gán nhanh từ tài khoản đã kết nối” section: platform filter, ID/name search, multi-checkbox account list, profit-center select, effective-start input, selected-count, and “Thêm mốc gán” button.
- [ ] Add selected candidates to `adMappings` using platform, ID, name, center, start date, blank end date and active status. Deduplicate only identical account+platform+start rows; never remove historical rows.
- [ ] Convert the mapping grid into a chronological history table with start/end columns and a “Đang áp dụng” state. Retain a compact manual-entry row for exceptional accounts absent from candidates.
- [ ] Save `effective_from` and `effective_to` through the existing API client; consume `available_ad_accounts` from the index response.
- [ ] Run `npm.cmd run build` and visually verify: 01/05 TK3→A then 01/06 TK3→B displays A ending 31/05 and B as current.
- [ ] Commit the frontend change.

### Task 5: Final verification

**Files:**
- Verify only

- [ ] Run `..\\php84\\php.exe artisan test tests/Feature/AdAccountProfitCenterEffectiveDateTest.php tests/Feature/DailyProfitReportProfitCenterScopeTest.php tests/Feature/DailyProfitReportSpecialProfitTest.php`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `git diff --check` and inspect `git status --short`; stage only the files in this feature plus its spec/plan documents.
