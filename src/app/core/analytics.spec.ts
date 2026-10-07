import { TestBed } from '@angular/core/testing';

import { ANALYTICS_TOKEN, BEACON_SRC, analyticsConfigured, loadAnalytics, trackingDeclined } from './analytics';

const TOKEN = '0123456789abcdef0123456789abcdef';
const allow = { doNotTrack: null };

describe('Cloudflare Web Analytics', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('test');
  });

  const beacons = () => doc.querySelectorAll(`script[src="${BEACON_SRC}"]`);

  it('the build default is no token, so ng test and the dev server load nothing', () => {
    expect(TestBed.inject(ANALYTICS_TOKEN)).toBe('');
    expect(loadAnalytics(doc, allow, TestBed.inject(ANALYTICS_TOKEN))).toBe(false);
    expect(beacons().length).toBe(0);
  });

  it('no script when the token is empty or malformed', () => {
    expect(loadAnalytics(doc, allow, '')).toBe(false);
    expect(loadAnalytics(doc, allow, `x"}' onload="alert(1)`)).toBe(false);
    expect(beacons().length).toBe(0);
    expect(doc.querySelectorAll('script').length).toBe(0);
  });

  it('with a token: one deferred beacon script with the token and spa: false', () => {
    expect(loadAnalytics(doc, allow, TOKEN)).toBe(true);
    const scripts = beacons();
    expect(scripts.length).toBe(1);
    const s = scripts[0] as HTMLScriptElement;
    expect(s.defer).toBe(true);
    expect(s.getAttribute('src')).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(JSON.parse(s.getAttribute('data-cf-beacon')!)).toEqual({ token: TOKEN, spa: false });
    expect(s.parentElement).toBe(doc.head);
  });

  it('injects exactly once', () => {
    expect(loadAnalytics(doc, allow, TOKEN)).toBe(true);
    expect(loadAnalytics(doc, allow, TOKEN)).toBe(false);
    expect(beacons().length).toBe(1);
  });

  it('no script under Do Not Track or Global Privacy Control', () => {
    expect(loadAnalytics(doc, { doNotTrack: '1' }, TOKEN)).toBe(false);
    expect(loadAnalytics(doc, { doNotTrack: null, globalPrivacyControl: true }, TOKEN)).toBe(false);
    expect(beacons().length).toBe(0);
  });

  it('DNT "0" or unset and GPC false still load', () => {
    expect(trackingDeclined({ doNotTrack: '0' })).toBe(false);
    expect(trackingDeclined({ doNotTrack: null, globalPrivacyControl: false })).toBe(false);
    expect(trackingDeclined({ doNotTrack: '1' })).toBe(true);
  });

  it('analyticsConfigured accepts Cloudflare-style tokens only', () => {
    expect(analyticsConfigured(TOKEN)).toBe(true);
    expect(analyticsConfigured('')).toBe(false);
    expect(analyticsConfigured('has space')).toBe(false);
  });
});
