/**
 * Site Configuration
 *
 * Leave VITE_SITE_CODE empty for single-tenant/local mode where the database
 * does not use Account scoping yet. Set it only when a matching Account exists.
 */

const siteConfig = {
    // The site_code from the Accounts management panel, if account scoping is configured.
    SITE_CODE: String(import.meta.env.VITE_SITE_CODE || '').trim(),

    // Will be populated at runtime after resolving the site_code
    accountId: null,
    accountName: null,
};

export default siteConfig;
