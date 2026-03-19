"use client";

const STORAGE_KEY = 'lead_attribution_snapshot';

const getQueryData = () => {
  const params = new URLSearchParams(window.location.search || '');
  return {
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
    raw_query: params.toString(),
  };
};

export function readLeadAttribution() {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Unable to read lead attribution snapshot', error);
    return {};
  }
}

export function rememberLeadAttribution(extra = {}) {
  if (typeof window === 'undefined') return {};

  const previous = readLeadAttribution();
  const next = {
    first_url: previous.first_url || window.location.href,
    landing_url: previous.landing_url || window.location.href,
    current_url: window.location.href,
    referrer: previous.referrer || document.referrer || '',
    ...previous,
    ...getQueryData(),
    ...extra,
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error('Unable to persist lead attribution snapshot', error);
  }

  return next;
}

export function clearLeadAttribution() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
