const TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES, 10) || 10) * 60 * 1000;

const store = new Map();

function makeKey(parts) {
  return JSON.stringify(parts);
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value) {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

function getOrSet(key, factory) {
  const cached = get(key);
  if (cached) return Promise.resolve({ value: cached, cached: true });

  return factory().then((value) => {
    set(key, value);
    return { value, cached: false };
  });
}

module.exports = { makeKey, get, set, getOrSet };
