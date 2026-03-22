import StoresClient from '@/components/stores/StoresClient';
import { getWebSiteSettings } from '@/lib/api';

export const metadata = {
  title: 'Hệ Thống Cửa Hàng | Di Sản Gốm Việt',
  description: 'Tìm showroom, chi nhánh và xưởng sản xuất của Di Sản Gốm Việt. Thông tin cửa hàng được cập nhật trực tiếp từ cài đặt website.',
};

export default async function StoresPage() {
  let settings = {};

  try {
    settings = await getWebSiteSettings();
  } catch (error) {
    console.error('Failed to fetch store settings:', error);
  }

  return <StoresClient stores={settings?.store_locations || []} />;
}
