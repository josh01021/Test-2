const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(n);
const dateFmt = s => s ? new Date(s).toLocaleDateString('nl-NL') : '-';
const statusBadge = st => `<span class="badge ${st[1]}">${st[0]}</span>`;
const pages = document.querySelectorAll('.page');
const navs = document.querySelectorAll('.nav');
let query = '';

function filtered(){
  return vastgoedData.filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
}
function notificationItems(data){
  const items=[];
  data.forEach(r=>{
    if(r.status_opzeg[1] !== 'ok') items.push({sev:r.status_opzeg[1], title:`Opzegdatum: ${r.object}`, text:`Opzegdatum ${dateFmt(r.opzegdatum)}. Contract eindigt op ${dateFmt(r.einddatum_contract)}.`});
    if(r.status_contract[1] !== 'ok') items.push({sev:r.status_contract[1], title:`Contract: ${r.object}`, text:`Contractstatus: ${r.status_contract[0]}. Einddatum ${dateFmt(r.einddatum_contract)}.`});
    if(r.status_scope[1] !== 'ok') items.push({sev:r.status_scope[1], title:`Scope-inspectie: ${r.object}`, text:`Geldig tot: ${r.scope_inspectie_geldig_tot || 'onbekend/controle nodig'}.`});
  });
  return items;
}
function render(){
  const data=filtered();
  const notes=notificationItems(data);
  document.getElementById('totalObjects').textContent=data.length;
  document.getElementById('totalRent').textContent=euro(data.reduce((a,b)=>a+b.huur_pj,0));
  document.getElementById('urgentCount').textContent=notes.filter(n=>n.sev==='danger').length;
  document.getElementById('contractSoon').textContent=data.filter(r=>r.status_contract[1] !== 'ok').length;
  document.getElementById('attentionList').innerHTML = notes.slice(0,5).map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  document.getElementById('notificationList').innerHTML = notes.map(n=>`<div class="alert ${n.sev}"><strong>${n.title}</strong>${n.text}</div>`).join('') || '<p>Geen meldingen gevonden.</p>';
  document.getElementById('objectGrid').innerHTML=data.map(r=>`<article class="objectCard"><h3>${r.object}</h3><div class="meta">Huurder: ${r.huurder}</div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Energielabel</span><strong>${r.energielabel}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Opzegdatum</span>${statusBadge(r.status_opzeg)}</div><div class="row"><span>Scope</span>${statusBadge(r.status_scope)}</div></article>`).join('');
  document.getElementById('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Huur p/m</th><th>Einddatum</th><th>Opzegdatum</th><th>Status</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>${r.huurder}</td><td>${euro(r.huur_pm)}</td><td>${dateFmt(r.einddatum_contract)}</td><td>${dateFmt(r.opzegdatum)}</td><td>${statusBadge(r.status_contract)}</td></tr>`).join('');
  document.getElementById('maintenanceTable').innerHTML=`<tr><th>Object</th><th>Type</th><th>Geldig tot</th><th>Status</th><th>Actie</th></tr>`+data.map(r=>`<tr><td>${r.object}</td><td>Scope-inspectie</td><td>${r.scope_inspectie_geldig_tot}</td><td>${statusBadge(r.status_scope)}</td><td>Plan controle / inspectie</td></tr>`).join('');
}
navs.forEach(btn=>btn.addEventListener('click',()=>{navs.forEach(n=>n.classList.remove('active'));btn.classList.add('active');pages.forEach(p=>p.classList.remove('active'));document.getElementById(btn.dataset.page).classList.add('active');document.getElementById('pageTitle').textContent=btn.textContent;}));
document.getElementById('search').addEventListener('input', e=>{query=e.target.value;render();});
render();
