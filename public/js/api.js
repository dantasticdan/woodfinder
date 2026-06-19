const API = {
  async search(params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`/api/search?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    return data;
  },

  async geocode(address) {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Geocode failed');
    return data;
  },

  async buildRoute(body) {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Route failed');
    return data;
  },
};
