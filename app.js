const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';

let sb, query = '', vastgoedData = [], rawProperties = [], rawContracts = [], rawTenants = [], rawMaintenance = [], selectedPropertyId = null;
const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const el = id => document.getElementById(id);

function daysUntil(dateString){ if(!dateString) return null; const d=new Date(dateString); if(Number.isNaN(d.getTime())) return null; const t=new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.ceil((d-t)/(1000*60*60*24)); }
function getDateStatus(dateString, warningDays=365, dangerDays=90){ const days=daysUntil(dateString); if(days===null) return ['Controle nodig','warning']; if(days<0) return ['Verlopen','danger']; if(days<=dangerDays) return [`Binnen ${dangerDays} dagen`,'danger']; if(days<=warningDays) return [`Binnen ${warningDays} dagen`,'warning']; return ['Op orde','ok']; }
const monthMap={januari:0,februari:1,maart:2,april:3,mei:4,juni:5,juli:6,augustus:7,september:8,oktober:9,november:10,december:11};
function daysUntilRentIncrease(monthName){ if(!monthName) return null; const key=String(monthName).trim().toLowerCase(); if(!(key in monthMap)) return null; const today=new Date(); today.setHours(0,0,0,0); let target=new Date(today.getFullYear(), monthMap[key], 1); if(target<today) target=new Date(today.getFullYear()+1, monthMap[key], 1); return Math.ceil((target-today)/(1000*60*60*24)); }
function rentIncreaseStatus(monthName){ const days=daysUntilRentIncrease(monthName); if(days===null) return ['Niet ingesteld','warning']; if(days<=30) return ['Deze maand/komende 30 dagen','danger']; if(days<=60) return ['Binnen 60 dagen','warning']; return ['Op orde','ok']; }
function actionItem(sev,type,title,text,objectId){ return {sev,type,title,text,objectId}; }
function setPage(pageId, title){ document.querySelectorAll('.page').forEach(p=>p.classList.remove('active')); el(pageId).classList.add('active'); document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active', n.dataset.page===pageId)); el('pageTitle').textContent=title || pageId; }

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
    return {id:p.id, property:p, contract, tenant, maintenance:plannedMaintenance, object:objectName, straatnaam:p.address||'', huisnummer:p.house_number||'', stad:p.city||'', type:p.property_type||'-', status:p.status||'-', huurder:tenant.name||p.tenant_name||'-', email:tenant.email||p.email||'', telefoon:tenant.phone||p.phone||'', huur_pm:rentPm, huur_pj:rentPj, servicekosten:p.service_costs||0, waarborgsom:p.deposit||0, energielabel:p.energy_label||'-', energielabel_geldig_tot:p.energy_label_valid_until||'', maand_huurverhoging:p.rent_increase_month||'', einddatum_contract:contractEnd, startdatum_contract:contract.start_date||'', opzegdatum:noticeDate, scope_inspectie_geldig_tot:scopeDate, onderhoud_titel:plannedMaintenance.title||'Scope-inspectie', onderhoud_status:plannedMaintenance.status||'-', onderhoud_kosten:plannedMaintenance.cost||0, onderhoud_prioriteit:plannedMaintenance.priority||'-', onderhoud_omschrijving:plannedMaintenance.description||'', status_contract:getDateStatus(contractEnd,365,90), status_opzeg:getDateStatus(noticeDate,365,90), status_scope:getDateStatus(scopeDate,365,90), status_energy:getDateStatus(p.energy_label_valid_until,180,60), status_rent_increase:rentIncreaseStatus(p.rent_increase_month)};
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
    render(); if(selectedPropertyId) renderDetail(selectedPropertyId);
  }catch(error){ console.error(error); el('statusText').textContent='Kan data niet laden.'; el('attentionList').innerHTML=`<div class="alert danger"><strong>Fout bij laden</strong>${error.message}</div>`; }
}
function filtered(){ return vastgoedData.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase())); }
function notificationItems(data){
  const items=[];
  data.forEach(r=>{
    const contractDays=daysUntil(r.einddatum_contract);
    const noticeDays=daysUntil(r.opzegdatum);
    const maintenanceDays=daysUntil(r.scope_inspectie_geldig_tot);
    const energyDays=daysUntil(r.energielabel_geldig_tot);
    const rentIncreaseDays=daysUntilRentIncrease(r.maand_huurverhoging);
    const isVacant=String(r.status||'').toLowerCase().includes('leeg') || String(r.huurder||'').trim()==='-';

    if(isVacant) items.push(actionItem('danger','Leegstand',`Geen huurder: ${r.object}`,'Controleer of dit object leegstaat of koppel een huurder.',r.id));
    if(!r.contract || !r.contract.id) items.push(actionItem('warning','Contract',`Geen contract gekoppeld: ${r.object}`,'Voeg een contract toe zodat einddatum en opzegdatum bewaakt worden.',r.id));

    if(contractDays!==null){
      if(contractDays<0) items.push(actionItem('danger','Contract',`Contract verlopen: ${r.object}`,`Einddatum was ${dateFmt(r.einddatum_contract)}.`,r.id));
      else if(contractDays<=90) items.push(actionItem('danger','Contract',`Contract verloopt binnen ${contractDays} dagen`,`${r.object} eindigt op ${dateFmt(r.einddatum_contract)}.`,r.id));
      else if(contractDays<=365) items.push(actionItem('warning','Contract',`Contract verloopt binnen 12 maanden`,`${r.object} eindigt op ${dateFmt(r.einddatum_contract)}.`,r.id));
    }

    if(noticeDays!==null){
      if(noticeDays<0) items.push(actionItem('danger','Opzegdatum',`Opzegdatum verlopen: ${r.object}`,`Opzegdatum was ${dateFmt(r.opzegdatum)}.`,r.id));
      else if(noticeDays<=90) items.push(actionItem('danger','Opzegdatum',`Opzegdatum binnen ${noticeDays} dagen`,`${r.object}: opzegdatum ${dateFmt(r.opzegdatum)}.`,r.id));
      else if(noticeDays<=365) items.push(actionItem('warning','Opzegdatum',`Opzegdatum binnen 12 maanden`,`${r.object}: opzegdatum ${dateFmt(r.opzegdatum)}.`,r.id));
    }

    if(maintenanceDays!==null){
      if(maintenanceDays<0) items.push(actionItem('danger','Onderhoud',`Onderhoud/inspectie verlopen: ${r.object}`,`Datum was ${dateFmt(r.scope_inspectie_geldig_tot)}.`,r.id));
      else if(maintenanceDays<=30) items.push(actionItem('danger','Onderhoud',`Onderhoud binnen ${maintenanceDays} dagen`,`${r.object}: ${r.onderhoud_titel} op ${dateFmt(r.scope_inspectie_geldig_tot)}.`,r.id));
      else if(maintenanceDays<=90) items.push(actionItem('warning','Onderhoud',`Onderhoud binnen 90 dagen`,`${r.object}: ${r.onderhoud_titel} op ${dateFmt(r.scope_inspectie_geldig_tot)}.`,r.id));
    }

    if(energyDays!==null){
      if(energyDays<0) items.push(actionItem('danger','Energielabel',`Energielabel verlopen: ${r.object}`,`Geldig tot ${dateFmt(r.energielabel_geldig_tot)}.`,r.id));
      else if(energyDays<=60) items.push(actionItem('danger','Energielabel',`Energielabel binnen ${energyDays} dagen`,`${r.object}: geldig tot ${dateFmt(r.energielabel_geldig_tot)}.`,r.id));
      else if(energyDays<=180) items.push(actionItem('warning','Energielabel',`Energielabel binnen 180 dagen`,`${r.object}: geldig tot ${dateFmt(r.energielabel_geldig_tot)}.`,r.id));
    }

    if(rentIncreaseDays!==null){
      if(rentIncreaseDays<=30) items.push(actionItem('danger','Huurverhoging',`Huurverhoging deze maand: ${r.object}`,`Maand huurverhoging: ${r.maand_huurverhoging}.`,r.id));
      else if(rentIncreaseDays<=60) items.push(actionItem('warning','Huurverhoging',`Huurverhoging binnen 60 dagen`,`${r.object}: maand ${r.maand_huurverhoging}.`,r.id));
    }
  });
  const score={danger:0,warning:1,ok:2};
  return items.sort((a,b)=>(score[a.sev]??9)-(score[b.sev]??9));
}
function actionHtml(n){ return `<div class="alert ${n.sev}"><strong><span class="typeTag">${n.type}</span> ${n.title}</strong><span>${n.text}</span>${n.objectId?`<button class="miniLink detailBtn" data-id="${n.objectId}">Bekijk object</button>`:''}</div>`; }
function render(){
  const data=filtered(), notes=notificationItems(data);
  el('totalObjects').textContent=data.length;
  el('totalMonthlyRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pm||0),0));
  el('totalRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pj||0),0));
  el('urgentCount').textContent=notes.filter(n=>n.sev==='danger').length;
  el('contractSoon').textContent=data.filter(r=>{const d=daysUntil(r.einddatum_contract); return d!==null && d<=365;}).length;
  if(el('maintenanceSoon')) el('maintenanceSoon').textContent=data.filter(r=>{const d=daysUntil(r.scope_inspectie_geldig_tot); return d!==null && d<=90;}).length;
  if(el('energySoon')) el('energySoon').textContent=data.filter(r=>{const d=daysUntil(r.energielabel_geldig_tot); return d!==null && d<=180;}).length;
  if(el('vacancyCount')) el('vacancyCount').textContent=data.filter(r=>String(r.status||'').toLowerCase().includes('leeg') || r.huurder==='-').length;
  el('attentionList').innerHTML=notes.slice(0,10).map(actionHtml).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  el('notificationList').innerHTML=notes.map(actionHtml).join('') || '<p>Geen meldingen gevonden.</p>';
  el('objectGrid').innerHTML=data.map(r=>`<article class="objectCard"><h3>${r.object}</h3><div class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad}</div><div class="row"><span>Huurder</span><strong>${r.huurder}</strong></div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Onderhoud</span>${statusBadge(r.status_scope)}</div><button class="smallBtn detailBtn" data-id="${r.id}">Details</button><button class="smallBtn editBtn" data-id="${r.id}">Bewerken</button></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  el('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Startdatum</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.startdatum_contract)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  el('maintenanceTable').innerHTML=`<tr><th>Object</th><th>Type</th><th>Datum</th><th>Kosten</th><th>Status</th><th>Prioriteit</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.onderhoud_titel}</td><td>${dateFmt(r.scope_inspectie_geldig_tot)}</td><td>${euro(r.onderhoud_kosten)}</td><td>${statusBadge(r.status_scope)}</td><td>${r.onderhoud_prioriteit}</td></tr>`).join('');
}
function renderDetail(id){
  selectedPropertyId=id; const r=vastgoedData.find(x=>x.id===id); if(!r){ el('detailContent').innerHTML='<p>Object niet gevonden.</p>'; return; }
  el('detailContent').innerHTML=`<div class="detailHero"><div class="detailHeroTop"><div><h2>${r.object}</h2><p class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad} • ${r.type} • ${r.status}</p></div><div class="detailActions"><button class="secondaryBtn editBtn" data-id="${r.id}">Bewerken</button></div></div></div><div class="detailGrid"><section class="detailSection"><h3>Algemeen</h3>${kv('Adres',`${r.straatnaam} ${r.huisnummer}`)}${kv('Stad',r.stad)}${kv('Type',r.type)}${kv('Status',r.status)}${kv('Energielabel',r.energielabel)}${kv('Energielabel geldig tot',dateFmt(r.energielabel_geldig_tot))}${kv('Status energielabel',statusBadge(r.status_energy))}</section><section class="detailSection"><h3>Financieel</h3>${kv('Maandhuur',euro(r.huur_pm))}${kv('Jaarhuur',euro(r.huur_pj))}${kv('Servicekosten',euro(r.servicekosten))}${kv('Waarborgsom',euro(r.waarborgsom))}${kv('Huurverhoging',r.maand_huurverhoging||'-')}</section><section class="detailSection"><h3>Huurder</h3>${r.huurder==='-'?'<p class="empty">Geen huurder gekoppeld.</p>':`${kv('Naam',r.huurder)}${kv('E-mail',r.email||'-')}${kv('Telefoon',r.telefoon||'-')}`}</section><section class="detailSection"><h3>Contract</h3>${kv('Startdatum',dateFmt(r.startdatum_contract))}${kv('Einddatum',dateFmt(r.einddatum_contract))}${kv('Opzegdatum',dateFmt(r.opzegdatum))}${kv('Status contract',statusBadge(r.status_contract))}${kv('Status opzegdatum',statusBadge(r.status_opzeg))}</section><section class="detailSection"><h3>Onderhoud</h3>${kv('Type',r.onderhoud_titel)}${kv('Datum',dateFmt(r.scope_inspectie_geldig_tot))}${kv('Status',statusBadge(r.status_scope))}${kv('Prioriteit',r.onderhoud_prioriteit)}${kv('Kosten',euro(r.onderhoud_kosten))}${kv('Beschrijving',r.onderhoud_omschrijving||'-')}</section><section class="detailSection"><h3>Documenten</h3><p class="empty">Documentupload komt in een latere versie.</p></section></div>`;
  setPage('detail', r.object);
}
function kv(label,value){return `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`}
function openNewProperty(){ selectedPropertyId=null; el('modalTitle').textContent='Nieuw object'; el('propertyForm').reset(); ['propertyId','tenantId','contractId','maintenanceId'].forEach(id=>el(id).value=''); el('propertyStatus').value='Actief'; el('contractStatus').value='Actief'; el('maintenanceStatus').value='Open'; el('maintenancePriority').value='Normaal'; el('deletePropertyBtn').classList.add('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
function openEditProperty(id){ const r=vastgoedData.find(x=>x.id===id); if(!r)return; const p=r.property,c=r.contract||{},t=r.tenant||{},m=r.maintenance||{}; el('modalTitle').textContent='Object bewerken'; el('propertyId').value=p.id||''; el('tenantId').value=t.id||''; el('contractId').value=c.id||''; el('maintenanceId').value=m.id||''; el('propertyName').value=p.name||''; el('propertyAddress').value=p.address||''; el('propertyHouseNumber').value=p.house_number||''; el('propertyCity').value=p.city||''; el('propertyType').value=p.property_type||''; el('propertyStatus').value=p.status||'Actief'; el('propertyMonthlyRent').value=p.monthly_rent||''; el('propertyYearlyRent').value=p.yearly_rent||''; el('propertyServiceCosts').value=p.service_costs||''; el('propertyDeposit').value=p.deposit||''; el('propertyEnergyLabel').value=p.energy_label||''; el('propertyEnergyValidUntil').value=p.energy_label_valid_until||''; el('propertyRentIncreaseMonth').value=p.rent_increase_month||''; el('propertyScopeValidUntil').value=p.scope_valid_until||''; el('tenantName').value=t.name||''; el('tenantEmail').value=t.email||''; el('tenantPhone').value=t.phone||''; el('contractStartDate').value=c.start_date||''; el('contractEndDate').value=c.end_date||''; el('contractNoticeDate').value=c.notice_date||''; el('contractStatus').value=c.status||'Actief'; el('maintenanceTitle').value=m.title||''; el('maintenancePlannedDate').value=m.planned_date||''; el('maintenanceCost').value=m.cost||''; el('maintenancePriority').value=m.priority||'Normaal'; el('maintenanceStatus').value=m.status||'Open'; el('maintenanceDescription').value=m.description||''; el('deletePropertyBtn').classList.remove('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
window.openEditProperty=openEditProperty;
function closeModal(){ el('propertyModal').classList.add('hidden'); }
const numOrNull=v=>v===''||v===null?null:Number(v);
async function upsertEntity(table,id,payload){ if(id) return sb.from(table).update(payload).eq('id',id).select().single(); return sb.from(table).insert(payload).select().single(); }
async function saveProperty(e){
  e.preventDefault(); el('formMessage').textContent='Bezig met opslaan...';
  const propertyId=el('propertyId').value, tenantId=el('tenantId').value, contractId=el('contractId').value, maintenanceId=el('maintenanceId').value;
  const propertyPayload={name:el('propertyName').value,address:el('propertyAddress').value||null,house_number:el('propertyHouseNumber').value||null,city:el('propertyCity').value||null,property_type:el('propertyType').value||null,status:el('propertyStatus').value||'Actief',monthly_rent:numOrNull(el('propertyMonthlyRent').value),yearly_rent:numOrNull(el('propertyYearlyRent').value),service_costs:numOrNull(el('propertyServiceCosts').value),deposit:numOrNull(el('propertyDeposit').value),energy_label:el('propertyEnergyLabel').value||null,energy_label_valid_until:el('propertyEnergyValidUntil').value||null,rent_increase_month:el('propertyRentIncreaseMonth').value||null,scope_valid_until:el('propertyScopeValidUntil').value||null};
  const propRes=await upsertEntity('properties',propertyId,propertyPayload); if(propRes.error){el('formMessage').textContent=propRes.error.message;return;} const savedProperty=propRes.data;
  let savedTenant=null; if(el('tenantName').value.trim()){ const tenantPayload={name:el('tenantName').value.trim(),email:el('tenantEmail').value||null,phone:el('tenantPhone').value||null}; const tenRes=await upsertEntity('tenants',tenantId,tenantPayload); if(tenRes.error){el('formMessage').textContent=tenRes.error.message;return;} savedTenant=tenRes.data; }
  if(el('contractStartDate').value || el('contractEndDate').value || el('contractNoticeDate').value || savedTenant){ const contractPayload={property_id:savedProperty.id,tenant_id:savedTenant?.id || null,start_date:el('contractStartDate').value||null,end_date:el('contractEndDate').value||null,notice_date:el('contractNoticeDate').value||null,monthly_rent:numOrNull(el('propertyMonthlyRent').value),status:el('contractStatus').value||'Actief'}; const conRes=await upsertEntity('contracts',contractId,contractPayload); if(conRes.error){el('formMessage').textContent=conRes.error.message;return;} }
  if(el('maintenanceTitle').value.trim() || el('maintenancePlannedDate').value){ const maintenancePayload={property_id:savedProperty.id,title:el('maintenanceTitle').value.trim()||'Onderhoud',description:el('maintenanceDescription').value||null,planned_date:el('maintenancePlannedDate').value||el('propertyScopeValidUntil').value||null,cost:numOrNull(el('maintenanceCost').value),priority:el('maintenancePriority').value||'Normaal',status:el('maintenanceStatus').value||'Open'}; const mainRes=await upsertEntity('maintenance',maintenanceId,maintenancePayload); if(mainRes.error){el('formMessage').textContent=mainRes.error.message;return;} }
  closeModal(); selectedPropertyId=savedProperty.id; await loadData(); renderDetail(savedProperty.id);
}
async function deleteProperty(){ const id=el('propertyId').value; if(!id || !confirm('Weet je zeker dat je dit object wilt verwijderen?')) return; const {error}=await sb.from('properties').delete().eq('id',id); if(error){el('formMessage').textContent=error.message;return;} closeModal(); selectedPropertyId=null; await loadData(); setPage('objecten','Objecten'); }
function init(){
  if(!window.supabase){ el('loginError').textContent='Supabase library niet geladen. Ververs de pagina.'; return; }
  sb=window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{ selectedPropertyId=null; setPage(btn.dataset.page,btn.textContent); }));
  document.body.addEventListener('click', e=>{ const detail=e.target.closest('.detailBtn'); const edit=e.target.closest('.editBtn'); if(detail) renderDetail(detail.dataset.id); if(edit) openEditProperty(edit.dataset.id); });
  el('loginBtn').addEventListener('click', async()=>{ el('loginError').textContent='Bezig met inloggen...'; const email=el('email').value.trim(); const password=el('password').value; const {error}=await sb.auth.signInWithPassword({email,password}); if(error){ el('loginError').textContent='Inloggen mislukt: '+error.message; return;} el('loginError').textContent=''; showApp(); await loadData(); });
  el('password').addEventListener('keydown', e=>{ if(e.key==='Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut(); vastgoedData=[]; showLogin(); });
  el('search').addEventListener('input', e=>{ query=e.target.value; render(); });
  el('newPropertyBtn').addEventListener('click', openNewProperty); el('backToObjectsBtn').addEventListener('click',()=>{ selectedPropertyId=null; setPage('objecten','Objecten'); }); el('closeModalBtn').addEventListener('click', closeModal); el('propertyForm').addEventListener('submit', saveProperty); el('deletePropertyBtn').addEventListener('click', deleteProperty);
  checkSession();
}
document.addEventListener('DOMContentLoaded', init);
