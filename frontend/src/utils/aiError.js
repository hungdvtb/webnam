import { isRetryableNetworkError, isRetryableResponseError } from '../services/api';

const normalizeText = (value) => String(value ?? '').trim();

const extractFirstValidationMessage = (error) => Object.values(error?.response?.data?.errors || {})
    .flat()
    .map((value) => normalizeText(value))
    .find(Boolean) || '';

const extractServerMessage = (error) => normalizeText(
    error?.response?.data?.message || error?.response?.data?.error
);

const extractServerDetail = (error) => normalizeText(error?.response?.data?.detail);

const extractNetworkMessage = (error) => {
    const rawMessage = normalizeText(error?.message);

    return /^request failed with status code\s+\d+/i.test(rawMessage) ? '' : rawMessage;
};

export const resolveAiRequestError = (
    error,
    fallbackMessage = 'Khong the xu ly yeu cau AI luc nay.'
) => {
    if (isRetryableNetworkError(error)) {
        return 'Ket noi tam thoi bi gian doan hoac bi doi mang. He thong se tu dong thu lai trong it giay nua.';
    }

    const validationMessage = extractFirstValidationMessage(error);
    if (validationMessage) {
        return validationMessage;
    }

    const serverMessage = extractServerMessage(error);
    const serverDetail = extractServerDetail(error);

    if (serverMessage && serverDetail && !serverMessage.includes(serverDetail)) {
        return `${serverMessage}\nChi tiet ky thuat: ${serverDetail}`;
    }

    if (serverMessage) {
        return serverMessage;
    }

    const networkMessage = extractNetworkMessage(error);
    if (networkMessage) {
        return networkMessage;
    }

    const status = Number(error?.response?.status || 0);
    if (isRetryableResponseError(error)) {
        return `${fallbackMessage}\nBackend tam thoi qua tai hoac dang khoi phuc. He thong se tiep tuc thu lai.`;
    }

    if (status >= 500) {
        return `${fallbackMessage}\nBackend AI dang loi hoac cau hinh deploy chua day du.`;
    }

    return fallbackMessage;
};

export default resolveAiRequestError;
