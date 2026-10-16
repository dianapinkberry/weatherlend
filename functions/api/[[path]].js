// Weatherlend API — one Cloudflare Pages Function that answers every /api/* route.
// Storage is Cloudflare D1 (SQLite), bound as env.DB (see wrangler.toml).
//
// Points rules (see README, "Points system"):
//   points of a loan = days (inclusive) × points_per_day of the item's size category
//   on acceptance: borrower −points, lender +points, written as two ledger rows
//   balance = SUM(ledger.amount); new users get one +10 "welcome" row
//   a borrower cannot ask for more than balance − points already reserved by pending requests

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const fail = (message, status = 400) => json({ error: message }, status);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (s) => new Date(s + 'T00:00:00Z');
const daysInclusive = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000) + 1;
const WELCOME_POINTS = 10;

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = (params.path || []).map(decodeURIComponent);
  const method = request.method;
  const url = new URL(request.url);
  try {
    const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const route = `${method} /${path.join('/')}`;
    const db = env.DB;

    // GET /api/meta — everything the forms need: phenomena, sizes, neighbourhoods, demo users
    if (route === 'GET /meta') return json(await meta(db));

    // GET /api/items?phenomena=heat-wave,storm
    if (route === 'GET /items') return json(await listItems(db, url.searchParams.get('phenomena')));
    // POST /api/items — publish an offer
    if (route === 'POST /items') return json(await createItem(db, body), 201);

    // GET /api/needs?phenomena=cold-snap
    if (route === 'GET /needs') return json(await listNeeds(db, url.searchParams.get('phenomena')));
    // POST /api/needs — "I need X from … to …"
    if (route === 'POST /needs') return json(await createNeed(db, body), 201);
    // POST /api/needs/:id/fulfil — owner answers a need with one of their items
    if (method === 'POST' && path[0] === 'needs' && path[2] === 'fulfil') return json(await fulfilNeed(db, +path[1], body), 201);

    // POST /api/loans — borrowing request for an offer
    if (route === 'POST /loans') return json(await requestLoan(db, body), 201);
    // POST /api/loans/:id/accept | decline | cancel
    if (method === 'POST' && path[0] === 'loans' && ['accept', 'decline', 'cancel'].includes(path[2]))
      return json(await decideLoan(db, +path[1], path[2], body));

    // GET /api/users/:id/account — balance, history, pending requests
    if (method === 'GET' && path[0] === 'users' && path[2] === 'account') return json(await account(db, +path[1]));
    // GET /api/users/:id/loans?from=2026-11-01&to=2026-11-30 — calendar
    if (method === 'GET' && path[0] === 'users' && path[2] === 'loans')
      return json(await userLoans(db, +path[1], url.searchParams.get('from'), url.searchParams.get('to')));
    // POST /api/users/:id/notifications — onboarding step 2
    if (method === 'POST' && path[0] === 'users' && path[2] === 'notifications')
      return json(await saveNotifications(db, +path[1], body));
    // POST /api/users — create a demo user (gets the welcome points)
    if (route === 'POST /users') return json(await createUser(db, body), 201);

    return fail('Not found', 404);
  } catch (err) {
    if (err instanceof UserError) return fail(err.message, err.status);
    console.error(err);
    return fail('Something went wrong on the server.', 500);
  }
}

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const need = (cond, message, status) => { if (!cond) throw new UserError(message, status); };

// ---------- reference data ----------

async function meta(db) {
  const [phenomena, sizes, neighbourhoods, users] = await db.batch([
    db.prepare(`SELECT p.id, p.slug, p.name, p.short_name, p.tint, p.ink,
                  (SELECT COUNT(*) FROM item_phenomena ip JOIN items i ON i.id = ip.item_id
                     WHERE ip.phenomenon_id = p.id AND i.active = 1) AS item_count
                FROM phenomena p WHERE p.active = 1 ORDER BY p.sort, p.name`),
    db.prepare('SELECT slug, name, points_per_day, examples FROM size_categories ORDER BY sort'),
    db.prepare('SELECT name FROM neighbourhoods ORDER BY name'),
    db.prepare(`SELECT u.id, u.name, u.neighbourhood, COALESCE(SUM(l.amount), 0) AS balance
                FROM users u LEFT JOIN ledger l ON l.user_id = u.id GROUP BY u.id ORDER BY u.name`),
  ]);
  return {
    phenomena: phenomena.results,
    sizes: sizes.results,
    neighbourhoods: neighbourhoods.results.map((r) => r.name),
    users: users.results,
  };
}

async function sizeMap(db) {
  const { results } = await db.prepare('SELECT slug, points_per_day FROM size_categories').all();
  return Object.fromEntries(results.map((r) => [r.slug, r.points_per_day]));
}

async function phenomenonIds(db, slugsOrIds) {
  if (!Array.isArray(slugsOrIds) || !slugsOrIds.length) return [];
  const { results } = await db.prepare('SELECT id, slug FROM phenomena WHERE active = 1').all();
  const bySlug = new Map(results.map((r) => [r.slug, r.id]));
  const ids = new Set(results.map((r) => r.id));
  return slugsOrIds.map((v) => (ids.has(+v) ? +v : bySlug.get(v))).filter(Boolean);
}

// ---------- items (offers) ----------

const ITEM_SELECT = `
  SELECT i.id, i.name, i.size, s.name AS size_name, s.points_per_day, i.description,
         i.available_from_month, i.available_until_month, i.availability_note,
         i.neighbourhood, i.photo, i.owner_id, u.name AS owner_name, i.created_at,
         (SELECT json_group_array(json_object('id', p.id, 'slug', p.slug, 'short_name', p.short_name,
                                              'tint', p.tint, 'ink', p.ink))
            FROM (SELECT p.* FROM item_phenomena ip JOIN phenomena p ON p.id = ip.phenomenon_id
                  WHERE ip.item_id = i.id ORDER BY ip.sort, p.sort) p) AS phenomena
  FROM items i
  JOIN users u ON u.id = i.owner_id
  JOIN size_categories s ON s.slug = i.size`;

const parseItem = (r) => ({ ...r, phenomena: JSON.parse(r.phenomena || '[]') });

async function listItems(db, phenomenaParam) {
  const slugs = (phenomenaParam || '').split(',').map((s) => s.trim()).filter(Boolean);
  let sql = ITEM_SELECT + ' WHERE i.active = 1';
  const args = [];
  if (slugs.length) {
    // "Pick one or more": an item matches if it belongs to ANY of the picked phenomena.
    sql += ` AND i.id IN (SELECT ip.item_id FROM item_phenomena ip JOIN phenomena p ON p.id = ip.phenomenon_id
                          WHERE p.slug IN (${slugs.map(() => '?').join(',')}))`;
    args.push(...slugs);
  }
  sql += ' ORDER BY (SELECT MIN(p.sort) FROM item_phenomena ip JOIN phenomena p ON p.id = ip.phenomenon_id WHERE ip.item_id = i.id AND ip.sort = 0), i.id';
  const { results } = await db.prepare(sql).bind(...args).all();
  return results.map(parseItem);
}

const month = (v) => (v === null || v === undefined || v === '' ? null : +v);

async function createItem(db, b) {
  const sizes = await sizeMap(db);
  const name = (b.name || '').trim();
  need(name.length >= 2, 'Please give the item a name.');
  need(name.length <= 80, 'The name is too long.');
  need(sizes[b.size], 'Please pick a size category.');
  const owner = await db.prepare('SELECT id, neighbourhood FROM users WHERE id = ?').bind(+b.owner_id).first();
  need(owner, 'Unknown user.');
  const pIds = await phenomenonIds(db, b.phenomena);
  need(pIds.length, 'Pick at least one phenomenon.');
  const from = month(b.available_from_month), until = month(b.available_until_month);
  need((from === null) === (until === null), 'Please give both months, or choose “all year”.');
  need(from === null || (from >= 1 && from <= 12 && until >= 1 && until <= 12), 'Invalid month.');
  if (b.photo) {
    need(typeof b.photo === 'string' && b.photo.startsWith('data:image/'), 'The photo must be an image.');
    need(b.photo.length < 600_000, 'The photo is too large. Please use a smaller picture.');
  }
  const res = await db.prepare(
    `INSERT INTO items (owner_id, name, size, description, available_from_month, available_until_month,
                        availability_note, neighbourhood, photo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(owner.id, name, b.size, (b.description || '').trim() || null, from, until,
         (b.availability_note || '').trim() || null, b.neighbourhood || owner.neighbourhood, b.photo || null).first();
  await db.batch(pIds.map((pid, i) =>
    db.prepare('INSERT INTO item_phenomena (item_id, phenomenon_id, sort) VALUES (?, ?, ?)').bind(res.id, pid, i)));
  const item = await db.prepare(ITEM_SELECT + ' WHERE i.id = ?').bind(res.id).first();
  return parseItem(item);
}

// Is every day of [start, end] inside the item's yearly availability window?
function insideSeason(item, start, end) {
  const f = item.available_from_month, u = item.available_until_month;
  if (f === null || u === null) return true;
  const ok = (m) => (f <= u ? m >= f && m <= u : m >= f || m <= u); // window may wrap over New Year
  for (let d = toDate(start); d <= toDate(end); d = new Date(d.getTime() + 86400000)) {
    if (!ok(d.getUTCMonth() + 1)) return false;
  }
  return true;
}

// ---------- points ----------

async function balance(db, userId) {
  const r = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM ledger WHERE user_id = ?').bind(userId).first();
  return r.b;
}
async function reserved(db, userId) {
  const r = await db.prepare(`SELECT COALESCE(SUM(points), 0) AS p FROM loans WHERE borrower_id = ? AND status = 'pending'`)
    .bind(userId).first();
  return r.p;
}

// ---------- loans ----------

function checkDates(start, end) {
  need(ISO.test(start || '') && ISO.test(end || ''), 'Please choose a start and an end date.');
  need(start <= end, 'The end date must be on or after the start date.');
  const days = daysInclusive(start, end);
  need(days <= 60, 'A loan can last at most 60 days.');
  return days;
}

async function overlapping(db, itemId, start, end, exceptId = 0) {
  return db.prepare(
    `SELECT id, start_date, end_date FROM loans
     WHERE item_id = ? AND id != ? AND status IN ('pending','accepted')
       AND start_date <= ? AND end_date >= ? LIMIT 1`
  ).bind(itemId, exceptId, end, start).first();
}

async function requestLoan(db, b) {
  const days = checkDates(b.start_date, b.end_date);
  const item = await db.prepare(ITEM_SELECT + ' WHERE i.id = ? AND i.active = 1').bind(+b.item_id).first();
  need(item, 'This offer no longer exists.', 404);
  const borrowerId = +b.borrower_id;
  need(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(borrowerId).first(), 'Unknown user.');
  need(item.owner_id !== borrowerId, 'You cannot borrow your own item.');
  need(insideSeason(item, b.start_date, b.end_date), 'The item is not available in that period.');
  const clash = await overlapping(db, item.id, b.start_date, b.end_date);
  need(!clash, `Already promised from ${clash?.start_date} to ${clash?.end_date}. Please pick other days.`, 409);
  const points = days * item.points_per_day;
  const free = (await balance(db, borrowerId)) - (await reserved(db, borrowerId));
  need(points <= free, `This needs ${points} points, you have ${free} available.`, 409);
  const loan = await db.prepare(
    `INSERT INTO loans (item_id, lender_id, borrower_id, start_date, end_date, days, points, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending') RETURNING *`
  ).bind(item.id, item.owner_id, borrowerId, b.start_date, b.end_date, days, points).first();
  return loan;
}

// Moving points = two ledger rows written in one atomic batch together with the status change.
function acceptStatements(db, loan, needId = null) {
  const s = [
    db.prepare(`UPDATE loans SET status = 'accepted', decided_at = datetime('now') WHERE id = ?`).bind(loan.id),
    db.prepare(`INSERT INTO ledger (user_id, amount, kind, loan_id) VALUES (?, ?, 'borrow', ?)`).bind(loan.borrower_id, -loan.points, loan.id),
    db.prepare(`INSERT INTO ledger (user_id, amount, kind, loan_id) VALUES (?, ?, 'lend', ?)`).bind(loan.lender_id, loan.points, loan.id),
  ];
  if (needId) s.push(db.prepare(`UPDATE needs SET status = 'fulfilled' WHERE id = ?`).bind(needId));
  return s;
}

async function decideLoan(db, loanId, action, b) {
  const loan = await db.prepare('SELECT * FROM loans WHERE id = ?').bind(loanId).first();
  need(loan, 'Request not found.', 404);
  need(loan.status === 'pending', 'This request was already answered.', 409);
  const actor = +b.user_id;
  if (action === 'cancel') {
    need(actor === loan.borrower_id, 'Only the borrower can cancel.', 403);
    await db.prepare(`UPDATE loans SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?`).bind(loanId).run();
  } else {
    need(actor === loan.lender_id, 'Only the owner of the item can answer.', 403);
    if (action === 'decline') {
      await db.prepare(`UPDATE loans SET status = 'declined', decided_at = datetime('now') WHERE id = ?`).bind(loanId).run();
    } else {
      // The pending loan already reserved its points, so balance alone must cover it.
      need((await balance(db, loan.borrower_id)) >= loan.points, 'The borrower no longer has enough points.', 409);
      await db.batch(acceptStatements(db, loan));
    }
  }
  return db.prepare('SELECT * FROM loans WHERE id = ?').bind(loanId).first();
}

// ---------- needs (requests) ----------

const NEED_SELECT = `
  SELECT n.*, u.name AS user_name, s.points_per_day,
         p.slug AS phenomenon_slug, p.short_name AS phenomenon_name, p.tint, p.ink,
         (julianday(n.end_date) - julianday(n.start_date) + 1) AS days
  FROM needs n
  JOIN users u ON u.id = n.user_id
  JOIN size_categories s ON s.slug = n.size
  LEFT JOIN phenomena p ON p.id = n.phenomenon_id`;

async function listNeeds(db, phenomenaParam) {
  const slugs = (phenomenaParam || '').split(',').map((s) => s.trim()).filter(Boolean);
  let sql = NEED_SELECT + ` WHERE n.status = 'open'`;
  if (slugs.length) sql += ` AND p.slug IN (${slugs.map(() => '?').join(',')})`;
  sql += ' ORDER BY n.start_date, n.id';
  const { results } = await db.prepare(sql).bind(...slugs).all();
  return results.map((n) => ({ ...n, days: Math.round(n.days), points: Math.round(n.days) * n.points_per_day }));
}

async function createNeed(db, b) {
  const sizes = await sizeMap(db);
  const title = (b.title || '').trim();
  need(title.length >= 2, 'What do you need?');
  need(title.length <= 80, 'Please keep it short.');
  const days = checkDates(b.start_date, b.end_date);
  const size = sizes[b.size] ? b.size : 'small';
  const [pid] = await phenomenonIds(db, [b.phenomenon]);
  need(pid, 'Please pick a phenomenon.');
  const userId = +b.user_id;
  need(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first(), 'Unknown user.');
  const points = days * sizes[size];
  const free = (await balance(db, userId)) - (await reserved(db, userId));
  need(points <= free, `You need ${points} points for the whole period, you have ${free} available.`, 409);
  const r = await db.prepare(
    `INSERT INTO needs (user_id, title, phenomenon_id, size, start_date, end_date, neighbourhood, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(userId, title, pid, size, b.start_date, b.end_date, b.neighbourhood || null, (b.note || '').trim() || null).first();
  return (await listNeeds(db)).find((n) => n.id === r.id);
}

// "I have this": the owner picks one of their items. The requester already asked for exactly
// these days, so the loan is accepted immediately and the points move.
async function fulfilNeed(db, needId, b) {
  const n = await db.prepare('SELECT * FROM needs WHERE id = ?').bind(needId).first();
  need(n && n.status === 'open', 'This request is no longer open.', 409);
  const ownerId = +b.user_id;
  need(ownerId !== n.user_id, 'You cannot answer your own request.');
  const item = await db.prepare(ITEM_SELECT + ' WHERE i.id = ? AND i.active = 1').bind(+b.item_id).first();
  need(item && item.owner_id === ownerId, 'Please pick one of your own items.');
  const clash = await overlapping(db, item.id, n.start_date, n.end_date);
  need(!clash, `Your ${item.name} is already promised from ${clash?.start_date} to ${clash?.end_date}.`, 409);
  const days = daysInclusive(n.start_date, n.end_date);
  const points = days * item.points_per_day;
  const free = (await balance(db, n.user_id)) - (await reserved(db, n.user_id));
  need(points <= free, `The requester has only ${free} points available, this would cost ${points}.`, 409);
  const loan = await db.prepare(
    `INSERT INTO loans (item_id, lender_id, borrower_id, start_date, end_date, days, points, status, need_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?) RETURNING *`
  ).bind(item.id, ownerId, n.user_id, n.start_date, n.end_date, days, points, n.id).first();
  await db.batch(acceptStatements(db, loan, n.id));
  return { ...loan, status: 'accepted' };
}

// ---------- users ----------

const LOAN_SELECT = `
  SELECT l.*, i.name AS item_name, i.size, lu.name AS lender_name, bu.name AS borrower_name
  FROM loans l
  JOIN items i ON i.id = l.item_id
  JOIN users lu ON lu.id = l.lender_id
  JOIN users bu ON bu.id = l.borrower_id`;

async function account(db, userId) {
  const user = await db.prepare('SELECT id, name, neighbourhood FROM users WHERE id = ?').bind(userId).first();
  need(user, 'Unknown user.', 404);
  const [hist, incoming, outgoing, active, items, notify] = await db.batch([
    db.prepare(`SELECT g.id, g.amount, g.kind, g.created_at, l.days, l.start_date, l.end_date,
                       i.name AS item_name, i.size,
                       CASE WHEN g.kind = 'lend' THEN bu.name ELSE lu.name END AS other_name
                FROM ledger g
                LEFT JOIN loans l ON l.id = g.loan_id
                LEFT JOIN items i ON i.id = l.item_id
                LEFT JOIN users lu ON lu.id = l.lender_id
                LEFT JOIN users bu ON bu.id = l.borrower_id
                WHERE g.user_id = ? ORDER BY g.created_at, g.id`).bind(userId),
    db.prepare(LOAN_SELECT + ` WHERE l.lender_id = ? AND l.status = 'pending' ORDER BY l.start_date`).bind(userId),
    db.prepare(LOAN_SELECT + ` WHERE l.borrower_id = ? AND l.status = 'pending' ORDER BY l.start_date`).bind(userId),
    db.prepare(LOAN_SELECT + ` WHERE (l.borrower_id = ? OR l.lender_id = ?) AND l.status = 'accepted'
                               AND l.end_date >= date('now') ORDER BY l.start_date LIMIT 6`).bind(userId, userId),
    db.prepare(`SELECT id, name, size FROM items WHERE owner_id = ? AND active = 1 ORDER BY name`).bind(userId),
    db.prepare(`SELECT p.slug FROM user_phenomena up JOIN phenomena p ON p.id = up.phenomenon_id WHERE up.user_id = ?`).bind(userId),
  ]);
  // Running balance, newest first for display.
  let run = 0;
  const history = hist.results.map((h) => ({ ...h, balance_after: (run += h.amount) })).reverse();
  const sum = (k) => hist.results.filter((h) => h.kind === k).reduce((a, h) => a + h.amount, 0);
  const pendingOut = outgoing.results.reduce((a, l) => a + l.points, 0);
  return {
    user, balance: run, starting: sum('welcome'), earned: sum('lend'), spent: -sum('borrow'),
    reserved: pendingOut, available: run - pendingOut,
    history, incoming: incoming.results, outgoing: outgoing.results, active: active.results,
    items: items.results, notify: notify.results.map((r) => r.slug),
  };
}

async function userLoans(db, userId, from, to) {
  need(ISO.test(from || '') && ISO.test(to || ''), 'from and to dates are required.');
  const { results } = await db.prepare(
    LOAN_SELECT + ` WHERE (l.borrower_id = ? OR l.lender_id = ?) AND l.status IN ('pending','accepted')
                      AND l.start_date <= ? AND l.end_date >= ? ORDER BY l.start_date`
  ).bind(userId, userId, to, from).all();
  return results.map((l) => ({ ...l, direction: l.lender_id === userId ? 'lend' : 'borrow' }));
}

async function saveNotifications(db, userId, b) {
  need(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first(), 'Unknown user.', 404);
  const ids = await phenomenonIds(db, b.phenomena || []);
  await db.batch([
    db.prepare('DELETE FROM user_phenomena WHERE user_id = ?').bind(userId),
    ...ids.map((pid) => db.prepare('INSERT INTO user_phenomena (user_id, phenomenon_id) VALUES (?, ?)').bind(userId, pid)),
  ]);
  return { ok: true, phenomena: b.phenomena || [] };
}

async function createUser(db, b) {
  const name = (b.name || '').trim();
  need(name.length >= 2 && name.length <= 40, 'Please enter a name.');
  const u = await db.prepare('INSERT INTO users (name, neighbourhood) VALUES (?, ?) RETURNING id, name, neighbourhood')
    .bind(name, b.neighbourhood || null).first();
  await db.prepare(`INSERT INTO ledger (user_id, amount, kind) VALUES (?, ?, 'welcome')`).bind(u.id, WELCOME_POINTS).run();
  return { ...u, balance: WELCOME_POINTS };
}
