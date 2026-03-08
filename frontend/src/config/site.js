/**
 * Site Configuration
 * 
 * SITE_CODE is the unique code assigned to an Account in the admin panel.
 * The frontend uses this code to determine which account/store data to load.
 *
 * To change the store, update SITE_CODE below or set VITE_SITE_CODE env var.
 */

const siteConfig = {
    // The site_code from the Accounts management panel
    SITE_CODE: import.meta.env.VITE_SITE_CODE || 'GOMDAITHANH_DEMO',

    // Will be populated at runtime after resolving the site_code
    accountId: null,
    accountName: null,
};

export default siteConfig;
