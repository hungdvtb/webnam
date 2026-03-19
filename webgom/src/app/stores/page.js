import StoresClient from '@/components/stores/StoresClient';

export const metadata = {
  title: 'Hệ Thống Cửa Hàng | Di Sản Gốm Việt',
  description: 'Tìm showroom và cửa hàng Di Sản Gốm Việt gần bạn nhất. 4 điểm trưng bày và bán hàng trải dài từ Hà Nội, Bát Tràng, Đà Nẵng đến TP. Hồ Chí Minh.',
};

export default function StoresPage() {
  return <StoresClient />;
}
