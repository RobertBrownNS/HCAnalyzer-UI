// Cookieless Cloudflare Web Analytics (CLAUDE.md, Analytics). Off unless a site token is set at
// build time (docs/deploy.md); skipped when the browser sends Do Not Track or Global Privacy
// Control. The beacon counts page loads only (spa: false), not every settings change.
import { InjectionToken } from '@angular/core';

/** Set with `--define CF_ANALYTICS_TOKEN="'<token>'"`; angular.json defines it as '' by default. */
declare const CF_ANALYTICS_TOKEN: string | undefined;

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** The build's Cloudflare Web Analytics site token; empty = analytics off. */
export const ANALYTICS_TOKEN = new InjectionToken<string>('ANALYTICS_TOKEN', {
  providedIn: 'root',
  factory: () => (typeof CF_ANALYTICS_TOKEN === 'string' ? CF_ANALYTICS_TOKEN.trim() : ''),
});

/** A site token as Cloudflare issues them; anything else is ignored rather than written into the page. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function analyticsConfigured(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** The browser asks not to be tracked: Do Not Track or Global Privacy Control. */
export function trackingDeclined(nav: Pick<Navigator, 'doNotTrack'> & { globalPrivacyControl?: boolean }): boolean {
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/**
 * Adds the beacon script once, after the first render (called from main.ts). Does nothing without
 * a valid token, under DNT or GPC, or when the script is already present. The script is deferred
 * and has no visible output; nothing listens for its load or failure, so a blocked or failed beacon
 * never reaches the app's error handling.
 * Returns true when a script was added.
 */
export function loadAnalytics(
  doc: Document,
  nav: Pick<Navigator, 'doNotTrack'> & { globalPrivacyControl?: boolean },
  token: string,
): boolean {
  try {
    if (!analyticsConfigured(token) || trackingDeclined(nav)) return false;
    if (doc.querySelector(`script[src="${BEACON_SRC}"]`)) return false;
    const script = doc.createElement('script');
    script.defer = true;
    script.src = BEACON_SRC;
    script.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: false }));
    doc.head.appendChild(script);
    return true;
  } catch {
    return false;
  }
}
