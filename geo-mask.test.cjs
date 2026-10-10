const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GeoProfile = require('./geo-profile.js');

const source = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const location = (ip, country = 'ID', timezone = 'Asia/Jakarta', latitude = -6.2, longitude = 106.8) => ({
  success: true, ip, country_code: country, timezone: { id: timezone }, latitude, longitude
});

function event() {
  const listeners = [];
  return { addListener: (listener) => listeners.push(listener), emit: (...args) => listeners.forEach((listener) => listener(...args)) };
}

function harness(saved = {}) {
  const state = {
    ip: '203.0.113.1', data: {}, fetches: [], commands: [], rules: [], scripts: [], attaches: [],
    stored: { ...saved }, offline: false, failIp: false, failGeo: false, failCommand: null, failStorage: false
  };
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event() },
    alarms: {
      onAlarm: event(), get: async () => state.alarm,
      create: async (name, options) => { state.alarm = { name, ...options }; }
    },
    storage: { session: {
      get: async () => state.stored,
      set: async (value) => {
        if (state.failStorage) throw new Error('Storage unavailable');
        Object.assign(state.stored, plain(value));
      }
    } },
    declarativeNetRequest: { updateSessionRules: async (value) => { state.rules.push(plain(value)); } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.test/' }, { id: 2, url: 'https://other.test/' }, { id: 3, url: 'chrome://extensions/' }],
      onCreated: event(), onUpdated: event(), onRemoved: event()
    },
    debugger: {
      onDetach: event(), attach: async (target) => { state.attaches.push(target.tabId); },
      sendCommand: async (target, method, params) => {
        if (state.failCommand === method) {
          state.failCommand = null;
          throw new Error('Transient debugger error');
        }
        state.commands.push({ tabId: target.tabId, method, params: plain(params) });
        return { identifier: `script-${state.commands.length}` };
      }
    },
    scripting: { executeScript: async (options) => { state.scripts.push({ target: plain(options.target), world: options.world, args: plain(options.args) }); } }
  };
  const context = vm.createContext({
    chrome, Intl, URL, AbortController, setTimeout, clearTimeout,
    console: { warn() {}, info() {} },
    fetch: async (url, options) => {
      state.fetches.push({ url, options });
      if (state.offline || (state.failIp && url.includes('api.ipify.org')) || (state.failGeo && url.includes('ipwho.is'))) {
        throw new Error('Provider unavailable');
      }
      let data;
      if (url.includes('ipify.org')) data = { ip: state.ip };
      else {
        const ip = url.includes('ipwho.is') ? new URL(url).pathname.slice(1) : new URL(url).pathname.split('/')[1];
        data = state.data[ip] || location(ip);
        if (url.includes('ipapi.co') && typeof data.timezone !== 'string') data = { ...data, timezone: data.timezone.id };
      }
      return { ok: true, json: async () => data };
    }
  });
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(source(file), context));
  vm.runInContext(source('background.js'), context);
  return {
    state, chrome, run: (script) => vm.runInContext(script, context),
    start: () => vm.runInContext('initialize()', context),
    refresh: () => vm.runInContext('refreshProfile(true)', context),
    profile: () => plain(vm.runInContext('profile', context))
  };
}

test('derive locale and use provider timezone/coordinates for different countries', () => {
  for (const [country, timezone, locale] of [
    ['ID', 'Asia/Jakarta', 'id-ID'], ['JP', 'Asia/Tokyo', 'ja-JP'],
    ['GB', 'Europe/London', 'en-GB'], ['US', 'America/New_York', 'en-US'],
    ['US', 'America/Los_Angeles', 'en-US'], ['SG', 'Asia/Singapore', 'en-SG']
  ]) {
    const profile = GeoProfile.fromLookup(location('203.0.113.1', country, timezone, 0, 0), '203.0.113.1');
    assert.equal(profile.locale, locale);
    assert.equal(profile.timezone, timezone);
    assert.equal(profile.latitude, 0);
  }
});

test('accept ipapi timezone and normalized IPv6', () => {
  const ip = '2001:db8::1';
  const profile = GeoProfile.fromLookup({ ...location('2001:0db8:0:0:0:0:0:1'), timezone: 'Asia/Jakarta' }, ip);
  assert.equal(profile.ip, ip);
  assert.equal(GeoProfile.normalizeIp(' 203.0.113.1 '), '203.0.113.1');
});

test('reject mismatched IPs, malformed IPs and incomplete/invalid locations', () => {
  for (const ip of [null, '', '999.1.2.3', '127.1', 'example.com', 'abcd:::1', '1.2.3.4/path']) {
    assert.throws(() => GeoProfile.normalizeIp(ip));
  }
  const good = location('203.0.113.1');
  for (const bad of [
    { ...good, ip: '203.0.113.2' }, { ...good, success: false }, { ...good, error: true },
    { ...good, timezone: 'Invalid/Zone' }, { ...good, timezone: null },
    { ...good, latitude: null }, { ...good, longitude: '106.8' },
    { ...good, latitude: 91 }, { ...good, longitude: 181 }, { ...good, country_code: '' }
  ]) assert.throws(() => GeoProfile.fromLookup(bad, good.ip));
});

test('language injection follows successive profiles and freezes language lists', () => {
  const context = vm.createContext({ Navigator: class Navigator {} });
  vm.runInContext(source('lang-override.js'), context);
  vm.runInContext("overrideLanguages('ja-JP')", context);
  assert.equal(vm.runInContext('new Navigator().language', context), 'ja-JP');
  vm.runInContext("overrideLanguages('en-US')", context);
  assert.deepEqual(plain(vm.runInContext('new Navigator().languages', context)), ['en-US', 'en']);
  assert.equal(vm.runInContext('Object.isFrozen(new Navigator().languages)', context), true);
});

test('manifest removes static Indonesia rules and declares required MV3 permissions', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.equal(manifest.declarative_net_request, undefined);
  assert.equal(manifest.content_scripts, undefined);
  for (const permission of ['debugger', 'declarativeNetRequest', 'tabs', 'alarms', 'storage', 'scripting']) {
    assert.ok(manifest.permissions.includes(permission));
  }
});

test('initial lookup updates time, locale, coordinates, headers and all web tabs', async () => {
  const h = harness();
  await h.start();
  assert.equal(h.profile().timezone, 'Asia/Jakarta');
  assert.deepEqual(h.state.attaches.sort(), [1, 2]);
  assert.equal(h.state.alarm.periodInMinutes, 0.5);
  for (const tabId of [1, 2]) {
    const commands = h.state.commands.filter((command) => command.tabId === tabId);
    assert.ok(commands.some((command) => command.method === 'Emulation.setGeolocationOverride' && command.params.latitude === -6.2));
    assert.ok(commands.some((command) => command.method === 'Page.addScriptToEvaluateOnNewDocument' && command.params.source.includes('id-ID')));
  }
  assert.equal(h.state.rules.at(-1).addRules[0].action.requestHeaders[0].value, 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.ok(h.state.scripts.every((script) => script.target.allFrames && script.world === 'MAIN'));
  assert.ok(h.state.fetches.every(({ options }) => options.cache === 'no-store' && options.credentials === 'omit' && options.signal));
});

test('node IP changes update already attached tabs without repeated attachment', async () => {
  const h = harness();
  await h.start();
  h.state.ip = '203.0.113.2';
  h.state.data[h.state.ip] = location(h.state.ip, 'JP', 'Asia/Tokyo', 35.68, 139.69);
  await h.refresh();
  assert.equal(h.profile().locale, 'ja-JP');
  assert.deepEqual(h.state.attaches.sort(), [1, 2]);
  assert.equal(h.state.rules.at(-1).addRules[0].action.requestHeaders[0].value, 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
  for (const tabId of [1, 2]) {
    assert.equal(h.state.commands.filter((command) => command.tabId === tabId && command.method === 'Emulation.setTimezoneOverride').at(-1).params.timezoneId, 'Asia/Tokyo');
    assert.ok(h.state.commands.some((command) => command.tabId === tabId && command.method === 'Page.removeScriptToEvaluateOnNewDocument'));
  }
});

test('unchanged IP avoids repeated geolocation; expired location is refreshed', async () => {
  const h = harness();
  await h.start();
  const count = () => h.state.fetches.filter(({ url }) => url.includes('ipwho.is')).length;
  const before = count();
  await h.refresh();
  assert.equal(count(), before);
  h.run('profileCheckedAt -= GEO_MAX_AGE_MS');
  await h.refresh();
  assert.equal(count(), before + 1);
});

test('network failure preserves last successful profile and headers', async () => {
  const h = harness();
  await h.start();
  const before = h.profile();
  const ruleCount = h.state.rules.length;
  h.state.offline = true;
  await h.refresh();
  assert.deepEqual(h.profile(), before);
  assert.equal(h.state.rules.length, ruleCount);
});

test('failed first lookup does not attach or install a fixed fallback profile', async () => {
  const h = harness();
  h.state.offline = true;
  await h.start();
  assert.equal(h.profile(), null);
  assert.equal(h.state.attaches.length, 0);
  assert.equal(h.state.rules.length, 0);
});

test('both IP and geolocation providers have validated fallbacks', async () => {
  const h = harness();
  h.state.failIp = true;
  h.state.failGeo = true;
  await h.start();
  assert.equal(h.profile().ip, h.state.ip);
  assert.ok(h.state.fetches.some(({ url }) => url.includes('api64.ipify.org')));
  assert.ok(h.state.fetches.some(({ url }) => url.includes('ipapi.co')));
});

test('invalid changed-IP geolocation never replaces the last valid profile', async () => {
  const h = harness();
  await h.start();
  const before = h.profile();
  h.state.ip = '203.0.113.2';
  h.state.data[h.state.ip] = location('203.0.113.99', 'JP', 'Asia/Tokyo');
  await h.refresh();
  assert.deepEqual(h.profile(), before);
});

test('concurrent refreshes share a single IP/location lookup', async () => {
  const h = harness();
  await h.start();
  h.state.ip = '203.0.113.2';
  const before = h.state.fetches.length;
  await Promise.all(Array.from({ length: 8 }, () => h.refresh()));
  assert.equal(h.state.fetches.length - before, 2);
});

test('navigation is serialized; debugger detach allows reattachment', async () => {
  const h = harness();
  await h.start();
  await Promise.all([h.run('queueTab(1)'), h.run('queueTab(1)'), h.run('queueTab(1)')]);
  assert.equal(h.state.attaches.filter((id) => id === 1).length, 1);
  h.chrome.debugger.onDetach.emit({ tabId: 1 });
  await h.run('queueTab(1)');
  assert.equal(h.state.attaches.filter((id) => id === 1).length, 2);
});

test('worker restoration can use the session cache during a provider outage', async () => {
  const cached = GeoProfile.fromLookup(location('203.0.113.2', 'JP', 'Asia/Tokyo'), '203.0.113.2');
  const h = harness({ geoProfile: cached, geoProfileCheckedAt: Date.now() });
  h.state.offline = true;
  await h.start();
  assert.deepEqual(h.profile(), cached);
  assert.equal(h.state.attaches.length, 2);
});

test('transient CDP failure can be retried without attaching a tab twice', async () => {
  const h = harness();
  h.state.failCommand = 'Emulation.setTimezoneOverride';
  await h.start();
  await h.run('queueTab(1)');
  assert.equal(h.state.attaches.filter((id) => id === 1).length, 1);
  assert.ok(h.state.commands.some((command) => command.tabId === 1 && command.method === 'Emulation.setGeolocationOverride'));
});

test('storage failure does not prevent applying a freshly validated profile', async () => {
  const h = harness();
  await h.start();
  h.state.failStorage = true;
  h.state.ip = '203.0.113.2';
  h.state.data[h.state.ip] = location(h.state.ip, 'JP', 'Asia/Tokyo');
  await h.refresh();
  assert.equal(h.state.commands.filter((command) => command.method === 'Emulation.setTimezoneOverride').at(-1).params.timezoneId, 'Asia/Tokyo');
});

test('same-IP polling retries tabs after a transient debugger failure', async () => {
  const h = harness();
  await h.start();
  h.state.ip = '203.0.113.2';
  h.state.data[h.state.ip] = location(h.state.ip, 'JP', 'Asia/Tokyo');
  h.state.failCommand = 'Emulation.setTimezoneOverride';
  await h.refresh();
  await h.refresh();
  for (const tabId of [1, 2]) {
    assert.equal(h.state.commands.filter((command) => command.tabId === tabId && command.method === 'Emulation.setTimezoneOverride').at(-1).params.timezoneId, 'Asia/Tokyo');
  }
});

test('invalid IP-provider responses do not install a forced country', async () => {
  const h = harness();
  h.state.ip = 'not-an-IP';
  await h.start();
  assert.equal(h.profile(), null);
  assert.equal(h.state.commands.length, 0);
});
