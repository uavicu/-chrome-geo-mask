importScripts('geo-profile.js', 'lang-override.js');

const ALARM_NAME = 'geo-mask-refresh';
const MIN_REFRESH_MS = 15000;
const GEO_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const IP_ENDPOINTS = ['https://api.ipify.org', 'https://api64.ipify.org'];
const GEO_ENDPOINTS = [
  (ip) => `https://ipwho.is/${ip}`,
  (ip) => `https://ipapi.co/${ip}/json/`
];
const tabStates = new Map();
const tabJobs = new Map();
let profile = null;
let profileCheckedAt = 0;
let lastAttempt = 0;
let refreshing = null;

async function updateLanguageRule(next) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Accept-Language', operation: 'set', value: GeoProfile.languageHeader(next) }]
      },
      condition: {
        urlFilter: '|http',
        excludedRequestDomains: ['ipify.org', 'ipwho.is', 'ipapi.co'],
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'websocket', 'other']
      }
    }]
  });
}

const ready = (async () => {
  try {
    const saved = await chrome.storage.session.get(['geoProfile', 'geoProfileCheckedAt']);
    if (saved.geoProfile) {
      const cached = GeoProfile.fromLookup(saved.geoProfile, saved.geoProfile.ip);
      await updateLanguageRule(cached);
      profile = cached;
      profileCheckedAt = Number(saved.geoProfileCheckedAt) || 0;
    }
  } catch (error) {
    console.warn('geo-mask: cache unavailable:', error.message);
  }
})();

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function detectExitIp() {
  for (const endpoint of IP_ENDPOINTS) {
    try {
      const data = await fetchJson(`${endpoint}/?format=json&t=${Date.now()}`);
      return GeoProfile.normalizeIp(data.ip);
    } catch (error) {
      console.warn('geo-mask: IP provider unavailable:', error.message);
    }
  }
  throw new Error('No exit IP available');
}

async function lookupProfile(ip) {
  for (const endpoint of GEO_ENDPOINTS) {
    try {
      return GeoProfile.fromLookup(await fetchJson(endpoint(ip)), ip);
    } catch (error) {
      console.warn('geo-mask: location provider unavailable:', error.message);
    }
  }
  throw new Error('No valid location available for the detected exit IP');
}

function refreshProfile(force = false) {
  if (refreshing) return refreshing;
  if (!force && Date.now() - lastAttempt < MIN_REFRESH_MS) return ready.then(() => profile);
  lastAttempt = Date.now();
  refreshing = (async () => {
    await ready;
    try {
      const ip = await detectExitIp();
      if (profile && profile.ip === ip && Date.now() - profileCheckedAt < GEO_MAX_AGE_MS) {
        await applyAllTabs();
        return profile;
      }
      const next = await lookupProfile(ip);
      await updateLanguageRule(next);
      profile = next;
      profileCheckedAt = Date.now();
      await chrome.storage.session.set({ geoProfile: next, geoProfileCheckedAt: profileCheckedAt }).catch((error) => {
        console.warn('geo-mask: could not cache profile:', error.message);
      });
      await applyAllTabs();
      console.info('geo-mask: profile updated:', next.countryCode, next.timezone, next.locale);
    } catch (error) {
      console.warn('geo-mask: keeping the last valid profile:', error.message);
    }
    return profile;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function applyTab(tabId) {
  if (!profile) return;
  const next = profile;
  let state = tabStates.get(tabId);
  if (!state) {
    await chrome.debugger.attach({ tabId }, '1.3');
    state = {};
    tabStates.set(tabId, state);
  }
  const target = { tabId };
  const key = JSON.stringify(next);
  if (state.key !== key) {
    await chrome.debugger.sendCommand(target, 'Emulation.setTimezoneOverride', { timezoneId: next.timezone });
    await chrome.debugger.sendCommand(target, 'Emulation.setLocaleOverride', { locale: next.locale });
    await chrome.debugger.sendCommand(target, 'Emulation.setGeolocationOverride', {
      latitude: next.latitude, longitude: next.longitude, accuracy: 10000
    });
    if (state.locale !== next.locale) {
      if (state.scriptId) {
        await chrome.debugger.sendCommand(target, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId });
      }
      const script = await chrome.debugger.sendCommand(target, 'Page.addScriptToEvaluateOnNewDocument', {
        source: `(${overrideLanguages.toString()})(${JSON.stringify(next.locale)});`
      });
      state.scriptId = script.identifier;
      state.locale = next.locale;
    }
    state.key = key;
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, world: 'MAIN', func: overrideLanguages, args: [next.locale]
  });
}

function queueTab(tabId) {
  const previous = tabJobs.get(tabId) || Promise.resolve();
  const job = previous.then(() => ready).then(() => applyTab(tabId)).catch((error) => {
    console.warn('geo-mask: tab', tabId, error.message);
  });
  tabJobs.set(tabId, job);
  void job.finally(() => {
    if (tabJobs.get(tabId) === job) tabJobs.delete(tabId);
  });
  return job;
}

async function applyAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => /^https?:\/\//.test(tab.url || '')).map((tab) => queueTab(tab.id)));
}

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM_NAME)) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  }
}

async function initialize() {
  try {
    await ensureAlarm();
    await ready;
    await refreshProfile(true);
    await applyAllTabs();
  } catch (error) {
    console.warn('geo-mask: initialization failed:', error.message);
  }
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void refreshProfile(true);
});
chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.url || /^(https?:\/\/|about:blank)/.test(tab.url)) void queueTab(tab.id);
  void refreshProfile();
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (/^https?:\/\//.test(tab.url || '') && (info.status || info.url)) {
    void queueTab(tabId);
    if (info.status === 'loading' || info.url) void refreshProfile();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => tabStates.delete(tabId));
chrome.debugger.onDetach.addListener((source) => tabStates.delete(source.tabId));
void initialize();
