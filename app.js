const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';

let sb;
let query = '';
let vastgoedData = [];
let rawProperties = [];
let rawContracts = [];
let rawTenants = [];
let rawMaintenance = [];

const euro = n => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const el = id => document.getElementById(id);
const numOrNull = v => v === '' || v === null || v === undefined ? null : Number(v);
const valOrNull = id => el(id).value.trim() || null;

function daysUntil(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
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
  contracts.forEach(c => { (contractsByProperty[c.property_id] ||= []).push(c); });
  const maintenanceByProperty = {};
  maintenance.forEach(m => { (maintenanceByProperty[m.property_id] ||= []).push(m); });

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
      contract_id: contract.id || '',
      tenant_id: tenant.id || '',
      maintenance_id: plannedMaintenance.id || '',
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
      startdatum_contract: contract.start_date || '',
      opzegdatum: noticeDate,
      contract_status: contract.status || '',
      scope_inspectie_geldig_tot: scopeDate,
      onderhoud_titel: plannedMaintenance.title || 'Scope-inspectie',
      onderhoud_description: plannedMaintenance.description || '',
      onderhoud_cost: plannedMaintenance.cost || '',
      onderhoud_status: plannedMaintenance.status || '',
      onderhoud_priority: plannedMaintenance.priority || '',
      status_contract: getDateStatus(contractEnd, 365, 90),
      status_opzeg: getDateStatus(noticeDate, 365, 90),
      status_scope: getDateStatus(scopeDate, 365, 90)
    };
  });
}

function showLogin() {
  el('loginView').classList.remove('hidden');
  el('appView').classList.add('hidden');
}

function showApp() {
  el('loginView').classList.add('hidden');
  el('appView').classList.remove('hidden');
}

async function checkSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    showApp();
    await loadData();
  } else {
    showLogin();
  }
}

async function loadData() {
  try {
    const [pr, cr, tr, mr] = await Promise.all([
      sb.from('properties').select('*').order('created_at', { ascending: false }),
      sb.from('contracts').select('*'),
      sb.from('tenants').select('*'),
      sb.from('maintenance').select('*')
    ]);
    [pr, cr, tr, mr].forEach(r => { if (r.error) throw r.error; });
    rawProperties = pr.data || [];
    rawContracts = cr.data || [];
    rawTenants = tr.data || [];
    rawMaintenance = mr.data || [];
    vastgoedData = normalize(rawProperties, rawContracts, rawTenants, rawMaintenance);
    el('statusText').textContent = `Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render();
  } catch (error) {
    console.error(error);
    el('statusText').textContent = 'Kan data niet laden.';
    el('attentionList').innerHTML = `<div class="alert danger"><strong>Fout bij laden</strong>${error.message}</div>`;
  }
}

function filtered() {
  return vastgoedData.filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
}

function notificationItems(data) {
  const items = [];
  data.forEach(r => {
    if (r.status_opzeg[1] !== 'ok') items.push({ sev: r.status_opzeg[1], title: `Opzegdatum: ${r.object}`, text: `Opzegdatum ${dateFmt(r.opzegdatum)}. Contract eindigt op ${dateFmt(r.einddatum_contract)}.` });
    if (r.status_contract[1] !== 'ok') items.push({ sev: r.status_contract[1], title: `Contract: ${r.object}`, text: `Contractstatus: ${r.status_contract[0]}. Einddatum ${dateFmt(r.einddatum_contract)}.` });
    if (r.status_scope[1] !== 'ok') items.push({ sev: r.status_scope[1], title: `Onderhoud/inspectie: ${r.object}`, text: `Datum: ${dateFmt(r.scope_inspectie_geldig_tot)}.` });
  });
  return items;
}

function render() {
  const data = filtered();
  const notes = notificationItems(data);
  el('totalObjects').textContent = data.length;
  el('totalRent').textContent = euro(data.reduce((a, b) => a + Number(b.huur_pj || 0), 0));
  el('urgentCount').textContent = notes.filter(n => n.sev === 'danger').length;
  el('contractSoon').textContent = data.filter(r => r.status_contract[1] !== 'ok').length;

  el('attentionList').innerHTML = notes.slice(0, 5).map(n => `<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  el('notificationList').innerHTML = notes.map(n => `<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen meldingen gevonden.</p>';

  el('objectGrid').innerHTML = data.map(r => `<article class="objectCard">
    <h3>${r.object}</h3>
    <div class="meta">Huurder: ${r.huurder}</div>
    <div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div>
    <div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div>
    <div class="row"><span>Energielabel</span><strong>${r.energielabel}</strong></div>
    <div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div>
    <div class="row"><span>Opzegdatum</span>${statusBadge(r.status_opzeg)}</div>
    <div class="row"><span>Onderhoud/inspectie</span>${statusBadge(r.status_scope)}</div>
    <button class="smallBtn" onclick="openEditProperty('${r.id}')">Bewerken</button>
  </article>`).join('') || '<p>Geen objecten gevonden.</p>';

  el('contractTable').innerHTML = `<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>` + data.map(r => `<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  el('maintenanceTable').innerHTML = `<tr><th>Object</th><th>Type</th><th>Datum</th><th>Status</th><th>Prioriteit</th></tr>` + data.map(r => `<tr><td>${r.object}</td><td>${r.onderhoud_titel}</td><td>${dateFmt(r.scope_inspectie_geldig_tot)}</td><td>${statusBadge(r.status_scope)}</td><td>${r.onderhoud_priority || '-'}</td></tr>`).join('');
}

function fillFormDefaults() {
  ['propertyId', 'tenantId', 'contractId', 'maintenanceId'].forEach(id => el(id).value = '');
  el('propertyForm').reset();
  el('propertyStatus').value = 'Actief';
  el('contractStatus').value = 'Actief';
  el('maintenanceStatus').value = 'Open';
  el('maintenancePriority').value = 'Normaal';
  el('maintenanceTitle').value = 'Scope-inspectie';
  el('deletePropertyBtn').classList.add('hidden');
  setMessage('');
}

function setMessage(message, type = '') {
  el('propertyMessage').textContent = message;
  el('propertyMessage').className = `formMessage ${type}`;
}

function openNewProperty() {
  el('modalTitle').textContent = 'Nieuw object';
  fillFormDefaults();
  el('propertyModal').classList.remove('hidden');
}

window.openEditProperty = function(id) {
  const p = rawProperties.find(x => x.id === id);
  const r = vastgoedData.find(x => x.id === id);
  if (!p || !r) return;
  el('modalTitle').textContent = 'Object bewerken';
  fillFormDefaults();
  el('propertyId').value = p.id;
  el('tenantId').value = r.tenant_id || '';
  el('contractId').value = r.contract_id || '';
  el('maintenanceId').value = r.maintenance_id || '';

  el('propertyName').value = p.name || '';
  el('propertyAddress').value = p.address || '';
  el('propertyHouseNumber').value = p.house_number || '';
  el('propertyCity').value = p.city || '';
  el('propertyType').value = p.property_type || '';
  el('propertyStatus').value = p.status || 'Actief';
  el('propertyMonthlyRent').value = p.monthly_rent || '';
  el('propertyYearlyRent').value = p.yearly_rent || '';
  el('propertyServiceCosts').value = p.service_costs || '';
  el('propertyDeposit').value = p.deposit || '';
  el('propertyEnergyLabel').value = p.energy_label || '';
  el('propertyEnergyValidUntil').value = p.energy_label_valid_until || '';
  el('propertyRentIncreaseMonth').value = p.rent_increase_month || '';
  el('propertyScopeValidUntil').value = p.scope_valid_until || '';

  el('tenantName').value = r.huurder === '-' ? '' : r.huurder;
  el('tenantEmail').value = r.email || '';
  el('tenantPhone').value = r.telefoon || '';

  el('contractStart').value = r.startdatum_contract || '';
  el('contractEnd').value = r.einddatum_contract || '';
  el('contractNotice').value = r.opzegdatum || '';
  el('contractRent').value = r.huur_pm || '';
  el('contractStatus').value = r.contract_status || 'Actief';

  el('maintenanceTitle').value = r.onderhoud_titel || '';
  el('maintenanceDescription').value = r.onderhoud_description || '';
  el('maintenanceDate').value = r.scope_inspectie_geldig_tot || '';
  el('maintenanceCost').value = r.onderhoud_cost || '';
  el('maintenanceStatus').value = r.onderhoud_status || 'Open';
  el('maintenancePriority').value = r.onderhoud_priority || 'Normaal';

  el('deletePropertyBtn').classList.remove('hidden');
  el('propertyModal').classList.remove('hidden');
};

function closeModal() {
  el('propertyModal').classList.add('hidden');
}

async function saveCombined(e) {
  e.preventDefault();
  setMessage('Bezig met opslaan...');

  try {
    const propertyPayload = {
      name: valOrNull('propertyName'),
      address: valOrNull('propertyAddress'),
      house_number: valOrNull('propertyHouseNumber'),
      city: valOrNull('propertyCity'),
      property_type: valOrNull('propertyType'),
      status: valOrNull('propertyStatus') || 'Actief',
      monthly_rent: numOrNull(el('propertyMonthlyRent').value),
      yearly_rent: numOrNull(el('propertyYearlyRent').value),
      service_costs: numOrNull(el('propertyServiceCosts').value),
      deposit: numOrNull(el('propertyDeposit').value),
      energy_label: valOrNull('propertyEnergyLabel'),
      energy_label_valid_until: valOrNull('propertyEnergyValidUntil'),
      rent_increase_month: valOrNull('propertyRentIncreaseMonth'),
      scope_valid_until: valOrNull('propertyScopeValidUntil')
    };

    let propertyId = el('propertyId').value;
    let propertyResult = propertyId
      ? await sb.from('properties').update(propertyPayload).eq('id', propertyId).select().single()
      : await sb.from('properties').insert(propertyPayload).select().single();
    if (propertyResult.error) throw propertyResult.error;
    propertyId = propertyResult.data.id;

    let tenantId = el('tenantId').value;
    const tenantName = valOrNull('tenantName');
    if (tenantName) {
      const tenantPayload = { name: tenantName, email: valOrNull('tenantEmail'), phone: valOrNull('tenantPhone') };
      const tenantResult = tenantId
        ? await sb.from('tenants').update(tenantPayload).eq('id', tenantId).select().single()
        : await sb.from('tenants').insert(tenantPayload).select().single();
      if (tenantResult.error) throw tenantResult.error;
      tenantId = tenantResult.data.id;
    }

    const hasContract = tenantId || valOrNull('contractStart') || valOrNull('contractEnd') || valOrNull('contractNotice') || valOrNull('contractRent');
    let contractId = el('contractId').value;
    if (hasContract) {
      const contractPayload = {
        property_id: propertyId,
        tenant_id: tenantId || null,
        start_date: valOrNull('contractStart'),
        end_date: valOrNull('contractEnd'),
        notice_date: valOrNull('contractNotice'),
        monthly_rent: numOrNull(el('contractRent').value),
        status: valOrNull('contractStatus') || 'Actief'
      };
      const contractResult = contractId
        ? await sb.from('contracts').update(contractPayload).eq('id', contractId).select().single()
        : await sb.from('contracts').insert(contractPayload).select().single();
      if (contractResult.error) throw contractResult.error;
    }

    const hasMaintenance = valOrNull('maintenanceTitle') || valOrNull('maintenanceDate') || valOrNull('maintenanceDescription') || valOrNull('maintenanceCost');
    let maintenanceId = el('maintenanceId').value;
    if (hasMaintenance) {
      const maintenancePayload = {
        property_id: propertyId,
        title: valOrNull('maintenanceTitle') || 'Onderhoud',
        description: valOrNull('maintenanceDescription'),
        planned_date: valOrNull('maintenanceDate'),
        cost: numOrNull(el('maintenanceCost').value),
        status: valOrNull('maintenanceStatus') || 'Open',
        priority: valOrNull('maintenancePriority') || 'Normaal'
      };
      const maintenanceResult = maintenanceId
        ? await sb.from('maintenance').update(maintenancePayload).eq('id', maintenanceId).select().single()
        : await sb.from('maintenance').insert(maintenancePayload).select().single();
      if (maintenanceResult.error) throw maintenanceResult.error;
    }

    setMessage('Opgeslagen.', 'ok');
    await loadData();
    setTimeout(closeModal, 500);
  } catch (error) {
    console.error(error);
    setMessage(error.message, 'error');
  }
}

async function deleteProperty() {
  const propertyId = el('propertyId').value;
  if (!propertyId || !confirm('Weet je zeker dat je dit object met gekoppeld contract en onderhoud wilt verwijderen?')) return;
  setMessage('Bezig met verwijderen...');
  try {
    await sb.from('maintenance').delete().eq('property_id', propertyId);
    await sb.from('contracts').delete().eq('property_id', propertyId);
    const { error } = await sb.from('properties').delete().eq('id', propertyId);
    if (error) throw error;
    await loadData();
    closeModal();
  } catch (error) {
    console.error(error);
    setMessage(error.message, 'error');
  }
}

function initNavigation() {
  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach(n => n.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    el(btn.dataset.page).classList.add('active');
    el('pageTitle').textContent = btn.textContent;
  }));
}

function init() {
  if (!window.supabase) {
    el('loginError').textContent = 'Supabase library niet geladen. Ververs de pagina.';
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  initNavigation();

  el('loginBtn').addEventListener('click', async () => {
    el('loginError').textContent = 'Bezig met inloggen...';
    const email = el('email').value.trim();
    const password = el('password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      el('loginError').textContent = 'Inloggen mislukt: ' + error.message;
      return;
    }
    el('loginError').textContent = '';
    showApp();
    await loadData();
  });

  el('password').addEventListener('keydown', e => { if (e.key === 'Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); vastgoedData = []; showLogin(); });
  el('search').addEventListener('input', e => { query = e.target.value; render(); });
  el('newPropertyBtn').addEventListener('click', openNewProperty);
  el('closePropertyModalBtn').addEventListener('click', closeModal);
  el('propertyForm').addEventListener('submit', saveCombined);
  el('deletePropertyBtn').addEventListener('click', deleteProperty);

  checkSession();
}

document.addEventListener('DOMContentLoaded', init);
