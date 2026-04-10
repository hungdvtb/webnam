import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const META_MASK_NOISE_PATTERNS = [
  /Failed to connect to MetaMask/i,
  /MetaMask extension not found/i,
  /metamask/i,
];

function collectErrorText(value, depth = 0) {
  if (!value || depth > 2) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return [
      value.name,
      value.message,
      value.stack,
      collectErrorText(value.cause, depth + 1),
    ].filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    return [
      value.message,
      value.reason,
      value.stack,
      collectErrorText(value.cause, depth + 1),
    ].filter(Boolean).join(' ');
  }

  return String(value);
}

function isMetaMaskExtensionNoise(errorLike, filename = '') {
  const text = `${collectErrorText(errorLike)} ${filename}`.trim();

  return META_MASK_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (isMetaMaskExtensionNoise(event.reason)) {
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    if (isMetaMaskExtensionNoise(event.error || event.message, event.filename)) {
      event.preventDefault();
    }
  }, true);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
