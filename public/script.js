(() => {
    'use strict';

    const KEY = 'renthub_v1';
    const SESSION_KEY = 'renthub_session';
    const STATUSES = ['Pending', 'In Progress', 'Completed'];

  // ---------- helpers ----------
    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const slug = (s) => s.toLowerCase().replace(/\s+/g, '-');
  const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const nowIso = () => new Date().toISOString();
    const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  // ---------- data layer (localStorage = "database" for this front-end build) ----------
    function seed() {
    return {
        properties: [
        { id: 'P1', name: 'Sunrise Apartments – 2B' },
        { id: 'P2', name: 'Lakeview Villa – 5A' },
        ],
        amenities: [
        { id: 'A1', propertyId: 'P1', name: 'Gym', status: 'Available', open: '06:00', close: '22:00' },
        { id: 'A2', propertyId: 'P1', name: 'Swimming Pool', status: 'Available', open: '07:00', close: '20:00' },
        { id: 'A3', propertyId: 'P2', name: 'Clubhouse', status: 'Available', open: '09:00', close: '23:00' },
        { id: 'A4', propertyId: 'P2', name: 'Tennis Court', status: 'Under Maintenance', open: '06:00', close: '21:00' },
        ],
        maintenance: [
        { id: 'MR-1001', propertyId: 'P1', title: 'Leaking tap', description: 'Kitchen tap drips constantly.',
          status: 'In Progress', createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
            resolvedAt: null, createdBy: 'System' },
        ],
        bookings: [],
        counter: 1001,
    };
    }

    function load() {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : seed();
    } catch {
        return seed();
    }
    }

    let db = load();
    let session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');

    function save() {
    localStorage.setItem(KEY, JSON.stringify(db)); // other tabs receive a "storage" event
    render();
    }

    const propName = (id) => db.properties.find((p) => p.id === id)?.name ?? '—';
    const amenityName = (id) => db.amenities.find((a) => a.id === id)?.name ?? '—';
    const canSeeAll = () => session?.role === 'owner';
    const visible = (list) => list.filter((x) => canSeeAll() || x.propertyId === session.propertyId);

    function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
    }

    function showView(id) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    }

  // ---------- login & dropdowns ----------
    function fillSelects() {
    const props = db.properties.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#login-property').innerHTML = props;
    $('#maint-property').innerHTML = props;
    if (session) {
        $('#maint-property').value = session.propertyId;
      $('#maint-property').disabled = session.role !== 'owner'; // tenants stay on their own property
        $('#book-amenity').innerHTML = db.amenities
        .filter((a) => a.propertyId === session.propertyId)
        .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    }
    }

    function enterApp() {
    fillSelects();
    $('#book-date').min = todayStr();
    $('#user-label').textContent =
        `${session.name} · ${session.role === 'owner' ? 'Owner / Staff' : 'Tenant'} · ${propName(session.propertyId)}`;
    showView('app-view');
    render();
    }

    $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    session = {
        name: $('#login-name').value.trim(),
        role: $('#login-role').value,
        propertyId: $('#login-property').value,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    enterApp();
    });

    $('#logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    session = null;
    showView('login-view');
    });

  // ---------- tabs ----------
    document.querySelector("#register-btn").addEventListener("click", async () => {
    const msg = document.querySelector("#login-msg");

    msg.textContent = "Creating account...";

    try {
    const response = await fetch("/api/register", {
        method: "POST",
        headers: {
        "Content-Type": "application/json"
        },
        body: JSON.stringify({
        name: document.querySelector("#login-name").value.trim(),
        email: document.querySelector("#login-email").value.trim(),
        password: document.querySelector("#login-password").value,
        role: document.querySelector("#login-role").value,
    propertyId: document.querySelector("#login-property").value
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Registration failed");
    }

    msg.textContent = data.message;
    msg.className = "muted";
    } catch (error) {
    console.error("Registration error:", error);
    msg.textContent = error.message;
    msg.className = "error";
    }
});

  // ---------- render ----------
    function render() {
    if (!session) return;
    renderDashboard();
    renderMaintenance();
    renderAmenities();
    renderBookings();
    }

    function bars(items) {
    const max = Math.max(1, ...items.map(([, v]) => v));
    return items.length
        ? items.map(([label, v]) => `
            <div class="bar-row">
            <span>${esc(label)}</span>
            <div class="bar"><div style="width:${(v / max) * 100}%"></div></div>
            <b>${v}</b>
            </div>`).join('')
        : '<p class="muted">No data yet.</p>';
    }

    function countConflicts() {
    let n = 0;
    db.bookings.forEach((a, i) => db.bookings.forEach((b, j) => {
        if (j > i && a.amenityId === b.amenityId && a.date === b.date &&
            toMin(a.checkIn) < toMin(b.checkOut) && toMin(a.checkOut) > toMin(b.checkIn)) n++;
    }));
    return n;
    }

    function renderDashboard() {
    const reqs = visible(db.maintenance);
    const bookings = visible(db.bookings);
    const done = reqs.filter((r) => r.status === 'Completed');
    const rate = reqs.length ? Math.round((done.length / reqs.length) * 100) : 0;
    const avgHrs = done.length
        ? done.reduce((s, r) => s + (new Date(r.resolvedAt) - new Date(r.createdAt)), 0) / done.length / 36e5
        : 0;

    const kpis = [
        ['Open requests', reqs.length - done.length],
        ['Completion rate', `${rate}%`],
        ['Avg resolution', `${avgHrs.toFixed(1)} h`],
        ["Today's bookings", bookings.filter((b) => b.date === todayStr()).length],
        ['Booking conflicts', countConflicts()],
    ];
    $('#kpi-grid').innerHTML = kpis.map(([label, val]) =>
        `<div class="kpi"><span>${label}</span><strong>${val}</strong></div>`).join('');

    $('#maint-chart').innerHTML = bars(STATUSES.map((s) => [s, reqs.filter((r) => r.status === s).length]));
    $('#amenity-chart').innerHTML = bars(
        visible(db.amenities).map((a) => [a.name, bookings.filter((b) => b.amenityId === a.id).length]));
    }

  // ----- maintenance -----
    function renderMaintenance() {
    const filter = $('#maint-filter').value;
    const rows = visible(db.maintenance)
        .filter((r) => filter === 'all' || r.status === filter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    $('#maint-body').innerHTML = rows.length ? rows.map((r) => `
        <tr>
        <td>${r.id}</td>
        <td>${esc(propName(r.propertyId))}</td>
        <td><strong>${esc(r.title)}</strong><br><span class="muted">${esc(r.description)}</span></td>
        <td><span class="badge ${slug(r.status)}">${r.status}</span></td>
        <td>${fmt(r.createdAt)}</td>
        <td>${fmt(r.resolvedAt)}</td>
        <td>${canSeeAll()
            ? `<select data-req="${r.id}">${STATUSES.map((s) =>
                `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
            : '—'}</td>
        </tr>`).join('')
        : '<tr><td colspan="7" class="muted">No requests found.</td></tr>';
    }

    $('#maint-filter').addEventListener('change', renderMaintenance);

    $('#maint-body').addEventListener('change', (e) => {
    const id = e.target.dataset.req;
    if (!id) return;
    db = load();
    const r = db.maintenance.find((x) => x.id === id);
    if (!r) return;
    r.status = e.target.value;
    r.resolvedAt = r.status === 'Completed' ? nowIso() : null;
    save();
    toast(`${id} → ${r.status}`);
    });

    $('#maint-form').addEventListener('submit', (e) => {
    e.preventDefault();
    db = load();
    db.counter += 1;
    db.maintenance.push({
        id: `MR-${db.counter}`,
        propertyId: $('#maint-property').value,
        title: $('#maint-title').value.trim(),
        description: $('#maint-desc').value.trim(),
        status: 'Pending',
        createdAt: nowIso(),
        resolvedAt: null,
        createdBy: session.name,
    });
    const id = db.maintenance.at(-1).id;
    e.target.reset();
    fillSelects();
    save();
    toast(`Request ${id} submitted`);
    });

  // ----- amenities -----
    function renderAmenities() {
    const today = todayStr();
    $('#amenity-list').innerHTML = db.amenities
        .filter((a) => a.propertyId === session.propertyId)
        .map((a) => {
        const n = db.bookings.filter((b) => b.amenityId === a.id && b.date === today).length;
        return `
            <div class="amenity">
            <div><strong>${esc(a.name)}</strong><br><span class="muted">Open ${a.open}–${a.close}</span></div>
            <div>
                <span class="badge ${a.status === 'Available' ? 'completed' : 'pending'}">${a.status}</span>
                <div class="muted">${n} booking(s) today</div>
                ${canSeeAll() ? `<button class="btn small" data-toggle="${a.id}">Toggle availability</button>` : ''}
            </div>
            </div>`;
        }).join('');
    }

    $('#amenity-list').addEventListener('click', (e) => {
    const id = e.target.dataset.toggle;
    if (!id) return;
    db = load();
    const a = db.amenities.find((x) => x.id === id);
    if (!a) return;
    a.status = a.status === 'Available' ? 'Under Maintenance' : 'Available';
    save();
    toast(`${a.name}: ${a.status}`);
    });

    function validateBooking(amenity, date, checkIn, checkOut) {
    if (!amenity) return 'Please choose an amenity.';
    if (amenity.status !== 'Available') return `${amenity.name} is under maintenance right now.`;
    if (!date || date < todayStr()) return 'Please pick today or a future date.';
    if (!checkIn || !checkOut || toMin(checkOut) <= toMin(checkIn)) return 'Check-out must be after check-in.';
    if (toMin(checkIn) < toMin(amenity.open) || toMin(checkOut) > toMin(amenity.close))
        return `${amenity.name} is open ${amenity.open}–${amenity.close}.`;
    const clash = db.bookings.find((b) =>
        b.amenityId === amenity.id && b.date === date &&
        toMin(checkIn) < toMin(b.checkOut) && toMin(checkOut) > toMin(b.checkIn));
    if (clash) return `Conflict: ${amenity.name} is booked ${clash.checkIn}–${clash.checkOut} (${clash.id}).`;
    return null;
    }

    $('#booking-form').addEventListener('submit', (e) => {
    e.preventDefault();
    db = load(); // re-read latest data so a booking made in another tab is respected
    const amenity = db.amenities.find((a) => a.id === $('#book-amenity').value);
    const date = $('#book-date').value;
    const checkIn = $('#book-in').value;
    const checkOut = $('#book-out').value;
    const msg = $('#book-msg');

    const error = validateBooking(amenity, date, checkIn, checkOut);
    if (error) {
        msg.textContent = error;
        msg.className = 'error';
        return;
    }

    db.counter += 1;
    db.bookings.push({
        id: `BK-${db.counter}`,
        amenityId: amenity.id,
        propertyId: amenity.propertyId,
        bookedBy: session.name,
        date, checkIn, checkOut,
        state: 'Booked',
        checkedInAt: null,
        checkedOutAt: null,
    });
    msg.textContent = '';
    msg.className = 'muted';
    e.target.reset();
    fillSelects();
    save();
    toast('Booking confirmed');
    });

  // ----- bookings table -----
    function renderBookings() {
    const rows = visible(db.bookings).sort((a, b) => (a.date + a.checkIn).localeCompare(b.date + b.checkIn));

    $('#booking-body').innerHTML = rows.length ? rows.map((b) => {
        const action =
        b.state === 'Booked' ? `<button class="btn small" data-act="in" data-id="${b.id}">Check in</button>`
        : b.state === 'Checked In' ? `<button class="btn small" data-act="out" data-id="${b.id}">Check out</button>`
        : '<span class="muted">Done</span>';
        return `
        <tr>
            <td>${esc(amenityName(b.amenityId))}</td>
            <td>${esc(propName(b.propertyId))}</td>
            <td>${esc(b.bookedBy)}</td>
            <td>${b.date}</td>
            <td>${b.checkIn}${b.checkedInAt ? `<br><span class="muted">${fmt(b.checkedInAt)}</span>` : ''}</td>
            <td>${b.checkOut}${b.checkedOutAt ? `<br><span class="muted">${fmt(b.checkedOutAt)}</span>` : ''}</td>
            <td><span class="badge ${slug(b.state)}">${b.state}</span></td>
            <td>${action}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="8" class="muted">No bookings yet.</td></tr>';
    }

    $('#booking-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    db = load();
    const b = db.bookings.find((x) => x.id === btn.dataset.id);
    if (!b) return;

    if (btn.dataset.act === 'in') {
        if (b.date !== todayStr()) return toast('Check-in opens on the booking date');
        b.state = 'Checked In';
        b.checkedInAt = nowIso();
    } else {
        b.state = 'Checked Out';
        b.checkedOutAt = nowIso();
    }
    save();
    toast(`${b.id}: ${b.state}`);
    });

  // ---------- real-time sync across open tabs/windows ----------
    window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    db = load();
    if (session) {
        render();
        const live = $('#live-indicator');
        live.classList.remove('flash');
      void live.offsetWidth; // restart the animation
        live.classList.add('flash');
    }
    });

  // ---------- start ----------
    fillSelects();
    if (session) enterApp();
    else showView('login-view');
})();