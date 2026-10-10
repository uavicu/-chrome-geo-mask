// Self-contained so CDP and chrome.scripting can run it in each page's MAIN world.
function overrideLanguages(locale) {
  const languages = Object.freeze([...new Set([locale, locale.split('-')[0], 'en-US', 'en'])]);
  const define = (proto, prop, value) => {
    try {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: true,
        get: function () { return value; }
      });
    } catch (e) { /* ignore if the property is not configurable in this frame */ }
  };
  define(Navigator.prototype, 'language', locale);
  define(Navigator.prototype, 'languages', languages);
}
