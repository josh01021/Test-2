const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const pages = document.querySelectorAll('.page');
const navs = document.querySelectorAll('.nav');
let query = '';
let vastgoedData = [];
let rawProperties = [];
let rawContracts = [];
let rawTenants = [];
let rawMaintenance = [];

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

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    showApp();
    await loadData();
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('appView').classList.add('hidden');
}

function showApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
}

async function loadData() {
  const statusText = document.getElementById('statusText');
  try {
    const [propertiesRes, contractsRes, tenantsRes, maintenanceRes] = await Promise.all([
      supabase.from('properties').select('*').order('created_at', { ascending: false }),
      supabase.from('contracts').select('*'),
      supabase.from('tenants').select('*'),
      supabase.from('maintenance').select('*')
    ]);
    [propertiesRes, contractsRes, tenantsRes, maintenanceRes].forEach(res => { if (res.error) throw res.error; });
    rawProperties = propertiesRes.data || [];
    rawContracts = contractsRes.data || [];
    rawTenants = tenantsRes.data || [];
    rawMaintenance = maintenanceRes.data || [];
    vastgoedData = normalize(rawProperties, rawContracts, rawTenants, rawMaintenance);
    statusText.textContent = `Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render();
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Kan Supabase-data niet laden. Controleer RLS/policies.';
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
  document.getElementById('objectGrid').innerHTML=data.map(r=>`<article class="objectCard"><h3>${r.object}</h3><div class="meta">Huurder: ${r.huurder}</div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Energielabel</span><strong>${r.energielabel}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Opzegdatum</span>${statusBadge(r.status_opzeg)}</div><div class="row"><span>Onderhoud/inspectie</span>${statusBadge(r.status_scope)}</div><button class="smallBtn" onclick="openEditProperty('${r.id}')">Bewerken</button></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  document.getElementById('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  document.getElementById('maintenanceTable').innerHTML=`<tr><th>Object</th><th>Type</th><th>Datum</th><th>Status</th><th>Actie</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.onderhoud_titel}</td><td>${dateFmt(r.scope_inspectie_geldig_tot)}</td><td>${statusBadge(r.status_scope)}</td><td>Plan controle / inspectie</td></tr>`).join('');
}

function openNewProperty() {
  document.getElementById('modalTitle').textContent = 'Nieuw object';
  document.getElementById('propertyForm').reset();
  document.getElementById('propertyId').value = '';
  document.getElementById('propertyStatus').value = 'Actief';
  document.getElementById('deletePropertyBtn').classList.add('hidden');
  document.getElementById('formMessage').textContent = '';
  document.getElementById('propertyModal').classList.remove('hidden');
}

window.openEditProperty = function(id) {
  const p = rawProperties.find(item => item.id === id);
  if (!p) return;
  document.getElementById('modalTitle').textContent = 'Object bewerken';
  document.getElementById('propertyId').value = p.id;
  document.getElementById('propertyName').value = p.name || '';
  document.getElementById('propertyAddress').value = p.address || '';
  document.getElementById('propertyHouseNumber').value = p.house_number || '';
  document.getElementById('propertyCity').value = p.city || '';
  document.getElementById('propertyType').value = p.property_type || '';
  document.getElementById('propertyStatus').value = p.status || 'Actief';
  document.getElementById('propertyMonthlyRent').value = p.monthly_rent || '';
  document.getElementById('propertyYearlyRent').value = p.yearly_rent || '';
  document.getElementById('propertyServiceCosts').value = p.service_costs || '';
  document.getElementById('propertyDeposit').value = p.deposit || '';
  document.getElementById('propertyEnergyLabel').value = p.energy_label || '';
  document.getElementById('propertyEnergyValidUntil').value = p.energy_label_valid_until || '';
  document.getElementById('propertyRentIncreaseMonth').value = p.rent_increase_month || '';
  document.getElementById('propertyScopeValidUntil').value = p.scope_valid_until || '';
  document.getElementById('deletePropertyBtn').classList.remove('hidden');
  document.getElementById('formMessage').textContent = '';
  document.getElementById('propertyModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('propertyModal').classList.add('hidden');
}

function numOrNull(value) {
  return value === '' || value === null ? null : Number(value);
}

async function saveProperty(e) {
  e.preventDefault();
  const id = document.getElementById('propertyId').value;
  const payload = {
    name: document.getElementById('propertyName').value,
    address: document.getElementById('propertyAddress').value || null,
    house_number: document.getElementById('propertyHouseNumber').value || null,
    city: document.getElementById('propertyCity').value || null,
    property_type: document.getElementById('propertyType').value || null,
    status: document.getElementById('propertyStatus').value || 'Actief',
    monthly_rent: numOrNull(document.getElementById('propertyMonthlyRent').value),
    yearly_rent: numOrNull(document.getElementById('propertyYearlyRent').value),
    service_costs: numOrNull(document.getElementById('propertyServiceCosts').value),
    deposit: numOrNull(document.getElementById('propertyDeposit').value),
    energy_label: document.getElementById('propertyEnergyLabel').value || null,
    energy_label_valid_until: document.getElementById('propertyEnergyValidUntil').value || null,
    rent_increase_month: document.getElementById('propertyRentIncreaseMonth').value || null,
    scope_valid_until: document.getElementById('propertyScopeValidUntil').value || null
  };
  const result = id
    ? await supabase.from('properties').update(payload).eq('id', id)
    : await supabase.from('properties').insert(payload);
  if (result.error) {
    document.getElementById('formMessage').textContent = result.error.message;
    return;
  }
  closeModal();
  await loadData();
}

async function deleteProperty() {
  const id = document.getElementById('propertyId').value;
  if (!id) return;
  if (!confirm('Weet je zeker dat je dit object wilt verwijderen?')) return;
  const { error } = await supabase.from('properties').delete().eq('id', id);
  if (error) {
    document.getElementById('formMessage').textContent = error.message;
    return;
  }
  closeModal();
  await loadData();
}

navs.forEach(btn=>btn.addEventListener('click',()=>{
  navs.forEach(n=>n.classList.remove('active'));
  btn.classList.add('active');
  pages.forEach(p=>p.classList.remove('active'));
  document.getElementById(btn.dataset.page).classList.add('active');
  document.getElementById('pageTitle').textContent=btn.textContent;
}));

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById('loginError').textContent = 'Inloggen mislukt: ' + error.message;
    return;
  }
  document.getElementById('loginError').textContent = '';
  showApp();
  await loadData();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  vastgoedData = [];
  showLogin();
});

document.getElementById('search').addEventListener('input', e=>{query=e.target.value;render();});
document.getElementById('newPropertyBtn').addEventListener('click', openNewProperty);
document.getElementById('closeModalBtn').addEventListener('click', closeModal);
document.getElementById('propertyForm').addEventListener('submit', saveProperty);
document.getElementById('deletePropertyBtn').addEventListener('click', deleteProperty);

checkSession();
