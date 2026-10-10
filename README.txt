Chrome Geo Mask 1.1.0 - follow the browser's proxy exit IP

Full documentation, permissions and privacy details: README.md

Installation / update (Chrome 120+):
1. Open chrome://extensions and enable Developer mode.
2. Load unpacked -> select this folder, or click Reload on the existing extension.
3. Accept the added alarms/storage/scripting permissions if Chrome prompts.
4. Keep Clash running with Chrome traffic actually routed through the selected node.
5. Wait for the first successful lookup, then refresh existing test pages.

Automatic updates:
- Check Chrome's actual public exit IP every 30 seconds, and on navigation (throttled).
- On an IP change, query that IP's timezone and approximate coordinates, then update
  all attached web tabs, navigator.language/languages, and Accept-Language together.
- The same IP's location is cached for six hours to limit geolocation API requests.
- No Indonesia default is used. Before the first successful lookup, native browser
  values remain in effect. If a later lookup fails, keep the last valid profile and retry.
- Polling is best-effort: sleeping Chrome, slow APIs, or reused proxy connections can
  delay detection. A page that cached old values may need a refresh after a node switch.

Verification:
- In a web page's console: Intl.DateTimeFormat().resolvedOptions().timeZone
- navigator.language; navigator.languages; new Date().toString()
- navigator.geolocation.getCurrentPosition(console.log, console.error)
  (HTTPS and location permission are still required; this is IP location, not GPS.)
- In the extension service worker console:
  chrome.storage.session.get(['geoProfile', 'geoProfileCheckedAt']).then(console.log)
- Run regression tests: node --test geo-mask.test.cjs

Notes:
- Chrome's "started debugging this browser" banner is expected. Opening DevTools can
  detach the extension; close DevTools and navigate again to let it reattach.
- Only Chrome tabs are changed; system timezone/language and Clash settings are untouched.
- This follows real browser egress, not a node name. In Clash rule mode, DIRECT rules
  for api.ipify.org/api64.ipify.org can report a direct exit rather than the selected node.
  Route those domains through the intended proxy if they currently bypass it.
- Providers: ipify for exit IP; ipwho.is for location, with ipapi.co as fallback.
  Location providers receive the detected public IP. No cookies or browsing URLs are sent.
- Changing timezone changes local time presentation, not the UTC clock (Date.now()).
