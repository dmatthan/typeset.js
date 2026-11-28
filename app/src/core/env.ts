/** Where the app is running, as far as it needs to know. */
import { isTauri } from './shell';

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** Safari itself (not the desktop app's WebKit, nor Chrome or Firefox on iOS, which wrap
 *  WebKit with their own bars). */
export const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(ua) && !isTauri;
