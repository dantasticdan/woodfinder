const state = {
  listings: [],
  searchId: null,
  origin: null,
  selectedIds: new Set(),
  sort: 'distance',
  sortDir: 'asc',
  googleUrl: null,
  appleUrl: null,
};

const DEFAULT_SORT_DIR = {
  date: 'desc',
  distance: 'asc',
  location: 'asc',
};

function sortListingsLocal(listings, sort, dir) {
  const copy = [...listings];
  if (sort === 'distance') {
    copy.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      const cmp = a.distanceKm - b.distanceKm;
      return dir === 'desc' ? -cmp : cmp;
    });
  } else if (sort === 'location') {
    copy.sort((a, b) => {
      const cmp = (a.locationText || '').localeCompare(b.locationText || '', undefined, {
        sensitivity: 'base',
      });
      return dir === 'desc' ? -cmp : cmp;
    });
  } else {
    copy.sort((a, b) => {
      const da = a.postedAt ? new Date(a.postedAt).getTime() : 0;
      const db = b.postedAt ? new Date(b.postedAt).getTime() : 0;
      return dir === 'asc' ? da - db : db - da;
    });
  }
  return copy;
}

function applySort() {
  state.listings = sortListingsLocal(state.listings, state.sort, state.sortDir);
  UI.updateSortHeaders(state.sort, state.sortDir);
  render();
}

function getSearchParams() {
  const coords = UI.getCoords();
  const address = document.getElementById('address').value.trim();
  const radius = document.getElementById('radius').value;
  const keywords = document.getElementById('keywords').value.trim();

  const params = {
    radius,
    keywords,
    listed: document.getElementById('date-listed').value,
    sort: state.sort,
    dir: state.sortDir,
  };
  if (coords) {
    params.lat = coords.lat;
    params.lng = coords.lng;
  } else if (address) {
    params.address = address;
  }
  return params;
}

async function runSearch() {
  UI.clearAlert();
  const params = getSearchParams();
  if (!params.lat && !params.address) {
    UI.showAlert('Set your location with the geo button or enter an address/postal code.');
    return;
  }

  UI.setSearching(true, 'Searching Kijiji…');
  UI.showSearchProgress();
  try {
    const data = await API.search(params, (progress) => {
      UI.updateSearchProgress(progress.percent ?? 0, progress.message);
    });
    state.listings = data.listings;
    state.searchId = data.searchId;
    state.origin =
      data.meta?.lat != null
        ? { lat: data.meta.lat, lng: data.meta.lng }
        : params.lat
          ? { lat: parseFloat(params.lat), lng: parseFloat(params.lng) }
          : null;
    state.selectedIds.clear();
    state.googleUrl = null;
    state.appleUrl = null;

    if (data.meta?.sort) state.sort = data.meta.sort;
    if (data.meta?.sortDir) state.sortDir = data.meta.sortDir;

    if (state.origin) {
      UI.setCoords(state.origin.lat, state.origin.lng);
    }

    UI.showResults(data.listings.length, data.meta?.cached);
    UI.updateSortHeaders(state.sort, state.sortDir);
    render();
    if (!data.listings.length) {
      UI.showAlert('No free firewood listings found. Try a larger radius or different keywords.', 'info');
    }
  } catch (err) {
    UI.showAlert(err.message);
  } finally {
    UI.setSearching(false);
  }
}

function getRoutableListings() {
  return state.listings.filter((l) => l.lat != null && l.lng != null);
}

function render() {
  UI.renderListings(state.listings, state.selectedIds, onToggleListing);
  UI.updateSelectAllCheckbox(state.listings, state.selectedIds);
  updateRoute();
}

function selectAllRoutable() {
  getRoutableListings().forEach((l) => state.selectedIds.add(l.id));
  render();
}

function clearSelection() {
  state.selectedIds.clear();
  render();
}

async function onToggleListing(id, checked) {
  if (checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  UI.updateSelectAllCheckbox(state.listings, state.selectedIds);
  await updateRoute();
}

function onToggleSelectAll(checked) {
  if (checked) selectAllRoutable();
  else clearSelection();
}

async function updateRoute() {
  const count = state.selectedIds.size;
  if (count === 0) {
    UI.updateRoutePanel(0, null);
    return;
  }

  const origin = state.origin || UI.getCoords();
  if (!origin) {
    UI.updateRoutePanel(count, null);
    return;
  }

  try {
    const [google, apple] = await Promise.all([
      API.buildRoute({
        searchId: state.searchId,
        listingIds: [...state.selectedIds],
        origin,
        provider: 'google',
      }),
      API.buildRoute({
        searchId: state.searchId,
        listingIds: [...state.selectedIds],
        origin,
        provider: 'apple',
      }),
    ]);
    state.googleUrl = google.mapsUrl;
    state.appleUrl = apple.mapsUrl;
    UI.clearAlert();
    UI.updateRoutePanel(count, google);
    document.getElementById('btn-google').dataset.url = google.mapsUrl;
    document.getElementById('btn-apple').dataset.url = apple.mapsUrl;
  } catch (err) {
    UI.updateRoutePanel(count, null);
  }
}

async function resolveAddressToCoords() {
  const address = document.getElementById('address').value.trim();
  if (!address) return;
  try {
    const geo = await API.geocode(address);
    UI.setCoords(geo.lat, geo.lng, geo.displayName);
    state.origin = { lat: geo.lat, lng: geo.lng };
  } catch {
    /* search will geocode server-side */
  }
}

document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});

document.getElementById('btn-geo').addEventListener('click', () => {
  if (!navigator.geolocation) {
    UI.showAlert('Geolocation is not supported in this browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      UI.setCoords(lat, lng);
      state.origin = { lat, lng };
      document.getElementById('address').value = '';
    },
    () => UI.showAlert('Could not get your location. Check browser permissions.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

document.getElementById('address').addEventListener('blur', resolveAddressToCoords);

document.getElementById('select-all-check').addEventListener('change', (e) => {
  onToggleSelectAll(e.target.checked);
});

document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    if (!state.listings.length) return;

    if (state.sort === field) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = field;
      state.sortDir = DEFAULT_SORT_DIR[field] || 'asc';
    }
    applySort();
  });
});

document.getElementById('btn-google').addEventListener('click', () => {
  const url = document.getElementById('btn-google').dataset.url;
  if (url) window.open(url, '_blank');
});

document.getElementById('btn-apple').addEventListener('click', () => {
  const url = document.getElementById('btn-apple').dataset.url;
  if (url) window.open(url, '_blank');
});
