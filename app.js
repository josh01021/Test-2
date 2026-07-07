const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';

let sb, query = '', vastgoedData = [], rawProperties = [], rawContracts = [], rawTenants = [], rawMaintenance = [];
const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const el = id => document.getElementById(id);

function daysUntil(dateString){ if(!dateString) return null; const d=new Date(dateString); if(Number.isNaN(d.getTime())) return null; const t=new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.ceil((d-t)/(1000*60*60*24)); }
function getDateStatus(dateString, warningDays=365, dangerDays=90){ const days=daysUntil(dateString); if(days===null) return ['Controle nodig','warning']; if(days<0) return ['Verlopen','danger']; if(days<=dangerDays) return [`Binnen ${dangerDays} dagen`,'danger']; if(days<=warningDays) return [`Binnen ${warningDays} dagen`,'warning']; return ['Op orde','ok']; }

function normalize(properties, contracts, tenants, maintenance){
  const tenantById=Object.fromEntries(tenants.map(t=>[t.id,t]));
  const contractsByProperty={}; contracts.forEach(c=>{(contractsByProperty[c.property_id] ||= []).push(c)});
  const maintenanceByProperty={}; maintenance.forEach(m=>{(maintenanceByProperty[m.property_id] ||= []).push(m)});
  return properties.map(p=>{
    const contract=(contractsByProperty[p.id]||[])[0]||{};
    const tenant=tenantById[contract.tenant_id]||{};
    const plannedMaintenance=(maintenanceByProperty[p.id]||[])[0]||{};
    const objectName=p.name || [p.address,p.house_number].filter(Boolean).join(' ') || 'Onbekend object';
    const rentPm=p.monthly_rent ?? contract.monthly_rent ?? 0;
    const rentPj=p.yearly_rent ?? (Number(rentPm||0)*12);
    const contractEnd=contract.end_date || p.end_date;
    const noticeDate=contract.notice_date || p.notice_date;
    const scopeDate=p.scope_valid_until || plannedMaintenance.planned_date;
    return {id:p.id, object:objectName, straatnaam:p.address||'', huisnummer:p.house_number||'', stad:p.city||'', huurder:tenant.name||p.tenant_name||'-', email:tenant.email||p.email||'', telefoon:tenant.phone||p.phone||'', huur_pm:rentPm, huur_pj:rentPj, servicekosten:p.service_costs||0, waarborgsom:p.deposit||0, energielabel:p.energy_label||'-', energielabel_geldig_tot:p.energy_label_valid_until||'', maand_huurverhoging:p.rent_increase_month||'', einddatum_contract:contractEnd, opzegdatum:noticeDate, scope_inspectie_geldig_tot:scopeDate, onderhoud_titel:plannedMaintenance.title||'Scope-inspectie', status_contract:getDateStatus(contractEnd,365,90), status_opzeg:getDateStatus(noticeDate,365,90), status_scope:getDateStatus(scopeDate,365,90)};
  });
}
function showLogin(){ el('loginView').classList.remove('hidden'); el('appView').classList.add('hidden'); }
function showApp(){ el('loginView').classList.add('hidden'); el('appView').classList.remove('hidden'); }
async function checkSession(){ const {data}=await sb.auth.getSession(); if(data.session){showApp(); await loadData();} else showLogin(); }
async function loadData(){
  try{
    const [pr,cr,tr,mr]=await Promise.all([sb.from('properties').select('*').order('created_at',{ascending:false}), sb.from('contracts').select('*'), sb.from('tenants').select('*'), sb.from('maintenance').select('*')]);
    [pr,cr,tr,mr].forEach(r=>{if(r.error) throw r.error});
    rawProperties=pr.data||[]; rawContracts=cr.data||[]; rawTenants=tr.data||[]; rawMaintenance=mr.data||[];
    vastgoedData=normalize(rawProperties, rawContracts, rawTenants, rawMaintenance);
    el('statusText').textContent=`Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render();
  }catch(error){ console.error(error); el('statusText').textContent='Kan data niet laden.'; el('attentionList').innerHTML=`<div class="alert danger"><strong>Fout bij laden</strong>${error.message}</div>`; }
}
function filtered(){ return vastgoedData.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase())); }
function notificationItems(data){ const items=[]; data.forEach(r=>{ if(r.status_opzeg[1]!=='ok') items.push({sev:r.status_opzeg[1],title:`Opzegdatum: ${r.object}`,text:`Opzegdatum ${dateFmt(r.opzegdatum)}. Contract eindigt op ${dateFmt(r.einddatum_contract)}.`}); if(r.status_contract[1]!=='ok') items.push({sev:r.status_contract[1],title:`Contract: ${r.object}`,text:`Contractstatus: ${r.status_contract[0]}. Einddatum ${dateFmt(r.einddatum_contract)}.`}); if(r.status_scope[1]!=='ok') items.push({sev:r.status_scope[1],title:`Onderhoud/inspectie: ${r.object}`,text:`Datum: ${dateFmt(r.scope_inspectie_geldig_tot)}.`}); }); return items; }
function render(){
  const data=filtered(), notes=notificationItems(data);
  el('totalObjects').textContent=data.length; el('totalRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pj||0),0)); el('urgentCount').textContent=notes.filter(n=>n.sev==='danger').length; el('contractSoon').textContent=data.filter(r=>r.status_contract[1]!=='ok').length;
  el('attentionList').innerHTML=notes.slice(0,5).map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  el('notificationList').innerHTML=notes.map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen meldingen gevonden.</p>';
  el('objectGrid').innerHTML=data.map(r=>`<article class="objectCard"><h3>${r.object}</h3><div class="meta">Huurder: ${r.huurder}</div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Energielabel</span><strong>${r.energielabel}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Opzegdatum</span>${statusBadge(r.status_opzeg)}</div><div class="row"><span>Onderhoud/inspectie</span>${statusBadge(r.status_scope)}</div><button class="smallBtn" onclick="openEditProperty('${r.id}')">Bewerken</button></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  el('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  el('maintenanceTable').innerHTML=`<tr><th>Object</th><th>Type</th><th>Datum</th><th>Status</th><th>Actie</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.onderhoud_titel}</td><td>${dateFmt(r.scope_inspectie_geldig_tot)}</td><td>${statusBadge(r.status_scope)}</td><td>Plan controle / inspectie</td></tr>`).join('');
}
function openNewProperty(){ el('modalTitle').textContent='Nieuw object'; el('propertyForm').reset(); el('propertyId').value=''; el('propertyStatus').value='Actief'; el('deletePropertyBtn').classList.add('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
window.openEditProperty=function(id){ const p=rawProperties.find(x=>x.id===id); if(!p)return; el('modalTitle').textContent='Object bewerken'; el('propertyId').value=p.id; el('propertyName').value=p.name||''; el('propertyAddress').value=p.address||''; el('propertyHouseNumber').value=p.house_number||''; el('propertyCity').value=p.city||''; el('propertyType').value=p.property_type||''; el('propertyStatus').value=p.status||'Actief'; el('propertyMonthlyRent').value=p.monthly_rent||''; el('propertyYearlyRent').value=p.yearly_rent||''; el('propertyServiceCosts').value=p.service_costs||''; el('propertyDeposit').value=p.deposit||''; el('propertyEnergyLabel').value=p.energy_label||''; el('propertyEnergyValidUntil').value=p.energy_label_valid_until||''; el('propertyRentIncreaseMonth').value=p.rent_increase_month||''; el('propertyScopeValidUntil').value=p.scope_valid_until||''; el('deletePropertyBtn').classList.remove('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
function closeModal(){ el('propertyModal').classList.add('hidden'); }
const numOrNull=v=>v===''||v===null?null:Number(v);
async function saveProperty(e){ e.preventDefault(); const id=el('propertyId').value; const payload={name:el('propertyName').value,address:el('propertyAddress').value||null,house_number:el('propertyHouseNumber').value||null,city:el('propertyCity').value||null,property_type:el('propertyType').value||null,status:el('propertyStatus').value||'Actief',monthly_rent:numOrNull(el('propertyMonthlyRent').value),yearly_rent:numOrNull(el('propertyYearlyRent').value),service_costs:numOrNull(el('propertyServiceCosts').value),deposit:numOrNull(el('propertyDeposit').value),energy_label:el('propertyEnergyLabel').value||null,energy_label_valid_until:el('propertyEnergyValidUntil').value||null,rent_increase_month:el('propertyRentIncreaseMonth').value||null,scope_valid_until:el('propertyScopeValidUntil').value||null}; const result=id?await sb.from('properties').update(payload).eq('id',id):await sb.from('properties').insert(payload); if(result.error){el('formMessage').textContent=result.error.message;return;} closeModal(); await loadData(); }
async function deleteProperty(){ const id=el('propertyId').value; if(!id || !confirm('Weet je zeker dat je dit object wilt verwijderen?')) return; const {error}=await sb.from('properties').delete().eq('id',id); if(error){el('formMessage').textContent=error.message;return;} closeModal(); await loadData(); }
function init(){
  if(!window.supabase){ el('loginError').textContent='Supabase library niet geladen. Ververs de pagina.'; return; }
  sb=window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.nav').forEach(n=>n.classList.remove('active')); btn.classList.add('active'); document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); el(btn.dataset.page).classList.add('active'); el('pageTitle').textContent=btn.textContent; }));
  el('loginBtn').addEventListener('click', async()=>{ el('loginError').textContent='Bezig met inloggen...'; const email=el('email').value.trim(); const password=el('password').value; const {error}=await sb.auth.signInWithPassword({email,password}); if(error){ el('loginError').textContent='Inloggen mislukt: '+error.message; return;} el('loginError').textContent=''; showApp(); await loadData(); });
  el('password').addEventListener('keydown', e=>{ if(e.key==='Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut(); vastgoedData=[]; showLogin(); });
  el('search').addEventListener('input', e=>{ query=e.target.value; render(); });
  el('newPropertyBtn').addEventListener('click', openNewProperty); el('closeModalBtn').addEventListener('click', closeModal); el('propertyForm').addEventListener('submit', saveProperty); el('deletePropertyBtn').addEventListener('click', deleteProperty);
  checkSession();
}
document.addEventListener('DOMContentLoaded', init);
