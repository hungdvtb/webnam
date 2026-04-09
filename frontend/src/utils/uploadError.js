const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/svg+xml',
]);
const SUPPORTED_IMAGE_LABEL = 'JPEG, PNG, JPG, GIF, WEBP, AVIF hoac SVG';

const normalizeText = (value) => String(value || '').trim();

const getFileExtension = (name = '') => {
    const normalizedName = normalizeText(name);
    const lastDotIndex = normalizedName.lastIndexOf('.');

    if (lastDotIndex < 0) {
        return '';
    }

    return normalizedName.slice(lastDotIndex + 1).toLowerCase();
};

const extractFirstValidationMessage = (error) => Object.values(error?.response?.data?.errors || {})
    .flat()
    .map((value) => normalizeText(value))
    .find(Boolean) || '';

const extractServerMessage = (error) => normalizeText(
    error?.response?.data?.message || error?.response?.data?.error
);

const extractServerDetail = (error) => normalizeText(error?.response?.data?.detail);

const buildAxiosRequestUrl = (error) => {
    if (typeof window === 'undefined') {
        return null;
    }

    const rawUrl = normalizeText(error?.config?.url);
    const rawBaseUrl = normalizeText(error?.config?.baseURL) || window.location.origin;

    if (!rawUrl && !rawBaseUrl) {
        return null;
    }

    try {
        return new URL(rawUrl || rawBaseUrl, rawBaseUrl);
    } catch {
        return null;
    }
};

const isLikelyCorsUploadError = (error) => {
    if (typeof window === 'undefined' || error?.response) {
        return false;
    }

    const code = normalizeText(error?.code).toUpperCase();
    const message = normalizeText(error?.message);
    const requestUrl = buildAxiosRequestUrl(error);
    const isNetworkStyleError = code === 'ERR_NETWORK'
        || /network error|failed to fetch|load failed/i.test(message);

    if (!isNetworkStyleError || !requestUrl) {
        return false;
    }

    return requestUrl.origin !== window.location.origin;
};

const isInvalidImageTypeMessage = (message) => /file of type|mime|mimes|dinh dang|khong hop le|khong duoc ho tro/i.test(message);

const isFileTooLargeMessage = (message) => /too large|payload too large|post too large|max|vuot qua|qua lon|qua nang|dung luong/i.test(message);

export const validateImageFileForUpload = (file) => {
    if (!file) {
        return 'Chua co file anh nao duoc chon.';
    }

    const fileSize = Number(file.size || 0);
    const fileType = normalizeText(file.type).toLowerCase();
    const fileExtension = getFileExtension(file.name);
    const isSupportedType = (fileType && SUPPORTED_IMAGE_MIME_TYPES.has(fileType))
        || (fileExtension && SUPPORTED_IMAGE_EXTENSIONS.has(fileExtension));

    if (!isSupportedType) {
        return `Dinh dang anh khong duoc ho tro. Chi chap nhan ${SUPPORTED_IMAGE_LABEL}.`;
    }

    if (fileSize > MAX_IMAGE_UPLOAD_BYTES) {
        return 'Anh vuot qua gioi han 10MB. Hay nen nho hon roi thu lai.';
    }

    return '';
};

export const resolveImageUploadError = (error) => {
    if (normalizeText(error?.userMessage)) {
        return {
            code: 'CLIENT_UPLOAD_ERROR',
            message: normalizeText(error.userMessage),
        };
    }

    if (isLikelyCorsUploadError(error)) {
        const requestUrl = buildAxiosRequestUrl(error);
        const requestOrigin = requestUrl?.origin || 'API upload';
        const browserOrigin = typeof window !== 'undefined' ? window.location.origin : 'trinh duyet hien tai';

        return {
            code: 'CORS_UPLOAD_BLOCKED',
            message: `CORS: trinh duyet da chan request upload tu ${browserOrigin} sang ${requestOrigin}. Kiem tra Access-Control-Allow-Origin, reverse proxy va domain deploy cua API upload.`,
        };
    }

    const status = Number(error?.response?.status || 0);
    const validationMessage = extractFirstValidationMessage(error);
    const serverMessage = extractServerMessage(error);
    const serverDetail = extractServerDetail(error);
    const errorCode = normalizeText(error?.response?.data?.error_code).toUpperCase();
    const combinedMessage = [validationMessage, serverMessage, serverDetail].filter(Boolean).join(' ');

    if (status === 401 || errorCode === 'UNAUTHENTICATED') {
        return {
            code: 'UNAUTHENTICATED',
            message: 'Token dang nhap da het han hoac khong hop le. Hay dang nhap lai roi thu upload anh.',
        };
    }

    if (status === 403 || errorCode === 'FORBIDDEN') {
        return {
            code: 'FORBIDDEN',
            message: 'Tai khoan hien tai khong co quyen upload anh tren API nay.',
        };
    }

    if (status === 413 || errorCode === 'FILE_TOO_LARGE' || isFileTooLargeMessage(combinedMessage)) {
        return {
            code: 'FILE_TOO_LARGE',
            message: validationMessage || serverMessage || 'Anh vuot qua gioi han dung luong cua may chu. Hay giam dung luong roi thu lai.',
        };
    }

    if (errorCode === 'UPLOAD_STORAGE_FAILED') {
        return {
            code: 'UPLOAD_STORAGE_FAILED',
            message: serverMessage || 'API upload dang loi kho luu tru. Kiem tra R2/S3, env va quyen ghi tren backend.',
        };
    }

    if (validationMessage && isInvalidImageTypeMessage(validationMessage)) {
        return {
            code: 'INVALID_IMAGE_TYPE',
            message: validationMessage,
        };
    }

    if (status >= 500) {
        return {
            code: 'UPLOAD_API_FAILED',
            message: serverMessage || 'API upload anh dang loi may chu. Kiem tra backend, env va reverse proxy tren deploy.',
        };
    }

    if (validationMessage) {
        return {
            code: 'INVALID_UPLOAD_PAYLOAD',
            message: validationMessage,
        };
    }

    if (serverMessage) {
        return {
            code: errorCode || 'UPLOAD_FAILED',
            message: serverMessage,
        };
    }

    return {
        code: 'UPLOAD_REQUEST_FAILED',
        message: 'Khong nhan duoc phan hoi hop le tu API upload. Kiem tra domain, HTTPS, proxy va ket noi mang.',
    };
};
