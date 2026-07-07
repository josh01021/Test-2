// Supabase instellingen
// Gebruik alleen de publishable/anon key. Nooit de service_role key.
const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';
const AUTH_STORAGE_KEY = 'vastgoed_auth_session_v1';

const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;

let query = '';
let vastgoedData = [];
let authSession = getStoredSession();

const pages = document.querySelectorAll('.page');
const navs = document.querySelectorAll('.nav');

function getStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  authSession = session;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  authSession = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function getAccessToken() {
  return authSession?.access_token || '';
}

async function signIn(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || data.error || 'Inloggen mislukt.');
  }
  saveSession(data);
  return data;
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
}

async function supabaseSelect(table, select='*') {
  const token = getAccessToken();
  if (!token) throw new Error('Niet ingelogd.');

  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 401) {
    clearSession();
    showLogin();
    throw new Error('Sessie verlopen. Log opnieuw in.');
  }

  if (!response.ok) {
    const msg = await response.text();
    throw new Error(`${table}: ${response.status} ${msg}`);
  }
  return response.json();
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0,0,0,0);
  date.setHours(0,0,0,0);
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

function getDateStatus(dateString, warningDays = 365, dangerDays = 90) {
  const days = daysUntil(dateString);
  if (days === null) return ['Controle nodig', 'warning'];
  if (days < 0) return ['Verlopen', 'danger'];
  if (days <= dangerDays) return [`Binnen ${dangerDays} dagen`, 'danger'];
  if (days <= warningDays) return [`Binnen ${warningDays} dagen`, 'warning'];
  return ['Op orde', 'ok'];
}

function normalize(properties, contracts, tenants, maintenance) {
  const tenantById = Object.fromEntries(tenants.map(t => [t.id, t]));
  const contractsByProperty = {};
  contracts.forEach(c => {
    if (!contractsByProperty[c.property_id]) contractsByProperty[c.property_id] = [];
    contractsByProperty[c.property_id].push(c);
  });
  const maintenanceByProperty = {};
  maintenance.forEach(m => {
    if (!maintenanceByProperty[m.property_id]) maintenanceByProperty[m.property_id] = [];
    maintenanceByProperty[m.property_id].push(m);
  });

  return properties.map(p => {
    const contract = (contractsByProperty[p.id] || [])[0] || {};
    const tenant = tenantById[contract.tenant_id] || {};
    const plannedMaintenance = (maintenanceByProperty[p.id] || [])[0] || {};

    const objectName = p.name || [p.address, p.house_number].filter(Boolean).join(' ') || 'Onbekend object';
    const rentPm = p.monthly_rent ?? contract.monthly_rent ?? 0;
    const rentPj = p.yearly_rent ?? (Number(rentPm || 0) * 12);
    const contractEnd = contract.end_date || p.end_date;
    const noticeDate = contract.notice_date || p.notice_date;
    const scopeDate = p.scope_valid_until || plannedMaintenance.planned_date;

    return {
      id: p.id,
      object: objectName,
      straatnaam: p.address || '',
      huisnummer: p.house_number || '',
      stad: p.city || '',
      huurder: tenant.name || p.tenant_name || '-',
      email: tenant.email || p.email || '',
      telefoon: tenant.phone || p.phone || '',
      huur_pm: rentPm,
      huur_pj: rentPj,
      servicekosten: p.service_costs || 0,
      waarborgsom: p.deposit || 0,
      energielabel: p.energy_label || '-',
      energielabel_geldig_tot: p.energy_label_valid_until || '',
      maand_huurverhoging: p.rent_increase_month || '',
      einddatum_contract: contractEnd,
      opzegdatum: noticeDate,
      scope_inspectie_geldig_tot: scopeDate,
      onderhoud_titel: plannedMaintenance.title || 'Scope-inspectie',
      onderhoud_status: plannedMaintenance.status || '-',
      status_contract: getDateStatus(contractEnd, 365, 90),
      status_opzeg: getDateStatus(noticeDate, 365, 90),
      status_scope: getDateStatus(scopeDate, 365, 90)
    };
  });
}

async function loadData() {
  const statusText = document.getElementById('statusText');
  try {
    const [properties, contracts, tenants, maintenance] = await Promise.all([
      supabaseSelect('properties'),
      supabaseSelect('contracts'),
      supabaseSelect('tenants'),
      supabaseSelect('maintenance')
    ]);
    vastgoedData = normalize(properties, contracts, tenants, maintenance);
    statusText.textContent = `Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render();
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Kan Supabase-data niet laden. Controleer login en RLS-instellingen.';
    document.getElementById('attentionList').innerHTML = `<div class="alert danger"><strong>Fout bij laden</strong>${error.message}</div>`;
  }
}

function filtered(){
  return vastgoedData.filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
}

function notificationItems(data){
  const items=[];
  data.forEach(r=>{
    if(r.status_opzeg[1] !== 'ok') items.push({sev:r.status_opzeg[1], title:`Opzegdatum: ${r.object}`, text:`Opzegdatum ${dateFmt(r.opzegdatum)}. Contract eindigt op ${dateFmt(r.einddatum_contract)}.`});
    if(r.status_contract[1] !== 'ok') items.push({sev:r.status_contract[1], title:`Contract: ${r.object}`, text:`Contractstatus: ${r.status_contract[0]}. Einddatum ${dateFmt(r.einddatum_contract)}.`});
    if(r.status_scope[1] !== 'ok') items.push({sev:r.status_scope[1], title:`Onderhoud/inspectie: ${r.object}`, text:`Datum: ${dateFmt(r.scope_inspectie_geldig_tot)}.`});
  });
  return items;
}

function render(){
  const data=filtered();
  const notes=notificationItems(data);
  document.getElementById('totalObjects').textContent=data.length;
  document.getElementById('totalRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pj || 0),0));
  document.getElementById('urgentCount').textContent=notes.filter(n=>n.sev==='danger').length;
  document.getElementById('contractSoon').textContent=data.filter(r=>r.status_contract[1] !== 'ok').length;
  document.getElementById('attentionList').innerHTML = notes.slice(0,5).map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  document.getElementById('notificationList').innerHTML = notes.map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen meldingen gevonden.</p>';
  document.getElementById('objectGrid').innerHTML=data.map(r=>`<article class="objectCard"><h3>${r.object}</h3><div class="meta">Huurder: ${r.huurder}</div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Energielabel</span><strong>${r.energielabel}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Opzegdatum</span>${statusBadge(r.status_opzeg)}</div><div class="row"><span>Onderhoud/inspectie</span>${statusBadge(r.status_scope)}</div></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  document.getElementById('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  document.getElementById('maintenanceTable').innerHTML=`<tr><th>Object</th><th>Type</th><th>Datum</th><th>Status</th><th>Actie</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.onderhoud_titel}</td><td>${dateFmt(r.scope_inspectie_geldig_tot)}</td><td>${statusBadge(r.status_scope)}</td><td>Plan controle / inspectie</td></tr>`).join('');
}

navs.forEach(btn=>btn.addEventListener('click',()=>{
  navs.forEach(n=>n.classList.remove('active'));
  btn.classList.add('active');
  pages.forEach(p=>p.classList.remove('active'));
  document.getElementById(btn.dataset.page).classList.add('active');
  document.getElementById('pageTitle').textContent=btn.textContent;
}));

document.getElementById('search').addEventListener('input', e=>{query=e.target.value;render();});

document.getElementById('loginButton').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const loginError = document.getElementById('loginError');
  loginError.textContent = '';

  try {
    await signIn(email, password);
    showApp();
    await loadData();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

document.getElementById('loginPassword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('loginButton').click();
});

document.getElementById('logoutButton').addEventListener('click', () => {
  clearSession();
  vastgoedData = [];
  showLogin();
});

if (getAccessToken()) {
  showApp();
  loadData();
} else {
  showLogin();
}
