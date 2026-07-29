const API = '/api/admin';
let API_KEY = sessionStorage.getItem('race_api_key') || '';
let HEADERS = { 'Content-Type': 'application/json', 'x-api-key': API_KEY };

let activeProject = null;
let editingStationId = null;
let editingStationIdx = null;
let editingRouteTeamId = null;

// ─── Login ─────────────────────────────────────────────────────────────────

window.onload = () => {
  if (API_KEY) {
    showApp();
  }
  // login screen is shown by default (display:flex in HTML)
};

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) return;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    const { token } = await res.json();
    API_KEY = token;
    HEADERS = { 'Content-Type': 'application/json', 'x-api-key': API_KEY };
    sessionStorage.setItem('race_api_key', API_KEY);
    showApp();
  } else {
    document.getElementById('login-error').style.display = 'block';
  }
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadProjects();
}

function doLogout() {
  sessionStorage.removeItem('race_api_key');
  API_KEY = '';
  location.reload();
}

// ─── Init ──────────────────────────────────────────────────────────────────

// ─── API helpers ───────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Error: ${err.detail || res.statusText}`);
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ─── Projects ──────────────────────────────────────────────────────────────

async function loadProjects() {
  const projects = await api('GET', '/projects');
  renderSidebar(projects);
  if (projects.length) selectProject(projects[0].id);
}

function renderSidebar(projects) {
  const list = document.getElementById('proj-list');
  list.innerHTML = projects.map(p => `
    <div class="proj-item ${activeProject?.id === p.id ? 'active' : ''}"
         onclick="selectProject('${p.id}')">
      <span class="proj-item-name">${p.name}</span>
      <span class="proj-badge ${p.status}">${p.status}</span>
      <button class="proj-delete-btn" onclick="event.stopPropagation();deleteProject('${p.id}','${p.name.replace(/'/g,"\\'")}')">✕</button>
    </div>
  `).join('');
}

async function selectProject(id) {
  const p = await api('GET', `/projects/${id}`);
  activeProject = p;
  renderSidebar(await api('GET', '/projects'));
  renderTopbar(p);
  renderContent(p);
}

async function deleteProject(id, name) {
  if (!confirm(`Delete "${name}"? This will permanently remove all stations, teams and logs. This cannot be undone.`)) return;
  await api('DELETE', `/projects/${id}`);
  if (activeProject?.id === id) {
    activeProject = null;
    document.getElementById('main-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏁</div>
        <div class="empty-state-text">Select or create a project to get started</div>
      </div>`;
    document.getElementById('race-badge').style.display = 'none';
    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('live-btn').style.display = 'none';
    document.getElementById('main-title').textContent = 'Select a project';
    document.getElementById('main-sub').textContent = '—';
  }
  renderSidebar(await api('GET', '/projects'));
}

function renderTopbar(p) {
  document.getElementById('main-title').textContent = p.name;
  document.getElementById('main-sub').textContent =
    `${p.org} · ${p.event_date} · ${p.team_count || p.teams?.length || 0} teams`;

  const badge = document.getElementById('race-badge');
  badge.style.display = '';
  badge.className = `badge badge-${p.status}`;
  badge.textContent = p.status === 'live' ? 'Race live'
    : p.status === 'done' ? 'Completed' : 'Draft';

  document.getElementById('start-btn').style.display = '';
  document.getElementById('start-label').textContent =
    p.status === 'live' ? 'End race' : 'Start race';
  document.getElementById('start-btn').className =
    `btn btn-sm ${p.status === 'live' ? 'btn-red' : 'btn-green'}`;
  document.getElementById('live-btn').style.display = '';
}

async function createProject() {
  const name = document.getElementById('np-name').value.trim();
  if (!name) { alert('Please enter a project name'); return; }

  await api('POST', '/projects', {
    name,
    org: document.getElementById('np-org').value.trim(),
    event_date: document.getElementById('np-date').value.trim(),
    team_count: parseInt(document.getElementById('np-teams').value) || 4,
  });

  closeModal('modal-newproj');
  ['np-name','np-org','np-date'].forEach(id => document.getElementById(id).value = '');
  await loadProjects();
}

async function toggleRace() {
  if (!activeProject) return;
  if (activeProject.status === 'live') {
    if (!confirm('End the race for all teams?')) return;
    await api('POST', `/projects/${activeProject.id}/end`);
  } else {
    if (!confirm('Start the race? Missions will be sent to all teams immediately.')) return;
    await api('POST', `/projects/${activeProject.id}/start`);
  }
  await selectProject(activeProject.id);
}

function openLive() {
  const id = activeProject?.id;
  window.open(id ? `/live/${id}` : '/live', '_blank');
}

// ─── Main content ──────────────────────────────────────────────────────────

function renderContent(p) {
  document.getElementById('main-content').innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn active" onclick="showTab('overview', this)">Overview</button>
      <button class="tab-btn" onclick="showTab('stations', this)">Stations</button>
      <button class="tab-btn" onclick="showTab('routes', this)">Routes</button>
      <button class="tab-btn" onclick="showTab('teams', this)">Teams</button>
      <button class="tab-btn" onclick="showTab('scoring', this)">Scoring</button>
      <button class="tab-btn" onclick="showTab('photos', this)">📸 Photos</button>
      <button class="tab-btn" onclick="showTab('logs', this)">Activity log</button>
    </div>
    <div id="tab-overview" class="tab-pane active">${renderOverview(p)}</div>
    <div id="tab-stations" class="tab-pane">${renderStations(p)}</div>
    <div id="tab-routes" class="tab-pane">${renderRoutes(p)}</div>
    <div id="tab-teams" class="tab-pane">${renderTeams(p)}</div>
    <div id="tab-scoring" class="tab-pane">${renderScoring(p)}</div>
    <div id="tab-photos" class="tab-pane">${renderPhotos(p)}</div>
    <div id="tab-logs" class="tab-pane"><div id="logs-content">Loading...</div></div>
  `;
  updateFormula();
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`tab-${id}`).classList.add('active');
  if (id === 'logs') loadLogs();
}

// ─── Overview ──────────────────────────────────────────────────────────────

function renderOverview(p) {
  const totalStages = (p.teams || []).reduce((s, t) => s + t.stages_done, 0);
  const totalWrong = (p.teams || []).reduce((s, t) => s + t.wrong_count, 0);
  const sorted = [...(p.teams || [])].sort((a, b) =>
    b.stages_done - a.stages_done || a.penalty_mins - b.penalty_mins
  );
  const medals = ['🥇', '🥈', '🥉'];

  return `
    <div class="metrics">
      <div class="metric">
        <div class="metric-val">${(p.stations || []).length}</div>
        <div class="metric-lbl">Stations</div>
      </div>
      <div class="metric">
        <div class="metric-val">${(p.teams || []).length}</div>
        <div class="metric-lbl">Teams</div>
      </div>
      <div class="metric">
        <div class="metric-val">${totalStages}</div>
        <div class="metric-lbl">Stages cleared</div>
      </div>
      <div class="metric">
        <div class="metric-val">${totalWrong}</div>
        <div class="metric-lbl">Wrong answers</div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn btn-sm" onclick="openModal('modal-broadcast')">
        <i class="ti ti-speakerphone"></i> Broadcast
      </button>
    </div>

    ${sorted.length ? `
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Team</th><th>Leader</th>
            <th>Progress</th><th>Wrong</th><th>Penalty</th>
            <th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((t, i) => `
            <tr>
              <td style="font-family:var(--font-hand);font-size:16px">
                ${medals[i] || `#${i + 1}`}
              </td>
              <td style="font-family:var(--font-hand);font-size:16px">${t.name}</td>
              <td style="color:var(--tan-dark)">${t.leader_name}</td>
              <td style="min-width:120px">
                <div style="font-size:12px">${t.stages_done} / ${(p.stations||[]).length}</div>
                <div class="prog-bg">
                  <div class="prog-fill" style="width:${(p.stations||[]).length ? Math.round(t.stages_done / (p.stations||[]).length * 100) : 0}%"></div>
                </div>
              </td>
              <td style="color:var(--red);font-family:var(--font-hand);font-size:16px">${t.wrong_count}</td>
              <td style="font-family:monospace;font-size:12px">+${t.penalty_mins}min</td>
              <td><span class="badge badge-${p.status === 'live' ? 'live' : 'draft'}">${t.status}</span></td>
              <td style="display:flex;gap:6px">
                <button class="btn btn-sm" onclick="openPenalty('${t.id}','${t.name}')">
                  <i class="ti ti-alert-triangle"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <div class="empty-state-icon">👥</div>
      <div class="empty-state-text">No teams yet — add them in the Teams tab</div>
    </div>`}
  `;
}

// ─── Stations ──────────────────────────────────────────────────────────────

function renderStations(p) {
  const stations = p.stations || [];
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-family:var(--font-hand);font-size:18px">${stations.length} station${stations.length !== 1 ? 's' : ''}</div>
      <button class="btn btn-primary btn-sm" onclick="openAddStation()">
        <i class="ti ti-plus"></i> Add station
      </button>
    </div>
    ${stations.length ? stations.map((s, i) => `
      <div class="station-row">
        <div class="station-num">${s.station_code}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
            <span class="station-name">${s.name}</span>
            <span class="type-pill tp-${s.mission_type}">${s.mission_type}</span>
            ${s.photo_required ? '<span class="type-pill" style="background:#fdf4ff;color:#7e22ce">📸 photo</span>' : ''}
            ${s.chain_clue ? '<span class="type-pill" style="background:#fff7ed;color:#c2410c">🔗 chain</span>' : ''}
            ${s.is_final ? '<span class="type-pill" style="background:#f0fdf4;color:#15803d">📌 final</span>' : ''}
          </div>
          <div class="station-detail">${s.clue_text}</div>
          <div style="margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--tan-dark)">
              Answer: <strong style="color:var(--dark)">${s.answer}</strong>
            </span>
            <span style="font-size:11px;background:var(--cream-dark);padding:1px 6px;border-radius:4px">
              Hint −${s.hint_cost}pts
            </span>
            <span style="font-size:11px;background:var(--cream-dark);padding:1px 6px;border-radius:4px">
              Reveal −${s.answer_cost}pts
            </span>
          </div>
        </div>
        <button class="btn btn-sm" onclick="openEditStation('${s.id}', ${i})">
          <i class="ti ti-edit"></i>
        </button>
      </div>
    `).join('') : `
    <div class="empty-state">
      <div class="empty-state-icon">📍</div>
      <div class="empty-state-text">No stations yet</div>
      <button class="btn btn-primary" onclick="openAddStation()">
        <i class="ti ti-plus"></i> Add first station
      </button>
    </div>`}
  `;
}

// ─── Routes ────────────────────────────────────────────────────────────────

function renderRoutes(p) {
  const teams = p.teams || [];
  const stations = p.stations || [];
  if (!teams.length || !stations.length) {
    return `<div class="empty-state">
      <div class="empty-state-icon">🗺️</div>
      <div class="empty-state-text">Add stations and teams first</div>
    </div>`;
  }

  return `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="shuffleRoutes()">
        <i class="ti ti-arrows-shuffle"></i> Auto-shuffle all routes
      </button>
    </div>
    ${teams.map(t => {
      const route = t.route || stations.map(s => s.station_code);
      return `
        <div class="card" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-family:var(--font-hand);font-size:17px">${t.name}</div>
            <button class="btn btn-sm" onclick="openEditRoute('${t.id}')">
              <i class="ti ti-route"></i> Edit route
            </button>
          </div>
          <div class="route-pills">
            ${route.map((code, i) => {
              const cls = i < t.stages_done ? 'done'
                : i === t.stages_done && p.status === 'live' ? 'cur' : '';
              return `<span class="rp ${cls}">${code}</span>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}

// ─── Route editing ─────────────────────────────────────────────────────────

function openEditRoute(teamId) {
  const team = activeProject.teams.find(t => t.id === teamId);
  const stations = activeProject.stations || [];
  editingRouteTeamId = teamId;
  document.getElementById('route-modal-title').textContent = `Route — ${team.name}`;

  const route = (team.route && team.route.length) ? team.route : stations.map(s => s.station_code);
  // Build ordered list from route, appending any stations not yet in route
  const inRoute = new Set(route);
  const ordered = [...route, ...stations.map(s => s.station_code).filter(c => !inRoute.has(c))];

  const list = document.getElementById('route-drag-list');
  list.innerHTML = '';
  ordered.forEach(code => {
    const st = stations.find(s => s.station_code === code);
    const item = document.createElement('div');
    item.className = 'route-drag-item';
    item.draggable = true;
    item.dataset.code = code;
    item.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="rp" style="margin:0 8px">${code}</span>
      <span style="flex:1;font-size:13px;color:var(--dark-mid)">${st ? st.name : ''}</span>
      <div style="display:flex;gap:4px">
        <button type="button" onclick="moveRouteItem(this,-1)" style="border:none;background:none;cursor:pointer;color:var(--dark-mid);font-size:16px;line-height:1">↑</button>
        <button type="button" onclick="moveRouteItem(this,1)" style="border:none;background:none;cursor:pointer;color:var(--dark-mid);font-size:16px;line-height:1">↓</button>
      </div>`;
    // drag-and-drop events
    item.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = list.querySelector('.dragging');
      if (dragging && dragging !== item) {
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) list.insertBefore(dragging, item);
        else list.insertBefore(dragging, item.nextSibling);
      }
    });
    list.appendChild(item);
  });

  openModal('modal-route');
}

function moveRouteItem(btn, dir) {
  const item = btn.closest('.route-drag-item');
  const list = item.parentElement;
  if (dir === -1 && item.previousSibling) list.insertBefore(item, item.previousSibling);
  if (dir === 1 && item.nextSibling) list.insertBefore(item.nextSibling, item);
}

async function saveRoute() {
  const list = document.getElementById('route-drag-list');
  const route = Array.from(list.querySelectorAll('.route-drag-item')).map(el => el.dataset.code);
  await api('PATCH', `/projects/${activeProject.id}/teams/${editingRouteTeamId}/route`, { route });
  closeModal('modal-route');
  await selectProject(activeProject.id);
  showTab('routes', document.querySelectorAll('.tab-btn')[2]);
}

// ─── Photos ────────────────────────────────────────────────────────────────

function renderPhotos(p) {
  const photos = p.photo_submissions || [];
  if (!photos.length) {
    return `<div class="empty-state">
      <div class="empty-state-icon">📸</div>
      <div class="empty-state-text">No photos submitted yet</div>
    </div>`;
  }
  return `
    <div style="font-family:var(--font-hand);font-size:18px;margin-bottom:16px">${photos.length} photo${photos.length !== 1 ? 's' : ''} submitted</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
      ${photos.map(ph => {
        const isCloudinary = ph.photo_url && ph.photo_url.includes('cloudinary.com');
        const imgSrc = isCloudinary
          ? ph.photo_url
          : `${API}/media-proxy?url=${encodeURIComponent(ph.photo_url)}&key=${encodeURIComponent(API_KEY)}`;
        return `
        <div style="background:var(--cream);border:1px solid var(--tan);border-radius:10px;overflow:hidden">
          <a href="${imgSrc}" target="_blank">
            <img src="${imgSrc}" style="width:100%;height:160px;object-fit:cover;display:block"
                 onerror="this.style.display='none';this.nextSibling.style.display='flex'"
                 onloadstart="this.setAttribute('headers','x-api-key: ${API_KEY}')">
          </a>
          <div style="padding:8px 10px">
            <div style="font-family:var(--font-hand);font-size:15px">${ph.team_name}</div>
            <div style="font-size:11px;color:var(--tan-dark)">Station ${ph.station_code}</div>
          </div>
        </div>`}).join('')}
    </div>`;
}

// ─── Teams ─────────────────────────────────────────────────────────────────

function renderTeams(p) {
  const teams = p.teams || [];
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-family:var(--font-hand);font-size:18px">${teams.length} team${teams.length !== 1 ? 's' : ''}</div>
      <button class="btn btn-primary btn-sm" onclick="openModal('modal-team')">
        <i class="ti ti-plus"></i> Add team
      </button>
    </div>
    ${teams.length ? `
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Team name</th><th>Leader</th><th>Mobile</th>
            <th>WhatsApp</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${teams.map(t => `
            <tr>
              <td style="font-family:var(--font-hand);font-size:16px">${t.name}</td>
              <td>${t.leader_name}</td>
              <td style="font-family:monospace;font-size:12px">${t.mobile}</td>
              <td style="font-family:monospace;font-size:12px">${t.group_number}</td>
              <td><span class="badge badge-${t.status === 'racing' ? 'live' : 'draft'}">${t.status}</span></td>
              <td>
                <button class="btn btn-sm btn-red" onclick="deleteTeam('${t.id}')">
                  <i class="ti ti-trash"></i>
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <div class="empty-state-icon">👥</div>
      <div class="empty-state-text">No teams yet</div>
    </div>`}
  `;
}

// ─── Scoring ───────────────────────────────────────────────────────────────

function openGuide() {
  const content = document.getElementById('guide-scroll-content');
  if (content) content.innerHTML = buildGuideHTML();
  document.getElementById('modal-guide').classList.add('open');
}

function closeGuideOnBg(e) {
  if (e.target.id === 'modal-guide') closeModal('modal-guide');
}

function buildGuideHTML() {
  const sections = [
    {
      title: 'Race & Run',
      body: `
        <div style="text-align:center;padding:28px 0 16px;">
          <div style="font-size:42px;margin-bottom:10px;">🏁</div>
          <div style="font-family:var(--font-hand);font-size:28px;color:var(--dark);margin-bottom:6px;font-style:italic;">Race & Run!</div>
          <div style="font-size:13px;color:var(--dark-mid);margin-bottom:20px;">WhatsApp Amazing Race — Race Master Guide</div>
          <div style="display:inline-block;background:var(--red);color:#fff;border-radius:6px;padding:8px 20px;font-size:12px;font-weight:600;">caretree-leader.onrender.com</div>
        </div>`
    },
    {
      title: 'What is Race & Run?',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div class="guide-card blue-card"><div class="guide-icon">📱</div><div class="guide-card-title">WhatsApp-native</div><p>Teams play entirely via WhatsApp. No app download, no login — just message the bot.</p></div>
          <div class="guide-card green-card"><div class="guide-icon">🗺️</div><div class="guide-card-title">Multi-station race</div><p>Set up stations around any venue. Each team gets a shuffled route so no two teams clash.</p></div>
          <div class="guide-card yellow-card"><div class="guide-icon">📊</div><div class="guide-card-title">Live race view</div><p>Watch all players in real time. Send messages, apply penalties and view the activity feed.</p></div>
        </div>
        <div class="guide-info-box">You set up stations + teams → click Start → bot sends first mission to each team → teams race by replying with answers → leaderboard updates live.</div>`
    },
    {
      title: 'Getting Started',
      body: `
        <div class="guide-url-box">https://caretree-leader.onrender.com</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
          <div class="guide-card"><div class="guide-num">1</div><div class="guide-card-title">Create a Project</div><p>Click "+ New project" in the left sidebar. Enter race name, organisation, date and number of teams.</p></div>
          <div class="guide-card"><div class="guide-num">2</div><div class="guide-card-title">Add Stations</div><p>Go to Stations tab → Add station. Set ID, name, mission type, clue, correct answer and hint.</p></div>
          <div class="guide-card"><div class="guide-num">3</div><div class="guide-card-title">Add Teams</div><p>Go to Teams tab → Add team. Enter team name, leader name and WhatsApp number e.g. +6590687455</p></div>
          <div class="guide-card"><div class="guide-num">4</div><div class="guide-card-title">Start the Race</div><p>Click "Start race" at top right. Routes auto-shuffle and first mission is sent to all teams instantly!</p></div>
        </div>`
    },
    {
      title: 'Station Mission Types',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="guide-card" style="border-top:3px solid var(--blue-stripe);background:#f0f6fa;">
            <div class="guide-card-title" style="color:#1a5a8a;">📝 Text clue</div>
            <p>Bot sends a text clue. Team reads it, finds the answer and types it back.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. "What year is inscribed on the heritage wall near Gate 3?"</p>
          </div>
          <div class="guide-card" style="border-top:3px solid var(--green);background:var(--green-light);">
            <div class="guide-card-title" style="color:var(--green);">🖼️ Image clue</div>
            <p>Bot sends a photo. Team identifies what's in the image and replies.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. Photo of a landmark — team types the name</p>
          </div>
          <div class="guide-card" style="border-top:3px solid var(--yellow);background:var(--yellow-light);">
            <div class="guide-card-title" style="color:#7a6010;">📍 GPS location</div>
            <p>Bot sends a location pin. Team walks there and sends their live location.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. Navigate to 1.2647°N, 103.8220°E — verified within 50m</p>
          </div>
        </div>
        <p style="font-size:10px;color:var(--tan-dark);margin-top:8px;font-style:italic;">📸 Photo required toggle: any station type can also require a team selfie before answering</p>`
    },
    {
      title: 'How Teams Play',
      body: `
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;">
          <div style="background:#e8f5e9;border-radius:8px;padding:12px;font-size:11px;">
            <div style="font-size:9px;font-weight:700;color:var(--tan-dark);margin-bottom:4px;">BOT</div>
            <div class="guide-chat-msg">🏁 Race has begun!<br><br>Team HabisBalik, here is your first mission:<br><br><strong>Station C — Waterfront Landmark</strong><br>Identify the landmark shown in the photo.<br><br>Reply with your answer.<br>Type /hint for a clue (-5 pts)<br>Type /answer to reveal it (-20 pts)</div>
            <div class="guide-chat-reply">maritime singapore</div>
            <div class="guide-chat-msg">✅ Correct! Station C cleared!<br>Stages done: 1 / 5<br><br>Here comes your next mission 👇</div>
            <div class="guide-chat-reply">/hint</div>
            <div class="guide-chat-msg">💡 Hint for Station A (-5 pts deducted)<br><br>It starts with G and is above eye level.</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--dark);margin-bottom:8px;">Team commands</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/hint</span><span style="font-size:11px;">Get a hint (-5 pts)</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/answer</span><span style="font-size:11px;">Reveal answer (-20 pts)</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/status</span><span style="font-size:11px;">See your current score</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/leaderboard</span><span style="font-size:11px;">See live rankings</span></div>
            </div>
            <div style="margin-top:12px;background:var(--green-light);border:1px solid var(--green);border-radius:7px;padding:10px 12px;font-size:10px;color:#2a6b3a;line-height:1.5;"><strong>Teams never need to install anything.</strong> Just WhatsApp — they text the bot like a normal chat.</div>
          </div>
        </div>`
    },
    {
      title: 'Scoring System',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div class="guide-card green-card" style="text-align:center;"><div style="font-size:24px;font-weight:700;color:var(--green);">+100</div><div class="guide-card-title">Per station cleared</div><p>Base points awarded for completing each station correctly.</p></div>
          <div class="guide-card" style="border-top:3px solid var(--red);text-align:center;"><div style="font-size:24px;font-weight:700;color:var(--red);">−10</div><div class="guide-card-title">Wrong answer</div><p>Each incorrect attempt deducts points and adds +5 min time penalty.</p></div>
          <div class="guide-card yellow-card" style="text-align:center;"><div style="font-size:24px;font-weight:700;color:#7a6010;">−5 / −20</div><div class="guide-card-title">Hint / Reveal</div><p>/hint costs 5 pts. Revealing the full answer costs 20 pts.</p></div>
        </div>
        <div class="guide-info-box">Tiebreaker: if two teams have equal points, the team with the faster finish time (minus penalty minutes) wins. All values are editable in the Scoring tab.</div>`
    },
    {
      title: 'Race Master Controls',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="guide-card"><div class="guide-icon">📢</div><div class="guide-card-title">Broadcast</div><p>Send a WhatsApp message to ALL teams at once — announcements, reminders, hints.</p><div class="guide-tag">Overview tab</div></div>
          <div class="guide-card"><div class="guide-icon">⚠️</div><div class="guide-card-title">Manual penalty</div><p>Apply a custom point deduction or time addition to any team for rule violations.</p><div class="guide-tag">Overview tab</div></div>
          <div class="guide-card"><div class="guide-icon">🔀</div><div class="guide-card-title">Shuffle routes</div><p>Randomise station order for all teams so no two teams visit the same spot at once.</p><div class="guide-tag">Routes tab</div></div>
          <div class="guide-card"><div class="guide-icon">📋</div><div class="guide-card-title">Activity log</div><p>View every event — correct answers, wrong attempts, hints, penalties — in real time.</p><div class="guide-tag">Activity log tab</div></div>
          <div class="guide-card"><div class="guide-icon">🏁</div><div class="guide-card-title">End race</div><p>Lock all scores, mark remaining teams as finished, trigger final leaderboard.</p><div class="guide-tag">Top right button</div></div>
          <div class="guide-card"><div class="guide-icon">🌐</div><div class="guide-card-title">Live view</div><p>Share the public leaderboard URL with spectators — updates every 30 seconds.</p><div class="guide-tag">/live link</div></div>
        </div>`
    },
    {
      title: 'Pre-Race Checklist',
      body: `
        <div style="background:#fff;border:1px solid var(--tan);border-radius:8px;padding:6px 14px;">
          <div class="guide-check done"><div class="guide-check-circle done">✓</div><span class="done-text">Backend deployed on Render — caretree-leader.onrender.com</span></div>
          <div class="guide-check done"><div class="guide-check-circle done">✓</div><span class="done-text">Twilio WhatsApp sandbox configured with webhook URL</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All team leaders have sent 'join friend-married' to +14155238886</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Race created with a name &amp; date</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All stations added with clues, answers and hints</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All teams added with correct +65 WhatsApp numbers</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Scoring rules reviewed in Scoring tab</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Live leaderboard URL shared with spectators: /live</span></div>
          <div class="guide-check" style="border-bottom:none;"><div class="guide-check-circle"></div><span>Test run done with one team before the actual event</span></div>
        </div>`
    },
    {
      title: "You're ready to race!",
      body: `
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:48px;margin-bottom:12px;">🏁</div>
          <div style="font-family:var(--font-hand);font-size:22px;font-style:italic;color:var(--dark);margin-bottom:8px;">Click Start race and go!</div>
          <div style="font-size:12px;color:var(--dark-mid);margin-bottom:20px;max-width:320px;margin-left:auto;margin-right:auto;line-height:1.6;">The bot takes it from here. Good luck and have fun!</div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <a href="/" style="background:var(--red);color:#fff;border-radius:6px;padding:9px 18px;font-size:12px;font-weight:600;text-decoration:none;">Race dashboard</a>
            <a href="/live" target="_blank" style="background:var(--dark);color:var(--cream);border-radius:6px;padding:9px 18px;font-size:12px;font-weight:600;text-decoration:none;">Live leaderboard ↗</a>
          </div>
        </div>`
    }
  ];

  return sections.map((s, i) => `
    <div class="guide-slide">
      <div class="guide-slide-stripe"></div>
      <div class="guide-slide-header">
        <div class="guide-slide-title">${s.title}</div>
      </div>
      <div class="guide-slide-body">${s.body}</div>
      <div class="guide-slide-footer">
        <span>${i + 1} / ${sections.length}</span>
        <span>© Lim Jamie Claire</span>
      </div>
    </div>
  `).join('');
}

function renderGuide() {
  return `<div class="guide-wrapper"><div class="guide-deck">${buildGuideHTML()}</div></div>`;
}
// DEAD CODE BELOW — kept for reference only, not called
function _oldRenderGuide_unused() {
  const slides = [
    {
      title: 'Race & Run!',
      subtitle: 'WhatsApp Amazing Race — Race Master Guide',
      body: `<div></div>`
    },
    {
      title: 'What is Race & Run?',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div class="guide-card blue-card"><div class="guide-icon">📱</div><div class="guide-card-title">WhatsApp-native</div><p>Teams play entirely via WhatsApp. No app download, no login — just message the bot.</p></div>
          <div class="guide-card green-card"><div class="guide-icon">🗺️</div><div class="guide-card-title">Multi-station race</div><p>Set up stations around any venue. Each team gets a shuffled route so no two teams clash.</p></div>
          <div class="guide-card yellow-card"><div class="guide-icon">📊</div><div class="guide-card-title">Live race view</div><p>Watch all players in real time. Send messages, apply penalties and view the activity feed.</p></div>
        </div>
        <div class="guide-info-box">You set up stations + teams → click Start → bot sends first mission to each team → teams race by replying with answers → leaderboard updates live.</div>`
    },
    {
      title: 'Getting Started',
      body: `
        <div class="guide-url-box">https://caretree-leader.onrender.com</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">
          <div class="guide-card"><div class="guide-num">1</div><div class="guide-card-title">Create a Project</div><p>Click "+ New project" in the left sidebar. Enter race name, organisation, date and number of teams.</p></div>
          <div class="guide-card"><div class="guide-num">2</div><div class="guide-card-title">Add Stations</div><p>Go to Stations tab → Add station. Set ID, name, mission type, clue, correct answer and hint.</p></div>
          <div class="guide-card"><div class="guide-num">3</div><div class="guide-card-title">Add Teams</div><p>Go to Teams tab → Add team. Enter team name, leader name and WhatsApp number e.g. +6590687455</p></div>
          <div class="guide-card"><div class="guide-num">4</div><div class="guide-card-title">Start the Race</div><p>Click "Start race" at top right. Routes auto-shuffle and first mission is sent to all teams instantly!</p></div>
        </div>`
    },
    {
      title: 'Station Mission Types',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="guide-card" style="border-top:3px solid var(--blue-stripe);background:#f0f6fa;">
            <div class="guide-card-title" style="color:#1a5a8a;">📝 Text clue</div>
            <p>Bot sends a text clue. Team reads it, finds the answer and types it back.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. "What year is inscribed on the heritage wall near Gate 3?"</p>
          </div>
          <div class="guide-card" style="border-top:3px solid var(--green);background:var(--green-light);">
            <div class="guide-card-title" style="color:var(--green);">🖼️ Image clue</div>
            <p>Bot sends a photo. Team identifies what's in the image and replies.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. Photo of a landmark — team types the name</p>
          </div>
          <div class="guide-card" style="border-top:3px solid var(--yellow);background:var(--yellow-light);">
            <div class="guide-card-title" style="color:#7a6010;">📍 GPS location</div>
            <p>Bot sends a location pin. Team walks there and sends their live location.</p>
            <p style="font-style:italic;font-size:11px;margin-top:6px;color:var(--tan-dark);">e.g. Navigate to 1.2647°N, 103.8220°E — verified within 50m</p>
          </div>
        </div>
        <p style="font-size:10px;color:var(--tan-dark);margin-top:8px;font-style:italic;">📸 Photo required toggle: any station type can also require a team selfie before answering</p>`
    },
    {
      title: 'WhatsApp — How Teams Play',
      body: `
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px;">
          <div style="background:#e8f5e9;border-radius:8px;padding:12px;font-size:11px;">
            <div style="font-size:9px;font-weight:700;color:var(--tan-dark);margin-bottom:4px;">BOT</div>
            <div class="guide-chat-msg">🏁 Harbour Chronicles has begun!<br><br>Team HabisBalik, here is your first mission:<br><br><strong>Station C — Waterfront Landmark</strong><br>Identify the landmark shown in the photo.<br><br>Reply with your answer.<br>Type /hint for a clue (-5 pts)<br>Type /answer to reveal it (-20 pts)</div>
            <div class="guide-chat-reply">maritime singapore</div>
            <div class="guide-chat-msg">✅ Correct! Station C cleared!<br>Stages done: 1 / 5<br><br>Here comes your next mission 👇</div>
            <div class="guide-chat-reply">/hint</div>
            <div class="guide-chat-msg">💡 Hint for Station A (-5 pts deducted)<br><br>It starts with G and is above eye level.</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--dark);margin-bottom:8px;">Team commands</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/hint</span><span style="font-size:11px;">Get a hint (-5 pts)</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/answer</span><span style="font-size:11px;">Reveal answer (-20 pts)</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/status</span><span style="font-size:11px;">See your current score</span></div>
              <div style="display:flex;align-items:center;gap:8px;"><span style="background:var(--red);color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700;min-width:80px;text-align:center;">/leaderboard</span><span style="font-size:11px;">See live rankings</span></div>
            </div>
            <div style="margin-top:12px;background:var(--green-light);border:1px solid var(--green);border-radius:7px;padding:10px 12px;font-size:10px;color:#2a6b3a;line-height:1.5;"><strong>Teams never need to install anything.</strong> Just WhatsApp — they text the bot like a normal chat.</div>
          </div>
        </div>`
    },
    {
      title: 'Scoring System',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
          <div class="guide-card green-card" style="text-align:center;"><div style="font-size:24px;font-weight:800;color:var(--green);">+100</div><div class="guide-card-title">Per station cleared</div><p>Base points awarded for completing each station correctly.</p></div>
          <div class="guide-card" style="border-top:3px solid var(--red);text-align:center;"><div style="font-size:24px;font-weight:800;color:var(--red);">-10</div><div class="guide-card-title">Wrong answer</div><p>Each incorrect attempt deducts points and adds +5 min time penalty.</p></div>
          <div class="guide-card yellow-card" style="text-align:center;"><div style="font-size:24px;font-weight:800;color:#7a6010;">-5 / -20</div><div class="guide-card-title">Hint / Reveal</div><p>/hint costs 5 pts. Revealing the full answer costs 20 pts.</p></div>
        </div>
        <div class="guide-info-box">Tiebreaker: if two teams have equal points, the team with the faster finish time (minus penalty minutes) wins. All values are editable in the Scoring tab.</div>`
    },
    {
      title: 'Race Master Controls',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="guide-card"><div class="guide-icon">📢</div><div class="guide-card-title">Broadcast message</div><p>Send a WhatsApp message to ALL teams at once — announcements, reminders, hints.</p><div class="guide-tag">Overview tab</div></div>
          <div class="guide-card"><div class="guide-icon">⚠️</div><div class="guide-card-title">Manual penalty</div><p>Apply a custom point deduction or time addition to any team for rule violations.</p><div class="guide-tag">Overview tab</div></div>
          <div class="guide-card"><div class="guide-icon">🔀</div><div class="guide-card-title">Shuffle routes</div><p>Randomise station order for all teams so no two teams visit the same spot at once.</p><div class="guide-tag">Routes tab</div></div>
          <div class="guide-card"><div class="guide-icon">📋</div><div class="guide-card-title">Activity log</div><p>Filter and view every event — correct answers, wrong attempts, hints, penalties — live.</p><div class="guide-tag">Activity log tab</div></div>
          <div class="guide-card"><div class="guide-icon">🏁</div><div class="guide-card-title">End race</div><p>Lock all scores, mark remaining teams as finished, trigger final leaderboard.</p><div class="guide-tag">Top right button</div></div>
          <div class="guide-card"><div class="guide-icon">🌐</div><div class="guide-card-title">Live view</div><p>Share the public leaderboard URL with spectators — updates every 30 seconds.</p><div class="guide-tag">/live link</div></div>
        </div>`
    },
    {
      title: 'Live Leaderboard',
      body: `
        <div class="guide-url-box">https://caretree-leader.onrender.com/live</div>
        <div style="background:#fff;border:1px solid var(--tan);border-radius:8px;overflow:hidden;margin-top:10px;">
          <div style="background:var(--dark);display:grid;grid-template-columns:28px 2fr 1fr 1fr 1.5fr;padding:7px 12px;gap:8px;">
            <div style="font-size:10px;font-weight:700;color:var(--tan);text-transform:uppercase;">#</div>
            <div style="font-size:10px;font-weight:700;color:var(--tan);text-transform:uppercase;">Team</div>
            <div style="font-size:10px;font-weight:700;color:var(--tan);text-transform:uppercase;">Score</div>
            <div style="font-size:10px;font-weight:700;color:var(--tan);text-transform:uppercase;">Stations</div>
            <div style="font-size:10px;font-weight:700;color:var(--tan);text-transform:uppercase;">Progress</div>
          </div>
          <div style="background:var(--yellow-light);display:grid;grid-template-columns:28px 2fr 1fr 1fr 1.5fr;padding:8px 12px;gap:8px;align-items:center;border-bottom:1px solid #f0e8d8;">
            <div style="font-size:13px;font-weight:700;color:var(--red);">1</div>
            <div style="font-size:12px;font-weight:700;">Chope Liao 🏁</div>
            <div style="font-size:12px;font-weight:700;">520</div>
            <div style="font-size:11px;">8 / 8</div>
            <div style="background:#e0ddd0;border-radius:4px;height:6px;"><div style="height:6px;border-radius:4px;background:var(--red);width:100%"></div></div>
          </div>
          <div style="display:grid;grid-template-columns:28px 2fr 1fr 1fr 1.5fr;padding:8px 12px;gap:8px;align-items:center;border-bottom:1px solid #f0e8d8;">
            <div style="font-size:13px;font-weight:700;color:var(--dark-mid);">2</div>
            <div style="font-size:12px;">Team Kopi</div>
            <div style="font-size:12px;">410</div>
            <div style="font-size:11px;">6 / 8</div>
            <div style="background:#e0ddd0;border-radius:4px;height:6px;"><div style="height:6px;border-radius:4px;background:var(--dark-mid);width:75%"></div></div>
          </div>
          <div style="display:grid;grid-template-columns:28px 2fr 1fr 1fr 1.5fr;padding:8px 12px;gap:8px;align-items:center;">
            <div style="font-size:13px;font-weight:700;color:var(--dark-mid);">3</div>
            <div style="font-size:12px;">HabisBalik</div>
            <div style="font-size:12px;">380</div>
            <div style="font-size:11px;">5 / 8</div>
            <div style="background:#e0ddd0;border-radius:4px;height:6px;"><div style="height:6px;border-radius:4px;background:var(--tan);width:63%"></div></div>
          </div>
        </div>
        <p style="font-size:10px;color:var(--tan-dark);margin-top:7px;text-align:center;font-style:italic;">Auto-refreshes every 30 seconds · No login required · Share freely with spectators</p>`
    },
    {
      title: 'Pre-Race Setup Checklist',
      body: `
        <div style="background:#fff;border:1px solid var(--tan);border-radius:8px;padding:6px 14px;">
          <div class="guide-check done"><div class="guide-check-circle done">✓</div><span class="done-text">Backend deployed on Render — caretree-leader.onrender.com</span></div>
          <div class="guide-check done"><div class="guide-check-circle done">✓</div><span class="done-text">Twilio WhatsApp sandbox configured with webhook URL</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All team leaders have sent 'join friend-married' to +14155238886</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Race created with a name &amp; date</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All stations added with clues, answers and hints</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>All teams added with correct +65 WhatsApp numbers</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Scoring rules reviewed in Scoring tab</span></div>
          <div class="guide-check"><div class="guide-check-circle"></div><span>Live leaderboard URL shared with spectators: /live</span></div>
          <div class="guide-check" style="border-bottom:none;"><div class="guide-check-circle"></div><span>Test run done with one team before the actual event</span></div>
        </div>`
    },
    {
      title: "You're ready to race! 🏁",
      body: `
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:48px;margin-bottom:14px;">🏁</div>
          <div style="font-size:20px;font-weight:800;color:var(--dark);margin-bottom:8px;">Click Start race and go!</div>
          <div style="font-size:12px;color:var(--dark-mid);margin-bottom:20px;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.6;">The bot takes it from here. Good luck and have fun!</div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <a href="/" style="background:var(--red);color:#fff;border-radius:6px;padding:9px 18px;font-size:12px;font-weight:700;text-decoration:none;">Race dashboard</a>
            <a href="/live" target="_blank" style="background:var(--dark);color:var(--cream);border-radius:6px;padding:9px 18px;font-size:12px;font-weight:700;text-decoration:none;">Live leaderboard ↗</a>
          </div>
        </div>`
    }
  ];

  const total = slides.length;
  const slidesHtml = slides.map((s, i) => `
    <div class="guide-slide ${i === 0 ? 'active' : ''}" id="gslide-${i}">
      <div class="guide-slide-stripe"></div>
      <div class="guide-slide-header">
        <div class="guide-slide-title">${s.title}</div>
        ${s.subtitle ? `<div class="guide-slide-sub">${s.subtitle}</div>` : ''}
      </div>
      <div class="guide-slide-body">${s.body}</div>
      <div class="guide-slide-footer">
        <span>Race & Run — Guide</span>
        <span>Slide ${i+1} / ${total}</span>
        <span>© Lim Jamie Claire</span>
      </div>
    </div>
  `).join('');

  const dotsHtml = slides.map((_, i) => `<span class="guide-dot ${i===0?'active':''}" onclick="guideGoTo(${i})"></span>`).join('');

  return `
    <div class="guide-wrapper">
      <div class="guide-nav">
        <button class="btn btn-sm" id="guide-prev" onclick="guideChange(-1)" disabled>← Prev</button>
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div class="guide-dots">${dotsHtml}</div>
          <span id="guide-count" style="font-size:11px;color:var(--tan-dark);font-weight:600;">Slide 1 / ${total}</span>
        </div>
        <button class="btn btn-sm" id="guide-next" onclick="guideChange(1)">Next →</button>
      </div>
      <div class="guide-deck">${slidesHtml}</div>
    </div>`;
}

function renderScoring(p) {
  const s = p.scoring || {};
  return `
    <div class="grid2">
      <div class="card">
        <div class="card-title">Point rules</div>
        <div class="form-group">
          <label class="form-label">Points per station</label>
          <input type="number" id="sc-stage" value="${s.stage_pts || 100}" oninput="updateFormula()">
        </div>
        <div class="form-group">
          <label class="form-label">Wrong answer deduction</label>
          <input type="number" id="sc-wrong" value="${s.wrong_pts || 10}" oninput="updateFormula()">
        </div>
        <div class="form-group">
          <label class="form-label">Hint cost</label>
          <input type="number" id="sc-hint" value="${s.hint_pts || 5}" oninput="updateFormula()">
        </div>
        <div class="form-group">
          <label class="form-label">Answer reveal cost</label>
          <input type="number" id="sc-answer" value="${s.answer_pts || 20}" oninput="updateFormula()">
        </div>
      </div>
      <div class="card">
        <div class="card-title">Time rules</div>
        <div class="form-group">
          <label class="form-label">Time penalty per wrong answer (min)</label>
          <input type="number" id="sc-wtime" value="${s.wrong_time || 5}" oninput="updateFormula()">
        </div>
        <div class="form-group">
          <label class="form-label">Tiebreaker</label>
          <select id="sc-tie">
            <option>Fastest overall time</option>
            <option>Fewest wrong answers</option>
            <option>Fewest hints used</option>
          </select>
        </div>
        <hr class="divider">
        <div style="font-size:12px;color:var(--tan-dark);margin-bottom:6px">Score formula</div>
        <div class="formula-box" id="formula-box"></div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-title">Finish message</div>
      <div class="form-group">
        <label class="form-label">Sent to teams when they complete all stations <span style="font-size:11px;color:var(--tan-dark)">(leave blank for default)</span></label>
        <textarea id="sc-finish-msg" style="min-height:80px" placeholder="e.g. 🎉 Amazing work! Head to the main stage for the prize ceremony!">${p.finish_message || ''}</textarea>
      </div>
    </div>
    <div style="margin-top:14px">
      <button class="btn btn-primary" onclick="saveScoring()">
        <i class="ti ti-check"></i> Save rules
      </button>
    </div>
  `;
}

function updateFormula() {
  const sp = document.getElementById('sc-stage')?.value || 100;
  const wp = document.getElementById('sc-wrong')?.value || 10;
  const hp = document.getElementById('sc-hint')?.value || 5;
  const ap = document.getElementById('sc-answer')?.value || 20;
  const wt = document.getElementById('sc-wtime')?.value || 5;
  const box = document.getElementById('formula-box');
  if (box) box.textContent =
    `Score\n= stages × ${sp}\n− wrong × ${wp}\n− hints × ${hp}\n− reveals × ${ap}\n\nTime\n= duration + wrong × ${wt}min`;
}

async function saveScoring() {
  if (!activeProject) return;
  await api('PATCH', `/projects/${activeProject.id}`, {
    scoring_stage_pts:  parseInt(document.getElementById('sc-stage').value),
    scoring_wrong_pts:  parseInt(document.getElementById('sc-wrong').value),
    scoring_hint_pts:   parseInt(document.getElementById('sc-hint').value),
    scoring_answer_pts: parseInt(document.getElementById('sc-answer').value),
    scoring_wrong_time: parseInt(document.getElementById('sc-wtime').value),
    finish_message:     document.getElementById('sc-finish-msg').value.trim(),
  });
  alert('Scoring rules saved!');
  await selectProject(activeProject.id);
}

// ─── Logs ──────────────────────────────────────────────────────────────────

async function loadLogs() {
  if (!activeProject) return;
  const logs = await api('GET', `/projects/${activeProject.id}/logs`);
  const colors = {
    correct: 'dot-correct', wrong: 'dot-wrong',
    hint: 'dot-hint', penalty: 'dot-penalty', finish: 'dot-finish',
  };
  document.getElementById('logs-content').innerHTML = logs.length ? `
    <div class="card">
      ${logs.map(l => `
        <div class="log-row">
          <span class="log-time">${l.created_at ? new Date(l.created_at).toLocaleTimeString('en-SG', {hour:'2-digit',minute:'2-digit'}) : '—'}</span>
          <div class="log-dot ${colors[l.event_type] || 'dot-finish'}"></div>
          <div style="flex:1">
            <span style="font-family:var(--font-hand);font-size:15px">${getTeamName(l.team_id)}</span>
            <span style="color:var(--tan-dark)"> — ${l.message}</span>
          </div>
          ${l.pts_change ? `<span style="font-size:12px;color:${l.pts_change < 0 ? 'var(--red)' : 'var(--green)'}">${l.pts_change > 0 ? '+' : ''}${l.pts_change}pts</span>` : ''}
        </div>
      `).join('')}
    </div>` : `<div class="empty-state"><div class="empty-state-text">No activity yet</div></div>`;
}

function getTeamName(teamId) {
  if (!activeProject) return teamId;
  const t = (activeProject.teams || []).find(t => t.id === teamId);
  return t ? t.name : teamId;
}

// ─── Image upload helpers ──────────────────────────────────────────────────

async function uploadImageFile(file, inputId, dropId) {
  const zone = document.getElementById(dropId);
  zone.classList.add('drag-over');
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: form,
    });
    if (!res.ok) { alert('Upload failed'); return; }
    const { url } = await res.json();
    document.getElementById(inputId).value = url;
    updateImgPreview(inputId, 'prev-' + inputId);
    zone.classList.remove('drag-over');
    zone.classList.add('has-img');
  } catch (e) {
    alert('Upload error: ' + e.message);
    zone.classList.remove('drag-over');
  }
}

function handleImgDrop(event, inputId, dropId) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) uploadImageFile(file, inputId, dropId);
}

function handleImgFile(input, inputId, dropId) {
  const file = input.files[0];
  if (file) uploadImageFile(file, inputId, dropId);
}

function updateImgPreview(inputId, prevId) {
  const url = document.getElementById(inputId)?.value;
  const img = document.getElementById(prevId);
  if (!img) return;
  if (url) { img.src = url; img.style.display = ''; }
  else img.style.display = 'none';
}

// ─── Chain Steps UI ────────────────────────────────────────────────────────

function renderChainStep(n, data = {}) {
  const id = `cs${n}`;
  const d = Object.assign({ clue_text:'', clue_media_url:'', answer:'', hint_text:'', hint_media_url:'', photo_required:false }, data);
  const div = document.createElement('div');
  div.className = 'chain-step-card';
  div.dataset.stepIdx = n;
  div.style.cssText = 'border:1px solid var(--tan);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-light,#fdf8f0)';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-weight:600;font-size:13px;color:var(--dark-mid)">Part ${n + 1}</span>
      <button type="button" onclick="removeChainStep(this)" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:16px;line-height:1">✕</button>
    </div>
    <div class="form-group">
      <label class="form-label">Clue / instruction</label>
      <textarea id="${id}-clue" style="min-height:48px" placeholder="What teams need to do for this part...">${escHtml(d.clue_text)}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Photo clue <span style="font-size:10px;color:var(--tan-dark)">(optional)</span></label>
      <div class="img-drop-zone" id="drop-${id}-media" ondragover="event.preventDefault()" ondrop="handleImgDrop(event,'${id}-media','drop-${id}-media')">
        <span class="img-drop-label">Drop image here or <label style="color:var(--red);cursor:pointer">browse<input type="file" accept="image/*" style="display:none" onchange="handleImgFile(this,'${id}-media','drop-${id}-media')"></label></span>
        <img id="prev-${id}-media" style="display:none;max-height:70px;border-radius:4px;margin-top:6px">
      </div>
      <input type="text" id="${id}-media" placeholder="or paste a URL" style="margin-top:6px" value="${escHtml(d.clue_media_url)}" oninput="updateImgPreview('${id}-media','prev-${id}-media')">
    </div>
    <div class="form-group">
      <label class="form-label">Answer <span style="font-size:10px;color:var(--tan-dark)">(optional — leave blank to skip answer-checking for this part)</span></label>
      <input type="text" id="${id}-answer" placeholder="Case-insensitive match" value="${escHtml(d.answer)}">
    </div>
    <div class="form-group">
      <label class="form-label">Hint text <span style="font-size:10px;color:var(--tan-dark)">(optional)</span></label>
      <input type="text" id="${id}-hint" placeholder="Shown when team types /hint" value="${escHtml(d.hint_text)}">
    </div>
    <div class="form-group">
      <label class="form-label">Hint photo <span style="font-size:10px;color:var(--tan-dark)">(optional)</span></label>
      <div class="img-drop-zone" id="drop-${id}-hint-media" ondragover="event.preventDefault()" ondrop="handleImgDrop(event,'${id}-hint-media','drop-${id}-hint-media')">
        <span class="img-drop-label">Drop image here or <label style="color:var(--red);cursor:pointer">browse<input type="file" accept="image/*" style="display:none" onchange="handleImgFile(this,'${id}-hint-media','drop-${id}-hint-media')"></label></span>
        <img id="prev-${id}-hint-media" style="display:none;max-height:70px;border-radius:4px;margin-top:6px">
      </div>
      <input type="text" id="${id}-hint-media" placeholder="or paste a URL" style="margin-top:6px" value="${escHtml(d.hint_media_url)}" oninput="updateImgPreview('${id}-hint-media','prev-${id}-hint-media')">
    </div>
    <div class="check-row">
      <input type="checkbox" id="${id}-photo" ${d.photo_required ? 'checked' : ''}>
      <label for="${id}-photo">Require selfie to complete this part</label>
    </div>`;
  // refresh previews after insert
  setTimeout(() => {
    updateImgPreview(`${id}-media`, `prev-${id}-media`);
    updateImgPreview(`${id}-hint-media`, `prev-${id}-hint-media`);
  }, 0);
  return div;
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addChainStep() {
  const list = document.getElementById('chain-steps-list');
  const n = list.children.length;
  list.appendChild(renderChainStep(n));
  renumberChainSteps();
}

function removeChainStep(btn) {
  btn.closest('.chain-step-card').remove();
  renumberChainSteps();
}

function renumberChainSteps() {
  const cards = document.querySelectorAll('#chain-steps-list .chain-step-card');
  cards.forEach((card, i) => {
    card.dataset.stepIdx = i;
    card.querySelector('span').textContent = `Part ${i + 1}`;
  });
}

function getChainSteps() {
  return Array.from(document.querySelectorAll('#chain-steps-list .chain-step-card')).map(card => {
    const n = card.dataset.stepIdx;
    const id = `cs${n}`;
    return {
      clue_text:      (document.getElementById(`${id}-clue`)?.value || '').trim(),
      clue_media_url: (document.getElementById(`${id}-media`)?.value || '').trim(),
      answer:         (document.getElementById(`${id}-answer`)?.value || '').trim(),
      hint_text:      (document.getElementById(`${id}-hint`)?.value || '').trim(),
      hint_media_url: (document.getElementById(`${id}-hint-media`)?.value || '').trim(),
      photo_required: document.getElementById(`${id}-photo`)?.checked || false,
    };
  });
}

function clearChainSteps() {
  document.getElementById('chain-steps-list').innerHTML = '';
}

function loadChainSteps(steps) {
  const list = document.getElementById('chain-steps-list');
  list.innerHTML = '';
  steps.forEach((step, i) => list.appendChild(renderChainStep(i, step)));
}

// ─── Station CRUD ──────────────────────────────────────────────────────────

function openAddStation() {
  editingStationId = null;
  editingStationIdx = null;
  document.getElementById('station-modal-title').textContent = 'Add station';
  document.getElementById('delete-station-btn').style.display = 'none';
  ['s-code','s-name','s-clue','s-answer','s-hint','s-media','s-hint-media'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('s-type').value = 'text';
  document.getElementById('s-hint-cost').value = 5;
  document.getElementById('s-answer-cost').value = 20;
  document.getElementById('s-photo').checked = false;
  document.getElementById('s-final').checked = false;
  ['drop-s-media','drop-s-hint-media'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('has-img','drag-over');
  });
  ['prev-s-media','prev-s-hint-media'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.src=''; el.style.display='none'; }
  });
  clearChainSteps();
  updateTypeHint();
  openModal('modal-station');
}

function openEditStation(id, idx) {
  const s = activeProject.stations[idx];
  editingStationId = id;
  editingStationIdx = idx;
  document.getElementById('station-modal-title').textContent = `Edit station ${s.station_code}`;
  document.getElementById('delete-station-btn').style.display = '';
  document.getElementById('s-code').value = s.station_code;
  document.getElementById('s-name').value = s.name;
  document.getElementById('s-type').value = s.mission_type;
  document.getElementById('s-clue').value = s.clue_text;
  document.getElementById('s-answer').value = s.answer;
  document.getElementById('s-hint').value = s.hint_text;
  document.getElementById('s-hint-media').value = s.hint_media_url || '';
  document.getElementById('s-hint-cost').value = s.hint_cost;
  document.getElementById('s-answer-cost').value = s.answer_cost;
  document.getElementById('s-photo').checked = s.photo_required;
  document.getElementById('s-media').value = s.clue_media_url || '';
  document.getElementById('s-lat').value = s.gps_lat || '';
  document.getElementById('s-lng').value = s.gps_lng || '';
  document.getElementById('s-final').checked = s.is_final === true;
  // Load chain steps — migrate legacy single-step data if chain_steps array is empty
  const steps = (s.chain_steps && s.chain_steps.length > 0) ? s.chain_steps
    : (s.chain_clue ? [{
        clue_text: s.chain_clue, clue_media_url: s.chain_media_url || '',
        answer: s.chain_answer || '', hint_text: s.chain_hint || '',
        hint_media_url: s.chain_hint_media_url || '', photo_required: !!s.chain_photo_required
      }] : []);
  loadChainSteps(steps);
  // Show existing image previews
  updateImgPreview('s-media', 'prev-s-media');
  updateImgPreview('s-hint-media', 'prev-s-hint-media');
  ['drop-s-media','drop-s-hint-media'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('has-img', !!document.getElementById(id.replace('drop-',''))?.value);
  });
  updateTypeHint();
  openModal('modal-station');
}

function updateTypeHint() {
  const type = document.getElementById('s-type').value;
  const hints = {
    text: 'Bot sends a text clue. Team replies with a text answer.',
    image: 'Bot sends the clue text. Team takes a photo at the location and sends it — photo = answer.',
    gps: 'Bot sends a GPS pin. Team walks there and sends their live location — no text answer needed.',
  };
  document.getElementById('s-type-hint').textContent = hints[type] || '';

  const isGps   = type === 'gps';
  const isImage = type === 'image';
  const needsAnswer = !isGps && !isImage;

  // Media URL field — show for text/image stations (bot sends photo as clue)
  document.getElementById('s-media-group').style.display = (isGps) ? 'none' : '';

  // GPS coordinate fields
  document.getElementById('s-gps-group').style.display = isGps ? '' : 'none';

  // Answer + reveal cost — only for text stations
  document.getElementById('s-answer').closest('.form-group').style.display = needsAnswer ? '' : 'none';
  document.getElementById('s-answer-cost').closest('.form-group').style.display = needsAnswer ? '' : 'none';

  // Auto-fill placeholder answers for non-text types
  if (isGps)   document.getElementById('s-answer').value = '__gps__';
  if (isImage) document.getElementById('s-answer').value = '__image__';
  if (needsAnswer && document.getElementById('s-answer').value.startsWith('__')) {
    document.getElementById('s-answer').value = '';
  }
}

async function saveStation() {
  const data = {
    station_code: document.getElementById('s-code').value.trim().toUpperCase(),
    name: document.getElementById('s-name').value.trim(),
    mission_type: document.getElementById('s-type').value,
    clue_text: document.getElementById('s-clue').value.trim(),
    clue_media_url: document.getElementById('s-media').value.trim(),
    answer: document.getElementById('s-answer').value.trim(),
    hint_text: document.getElementById('s-hint').value.trim(),
    hint_media_url: document.getElementById('s-hint-media').value.trim(),
    hint_cost: parseInt(document.getElementById('s-hint-cost').value) || 5,
    answer_cost: parseInt(document.getElementById('s-answer-cost').value) || 20,
    photo_required: document.getElementById('s-photo').checked,
    order_index: editingStationIdx ?? (activeProject.stations?.length || 0),
    gps_lat: parseFloat(document.getElementById('s-lat')?.value) || null,
    gps_lng: parseFloat(document.getElementById('s-lng')?.value) || null,
  };

  // Chain mission fields — enabled if chain_clue is filled in
  data.chain_steps = getChainSteps();
  data.is_final             = document.getElementById('s-final').checked;

  if (data.mission_type === 'gps') data.answer = '__gps__';
  if (data.mission_type === 'image') data.answer = '__image__';
  if (!data.station_code || !data.answer) {
    alert('Station ID and answer are required'); return;
  }

  if (editingStationId) {
    await api('PATCH', `/projects/${activeProject.id}/stations/${editingStationId}`, data);
  } else {
    await api('POST', `/projects/${activeProject.id}/stations`, data);
  }

  closeModal('modal-station');
  await selectProject(activeProject.id);
  showTab('stations', document.querySelectorAll('.tab-btn')[1]);
}

async function deleteStation() {
  if (!editingStationId) return;
  if (!confirm('Delete this station?')) return;
  await api('DELETE', `/projects/${activeProject.id}/stations/${editingStationId}`);
  closeModal('modal-station');
  await selectProject(activeProject.id);
  showTab('stations', document.querySelectorAll('.tab-btn')[1]);
}

// ─── Team CRUD ─────────────────────────────────────────────────────────────

async function saveTeam() {
  const name = document.getElementById('t-name').value.trim();
  if (!name) { alert('Team name is required'); return; }

  const wa = document.getElementById('t-wa').value.trim();
  await api('POST', `/projects/${activeProject.id}/teams`, {
    name,
    leader_name: document.getElementById('t-leader').value.trim(),
    mobile: wa,
    group_number: wa,
  });

  closeModal('modal-team');
  ['t-name','t-leader','t-wa'].forEach(id => document.getElementById(id).value = '');
  await selectProject(activeProject.id);
  showTab('teams', document.querySelectorAll('.tab-btn')[4]);
}

async function deleteTeam(teamId) {
  if (!confirm('Remove this team?')) return;
  await api('DELETE', `/projects/${activeProject.id}/teams/${teamId}`);
  await selectProject(activeProject.id);
}

// ─── Broadcast ─────────────────────────────────────────────────────────────

async function sendBroadcast() {
  const msg = document.getElementById('bc-msg').value.trim();
  if (!msg) { alert('Please enter a message'); return; }
  await api('POST', `/projects/${activeProject.id}/broadcast`, { message: msg });
  closeModal('modal-broadcast');
  document.getElementById('bc-msg').value = '';
  alert('Message sent to all teams!');
}

// ─── Penalty ───────────────────────────────────────────────────────────────

function openPenalty(teamId, teamName) {
  document.getElementById('pen-team-id').value = teamId;
  document.getElementById('pen-team-name').value = teamName;
  document.getElementById('pen-reason').value = '';
  openModal('modal-penalty');
}

async function submitPenalty() {
  const reason = document.getElementById('pen-reason').value.trim();
  if (!reason) { alert('Please enter a reason'); return; }
  await api('POST', `/projects/${activeProject.id}/penalty`, {
    team_id: document.getElementById('pen-team-id').value,
    reason,
    pts: parseInt(document.getElementById('pen-pts').value) || 10,
    time_mins: parseInt(document.getElementById('pen-time').value) || 5,
  });
  closeModal('modal-penalty');
  alert('Penalty applied!');
  await selectProject(activeProject.id);
}

// ─── Routes ────────────────────────────────────────────────────────────────

async function shuffleRoutes() {
  if (!confirm('Auto-shuffle routes for all teams?')) return;
  await api('POST', `/projects/${activeProject.id}/shuffle-routes`);
  await selectProject(activeProject.id);
  showTab('routes', document.querySelectorAll('.tab-btn')[2]);
}

// ─── Modal helpers ─────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('open');
  });
});