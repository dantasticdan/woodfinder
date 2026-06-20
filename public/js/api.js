function parseSseBlock(block, handlers) {
  if (!block || block.startsWith(':')) return;

  let event = 'message';
  const dataLines = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (!dataLines.length) return;
  handlers(event, dataLines.join('\n'));
}

const API = {
  async search(params, onProgress) {
    const qs = new URLSearchParams({ ...params, stream: '1' });
    const res = await fetch(`/api/search?${qs}`);
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('text/event-stream')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      return data;
    }

    if (!res.ok) throw new Error('Search failed');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let streamError = null;

    const handleEvent = (event, data) => {
      try {
        if (event === 'progress') {
          onProgress?.(JSON.parse(data));
        } else if (event === 'result') {
          result = JSON.parse(data);
        } else if (event === 'search-error') {
          const payload = JSON.parse(data);
          streamError = new Error(payload.error || 'Search failed');
        }
      } catch {
        /* ignore malformed events */
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        parseSseBlock(part.trim(), handleEvent);
      }
    }

    if (buffer.trim()) parseSseBlock(buffer.trim(), handleEvent);

    if (streamError) throw streamError;
    if (result) return result;
    throw new Error('Search ended unexpectedly. Restart the dev server and try again.');
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
