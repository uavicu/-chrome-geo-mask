const GeoProfile = (() => {
  function normalizeIp(value) {
    if (typeof value !== 'string') throw new Error('Missing exit IP');
    const ip = value.trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((part) => Number(part) <= 255)) {
      return ip.split('.').map(Number).join('.');
    }
    if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) {
      try {
        return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
      } catch (error) { /* reject malformed IPv6 */ }
    }
    throw new Error('Invalid exit IP');
  }

  function fromLookup(data, expectedIp) {
    if (!data || data.success === false || data.error) throw new Error('Location lookup failed');
    const ip = normalizeIp(data.ip);
    if (ip !== normalizeIp(expectedIp)) throw new Error('Location response does not match exit IP');
    const countryCode = String(data.country_code || data.countryCode || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Invalid country code');
    const timezone = typeof data.timezone === 'string' ? data.timezone : data.timezone?.id;
    if (!timezone) throw new Error('Missing timezone');
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    const { latitude, longitude } = data;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new Error('Invalid coordinates');
    }
    const language = new Intl.Locale(`und-${countryCode}`).maximize().language;
    const locale = `${language}-${countryCode}`;
    const languages = [...new Set([locale, language, 'en-US', 'en'])];
    return { ip, countryCode, timezone, locale, languages, latitude, longitude };
  }

  function languageHeader(profile) {
    return profile.languages.map((language, index) => index ? `${language};q=${(1 - index * 0.1).toFixed(1)}` : language).join(',');
  }

  return { normalizeIp, fromLookup, languageHeader };
})();

if (typeof module !== 'undefined') module.exports = GeoProfile;
