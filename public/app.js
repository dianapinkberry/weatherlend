// Weatherlend front end: plain JavaScript, no build step.
// Routes: #/offers  #/offer  #/requests  #/points  #/calendar

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

const state = { meta: null, user: null, account: null, filter: new Set(), calMonth: null };

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    method: options.body ? 'POST' : 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- helpers ----------
const ptsLabel = (n, short = false) => `${n} ${short ? 'pt' : 'point'}${n === 1 ? '' : 's'}`;
const sizeOf = (slug) => state.meta.sizes.find((s) => s.slug === slug);
const phenom = (slug) => state.meta.phenomena.find((p) => p.slug === slug);
const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1;
const fmtDay = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  const y = d.getUTCFullYear() !== new Date().getFullYear() ? ` ${d.getUTCFullYear()}` : '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y}`;
};
const fmtRange = (a, b) => {
  if (a === b) return fmtDay(a);
  const da = new Date(a + 'T00:00:00Z'), db = new Date(b + 'T00:00:00Z');
  return da.getUTCMonth() === db.getUTCMonth() && da.getUTCFullYear() === db.getUTCFullYear()
    ? `${da.getUTCDate()} to ${fmtDay(b)}` : `${fmtDay(a)} to ${fmtDay(b)}`;
};
function availability(item) {
  if (item.available_from_month && item.available_until_month)
    return `${MONTHS[item.available_from_month - 1]} to ${MONTHS[item.available_until_month - 1]}`;
  return item.availability_note || 'all year';
}
function inSeason(item, startIso, endIso) {
  const f = item.available_from_month, u = item.available_until_month;
  if (!f || !u) return true;
  const ok = (m) => (f <= u ? m >= f && m <= u : m >= f || m <= u);
  for (let d = startIso; d <= endIso; d = addDays(d, 1)) if (!ok(+d.slice(5, 7))) return false;
  return true;
}
// First day from today on which the item is in season (used to prefill the request dates).
function firstSeasonDay(item) {
  let d = isoToday();
  for (let i = 0; i < 400; i++, d = addDays(d, 1)) if (inSeason(item, d, d)) return d;
  return isoToday();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

function openModal(html, onReady) {
  const dlg = $('#modal');
  $('#modalBody').innerHTML = html;
  dlg.showModal();
  onReady?.($('#modalBody'), () => dlg.close());
}

const phenChip = (p) => `<span class="tag tinted" style="--tint:${esc(p.tint)};--tagink:${esc(p.ink)}">${esc(p.short_name || p.phenomenon_name)}</span>`;

// ---------- user / header ----------
async function loadMeta() {
  state.meta = await api('/meta');
  const sel = $('#userSelect');
  sel.innerHTML = state.meta.users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  let saved = null;
  try { saved = +localStorage.getItem('wl-user'); } catch {}
  state.user = state.meta.users.find((u) => u.id === saved) || state.meta.users.find((u) => u.name === 'Sven') || state.meta.users[0];
  sel.value = state.user.id;
}
async function refreshAccount() {
  state.account = await api(`/users/${state.user.id}/account`);
  $('#pointsPill').textContent = ptsLabel(state.account.balance);
}
$('#userSelect').addEventListener('change', async (e) => {
  state.user = state.meta.users.find((u) => u.id === +e.target.value);
  try { localStorage.setItem('wl-user', state.user.id); } catch {}
  await refreshAccount();
  toast(`You are now ${state.user.name}`);
  render();
});
$('.menu-btn').addEventListener('click', (e) => {
  const open = $('.nav').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', open);
});

// ---------- router ----------
const routes = { offers: renderOffers, offer: renderOffer, requests: renderRequests, points: renderPoints, calendar: renderCalendar };
function currentRoute() {
  const [name, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: routes[name] ? name : 'offers', params: new URLSearchParams(query || '') };
}
async function render() {
  const { name, params } = currentRoute();
  $$('.nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $('.nav').classList.remove('open');
  try {
    await routes[name](params);
  } catch (err) {
    app.innerHTML = `<div class="page-head"><h1>Something went wrong</h1><p class="lead">${esc(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ---------- Offers (landing) ----------
async function renderOffers(params) {
  if (params.get('ph')) state.filter = new Set(params.get('ph').split(','));
  const items = await api('/items' + (state.filter.size ? `?phenomena=${[...state.filter].join(',')}` : ''));
  const picked = state.meta.phenomena.filter((p) => state.filter.has(p.slug));
  const title = picked.length ? picked.map((p) => p.short_name).join(' · ') : 'All phenomena';
  const sub = picked.length ? 'Items that help with what you picked. Pick more to widen the search.'
    : 'Everything the community currently offers. Pick a phenomenon above to narrow it down.';
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">For students in Zurich</div>
      <h1>Borrow what the weather<br>asks for.</h1>
      <p class="lead">A fan during a heat wave, a heater in a draughty flat, a wet vacuum when the cellar floods. Students lend to each other instead of buying things they need twice a year. Lending earns points, borrowing spends them.</p>
    </section>
    <div class="filter-head"><h3>Filter by phenomenon</h3><small>Pick one or more. Items can belong to several phenomena.</small></div>
    <div class="chips" role="group" aria-label="Phenomena">
      ${state.meta.phenomena.map((p) => `<button class="chip" data-ph="${esc(p.slug)}" aria-pressed="${state.filter.has(p.slug)}">${esc(p.short_name)} <span class="n">${p.item_count}</span></button>`).join('')}
      ${state.filter.size ? '<button class="chip" data-clear>Clear</button>' : ''}
    </div>
    <div class="summary">
      <div><h2>${esc(title)}</h2><p>${sub}</p></div>
      <span class="count">${items.length} item${items.length === 1 ? '' : 's'} available</span>
    </div>
    <div class="grid">${items.map(itemCard).join('') || '<div class="empty">Nothing here yet. Be the first to offer something for this weather.</div>'}</div>
    <div class="notice">
      <span>Nothing suitable for the phenomenon you picked? Post what you need and for which days.</span>
      <a class="btn ghost sm" href="#/requests${picked.length === 1 ? '?ph=' + picked[0].slug : ''}">Post a request</a>
    </div>
    <section class="how">
      <h2>How it works</h2>
      <div class="how-grid">
        <div class="how-card"><div class="num">1</div><h3>Offer</h3><p>During onboarding you list what you would lend, which phenomena it helps with, and when it is free.</p></div>
        <div class="how-card"><div class="num">2</div><h3>Request</h3><p>Filter by phenomenon, pick an offer and a period, or post a request if nothing fits.</p></div>
        <div class="how-card"><div class="num">3</div><h3>Keep the balance</h3><p>Points per day by size: ${state.meta.sizes.map((s) => `${s.name.toLowerCase()} ${s.points_per_day}`).join(', ')}. Lending adds them, borrowing deducts them. Everyone starts with 10.</p></div>
      </div>
    </section>`;
  $$('.chip[data-ph]').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.ph;
    state.filter.has(s) ? state.filter.delete(s) : state.filter.add(s);
    history.replaceState(null, '', '#/offers');
    renderOffers(new URLSearchParams());
  }));
  $('[data-clear]')?.addEventListener('click', () => { state.filter.clear(); history.replaceState(null, '', '#/offers'); renderOffers(new URLSearchParams()); });
  $$('[data-request]').forEach((b) => b.addEventListener('click', () => requestModal(items.find((i) => i.id === +b.dataset.request))));
}

function itemCard(it) {
  const [main, ...also] = it.phenomena;
  const tint = main?.tint || '#E4E7E5';
  const mine = it.owner_id === state.user.id;
  return `
  <article class="item">
    <div class="item-top ${it.photo ? 'has-photo' : ''}" style="--tint:${esc(tint)};--ink2:${esc(main?.ink || '#3B4A47')}">
      ${it.photo ? `<img src="${esc(it.photo)}" alt="${esc(it.name)}" loading="lazy">` : ''}
      <div class="row"><span class="tag">${esc(main?.short_name || '')}</span><span class="ppd">${it.points_per_day} pt per day</span></div>
      ${also.length ? `<span class="also">Also: ${also.map((p) => esc(p.short_name)).join(', ')}</span>` : '<span></span>'}
      ${it.photo ? '' : '<span class="ph">Photo of the item</span>'}
    </div>
    <div class="item-body">
      <h3>${esc(it.name)}</h3>
      <p>${esc(it.owner_name)} · ${esc(it.neighbourhood || '')}</p>
      <p>Available: ${esc(availability(it))}</p>
      ${it.description ? `<p title="${esc(it.description)}">${esc(it.description.length > 80 ? it.description.slice(0, 78) + '…' : it.description)}</p>` : ''}
    </div>
    <div class="item-foot">
      <span>${esc(it.size_name)} item</span>
      ${mine ? '<span class="mine">Your item</span>' : `<button class="btn sm" data-request="${it.id}">Request</button>`}
    </div>
  </article>`;
}

function requestModal(item) {
  const start = firstSeasonDay(item);
  const free = state.account.available;
  openModal(`
    <h2>Borrow ${esc(item.name)}</h2>
    <p class="sub">From ${esc(item.owner_name)} · ${esc(item.neighbourhood || '')} · ${ptsLabel(item.points_per_day, true)} per day · available ${esc(availability(item))}</p>
    <div class="row2">
      <div class="field"><label for="rqFrom">From</label><input type="date" id="rqFrom" value="${start}" min="${isoToday()}"></div>
      <div class="field"><label for="rqUntil">Until</label><input type="date" id="rqUntil" value="${addDays(start, 1)}" min="${isoToday()}"></div>
    </div>
    <div class="info" id="rqInfo"></div>
    <p class="err" id="rqErr"></p>
    <div class="actions"><button class="btn" id="rqSend" type="button">Send request</button><button class="btn ghost" value="cancel">Cancel</button></div>`,
  (root, close) => {
    const from = $('#rqFrom', root), until = $('#rqUntil', root), info = $('#rqInfo', root), send = $('#rqSend', root);
    const update = () => {
      if (until.value < from.value) until.value = from.value;
      const days = daysBetween(from.value, until.value);
      const pts = days * item.points_per_day;
      const seasonOk = inSeason(item, from.value, until.value);
      info.className = 'info' + (pts > free || !seasonOk ? ' warn' : '');
      info.textContent = !seasonOk ? `Not available on all of these days. It is lent ${availability(item)}.`
        : `${days} day${days === 1 ? '' : 's'} × ${item.points_per_day} = ${ptsLabel(pts)}. You have ${free} available.`;
      send.disabled = pts > free || !seasonOk || !from.value;
    };
    from.addEventListener('change', update); until.addEventListener('change', update); update();
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        await api('/loans', { body: { item_id: item.id, borrower_id: state.user.id, start_date: from.value, end_date: until.value } });
        close();
        await refreshAccount();
        toast(`Request sent to ${item.owner_name}. Points are reserved until they answer.`);
      } catch (err) { $('#rqErr', root).textContent = err.message; send.disabled = false; }
    });
  });
}

// ---------- Offer an item (onboarding) ----------
async function renderOffer() {
  const m = state.meta;
  const monthOpts = (sel) => MONTHS.map((n, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${n}</option>`).join('');
  app.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Onboarding · Step 1 of 2</div>
      <h1>What can you lend?</h1>
      <p class="lead">List what sits unused in your flat. For every day someone borrows it, you earn points you can spend later.</p>
    </div>
    <div class="two">
      <form class="panel" id="offerForm" novalidate>
        <div class="field"><label for="fName">Item</label><input type="text" id="fName" name="name" placeholder="e.g. fan heater 2000 W" maxlength="80" required></div>
        <div class="field"><span class="label">Which phenomena does it help with?</span>
          <p class="hint">Pick all that apply. The list is maintained by us, so new phenomena can be added later.</p>
          <div class="checks">${m.phenomena.map((p) => `<label class="check"><input type="checkbox" name="ph" value="${esc(p.slug)}"> ${esc(p.name)}</label>`).join('')}</div>
        </div>
        <div class="field"><span class="label">Size category and point value</span>
          <div class="radios">${m.sizes.map((s) => `<label class="radio"><input type="radio" name="size" value="${s.slug}" ${s.slug === 'medium' ? 'checked' : ''}> ${esc(s.name)} · ${ptsLabel(s.points_per_day, true)} per day</label>`).join('')}</div>
        </div>
        <div class="row3">
          <div class="field"><label for="fFrom">Available from</label><select id="fFrom">${monthOpts(11)}</select></div>
          <div class="field"><label for="fUntil">Available until</label><select id="fUntil">${monthOpts(2)}</select></div>
          <div class="field"><label for="fHood">Neighbourhood</label><select id="fHood">${m.neighbourhoods.map((n) => `<option ${n === state.user.neighbourhood ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        </div>
        <label class="check" style="margin:-8px 0 18px;width:max-content"><input type="checkbox" id="fAllYear"> Available all year</label>
        <div class="field"><label for="fDesc">Description <span class="opt">(optional)</span></label><textarea id="fDesc" placeholder="Condition, pick-up, anything to know" maxlength="400"></textarea></div>
        <div class="field"><span class="label">Photo <span class="opt">(optional)</span></span>
          <label class="drop" id="drop"><input type="file" id="fPhoto" accept="image/*" hidden><span id="dropText">Drop a photo here or choose a file</span></label>
        </div>
        <p class="err" id="offerErr"></p>
        <div class="actions"><button class="btn" type="submit" data-next="done">Publish offer</button><button class="btn ghost" type="submit" data-next="again">Add another item</button></div>
      </form>
      <aside class="side">
        <div><div class="side-label">Preview</div><div id="preview"></div></div>
        <div class="side-card soft" id="earnCard"></div>
        <div class="side-card"><h3>Step 2 of onboarding</h3><p>Pick the phenomena you want to be notified about, so you hear when a neighbour needs something you have.</p></div>
      </aside>
    </div>`;

  const form = $('#offerForm');
  let photo = null;
  const read = () => ({
    name: $('#fName').value.trim(),
    phenomena: $$('input[name=ph]:checked', form).map((i) => i.value),
    size: $('input[name=size]:checked', form)?.value,
    allYear: $('#fAllYear').checked,
    from: +$('#fFrom').value, until: +$('#fUntil').value,
    neighbourhood: $('#fHood').value, description: $('#fDesc').value.trim(),
  });
  const preview = () => {
    const v = read();
    const s = sizeOf(v.size) || m.sizes[0];
    const ph = v.phenomena.map(phenom);
    const fake = {
      id: 0, name: v.name || 'Your item', owner_id: -1, owner_name: state.user.name, neighbourhood: v.neighbourhood,
      size_name: s.name, points_per_day: s.points_per_day, photo, description: v.description,
      phenomena: ph.length ? ph : [{ short_name: 'Pick a phenomenon', tint: '#E4E7E5', ink: '#5E726E' }],
      available_from_month: v.allYear ? null : v.from, available_until_month: v.allYear ? null : v.until,
    };
    $('#preview').innerHTML = itemCard(fake).replace(/<button[^>]*>Request<\/button>/, '<span class="btn sm" aria-hidden="true">Request</span>');
    $('#earnCard').innerHTML = `<h3>When someone borrows it</h3><p>Three days of ${esc(v.name || 'your item')} earn you ${3 * s.points_per_day} points. That is ${3 * s.points_per_day} days of a small item, like rubber boots, when you need them.</p>`;
    $('#fFrom').disabled = $('#fUntil').disabled = v.allYear;
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();

  // Photo: resized in the browser to max 900 px so the database stays small.
  const drop = $('#drop');
  const takeFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    photo = await resizeImage(file, 900, 0.8);
    $('#dropText').innerHTML = `<img src="${photo}" alt=""><span class="link-btn">Choose another photo</span>`;
    preview();
  };
  $('#fPhoto').addEventListener('change', (e) => takeFile(e.target.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); takeFile(e.dataTransfer.files[0]); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = read();
    const err = $('#offerErr');
    if (v.name.length < 2) return (err.textContent = 'Please give the item a name.');
    if (!v.phenomena.length) return (err.textContent = 'Pick at least one phenomenon.');
    err.textContent = '';
    const btns = $$('button[type=submit]', form); btns.forEach((b) => (b.disabled = true));
    try {
      const item = await api('/items', { body: {
        owner_id: state.user.id, name: v.name, phenomena: v.phenomena, size: v.size, neighbourhood: v.neighbourhood,
        description: v.description, photo,
        available_from_month: v.allYear ? null : v.from, available_until_month: v.allYear ? null : v.until,
      } });
      state.meta = await api('/meta'); // phenomenon counts changed
      if (e.submitter?.dataset.next === 'again') {
        toast(`${item.name} is published. Add the next one.`);
        renderOffer();
      } else {
        renderNotifyStep(item);
      }
    } catch (ex) { err.textContent = ex.message; btns.forEach((b) => (b.disabled = false)); }
  });
}

function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function renderNotifyStep(item) {
  await refreshAccount();
  const chosen = new Set(state.account.notify.length ? state.account.notify : item.phenomena.map((p) => p.slug));
  app.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Onboarding · Step 2 of 2</div>
      <h1>${esc(item.name)} is online.</h1>
      <p class="lead">Which weather should we tell you about? You will hear when a neighbour posts a request for one of these phenomena.</p>
    </div>
    <div class="panel" style="max-width:760px">
      <div class="checks">${state.meta.phenomena.map((p) => `<label class="check"><input type="checkbox" value="${esc(p.slug)}" ${chosen.has(p.slug) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin:14px 0">In this prototype the choice is saved, notifications themselves are part of a later version.</p>
      <div class="actions"><button class="btn" id="saveNotify">Save and see offers</button><a class="btn ghost" href="#/offer">Add another item</a></div>
    </div>`;
  $('#saveNotify').addEventListener('click', async () => {
    const phenomena = $$('.checks input:checked').map((i) => i.value);
    await api(`/users/${state.user.id}/notifications`, { body: { phenomena } });
    toast('Saved. Thank you for lending!');
    location.hash = '#/offers';
  });
}

// ---------- Requests ----------
async function renderRequests(params) {
  const m = state.meta;
  const listFilter = new Set(params.get('ph') ? params.get('ph').split(',') : []);
  const preset = params.get('ph')?.split(',')[0];
  app.innerHTML = `
    <div class="page-head">
      <h1>What do you need, and when?</h1>
      <p class="lead">Nothing suitable among the offers? Post a request. Whoever owns the item gets back to you.</p>
    </div>
    <div class="two left">
      <form class="panel" id="needForm" novalidate>
        <h2 style="margin-bottom:16px">New request</h2>
        <div class="field"><label for="nTitle">I need</label><input type="text" id="nTitle" placeholder="e.g. fan heater" maxlength="80"></div>
        <div class="field"><label for="nPh">Phenomenon</label><select id="nPh">${m.phenomena.map((p) => `<option value="${esc(p.slug)}" ${p.slug === preset ? 'selected' : ''}>${esc(p.short_name)}</option>`).join('')}</select></div>
        <div class="field"><label for="nSize">Size of the item</label><select id="nSize">${m.sizes.map((s) => `<option value="${s.slug}">${esc(s.name)} · ${ptsLabel(s.points_per_day, true)} per day (${esc(s.examples)})</option>`).join('')}</select></div>
        <div class="field"><label for="nFrom">From</label><input type="date" id="nFrom" value="${addDays(isoToday(), 1)}" min="${isoToday()}"></div>
        <div class="field"><label for="nUntil">Until</label><input type="date" id="nUntil" value="${addDays(isoToday(), 2)}" min="${isoToday()}"></div>
        <div class="field"><label for="nHood">Neighbourhood</label><select id="nHood">${m.neighbourhoods.map((n) => `<option ${n === state.user.neighbourhood ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label for="nNote">Note <span class="opt">(optional)</span></label><textarea id="nNote" placeholder="e.g. can pick it up after 6 pm" maxlength="300"></textarea></div>
        <div class="info" id="nInfo"></div>
        <p class="err" id="nErr"></p>
        <button class="btn" type="submit">Post request</button>
      </form>
      <section>
        <div class="list-head"><h2>Open requests</h2><small>Filtered by phenomenon, same as the offers</small></div>
        <div class="chips" style="margin-bottom:14px">${m.phenomena.map((p) => `<button class="chip" data-ph="${esc(p.slug)}" aria-pressed="${listFilter.has(p.slug)}">${esc(p.short_name)}</button>`).join('')}</div>
        <div id="needList"><p class="muted">Loading…</p></div>
      </section>
    </div>`;

  const updateInfo = () => {
    const f = $('#nFrom').value, u = $('#nUntil').value;
    if (u < f) $('#nUntil').value = f;
    const days = daysBetween($('#nFrom').value, $('#nUntil').value);
    const pts = days * sizeOf($('#nSize').value).points_per_day;
    const free = state.account.available;
    $('#nInfo').className = 'info' + (pts > free ? ' warn' : '');
    $('#nInfo').textContent = `You need enough points for the whole period: ${days} day${days === 1 ? '' : 's'} = ${ptsLabel(pts)}. You currently have ${free} available.`;
  };
  ['nFrom', 'nUntil', 'nSize'].forEach((id) => $('#' + id).addEventListener('change', updateInfo));
  updateInfo();

  const loadList = async () => {
    const needs = await api('/needs' + (listFilter.size ? `?phenomena=${[...listFilter].join(',')}` : ''));
    $('#needList').innerHTML = needs.map((n) => `
      <div class="req">
        <div>
          <h3>${esc(n.title)} ${n.phenomenon_slug ? phenChip(n) : ''}</h3>
          <p>${esc(n.user_name)} · ${esc(n.neighbourhood || '')}</p>
          <p>Period: ${fmtRange(n.start_date, n.end_date)} · ${ptsLabel(n.points)} in total</p>
          ${n.note ? `<p class="note">“${esc(n.note)}”</p>` : ''}
        </div>
        ${n.user_id === state.user.id ? '<span class="mine">Your request</span>' : `<button class="btn ghost sm" data-have="${n.id}">I have this</button>`}
      </div>`).join('') || '<div class="empty">No open requests for this weather.</div>';
    $$('[data-have]').forEach((b) => b.addEventListener('click', () => haveModal(needs.find((n) => n.id === +b.dataset.have), loadList)));
  };
  $$('.chip[data-ph]').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.ph;
    listFilter.has(s) ? listFilter.delete(s) : listFilter.add(s);
    b.setAttribute('aria-pressed', listFilter.has(s));
    loadList();
  }));
  loadList();

  $('#needForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true;
    try {
      await api('/needs', { body: {
        user_id: state.user.id, title: $('#nTitle').value, phenomenon: $('#nPh').value, size: $('#nSize').value,
        start_date: $('#nFrom').value, end_date: $('#nUntil').value, neighbourhood: $('#nHood').value, note: $('#nNote').value,
      } });
      toast('Your request is posted.');
      e.target.reset(); $('#nErr').textContent = '';
      updateInfo(); loadList();
    } catch (ex) { $('#nErr').textContent = ex.message; }
    btn.disabled = false;
  });
}

function haveModal(need, reload) {
  const items = state.account.items;
  openModal(`
    <h2>Lend for “${esc(need.title)}”</h2>
    <p class="sub">${esc(need.user_name)} needs it ${fmtRange(need.start_date, need.end_date)}. Pick which of your items you lend. The points move right away.</p>
    ${items.length ? `<div class="field"><label for="hvItem">Your item</label><select id="hvItem">${items.map((i) => `<option value="${i.id}">${esc(i.name)} · ${esc(sizeOf(i.size).name)}</option>`).join('')}</select></div>
      <div class="info" id="hvInfo"></div>` :
      `<div class="info">You have not offered any items yet. <a href="#/offer" class="link-btn">Offer one first</a>, then come back.</div>`}
    <p class="err" id="hvErr"></p>
    <div class="actions">${items.length ? '<button class="btn" type="button" id="hvGo">Lend it</button>' : ''}<button class="btn ghost" value="cancel">Cancel</button></div>`,
  (root, close) => {
    if (!items.length) { root.querySelector('a')?.addEventListener('click', close); return; }
    const days = daysBetween(need.start_date, need.end_date);
    const upd = () => {
      const it = items.find((i) => i.id === +$('#hvItem', root).value);
      $('#hvInfo', root).textContent = `${days} day${days === 1 ? '' : 's'} × ${sizeOf(it.size).points_per_day} = you earn ${ptsLabel(days * sizeOf(it.size).points_per_day)}.`;
    };
    $('#hvItem', root).addEventListener('change', upd); upd();
    $('#hvGo', root).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const loan = await api(`/needs/${need.id}/fulfil`, { body: { user_id: state.user.id, item_id: +$('#hvItem', root).value } });
        close(); await refreshAccount(); reload();
        toast(`Done. You earned ${ptsLabel(loan.points)}.`);
      } catch (ex) { $('#hvErr', root).textContent = ex.message; e.target.disabled = false; }
    });
  });
}

// ---------- Points account ----------
async function renderPoints() {
  await refreshAccount();
  const a = state.account;
  const histTitle = (h) => h.kind === 'welcome' ? 'Welcome points' : h.kind === 'lend' ? `Lent ${esc(h.item_name)}` : h.kind === 'borrow' ? `Borrowed ${esc(h.item_name)}` : 'Adjustment';
  const histSub = (h) => h.kind === 'welcome' ? 'When signing up'
    : `${h.kind === 'lend' ? 'To' : 'From'} ${esc(h.other_name)} · ${h.days} day${h.days === 1 ? '' : 's'} · ${esc(sizeOf(h.size)?.name.toLowerCase() || '')}`;
  const nowOut = a.active.find((l) => l.borrower_id === a.user.id && l.start_date <= isoToday());
  app.innerHTML = `
    <div class="page-head"><h1>My points account</h1></div>
    <div class="balance">
      <div><div class="lbl">BALANCE</div><div class="big">${a.balance}</div></div>
      <div class="parts">
        <div><span>Starting points</span><b>+${a.starting}</b></div>
        <div><span>Earned by lending</span><b>+${a.earned}</b></div>
        <div><span>Spent on borrowing</span><b>−${a.spent}</b></div>
        ${a.reserved ? `<div><span>Reserved by open requests</span><b>${a.reserved}</b></div>` : ''}
      </div>
    </div>
    ${a.incoming.length ? `<h2 class="section-title">Requests for your items</h2>
      ${a.incoming.map((l) => `<div class="pending"><div><h3>${esc(l.borrower_name)} wants your ${esc(l.item_name)}</h3>
        <p>${fmtRange(l.start_date, l.end_date)} · ${l.days} day${l.days === 1 ? '' : 's'} · you earn ${ptsLabel(l.points)}</p></div>
        <div class="actions" style="margin:0"><button class="btn sm" data-accept="${l.id}">Accept</button><button class="btn ghost sm" data-decline="${l.id}">Decline</button></div></div>`).join('')}` : ''}
    ${a.outgoing.length ? `<h2 class="section-title">Your requests waiting for an answer</h2>
      ${a.outgoing.map((l) => `<div class="pending"><div><h3>${esc(l.item_name)} from ${esc(l.lender_name)}</h3>
        <p>${fmtRange(l.start_date, l.end_date)} · ${ptsLabel(l.points)} reserved</p></div>
        <button class="btn ghost sm" data-cancel="${l.id}">Withdraw</button></div>`).join('')}` : ''}
    <div class="two" style="margin-top:28px">
      <section>
        <h2 style="margin-bottom:12px">History</h2>
        ${a.history.map((h) => `<div class="hist"><div><h3>${histTitle(h)}</h3><p>${histSub(h)}</p></div>
          <span class="amt ${h.amount >= 0 ? 'plus' : 'minus'}">${h.amount >= 0 ? '+' : '−'}${Math.abs(h.amount)}</span>
          <span class="after">Balance: ${h.balance_after}</span></div>`).join('')}
      </section>
      <aside class="side">
        <div class="side-card"><h3>How we count</h3>
          <table class="count-table">${state.meta.sizes.map((s) => `<tr><td>${esc(s.name)} (${esc(s.examples)})</td><td>${ptsLabel(s.points_per_day, true)} per day</td></tr>`).join('')}</table>
          <p>The borrower pays, the lender receives the same amount. That keeps the community balanced and nobody only takes.</p></div>
        <div class="side-card soft"><h3>${nowOut ? 'Currently out' : 'Coming up'}</h3>
          <p>${nowOut ? `${esc(nowOut.item_name)} from ${esc(nowOut.lender_name)}, due back on ${fmtDay(nowOut.end_date)}.`
            : a.active[0] ? `${esc(a.active[0].item_name)} ${a.active[0].lender_id === a.user.id ? 'to ' + esc(a.active[0].borrower_name) : 'from ' + esc(a.active[0].lender_name)}, ${fmtRange(a.active[0].start_date, a.active[0].end_date)}.`
            : 'Nothing booked right now.'}</p>
          <a class="btn sm" href="#/calendar" style="margin-top:12px">See my calendar</a></div>
      </aside>
    </div>`;
  const act = (sel, action, msg) => $$(sel).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/loans/${b.dataset[action === 'accept' ? 'accept' : action === 'decline' ? 'decline' : 'cancel']}/${action}`, { body: { user_id: state.user.id } });
      toast(msg); renderPoints();
    } catch (ex) { toast(ex.message); b.disabled = false; }
  }));
  act('[data-accept]', 'accept', 'Accepted. The points are on your account.');
  act('[data-decline]', 'decline', 'Declined.');
  act('[data-cancel]', 'cancel', 'Request withdrawn, points released.');
}

// ---------- Calendar ----------
async function renderCalendar() {
  if (!state.calMonth) {
    // Start on the month of the next booking, or the current month.
    const next = state.account.active[0] || state.account.outgoing[0] || state.account.incoming[0];
    const ref = next && next.start_date > isoToday() ? next.start_date : isoToday();
    state.calMonth = ref.slice(0, 7);
  }
  const [y, mo] = state.calMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
  const gridStart = addDays(`${state.calMonth}-01`, -startOffset);
  const cells = Math.ceil((startOffset + lastDay) / 7) * 7;
  const gridEnd = addDays(gridStart, cells - 1);
  const loans = await api(`/users/${state.user.id}/loans?from=${gridStart}&to=${gridEnd}`);
  const upcoming = (await api(`/users/${state.user.id}/loans?from=${isoToday()}&to=${addDays(isoToday(), 365)}`)).slice(0, 6);
  const shortName = (s) => (s.length > 12 ? s.split(/[ ,]/)[0] : s);
  const evLabel = (l) => l.direction === 'lend' ? `${shortName(l.item_name)} → ${l.borrower_name}` : `${shortName(l.item_name)} ← ${l.lender_name}`;

  let html = '';
  ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((d) => (html += `<div class="dow">${d}</div>`));
  for (let i = 0; i < cells; i++) {
    const d = addDays(gridStart, i);
    const inMonth = d.slice(0, 7) === state.calMonth;
    const evs = loans.filter((l) => l.start_date <= d && l.end_date >= d);
    html += `<div class="day ${inMonth ? '' : 'out'} ${d === isoToday() ? 'today' : ''}"><b>${+d.slice(8)}</b>
      ${evs.map((l) => `<span class="ev ${l.direction} ${l.status === 'pending' ? 'pend' : ''}" title="${esc(l.item_name)} · ${l.status}">${esc(evLabel(l))}</span>`).join('')}</div>`;
  }

  app.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Your loans</div>
      <h1>Calendar view</h1>
      <p class="lead">Upcoming and active loans in one month view, so nobody double-books an item or forgets to give it back.</p>
    </div>
    <div class="two">
      <section>
        <div class="cal-head"><h2>${MONTHS[mo - 1]} ${y}</h2>
          <div class="cal-nav"><button class="round" id="calPrev" aria-label="Previous month">‹</button><button class="round" id="calNext" aria-label="Next month">›</button></div></div>
        <div class="legend"><span><i style="background:var(--lend-bg);border:1px solid var(--lend-ink)"></i>Lending out · earns points</span>
          <span><i style="background:var(--borrow-bg);border:1px solid var(--borrow-ink)"></i>Borrowing · spends points</span>
          <span><i style="border:1px dashed var(--mute)"></i>Waiting for an answer</span></div>
        <div class="cal">${html}</div>
      </section>
      <aside class="side">
        <div class="side-card"><h3>Next up</h3>
          ${upcoming.map((l) => `<div class="next ${l.direction}"><h4>${esc(l.item_name)} ${l.direction === 'lend' ? 'to ' + esc(l.borrower_name) : 'from ' + esc(l.lender_name)}</h4>
            <p>${fmtRange(l.start_date, l.end_date)} · ${esc(sizeOf(l.size).name.toLowerCase())} · ${l.direction === 'lend' ? 'lending out' : 'borrowing'}${l.status === 'pending' ? ' · waiting' : ''}</p>
            <p class="pts" style="color:var(--${l.direction === 'lend' ? 'plus' : 'minus'})">${l.direction === 'lend' ? '+' : '−'}${ptsLabel(l.points)}</p></div>`).join('') || '<p class="muted">Nothing planned yet.</p>'}
        </div>
        <div class="side-card soft"><h3>Why this helps</h3><p>An item that is already promised to someone else cannot be requested for the same days, and everyone sees when it is due back.</p></div>
      </aside>
    </div>`;
  const shift = (n) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); state.calMonth = d.toISOString().slice(0, 7); renderCalendar(); };
  $('#calPrev').addEventListener('click', () => shift(-1));
  $('#calNext').addEventListener('click', () => shift(1));
}

// ---------- start ----------
(async function start() {
  try {
    await loadMeta();
    await refreshAccount();
    render();
  } catch (err) {
    app.innerHTML = `<div class="page-head"><h1>Cannot reach the server</h1><p class="lead">${esc(err.message)}. Is the database set up? See the README.</p></div>`;
  }
})();
