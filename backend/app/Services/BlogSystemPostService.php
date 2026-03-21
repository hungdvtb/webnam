<?php

namespace App\Services;

use App\Models\Account;
use App\Models\Post;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class BlogSystemPostService
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function definitions(): array
    {
        return [
            [
                'title' => 'Chính sách bảo hành',
                'slug' => 'chinh-sach-bao-hanh',
                'excerpt' => 'Quy định về phạm vi, thời gian và cách thức tiếp nhận bảo hành cho sản phẩm trên website.',
                'content' => <<<'HTML'
<h2>1. Phạm vi bảo hành</h2>
<p>Chúng tôi hỗ trợ bảo hành cho các sản phẩm bị lỗi kỹ thuật do nhà sản xuất hoặc phát sinh trong quá trình vận chuyển được xác nhận bởi hệ thống.</p>
<p>Những trường hợp hư hỏng do sử dụng sai hướng dẫn, va đập mạnh, tự ý sửa chữa hoặc hao mòn tự nhiên sẽ không thuộc phạm vi bảo hành.</p>
<h2>2. Thời gian bảo hành</h2>
<p>Thời gian bảo hành được tính từ ngày khách hàng nhận hàng thành công theo thông tin đơn hàng trên hệ thống.</p>
<p>Mỗi sản phẩm có thể có thời hạn bảo hành khác nhau. Nếu sản phẩm không ghi chú riêng, thời gian hỗ trợ mặc định là 7 ngày để tiếp nhận và đánh giá lỗi.</p>
<h2>3. Quy trình tiếp nhận</h2>
<ul>
<li>Khách hàng gửi mã đơn hàng, hình ảnh hoặc video mô tả lỗi cho bộ phận chăm sóc khách hàng.</li>
<li>Chúng tôi kiểm tra tình trạng sản phẩm và phản hồi phương án xử lý trong thời gian sớm nhất.</li>
<li>Nếu đủ điều kiện bảo hành, khách hàng sẽ được hướng dẫn gửi lại sản phẩm hoặc đổi sản phẩm tương đương.</li>
</ul>
<h2>4. Chi phí liên quan</h2>
<p>Trong trường hợp lỗi thuộc trách nhiệm của chúng tôi, chi phí vận chuyển bảo hành sẽ được hỗ trợ theo chính sách từng thời điểm.</p>
HTML,
            ],
            [
                'title' => 'Chính sách giao hàng',
                'slug' => 'chinh-sach-giao-hang',
                'excerpt' => 'Thông tin về phạm vi giao hàng, thời gian xử lý đơn và các lưu ý khi nhận hàng.',
                'content' => <<<'HTML'
<h2>1. Khu vực giao hàng</h2>
<p>Chúng tôi hỗ trợ giao hàng trên toàn quốc thông qua các đơn vị vận chuyển phù hợp với từng khu vực và đặc tính sản phẩm.</p>
<h2>2. Thời gian xử lý đơn</h2>
<p>Đơn hàng sẽ được xác nhận và xử lý trong giờ làm việc. Các đơn phát sinh ngoài giờ có thể được chuyển sang ngày làm việc kế tiếp.</p>
<p>Thời gian giao thực tế phụ thuộc vào địa chỉ nhận hàng, đơn vị vận chuyển và các yếu tố khách quan như thời tiết, lễ tết hoặc quy định địa phương.</p>
<h2>3. Phí giao hàng</h2>
<p>Phí giao hàng sẽ được hiển thị hoặc thông báo cho khách hàng trước khi xác nhận hoàn tất đơn hàng.</p>
<p>Một số chương trình khuyến mại có thể áp dụng ưu đãi miễn phí hoặc hỗ trợ một phần chi phí vận chuyển.</p>
<h2>4. Lưu ý khi giao nhận</h2>
<ul>
<li>Khách hàng vui lòng cung cấp đầy đủ họ tên, số điện thoại và địa chỉ nhận hàng chính xác.</li>
<li>Trong trường hợp không liên lạc được nhiều lần, đơn hàng có thể bị tạm hoãn hoặc hủy theo quy định vận hành.</li>
<li>Khách hàng nên kiểm tra tình trạng kiện hàng trước khi ký nhận để được hỗ trợ nhanh chóng nếu có vấn đề.</li>
</ul>
HTML,
            ],
            [
                'title' => 'Chính sách kiểm hàng',
                'slug' => 'chinh-sach-kiem-hang',
                'excerpt' => 'Hướng dẫn kiểm tra sản phẩm khi nhận hàng để đảm bảo đúng đơn và đúng tình trạng.',
                'content' => <<<'HTML'
<h2>1. Quyền kiểm hàng</h2>
<p>Khách hàng được kiểm tra tình trạng bên ngoài của kiện hàng và đối chiếu các thông tin cơ bản trước khi nhận.</p>
<h2>2. Nội dung cần kiểm tra</h2>
<ul>
<li>Tên người nhận, số điện thoại và mã đơn hàng.</li>
<li>Số lượng kiện, tình trạng bao bì và dấu hiệu móp méo, rách hoặc ướt.</li>
<li>Sản phẩm nhận được có đúng mẫu, đúng số lượng và đúng phân loại đã đặt hay không.</li>
</ul>
<h2>3. Trường hợp phát sinh bất thường</h2>
<p>Nếu phát hiện hàng hóa không đúng đơn, có dấu hiệu hư hỏng hoặc thiếu sản phẩm, khách hàng vui lòng lập tức thông báo cho nhân viên giao hàng và liên hệ với chúng tôi để được hỗ trợ.</p>
<p>Việc cung cấp hình ảnh hoặc video tại thời điểm nhận hàng sẽ giúp quá trình xử lý diễn ra nhanh hơn.</p>
<h2>4. Giới hạn kiểm hàng</h2>
<p>Việc kiểm hàng không bao gồm dùng thử sâu hoặc tác động làm thay đổi hiện trạng sản phẩm trước khi hoàn tất xác nhận nhận hàng.</p>
HTML,
            ],
            [
                'title' => 'Chính sách đổi trả hàng và hoàn tiền',
                'slug' => 'chinh-sach-doi-tra-hang-va-hoan-tien',
                'excerpt' => 'Điều kiện đổi trả, thời gian tiếp nhận và quy trình hoàn tiền cho các đơn hàng hợp lệ.',
                'content' => <<<'HTML'
<h2>1. Điều kiện đổi trả</h2>
<p>Chúng tôi hỗ trợ đổi trả khi sản phẩm giao sai, thiếu, lỗi kỹ thuật hoặc hư hỏng trong quá trình vận chuyển và được xác minh từ thông tin đơn hàng.</p>
<p>Sản phẩm đề nghị đổi trả cần còn đầy đủ phụ kiện, quà tặng đi kèm và không có dấu hiệu đã qua sử dụng ngoài phạm vi kiểm tra thông thường.</p>
<h2>2. Thời gian tiếp nhận</h2>
<p>Khách hàng vui lòng gửi yêu cầu đổi trả trong thời gian được công bố cho từng sản phẩm hoặc chương trình bán hàng. Nếu không có quy định riêng, thời gian tiếp nhận mặc định là 3 ngày kể từ khi nhận hàng.</p>
<h2>3. Quy trình xử lý</h2>
<ul>
<li>Gửi mã đơn hàng và thông tin mô tả tình trạng sản phẩm cho bộ phận hỗ trợ.</li>
<li>Chúng tôi kiểm tra điều kiện đổi trả và phản hồi phương án xử lý phù hợp.</li>
<li>Sau khi nhận lại hàng hợp lệ, hệ thống sẽ thực hiện đổi sản phẩm hoặc hoàn tiền theo xác nhận cuối cùng.</li>
</ul>
<h2>4. Hoàn tiền</h2>
<p>Khoản hoàn tiền sẽ được xử lý qua phương thức thanh toán phù hợp như chuyển khoản ngân hàng hoặc hoàn về kênh thanh toán ban đầu nếu có thể.</p>
<p>Thời gian nhận tiền thực tế phụ thuộc vào ngân hàng hoặc đơn vị trung gian thanh toán.</p>
HTML,
            ],
            [
                'title' => 'Chính sách bảo mật',
                'slug' => 'chinh-sach-bao-mat',
                'excerpt' => 'Cam kết thu thập, lưu trữ và sử dụng thông tin khách hàng đúng mục đích, an toàn và minh bạch.',
                'content' => <<<'HTML'
<h2>1. Mục đích thu thập thông tin</h2>
<p>Chúng tôi thu thập các thông tin cần thiết như họ tên, số điện thoại, địa chỉ, email và dữ liệu đơn hàng để phục vụ việc xác nhận, giao hàng, chăm sóc khách hàng và nâng cao chất lượng dịch vụ.</p>
<h2>2. Phạm vi sử dụng</h2>
<p>Thông tin khách hàng chỉ được sử dụng cho mục đích vận hành, hỗ trợ giao dịch, chăm sóc sau bán và các hoạt động liên quan đến website theo đúng quy định nội bộ.</p>
<h2>3. Bảo vệ dữ liệu</h2>
<p>Chúng tôi áp dụng các biện pháp quản lý và kỹ thuật phù hợp để hạn chế truy cập trái phép, thất thoát hoặc lạm dụng dữ liệu cá nhân.</p>
<p>Những bên thứ ba tham gia vào quá trình vận chuyển, thanh toán hoặc vận hành chỉ được tiếp cận phần thông tin cần thiết để hoàn thành nghiệp vụ liên quan.</p>
<h2>4. Quyền của khách hàng</h2>
<ul>
<li>Yêu cầu kiểm tra, cập nhật hoặc điều chỉnh thông tin khi phát hiện sai lệch.</li>
<li>Liên hệ với chúng tôi khi có thắc mắc về việc lưu trữ và sử dụng dữ liệu cá nhân.</li>
<li>Đề nghị ngừng nhận thông tin tiếp thị nếu không còn nhu cầu.</li>
</ul>
HTML,
            ],
        ];
    }

    public function ensureForAccount(?int $accountId): void
    {
        if (!$accountId || !$this->supportsSystemPosts()) {
            return;
        }

        $definitions = $this->definitions();
        $posts = Post::where('account_id', $accountId)
            ->whereIn('slug', array_column($definitions, 'slug'))
            ->get()
            ->keyBy('slug');

        foreach ($definitions as $index => $definition) {
            /** @var Post|null $post */
            $post = $posts->get($definition['slug']);

            if (!$post) {
                $post = new Post();
                $post->account_id = $accountId;
                $post->slug = $definition['slug'];
                $post->title = $definition['title'];
                $post->excerpt = $definition['excerpt'];
                $post->content = $definition['content'];
                $post->featured_image = null;
                $post->is_published = true;
                $post->published_at = now();
                $post->is_starred = false;
                $post->sort_order = $index + 1;
                $post->is_system = true;
                $post->save();
                continue;
            }

            $updates = [
                'is_system' => true,
                'sort_order' => $index + 1,
            ];

            if (!$this->hasMeaningfulText($post->title)) {
                $updates['title'] = $definition['title'];
            }

            if (!$this->hasMeaningfulText($post->excerpt)) {
                $updates['excerpt'] = $definition['excerpt'];
            }

            if (!$this->hasMeaningfulHtml($post->content)) {
                $updates['content'] = $definition['content'];
            }

            if ($post->is_published === null) {
                $updates['is_published'] = true;
            }

            if (!$post->published_at && ($post->is_published ?? true)) {
                $updates['published_at'] = now();
            }

            $post->update($updates);
        }
    }

    public function ensureForAllAccounts(): void
    {
        if (!$this->supportsSystemPosts() || !Schema::hasTable('accounts')) {
            return;
        }

        Account::query()
            ->select('id')
            ->orderBy('id')
            ->get()
            ->each(fn (Account $account) => $this->ensureForAccount((int) $account->id));
    }

    public function reservedSlugs(): array
    {
        return array_values(array_map(
            fn (array $definition) => (string) $definition['slug'],
            $this->definitions()
        ));
    }

    private function supportsSystemPosts(): bool
    {
        static $cache = null;

        if ($cache === null) {
            $cache = Schema::hasTable('posts')
                && Schema::hasColumn('posts', 'account_id')
                && Schema::hasColumn('posts', 'title')
                && Schema::hasColumn('posts', 'slug')
                && Schema::hasColumn('posts', 'content')
                && Schema::hasColumn('posts', 'excerpt')
                && Schema::hasColumn('posts', 'is_published')
                && Schema::hasColumn('posts', 'is_system')
                && Schema::hasColumn('posts', 'sort_order');
        }

        return $cache;
    }

    private function hasMeaningfulText(?string $value): bool
    {
        return trim((string) $value) !== '';
    }

    private function hasMeaningfulHtml(?string $value): bool
    {
        $normalized = trim(strip_tags((string) $value));

        return $normalized !== '';
    }
}
