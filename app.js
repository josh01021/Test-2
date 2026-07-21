const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';

let sb, query = '', maintenanceTypeFilter = '', maintenanceStatusFilter = '', maintenanceObjectFilter = '', vastgoedData = [], rawProperties = [], rawContracts = [], rawTenants = [], rawMaintenance = [], rawDocuments = [], rawMaintenanceHistory = [], selectedPropertyId = null;
const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const pct = n => Number.isFinite(Number(n)) ? `${Number(n).toFixed(1).replace('.', ',')}%` : '-';
const clean = s => String(s || '').trim();
const norm = s => String(s || '').toLowerCase().replace(/\s+/g,' ').trim();
function compareObjectAddress(a,b){
  const streetCompare=String(a.straatnaam||a.address||'').localeCompare(
    String(b.straatnaam||b.address||''),
    'nl',
    {sensitivity:'base', numeric:true}
  );
  if(streetCompare!==0) return streetCompare;

  return String(a.huisnummer||a.house_number||'').localeCompare(
    String(b.huisnummer||b.house_number||''),
    'nl',
    {sensitivity:'base', numeric:true}
  );
}
const el = id => document.getElementById(id);
const signedPhotoCache = {};
const safeFileName = name => String(name || 'bestand').replace(/[^a-zA-Z0-9._-]/g, '_');
const isExternalUrl = value => /^https?:\/\//i.test(String(value || ''));
const escAttr = value => String(value || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escHtml = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

const DEFAULT_BRANDING={
  company_name:'Vastgoed',
  dashboard_name:'Dashboard',
  login_subtitle:'Log in om je vastgoeddata te bekijken.',
  browser_title:'Vastgoed Dashboard',
  primary_color:'#101827',
  accent_color:'#94a3b8',
  logo_url:'',
  favicon_url:''
};
let branding={...DEFAULT_BRANDING};
function validHex(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;}
function setImage(id,url){const node=el(id);if(!node)return;node.classList.toggle('hidden',!url);if(url)node.src=url;else node.removeAttribute('src');}
function applyBranding(next={}){
  branding={...DEFAULT_BRANDING,...next};
  branding.primary_color=validHex(branding.primary_color,DEFAULT_BRANDING.primary_color);
  branding.accent_color=validHex(branding.accent_color,DEFAULT_BRANDING.accent_color);
  document.documentElement.style.setProperty('--brand-primary',branding.primary_color);
  document.documentElement.style.setProperty('--brand-accent',branding.accent_color);
  if(el('sidebarCompanyName')) el('sidebarCompanyName').textContent=branding.company_name;
  if(el('sidebarDashboardName')) el('sidebarDashboardName').textContent=branding.dashboard_name;
  if(el('loginCompanyName')) el('loginCompanyName').textContent=`${branding.company_name} ${branding.dashboard_name}`.trim();
  if(el('loginSubtitle')) el('loginSubtitle').textContent=branding.login_subtitle;
  document.title=branding.browser_title||`${branding.company_name} | ${branding.dashboard_name}`;
  const fav=el('faviconLink'); if(fav) fav.href=branding.favicon_url||'data:,';
  setImage('sidebarLogo',branding.logo_url);setImage('loginLogo',branding.logo_url);setImage('previewLogo',branding.logo_url);
  if(el('previewCompanyName')) el('previewCompanyName').textContent=branding.company_name;
  if(el('previewDashboardName')) el('previewDashboardName').textContent=branding.dashboard_name;
  fillBrandingForm();
}
function fillBrandingForm(){
  if(!el('brandingCompanyName')) return;
  el('brandingCompanyName').value=branding.company_name||'';
  el('brandingDashboardName').value=branding.dashboard_name||'';
  el('brandingLoginSubtitle').value=branding.login_subtitle||'';
  el('brandingBrowserTitle').value=branding.browser_title||'';
  el('brandingPrimaryColor').value=validHex(branding.primary_color,DEFAULT_BRANDING.primary_color);
  el('brandingAccentColor').value=validHex(branding.accent_color,DEFAULT_BRANDING.accent_color);
  el('currentLogoText').textContent=branding.logo_url?'Logo ingesteld':'Nog geen logo ingesteld';
  el('currentFaviconText').textContent=branding.favicon_url?'Favicon ingesteld':'Nog geen favicon ingesteld';
}
async function loadBranding(){
  applyBranding(DEFAULT_BRANDING);
  try{
    const {data,error}=await sb.from('app_settings').select('*').eq('id',1).maybeSingle();
    if(error) throw error;
    if(data) applyBranding(data);
  }catch(error){console.warn('Branding kon niet geladen worden:',error.message);}
}
async function uploadBrandingFile(file,folder){
  if(!file) return null;
  const path=`${folder}/${Date.now()}-${safeFileName(file.name)}`;
  const up=await sb.storage.from('branding').upload(path,file,{upsert:false,cacheControl:'3600'});
  if(up.error) throw up.error;
  const {data}=sb.storage.from('branding').getPublicUrl(path);
  return data.publicUrl;
}
async function saveBranding(e){
  e.preventDefault(); const msg=el('brandingMessage'); msg.textContent='Bezig met opslaan...';
  try{
    const logoFile=el('brandingLogoFile').files?.[0];
    const faviconFile=el('brandingFaviconFile').files?.[0];
    const logoUrl=await uploadBrandingFile(logoFile,'logos')||branding.logo_url||null;
    const faviconUrl=await uploadBrandingFile(faviconFile,'favicons')||branding.favicon_url||null;
    const payload={id:1,company_name:clean(el('brandingCompanyName').value)||DEFAULT_BRANDING.company_name,dashboard_name:clean(el('brandingDashboardName').value)||DEFAULT_BRANDING.dashboard_name,login_subtitle:clean(el('brandingLoginSubtitle').value)||DEFAULT_BRANDING.login_subtitle,browser_title:clean(el('brandingBrowserTitle').value)||null,primary_color:validHex(el('brandingPrimaryColor').value,DEFAULT_BRANDING.primary_color),accent_color:validHex(el('brandingAccentColor').value,DEFAULT_BRANDING.accent_color),logo_url:logoUrl,favicon_url:faviconUrl,updated_at:new Date().toISOString()};
    const res=await sb.from('app_settings').upsert(payload,{onConflict:'id'}).select().single();
    if(res.error) throw res.error;
    el('brandingLogoFile').value='';el('brandingFaviconFile').value='';applyBranding(res.data);msg.textContent='Instellingen opgeslagen.';
  }catch(error){console.error(error);msg.textContent='Opslaan mislukt: '+error.message;}
}
async function resetBranding(){
  if(!confirm('Standaard huisstijl herstellen? Het huidige logo en favicon worden losgekoppeld.')) return;
  const payload={id:1,...DEFAULT_BRANDING,logo_url:null,favicon_url:null,updated_at:new Date().toISOString()};
  const res=await sb.from('app_settings').upsert(payload,{onConflict:'id'}).select().single();
  if(res.error){el('brandingMessage').textContent=res.error.message;return;}
  applyBranding(res.data);el('brandingMessage').textContent='Standaard huisstijl hersteld.';
}
function previewBrandingForm(){
  if(!el('brandingCompanyName')) return;
  document.documentElement.style.setProperty('--brand-primary',validHex(el('brandingPrimaryColor').value,branding.primary_color));
  document.documentElement.style.setProperty('--brand-accent',validHex(el('brandingAccentColor').value,branding.accent_color));
  el('previewCompanyName').textContent=el('brandingCompanyName').value||DEFAULT_BRANDING.company_name;
  el('previewDashboardName').textContent=el('brandingDashboardName').value||DEFAULT_BRANDING.dashboard_name;
}


async function resolvePhotoUrl(value){
  if(!value) return '';
  if(isExternalUrl(value)) return value;
  if(signedPhotoCache[value]) return signedPhotoCache[value];
  const res = await sb.storage.from('property-documents').createSignedUrl(value, 60 * 60);
  if(res.error){ console.warn('Foto kan niet geladen worden', res.error); return ''; }
  signedPhotoCache[value] = res.data.signedUrl;
  return signedPhotoCache[value];
}

async function refreshPhotos(){
  const nodes = [...document.querySelectorAll('[data-photo-path]')];
  await Promise.all(nodes.map(async node => {
    const path = node.dataset.photoPath;
    const url = await resolvePhotoUrl(path);
    if(!url) return;
    if(node.tagName === 'IMG') node.src = url;
    else node.style.backgroundImage = `url('${url}')`;
  }));
}

function photoBox(path, cls, label='Foto pand'){
  if(!path) return `<div class="${cls} photoPlaceholder"><span>Geen foto</span></div>`;
  return `<div class="${cls}" data-photo-path="${escAttr(path)}" aria-label="${escAttr(label)}"></div>`;
}

function daysUntil(dateString){ if(!dateString) return null; const d=new Date(dateString); if(Number.isNaN(d.getTime())) return null; const t=new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.ceil((d-t)/(1000*60*60*24)); }
function getDateStatus(dateString, warningDays=365, dangerDays=90){ const days=daysUntil(dateString); if(days===null) return ['Controle nodig','warning']; if(days<0) return ['Verlopen','danger']; if(days<=dangerDays) return [`Binnen ${dangerDays} dagen`,'danger']; if(days<=warningDays) return [`Binnen ${warningDays} dagen`,'warning']; return ['Op orde','ok']; }
const monthMap={januari:0,februari:1,maart:2,april:3,mei:4,juni:5,juli:6,augustus:7,september:8,oktober:9,november:10,december:11};
function daysUntilRentIncrease(monthName){ if(!monthName) return null; const key=String(monthName).trim().toLowerCase(); if(!(key in monthMap)) return null; const today=new Date(); today.setHours(0,0,0,0); let target=new Date(today.getFullYear(), monthMap[key], 1); if(target<today) target=new Date(today.getFullYear()+1, monthMap[key], 1); return Math.ceil((target-today)/(1000*60*60*24)); }
function rentIncreaseStatus(monthName){ const days=daysUntilRentIncrease(monthName); if(days===null) return ['Niet ingesteld','warning']; if(days<=30) return ['Deze maand/komende 30 dagen','danger']; if(days<=60) return ['Binnen 60 dagen','warning']; return ['Op orde','ok']; }
function actionItem(sev,type,title,text,objectId){ return {sev,type,title,text,objectId}; }
function setPage(pageId, title){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  el(pageId).classList.add('active');
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active', n.dataset.page===pageId));
  el('pageTitle').textContent=title || pageId;

  const csvButton=el('chooseMaintenanceCsvBtn');
  if(csvButton) csvButton.classList.toggle('hidden', pageId!=='onderhoud');
}

function normalize(properties, contracts, tenants, maintenance, documents=[], history=[]){
  const tenantById=Object.fromEntries(tenants.map(t=>[t.id,t]));
  const contractsByProperty={}; contracts.forEach(c=>{(contractsByProperty[c.property_id] ||= []).push(c)});
  const maintenanceByProperty={}; maintenance.forEach(m=>{(maintenanceByProperty[m.property_id] ||= []).push(m)});
  const documentsByProperty={}; documents.forEach(d=>{(documentsByProperty[d.property_id] ||= []).push(d)});
  const historyByProperty={};
  const historyByObjectKey={};
  history.forEach(h=>{
    const key = h.property_id || '';
    if(key) (historyByProperty[key] ||= []).push(h);
    const nameKey = norm(h.property_name);
    const addressKey = norm([h.property_address, h.house_number].filter(Boolean).join(' '));
    if(nameKey) (historyByObjectKey[nameKey] ||= []).push(h);
    if(addressKey) (historyByObjectKey[addressKey] ||= []).push(h);
  });
  return properties.map(p=>{
    const contract=(contractsByProperty[p.id]||[])[0]||{};
    const tenant=tenantById[contract.tenant_id]||{};
    const propertyMaintenance=(maintenanceByProperty[p.id]||[]).slice().sort((a,b)=>String(a.planned_date||'9999-12-31').localeCompare(String(b.planned_date||'9999-12-31')));
    const plannedMaintenance=propertyMaintenance[0]||{};
    const objectName=p.name || [p.address,p.house_number].filter(Boolean).join(' ') || 'Onbekend object';
    const rentPm=p.monthly_rent ?? contract.monthly_rent ?? 0;
    const rentPj=p.yearly_rent ?? (Number(rentPm||0)*12);
    const contractEnd=contract.end_date || p.end_date;
    const noticeDate=contract.notice_date || p.notice_date;
    const scopeDate=p.scope_valid_until || plannedMaintenance.planned_date;
    const purchaseValue = Number(p.purchase_value || 0);
    const grossYield = purchaseValue > 0 ? (Number(rentPj || 0) / purchaseValue) * 100 : null;
    const objectKey = norm(objectName);
    const addressKey = norm([p.address, p.house_number].filter(Boolean).join(' '));
    const matchedHistory = historyByProperty[p.id] || historyByObjectKey[objectKey] || historyByObjectKey[addressKey] || [];
    const maintenanceHistory = [...propertyMaintenance, ...matchedHistory].sort((a,b)=>String(b.planned_date||b.completed_date||b.done_date||'').localeCompare(String(a.planned_date||a.completed_date||a.done_date||'')));
    const documentsList = (documentsByProperty[p.id] || []).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    return {id:p.id, property:p, contract, tenant, maintenance:plannedMaintenance, maintenance_history:maintenanceHistory, documenten:documentsList, object:objectName, straatnaam:p.address||'', huisnummer:p.house_number||'', stad:p.city||'', type:p.property_type||'-', status:p.status||'-', huurder:tenant.name||p.tenant_name||'-', email:tenant.email||p.email||'', telefoon:tenant.phone||p.phone||'', huur_pm:rentPm, huur_pj:rentPj, servicekosten:p.service_costs||0, waarborgsom:p.deposit||0, aankoopwaarde:p.purchase_value||0, woz_waarde:p.woz_value||0, hypotheek:p.mortgage_value||0, hypotheekrente:p.mortgage_interest||0, aankoopdatum:p.purchase_date||'', foto_url:p.photo_url||'', bruto_rendement:grossYield, overwaarde:(Number(p.woz_value||0)-Number(p.mortgage_value||0)), energielabel:p.energy_label||'-', energielabel_geldig_tot:p.energy_label_valid_until||'', maand_huurverhoging:p.rent_increase_month||'', einddatum_contract:contractEnd, startdatum_contract:contract.start_date||'', opzegdatum:noticeDate, scope_inspectie_geldig_tot:scopeDate, onderhoud_titel:plannedMaintenance.title||'Scope-inspectie', onderhoud_status:plannedMaintenance.status||'-', onderhoud_kosten:plannedMaintenance.cost||0, onderhoud_prioriteit:plannedMaintenance.priority||'-', onderhoud_omschrijving:plannedMaintenance.description||'', status_contract:getDateStatus(contractEnd,365,90), status_opzeg:getDateStatus(noticeDate,365,90), status_scope:getDateStatus(scopeDate,365,90), status_energy:getDateStatus(p.energy_label_valid_until,180,60), status_rent_increase:rentIncreaseStatus(p.rent_increase_month)};
  });
}
function showLogin(){ el('loginView').classList.remove('hidden'); el('appView').classList.add('hidden'); }
function showApp(){ el('loginView').classList.add('hidden'); el('appView').classList.remove('hidden'); }
async function checkSession(){ await loadBranding(); const {data}=await sb.auth.getSession(); if(data.session){showApp(); await loadData();} else showLogin(); }
async function loadData(){
  try{
    const [pr,cr,tr,mr,dr,hr]=await Promise.all([sb.from('properties').select('*').order('created_at',{ascending:false}), sb.from('contracts').select('*'), sb.from('tenants').select('*'), sb.from('maintenance').select('*'), sb.from('property_documents').select('*'), sb.from('property_maintenance_history').select('*')]);
    [pr,cr,tr,mr,dr,hr].forEach(r=>{if(r.error) throw r.error});
    rawProperties=pr.data||[]; rawContracts=cr.data||[]; rawTenants=tr.data||[]; rawMaintenance=mr.data||[]; rawDocuments=dr.data||[]; rawMaintenanceHistory=hr.data||[];
    vastgoedData=normalize(rawProperties, rawContracts, rawTenants, rawMaintenance, rawDocuments, rawMaintenanceHistory);
    el('statusText').textContent=`Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render(); if(selectedPropertyId) renderDetail(selectedPropertyId);
  }catch(error){ console.error(error); el('statusText').textContent='Kan data niet laden.'; el('attentionList').innerHTML=`<div class="alert danger"><strong>Fout bij laden</strong>${error.message}</div>`; }
}
function filtered(){
  return vastgoedData
    .filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()))
    .sort(compareObjectAddress);
}
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
function isVacant(r){ return String(r.status||'').toLowerCase().includes('leeg') || r.huurder==='-'; }
function contractBucket(r){ const d=daysUntil(r.einddatum_contract); if(d===null) return 'Geen datum'; if(d<0) return 'Verlopen'; if(d<=90) return '0-3 mnd'; if(d<=180) return '3-6 mnd'; if(d<=365) return '6-12 mnd'; return '>12 mnd'; }
function chartBar(label,value,total){ const width=total>0 ? Math.round((value/total)*100) : 0; return `<div class="chartRow"><div class="chartLabel"><span>${label}</span><strong>${value}</strong></div><div class="bar"><span style="width:${width}%"></span></div></div>`; }
function renderCharts(data){
  const rented=data.filter(r=>!isVacant(r)).length, vacant=data.length-rented;
  if(el('occupancyChart')) el('occupancyChart').innerHTML = chartBar('Verhuurd',rented,data.length)+chartBar('Leegstaand/geen huurder',vacant,data.length);
  const buckets=['Verlopen','0-3 mnd','3-6 mnd','6-12 mnd','>12 mnd','Geen datum'];
  if(el('contractChart')) el('contractChart').innerHTML = buckets.map(b=>chartBar(b,data.filter(r=>contractBucket(r)===b).length,data.length)).join('');
  const yieldValues=data.map(r=>Number(r.bruto_rendement)).filter(Number.isFinite);
  if(el('avgYield')) el('avgYield').textContent = yieldValues.length ? pct(yieldValues.reduce((a,b)=>a+b,0)/yieldValues.length) : '-';
  const totalPurchase=data.reduce((a,b)=>a+Number(b.aankoopwaarde||0),0);
  const totalWoz=data.reduce((a,b)=>a+Number(b.woz_waarde||0),0);
  const totalMortgage=data.reduce((a,b)=>a+Number(b.hypotheek||0),0);
  const totalEquity=totalWoz-totalMortgage;
  if(el('totalPurchaseValue')) el('totalPurchaseValue').textContent=euro(totalPurchase);
  if(el('totalWozValue')) el('totalWozValue').textContent=euro(totalWoz);
  if(el('totalMortgageValue')) el('totalMortgageValue').textContent=euro(totalMortgage);
  if(el('totalEquityValue')) el('totalEquityValue').textContent=euro(totalEquity);
}

function maintStatusClass(status, plannedDate){
  const st = norm(status);
  const days = daysUntil(plannedDate);
  if(st.includes('afgerond') || st.includes('gereed')) return 'ok';
  if(days !== null && days < 0) return 'danger';
  if(days !== null && days <= 90) return 'warning';
  if(st.includes('open') || st.includes('controle')) return 'warning';
  return 'ok';
}
function maintenanceSourceRows(data){
  const rows=[];
  const linkedHistoryIds=new Set();
  data.forEach(r=>{
    (r.maintenance_history||[]).forEach(m=>{
      const isHistory = rawMaintenanceHistory.some(h=>h.id===m.id);
      if(isHistory && m.id) linkedHistoryIds.add(m.id);
      rows.push({
        key:`${isHistory?'history':'maintenance'}:${m.id||r.id}`,
        source:isHistory?'history':'maintenance',
        id:m.id||'',
        objectId:r.id,
        object:r.object,
        address:[r.straatnaam,r.huisnummer].filter(Boolean).join(' '),
        type:m.maintenance_type||m.title||'-',
        build_year:m.build_year||'',
        done_date:m.completed_date||m.done_date||'',
        planned_date:m.planned_date||'',
        supplier:m.contractor||m.supplier||'-',
        cost:Number(m.cost||0),
        status:m.status||'-',
        description:m.description||'',
        raw:m
      });
    });
  });
  rawMaintenanceHistory.forEach(m=>{
    if(m.id && linkedHistoryIds.has(m.id)) return;
    rows.push({
      key:`history:${m.id}`,
      source:'history',
      id:m.id||'',
      objectId:m.property_id||'',
      object:m.property_name||[m.property_address,m.house_number].filter(Boolean).join(' ')||'Onbekend object',
      address:[m.property_address,m.house_number].filter(Boolean).join(' '),
      type:m.maintenance_type||'-',
      build_year:m.build_year||'',
      done_date:m.done_date||'',
      planned_date:m.planned_date||'',
      supplier:m.contractor||m.supplier||'-',
      cost:Number(m.cost||0),
      status:m.status||'-',
      description:m.description||'',
      raw:m
    });
  });
  return rows;
}
function getPropertyById(id){ return vastgoedData.find(r=>r.id===id); }
function propertyOptions(selectedId=''){
  return `<option value="">Niet gekoppeld</option>` + [...vastgoedData]
    .sort(compareObjectAddress)
    .map(r=>`<option value="${r.id}" ${r.id===selectedId?'selected':''}>${r.object} ${r.straatnaam?`- ${r.straatnaam} ${r.huisnummer}`:''}</option>`)
    .join('');
}
function maintenanceRowTable(rows){
  return `<table class="maintenanceObjectTable"><tr><th>Type</th><th>Bouwjaar</th><th>Gedaan</th><th>Planning</th><th>Partij</th><th>Kosten</th><th>Status</th><th>Acties</th></tr>`+
    rows.map(r=>`<tr><td>${r.type}</td><td>${r.build_year||'-'}</td><td>${dateFmt(r.done_date)}</td><td>${dateFmt(r.planned_date)}</td><td>${r.supplier||'-'}</td><td>${euro(r.cost||0)}</td><td>${statusBadge([r.status||'-', maintStatusClass(r.status,r.planned_date)])}</td><td><button class="miniLink editMaintBtn" data-key="${escAttr(r.key)}">Bewerk</button>${r.objectId?` <button class="miniLink detailBtn" data-id="${r.objectId}">Open object</button>`:''}</td></tr>`).join('') + `</table>`;
}
function renderMaintenanceOverview(data){
  const allRows=maintenanceSourceRows(data);
  const rowsAll=allRows.filter(r=>{
    const hay=JSON.stringify(r).toLowerCase();
    if(query && !hay.includes(query.toLowerCase())) return false;
    if(maintenanceObjectFilter){
      const objectKey = r.objectId || r.object;
      if(objectKey !== maintenanceObjectFilter) return false;
    }
    if(maintenanceTypeFilter && r.type!==maintenanceTypeFilter) return false;
    if(maintenanceStatusFilter && norm(r.status)!==norm(maintenanceStatusFilter)) return false;
    return true;
  }).sort((a,b)=>{
    const addressCompare=compareObjectAddress(
      {straatnaam:a.raw?.property_address||a.address||a.object, huisnummer:a.raw?.house_number||''},
      {straatnaam:b.raw?.property_address||b.address||b.object, huisnummer:b.raw?.house_number||''}
    );
    if(addressCompare!==0) return addressCompare;

    const dateCompare=String(a.planned_date||a.done_date||'9999').localeCompare(
      String(b.planned_date||b.done_date||'9999')
    );
    if(dateCompare!==0) return dateCompare;

    return String(a.type||'').localeCompare(String(b.type||''),'nl',{sensitivity:'base',numeric:true});
  });
  const overdue=rowsAll.filter(r=>{const d=daysUntil(r.planned_date); return d!==null && d<0 && maintStatusClass(r.status,r.planned_date)!=='ok';}).length;
  const upcoming90=rowsAll.filter(r=>{const d=daysUntil(r.planned_date); return d!==null && d>=0 && d<=90;}).length;
  const open=rowsAll.filter(r=>!['afgerond','gereed'].some(x=>norm(r.status).includes(x))).length;
  const totalCost=rowsAll.reduce((a,b)=>a+Number(b.cost||0),0);
  const objectOptionsMap={};
  allRows.forEach(r=>{ const key=r.objectId || r.object; if(key) objectOptionsMap[key]=r.object; });
  const objects=Object.entries(objectOptionsMap).sort((a,b)=>{
    const aProperty=vastgoedData.find(r=>(r.id||r.object)===a[0] || r.object===a[1]);
    const bProperty=vastgoedData.find(r=>(r.id||r.object)===b[0] || r.object===b[1]);

    if(aProperty && bProperty) return compareObjectAddress(aProperty,bProperty);
    return String(a[1]).localeCompare(String(b[1]),'nl',{sensitivity:'base',numeric:true});
  });
  const types=[...new Set(allRows.map(r=>r.type).filter(Boolean))].sort();
  const statuses=[...new Set(allRows.map(r=>r.status).filter(Boolean))].sort();
  const filterHtml=`<div class="maintenanceFilters maintenanceFiltersWide"><label>Object<select id="maintenanceObjectFilter"><option value="">Alle objecten</option>${objects.map(([key,name])=>`<option value="${escAttr(key)}" ${maintenanceObjectFilter===key?'selected':''}>${name}</option>`).join('')}</select></label><label>Type<select id="maintenanceTypeFilter"><option value="">Alle types</option>${types.map(t=>`<option ${maintenanceTypeFilter===t?'selected':''}>${t}</option>`).join('')}</select></label><label>Status<select id="maintenanceStatusFilter"><option value="">Alle statussen</option>${statuses.map(st=>`<option ${maintenanceStatusFilter===st?'selected':''}>${st}</option>`).join('')}</select></label></div>`;
  const summaryHtml=`<div class="cards maintenanceCards"><div class="card"><span>Totaal regels</span><strong>${rowsAll.length}</strong></div><div class="card"><span>Komende 90 dagen</span><strong>${upcoming90}</strong></div><div class="card"><span>Verlopen</span><strong>${overdue}</strong></div><div class="card"><span>Open</span><strong>${open}</strong></div><div class="card"><span>Totale kosten</span><strong>${euro(totalCost)}</strong></div></div>`;
  const grouped={};
  rowsAll.forEach(r=>{ const key=r.objectId || r.object; (grouped[key] ||= {objectId:r.objectId, object:r.object, address:r.address, rows:[]}).rows.push(r); });
  const groupHtml=Object.values(grouped).map(g=>{
    const next=g.rows.map(r=>r.planned_date).filter(Boolean).sort()[0];
    const costs=g.rows.reduce((a,b)=>a+Number(b.cost||0),0);
    return `<article class="maintenanceObjectCard"><div class="maintenanceObjectHeader"><div><h3>${g.object}</h3><p class="meta">${g.address||'Geen adres bekend'} • ${g.rows.length} onderhoudsregels • eerstvolgende: ${dateFmt(next)}</p></div><div class="detailActions">${g.objectId?`<button class="secondaryBtn detailBtn" data-id="${g.objectId}">Open object</button>`:''}<button class="smallBtn newMaintBtn" data-id="${g.objectId||''}" data-name="${escAttr(g.object)}">+ Regel</button></div></div><div class="row"><span>Totale onderhoudskosten</span><strong>${euro(costs)}</strong></div>${maintenanceRowTable(g.rows)}</article>`;
  }).join('');
  const overviewTarget = el('maintenanceOverview') || el('maintenanceTable') || document.querySelector('#onderhoud .panel') || document.getElementById('onderhoud');
  if (!overviewTarget) return;
  overviewTarget.innerHTML=summaryHtml+filterHtml+(groupHtml || '<div class="panel"><p>Geen onderhoudshistorie gevonden.</p></div>');
}
function openMaintenanceModal(mode, row=null, objectId=''){
  el('maintenanceEditMessage').textContent='';
  el('maintenanceEditTitle').textContent = mode==='new' ? 'Onderhoudsregel toevoegen' : 'Onderhoudsregel bewerken';
  el('mEditId').value = row?.id || '';
  el('mEditSource').value = mode==='new' ? 'new' : (row?.source || 'history');
  el('mEditPropertyId').innerHTML = propertyOptions(row?.objectId || objectId || '');
  el('mEditType').value = row?.type && row.type!=='-' ? row.type : 'Airco';
  el('mEditBuildYear').value = row?.build_year || '';
  el('mEditDoneDate').value = row?.done_date || '';
  el('mEditPlannedDate').value = row?.planned_date || '';
  el('mEditSupplier').value = row?.supplier && row.supplier!=='-' ? row.supplier : '';
  el('mEditStatus').value = row?.status && row.status!=='-' ? row.status : 'Open';
  el('mEditCost').value = row?.cost || '';
  el('mEditDescription').value = row?.description || '';
  el('deleteMaintenanceRowBtn').classList.toggle('hidden', mode==='new');
  el('maintenanceEditModal').classList.remove('hidden');
}
function closeMaintenanceModal(){ el('maintenanceEditModal').classList.add('hidden'); }
function findMaintenanceRowByKey(key){ return maintenanceSourceRows(vastgoedData).find(r=>r.key===key); }
function selectedMaintenancePropertyPayload(){
  const id=el('mEditPropertyId').value;
  const r=getPropertyById(id);
  return {property_id:id||null, property_name:r?.object||null, property_address:r?.straatnaam||null, house_number:r?.huisnummer||null, tenant_name:r?.huurder||null};
}
async function saveMaintenanceEdit(e){
  e.preventDefault();
  el('maintenanceEditMessage').textContent='Bezig met opslaan...';
  const source=el('mEditSource').value;
  const id=el('mEditId').value;
  const base={
    ...selectedMaintenancePropertyPayload(),
    maintenance_type:el('mEditType').value,
    build_year:numOrNull(el('mEditBuildYear').value),
    done_date:el('mEditDoneDate').value||null,
    planned_date:el('mEditPlannedDate').value||null,
    supplier:el('mEditSupplier').value||null,
    status:el('mEditStatus').value||'Open',
    cost:numOrNull(el('mEditCost').value),
    description:el('mEditDescription').value||null
  };
  let res;
  if(source==='maintenance'){
    const pId=el('mEditPropertyId').value || null;
    const payload={property_id:pId,title:base.maintenance_type,build_year:base.build_year,completed_date:base.done_date,planned_date:base.planned_date,contractor:base.supplier,cost:base.cost,status:base.status,description:base.description,priority:'Normaal'};
    res=await sb.from('maintenance').update(payload).eq('id',id);
  } else if(source==='new') {
    res=await sb.from('property_maintenance_history').insert(base);
  } else {
    res=await sb.from('property_maintenance_history').update(base).eq('id',id);
  }
  if(res.error){ el('maintenanceEditMessage').textContent=res.error.message; return; }
  closeMaintenanceModal(); await loadData();
}
async function deleteMaintenanceEdit(){
  const source=el('mEditSource').value;
  const id=el('mEditId').value;
  if(!id || !confirm('Onderhoudsregel verwijderen?')) return;
  const res = source==='maintenance' ? await sb.from('maintenance').delete().eq('id',id) : await sb.from('property_maintenance_history').delete().eq('id',id);
  if(res.error){ el('maintenanceEditMessage').textContent=res.error.message; return; }
  closeMaintenanceModal(); await loadData();
}


function parseSemicolonCsv(text){
  const rows=[];
  let row=[], cell='', inQuotes=false;
  const input=String(text||'').replace(/^\uFEFF/, '');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(ch==='"'){
      if(inQuotes && input[i+1]==='"'){ cell+='"'; i++; }
      else inQuotes=!inQuotes;
    } else if(ch===';' && !inQuotes){
      row.push(cell); cell='';
    } else if((ch==='\n' || ch==='\r') && !inQuotes){
      if(ch==='\r' && input[i+1]==='\n') i++;
      row.push(cell); cell='';
      if(row.some(v=>String(v).trim()!=='')) rows.push(row);
      row=[];
    } else {
      cell+=ch;
    }
  }
  row.push(cell);
  if(row.some(v=>String(v).trim()!=='')) rows.push(row);
  return rows;
}

function canonicalMaintenanceType(value){
  const key=norm(value).replace(/\s+/g,' ');
  const aliases={
    'airco':'Airco',
    'cv-installatie':'CV-Installatie',
    'cv installatie':'CV-Installatie',
    'brandbeveiliging':'Brandbeveiliging',
    'alarm installatie':'Alarm installatie',
    'alarminstallatie':'Alarm installatie',
    'overheaddeur':'Overheaddeur',
    'schilderwerk':'Schilderwerk',
    'gevelreiniging':'Gevelreiniging',
    'onkruid':'Onkruid'
  };
  return aliases[key] || clean(value);
}

function parseBuildYear(value){
  const raw=clean(value);
  if(!raw) return null;
  if(!/^\d{4}$/.test(raw)) throw new Error(`Ongeldig bouwjaar: ${raw}`);
  const year=Number(raw);
  if(year<1800 || year>2200) throw new Error(`Ongeldig bouwjaar: ${raw}`);
  return year;
}

function lastDayIso(year, monthIndex){
  const day=new Date(Date.UTC(year, monthIndex+1, 0)).getUTCDate();
  return `${year}-${String(monthIndex+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function parseMaintenanceDate(value){
  const raw=clean(value).toLowerCase().replace(/\./g,'');
  if(!raw) return null;

  let match=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(match){
    const year=Number(match[1]), month=Number(match[2]), day=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error(`Ongeldige datum: ${value}`);
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  match=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if(match){
    const day=Number(match[1]), month=Number(match[2]), year=Number(match[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error(`Ongeldige datum: ${value}`);
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  match=raw.match(/^([a-zé]+)[\s-]+(\d{2}|\d{4})$/i);
  if(match){
    const months={jan:0,januari:0,feb:1,februari:1,mrt:2,maart:2,maa:2,apr:3,april:3,mei:4,jun:5,juni:5,jul:6,juli:6,aug:7,augustus:7,sep:8,sept:8,september:8,okt:9,oktober:9,nov:10,november:10,dec:11,december:11};
    const month=months[match[1]];
    if(month===undefined) throw new Error(`Onbekende maand: ${value}`);
    let year=Number(match[2]);
    if(match[2].length===2) year=2000+year;
    return lastDayIso(year,month);
  }

  throw new Error(`Ongeldige datum: ${value}`);
}

function maintenanceCsvRecords(rows){
  if(rows.length<3) throw new Error('Het CSV-bestand bevat geen gegevens of mist de twee kopregels.');
  const first=rows[0], second=rows[1];
  const columns=[];
  let currentType='';
  for(let i=3;i<Math.max(first.length,second.length);i++){
    if(clean(first[i])) currentType=canonicalMaintenanceType(first[i]);
    const field=norm(second[i]);
    if(currentType && field) columns.push({index:i,type:currentType,field});
  }
  if(!columns.length) throw new Error('De onderhoudskolommen konden niet uit de twee kopregels worden gelezen.');

  const records=[];
  rows.slice(2).forEach((row,rowOffset)=>{
    const street=clean(row[0]), house=clean(row[1]), tenant=clean(row[2]);
    if(!street && !house && !tenant) return;
    const groups={};
    columns.forEach(col=>{
      const target=(groups[col.type] ||= {type:col.type,street,house,tenant,rowNumber:rowOffset+3});
      const value=clean(row[col.index]);
      if(col.field==='bouwjaar') target.buildYearRaw=value;
      else if(col.field==='gedaan') target.completedRaw=value;
      else if(col.field==='planning') target.plannedRaw=value;
      else if(col.field==='partij') target.contractor=value;
    });
    Object.values(groups).forEach(item=>{
      if(item.buildYearRaw || item.completedRaw || item.plannedRaw || item.contractor) records.push(item);
    });
  });
  return records;
}

function findImportedProperty(street,house){
  const streetKey=norm(street), houseKey=norm(house);
  return rawProperties.find(p=>norm(p.address)===streetKey && norm(p.house_number)===houseKey) || null;
}

function currentTenantForProperty(propertyId){
  const contract=rawContracts.find(c=>c.property_id===propertyId);
  return contract ? rawTenants.find(t=>t.id===contract.tenant_id) || null : null;
}

async function importMaintenanceCsv(){
  const input=el('maintenanceCsvFile');
  const button=el('chooseMaintenanceCsvBtn');
  const message=el('maintenanceImportMessage');
  const results=el('maintenanceImportResults');
  const file=input?.files?.[0];
  if(!file){ message.textContent='Kies eerst de onderhouds-CSV.'; return; }

  if(button){
    button.classList.add('importing');
    button.setAttribute('aria-disabled','true');
  }
  message.textContent='CSV wordt gelezen en gekoppeld...';
  results.innerHTML='';

  try{
    const rows=parseSemicolonCsv(await file.text());
    const records=maintenanceCsvRecords(rows);
    const existingMap=new Map(rawMaintenance.map(m=>[`${m.property_id}|${norm(m.title)}`,m]));
    let added=0, updated=0, skipped=0;
    const errors=[], warnings=[];

    for(const record of records){
      try{
        if(!record.street || !record.house) throw new Error('Straatnaam of huisnummer ontbreekt.');
        const property=findImportedProperty(record.street,record.house);
        if(!property) throw new Error(`Object niet gevonden: ${record.street} ${record.house}`);

        const tenant=currentTenantForProperty(property.id);
        if(record.tenant && tenant?.name && norm(record.tenant)!==norm(tenant.name)){
          warnings.push(`Rij ${record.rowNumber}: huurder “${record.tenant}” wijkt af van “${tenant.name}” bij ${record.street} ${record.house}. Onderhoud is wel aan het object gekoppeld.`);
        }

        const buildYear=parseBuildYear(record.buildYearRaw);
        const completedDate=parseMaintenanceDate(record.completedRaw);
        const plannedDate=parseMaintenanceDate(record.plannedRaw);
        const key=`${property.id}|${norm(record.type)}`;
        const existing=existingMap.get(key);
        const calculatedStatus=plannedDate ? 'Gepland' : (completedDate ? 'Afgerond' : 'Open');

        if(existing){
          const payload={
            title:record.type,
            build_year:buildYear,
            completed_date:completedDate,
            planned_date:plannedDate,
            contractor:record.contractor||null,
            status:calculatedStatus
          };
          const res=await sb.from('maintenance').update(payload).eq('id',existing.id).select().single();
          if(res.error) throw res.error;
          existingMap.set(key,res.data);
          updated++;
        } else {
          const payload={
            property_id:property.id,
            title:record.type,
            build_year:buildYear,
            completed_date:completedDate,
            planned_date:plannedDate,
            contractor:record.contractor||null,
            status:calculatedStatus,
            priority:'Normaal',
            description:'Geïmporteerd uit onderhouds-CSV'
          };
          const res=await sb.from('maintenance').insert(payload).select().single();
          if(res.error) throw res.error;
          existingMap.set(key,res.data);
          added++;
        }
      } catch(error){
        errors.push(`Rij ${record.rowNumber} · ${record.street || '-'} ${record.house || '-'} · ${record.type}: ${error.message}`);
      }
    }

    skipped=Math.max(0,records.length-added-updated-errors.length);
    await loadData();
    message.textContent=`Import klaar: ${added} toegevoegd, ${updated} bijgewerkt, ${errors.length} fouten.`;
    const warningHtml=warnings.length ? `<div class="importNotice warning"><strong>Waarschuwingen (${warnings.length})</strong>${warnings.map(x=>`<span>${escHtml(x)}</span>`).join('')}</div>` : '';
    const errorHtml=errors.length ? `<div class="importNotice danger"><strong>Fouten (${errors.length})</strong>${errors.map(x=>`<span>${escHtml(x)}</span>`).join('')}</div>` : '';
    results.innerHTML=`<div class="importSummary"><span>Gelezen onderhoudsregels: <strong>${records.length}</strong></span><span>Toegevoegd: <strong>${added}</strong></span><span>Bijgewerkt: <strong>${updated}</strong></span>${skipped?`<span>Overgeslagen: <strong>${skipped}</strong></span>`:''}</div>${warningHtml}${errorHtml}`;
  } catch(error){
    console.error(error);
    message.textContent='Importeren mislukt: '+error.message;
  } finally {
    if(button){
      button.classList.remove('importing');
      button.removeAttribute('aria-disabled');
    }
  }
}

function render(){
  const data=filtered(), notes=notificationItems(data);
  renderCharts(data);
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
  el('objectGrid').innerHTML=data.map(r=>`<article class="objectCard">${photoBox(r.foto_url,'objectPhoto',`Foto van ${r.object}`)}<h3>${r.object}</h3><div class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad}</div><div class="row"><span>Huurder</span><strong>${r.huurder}</strong></div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Bruto rendement</span><strong>${r.bruto_rendement===null?'-':pct(r.bruto_rendement)}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Onderhoud</span>${statusBadge(r.status_scope)}</div><button class="smallBtn detailBtn" data-id="${r.id}">Details</button><button class="smallBtn editBtn" data-id="${r.id}">Bewerken</button></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  refreshPhotos();
  el('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Startdatum</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.startdatum_contract)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  if(el('maintenanceOverview')) renderMaintenanceOverview(data);
}
function maintenanceHistoryHtml(r){
  const rows=(r.maintenance_history||[]).map(m=>`<tr><td>${m.maintenance_type||m.title||'-'}</td><td>${m.build_year||'-'}</td><td>${dateFmt(m.done_date||m.planned_date)}</td><td>${dateFmt(m.planned_date)}</td><td>${m.supplier||'-'}</td><td>${m.status||'-'}</td><td>${euro(m.cost||0)}</td><td><button class="miniLink editMaintBtn" data-key="${rawMaintenanceHistory.some(h=>h.id===m.id)?'history':'maintenance'}:${m.id}">Bewerk</button> <button class="miniLink deleteHistBtn" data-id="${m.id}">Verwijder</button></td></tr>`).join('');
  const table = rows ? `<table><tr><th>Type</th><th>Bouwjaar</th><th>Gedaan</th><th>Planning</th><th>Partij</th><th>Status</th><th>Kosten</th><th></th></tr>${rows}</table>` : '<p class="empty">Nog geen onderhoudshistorie.</p>';
  const form = `<div class="historyForm"><h4>Onderhoudsregel toevoegen</h4><div class="formGrid"><label>Type<select id="histType"><option>Airco</option><option>CV-Installatie</option><option>Brandbeveiliging</option><option>Alarm installatie</option><option>Overheaddeur</option><option>Schilderwerk</option><option>Gevelreiniging</option><option>Onkruid</option><option>Scope-inspectie</option><option>Overig</option></select></label><label>Bouwjaar<input id="histBuildYear" type="number"></label><label>Gedaan<input id="histDoneDate" type="date"></label><label>Planning<input id="histPlannedDate" type="date"></label><label>Partij<input id="histSupplier"></label><label>Status<select id="histStatus"><option>Open</option><option>Gepland</option><option>Afgerond</option><option>Controle nodig</option></select></label><label>Kosten<input id="histCost" type="number" step="0.01"></label></div><label>Beschrijving<textarea id="histDescription" rows="2"></textarea></label><button class="smallBtn addHistBtn" data-id="${r.id}">Onderhoudsregel toevoegen</button><p id="historyMessage" class="formMessage"></p></div>`;
  return form + table;
}
async function addMaintenanceHistory(propertyId){
  const msg=el('historyMessage'); if(msg) msg.textContent='Bezig met opslaan...';
  const r=vastgoedData.find(x=>x.id===propertyId);
  const payload={property_id:propertyId, property_name:r?.object||null, property_address:r?.straatnaam||null, house_number:r?.huisnummer||null, tenant_name:r?.huurder||null, maintenance_type:el('histType').value, build_year:numOrNull(el('histBuildYear').value), done_date:el('histDoneDate').value||null, planned_date:el('histPlannedDate').value||null, supplier:el('histSupplier').value||null, status:el('histStatus').value||'Open', cost:numOrNull(el('histCost').value), description:el('histDescription').value||null};
  const res=await sb.from('property_maintenance_history').insert(payload);
  if(res.error){ if(msg) msg.textContent=res.error.message; return; }
  await loadData(); renderDetail(propertyId);
}
async function deleteMaintenanceHistory(id){
  if(!confirm('Onderhoudsregel verwijderen?')) return;
  const res=await sb.from('property_maintenance_history').delete().eq('id',id);
  if(res.error){ alert(res.error.message); return; }
  await loadData(); if(selectedPropertyId) renderDetail(selectedPropertyId);
}

function documentListHtml(r){
  const docs = r.documenten || [];
  const rows = docs.map(d=>`<div class="docItem"><div><strong>${d.name || 'Document'}</strong><span>${d.document_type || 'Overig'} · ${dateFmt(d.created_at)}</span></div><div class="docActions"><button class="miniLink openDocBtn" data-path="${d.storage_path}">Open</button><button class="miniLink deleteDocBtn" data-id="${d.id}" data-path="${d.storage_path}">Verwijder</button></div></div>`).join('');
  return `<div class="docUpload"><div class="formGrid"><label>Type document<select id="documentType"><option>Huurcontract</option><option>Energielabel</option><option>Inspectierapport</option><option>Factuur</option><option>Foto</option><option>Vergunning</option><option>Overig</option></select></label><label>Bestand<input id="documentFile" type="file"></label></div><button class="smallBtn uploadDocBtn" data-id="${r.id}">Document uploaden</button><p id="documentMessage" class="formMessage"></p></div><div class="docList">${rows || '<p class="empty">Nog geen documenten toegevoegd.</p>'}</div>`;
}
async function uploadDocument(propertyId){
  const fileInput=el('documentFile');
  const msg=el('documentMessage');
  const file=fileInput?.files?.[0];
  if(!file){ msg.textContent='Kies eerst een bestand.'; return; }
  msg.textContent='Bezig met uploaden...';
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`${propertyId}/${Date.now()}-${safeName}`;
  const up=await sb.storage.from('property-documents').upload(path,file,{upsert:false});
  if(up.error){ msg.textContent=up.error.message; return; }
  const ins=await sb.from('property_documents').insert({property_id:propertyId,name:file.name,document_type:el('documentType').value,storage_path:path,file_size:file.size,mime_type:file.type}).select().single();
  if(ins.error){ msg.textContent=ins.error.message; return; }
  await loadData();
  renderDetail(propertyId);
}
async function openDocument(path){
  const res=await sb.storage.from('property-documents').createSignedUrl(path,60*10);
  if(res.error){ alert(res.error.message); return; }
  window.open(res.data.signedUrl,'_blank');
}
async function deleteDocument(id,path){
  if(!confirm('Document verwijderen?')) return;
  await sb.storage.from('property-documents').remove([path]);
  const res=await sb.from('property_documents').delete().eq('id',id);
  if(res.error){ alert(res.error.message); return; }
  await loadData();
  if(selectedPropertyId) renderDetail(selectedPropertyId);
}

function renderDetail(id){
  selectedPropertyId=id; const r=vastgoedData.find(x=>x.id===id); if(!r){ el('detailContent').innerHTML='<p>Object niet gevonden.</p>'; return; }
  el('detailContent').innerHTML=`${photoBox(r.foto_url,'detailPhoto',`Foto van ${r.object}`)}<div class="detailHero"><div class="detailHeroTop"><div><h2>${r.object}</h2><p class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad} • ${r.type} • ${r.status}</p></div><div class="detailActions"><button class="secondaryBtn editBtn" data-id="${r.id}">Bewerken</button></div></div></div><div class="detailGrid"><section class="detailSection"><h3>Algemeen</h3>${kv('Adres',`${r.straatnaam} ${r.huisnummer}`)}${kv('Stad',r.stad)}${kv('Type',r.type)}${kv('Status',r.status)}${kv('Energielabel',r.energielabel)}${kv('Energielabel geldig tot',dateFmt(r.energielabel_geldig_tot))}${kv('Status energielabel',statusBadge(r.status_energy))}</section><section class="detailSection"><h3>Financieel</h3>${kv('Maandhuur',euro(r.huur_pm))}${kv('Jaarhuur',euro(r.huur_pj))}${kv('Servicekosten',euro(r.servicekosten))}${kv('Waarborgsom',euro(r.waarborgsom))}${kv('Aankoopwaarde',euro(r.aankoopwaarde))}${kv('WOZ-waarde',euro(r.woz_waarde))}${kv('Hypotheekschuld',euro(r.hypotheek))}${kv('Overwaarde',euro(r.overwaarde))}${kv('Hypotheekrente',r.hypotheekrente?`${String(r.hypotheekrente).replace('.', ',')}%`:'-')}${kv('Aankoopdatum',dateFmt(r.aankoopdatum))}${kv('Bruto rendement',r.bruto_rendement===null?'-':pct(r.bruto_rendement))}${kv('Huurverhoging',r.maand_huurverhoging||'-')}</section><section class="detailSection"><h3>Huurder</h3>${r.huurder==='-'?'<p class="empty">Geen huurder gekoppeld.</p>':`${kv('Naam',r.huurder)}${kv('E-mail',r.email||'-')}${kv('Telefoon',r.telefoon||'-')}`}</section><section class="detailSection"><h3>Contract</h3>${kv('Startdatum',dateFmt(r.startdatum_contract))}${kv('Einddatum',dateFmt(r.einddatum_contract))}${kv('Opzegdatum',dateFmt(r.opzegdatum))}${kv('Status contract',statusBadge(r.status_contract))}${kv('Status opzegdatum',statusBadge(r.status_opzeg))}</section><section class="detailSection"><h3>Onderhoud</h3>${kv('Type',r.onderhoud_titel)}${kv('Datum',dateFmt(r.scope_inspectie_geldig_tot))}${kv('Status',statusBadge(r.status_scope))}${kv('Prioriteit',r.onderhoud_prioriteit)}${kv('Kosten',euro(r.onderhoud_kosten))}${kv('Beschrijving',r.onderhoud_omschrijving||'-')}</section><section class="detailSection fullSpan"><h3>Documenten</h3>${documentListHtml(r)}</section><section class="detailSection fullSpan"><h3>Onderhoudshistorie</h3>${maintenanceHistoryHtml(r)}</section></div>`;
  setPage('detail', r.object);
  refreshPhotos();
}
function kv(label,value){return `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`}
function openNewProperty(){ selectedPropertyId=null; el('modalTitle').textContent='Nieuw object'; el('propertyForm').reset(); ['propertyId','tenantId','contractId','maintenanceId'].forEach(id=>el(id).value=''); el('propertyStatus').value='Actief'; el('contractStatus').value='Actief'; el('maintenanceStatus').value='Open'; el('maintenancePriority').value='Normaal'; if(el('propertyPhotoFile')) el('propertyPhotoFile').value=''; el('deletePropertyBtn').classList.add('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
function openEditProperty(id){ const r=vastgoedData.find(x=>x.id===id); if(!r)return; const p=r.property,c=r.contract||{},t=r.tenant||{},m=r.maintenance||{}; el('modalTitle').textContent='Object bewerken'; el('propertyId').value=p.id||''; el('tenantId').value=t.id||''; el('contractId').value=c.id||''; el('maintenanceId').value=m.id||''; el('propertyName').value=p.name||''; el('propertyAddress').value=p.address||''; el('propertyHouseNumber').value=p.house_number||''; el('propertyCity').value=p.city||''; el('propertyType').value=p.property_type||''; el('propertyStatus').value=p.status||'Actief'; el('propertyMonthlyRent').value=p.monthly_rent||''; el('propertyYearlyRent').value=p.yearly_rent||''; el('propertyServiceCosts').value=p.service_costs||''; el('propertyDeposit').value=p.deposit||''; el('propertyEnergyLabel').value=p.energy_label||''; el('propertyEnergyValidUntil').value=p.energy_label_valid_until||''; el('propertyRentIncreaseMonth').value=p.rent_increase_month||''; el('propertyScopeValidUntil').value=p.scope_valid_until||''; if(el('propertyPurchaseValue')) el('propertyPurchaseValue').value=p.purchase_value||''; if(el('propertyWozValue')) el('propertyWozValue').value=p.woz_value||''; if(el('propertyMortgageValue')) el('propertyMortgageValue').value=p.mortgage_value||''; if(el('propertyMortgageInterest')) el('propertyMortgageInterest').value=p.mortgage_interest||''; if(el('propertyPurchaseDate')) el('propertyPurchaseDate').value=p.purchase_date||''; if(el('propertyPhotoUrl')) el('propertyPhotoUrl').value=p.photo_url||''; if(el('propertyPhotoFile')) el('propertyPhotoFile').value=''; el('tenantName').value=t.name||''; el('tenantEmail').value=t.email||''; el('tenantPhone').value=t.phone||''; el('contractStartDate').value=c.start_date||''; el('contractEndDate').value=c.end_date||''; el('contractNoticeDate').value=c.notice_date||''; el('contractStatus').value=c.status||'Actief'; el('maintenanceTitle').value=m.title||''; el('maintenancePlannedDate').value=m.planned_date||''; el('maintenanceCost').value=m.cost||''; el('maintenancePriority').value=m.priority||'Normaal'; el('maintenanceStatus').value=m.status||'Open'; el('maintenanceDescription').value=m.description||''; el('deletePropertyBtn').classList.remove('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
window.openEditProperty=openEditProperty;
function closeModal(){ el('propertyModal').classList.add('hidden'); }
const numOrNull=v=>v===''||v===null?null:Number(v);
async function upsertEntity(table,id,payload){ if(id) return sb.from(table).update(payload).eq('id',id).select().single(); return sb.from(table).insert(payload).select().single(); }

async function uploadPropertyPhoto(propertyId, file){
  if(!file) return null;
  if(!file.type || !file.type.startsWith('image/')) throw new Error('Upload alleen een afbeelding als hoofdfoto.');
  const path = `${propertyId}/photos/${Date.now()}-${safeFileName(file.name)}`;
  const up = await sb.storage.from('property-documents').upload(path, file, {upsert:false});
  if(up.error) throw up.error;
  const ins = await sb.from('property_documents').insert({
    property_id: propertyId,
    name: file.name,
    document_type: 'Foto',
    storage_path: path,
    file_size: file.size,
    mime_type: file.type
  });
  if(ins.error) throw ins.error;
  const upd = await sb.from('properties').update({photo_url:path}).eq('id', propertyId);
  if(upd.error) throw upd.error;
  return path;
}

async function saveProperty(e){
  e.preventDefault(); el('formMessage').textContent='Bezig met opslaan...';
  const propertyId=el('propertyId').value, tenantId=el('tenantId').value, contractId=el('contractId').value, maintenanceId=el('maintenanceId').value;
  const propertyPayload={name:el('propertyName').value,address:el('propertyAddress').value||null,house_number:el('propertyHouseNumber').value||null,city:el('propertyCity').value||null,property_type:el('propertyType').value||null,status:el('propertyStatus').value||'Actief',monthly_rent:numOrNull(el('propertyMonthlyRent').value),yearly_rent:numOrNull(el('propertyYearlyRent').value),service_costs:numOrNull(el('propertyServiceCosts').value),deposit:numOrNull(el('propertyDeposit').value),energy_label:el('propertyEnergyLabel').value||null,energy_label_valid_until:el('propertyEnergyValidUntil').value||null,rent_increase_month:el('propertyRentIncreaseMonth').value||null,scope_valid_until:el('propertyScopeValidUntil').value||null,purchase_value:numOrNull(el('propertyPurchaseValue')?.value||''),woz_value:numOrNull(el('propertyWozValue')?.value||''),mortgage_value:numOrNull(el('propertyMortgageValue')?.value||''),mortgage_interest:numOrNull(el('propertyMortgageInterest')?.value||''),purchase_date:el('propertyPurchaseDate')?.value||null,photo_url:el('propertyPhotoUrl')?.value||null};
  const propRes=await upsertEntity('properties',propertyId,propertyPayload); if(propRes.error){el('formMessage').textContent=propRes.error.message;return;} const savedProperty=propRes.data;
  const photoFile = el('propertyPhotoFile')?.files?.[0];
  if(photoFile){ try{ const photoPath = await uploadPropertyPhoto(savedProperty.id, photoFile); savedProperty.photo_url = photoPath; } catch(error){ el('formMessage').textContent='Foto uploaden mislukt: '+error.message; return; } }
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
  document.body.addEventListener('click', e=>{ const detail=e.target.closest('.detailBtn'); const edit=e.target.closest('.editBtn'); const upload=e.target.closest('.uploadDocBtn'); const openDoc=e.target.closest('.openDocBtn'); const deleteDoc=e.target.closest('.deleteDocBtn'); const addHist=e.target.closest('.addHistBtn'); const deleteHist=e.target.closest('.deleteHistBtn'); const editMaint=e.target.closest('.editMaintBtn'); const newMaint=e.target.closest('.newMaintBtn'); if(detail) renderDetail(detail.dataset.id); if(edit) openEditProperty(edit.dataset.id); if(upload) uploadDocument(upload.dataset.id); if(openDoc) openDocument(openDoc.dataset.path); if(deleteDoc) deleteDocument(deleteDoc.dataset.id, deleteDoc.dataset.path); if(addHist) addMaintenanceHistory(addHist.dataset.id); if(deleteHist) deleteMaintenanceHistory(deleteHist.dataset.id); if(editMaint){ const row=findMaintenanceRowByKey(editMaint.dataset.key); if(row) openMaintenanceModal('edit', row); } if(newMaint) openMaintenanceModal('new', null, newMaint.dataset.id || ''); });
  el('loginBtn').addEventListener('click', async()=>{ el('loginError').textContent='Bezig met inloggen...'; const email=el('email').value.trim(); const password=el('password').value; const {error}=await sb.auth.signInWithPassword({email,password}); if(error){ el('loginError').textContent='Inloggen mislukt: '+error.message; return;} el('loginError').textContent=''; showApp(); await loadData(); });
  el('password').addEventListener('keydown', e=>{ if(e.key==='Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut(); vastgoedData=[]; showLogin(); });
  el('search').addEventListener('input', e=>{ query=e.target.value; render(); });
  document.body.addEventListener('change', e=>{ if(e.target.id==='maintenanceObjectFilter'){ maintenanceObjectFilter=e.target.value; render(); } if(e.target.id==='maintenanceTypeFilter'){ maintenanceTypeFilter=e.target.value; render(); } if(e.target.id==='maintenanceStatusFilter'){ maintenanceStatusFilter=e.target.value; render(); } });
  el('newPropertyBtn').addEventListener('click', openNewProperty);
  const maintenanceCsvInput=el('maintenanceCsvFile');
  if(maintenanceCsvInput){
    maintenanceCsvInput.addEventListener('change', async e=>{
      const file=e.target.files?.[0];
      if(file) await importMaintenanceCsv();
      e.target.value='';
    });
  }
  el('backToObjectsBtn').addEventListener('click',()=>{ selectedPropertyId=null; setPage('objecten','Objecten'); });
  el('brandingForm').addEventListener('submit',saveBranding);
  el('resetBrandingBtn').addEventListener('click',resetBranding);
  ['brandingCompanyName','brandingDashboardName','brandingPrimaryColor','brandingAccentColor'].forEach(id=>el(id).addEventListener('input',previewBrandingForm));
  el('closeModalBtn').addEventListener('click', closeModal); el('propertyForm').addEventListener('submit', saveProperty); el('deletePropertyBtn').addEventListener('click', deleteProperty); el('closeMaintenanceModalBtn').addEventListener('click', closeMaintenanceModal); el('maintenanceEditForm').addEventListener('submit', saveMaintenanceEdit); el('deleteMaintenanceRowBtn').addEventListener('click', deleteMaintenanceEdit);
  checkSession();
}
document.addEventListener('DOMContentLoaded', init);
