<?php

namespace App\Console\Commands;

use App\Models\Product;
use App\Models\ProductReview;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SeedSampleProductReviews extends Command
{
    protected $signature = 'reviews:seed-sample
        {--min=70 : Minimum sample reviews per product}
        {--max=100 : Maximum sample reviews per product}
        {--years=4 : Maximum age in years}
        {--status=hidden : Review status: hidden, pending, visible}
        {--replace : Replace existing sample/test reviews only}
        {--all-products : Include inactive products}
        {--dry-run : Show what would be created without writing}';

    protected $description = 'Seed sample/test product reviews for local or staging environments.';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing', 'staging', 'development'])) {
            $this->error('Refused: sample review seeding is only available in local/testing/staging/development.');
            return self::FAILURE;
        }

        $min = max(1, (int) $this->option('min'));
        $max = max($min, (int) $this->option('max'));
        $years = max(1, (int) $this->option('years'));
        $status = (string) $this->option('status');
        $replace = (bool) $this->option('replace');
        $dryRun = (bool) $this->option('dry-run');

        if (! in_array($status, [
            ProductReview::STATUS_HIDDEN,
            ProductReview::STATUS_PENDING,
            ProductReview::STATUS_VISIBLE,
        ], true)) {
            $this->error('Invalid --status. Use hidden, pending, or visible.');
            return self::FAILURE;
        }

        $query = Product::query()
            ->select(['id', 'account_id', 'status'])
            ->when(! $this->option('all-products'), fn ($builder) => $builder->where('status', true))
            ->orderBy('id');

        $totalProducts = (clone $query)->count();
        if ($totalProducts === 0) {
            $this->warn('No products found.');
            return self::SUCCESS;
        }

        $stats = [
            'products' => 0,
            'skipped_existing' => 0,
            'deleted_existing' => 0,
            'created_reviews' => 0,
            'created_replies' => 0,
        ];

        $this->info(($dryRun ? '[dry-run] ' : '') . "Preparing sample reviews for {$totalProducts} products.");
        $productOrdinal = 0;
        $usedComments = [];

        $query->chunkById(50, function ($products) use ($min, $max, $years, $status, $replace, $dryRun, &$stats, &$productOrdinal, &$usedComments) {
            foreach ($products as $product) {
                $productOrdinal++;
                $productSequence = $productOrdinal;
                $existingQuery = ProductReview::query()
                    ->where('product_id', $product->id)
                    ->where('source_type', ProductReview::SOURCE_ADMIN_SAMPLE)
                    ->whereNull('parent_id');

                if ($existingQuery->exists() && ! $replace) {
                    $stats['skipped_existing']++;
                    continue;
                }

                $reviewCount = random_int($min, $max);
                $ratings = $this->ratingsForTargetAverage($reviewCount);
                $replyIndexes = $this->replyIndexes($reviewCount);
                $commentProfiles = $this->commentProfiles($reviewCount);
                $nameProfiles = $this->nameProfiles($reviewCount);

                if ($dryRun) {
                    $stats['products']++;
                    $stats['created_reviews'] += $reviewCount;
                    $stats['created_replies'] += count($replyIndexes);
                    continue;
                }

                DB::transaction(function () use ($product, $productSequence, $existingQuery, $replace, $status, $years, $ratings, $replyIndexes, $commentProfiles, $nameProfiles, &$stats, &$usedComments) {
                    if ($replace) {
                        $existingIds = $existingQuery->pluck('id');
                        $stats['deleted_existing'] += $existingIds->count();

                        if ($existingIds->isNotEmpty()) {
                            ProductReview::query()
                                ->whereIn('id', $existingIds)
                                ->delete();
                        }
                    }

                    $usedNames = [];

                    foreach ($ratings as $index => $rating) {
                        $createdAt = $this->randomReviewDate($years);
                        $comment = $this->uniqueComment($usedComments, $index, $productSequence, $commentProfiles[$index] ?? 'medium');
                        $customerName = $this->customerName(
                            $productSequence,
                            $index,
                            $usedNames,
                            $nameProfiles[$index] ?? 'full'
                        );

                        $review = ProductReview::create([
                            'account_id' => $product->account_id,
                            'product_id' => $product->id,
                            'parent_id' => null,
                            'user_id' => null,
                            'author_type' => 'guest',
                            'source_type' => ProductReview::SOURCE_ADMIN_SAMPLE,
                            'customer_name' => $customerName,
                            'is_anonymous' => false,
                            'rating' => $rating,
                            'comment' => $comment,
                            'status' => $status,
                            'is_approved' => $status === ProductReview::STATUS_VISIBLE,
                            'created_at' => $createdAt,
                            'admin_seen_at' => now(),
                        ]);

                        $stats['created_reviews']++;

                        if (in_array($index, $replyIndexes, true)) {
                            ProductReview::create([
                                'account_id' => $product->account_id,
                                'product_id' => $product->id,
                                'parent_id' => $review->id,
                                'user_id' => null,
                                'author_type' => 'admin',
                                'source_type' => ProductReview::SOURCE_ADMIN_SAMPLE,
                                'customer_name' => 'Gốm Đại Thành',
                                'is_anonymous' => false,
                                'rating' => 0,
                                'comment' => $this->shopReply($index),
                                'status' => $status,
                                'is_approved' => $status === ProductReview::STATUS_VISIBLE,
                                'created_at' => $this->replyDate($createdAt),
                                'admin_seen_at' => now(),
                            ]);

                            $stats['created_replies']++;
                        }
                    }

                    $stats['products']++;
                });
            }
        });

        $this->table(
            ['products', 'skipped_existing', 'deleted_existing', 'created_reviews', 'created_replies'],
            [[
                $stats['products'],
                $stats['skipped_existing'],
                $stats['deleted_existing'],
                $stats['created_reviews'],
                $stats['created_replies'],
            ]]
        );

        $this->info('Done. Ratings are generated with product averages between 4.8 and 5.0.');

        return self::SUCCESS;
    }

    private function ratingsForTargetAverage(int $count): array
    {
        $fourStars = random_int(
            max(1, (int) floor($count * 0.05)),
            max(1, (int) floor($count * 0.2))
        );
        $fiveStars = max(1, $count - $fourStars);
        $ratings = [];

        for ($i = 0; $i < $fiveStars; $i++) {
            $ratings[] = 5.0;
        }

        for ($i = 0; $i < $fourStars; $i++) {
            $ratings[] = 4.0;
        }

        shuffle($ratings);

        return $ratings;
    }

    private function commentProfiles(int $count): array
    {
        $shortCount = (int) round($count * 0.2);
        $mediumCount = (int) round($count * 0.5);
        $longCount = max(0, $count - $shortCount - $mediumCount);

        $profiles = array_merge(
            array_fill(0, $shortCount, 'short'),
            array_fill(0, $mediumCount, 'medium'),
            array_fill(0, $longCount, 'long'),
        );

        shuffle($profiles);

        return $profiles;
    }

    private function nameProfiles(int $count): array
    {
        $fullCount = (int) round($count * 0.4);
        $shortCount = (int) round($count * 0.2);
        $plainCount = (int) round($count * 0.15);
        $lowercaseCount = (int) round($count * 0.1);
        $abbreviatedCount = (int) round($count * 0.05);
        $compactCount = (int) round($count * 0.05);
        $nicknameCount = max(0, $count - $fullCount - $shortCount - $plainCount - $lowercaseCount - $abbreviatedCount - $compactCount);

        $profiles = array_merge(
            array_fill(0, $fullCount, 'full'),
            array_fill(0, $shortCount, 'short'),
            array_fill(0, $plainCount, 'plain'),
            array_fill(0, $lowercaseCount, 'lowercase'),
            array_fill(0, $abbreviatedCount, 'abbreviated'),
            array_fill(0, $compactCount, 'compact'),
            array_fill(0, $nicknameCount, 'nickname'),
        );

        shuffle($profiles);

        return $profiles;
    }

    private function replyIndexes(int $count): array
    {
        $indexes = range(0, $count - 1);
        shuffle($indexes);

        $min = max(3, (int) ceil($count * 0.25));
        $max = max($min, (int) ceil($count * 0.45));

        return array_slice($indexes, 0, random_int($min, $max));
    }

    private function randomReviewDate(int $years): Carbon
    {
        $maxDays = max(30, $years * 365);

        return now()
            ->subDays(random_int(3, $maxDays))
            ->subHours(random_int(0, 23))
            ->subMinutes(random_int(0, 59));
    }

    private function replyDate(Carbon $reviewDate): Carbon
    {
        $replyDate = $reviewDate->copy()->addMinutes(random_int(45, 7200));

        return $replyDate->greaterThan(now()->subHours(2))
            ? now()->subHours(random_int(2, 36))
            : $replyDate;
    }

    private function customerName(int $productSequence, int $index, array &$usedNames, string $profile): string
    {
        for ($attempt = 0; $attempt < 80; $attempt++) {
            $seed = (int) sprintf('%u', crc32("name:{$profile}:{$productSequence}:{$index}:{$attempt}"));
            $name = $this->nameForProfile($profile, $seed);
            $key = $this->nameKey($name);

            if (! isset($usedNames[$key])) {
                $usedNames[$key] = true;
                return $name;
            }
        }

        $fallback = 'khach ' . $productSequence . '-' . ($index + 1);
        $usedNames[$this->nameKey($fallback)] = true;

        return $fallback;
    }

    private function nameForProfile(string $profile, int $seed): string
    {
        $fullNames = [
            'Nguyễn Văn Hùng', 'Trần Thị Mai', 'Lê Quốc Bảo', 'Phạm Minh Đức',
            'Hoàng Anh Tuấn', 'Vũ Thị Hương', 'Đặng Thanh Bình', 'Bùi Ngọc Lan',
            'Đỗ Đức Mạnh', 'Hồ Thị Thu', 'Ngô Minh Khang', 'Dương Bảo Ngọc',
            'Lý Hải Đăng', 'Đinh Quang Huy', 'Trịnh Thu Hà', 'Mai Phương Linh',
            'Tạ Gia Bảo', 'Cao Nhật Minh', 'Lâm Khánh Vy', 'Tô Hữu Phúc',
            'Chu Thùy Trang', 'Hà Quang Nam', 'Đoàn Mỹ Duyên', 'Kiều Hoàng Long',
            'La Thanh Tùng', 'Lưu Anh Thư', 'Mạc Tiến Đạt', 'Nghiêm Bích Hạnh',
            'Quách Hồng Sơn', 'Phan Đức Anh', 'Võ Kim Chi', 'Huỳnh Gia Hân',
            'Nguyễn Bảo Châu', 'Trần Ngọc Ánh', 'Lê Thanh Trúc', 'Phạm Bích Ngọc',
            'Hoàng Khánh Linh', 'Vũ Minh Châu', 'Đặng Quốc Nam', 'Bùi Thu Trang',
            'Đỗ Văn Toàn', 'Hồ Anh Khoa', 'Ngô Thảo My', 'Dương Minh Tâm',
            'Lý Tuấn Kiệt', 'Đinh Hồng Nhung', 'Trịnh Bảo An', 'Mai Đức Duy',
            'Tạ Phương Uyên', 'Cao Gia Huy', 'Lâm Nhật Anh', 'Tô Khánh Hòa',
            'Chu Quang Khải', 'Hà Minh Ngọc', 'Đoàn Thị Loan', 'Kiều Đức Thắng',
            'Lưu Thanh Vân', 'Mạc Anh Dũng', 'Nghiêm Thùy Dung', 'Quách Gia Long',
        ];
        $shortNames = [
            'Hùng', 'Mai', 'Thảo', 'Tùng', 'Linh', 'Hương', 'Nam', 'Hà',
            'Bảo', 'Đức', 'Lan', 'Trang', 'Duy', 'Khoa', 'Huy', 'Phúc',
            'Vy', 'Châu', 'Trúc', 'Ngọc', 'Anh', 'Tâm', 'Tuấn', 'Bình',
            'Nhung', 'My', 'Loan', 'Vân', 'Sơn', 'Đạt', 'Mạnh', 'Dung',
            'Hạnh', 'Khải', 'Long', 'Toàn', 'Uyên', 'Kiệt', 'Duyên', 'Chi',
        ];
        $facebookNames = [
            'Ngọc Anh', 'Bảo Châu', 'Thanh Trúc', 'Bích Ngọc', 'Anh Thư',
            'Quốc Bảo', 'Thanh Tùng', 'Thu Trang', 'Minh Đức', 'Khánh Linh',
            'Gia Hân', 'Thảo My', 'Hải Yến', 'Hoàng Nam', 'Bảo An',
            'Phương Nhi', 'Minh Châu', 'Tuấn Anh', 'Ngọc Hân', 'Trúc Ly',
            'Hồng Nhung', 'Mai Anh', 'Diệu Linh', 'Hà My', 'Đức Anh',
        ];
        $plainNames = [
            'ngoc anh', 'tran van nam', 'le thi hoa', 'nguyen minh duc',
            'pham quoc bao', 'hoang anh tuan', 'vu thi huong', 'dang thanh binh',
            'bui ngoc lan', 'do duc manh', 'ho thi thu', 'ngo minh khang',
            'duong bao ngoc', 'ly hai dang', 'dinh quang huy', 'trinh thu ha',
            'mai phuong linh', 'ta gia bao', 'cao nhat minh', 'lam khanh vy',
            'to huu phuc', 'chu thuy trang', 'ha quang nam', 'doan my duyen',
            'kieu hoang long', 'la thanh tung', 'luu anh thu', 'mac tien dat',
            'nghiem bich hanh', 'quach hong son', 'ngoc anh 88', 'bao chau',
            'thanh truc', 'bich ngoc', 'minh tran', 'anh nguyen',
        ];
        $lowercaseNames = [
            'anh thu', 'quoc bao', 'thanh tung', 'ngọc anh', 'bảo châu',
            'thanh trúc', 'bích ngọc', 'thu trang', 'minh đức', 'khánh linh',
            'gia hân', 'thảo my', 'hải yến', 'hoàng nam', 'bảo an',
            'phương nhi', 'minh châu', 'tuấn anh', 'ngọc hân', 'trúc ly',
            'hồng nhung', 'mai anh', 'diệu linh', 'hà my', 'đức anh',
            'nguyễn văn hùng', 'trần thị mai', 'lê quốc bảo', 'phạm minh đức',
        ];
        $abbreviatedNames = [
            'T. Hùng', 'A. Thảo', 'N.Anh', 'M.Hải', 'Q. Bảo', 'H. Mai',
            'L. Trang', 'V. Linh', 'D. Mạnh', 'B. Ngọc', 'K. Vy', 'P. Đức',
            'T.Anh', 'N. Hân', 'M. Châu', 'H.Dũng', 'A. Khoa', 'T. Trúc',
            'B.Châu', 'L. Huy', 'D. Nam', 'H. Yến',
        ];
        $compactNames = [
            'ngocanh', 'thutrang', 'minhduc', 'baochau', 'thanhtung',
            'anhthu', 'quocbao', 'khanhlinh', 'giahân', 'thaomy',
            'haiyen', 'hoangnam', 'baoan', 'phuongnhi', 'minhchau',
            'tuananh', 'ngochan', 'trucly', 'hongnhung', 'maianh',
            'Anh.Nguyen', 'Minh_Tran', 'Bao090', 'Hoa88', 'Linh97',
            'NgocAnh95', 'Duc.Minh', 'Trang_Thu', 'Nam1990', 'Vy98',
            'Huyen_Anh', 'ThanhTung86', 'BaoChau88', 'MaiLinh97',
        ];
        $nicknames = [
            'chị ba', 'anh hai', 'mẹ bống', 'ba cu tí', 'cô út', 'chú sáu',
            'mẹ su', 'bố gạo', 'mẹ chip', 'anh tư', 'chị hai', 'cô năm',
            'mẹ bon', 'ba sóc', 'dì út', 'chú tư', 'mẹ mít', 'ba ken',
            'chị cả', 'anh ba', 'mẹ na', 'bố tôm', 'cô ba', 'chú năm',
        ];

        $name = match ($profile) {
            'short' => $seed % 5 < 3
                ? $this->pick($shortNames, $seed)
                : $this->pick($facebookNames, intdiv($seed, 7)),
            'plain' => $this->pick($plainNames, $seed),
            'lowercase' => $this->pick($lowercaseNames, $seed),
            'abbreviated' => $this->pick($abbreviatedNames, $seed),
            'compact' => $this->pick($compactNames, $seed),
            'nickname' => $this->pick($nicknames, $seed),
            default => $this->pick($fullNames, $seed),
        };

        return $this->naturalNameVariant($name, $profile, $seed);
    }

    private function naturalNameVariant(string $name, string $profile, int $seed): string
    {
        if (in_array($profile, ['abbreviated', 'compact'], true)) {
            return $name;
        }

        if ($profile === 'nickname') {
            return $seed % 4 === 0 ? mb_convert_case($name, MB_CASE_TITLE, 'UTF-8') : $name;
        }

        if ($profile === 'full') {
            return match ($seed % 10) {
                0 => mb_convert_case($name, MB_CASE_TITLE, 'UTF-8'),
                1 => preg_replace_callback('/^(\S+)\s+(\S+)(.*)$/u', function (array $matches) {
                    return $matches[1] . ' ' . mb_strtolower($matches[2], 'UTF-8') . $matches[3];
                }, $name) ?: $name,
                default => $name,
            };
        }

        if ($profile === 'plain' && $seed % 5 === 0) {
            return mb_convert_case($name, MB_CASE_TITLE, 'UTF-8');
        }

        if (in_array($profile, ['short', 'lowercase'], true) && $seed % 7 === 0) {
            return mb_convert_case($name, MB_CASE_TITLE, 'UTF-8');
        }

        if ($seed % 13 === 0) {
            return preg_replace('/\s+/u', '  ', $name, 1) ?: $name;
        }

        return $name;
    }

    private function nameKey(string $name): string
    {
        $key = trim(preg_replace('/\s+/u', ' ', $name) ?: $name);

        return mb_strtolower($key, 'UTF-8');
    }

    private function uniqueComment(array &$usedComments, int $index, int $productSequence, string $profile): string
    {
        for ($attempt = 0; $attempt < 1500; $attempt++) {
            $comment = $this->commentForProfile($profile, $index + $attempt, $productSequence);
            if (! isset($usedComments[$comment])) {
                $usedComments[$comment] = true;
                return $comment;
            }
        }

        $extras = [
            'nói chung nhà mình thấy ổn',
            'mình vẫn khá ưng',
            'cảm giác mua lần này ổn',
            'nhìn chung không có gì chê',
            'lần sau cần sẽ xem thêm',
            'cả nhà đều thấy được',
            'shop gói hàng cẩn thận',
            'mình thấy đáng tiền',
            'mở ra thấy yên tâm',
            'dùng thêm rồi sẽ ủng hộ tiếp',
        ];

        for ($attempt = 0; $attempt < 300; $attempt++) {
            $comment = $this->commentForProfile($profile, $index + 1500 + $attempt, $productSequence)
                . ' ' . $this->pick($extras, $productSequence + $index + $attempt) . '.';

            if (! isset($usedComments[$comment])) {
                $usedComments[$comment] = true;
                return $comment;
            }
        }

        $comment = $this->commentForProfile($profile, $index + 1900, $productSequence)
            . ' ' . $this->pick($extras, $productSequence + $index) . '.';
        $usedComments[$comment] = true;

        return $comment;
    }

    private function commentForProfile(string $profile, int $seed, int $productSequence): string
    {
        $baseSeed = (int) sprintf('%u', crc32("{$profile}:{$productSequence}:{$seed}"));

        return match ($profile) {
            'short' => $this->shortComment($baseSeed),
            'long' => $this->longComment($baseSeed),
            default => $this->mediumComment($baseSeed),
        };
    }

    private function shortComment(int $seed): string
    {
        $starts = [
            'nhận hàng rồi',
            'hàng về nguyên vẹn',
            'mở ra thấy ổn',
            'đóng gói kỹ',
            'gói chắc tay',
            'men nhìn đẹp',
            'màu nhìn dịu',
            'nhìn ngoài đẹp hơn',
            'shop tư vấn ổn',
            'giao hàng ok',
            'bố mẹ mình ưng',
            'đặt lên khá hợp',
            'nói chung đáng tiền',
            'mua lần đầu ổn',
            'hàng giống mô tả',
            'nhà mình thích',
            'nhìn gọn sạch',
            'đẹp hơn hình nha',
            'cầm thấy chắc tay',
            'ổn nha shop',
            'màu men ưng ý',
            'mở hộp yên tâm',
            'shop gửi cẩn thận',
            'hàng đẹp đó',
        ];
        $tails = [
            '',
            'nha',
            'ạ',
            'đó',
            'khá ổn',
            'nhìn sang',
            'rất ưng',
            'không lỗi',
            'vừa ý',
            'cảm ơn shop',
            'ổn áp',
            'được nha',
            'nhà mình ưng',
            'nhìn sạch',
            'ok lắm',
            'rất cẩn thận',
            'hợp ý mình',
            'khá thích',
            'đáng tiền',
            'nhìn nhẹ mắt',
        ];
        $particles = [
            '',
            'nha',
            'ạ',
            'luôn',
            'đó shop',
            'nhé',
            'rất ổn',
            'khá ưng',
            'ok nha',
            'cảm ơn shop',
        ];

        return trim(implode(' ', array_filter([
            $this->pick($starts, $seed),
            $this->pick($tails, intdiv($seed, 3) + 11),
            $this->pick($particles, intdiv($seed, 7) + 23),
        ])));
    }

    private function mediumComment(int $seed): string
    {
        $starts = [
            'hàng nhận được ổn',
            'mình vừa nhận hôm qua',
            'mở hộp ra thấy khá yên tâm',
            'shop tư vấn nhiệt tình',
            'giao có hơi lâu chút',
            'mua cho bố mẹ dùng',
            'mình đặt lần đầu ở shop',
            'nhìn ngoài đời dễ chịu hơn ảnh',
            'đóng gói rất chắc',
            'hàng về nguyên vẹn',
            'màu men nhìn nhã',
            'người nhà mình khen đẹp',
            'lúc đầu hơi lo khi mua online',
            'shop phản hồi tin nhắn nhanh',
            'mình kiểm tra lúc nhận hàng',
            'để lên nhìn vừa mắt',
            'mua tặng người thân',
            'nhìn tổng thể sạch sẽ',
            'màu không bị lòe loẹt',
            'đợt này vận chuyển hơi chậm',
            'hàng cầm chắc tay',
            'mình thấy giá vậy hợp lý',
            'nhà mình dùng mấy hôm rồi',
            'gói hàng khá kỹ',
            'shop có nhắn dặn kiểm tra',
            'mua online mà được vậy là ổn',
            'màu bên ngoài nhìn hiền',
            'hàng tới nơi không bị móp hộp',
            'mẹ mình mở ra thấy thích',
            'cảm giác shop làm cẩn thận',
        ];
        $details = [
            'đóng gói kỹ nên mở ra không lo',
            'nhìn ngoài đẹp hơn ảnh một chút',
            'không thấy sứt mẻ gì',
            'màu nhìn nhẹ mắt và dễ đặt trong nhà',
            'shop nói chuyện dễ chịu',
            'hàng giống mô tả của shop',
            'mở ra không thấy lỗi gì đáng ngại',
            'nhìn gọn, không bị rối mắt',
            'mình hỏi khá nhiều mà shop vẫn trả lời',
            'đặt lên thấy hợp với nhà mình',
            'bóc hơi lâu nhưng yên tâm',
            'màu men nhìn mịn và sáng vừa phải',
            'giao tới nơi vẫn còn nguyên vẹn',
            'người lớn trong nhà cũng ưng',
            'nhìn thật có cảm giác chắc chắn',
            'không bị khác nhiều so với ảnh',
            'shop chuẩn bị hàng khá cẩn thận',
            'tầm giá này mình thấy được',
            'hàng nhìn sạch sẽ, dễ dùng',
            'nhận xong thấy yên tâm hơn',
            'chèn hàng kỹ nên không bị va đập',
            'mở hộp ra nhìn khá thích',
            'màu hợp với không gian nhà mình',
            'dùng thử mấy ngày thấy ổn',
            'cả nhà xem đều bảo được',
            'không cần đổi trả gì cả',
            'mình thấy đáng tiền',
            'thái độ tư vấn ổn',
            'hàng nhìn không bị thô',
            'cảm giác cầm khá chắc',
        ];
        $closers = [
            'nhà mình khá ưng',
            'nói chung ổn nha',
            'lần sau cần sẽ xem thêm',
            'cảm ơn shop',
            'mình thấy đáng mua',
            'bố mẹ mình hài lòng',
            'vậy là được rồi',
            'khá vừa ý mình',
            'mua lần này không thất vọng',
            'sẽ giới thiệu cho người quen',
            'shop giữ vậy là tốt',
            'hy vọng dùng bền',
            'tổng thể ok',
            'không có gì phải chê nhiều',
            'mình chấm ổn áp',
            'nên mua nha',
            'mình sẽ quay lại',
            'đúng ý gia đình mình',
            'nhìn chung là ưng',
            'hài lòng hơn mình nghĩ',
        ];

        $first = $this->pick($starts, $seed);
        $second = $this->pick($details, intdiv($seed, 5) + 17);
        $third = $this->pick($closers, intdiv($seed, 7) + 29);

        return match ($seed % 4) {
            0 => "{$first}, {$second}. {$third}",
            1 => "{$first}. {$second}, {$third}",
            2 => "{$first}, {$second}, {$third}",
            default => "{$first}. {$second}. {$third}",
        };
    }

    private function longComment(int $seed): string
    {
        $openers = [
            'mình nhận hàng hôm qua',
            'ban đầu cũng hơi lo vì mua đồ dễ vỡ online',
            'shop tư vấn khá kiên nhẫn',
            'giao hàng có chậm hơn dự kiến một chút',
            'mua cho bố mẹ ở quê',
            'màu men bên ngoài nhìn nhẹ mắt',
            'đóng gói kỹ thật sự',
            'mình không rành đồ gốm lắm',
            'hàng về đúng hẹn với mình',
            'lúc đầu sợ màu bị khác nhiều',
            'shop gói cẩn thận và có dặn kiểm tra hàng',
            'mình đặt giúp người thân',
            'hàng nhìn ngoài sáng hơn ảnh một chút',
            'đợt này bên vận chuyển đi hơi lâu',
            'mới dùng chưa lâu nên chưa nói nhiều được',
            'nhà mình chọn khá lâu mới chốt',
            'mua online đồ gốm mình luôn sợ vỡ',
            'hàng không bị lỗi, màu nhìn dễ chịu',
            'mình mở hộp kiểm tra ngay lúc nhận',
            'shop nhắn tin xác nhận khá rõ',
        ];
        $checks = [
            'đóng gói chắc lắm, mở ra không bị sao',
            'lúc nhận thì thấy chèn rất kỹ',
            'mình hỏi đi hỏi lại mấy lần mà vẫn được trả lời đầy đủ',
            'nhưng hàng nguyên vẹn, không sứt mẻ',
            'ông bà bảo nhìn trang trọng mà không bị quá màu mè',
            'để lên thấy không bị chói',
            'bóc hơi lâu nhưng đổi lại yên tâm',
            'shop tư vấn rõ nên chọn dễ hơn',
            'mở ra kiểm tra thấy ổn hết',
            'nhận rồi thấy màu khá hài hòa',
            'mình mở ra thấy không lỗi gì',
            'nhận hàng xong mọi người bảo đẹp',
            'mình thích kiểu màu này vì không bị quá nổi',
            'shop có nhắn giải thích nên mình cũng thông cảm',
            'nhưng lúc nhận thì thấy ổn',
            'shop gửi thêm ảnh nên dễ hình dung hơn',
            'may là đóng gói rất chắc',
            'đặt lên thấy không gian gọn hơn',
            'hàng tới nơi còn nguyên vẹn',
            'màu thật nhìn dễ chịu hơn trên điện thoại',
        ];
        $feelings = [
            'màu ngoài đời nhìn dịu hơn ảnh',
            'hàng nhìn sạch sẽ, màu men ổn',
            'nhận hàng đúng như shop tư vấn',
            'mở ra nhìn đẹp hơn mình nghĩ',
            'mình thấy vậy là ổn',
            'hàng cầm chắc tay',
            'shop nhắn tin cũng lịch sự',
            'người nhà cũng khen',
            'màu bên ngoài dễ nhìn hơn trên điện thoại',
            'đặt trong nhà nhìn gọn',
            'nhìn tổng thể sạch sẽ',
            'shop tư vấn nhanh, nói chuyện dễ chịu',
            'đóng gói chắc, giao ổn',
            'nhận hàng thì không thất vọng',
            'men nhìn mịn, màu nhã',
            'cả nhà đều ưng',
            'nhìn thật ngoài đời cũng đẹp',
            'shop hỗ trợ nhiệt tình',
            'cảm giác mua khá yên tâm',
            'mình thấy hợp với nhà mình',
        ];
        $closers = [
            'nhà mình khá ưng',
            'nói chung đáng mua',
            'gia đình mình hài lòng',
            'lần sau cần thêm chắc vẫn quay lại',
            'cảm ơn shop',
            'nhà mình dùng mấy hôm rồi chưa thấy vấn đề gì',
            'mua lần này khá hài lòng',
            'sẽ lưu lại khi cần mua thêm',
            'cảm nhận chung là đáng tiền',
            'nhìn chung vẫn rất ok',
            'mình thấy giá này hợp lý',
            'cả nhà dùng thấy ổn',
            'hy vọng shop giữ cách đóng gói như vậy',
            'nếu cần thêm mình sẽ nhắn shop',
            'tổng thể là vừa ý',
            'mình không phải đổi trả gì',
            'nói chung shop làm cẩn thận',
            'mình đánh giá tốt',
            'dùng thêm thời gian nữa xem sao',
            'vậy là ổn rồi',
        ];

        $sentences = [
            $this->pick($openers, $seed),
            $this->pick($checks, intdiv($seed, 5) + 13),
            $this->pick($feelings, intdiv($seed, 7) + 19),
        ];

        if ($seed % 3 !== 0) {
            $sentences[] = $this->pick($closers, intdiv($seed, 11) + 23);
        }

        if ($seed % 5 === 0) {
            $sentences[] = 'nói chung nhà mình thấy ổn';
        }

        return implode('. ', $sentences) . '.';
    }

    private function pick(array $items, int $seed): string
    {
        return $items[$seed % count($items)];
    }

    private function shopReply(int $seed): string
    {
        $replies = [
            'Cảm ơn anh/chị đã ủng hộ.',
            'Dạ shop cảm ơn nhiều ạ.',
            'Cảm ơn phản hồi của anh/chị.',
            'Shop rất vui khi anh/chị hài lòng.',
            'Chúc gia đình nhiều sức khỏe.',
            'Dạ cảm ơn anh/chị, shop sẽ cố gắng hơn ạ.',
            'Shop cảm ơn anh/chị đã tin tưởng.',
            'Cảm ơn anh/chị, chúc mình một ngày tốt lành.',
            'Dạ shop ghi nhận phản hồi ạ.',
            'Cảm ơn anh/chị đã chia sẻ.',
        ];

        return $replies[$seed % count($replies)];
    }
}
