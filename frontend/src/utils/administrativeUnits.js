const removeAccents = (str = '') =>
    String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, (char) => (char === 'đ' ? 'd' : 'D'))
        .replace(/Ä‘/g, 'd')
        .replace(/Ä/g, 'D');

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanText = (value = '') => value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

const cleanLine = (value = '') => value.replace(/\s+/g, ' ').replace(/^[,;:|/-]+|[,;:|/-]+$/g, '').trim();

const splitSegments = (value = '') =>
    value
        .split(/[\n,]+/)
        .map((segment) => cleanLine(segment))
        .filter(Boolean);

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const SPECIAL_PROVINCE_ALIASES = {
    'ho chi minh': ['tphcm', 'tp hcm', 'hcm', 'sai gon', 'saigon', 'tp ho chi minh', 'thanh pho ho chi minh'],
    'ha noi': ['hn', 'tp ha noi', 'thanh pho ha noi'],
    'da nang': ['dn', 'tp da nang', 'thanh pho da nang'],
    'hai phong': ['hp', 'tp hai phong', 'thanh pho hai phong'],
    'can tho': ['ct', 'tp can tho', 'thanh pho can tho'],
    'ba ria vung tau': ['brvt']
};

const MAJOR_PROVINCES = new Set(['ho chi minh', 'ha noi', 'da nang', 'hai phong', 'can tho']);

export const sortRegionObjects = (items = []) =>
    [...items].sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'vi'));

export const sortRegionStrings = (items = []) =>
    [...items].sort((a, b) => (a || '').localeCompare(b || '', 'vi'));

export const buildShippingAddress = ({
    addressDetail = '',
    ward = '',
    district = '',
    province = '',
    regionType = 'new'
}) => {
    const parts = [
        addressDetail.trim(),
        ward,
        regionType === 'old' ? district : null,
        province
    ].filter(Boolean);

    return parts.join(', ');
};

export const buildRegionPath = ({
    ward = '',
    district = '',
    province = '',
    regionType = 'new'
}) => {
    return [
        ward,
        regionType === 'old' ? district : null,
        province
    ].filter(Boolean).join(' > ');
};

const normalizeAdministrativeSegment = (value = '') =>
    removeAccents(value)
        .toLowerCase()
        .replace(/[.;/\\\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:(thanh pho|tp|tinh|quan|q|huyen|h|phuong|p|xa|x|thi tran|tt|thi xa|tx)\s+)+/g, '')
        .trim();

export const normalizeAdministrativeText = (value = '') =>
    String(value)
        .replace(/\r\n/g, '\n')
        .split(/[\n,]+/)
        .map((segment) => normalizeAdministrativeSegment(segment))
        .filter(Boolean)
        .join(' ')
        .trim();

const tokenize = (value = '') => normalizeAdministrativeText(value).split(' ').filter(Boolean);

const includesPhrase = (haystack = '', needle = '') => {
    if (!needle) return false;
    return new RegExp(`(^|\\s)${escapeRegExp(needle)}(?=\\s|$)`, 'i').test(haystack);
};

const getOrderedTokenCoverage = (segment = '', phrase = '') => {
    const phraseTokens = tokenize(phrase);
    if (phraseTokens.length < 3) return 0;

    let cursor = 0;
    let matched = 0;

    for (const token of phraseTokens) {
        const tokenIndex = segment.indexOf(token, cursor);
        if (tokenIndex === -1) break;
        matched += 1;
        cursor = tokenIndex + token.length;
    }

    return matched / phraseTokens.length;
};

const getApproximateSegmentMatch = (segments = [], phrase = '') => {
    if (!phrase) return null;

    let bestMatch = null;

    segments.forEach((segment) => {
        const coverage = getOrderedTokenCoverage(segment, phrase);
        if (coverage < 0.8) return;

        const score = 70 + Math.round(coverage * 40) + phrase.length;
        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { score, scope: 'approximate', segment };
        }
    });

    return bestMatch;
};

const getPhraseMatch = (scopes, phrase, { allowFullTextFallback = true, requireWholeSegment = false } = {}) => {
    if (!phrase) return null;

    if (scopes.tailSegments.some((segment) => segment === phrase)) {
        return { score: 220 + phrase.length, scope: 'tail-exact' };
    }

    if (!requireWholeSegment && includesPhrase(scopes.tailText, phrase)) {
        return { score: 205 + phrase.length, scope: 'tail-exact' };
    }

    if (!allowFullTextFallback) {
        const approximateMatch = getApproximateSegmentMatch(scopes.tailSegments, phrase);
        return approximateMatch || null;
    }

    if (scopes.fullSegments.some((segment) => includesPhrase(segment, phrase))) {
        return { score: 175 + phrase.length, scope: 'full-exact' };
    }

    if (includesPhrase(scopes.fullText, phrase)) {
        return { score: 160 + phrase.length, scope: 'full-exact' };
    }

    const approximateMatch = getApproximateSegmentMatch(scopes.tailSegments, phrase);
    if (approximateMatch) return approximateMatch;

    return null;
};

const buildSearchScopes = (addressText = '') => {
    const fullSegments = splitSegments(addressText).map((segment) => normalizeAdministrativeText(segment)).filter(Boolean);
    const tailSegmentCount = fullSegments.length >= 3
        ? Math.min(3, fullSegments.length - 1)
        : fullSegments.length;
    const tailSegments = fullSegments.slice(-tailSegmentCount);

    return {
        fullSegments,
        tailSegments,
        fullText: normalizeAdministrativeText(addressText),
        tailText: tailSegments.join(' ').trim()
    };
};

const getProvinceAliases = (provinceName = '') => {
    const normalizedProvince = normalizeAdministrativeText(provinceName);
    return unique([normalizedProvince, ...(SPECIAL_PROVINCE_ALIASES[normalizedProvince] || [])]);
};

const getProvincePriority = (provinceName = '') => {
    const normalizedProvince = normalizeAdministrativeText(provinceName);
    return MAJOR_PROVINCES.has(normalizedProvince) ? 25 : 0;
};

const getProvinceMatches = (scopes, regions = {}) => {
    const provinceNames = unique([
        ...(regions.new || []).map((province) => province?.name),
        ...(regions.old || []).map((province) => province?.name)
    ]);

    const matches = provinceNames
        .map((provinceName) => {
            const aliasMatches = getProvinceAliases(provinceName)
                .map((alias) => getPhraseMatch(scopes, alias))
                .filter(Boolean);

            if (!aliasMatches.length) return null;

            const bestAliasMatch = aliasMatches.sort((a, b) => b.score - a.score)[0];
            return {
                province: provinceName,
                score: bestAliasMatch.score + getProvincePriority(provinceName),
                exact: bestAliasMatch.scope !== 'approximate'
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    if (!matches.length) return [];

    const bestScore = matches[0].score;
    return matches.filter((match) => match.score >= bestScore - 35);
};

const inferProvinceFromLocalities = (scopes, regions = {}) => {
    const provinceScores = new Map();

    (regions.new || []).forEach((province) => {
        const wardMatches = (province.wards || [])
            .map((ward) => getPhraseMatch(scopes, normalizeAdministrativeText(ward), { allowFullTextFallback: false, requireWholeSegment: true }))
            .filter(Boolean);

        if (!wardMatches.length) return;
        const bestWard = wardMatches.sort((a, b) => b.score - a.score)[0];
        provinceScores.set(
            province.name,
            (provinceScores.get(province.name) || 0) + bestWard.score + getProvincePriority(province.name)
        );
    });

    (regions.old || []).forEach((province) => {
        (province.districts || []).forEach((district) => {
            const districtMatch = getPhraseMatch(scopes, normalizeAdministrativeText(district.name), { allowFullTextFallback: false, requireWholeSegment: true });
            if (districtMatch) {
                provinceScores.set(
                    province.name,
                    (provinceScores.get(province.name) || 0) + districtMatch.score + getProvincePriority(province.name)
                );
            }

            const wardMatches = (district.wards || [])
                .map((ward) => getPhraseMatch(scopes, normalizeAdministrativeText(ward), { allowFullTextFallback: false, requireWholeSegment: true }))
                .filter(Boolean);

            if (!wardMatches.length) return;
            const bestWard = wardMatches.sort((a, b) => b.score - a.score)[0];
            provinceScores.set(
                province.name,
                (provinceScores.get(province.name) || 0) + bestWard.score + getProvincePriority(province.name)
            );
        });
    });

    const rankedProvinces = [...provinceScores.entries()]
        .map(([province, score]) => ({ province, score }))
        .sort((a, b) => b.score - a.score);

    if (!rankedProvinces.length) return [];
    if (rankedProvinces.length === 1) return rankedProvinces;

    if (rankedProvinces[0].score - rankedProvinces[1].score >= 90) {
        return [rankedProvinces[0]];
    }

    return [];
};

const findNewCandidate = (provinceName, scopes, regions = {}) => {
    const provinceData = (regions.new || []).find((province) => province.name === provinceName);
    if (!provinceData) return null;

    const wardMatches = (provinceData.wards || [])
        .map((ward) => {
            const wardMatch = getPhraseMatch(scopes, normalizeAdministrativeText(ward), { allowFullTextFallback: false, requireWholeSegment: true });
            if (!wardMatch) return null;

            return {
                regionType: 'new',
                province: provinceName,
                district: '',
                ward,
                score: wardMatch.score + 260,
                confidence: wardMatch.scope === 'approximate' ? 'approximate' : 'exact'
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    if (wardMatches.length) {
        return wardMatches[0];
    }

    return {
        regionType: 'new',
        province: provinceName,
        district: '',
        ward: '',
        score: 80,
        confidence: 'partial'
    };
};

const findOldCandidate = (provinceName, scopes, regions = {}) => {
    const provinceData = (regions.old || []).find((province) => province.name === provinceName);
    if (!provinceData) return null;

    const candidates = [];

    (provinceData.districts || []).forEach((district) => {
            const districtMatch = getPhraseMatch(scopes, normalizeAdministrativeText(district.name), { allowFullTextFallback: false, requireWholeSegment: true });
            const wardMatches = (district.wards || [])
                .map((ward) => {
                    const wardMatch = getPhraseMatch(scopes, normalizeAdministrativeText(ward), { allowFullTextFallback: false, requireWholeSegment: true });
                if (!wardMatch) return null;

                return { ward, wardMatch };
            })
            .filter(Boolean);

        if (districtMatch && !wardMatches.length) {
            candidates.push({
                regionType: 'old',
                province: provinceName,
                district: district.name,
                ward: '',
                score: districtMatch.score + 150,
                confidence: districtMatch.scope === 'approximate' ? 'approximate' : 'partial'
            });
        }

        wardMatches.forEach(({ ward, wardMatch }) => {
            const districtBoost = districtMatch ? districtMatch.score + 170 : -80;
            const score = wardMatch.score + 210 + districtBoost;
            const confidence = districtMatch
                ? (districtMatch.scope === 'approximate' || wardMatch.scope === 'approximate' ? 'approximate' : 'exact')
                : 'approximate';

            candidates.push({
                regionType: 'old',
                province: provinceName,
                district: district.name,
                ward,
                score,
                confidence
            });
        });
    });

    if (!candidates.length) {
        return {
            regionType: 'old',
            province: provinceName,
            district: '',
            ward: '',
            score: 65,
            confidence: 'partial'
        };
    }

    return candidates.sort((a, b) => b.score - a.score)[0];
};

const chooseBestAdministrativeCandidate = (scopes, regions = {}) => {
    const explicitProvinceMatches = getProvinceMatches(scopes, regions);
    const inferredProvinceMatches = explicitProvinceMatches.length ? explicitProvinceMatches : inferProvinceFromLocalities(scopes, regions);
    const provinceMatches = inferredProvinceMatches.length ? inferredProvinceMatches : [];

    if (!provinceMatches.length) return null;

    const candidates = provinceMatches.flatMap((provinceMatch) => {
        const provinceBoost = provinceMatch.score;
        const newCandidate = findNewCandidate(provinceMatch.province, scopes, regions);
        const oldCandidate = findOldCandidate(provinceMatch.province, scopes, regions);

        return [newCandidate, oldCandidate]
            .filter(Boolean)
            .map((candidate) => ({
                ...candidate,
                score: candidate.score + provinceBoost,
                provinceConfidence: provinceMatch.exact ? 'exact' : 'approximate'
            }));
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);

    const bestCandidate = candidates[0];
    if (bestCandidate.score < 260) return null;

    return bestCandidate;
};

export const extractAddressDetail = ({
    shippingAddress = '',
    ward = '',
    district = '',
    province = '',
    regionType = 'new'
}) => {
    const segments = splitSegments(shippingAddress);
    const suffixes = [
        { value: province, aliases: getProvinceAliases(province) },
        { value: regionType === 'old' ? district : '', aliases: [normalizeAdministrativeText(district)] },
        { value: ward, aliases: [normalizeAdministrativeText(ward)] }
    ].filter((segment) => segment.value);

    let lastIndex = segments.length - 1;

    suffixes.forEach((suffix) => {
        const segmentNorm = normalizeAdministrativeText(segments[lastIndex] || '');
        if (lastIndex >= 0 && suffix.aliases.includes(segmentNorm)) {
            lastIndex -= 1;
        }
    });

    return segments.slice(0, lastIndex + 1).join(', ').trim();
};

const phonePattern = /(?:^|[^\d])(0(?:3|5|7|8|9)(?:[\s.-]?\d){8})(?!\d)/u;

const extractPhone = (value = '') => {
    const match = value.match(phonePattern);
    if (!match) return null;

    const raw = match[1];
    const normalizedPhone = raw.replace(/\D/g, '');
    return validateVietnamesePhone(normalizedPhone)
        ? { raw, normalized: normalizedPhone }
        : null;
};

const looksLikeCustomerName = (value = '') => {
    const candidate = cleanLine(value);
    if (!candidate) return false;
    if (candidate.length > 50) return false;
    if (!/[\p{L}]/u.test(candidate)) return false;
    if (/[\d/]/.test(candidate)) return false;
    if ((candidate.match(/,/g) || []).length > 1) return false;
    if (tokenize(candidate).length > 6) return false;
    return true;
};

const extractNameNearPhone = (line = '', phoneRaw = '') => {
    if (!line || !phoneRaw) return '';

    const [beforePhone = '', afterPhone = ''] = line.split(phoneRaw);
    const normalizedBefore = cleanLine(beforePhone);
    const normalizedAfter = cleanLine(afterPhone);
    const beforeSegments = normalizedBefore.split(/[,|;-]+/).map((segment) => cleanLine(segment)).filter(Boolean);
    const tailSegment = beforeSegments[beforeSegments.length - 1] || '';
    const tailWords = tailSegment.split(/\s+/).filter(Boolean);
    const trailingWordCandidates = [3, 2, 1]
        .map((length) => tailWords.slice(-length).join(' '))
        .filter(Boolean);

    const candidates = [
        normalizedAfter,
        normalizedBefore,
        tailSegment,
        ...trailingWordCandidates
    ];

    return candidates.find((candidate) => looksLikeCustomerName(candidate)) || '';
};

export const extractCustomerInfoFromText = (rawInput = '') => {
    const normalizedInput = String(rawInput || '').replace(/\r\n/g, '\n').trim();
    const lines = normalizedInput.split('\n').map((line) => cleanLine(line)).filter(Boolean);
    const phoneInfo = extractPhone(normalizedInput);
    const consumedIndexes = new Set();
    let customerName = '';

    if (phoneInfo) {
        const phoneLineIndex = lines.findIndex((line) => line.includes(phoneInfo.raw));
        if (phoneLineIndex !== -1) {
            const candidateName = extractNameNearPhone(lines[phoneLineIndex], phoneInfo.raw);
            if (looksLikeCustomerName(candidateName)) {
                customerName = candidateName;
                if (lines.length > 1) {
                    consumedIndexes.add(phoneLineIndex);
                }
            }
        }
    }

    if (!customerName && lines.length > 1) {
        const lastLine = lines[lines.length - 1];
        if (!extractPhone(lastLine) && looksLikeCustomerName(lastLine)) {
            customerName = lastLine;
            consumedIndexes.add(lines.length - 1);
        }
    }

    const addressLines = lines.filter((_, index) => !consumedIndexes.has(index));
    let addressText = addressLines.join(', ').trim();

    if (!addressText && lines.length === 1) {
        let singleLineAddress = lines[0];

        if (phoneInfo) {
            singleLineAddress = cleanLine(singleLineAddress.replace(phoneInfo.raw, ' '));
        }

        if (customerName) {
            const trailingNameRegex = new RegExp(`${escapeRegExp(customerName)}$`, 'i');
            singleLineAddress = cleanLine(singleLineAddress.replace(trailingNameRegex, ' '));

            if (singleLineAddress.includes(customerName)) {
                singleLineAddress = cleanLine(singleLineAddress.replace(customerName, ' '));
            }
        }

        addressText = singleLineAddress || normalizedInput;
    }

    return {
        customerName,
        customerPhone: phoneInfo?.normalized || '',
        addressText: addressText || normalizedInput
    };
};

export const parseAdministrativeAddress = (rawInput = '', regions) => {
    const extracted = extractCustomerInfoFromText(rawInput);
    const addressText = extracted.addressText.trim();
    const scopes = buildSearchScopes(addressText);

    if (!scopes.fullText) {
        return extracted.customerName || extracted.customerPhone
            ? {
                regionType: 'new',
                province: '',
                district: '',
                ward: '',
                addressDetail: '',
                addressText: '',
                customerName: extracted.customerName,
                customerPhone: extracted.customerPhone,
                confidence: 'none'
            }
            : null;
    }

    const matchedCandidate = chooseBestAdministrativeCandidate(scopes, regions);
    if (!matchedCandidate) {
        return {
            regionType: 'new',
            province: '',
            district: '',
            ward: '',
            addressDetail: addressText,
            addressText,
            customerName: extracted.customerName,
            customerPhone: extracted.customerPhone,
            confidence: 'none'
        };
    }

    const confidence = matchedCandidate.confidence === 'exact' && matchedCandidate.provinceConfidence === 'exact'
        ? 'exact'
        : matchedCandidate.confidence === 'partial'
            ? 'partial'
            : 'approximate';

    const addressDetail = extractAddressDetail({
        shippingAddress: addressText,
        province: matchedCandidate.province,
        district: matchedCandidate.district,
        ward: matchedCandidate.ward,
        regionType: matchedCandidate.regionType
    });

    return {
        regionType: matchedCandidate.regionType,
        province: matchedCandidate.province,
        district: matchedCandidate.district || '',
        ward: matchedCandidate.ward || '',
        addressDetail: addressDetail || addressText,
        addressText,
        customerName: extracted.customerName,
        customerPhone: extracted.customerPhone,
        confidence
    };
};

export const validateVietnamesePhone = (phone = '') => /^(0[3|5|7|8|9])([0-9]{8})$/.test(phone);
