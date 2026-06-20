const UI = {
  el(id) {
    return document.getElementById(id);
  },

  showAlert(message, type = 'danger') {
    const area = this.el('alert-area');
    area.innerHTML = `
      <div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>`;
  },

  clearAlert() {
    this.el('alert-area').innerHTML = '';
  },

  setSearching(loading, message) {
    const btn = this.el('btn-search');
    btn.disabled = loading;
    const label = btn.querySelector('.search-label');
    label.textContent = loading ? message || 'Searching…' : 'Search Kijiji';
    label.classList.toggle('d-none', false);
    btn.querySelector('.spinner-border').classList.toggle('d-none', !loading);
    if (!loading) this.hideSearchProgress();
  },

  showSearchProgress() {
    this.el('search-progress').classList.remove('d-none');
    this.updateSearchProgress(0, 'Starting search…');
  },

  hideSearchProgress() {
    this.el('search-progress').classList.add('d-none');
  },

  updateSearchProgress(percent, message) {
    const pct = Math.min(100, Math.max(0, Math.round(percent)));
    const bar = this.el('search-progress-bar');
    bar.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', pct);
    this.el('search-progress-percent').textContent = `${pct}%`;
    if (message) this.el('search-progress-label').textContent = message;
  },

  setCoords(lat, lng, label) {
    const display = this.el('coords-display');
    if (lat != null && lng != null) {
      display.textContent = label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      display.dataset.lat = lat;
      display.dataset.lng = lng;
    } else {
      display.textContent = 'Use geolocation or enter an address';
      delete display.dataset.lat;
      delete display.dataset.lng;
    }
  },

  getCoords() {
    const display = this.el('coords-display');
    const lat = parseFloat(display.dataset.lat);
    const lng = parseFloat(display.dataset.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  },

  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  },

  updateSortHeaders(sortField, sortDir) {
    document.querySelectorAll('th.sortable').forEach((th) => {
      const field = th.dataset.sort;
      const icon = th.querySelector('.sort-icon');
      th.classList.toggle('active', field === sortField);
      if (!icon) return;
      icon.className =
        field === sortField
          ? `bi sort-icon ${sortDir === 'asc' ? 'bi-chevron-up' : 'bi-chevron-down'}`
          : 'bi bi-chevron-expand sort-icon';
    });
  },

  formatDistance(km) {
    if (km == null) return '—';
    return `${km} km`;
  },

  renderListings(listings, selectedIds, onToggle) {
    const tbody = this.el('listings-body');
    tbody.innerHTML = listings
      .map((l) => {
        const routable = l.lat != null && l.lng != null;
        const checked = selectedIds.has(l.id) ? 'checked' : '';
        const thumb = l.imageUrl
          ? `<img src="${l.imageUrl}" alt="" class="listing-thumb" loading="lazy">`
          : `<div class="listing-thumb-placeholder"><i class="bi bi-image"></i></div>`;
        return `
          <tr class="${routable ? '' : 'unroutable'}">
            <td>
              <input type="checkbox" class="form-check-input listing-check" data-id="${l.id}"
                ${checked} ${routable ? '' : 'disabled title="No coordinates for routing"'}>
            </td>
            <td>${thumb}</td>
            <td>
              <a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.title)}</a>
              <div class="small text-muted">${l.source} · ${escapeHtml(l.price || 'Free')}</div>
            </td>
            <td>${this.formatDate(l.postedAt)}</td>
            <td>${this.formatDistance(l.distanceKm)}</td>
            <td class="small">${escapeHtml(l.locationText || '—')}</td>
          </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.listing-check').forEach((cb) => {
      cb.addEventListener('change', () => onToggle(cb.dataset.id, cb.checked));
    });
  },

  showResults(count, cached = false) {
    this.el('results-section').classList.remove('d-none');
    const suffix = cached ? ' · cached' : '';
    this.el('results-count').textContent = `${count} listing${count === 1 ? '' : 's'}${suffix}`;
  },

  updateSelectAllCheckbox(listings, selectedIds) {
    const cb = this.el('select-all-check');
    if (!cb) return;

    const routable = listings.filter((l) => l.lat != null && l.lng != null);
    const selectedCount = routable.filter((l) => selectedIds.has(l.id)).length;

    cb.disabled = routable.length === 0;
    cb.checked = routable.length > 0 && selectedCount === routable.length;
    cb.indeterminate = selectedCount > 0 && selectedCount < routable.length;
  },

  updateRoutePanel(selectedCount, route) {
    this.el('route-section').classList.toggle('d-none', selectedCount === 0);
    this.el('selected-count').textContent = selectedCount;

    const warn = this.el('waypoint-warning');
    if (selectedCount > 9 || route?.truncated) {
      warn.textContent = `Google Maps supports at most 9 stops. Route preview uses the 9 closest stops in optimized order (${selectedCount} selected).`;
      warn.classList.remove('d-none');
    } else if (selectedCount > 3) {
      warn.textContent =
        'Google Maps on mobile supports at most 3 stops. Use desktop or split your route for more stops.';
      warn.classList.remove('d-none');
    } else {
      warn.classList.add('d-none');
    }

    const stopsEl = this.el('route-stops');
    const btnGoogle = this.el('btn-google');
    const btnApple = this.el('btn-apple');

    if (!route) {
      stopsEl.innerHTML = '<li class="text-muted">Select listings to preview route</li>';
      btnGoogle.disabled = true;
      btnApple.disabled = true;
      delete btnGoogle.dataset.url;
      delete btnApple.dataset.url;
      return;
    }

    stopsEl.innerHTML = route.stops
      .map(
        (s) =>
          `<li><strong>${s.order}.</strong> ${escapeHtml(s.title)} <span class="text-muted">(${s.legKm} km leg)</span></li>`
      )
      .join('');
    stopsEl.insertAdjacentHTML(
      'beforeend',
      `<li class="text-muted small">~${route.totalKm} km total (straight-line estimate)</li>`
    );

    btnGoogle.disabled = !route.mapsUrl;
    btnApple.disabled = !route.mapsUrl;
  },
};

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
