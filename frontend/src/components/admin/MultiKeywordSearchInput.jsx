import React, { useCallback, useMemo, useRef } from 'react';

const KEYWORD_SPLIT_PATTERN = /[,\n;\t]+/;
const KEYWORD_DELIMITER_PATTERN = /[,\n;\t]/;
const KEYWORD_TRAILING_DELIMITER_PATTERN = /[,\n;\t]\s*$/;

export const normalizeKeywordToken = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

export const parseKeywordTokens = (value) => {
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(KEYWORD_SPLIT_PATTERN);
    const seen = new Set();

    return rawItems.reduce((result, item) => {
        const normalized = normalizeKeywordToken(item);
        if (!normalized) {
            return result;
        }

        const dedupeKey = normalized.toLowerCase();
        if (seen.has(dedupeKey)) {
            return result;
        }

        seen.add(dedupeKey);
        result.push(normalized);
        return result;
    }, []);
};

export const serializeKeywordTokens = (value) => parseKeywordTokens(value).join(', ');

export const buildActiveKeywordTokens = (keywords = [], draftValue = '') => {
    const activeKeywords = parseKeywordTokens(keywords);
    const normalizedDraft = normalizeKeywordToken(draftValue);

    if (!normalizedDraft) {
        return activeKeywords;
    }

    return parseKeywordTokens([...activeKeywords, normalizedDraft]);
};

const mergeKeywordTokens = (currentKeywords = [], nextKeywords = []) => (
    parseKeywordTokens([...parseKeywordTokens(currentKeywords), ...parseKeywordTokens(nextKeywords)])
);

const MultiKeywordSearchInput = ({
    keywords = [],
    draftValue = '',
    onChange,
    onFocus,
    placeholder = 'Nhập từ khóa, bấm Enter hoặc dấu phẩy để thêm...',
}) => {
    const inputRef = useRef(null);
    const normalizedKeywords = useMemo(() => parseKeywordTokens(keywords), [keywords]);
    const hasValue = normalizedKeywords.length > 0 || normalizeKeywordToken(draftValue) !== '';

    const emitChange = useCallback((nextKeywords, nextDraftValue = '') => {
        if (typeof onChange === 'function') {
            onChange({
                keywords: parseKeywordTokens(nextKeywords),
                draftValue: nextDraftValue,
            });
        }
    }, [onChange]);

    const commitDraft = useCallback((draftOverride = draftValue) => {
        const normalizedDraft = normalizeKeywordToken(draftOverride);
        if (!normalizedDraft) {
            emitChange(normalizedKeywords, '');
            return false;
        }

        emitChange(mergeKeywordTokens(normalizedKeywords, [normalizedDraft]), '');
        return true;
    }, [draftValue, emitChange, normalizedKeywords]);

    const handleInputChange = useCallback((event) => {
        const nextDraftValue = event.target.value;

        if (!KEYWORD_DELIMITER_PATTERN.test(nextDraftValue)) {
            emitChange(normalizedKeywords, nextDraftValue);
            return;
        }

        const fragments = nextDraftValue.split(KEYWORD_SPLIT_PATTERN);
        const trailingFragment = fragments.pop() ?? '';
        const committedKeywords = parseKeywordTokens(fragments);
        const shouldCommitTrailingFragment = KEYWORD_TRAILING_DELIMITER_PATTERN.test(nextDraftValue);
        const nextKeywords = shouldCommitTrailingFragment
            ? mergeKeywordTokens(normalizedKeywords, committedKeywords)
            : mergeKeywordTokens(normalizedKeywords, committedKeywords);
        const nextDraft = shouldCommitTrailingFragment ? '' : trailingFragment;

        emitChange(nextKeywords, nextDraft);
    }, [emitChange, normalizedKeywords]);

    const handleInputKeyDown = useCallback((event) => {
        if ((event.key === 'Enter' || event.key === 'Tab' || event.key === ',') && normalizeKeywordToken(draftValue)) {
            event.preventDefault();
            commitDraft();
            return;
        }

        if (event.key === 'Backspace' && draftValue === '' && normalizedKeywords.length > 0) {
            event.preventDefault();
            emitChange(normalizedKeywords.slice(0, -1), '');
        }
    }, [commitDraft, draftValue, emitChange, normalizedKeywords]);

    const handlePaste = useCallback((event) => {
        const pastedText = event.clipboardData?.getData('text') || '';

        if (!KEYWORD_DELIMITER_PATTERN.test(pastedText)) {
            return;
        }

        event.preventDefault();

        const nextKeywords = mergeKeywordTokens(
            normalizedKeywords,
            parseKeywordTokens(draftValue ? `${draftValue},${pastedText}` : pastedText)
        );

        emitChange(nextKeywords, '');
    }, [draftValue, emitChange, normalizedKeywords]);

    const handleRemoveKeyword = useCallback((keywordToRemove) => {
        emitChange(
            normalizedKeywords.filter((keyword) => keyword.toLowerCase() !== String(keywordToRemove).toLowerCase()),
            draftValue
        );
        inputRef.current?.focus();
    }, [draftValue, emitChange, normalizedKeywords]);

    const handleClearAll = useCallback((event) => {
        event.stopPropagation();
        emitChange([], '');
        inputRef.current?.focus();
    }, [emitChange]);

    return (
        <div
            className="relative w-full"
            onClick={() => inputRef.current?.focus()}
        >
            <div className="flex min-h-[38px] w-full items-start gap-2 rounded-sm border border-primary/10 bg-primary/5 pl-8 pr-2 transition-all focus-within:border-primary/30">
                <span className="material-symbols-outlined pointer-events-none absolute left-2 top-2.5 text-[16px] text-primary/40">
                    search
                </span>

                <div className="flex max-h-[78px] min-h-[36px] flex-1 flex-wrap items-center gap-1 overflow-y-auto py-1 pr-1">
                    {normalizedKeywords.map((keyword) => (
                        <span
                            key={keyword.toLowerCase()}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/15 bg-white px-2.5 py-1 text-[12px] font-bold text-primary shadow-sm"
                        >
                            <span className="truncate">{keyword}</span>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleRemoveKeyword(keyword);
                                }}
                                className="flex h-4 w-4 items-center justify-center rounded-full text-primary/45 transition hover:bg-primary/10 hover:text-brick"
                                title={`Xóa từ khóa ${keyword}`}
                            >
                                <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                        </span>
                    ))}

                    <input
                        ref={inputRef}
                        type="text"
                        autoComplete="off"
                        value={draftValue}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyDown}
                        onPaste={handlePaste}
                        onFocus={onFocus}
                        onBlur={() => commitDraft()}
                        placeholder={normalizedKeywords.length > 0 ? 'Thêm từ khóa...' : placeholder}
                        className="min-w-[180px] flex-1 bg-transparent py-1.5 text-[14px] text-primary outline-none placeholder:text-primary/35"
                    />
                </div>

                {hasValue && (
                    <button
                        type="button"
                        onClick={handleClearAll}
                        className="my-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-primary/40 transition hover:bg-white hover:text-brick"
                        title="Xóa toàn bộ từ khóa"
                    >
                        <span className="material-symbols-outlined text-[16px]">cancel</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default MultiKeywordSearchInput;
