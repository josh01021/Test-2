const SUPABASE_URL = 'https://oplujvnyutmxfpdewezb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dd1dOvBAwPgA1AeqNOQHDg_Wdjvf-ze';

let sb, query = '', maintenanceTypeFilter = '', maintenanceStatusFilter = '', maintenanceObjectFilter = '', vastgoedData = [], rawProperties = [], rawContracts = [], rawTenants = [], rawMaintenance = [], rawDocuments = [], rawMaintenanceHistory = [], selectedPropertyId = null;
const euro = n => new Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(Number(n || 0));
const dateFmt = s => {
  if(!s) return '-';
  const match=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match) return `${Number(match[3])}-${Number(match[2])}-${match[1]}`;
  const date=new Date(s);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('nl-NL');
};
const maintenanceDateFmt = s => {
  if(!s) return '-';
  const match=String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  let date;
  if(match){
    date=new Date(Date.UTC(Number(match[1]), Number(match[2])-1, 1));
  } else {
    date=new Date(s);
  }
  if(Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('nl-NL', {
    month:'long',
    year:'numeric',
    timeZone:'UTC'
  }).format(date);
};
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

const CBS_CPI_BASE='https://datasets.cbs.nl/odata/v1/CBS/86141NED';
const CBS_TABLE_ID='86141NED';
const RENT_REFERENCE_OFFSET_MONTHS=4;
const RENT_OLD_REFERENCE_OFFSET_MONTHS=16;
let rawRentIncreaseProposals=[];
let rentIncreaseSetupReady=true;
let rawServiceCostSettlements=[];
let serviceCostSetupReady=true;
let activeFinancialTab='rent';
let serviceCostYear=new Date().getFullYear()-1;
let activeServiceCostContext=null;
const DEFAULT_NOTIFICATION_RULES={
  notice_date:{enabled:true,days:[90,30,14,7,1,0]},
  contract_end:{enabled:true,days:[90,30,7]},
  maintenance:{enabled:true,days:[30,7,1,0]},
  scope_inspection:{enabled:true,days:[90,30,7]},
  energy_label:{enabled:true,days:[180,90,30,7]},
  rent_increase:{enabled:true,days:[60,30,7]}
};
const DEFAULT_NOTIFICATION_SETTINGS={
  id:1,
  email_enabled:false,
  test_mode:true,
  recipients:[],
  send_time:'07:30',
  send_days:'weekdays',
  timezone:'Europe/Amsterdam',
  only_when_events:true,
  rules:DEFAULT_NOTIFICATION_RULES
};
let notificationSettings=JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS));
let notificationSettingsReady=true;
let rawEmailNotificationLogs=[];
let notificationFunctionStatus={reachable:false,outlookConfigured:false,sender:'',schedulerKeyConfigured:false,error:''};
let cbsIndexCache={loaded:false,loading:null,loadedAt:null,measureCode:'',categoryCode:'',values:new Map(),error:''};
let activeRentContext=null;
let agendaCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let agendaTypeFilter='all';
const euro2=n=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));

async function fetchODataAll(url){
  const rows=[];
  let nextUrl=url;
  let requests=0;
  while(nextUrl){
    if(++requests>50) throw new Error('De CBS-respons bevatte te veel pagina’s.');
    const response=await fetch(nextUrl,{headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error(`CBS gaf foutcode ${response.status}.`);
    const json=await response.json();
    rows.push(...(json.value||[]));
    nextUrl=json['@odata.nextLink']||null;
    if(nextUrl && !/^https?:/i.test(nextUrl)) nextUrl=new URL(nextUrl,CBS_CPI_BASE).href;
  }
  return rows;
}

function normalizeCbsTitle(value){
  return clean(value)
    .replace(/\*/g,'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .trim();
}

function cbsNumber(value){
  if(value===null||value===undefined||value==='') return null;
  const number=Number(String(value).replace(',','.'));
  return Number.isFinite(number)?number:null;
}

async function loadCbsIndexData(force=false){
  if(cbsIndexCache.loading) return cbsIndexCache.loading;
  if(cbsIndexCache.loaded&&!force) return cbsIndexCache;
  const message=el('financialMessage');
  if(message) message.textContent='Openbare CBS CPI-cijfers worden opgehaald...';

  cbsIndexCache.loading=(async()=>{
    try{
      const [measureCodes,categoryCodes,periodCodes]=await Promise.all([
        fetchODataAll(`${CBS_CPI_BASE}/MeasureCodes`),
        fetchODataAll(`${CBS_CPI_BASE}/BestedingscategorieenCodes`),
        fetchODataAll(`${CBS_CPI_BASE}/PeriodenCodes`)
      ]);
      const measure=measureCodes.find(item=>{
        const title=normalizeCbsTitle(item.Title);
        return title==='cpi'||(title.startsWith('cpi ')&&!title.includes('afgeleid')&&!title.includes('jaarmutatie'));
      });
      const category=categoryCodes.find(item=>clean(item.Identifier)==='000000')
        || categoryCodes.find(item=>normalizeCbsTitle(item.Title).includes('alle bestedingen'));
      if(!measure) throw new Error('De meetwaarde “CPI” is niet gevonden in CBS-tabel 86141NED.');
      if(!category) throw new Error('De categorie “000000 Alle bestedingen” is niet gevonden.');

      const filter=`Bestedingscategorieen eq '${String(category.Identifier).replace(/'/g,"''")}' and Measure eq '${String(measure.Identifier).replace(/'/g,"''")}'`;
      const observations=await fetchODataAll(`${CBS_CPI_BASE}/Observations?$filter=${encodeURIComponent(filter)}`);
      const periods=Object.fromEntries(periodCodes.map(item=>[item.Identifier,item.Title]));
      const values=new Map();
      observations.forEach(item=>{
        const title=periods[item.Perioden]||item.Perioden||'';
        const normalized=normalizeCbsTitle(title);
        const value=cbsNumber(item.Value??item.ValueNumeric??item.NumericValue);
        const match=normalized.match(/^(\d{4})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)$/);
        if(!match||value===null) return;
        const month=monthMap[match[2]]+1;
        const key=`${match[1]}-${String(month).padStart(2,'0')}`;
        values.set(key,{
          key,
          title:title.replace(/\*/g,'').trim(),
          value,
          provisional:String(title).includes('*')||String(item.ValueAttribute||'').toLowerCase().includes('voorlopig'),
          periodCode:item.Perioden
        });
      });
      if(!values.size) throw new Error('Er zijn geen maandelijkse CPI-indexcijfers gevonden.');
      cbsIndexCache={loaded:true,loading:null,loadedAt:new Date(),measureCode:measure.Identifier,categoryCode:category.Identifier,values,error:''};
      if(message) message.textContent='';
      renderFinancialOverview(filtered());
      return cbsIndexCache;
    }catch(error){
      console.error('CBS ophalen mislukt',error);
      cbsIndexCache={...cbsIndexCache,loaded:false,loading:null,error:error.message};
      if(message) message.textContent=`CBS-cijfers konden niet automatisch worden geladen: ${error.message} Je kunt de CPI-cijfers bij een voorstel handmatig invullen.`;
      renderFinancialOverview(filtered());
      return cbsIndexCache;
    }
  })();
  return cbsIndexCache.loading;
}

function monthKeyFromIso(value){
  const parts=isoParts(value);
  return parts?`${parts.year}-${String(parts.month).padStart(2,'0')}`:'';
}

function longMonthYear(value){
  const parts=isoParts(value);
  if(!parts) return '-';
  return new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(parts.year,parts.month-1,1)));
}

function rentIncreaseEffectiveDate(r){
  const monthIndex=monthMap[norm(r.maand_huurverhoging)];
  if(monthIndex===undefined) return null;
  const today=new Date();
  let year=today.getFullYear();
  if(monthIndex<today.getMonth()) year++;
  let target=`${year}-${String(monthIndex+1).padStart(2,'0')}-01`;
  const processed=rawRentIncreaseProposals.some(p=>p.contract_id===r.contract?.id&&p.effective_date===target&&p.status==='Verwerkt');
  if(processed) target=`${year+1}-${String(monthIndex+1).padStart(2,'0')}-01`;
  return target;
}

function rentReferencePeriods(effectiveDate){
  return {
    newDate:shiftIsoMonths(effectiveDate,-RENT_REFERENCE_OFFSET_MONTHS),
    oldDate:shiftIsoMonths(effectiveDate,-RENT_OLD_REFERENCE_OFFSET_MONTHS)
  };
}

function proposalFor(contractId,effectiveDate){
  return rawRentIncreaseProposals.find(p=>p.contract_id===contractId&&p.effective_date===effectiveDate)||null;
}

function calculateRentValues(currentRent,oldIndex,newIndex){
  const current=Number(currentRent),oldValue=Number(oldIndex),newValue=Number(newIndex);
  if(!Number.isFinite(current)||current<=0||!Number.isFinite(oldValue)||oldValue<=0||!Number.isFinite(newValue)||newValue<=0){
    return {percentage:null,rent:null};
  }
  const percentage=((newValue/oldValue)-1)*100;
  return {percentage,rent:Math.round((current*(newValue/oldValue))*100)/100};
}

function rentRowContext(r){
  const effectiveDate=rentIncreaseEffectiveDate(r);
  const periods=effectiveDate?rentReferencePeriods(effectiveDate):{newDate:null,oldDate:null};
  const newCpi=periods.newDate?cbsIndexCache.values.get(monthKeyFromIso(periods.newDate)):null;
  const oldCpi=periods.oldDate?cbsIndexCache.values.get(monthKeyFromIso(periods.oldDate)):null;
  const proposal=effectiveDate?proposalFor(r.contract?.id,effectiveDate):null;
  const calculated=calculateRentValues(r.huur_pm,proposal?.old_index??oldCpi?.value,proposal?.new_index??newCpi?.value);
  return {r,effectiveDate,periods,newCpi,oldCpi,proposal,calculated};
}

function rentContextStatus(context){
  const {r,effectiveDate,newCpi,oldCpi,proposal}=context;
  if(!r.contract?.id) return ['Geen contract','danger'];
  if(r.contract_opgezegd) return ['Contract opgezegd','warning'];
  if(!r.maand_huurverhoging) return ['Maand ontbreekt','warning'];
  if(!Number(r.huur_pm)) return ['Huur ontbreekt','danger'];
  if(proposal?.status==='Verwerkt') return ['Verwerkt','ok'];
  if(proposal?.status==='Goedgekeurd') return ['Goedgekeurd','ok'];
  if(proposal) return ['Concept','warning'];
  if(!effectiveDate) return ['Controle nodig','warning'];
  if(!newCpi||!oldCpi) return ['CBS-cijfer ontbreekt','warning'];
  if(newCpi.provisional||oldCpi.provisional) return ['Voorlopig CBS-cijfer','warning'];
  return ['Klaar voor concept','ok'];
}

function renderFinancialOverview(data){
  const overview=el('financialOverview');
  const table=el('rentIncreaseTable');
  if(!overview||!table) return;
  const eligible=data.filter(r=>r.contract?.id&&!r.contract_opgezegd);
  const contexts=eligible.map(rentRowContext);
  const today=isoToday();
  const soon=contexts.filter(c=>{const d=daysUntil(c.effectiveDate);return d!==null&&d>=0&&d<=90;}).length;
  const concepts=contexts.filter(c=>c.proposal?.status==='Concept').length;
  const approved=contexts.filter(c=>c.proposal?.status==='Goedgekeurd').length;
  const processed=rawRentIncreaseProposals.filter(p=>p.status==='Verwerkt').length;
  const needsCheck=contexts.filter(c=>['danger','warning'].includes(rentContextStatus(c)[1])&&!['Concept','Goedgekeurd','Verwerkt'].includes(rentContextStatus(c)[0])).length;
  const cbsText=cbsIndexCache.loadedAt
    ? `Laatst opgehaald: ${cbsIndexCache.loadedAt.toLocaleString('nl-NL')}`
    : (cbsIndexCache.error?'CBS-koppeling niet beschikbaar; handmatige invoer blijft mogelijk.':'CBS-cijfers worden automatisch geladen.');
  overview.innerHTML=`<div class="financialSource"><span><strong>Bron:</strong> CBS 86141NED · CPI 2025=100 · 000000 Alle bestedingen</span><span>${cbsText}</span></div>
  <div class="cards financialSummaryCards">
    <div class="card"><span>Binnen 90 dagen</span><strong>${soon}</strong></div>
    <div class="card"><span>Concepten</span><strong>${concepts}</strong></div>
    <div class="card"><span>Controle nodig</span><strong>${needsCheck}</strong></div>
    <div class="card"><span>Goedgekeurd</span><strong>${approved}</strong></div>
    <div class="card"><span>Verwerkt</span><strong>${processed}</strong></div>
  </div>`;

  const rows=contexts.sort((a,b)=>String(a.effectiveDate||'9999').localeCompare(String(b.effectiveDate||'9999'))||compareObjectAddress(a.r,b.r));
  table.innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Ingangsdatum</th><th>Referentiemaanden</th><th>Huidige huur</th><th>Voorstel</th><th>Status</th><th>Acties</th></tr>`+
    rows.map(context=>{
      const {r,effectiveDate,periods,newCpi,oldCpi,proposal,calculated}=context;
      const status=rentContextStatus(context);
      const finalRent=proposal?.final_rent??calculated.rent;
      const cpiText=periods.newDate&&periods.oldDate
        ? `${longMonthYear(periods.newDate)} / ${longMonthYear(periods.oldDate)}<span class="rentStatusText">${newCpi?String(newCpi.value).replace('.',','):'-'} / ${oldCpi?String(oldCpi.value).replace('.',','):'-'}</span>`
        : '-';
      const actionLabel=proposal?'Bekijken':'Berekenen';
      return `<tr>
        <td><strong>${escHtml(r.object)}</strong><span class="subtle">${escHtml([r.straatnaam,r.huisnummer].filter(Boolean).join(' '))}</span></td>
        <td>${escHtml(r.huurder)}</td>
        <td>${dateFmt(effectiveDate)}</td>
        <td>${cpiText}</td>
        <td>${euro2(r.huur_pm)}</td>
        <td>${finalRent?euro2(finalRent):'-'}${calculated.percentage!==null?`<span class="rentStatusText">${calculated.percentage.toFixed(2).replace('.',',')}%</span>`:''}</td>
        <td>${statusBadge(status)}</td>
        <td><div class="financialActionGroup"><button class="miniLink rentEditBtn" data-id="${r.id}" data-date="${effectiveDate||''}">${actionLabel}</button>${proposal?`<button class="miniLink rentQuickLetterBtn" data-id="${r.id}" data-date="${effectiveDate}">Conceptbrief</button>`:''}</div></td>
      </tr>`;
    }).join('') || '<tr><td colspan="8">Geen actieve contracten gevonden.</td></tr>';

  if(!rentIncreaseSetupReady){
    overview.insertAdjacentHTML('afterbegin','<div class="importNotice warning"><strong>Eenmalige Supabase-instelling nodig</strong><span>Voer eerst het meegeleverde SQL-bestand uit. Daarna kunnen concepten en huurhistorie veilig worden opgeslagen.</span></div>');
  }
}

function openRentIncreaseModal(propertyId,effectiveDate){
  const r=getPropertyById(propertyId);
  if(!r) return;
  const targetDate=effectiveDate||rentIncreaseEffectiveDate(r);
  const periods=targetDate?rentReferencePeriods(targetDate):{newDate:null,oldDate:null};
  const proposal=targetDate?proposalFor(r.contract?.id,targetDate):null;
  const oldCpi=proposal?.old_index??cbsIndexCache.values.get(monthKeyFromIso(periods.oldDate))?.value??'';
  const newCpi=proposal?.new_index??cbsIndexCache.values.get(monthKeyFromIso(periods.newDate))?.value??'';
  activeRentContext={r,effectiveDate:targetDate,periods,proposal};

  el('rentProposalId').value=proposal?.id||'';
  el('rentPropertyId').value=r.id;
  el('rentContractId').value=r.contract?.id||'';
  el('rentIncreaseModalTitle').textContent=`Huurverhoging · ${r.object}`;
  el('rentIncreaseModalMeta').textContent=`${r.huurder} · ${[r.straatnaam,r.huisnummer,r.stad].filter(Boolean).join(' ')}`;
  el('rentCurrentRent').textContent=euro2(r.huur_pm);
  el('rentServiceCosts').textContent=euro2(r.servicekosten);
  el('rentEffectiveDate').value=targetDate||'';
  el('rentProposalStatus').value=proposal?.status==='Goedgekeurd'?'Goedgekeurd':'Concept';
  el('rentOldPeriod').value=longMonthYear(periods.oldDate);
  el('rentNewPeriod').value=longMonthYear(periods.newDate);
  el('rentOldIndex').value=oldCpi;
  el('rentNewIndex').value=newCpi;
  el('rentFinalRent').value=proposal?.final_rent??'';
  el('rentFinalRent').dataset.autoCalculated=proposal?'false':'true';
  el('rentOverrideReason').value=proposal?.override_reason||'';
  el('rentNotes').value=proposal?.notes||'';
  el('rentIncreaseMessage').textContent='';
  updateRentModalCalculation();
  updateRentApplyButton();

  const cbsWarning=el('rentCbsWarning');
  const newEntry=cbsIndexCache.values.get(monthKeyFromIso(periods.newDate));
  const oldEntry=cbsIndexCache.values.get(monthKeyFromIso(periods.oldDate));
  const warnings=[];
  if(!newEntry||!oldEntry) warnings.push('Een of beide CBS-indexcijfers zijn nog niet beschikbaar. Vul ze alleen handmatig in nadat je ze in StatLine hebt gecontroleerd.');
  if(newEntry?.provisional||oldEntry?.provisional) warnings.push('Minimaal één gebruikt CBS-cijfer is voorlopig. Controleer dit vóór goedkeuring.');
  cbsWarning.textContent=warnings.join(' ');
  cbsWarning.classList.toggle('hidden',!warnings.length);
  el('rentIncreaseModal').classList.remove('hidden');
}

function closeRentIncreaseModal(){
  el('rentIncreaseModal').classList.add('hidden');
  activeRentContext=null;
}

function updateRentModalCalculation(){
  if(!activeRentContext) return;
  const oldIndex=Number(el('rentOldIndex').value);
  const newIndex=Number(el('rentNewIndex').value);
  const calculated=calculateRentValues(activeRentContext.r.huur_pm,oldIndex,newIndex);
  el('rentCalculatedPercentage').textContent=calculated.percentage===null?'-':`${calculated.percentage.toFixed(2).replace('.',',')}%`;
  el('rentCalculatedRent').textContent=calculated.rent===null?'-':euro2(calculated.rent);
  el('rentCalculatedRent').dataset.value=calculated.rent??'';
  if(calculated.rent!==null&&(!el('rentFinalRent').value||el('rentFinalRent').dataset.autoCalculated==='true')){
    el('rentFinalRent').value=calculated.rent.toFixed(2);
    el('rentFinalRent').dataset.autoCalculated='true';
  }
}

function updateRentApplyButton(){
  const button=el('applyRentIncreaseBtn');
  const proposalId=el('rentProposalId').value;
  const approved=el('rentProposalStatus').value==='Goedgekeurd';
  const processed=activeRentContext?.proposal?.status==='Verwerkt';
  button.classList.toggle('hidden',!proposalId||processed);
  button.disabled=!approved;
  button.title=approved?'':'Zet de status eerst op Goedgekeurd.';
}

function rentProposalPayload(){
  if(!activeRentContext) throw new Error('Geen huurverhoging geselecteerd.');
  const oldIndex=Number(el('rentOldIndex').value);
  const newIndex=Number(el('rentNewIndex').value);
  const finalRent=Number(el('rentFinalRent').value);
  if(!Number.isFinite(oldIndex)||oldIndex<=0||!Number.isFinite(newIndex)||newIndex<=0) throw new Error('Vul geldige oude en nieuwe CPI-indexcijfers in.');
  if(!Number.isFinite(finalRent)||finalRent<0) throw new Error('Vul een geldige definitieve maandhuur in.');
  const calculated=calculateRentValues(activeRentContext.r.huur_pm,oldIndex,newIndex);
  const reason=clean(el('rentOverrideReason').value);
  if(calculated.rent!==null&&Math.abs(finalRent-calculated.rent)>0.01&&!reason){
    throw new Error('Vul een reden in wanneer de definitieve huur afwijkt van de automatische berekening.');
  }
  const effectiveDate=el('rentEffectiveDate').value;
  const periods=rentReferencePeriods(effectiveDate);
  const oldEntry=cbsIndexCache.values.get(monthKeyFromIso(periods.oldDate));
  const newEntry=cbsIndexCache.values.get(monthKeyFromIso(periods.newDate));
  return {
    id:el('rentProposalId').value||undefined,
    property_id:activeRentContext.r.id,
    contract_id:activeRentContext.r.contract.id,
    effective_date:effectiveDate,
    current_rent:Number(activeRentContext.r.huur_pm||0),
    service_costs:Number(activeRentContext.r.servicekosten||0),
    old_period:monthKeyFromIso(periods.oldDate),
    new_period:monthKeyFromIso(periods.newDate),
    old_index:oldIndex,
    new_index:newIndex,
    calculated_percentage:calculated.percentage,
    calculated_rent:calculated.rent,
    final_rent:finalRent,
    override_reason:reason||null,
    notes:clean(el('rentNotes').value)||null,
    status:el('rentProposalStatus').value,
    cbs_table:CBS_TABLE_ID,
    cbs_measure:'CPI',
    cbs_category:'000000 Alle bestedingen',
    cbs_is_provisional:Boolean(oldEntry?.provisional||newEntry?.provisional),
    updated_at:new Date().toISOString()
  };
}

async function persistRentProposal(){
  if(!rentIncreaseSetupReady) throw new Error('Voer eerst het meegeleverde Supabase SQL-bestand uit.');
  const payload=rentProposalPayload();
  delete payload.id;
  const result=await sb.from('rent_increase_proposals').upsert(payload,{onConflict:'contract_id,effective_date'}).select().single();
  if(result.error) throw result.error;
  const index=rawRentIncreaseProposals.findIndex(item=>item.id===result.data.id||(
    item.contract_id===result.data.contract_id&&item.effective_date===result.data.effective_date
  ));
  if(index>=0) rawRentIncreaseProposals[index]=result.data; else rawRentIncreaseProposals.push(result.data);
  activeRentContext.proposal=result.data;
  el('rentProposalId').value=result.data.id;
  updateRentApplyButton();
  return result.data;
}

async function saveRentProposal(e){
  e?.preventDefault();
  const message=el('rentIncreaseMessage');
  message.textContent='Concept wordt opgeslagen...';
  try{
    await persistRentProposal();
    message.textContent='Concept opgeslagen. Verzenden gebeurt niet automatisch.';
    renderFinancialOverview(filtered());
  }catch(error){
    console.error(error);
    message.textContent='Opslaan mislukt: '+error.message;
  }
}

function proposalLetterData(){
  const payload=rentProposalPayload();
  return {...payload,r:activeRentContext.r};
}

function createRentLetterHtml(data){
  const r=data.r;
  const effectiveLong=new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${data.effective_date}T00:00:00Z`));
  const currentRent=Number(data.current_rent||0);
  const serviceCosts=Number(data.service_costs||0);
  const finalRent=Number(data.final_rent||0);
  const oldIndex=Number(data.old_index||0);
  const newIndex=Number(data.new_index||0);
  const ratio=oldIndex>0&&newIndex>0?newIndex/oldIndex:1;
  const indexedServiceCosts=Math.round(serviceCosts*ratio*100)/100;
  const currentTotal=Math.round((currentRent+serviceCosts)*100)/100;
  const rentIncrease=Math.round((finalRent-currentRent)*100)/100;
  const finalTotal=Math.round((finalRent+indexedServiceCosts)*100)/100;
  const amount=n=>new Intl.NumberFormat('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
  const indexNumber=n=>new Intl.NumberFormat('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0));
  const oldPeriod=longMonthYear(`${data.old_period}-01`);
  const newPeriod=longMonthYear(`${data.new_period}-01`);
  const recipientAddress=[r.straatnaam,r.huisnummer].filter(Boolean).join(' ');
  const recipientCity=[recipientAddress,r.stad].filter(Boolean).join(', ');
  const manualOverride=Number.isFinite(Number(data.calculated_rent))&&Math.abs(finalRent-Number(data.calculated_rent))>0.01;
  const overrideNote=manualOverride
    ? `<div class="overrideNote"><strong>Handmatige aanpassing:</strong> de definitieve kale huur is vastgesteld op € ${amount(finalRent)}.${data.override_reason?` Reden: ${escHtml(data.override_reason)}.`:''}</div>`
    : '';

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>Concept huuraanpassing ${escHtml(r.object)}</title><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{background:#eef2f7;color:#000;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.28}
    .toolbar{width:210mm;margin:18px auto 0;display:flex;align-items:center;gap:12px;padding:0 2mm}
    .printButton{padding:10px 14px;border:0;border-radius:8px;background:#172033;color:#fff;font:700 14px Arial,sans-serif;cursor:pointer}
    .conceptNotice{font:13px Arial,sans-serif;color:#7c2d12;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:9px 12px}
    .sheet{width:210mm;min-height:297mm;margin:12px auto 28px;background:#fff;padding:25.4mm 19.05mm;box-shadow:0 18px 55px rgba(15,23,42,.16)}
    .recipient{min-height:15.1mm;line-height:5.05mm}
    .subject{display:grid;grid-template-columns:25mm 1fr;column-gap:3mm;margin-top:25.2mm;line-height:5.05mm}
    .greeting{margin:15.1mm 0 0}
    p{margin:0}
    .bodyText{margin-top:5.05mm}
    .calculationIntro{margin-top:5.05mm}
    .calculation{margin-top:5.05mm;display:grid;grid-template-columns:minmax(0,1fr) 27mm 7mm 31mm;align-items:baseline}
    .calculation .cell{min-height:5.05mm;line-height:5.05mm;white-space:nowrap}
    .calculation .description{grid-column:1}
    .calculation .descriptionWide{grid-column:1 / 3}
    .calculation .indexValue{grid-column:2;text-align:left}
    .calculation .currency{grid-column:3;text-align:right;padding-right:1.5mm}
    .calculation .number{grid-column:4;text-align:right;font-variant-numeric:tabular-nums}
    .calculation .heading{font-weight:700;font-style:italic}
    .calculation .underline{border-bottom:1px solid #000}
    .calculation .finalCurrency,.calculation .finalNumber{border-top:1px solid #000;border-bottom:3px double #000;font-weight:700;font-style:italic}
    .calculation .finalDescription{font-weight:700;font-style:italic}
    .blankRow{grid-column:1 / 5;min-height:5.05mm}
    .overrideNote{margin-top:6mm;padding:3mm;border:1px solid #aaa;font-size:9.5pt;line-height:1.35}
    @page{size:A4 portrait;margin:25.4mm 19.05mm}
    @media print{
      body{background:#fff}
      .toolbar{display:none!important}
      .sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
    }
  </style></head><body>
    <div class="toolbar"><button class="printButton" onclick="window.print()">Afdrukken / opslaan als PDF</button><div class="conceptNotice"><strong>Concept:</strong> controleer de brief. Er wordt niets automatisch verzonden.</div></div>
    <main class="sheet">
      <div class="recipient">
        <div>${escHtml(r.huurder)}</div>
        <div>${escHtml(r.object)}</div>
        <div>${escHtml(recipientCity||'-')}</div>
      </div>

      <div class="subject"><div>Betreft :</div><div>Huuraanpassing per ${escHtml(effectiveLong)}</div></div>

      <p class="greeting">Geachte mevrouw / heer,</p>

      <div class="bodyText">
        <p>Hierbij delen wij u mede, dat de huur van het in hoofde genoemde object ingaande</p>
        <p>${escHtml(effectiveLong)} zal worden verhoogd overeenkomstig artikel 4 van de met u gesloten</p>
        <p>overeenkomst.</p>
      </div>

      <p class="calculationIntro">De berekening van de ingaande ${escHtml(effectiveLong)} verschuldigde huurprijs is als volgt:</p>

      <div class="calculation">
        <div class="cell descriptionWide">De thans verschuldigde huurprijs bedraagt excl. BTW</div><div class="cell currency">€</div><div class="cell number">${amount(currentTotal)}</div>
        <div class="blankRow"></div>
        <div class="cell descriptionWide">Af : voorschot servicekosten</div><div class="cell currency">€</div><div class="cell number underline">${amount(serviceCosts)}</div>
        <div class="cell descriptionWide"></div><div class="cell currency">€</div><div class="cell number">${amount(currentRent)}</div>
        <div class="blankRow"></div>
        <div class="cell description">Prijsindexcijfer ${escHtml(newPeriod)}</div><div class="cell indexValue">${indexNumber(newIndex)}</div><div class="cell currency"></div><div class="cell number"></div>
        <div class="cell description">Prijsindexcijfer ${escHtml(oldPeriod)}</div><div class="cell indexValue">${indexNumber(oldIndex)}</div><div class="cell currency"></div><div class="cell number"></div>
        <div class="blankRow"></div>
        <div class="cell descriptionWide heading">Huurverhoging</div><div class="cell currency"></div><div class="cell number"></div>
        <div class="cell descriptionWide">(=${indexNumber(newIndex)} / ${indexNumber(oldIndex)} x ${amount(currentRent)}) - ${amount(currentRent)} =</div><div class="cell currency">€</div><div class="cell number underline">${amount(rentIncrease)}</div>
        <div class="cell descriptionWide"></div><div class="cell currency">€</div><div class="cell number">${amount(finalRent)}</div>
        <div class="blankRow"></div>
        <div class="cell descriptionWide">Bij: voor de kosten van bijkomende leveringen en diensten</div><div class="cell currency"></div><div class="cell number"></div>
        <div class="cell descriptionWide heading">Verhoging</div><div class="cell currency"></div><div class="cell number"></div>
        <div class="cell descriptionWide">(=${indexNumber(newIndex)} / ${indexNumber(oldIndex)} x ${amount(serviceCosts)}) =</div><div class="cell currency">€</div><div class="cell number">${amount(indexedServiceCosts)}</div>
        <div class="cell descriptionWide"></div><div class="cell currency"></div><div class="cell number underline"></div>
        <div class="cell descriptionWide finalDescription">De per ${escHtml(effectiveLong)} verschuldigde huurprijs bedraagt excl. BTW</div><div class="cell currency finalCurrency">€</div><div class="cell number finalNumber">${amount(finalTotal)}</div>
      </div>
      ${overrideNote}
    </main>
  </body></html>`;
}
function openRentConceptLetter(){
  try{
    const data=proposalLetterData();
    const html=createRentLetterHtml(data);
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const blobUrl=URL.createObjectURL(blob);

    // Open eerst een leeg venster vanuit de gebruikersactie en verbreek daarna
    // direct de koppeling met het dashboard. De brief wordt vervolgens als
    // lokaal Blob-document geladen en maakt geen externe netwerkverbindingen.
    const popup=window.open('about:blank','_blank');
    if(!popup){
      URL.revokeObjectURL(blobUrl);
      throw new Error('De browser blokkeert het nieuwe venster. Sta pop-ups toe voor dit dashboard.');
    }
    popup.opener=null;
    popup.location.replace(blobUrl);
    window.setTimeout(()=>URL.revokeObjectURL(blobUrl),60_000);
  }catch(error){
    el('rentIncreaseMessage').textContent='Conceptbrief kan niet worden gemaakt: '+error.message;
  }
}

async function applyRentIncrease(){
  const message=el('rentIncreaseMessage');
  if(el('rentProposalStatus').value!=='Goedgekeurd'){
    message.textContent='Zet de status eerst op Goedgekeurd.';
    return;
  }
  if(!confirm('Is de brief gecontroleerd en handmatig verzonden? Daarna wordt de nieuwe huur in het dashboard verwerkt.')) return;
  message.textContent='Huurverhoging wordt verwerkt...';
  try{
    const proposal=await persistRentProposal();
    const result=await sb.rpc('apply_rent_increase',{p_proposal_id:proposal.id});
    if(result.error) throw result.error;
    message.textContent='Huurverhoging verwerkt en opgenomen in de huurhistorie.';
    await loadData();
    closeRentIncreaseModal();
    setPage('financieel','Financieel');
  }catch(error){
    console.error(error);
    message.textContent='Verwerken mislukt: '+error.message;
  }
}


function setFinancialTab(tab){
  activeFinancialTab=tab==='service'?'service':'rent';
  document.querySelectorAll('.financialTab').forEach(button=>{
    const active=button.dataset.financialTab===activeFinancialTab;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  el('financialRentPanel')?.classList.toggle('active',activeFinancialTab==='rent');
  el('financialServicePanel')?.classList.toggle('active',activeFinancialTab==='service');
  if(activeFinancialTab==='rent') loadCbsIndexData(false);
  renderFinancialPage(filtered());
}

function renderFinancialPage(data){
  renderFinancialOverview(data);
  renderServiceCostOverview(data);
}

function serviceCostRowYear(row){
  const explicit=Number(row.settlement_year);
  if(Number.isInteger(explicit)&&explicit>=2000&&explicit<=2200) return explicit;
  const value=row.done_date||row.planned_date||'';
  const parts=isoParts(value);
  return parts?.year||null;
}

function serviceCostRowsFor(propertyId,year){
  return maintenanceSourceRows(vastgoedData)
    .filter(row=>row.objectId===propertyId&&row.is_service_cost&&serviceCostRowYear(row)===Number(year))
    .sort((a,b)=>String(a.done_date||a.planned_date||'9999').localeCompare(String(b.done_date||b.planned_date||'9999'))||compareMaintenanceType(a,b));
}

function allocatedServiceCost(row){
  const cost=Number(row.cost||0);
  const percentage=Number.isFinite(Number(row.allocation_percentage))?Number(row.allocation_percentage):100;
  return Math.round((cost*Math.max(0,Math.min(100,percentage))/100)*100)/100;
}

function contractMonthsInYear(r,year){
  const y=Number(year);
  const yearStart=y*12;
  const yearEnd=yearStart+11;
  const start=isoParts(r.startdatum_contract);
  const end=isoParts(r.einddatum_contract||r.oorspronkelijke_einddatum_contract);
  const first=start?start.year*12+(start.month-1):yearStart;
  const last=end?end.year*12+(end.month-1):yearEnd;
  const overlapStart=Math.max(yearStart,first);
  const overlapEnd=Math.min(yearEnd,last);
  return Math.max(0,overlapEnd-overlapStart+1);
}

function serviceCostSettlementFor(contractId,year){
  return rawServiceCostSettlements.find(item=>item.contract_id===contractId&&Number(item.settlement_year)===Number(year))||null;
}

function serviceCostContext(r,year=serviceCostYear){
  const rows=serviceCostRowsFor(r.id,year);
  const proposal=serviceCostSettlementFor(r.contract?.id,year);
  const months=proposal?.months_charged??contractMonthsInYear(r,year);
  const calculatedAdvance=Math.round(Number(r.servicekosten||0)*Number(months||0)*100)/100;
  const calculatedActual=Math.round(rows.reduce((sum,row)=>sum+allocatedServiceCost(row),0)*100)/100;
  const advancePaid=proposal?.advance_paid??calculatedAdvance;
  const actualCosts=proposal?.actual_costs??calculatedActual;
  const balance=proposal?.final_balance??Math.round((Number(actualCosts)-Number(advancePaid))*100)/100;
  const unchecked=rows.filter(row=>!row.service_cost_approved).length;
  return {r,year:Number(year),rows,proposal,months:Number(months||0),calculatedAdvance,calculatedActual,advancePaid:Number(advancePaid||0),actualCosts:Number(actualCosts||0),balance:Number(balance||0),unchecked};
}

function serviceCostContextStatus(context){
  if(!context.r.contract?.id) return ['Geen contract','danger'];
  if(context.proposal?.status==='Verwerkt') return ['Verwerkt','ok'];
  if(context.proposal?.status==='Goedgekeurd') return ['Goedgekeurd','ok'];
  if(context.proposal) return ['Concept','warning'];
  if(!Number(context.r.servicekosten)&&!context.rows.length) return ['Geen gegevens','warning'];
  if(!Number(context.r.servicekosten)) return ['Voorschot ontbreekt','warning'];
  if(!context.rows.length) return ['Geen kosten gekoppeld','warning'];
  if(context.unchecked) return ['Controle nodig','warning'];
  return ['Klaar voor concept','ok'];
}

function fillServiceCostYearOptions(){
  const select=el('serviceCostYear');
  if(!select) return;
  const current=new Date().getFullYear();
  const years=[];
  for(let year=current+1;year>=current-6;year--) years.push(year);
  if(!years.includes(Number(serviceCostYear))) years.push(Number(serviceCostYear));
  years.sort((a,b)=>b-a);
  select.innerHTML=years.map(year=>`<option value="${year}" ${Number(serviceCostYear)===year?'selected':''}>${year}</option>`).join('');
}

function renderServiceCostOverview(data){
  const overview=el('serviceCostOverview');
  const table=el('serviceCostTable');
  if(!overview||!table) return;
  fillServiceCostYearOptions();
  const contexts=data
    .filter(r=>r.contract?.id)
    .map(r=>serviceCostContext(r,serviceCostYear))
    .filter(context=>context.months>0||context.rows.length||context.proposal)
    .sort((a,b)=>compareObjectAddress(a.r,b.r));
  const totalAdvance=contexts.reduce((sum,c)=>sum+Number(c.advancePaid||0),0);
  const totalActual=contexts.reduce((sum,c)=>sum+Number(c.actualCosts||0),0);
  const toCollect=contexts.reduce((sum,c)=>sum+Math.max(0,Number(c.balance||0)),0);
  const toRefund=contexts.reduce((sum,c)=>sum+Math.max(0,-Number(c.balance||0)),0);
  const needsCheck=contexts.filter(c=>serviceCostContextStatus(c)[1]!=='ok').length;
  overview.innerHTML=`<div class="financialSource"><span><strong>Berekening:</strong> gemarkeerde onderhoudskosten minus betaalde voorschotten</span><span>Alleen regels met “Doorbelasten via servicekosten: Ja” worden meegenomen.</span></div>
  <div class="cards financialSummaryCards">
    <div class="card"><span>Betaalde voorschotten</span><strong>${euro2(totalAdvance)}</strong></div>
    <div class="card"><span>Werkelijke kosten</span><strong>${euro2(totalActual)}</strong></div>
    <div class="card"><span>Nog te ontvangen</span><strong>${euro2(toCollect)}</strong></div>
    <div class="card"><span>Terug te betalen</span><strong>${euro2(toRefund)}</strong></div>
    <div class="card"><span>Controle nodig</span><strong>${needsCheck}</strong></div>
  </div>`;

  table.innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Periode</th><th>Voorschot</th><th>Werkelijke kosten</th><th>Saldo</th><th>Status</th><th>Acties</th></tr>`+
    contexts.map(context=>{
      const status=serviceCostContextStatus(context);
      const balanceLabel=context.balance>0?'Bijbetalen':context.balance<0?'Terugbetalen':'In evenwicht';
      const balanceClass=context.balance>0?'pay':context.balance<0?'refund':'';
      return `<tr>
        <td><strong>${escHtml(context.r.object)}</strong><span class="subtle">${escHtml([context.r.straatnaam,context.r.huisnummer].filter(Boolean).join(' '))}</span></td>
        <td>${escHtml(context.r.huurder)}</td>
        <td>${context.year}<span class="rentStatusText">${context.months} ${context.months===1?'maand':'maanden'}</span></td>
        <td>${euro2(context.advancePaid)}<span class="rentStatusText">${euro2(context.r.servicekosten)} per maand</span></td>
        <td>${euro2(context.actualCosts)}<span class="rentStatusText">${context.rows.length} kostenregels${context.unchecked?` · ${context.unchecked} niet gecontroleerd`:''}</span></td>
        <td>${euro2(Math.abs(context.balance))}<span class="serviceCostBalance ${balanceClass}">${balanceLabel}</span></td>
        <td>${statusBadge(status)}</td>
        <td><div class="financialActionGroup"><button class="miniLink serviceCostEditBtn" data-id="${context.r.id}" data-year="${context.year}">${context.proposal?'Bekijken':'Berekenen'}</button>${context.proposal?`<button class="miniLink serviceCostQuickLetterBtn" data-id="${context.r.id}" data-year="${context.year}">Conceptafrekening</button>`:''}</div></td>
      </tr>`;
    }).join('')||'<tr><td colspan="8">Geen contracten of servicekostengegevens voor dit jaar gevonden.</td></tr>';

  if(!serviceCostSetupReady){
    overview.insertAdjacentHTML('afterbegin','<div class="importNotice warning"><strong>Eenmalige Supabase-instelling nodig</strong><span>Voer het nieuwe SQL-bestand uit voordat je onderhoud als servicekosten markeert of afrekeningen opslaat.</span></div>');
  }
}

function openServiceCostModal(propertyId,year=serviceCostYear){
  const r=getPropertyById(propertyId);
  if(!r) return;
  const context=serviceCostContext(r,Number(year));
  activeServiceCostContext=context;
  const proposal=context.proposal;
  el('serviceCostSettlementId').value=proposal?.id||'';
  el('serviceCostPropertyId').value=r.id;
  el('serviceCostContractId').value=r.contract?.id||'';
  el('serviceCostModalTitle').textContent=`Servicekostenafrekening · ${r.object}`;
  el('serviceCostModalMeta').textContent=`${r.huurder} · afrekenjaar ${context.year}`;
  el('serviceMonthlyAdvance').textContent=euro2(r.servicekosten);
  el('serviceSettlementYear').value=context.year;
  el('serviceSettlementStatus').value=proposal?.status||'Concept';
  el('serviceMonthsCharged').value=context.months;
  el('serviceFinalAdvance').value=Number(context.advancePaid).toFixed(2);
  el('serviceFinalActual').value=Number(context.actualCosts).toFixed(2);
  el('serviceCorrectionReason').value=proposal?.correction_reason||'';
  el('serviceSettlementNotes').value=proposal?.notes||'';
  el('serviceCostModalMessage').textContent='';
  renderServiceCostLines(context.rows);
  updateServiceCostModalCalculation();
  const warnings=[];
  if(!context.rows.length) warnings.push('Er zijn nog geen onderhoudsregels als servicekosten gemarkeerd voor dit afrekenjaar.');
  if(context.unchecked) warnings.push(`${context.unchecked} kostenregel(s) zijn nog niet als gecontroleerd gemarkeerd.`);
  if(!Number(r.servicekosten)) warnings.push('Het maandelijkse voorschot servicekosten ontbreekt bij het object.');
  el('serviceCostWarning').textContent=warnings.join(' ');
  el('serviceCostWarning').classList.toggle('hidden',!warnings.length);
  el('serviceCostModal').classList.remove('hidden');
}

function closeServiceCostModal(){
  el('serviceCostModal').classList.add('hidden');
  activeServiceCostContext=null;
}

function renderServiceCostLines(rows){
  const target=el('serviceCostLines');
  if(!target) return;
  target.innerHTML=`<tr><th>Categorie</th><th>Onderhoud</th><th>Datum</th><th>Factuurbedrag</th><th>Aandeel</th><th>Meegenomen</th><th>Controle</th></tr>`+
    rows.map(row=>`<tr><td>${escHtml(row.service_cost_category||'Overig')}</td><td>${escHtml(row.type)}</td><td>${maintenanceDateFmt(row.done_date||row.planned_date)}</td><td>${euro2(row.cost)}</td><td>${Number(row.allocation_percentage??100).toFixed(2).replace('.',',')}%</td><td>${euro2(allocatedServiceCost(row))}</td><td><span class="serviceCostTag ${row.service_cost_approved?'':'unchecked'}">${row.service_cost_approved?'Gecontroleerd':'Nog controleren'}</span></td></tr>`).join('')||'<tr><td colspan="7">Geen kostenregels gekoppeld.</td></tr>';
}

function updateServiceCostModalCalculation(){
  if(!activeServiceCostContext) return;
  const months=Math.max(0,Math.min(12,Number(el('serviceMonthsCharged').value)||0));
  const calculatedAdvance=Math.round(Number(activeServiceCostContext.r.servicekosten||0)*months*100)/100;
  const advance=Number(el('serviceFinalAdvance').value)||0;
  const actual=Number(el('serviceFinalActual').value)||0;
  const balance=Math.round((actual-advance)*100)/100;
  el('serviceCalculatedAdvance').textContent=euro2(calculatedAdvance);
  el('serviceCalculatedAdvance').dataset.value=calculatedAdvance;
  el('serviceCalculatedActual').textContent=euro2(activeServiceCostContext.calculatedActual);
  el('serviceCalculatedBalance').textContent=balance>0?`${euro2(balance)} bijbetalen`:balance<0?`${euro2(Math.abs(balance))} terugbetalen`:'€ 0,00';
}

function serviceCostPayload(){
  if(!activeServiceCostContext) throw new Error('Geen servicekostenafrekening geselecteerd.');
  const months=Math.max(0,Math.min(12,Math.round(Number(el('serviceMonthsCharged').value)||0)));
  const advance=Number(el('serviceFinalAdvance').value);
  const actual=Number(el('serviceFinalActual').value);
  if(!Number.isFinite(advance)||advance<0||!Number.isFinite(actual)||actual<0) throw new Error('Vul geldige bedragen in.');
  const calculatedAdvance=Math.round(Number(activeServiceCostContext.r.servicekosten||0)*months*100)/100;
  const calculatedActual=activeServiceCostContext.calculatedActual;
  const reason=clean(el('serviceCorrectionReason').value);
  if((Math.abs(advance-calculatedAdvance)>0.01||Math.abs(actual-calculatedActual)>0.01)&&!reason){
    throw new Error('Vul een reden in wanneer het voorschot of de werkelijke kosten afwijken van de automatische berekening.');
  }
  return {
    property_id:activeServiceCostContext.r.id,
    contract_id:activeServiceCostContext.r.contract.id,
    tenant_id:activeServiceCostContext.r.tenant?.id||null,
    settlement_year:Number(el('serviceSettlementYear').value),
    period_start:`${el('serviceSettlementYear').value}-01-01`,
    period_end:`${el('serviceSettlementYear').value}-12-31`,
    monthly_advance:Number(activeServiceCostContext.r.servicekosten||0),
    months_charged:months,
    calculated_advance:calculatedAdvance,
    advance_paid:advance,
    calculated_actual_costs:calculatedActual,
    actual_costs:actual,
    calculated_balance:Math.round((calculatedActual-calculatedAdvance)*100)/100,
    final_balance:Math.round((actual-advance)*100)/100,
    correction_reason:reason||null,
    notes:clean(el('serviceSettlementNotes').value)||null,
    status:el('serviceSettlementStatus').value,
    updated_at:new Date().toISOString()
  };
}

async function persistServiceCostSettlement(){
  if(!serviceCostSetupReady) throw new Error('Voer eerst het meegeleverde Supabase SQL-bestand uit.');
  const payload=serviceCostPayload();
  const result=await sb.from('service_cost_settlements').upsert(payload,{onConflict:'contract_id,settlement_year'}).select().single();
  if(result.error) throw result.error;
  const index=rawServiceCostSettlements.findIndex(item=>item.id===result.data.id||(item.contract_id===result.data.contract_id&&Number(item.settlement_year)===Number(result.data.settlement_year)));
  if(index>=0) rawServiceCostSettlements[index]=result.data; else rawServiceCostSettlements.push(result.data);
  activeServiceCostContext.proposal=result.data;
  el('serviceCostSettlementId').value=result.data.id;
  return result.data;
}

async function saveServiceCostSettlement(e){
  e?.preventDefault();
  const message=el('serviceCostModalMessage');
  message.textContent='Concept wordt opgeslagen...';
  try{
    await persistServiceCostSettlement();
    message.textContent='Servicekostenafrekening opgeslagen. Er wordt niets automatisch verzonden of financieel geboekt.';
    renderServiceCostOverview(filtered());
  }catch(error){
    console.error(error);
    message.textContent='Opslaan mislukt: '+error.message;
  }
}

function createServiceCostLetterHtml(data,context){
  const r=context.r;
  const amount=value=>new Intl.NumberFormat('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));
  const balance=Number(data.final_balance||0);
  const resultText=balance>0
    ? `Nog door u te betalen: € ${amount(balance)}`
    : balance<0
      ? `Aan u terug te betalen: € ${amount(Math.abs(balance))}`
      : 'De betaalde voorschotten en werkelijke kosten zijn gelijk.';
  const lines=context.rows.map(row=>`<tr><td>${escHtml(row.service_cost_category||'Overig')}</td><td>${escHtml(row.type)}</td><td>${maintenanceDateFmt(row.done_date||row.planned_date)}</td><td>€ ${amount(allocatedServiceCost(row))}</td></tr>`).join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>Concept servicekostenafrekening ${escHtml(r.object)}</title><style>
    *{box-sizing:border-box}html,body{margin:0;padding:0}body{background:#eef2f7;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45}.toolbar{width:210mm;margin:18px auto 0;display:flex;gap:12px;align-items:center}.toolbar button{padding:10px 14px;border:0;border-radius:8px;background:#172033;color:#fff;font-weight:700}.notice{color:#7c2d12;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:9px 12px;font-size:13px}.sheet{width:210mm;min-height:297mm;margin:12px auto 28px;background:#fff;padding:25mm 20mm;box-shadow:0 18px 55px rgba(15,23,42,.16)}h1{font-size:18pt;margin:30mm 0 8mm}p{margin:0 0 5mm}table{width:100%;border-collapse:collapse;margin:8mm 0}th,td{text-align:left;padding:3mm 2mm;border-bottom:1px solid #ccc}th:last-child,td:last-child{text-align:right}.totals{width:85mm;margin-left:auto}.totals div{display:flex;justify-content:space-between;padding:2mm 0;border-bottom:1px solid #ccc}.result{margin-top:8mm;padding:4mm;border:2px solid #111;font-weight:700}.note{margin-top:8mm;font-size:9.5pt;color:#444}@page{size:A4 portrait;margin:25mm 20mm}@media print{body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">Afdrukken / opslaan als PDF</button><div class="notice"><strong>Concept:</strong> controleer de afrekening. Er wordt niets automatisch verzonden.</div></div><main class="sheet">
    <div>${escHtml(r.huurder)}</div><div>${escHtml(r.object)}</div><div>${escHtml([r.straatnaam,r.huisnummer,r.stad].filter(Boolean).join(' '))}</div>
    <h1>Servicekostenafrekening ${data.settlement_year}</h1>
    <p>Hierbij ontvangt u de conceptafrekening van de servicekosten over de periode 1 januari tot en met 31 december ${data.settlement_year}.</p>
    <table><tr><th>Categorie</th><th>Omschrijving</th><th>Datum</th><th>Bedrag</th></tr>${lines||'<tr><td colspan="4">Geen kostenregels opgenomen.</td></tr>'}</table>
    <div class="totals"><div><span>Werkelijke servicekosten</span><strong>€ ${amount(data.actual_costs)}</strong></div><div><span>Betaalde voorschotten</span><strong>€ ${amount(data.advance_paid)}</strong></div></div>
    <div class="result">${escHtml(resultText)}</div>
    ${data.correction_reason?`<p class="note"><strong>Toelichting correctie:</strong> ${escHtml(data.correction_reason)}</p>`:''}
  </main></body></html>`;
}

function openServiceCostLetter(){
  try{
    if(!activeServiceCostContext) throw new Error('Geen afrekening geselecteerd.');
    const data=serviceCostPayload();
    const html=createServiceCostLetterHtml(data,activeServiceCostContext);
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const blobUrl=URL.createObjectURL(blob);
    const popup=window.open('about:blank','_blank');
    if(!popup){URL.revokeObjectURL(blobUrl);throw new Error('De browser blokkeert het nieuwe venster. Sta pop-ups toe voor dit dashboard.');}
    popup.opener=null;
    popup.location.replace(blobUrl);
    window.setTimeout(()=>URL.revokeObjectURL(blobUrl),60_000);
  }catch(error){
    el('serviceCostModalMessage').textContent='Conceptafrekening kan niet worden gemaakt: '+error.message;
  }
}


function cloneNotificationDefaults(){
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS));
}

function normalizeNotificationSettings(row){
  const defaults=cloneNotificationDefaults();
  if(!row) return defaults;
  const rawRules=row.rules&&typeof row.rules==='object'?row.rules:{};
  const rules={};
  Object.entries(DEFAULT_NOTIFICATION_RULES).forEach(([key,defaultRule])=>{
    const source=rawRules[key]&&typeof rawRules[key]==='object'?rawRules[key]:{};
    const sourceDays=Array.isArray(source.days)?source.days:defaultRule.days;
    rules[key]={
      enabled:source.enabled===undefined?defaultRule.enabled:Boolean(source.enabled),
      days:[...new Set(sourceDays.map(Number).filter(value=>Number.isInteger(value)&&value>=0&&value<=365))].sort((a,b)=>b-a)
    };
  });
  return {
    ...defaults,
    ...row,
    id:1,
    recipients:Array.isArray(row.recipients)?row.recipients.filter(Boolean):[],
    send_time:String(row.send_time||defaults.send_time).slice(0,5),
    send_days:row.send_days==='daily'?'daily':'weekdays',
    timezone:'Europe/Amsterdam',
    rules
  };
}

function parseNotificationRecipients(value){
  const recipients=[...new Set(String(value||'').split(/[;,\n]+/).map(item=>item.trim().toLowerCase()).filter(Boolean))];
  if(recipients.length>10) throw new Error('Vul maximaal 10 ontvangers in.');
  const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid=recipients.filter(email=>!emailPattern.test(email));
  if(invalid.length) throw new Error(`Ongeldig e-mailadres: ${invalid[0]}`);
  return recipients;
}

function fillNotificationSettingsForm(){
  if(!el('notificationSettingsForm')) return;
  const settings=normalizeNotificationSettings(notificationSettings);
  el('notificationEmailEnabled').checked=Boolean(settings.email_enabled);
  el('notificationTestMode').checked=settings.test_mode!==false;
  el('notificationRecipients').value=(settings.recipients||[]).join('\n');
  el('notificationSendTime').value=settings.send_time||'07:30';
  el('notificationSendDays').value=settings.send_days||'weekdays';
  el('notificationTimezone').value='Europe/Amsterdam';
  el('notificationOnlyWhenEvents').checked=settings.only_when_events!==false;

  document.querySelectorAll('[data-notification-rule]').forEach(container=>{
    const key=container.dataset.notificationRule;
    const rule=settings.rules?.[key]||DEFAULT_NOTIFICATION_RULES[key]||{enabled:false,days:[]};
    const enabled=container.querySelector('.notificationRuleEnabled');
    if(enabled) enabled.checked=Boolean(rule.enabled);
    container.querySelectorAll('[data-day]').forEach(input=>{
      input.checked=(rule.days||[]).includes(Number(input.dataset.day));
    });
  });
}

function collectNotificationSettingsForm(){
  const rules={};
  document.querySelectorAll('[data-notification-rule]').forEach(container=>{
    const key=container.dataset.notificationRule;
    const enabled=Boolean(container.querySelector('.notificationRuleEnabled')?.checked);
    const days=[...container.querySelectorAll('[data-day]:checked')]
      .map(input=>Number(input.dataset.day))
      .filter(value=>Number.isInteger(value)&&value>=0&&value<=365)
      .sort((a,b)=>b-a);
    rules[key]={enabled,days:[...new Set(days)]};
  });
  const sendTime=el('notificationSendTime').value;
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) throw new Error('Vul een geldige verzendtijd in.');
  const recipients=parseNotificationRecipients(el('notificationRecipients').value);
  if(el('notificationEmailEnabled').checked&&!recipients.length) throw new Error('Vul minimaal één ontvanger in voordat je e-mailmeldingen activeert.');
  return {
    id:1,
    email_enabled:el('notificationEmailEnabled').checked,
    test_mode:el('notificationTestMode').checked,
    recipients,
    send_time:sendTime,
    send_days:el('notificationSendDays').value==='daily'?'daily':'weekdays',
    timezone:'Europe/Amsterdam',
    only_when_events:el('notificationOnlyWhenEvents').checked,
    rules,
    updated_at:new Date().toISOString()
  };
}

function notificationDaysBetween(referenceIso,targetIso){
  const reference=isoParts(referenceIso);
  const target=isoParts(targetIso);
  if(!reference||!target) return null;
  const from=Date.UTC(reference.year,reference.month-1,reference.day);
  const to=Date.UTC(target.year,target.month-1,target.day);
  return Math.round((to-from)/86400000);
}

function buildEmailNotificationEvents(data,settings,referenceIso=isoToday()){
  const events=[];
  const seen=new Set();
  const add=(event)=>{
    if(!event.date||!event.rule) return;
    const rule=settings.rules?.[event.rule];
    if(!rule?.enabled) return;
    const days=notificationDaysBetween(referenceIso,event.date);
    if(days===null||days<0||!(rule.days||[]).includes(days)) return;
    const key=`${event.rule}|${event.objectId||event.object}|${event.date}|${event.title}`;
    if(seen.has(key)) return;
    seen.add(key);
    events.push({...event,days});
  };

  data.forEach(r=>{
    const address=[r.straatnaam,r.huisnummer].filter(Boolean).join(' ');
    const objectText=[r.object,address].filter(Boolean).join(' · ');
    if(r.contract?.id&&!r.contract_opgezegd&&!r.contract_onbepaalde&&r.opzegdatum){
      add({rule:'notice_date',date:r.opzegdatum,title:'Uiterste opzegdatum',object:r.object,objectId:r.id,detail:objectText});
    }
    if(r.contract?.id&&!r.contract_opgezegd&&!r.contract_onbepaalde&&r.einddatum_contract){
      add({rule:'contract_end',date:r.einddatum_contract,title:'Contracteinde',object:r.object,objectId:r.id,detail:objectText});
    }
    const scopeDate=r.property?.scope_valid_until||'';
    if(scopeDate){
      add({rule:'scope_inspection',date:scopeDate,title:'Scope-inspectie verloopt',object:r.object,objectId:r.id,detail:objectText});
    }
    if(r.energielabel_geldig_tot){
      add({rule:'energy_label',date:r.energielabel_geldig_tot,title:'Energielabel verloopt',object:r.object,objectId:r.id,detail:objectText});
    }
    const rentDate=r.contract?.id&&!r.contract_opgezegd?rentIncreaseEffectiveDate(r):null;
    if(rentDate){
      add({rule:'rent_increase',date:rentDate,title:'Huurverhoging',object:r.object,objectId:r.id,detail:objectText});
    }
  });

  maintenanceSourceRows(data).forEach(row=>{
    if(!row.planned_date||maintenanceStatusLabel(row.status)==='Afgerond') return;
    add({
      rule:'maintenance',
      date:row.planned_date,
      title:`Onderhoud: ${row.type||'gepland'}`,
      object:row.object,
      objectId:row.objectId,
      detail:[row.object,row.address].filter(Boolean).join(' · ')
    });
  });

  return events.sort((a,b)=>a.days-b.days||a.date.localeCompare(b.date)||a.title.localeCompare(b.title,'nl',{sensitivity:'base'}));
}

function notificationDayLabel(days){
  if(days===0) return 'Vandaag';
  if(days===1) return 'Morgen';
  return `Over ${days} dagen`;
}

function notificationNextRunDate(settings){
  if(!settings.email_enabled) return null;
  const [hours,minutes]=String(settings.send_time||'07:30').split(':').map(Number);
  const now=new Date();
  for(let offset=0;offset<=10;offset++){
    const candidate=new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,hours,minutes,0,0);
    if(settings.send_days==='weekdays'&&[0,6].includes(candidate.getDay())) continue;
    if(candidate>now) return candidate;
  }
  return null;
}

function renderNotificationPreview(settingsOverride=null){
  const target=el('notificationPreview');
  if(!target) return;
  let settings;
  try{
    settings=settingsOverride||collectNotificationSettingsForm();
  }catch(error){
    target.innerHTML=`<div class="notificationEmptyPreview">${escHtml(error.message)}</div>`;
    return;
  }
  const events=buildEmailNotificationEvents(vastgoedData,settings);
  const recipients=settings.recipients.length?settings.recipients.join(', '):'Nog geen ontvanger ingesteld';
  const subject=`Vastgoedmeldingen – ${new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',year:'numeric'}).format(new Date())}`;
  const groups={};
  events.forEach(event=>(groups[event.days]||=[]).push(event));
  const body=events.length
    ? Object.keys(groups).map(Number).sort((a,b)=>a-b).map(days=>`<div class="notificationEmailGroup"><h5>${escHtml(notificationDayLabel(days))}</h5>${groups[days].map(event=>`<div class="notificationEmailEvent"><strong>${escHtml(event.title)}</strong><span>${escHtml(event.detail||event.object||'')}</span><span>Datum: ${escHtml(dateFmt(event.date))}</span></div>`).join('')}</div>`).join('')
    : `<div class="notificationEmptyPreview">${settings.only_when_events?'Er zijn vandaag geen gebeurtenissen op de ingestelde herinneringsmomenten. Er zou geen e-mail worden verstuurd.':'Er zijn vandaag geen gebeurtenissen; de overzichtsmail zou leeg zijn.'}</div>`;
  const connectionText=notificationFunctionStatus.outlookConfigured
    ? (settings.test_mode?'Testmodus actief':'Productiemodus')
    : 'Outlook-koppeling nog niet compleet';
  target.innerHTML=`<div class="notificationEmailHeader"><div><strong>Aan:</strong> ${escHtml(recipients)}</div><div><strong>Onderwerp:</strong> ${escHtml(subject)}</div><div><strong>Modus:</strong> ${escHtml(connectionText)}</div></div><div class="notificationEmailBody"><h4>Vastgoedmeldingen</h4>${body}</div>`;

  const next=notificationNextRunDate(settings);
  if(el('notificationNextRun')){
    el('notificationNextRun').textContent=!settings.email_enabled
      ? 'Uitgeschakeld'
      : next
        ? `${new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(next)}`
        : 'Nog niet berekend';
  }
}

function renderNotificationLog(){
  const target=el('notificationLog');
  if(!target) return;
  if(!rawEmailNotificationLogs.length){
    target.innerHTML='<p class="empty">Nog geen verzendingen geregistreerd.</p>';
    if(el('notificationLastRun')) el('notificationLastRun').textContent='Nog geen verzending';
    return;
  }
  const statusLabels={processing:'Bezig',sent:'Verzonden',failed:'Mislukt',skipped:'Overgeslagen',test:'Test'};
  target.innerHTML=`<div class="notificationLogWrap"><table class="notificationLogTable"><tr><th>Datum</th><th>Ontvanger</th><th>Gebeurtenissen</th><th>Status</th><th>Toelichting</th></tr>${rawEmailNotificationLogs.map(item=>`<tr><td>${escHtml(new Date(item.created_at||item.run_date).toLocaleString('nl-NL'))}</td><td>${escHtml(item.recipient||'-')}</td><td>${Number(item.event_count||0)}</td><td><span class="notificationLogStatus ${escAttr(item.status||'')}">${escHtml(statusLabels[item.status]||item.status||'-')}</span></td><td>${escHtml(item.error_message||item.subject||'-')}</td></tr>`).join('')}</table></div>`;
  const latest=rawEmailNotificationLogs[0];
  if(el('notificationLastRun')) el('notificationLastRun').textContent=`${new Date(latest.created_at||latest.run_date).toLocaleString('nl-NL')} · ${statusLabels[latest.status]||latest.status}`;
}

function renderNotificationConnectionStatus(){
  const wrapper=el('notificationConnectionStatus');
  const badge=el('notificationConnectionBadge');
  const title=el('notificationConnectionTitle');
  const text=el('notificationConnectionText');
  const sender=el('notificationSenderAddress');
  if(!wrapper||!badge||!title||!text) return;

  badge.classList.remove('ok','warning','danger');
  if(notificationFunctionStatus.outlookConfigured&&notificationFunctionStatus.schedulerKeyConfigured){
    badge.classList.add('ok');
    badge.textContent='Gekoppeld';
    title.textContent='Outlook en veilige planner zijn ingesteld';
    text.textContent='Testmails kunnen worden verstuurd. Automatische verzending start zodra testmodus uitstaat en e-mailmeldingen actief zijn.';
  }else if(notificationFunctionStatus.outlookConfigured){
    badge.classList.add('warning');
    badge.textContent='Deels gereed';
    title.textContent='Outlook is gekoppeld, planner nog niet';
    text.textContent='Testmails werken. Voer daarna het cron-SQL-bestand uit voor automatische verzending.';
  }else if(notificationFunctionStatus.reachable){
    badge.classList.add('warning');
    badge.textContent='Configuratie nodig';
    title.textContent='Edge Function actief, Outlook nog niet compleet';
    text.textContent='Voeg de vier Microsoft-gegevens toe aan Edge Function Secrets.';
  }else{
    badge.classList.add('danger');
    badge.textContent='Niet gekoppeld';
    title.textContent='E-mailfunctie niet bereikbaar';
    text.textContent=notificationFunctionStatus.error||'Deploy eerst de meegeleverde Edge Function.';
  }
  if(sender) sender.textContent=notificationFunctionStatus.sender||'Nog niet gekoppeld';
}

async function loadNotificationFunctionStatus(){
  if(!sb||!el('notificationConnectionStatus')) return;
  try{
    const {data,error}=await sb.functions.invoke('send-property-notifications',{body:{mode:'status'}});
    if(error) throw error;
    notificationFunctionStatus={
      reachable:true,
      outlookConfigured:Boolean(data?.outlookConfigured),
      sender:data?.sender||'',
      schedulerKeyConfigured:Boolean(data?.schedulerKeyConfigured),
      error:''
    };
  }catch(error){
    console.warn('E-mailfunctie status niet beschikbaar:',error.message);
    notificationFunctionStatus={reachable:false,outlookConfigured:false,sender:'',schedulerKeyConfigured:false,error:'De e-mailfunctie is nog niet gedeployed of niet bereikbaar.'};
  }
  renderNotificationConnectionStatus();
  renderNotificationPreview(notificationSettings);
}

async function reloadNotificationLogs(){
  const result=await sb.from('email_notification_log').select('*').order('created_at',{ascending:false}).limit(20);
  if(result.error) throw result.error;
  rawEmailNotificationLogs=result.data||[];
  renderNotificationLog();
}

async function persistNotificationSettings(payload){
  if(!notificationSettingsReady) throw new Error('Voer eerst het meegeleverde Supabase SQL-bestand uit.');
  const {data:sessionData}=await sb.auth.getSession();
  payload.updated_by=sessionData.session?.user?.id||null;
  const result=await sb.from('notification_settings').upsert(payload,{onConflict:'id'}).select().single();
  if(result.error) throw result.error;
  notificationSettings=normalizeNotificationSettings(result.data);
  return notificationSettings;
}

function renderNotificationSettings(){
  if(!el('notificationSettingsForm')) return;
  fillNotificationSettingsForm();
  el('notificationSetupWarning')?.classList.toggle('hidden',notificationSettingsReady);
  renderNotificationConnectionStatus();
  renderNotificationPreview(notificationSettings);
  renderNotificationLog();
}

async function saveNotificationSettings(event){
  event.preventDefault();
  const message=el('notificationSettingsMessage');
  message.textContent='Instellingen worden opgeslagen...';
  try{
    await persistNotificationSettings(collectNotificationSettingsForm());
    message.textContent='Instellingen opgeslagen.';
    renderNotificationSettings();
  }catch(error){
    console.error(error);
    message.textContent='Opslaan mislukt: '+error.message;
  }
}

async function sendNotificationTestMail(){
  const message=el('notificationSettingsMessage');
  const button=el('testNotificationBtn');
  message.textContent='Instellingen worden opgeslagen en de testmail wordt voorbereid...';
  if(button){button.disabled=true;button.textContent='Testmail wordt verstuurd...';}
  try{
    const settings=collectNotificationSettingsForm();
    if(!settings.recipients.length) throw new Error('Vul eerst minimaal één ontvanger in.');
    await persistNotificationSettings(settings);
    renderNotificationPreview(notificationSettings);
    const {data,error}=await sb.functions.invoke('send-property-notifications',{body:{mode:'test'}});
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.error||'De testmail kon niet worden verstuurd.');
    await reloadNotificationLogs();
    message.textContent=`Testmail verzonden naar ${data.recipient}. Er zijn ${Number(data.eventCount||0)} gebeurtenis(sen) opgenomen.`;
    await loadNotificationFunctionStatus();
  }catch(error){
    console.error(error);
    let detail=error.message||String(error);
    if(error?.context){
      try{
        const payload=await error.context.json();
        if(payload?.error) detail=payload.error;
      }catch(_ignored){}
    }
    message.textContent='Testmail mislukt: '+detail;
    try{await reloadNotificationLogs();}catch(_ignored){}
  }finally{
    if(button){button.disabled=false;button.textContent='Testmail versturen';}
  }
}

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
const brandingSignedUrlCache={};
function validHex(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;}

const transparentLogoCache={};

function colorDistance(a,b){
  const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
  return Math.sqrt(dr*dr+dg*dg+db*db);
}

async function removeUniformLogoBackground(url){
  if(!url) return '';
  if(transparentLogoCache[url]) return transparentLogoCache[url];

  try{
    const response=await fetch(url,{mode:'cors',credentials:'omit'});
    if(!response.ok) throw new Error(`Logo ophalen mislukt (${response.status})`);
    const blob=await response.blob();
    const bitmap=await createImageBitmap(blob);

    const maxSide=1600;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,width,height);
    if(bitmap.close) bitmap.close();

    const image=ctx.getImageData(0,0,width,height);
    const data=image.data;
    const pixel=(x,y)=>{
      const i=(y*width+x)*4;
      return [data[i],data[i+1],data[i+2],data[i+3]];
    };
    const corners=[
      pixel(0,0),pixel(width-1,0),pixel(0,height-1),pixel(width-1,height-1),
      pixel(Math.min(2,width-1),Math.min(2,height-1)),
      pixel(Math.max(0,width-3),Math.min(2,height-1)),
      pixel(Math.min(2,width-1),Math.max(0,height-3)),
      pixel(Math.max(0,width-3),Math.max(0,height-3))
    ];

    // Een echt transparante PNG hoeft niet bewerkt te worden.
    if(corners.filter(c=>c[3]<32).length>=4){
      transparentLogoCache[url]=url;
      return url;
    }

    const opaque=corners.filter(c=>c[3]>220);
    if(opaque.length<4){
      transparentLogoCache[url]=url;
      return url;
    }

    const base=[0,0,0,255];
    for(let c=0;c<3;c++) base[c]=Math.round(opaque.reduce((sum,p)=>sum+p[c],0)/opaque.length);

    // Alleen een vrijwel egale achtergrond wordt weggehaald.
    const cornerSpread=Math.max(...opaque.map(c=>colorDistance(c,base)));
    if(cornerSpread>45){
      transparentLogoCache[url]=url;
      return url;
    }

    const distanceAt=idx=>{
      const i=idx*4;
      return colorDistance([data[i],data[i+1],data[i+2],data[i+3]],base);
    };

    // Verwijdert ook de witte waas langs letters, zodat er geen lichte rand achterblijft.
    const clearPixel=(idx,inner=false)=>{
      const i=idx*4;
      const distance=distanceAt(idx);
      const fullyTransparent=inner?34:40;
      const softLimit=inner?105:88;
      if(distance<=fullyTransparent){
        data[i+3]=0;
        return;
      }
      if(distance>=softLimit) return;

      const alpha=Math.max(0.03,Math.min(1,(distance-fullyTransparent)/(softLimit-fullyTransparent)));
      const originalAlpha=data[i+3]/255;

      // Haal de gemengde achtergrondkleur uit anti-aliased randpixels.
      for(let channel=0;channel<3;channel++){
        const foreground=(data[i+channel]-(1-alpha)*base[channel])/alpha;
        data[i+channel]=Math.max(0,Math.min(255,Math.round(foreground)));
      }
      data[i+3]=Math.round(originalAlpha*alpha*255);
    };

    // Stap 1: verwijder de egale achtergrond die met de buitenrand verbonden is.
    const visited=new Uint8Array(width*height);
    const queue=new Int32Array(width*height);
    let head=0,tail=0;
    const addOuter=(x,y)=>{
      if(x<0||y<0||x>=width||y>=height) return;
      const idx=y*width+x;
      if(visited[idx]) return;
      const i=idx*4;
      if(data[i+3]===0 || distanceAt(idx)<=88){
        visited[idx]=1;
        queue[tail++]=idx;
      }
    };

    for(let x=0;x<width;x++){addOuter(x,0);addOuter(x,height-1);}
    for(let y=0;y<height;y++){addOuter(0,y);addOuter(width-1,y);}

    while(head<tail){
      const idx=queue[head++];
      const x=idx%width;
      const y=(idx/width)|0;
      clearPixel(idx,false);
      addOuter(x-1,y);addOuter(x+1,y);addOuter(x,y-1);addOuter(x,y+1);
    }

    // Stap 2: verwijder kleine, ingesloten achtergrondvlakjes in letters zoals O, P, R en B.
    // Deze vlakjes raken de buitenrand niet en bleven daardoor in de vorige versie wit.
    const componentSeen=new Uint8Array(width*height);
    const componentQueue=new Int32Array(width*height);
    const componentPixels=[];
    const maxEnclosedArea=Math.max(64,Math.round(width*height*0.12));

    for(let startIdx=0;startIdx<width*height;startIdx++){
      if(visited[startIdx]||componentSeen[startIdx]) continue;
      const i=startIdx*4;
      if(data[i+3]===0||distanceAt(startIdx)>105) continue;

      let cHead=0,cTail=0;
      componentPixels.length=0;
      componentSeen[startIdx]=1;
      componentQueue[cTail++]=startIdx;
      let touchesBorder=false;

      while(cHead<cTail){
        const idx=componentQueue[cHead++];
        componentPixels.push(idx);
        const x=idx%width;
        const y=(idx/width)|0;
        if(x===0||y===0||x===width-1||y===height-1) touchesBorder=true;

        const neighbours=[idx-1,idx+1,idx-width,idx+width];
        for(const next of neighbours){
          if(next<0||next>=width*height||componentSeen[next]||visited[next]) continue;
          const nx=next%width;
          const ny=(next/width)|0;
          if(Math.abs(nx-x)+Math.abs(ny-y)!==1) continue;
          const ni=next*4;
          if(data[ni+3]===0||distanceAt(next)>105) continue;
          componentSeen[next]=1;
          componentQueue[cTail++]=next;
        }
      }

      if(!touchesBorder&&componentPixels.length<=maxEnclosedArea){
        componentPixels.forEach(idx=>clearPixel(idx,true));
      }
    }

    ctx.putImageData(image,0,0);
    const result=canvas.toDataURL('image/png');
    transparentLogoCache[url]=result;
    return result;
  }catch(error){
    console.warn('Logo-achtergrond kon niet automatisch worden verwijderd:',error.message);
    transparentLogoCache[url]=url;
    return url;
  }
}

async function setImage(id,url,{cleanBackground=false}={}){
  const node=el(id);
  if(!node) return;
  const area=id==='sidebarLogo' ? el('sidebarLogoArea') : null;
  const hideImage=()=>{
    node.classList.add('hidden');
    node.removeAttribute('src');
    if(area) area.classList.add('hidden');
  };
  node.onerror=hideImage;
  if(!url){
    hideImage();
    return;
  }

  const finalUrl=cleanBackground ? await removeUniformLogoBackground(url) : url;
  node.src=finalUrl;
  node.classList.remove('hidden');
  if(area) area.classList.remove('hidden');
}

function brandingStoragePath(value){
  const raw=String(value||'').trim();
  if(!raw) return '';
  if(!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');

  try{
    const url=new URL(raw);
    const markers=[
      '/storage/v1/object/public/branding/',
      '/storage/v1/object/sign/branding/',
      '/storage/v1/object/authenticated/branding/'
    ];
    for(const marker of markers){
      const index=url.pathname.indexOf(marker);
      if(index!==-1) return decodeURIComponent(url.pathname.slice(index+marker.length));
    }
  }catch(error){
    console.warn('Ongeldige branding-URL:', error.message);
  }
  return '';
}

async function resolveBrandingUrl(value){
  const raw=String(value||'').trim();
  if(!raw) return '';
  const path=brandingStoragePath(raw);

  // Een externe URL buiten de branding-bucket mag rechtstreeks worden gebruikt.
  if(/^https?:\/\//i.test(raw) && !path) return raw;
  if(!path) return '';
  if(brandingSignedUrlCache[path]) return brandingSignedUrlCache[path];

  const {data,error}=await sb.storage.from('branding').createSignedUrl(path,60*60);
  if(error){
    console.warn('Brandingbestand kan niet geladen worden:',error.message);
    return '';
  }
  brandingSignedUrlCache[path]=data.signedUrl;
  return data.signedUrl;
}

async function applyBranding(next={}){
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

  const [logoUrl,faviconUrl]=await Promise.all([
    resolveBrandingUrl(branding.logo_url),
    resolveBrandingUrl(branding.favicon_url)
  ]);

  // Het logo wordt bewust alleen in het ingelogde dashboard getoond.
  await Promise.all([
    setImage('sidebarLogo',logoUrl,{cleanBackground:true}),
    setImage('previewLogo',logoUrl,{cleanBackground:true})
  ]);
  const fav=el('faviconLink');
  if(fav) fav.href=faviconUrl||'data:,';

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
  await applyBranding(DEFAULT_BRANDING);
  try{
    const {data,error}=await sb.from('app_settings').select('*').eq('id',1).maybeSingle();
    if(error) throw error;
    if(data) await applyBranding(data);
  }catch(error){
    console.warn('Branding kon niet geladen worden:',error.message);
  }
}

async function uploadBrandingFile(file,folder){
  if(!file) return null;
  if(!file.type || !file.type.startsWith('image/')) throw new Error('Upload alleen een afbeelding.');
  const path=`${folder}/${Date.now()}-${safeFileName(file.name)}`;
  const up=await sb.storage.from('branding').upload(path,file,{upsert:false,cacheControl:'3600'});
  if(up.error) throw up.error;
  return path; // Bewaar het opslagpad, niet een publieke URL.
}

async function removeOldBrandingFile(oldValue,newValue){
  const oldPath=brandingStoragePath(oldValue);
  const newPath=brandingStoragePath(newValue);
  if(!oldPath || oldPath===newPath) return;
  const {error}=await sb.storage.from('branding').remove([oldPath]);
  if(error) console.warn('Oud brandingbestand kon niet worden verwijderd:',error.message);
  delete brandingSignedUrlCache[oldPath];
}

async function saveBranding(e){
  e.preventDefault();
  const msg=el('brandingMessage');
  msg.textContent='Bezig met opslaan...';
  try{
    const previousLogo=branding.logo_url;
    const previousFavicon=branding.favicon_url;
    const logoFile=el('brandingLogoFile').files?.[0];
    const faviconFile=el('brandingFaviconFile').files?.[0];
    const logoPath=await uploadBrandingFile(logoFile,'logos')||branding.logo_url||null;
    const faviconPath=await uploadBrandingFile(faviconFile,'favicons')||branding.favicon_url||null;
    const payload={
      id:1,
      company_name:clean(el('brandingCompanyName').value)||DEFAULT_BRANDING.company_name,
      dashboard_name:clean(el('brandingDashboardName').value)||DEFAULT_BRANDING.dashboard_name,
      login_subtitle:clean(el('brandingLoginSubtitle').value)||DEFAULT_BRANDING.login_subtitle,
      browser_title:clean(el('brandingBrowserTitle').value)||null,
      primary_color:validHex(el('brandingPrimaryColor').value,DEFAULT_BRANDING.primary_color),
      accent_color:validHex(el('brandingAccentColor').value,DEFAULT_BRANDING.accent_color),
      logo_url:logoPath,
      favicon_url:faviconPath,
      updated_at:new Date().toISOString()
    };
    const res=await sb.from('app_settings').upsert(payload,{onConflict:'id'}).select().single();
    if(res.error) throw res.error;

    if(logoFile) await removeOldBrandingFile(previousLogo,logoPath);
    if(faviconFile) await removeOldBrandingFile(previousFavicon,faviconPath);

    el('brandingLogoFile').value='';
    el('brandingFaviconFile').value='';
    await applyBranding(res.data);
    msg.textContent='Instellingen opgeslagen.';
  }catch(error){
    console.error(error);
    msg.textContent='Opslaan mislukt: '+error.message;
  }
}

async function resetBranding(){
  if(!confirm('Standaard huisstijl herstellen? Het huidige logo en favicon worden losgekoppeld.')) return;
  const oldLogo=branding.logo_url;
  const oldFavicon=branding.favicon_url;
  const payload={id:1,...DEFAULT_BRANDING,logo_url:null,favicon_url:null,updated_at:new Date().toISOString()};
  const res=await sb.from('app_settings').upsert(payload,{onConflict:'id'}).select().single();
  if(res.error){el('brandingMessage').textContent=res.error.message;return;}
  await Promise.all([
    removeOldBrandingFile(oldLogo,null),
    removeOldBrandingFile(oldFavicon,null)
  ]);
  await applyBranding(res.data);
  el('brandingMessage').textContent='Standaard huisstijl hersteld.';
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

function daysUntil(dateString){ if(!dateString) return null; const d=new Date(`${String(dateString).slice(0,10)}T00:00:00`); if(Number.isNaN(d.getTime())) return null; const t=new Date(); t.setHours(0,0,0,0); d.setHours(0,0,0,0); return Math.ceil((d-t)/(1000*60*60*24)); }
function getDateStatus(dateString, warningDays=365, dangerDays=90){ const days=daysUntil(dateString); if(days===null) return ['Controle nodig','warning']; if(days<0) return ['Verlopen','danger']; if(days<=dangerDays) return [`Binnen ${dangerDays} dagen`,'danger']; if(days<=warningDays) return [`Binnen ${warningDays} dagen`,'warning']; return ['Op orde','ok']; }

function isoToday(){
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function isoParts(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!match) return null;
  return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3])};
}
function isoFromParts(year,month,day){
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  const safeDay=Math.min(Math.max(1,day),maxDay);
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
}
function shiftIsoMonths(value,months){
  const parts=isoParts(value);
  if(!parts) return null;
  const zeroBased=(parts.year*12)+(parts.month-1)+Number(months||0);
  const year=Math.floor(zeroBased/12);
  const month=((zeroBased%12)+12)%12+1;
  return isoFromParts(year,month,parts.day);
}
function shiftIsoYears(value,years){
  const parts=isoParts(value);
  if(!parts) return null;
  return isoFromParts(parts.year+Number(years||0),parts.month,parts.day);
}
function integerOrNull(value){
  if(value==='' || value===null || value===undefined) return null;
  const number=Number(value);
  return Number.isFinite(number) && number>=0 ? Math.round(number) : null;
}
function monthsBetweenIso(startValue,endValue){
  const start=isoParts(startValue), end=isoParts(endValue);
  if(!start || !end) return null;
  let months=(end.year-start.year)*12+(end.month-start.month);
  if(end.day<start.day) months--;
  return months>=0?months:null;
}
function canonicalContractStatus(value){
  const status=norm(value);
  return status.includes('opgezegd') || status.includes('beeindigd') || status.includes('beëindigd')
    ? 'Opgezegd'
    : 'Actief';
}
function contractTimeline(contract={}){
  const originalEnd=contract.end_date||null;
  const storedStatus=canonicalContractStatus(contract.status);
  const terminated=storedStatus==='Opgezegd';
  const hasContractData=Boolean(
    contract.id || contract.start_date || contract.notice_date || contract.tenant_id ||
    contract.notice_period_months !== null && contract.notice_period_months !== undefined && contract.notice_period_months !== '' ||
    clean(contract.status)
  );
  // Een bestaand contract zonder einddatum geldt als een contract voor onbepaalde tijd.
  // De opzegtermijn blijft daarbij gewoon van toepassing en wordt apart getoond.
  const indefinite=!originalEnd && hasContractData;
  const storedNoticeMonths=integerOrNull(contract.notice_period_months);
  const inferredNoticeMonths=contract.notice_date && originalEnd ? monthsBetweenIso(contract.notice_date,originalEnd) : null;
  const noticeMonths=storedNoticeMonths!==null ? storedNoticeMonths : inferredNoticeMonths;
  const renewalYears=integerOrNull(contract.renewal_period_years)||0;
  const calculatedInitialNotice=originalEnd && noticeMonths ? shiftIsoMonths(originalEnd,-noticeMonths) : null;
  const explicitNotice=contract.notice_date||null;
  const initialNotice=explicitNotice||calculatedInitialNotice;
  const noticeMismatch=Boolean(explicitNotice && calculatedInitialNotice && explicitNotice!==calculatedInitialNotice);

  let effectiveEnd=originalEnd;
  let effectiveNotice=initialNotice;
  let renewalCount=0;
  const today=isoToday();

  if(!terminated && !indefinite && originalEnd && initialNotice && renewalYears>0){
    while(effectiveNotice && today>effectiveNotice && renewalCount<100){
      effectiveEnd=shiftIsoYears(effectiveEnd,renewalYears);
      effectiveNotice=noticeMonths
        ? shiftIsoMonths(effectiveEnd,-noticeMonths)
        : shiftIsoYears(effectiveNotice,renewalYears);
      renewalCount++;
    }
  }

  const noticeDays=daysUntil(effectiveNotice);
  const endDays=daysUntil(effectiveEnd);
  let noticeStatus;
  if(terminated) noticeStatus=['Opgezegd','warning'];
  else if(indefinite){
    noticeStatus=noticeMonths===null
      ? ['Opzegtermijn ontbreekt','warning']
      : [`${noticeMonths} mnd opzegtermijn`,'ok'];
  }
  else if(!effectiveNotice) noticeStatus=['Opzegdatum ontbreekt','warning'];
  else if(renewalCount>0) noticeStatus=['Automatisch verlengd','warning'];
  else if(noticeDays<0) noticeStatus=['Opzegmoment verlopen','danger'];
  else if(noticeDays<=90) noticeStatus=[`Binnen ${noticeDays} dagen`,'danger'];
  else if(noticeDays<=365) noticeStatus=['Binnen 12 maanden','warning'];
  else noticeStatus=['Op orde','ok'];

  let contractStatus;
  if(terminated) contractStatus=['Opgezegd','warning'];
  else if(indefinite) contractStatus=['Onbepaalde tijd','ok'];
  else if(!effectiveEnd) contractStatus=['Einddatum ontbreekt','warning'];
  else if(renewalCount>0) contractStatus=['Verlengd','warning'];
  else contractStatus=getDateStatus(effectiveEnd,365,90);

  return {
    indefinite,originalEnd,effectiveEnd,explicitNotice,calculatedInitialNotice,initialNotice,effectiveNotice,
    noticeMonths,renewalYears,renewalCount,noticeMismatch,noticeDays,endDays,noticeStatus,contractStatus,
    storedStatus,terminated
  };
}
const monthMap={januari:0,februari:1,maart:2,april:3,mei:4,juni:5,juli:6,augustus:7,september:8,oktober:9,november:10,december:11};
function daysUntilRentIncrease(monthName){ if(!monthName) return null; const key=String(monthName).trim().toLowerCase(); if(!(key in monthMap)) return null; const today=new Date(); today.setHours(0,0,0,0); let target=new Date(today.getFullYear(), monthMap[key], 1); if(target<today) target=new Date(today.getFullYear()+1, monthMap[key], 1); return Math.ceil((target-today)/(1000*60*60*24)); }
function rentIncreaseStatus(monthName){ const days=daysUntilRentIncrease(monthName); if(days===null) return ['Niet ingesteld','warning']; if(days<=30) return ['Deze maand/komende 30 dagen','danger']; if(days<=60) return ['Binnen 60 dagen','warning']; return ['Op orde','ok']; }
function actionItem(sev,type,title,text,objectId){ return {sev,type,title,text,objectId}; }
const SIDEBAR_STORAGE_KEY='vastgoedSidebarCollapsed';
function setSidebarCollapsed(collapsed,{persist=true}={}){
  const sidebar=document.querySelector('.sidebar');
  const button=el('sidebarToggleBtn');
  if(!sidebar || !button) return;

  const next=Boolean(collapsed);
  sidebar.classList.toggle('collapsed',next);
  button.setAttribute('aria-expanded',String(!next));
  const label=next?'Zijbalk uitklappen':'Zijbalk inklappen';
  button.setAttribute('aria-label',label);
  button.title=label;

  if(persist){
    try{ localStorage.setItem(SIDEBAR_STORAGE_KEY,String(next)); }
    catch(error){ console.warn('Zijbalkvoorkeur kon niet worden opgeslagen:',error.message); }
  }
}
function initSidebar(){
  let collapsed=false;
  try{ collapsed=localStorage.getItem(SIDEBAR_STORAGE_KEY)==='true'; }
  catch(error){ console.warn('Zijbalkvoorkeur kon niet worden gelezen:',error.message); }

  setSidebarCollapsed(collapsed,{persist:false});
  document.querySelectorAll('.nav').forEach(button=>{
    button.title=button.dataset.title || button.textContent.trim();
  });
  el('sidebarToggleBtn')?.addEventListener('click',()=>{
    const sidebar=document.querySelector('.sidebar');
    setSidebarCollapsed(!sidebar?.classList.contains('collapsed'));
  });
}

function setPage(pageId, title){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  el(pageId).classList.add('active');
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active', n.dataset.page===pageId));
  el('pageTitle').textContent=title || pageId;

  const maintenanceCsvButton=el('chooseMaintenanceCsvBtn');
  if(maintenanceCsvButton) maintenanceCsvButton.classList.toggle('hidden', pageId!=='onderhoud');

  const objectCsvButton=el('chooseObjectCsvBtn');
  if(objectCsvButton) objectCsvButton.classList.toggle('hidden', pageId!=='objecten');

  if(pageId==='financieel'){
    renderFinancialPage(filtered());
    setFinancialTab(activeFinancialTab);
  }
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
    const contractData={...contract};
    if(!contractData.end_date && p.end_date) contractData.end_date=p.end_date;
    if(!contractData.notice_date && p.notice_date) contractData.notice_date=p.notice_date;
    const timeline=contractTimeline(contractData);
    const contractEnd=timeline.effectiveEnd;
    const indefiniteContract=timeline.indefinite;
    const noticeDate=timeline.effectiveNotice;
    const scopeDate=p.scope_valid_until || plannedMaintenance.planned_date;
    const purchaseValue = Number(p.purchase_value || 0);
    const grossYield = purchaseValue > 0 ? (Number(rentPj || 0) / purchaseValue) * 100 : null;
    const objectKey = norm(objectName);
    const addressKey = norm([p.address, p.house_number].filter(Boolean).join(' '));
    const matchedHistory = historyByProperty[p.id] || historyByObjectKey[objectKey] || historyByObjectKey[addressKey] || [];
    const maintenanceHistory = [...propertyMaintenance, ...matchedHistory].sort((a,b)=>String(b.planned_date||b.completed_date||b.done_date||'').localeCompare(String(a.planned_date||a.completed_date||a.done_date||'')));
    const documentsList = (documentsByProperty[p.id] || []).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    return {id:p.id, property:p, contract, contract_timeline:timeline, tenant, maintenance:plannedMaintenance, maintenance_history:maintenanceHistory, documenten:documentsList, object:objectName, straatnaam:p.address||'', huisnummer:p.house_number||'', stad:p.city||'', type:p.property_type||'-', status:p.status||'-', huurder:tenant.name||p.tenant_name||'-', email:tenant.email||p.email||'', telefoon:tenant.phone||p.phone||'', huur_pm:rentPm, huur_pj:rentPj, servicekosten:p.service_costs||0, waarborgsom:p.deposit||0, aankoopwaarde:p.purchase_value||0, woz_waarde:p.woz_value||0, hypotheek:p.mortgage_value||0, hypotheekrente:p.mortgage_interest||0, aankoopdatum:p.purchase_date||'', foto_url:p.photo_url||'', bruto_rendement:grossYield, overwaarde:(Number(p.woz_value||0)-Number(p.mortgage_value||0)), energielabel:p.energy_label||'-', energielabel_geldig_tot:p.energy_label_valid_until||'', maand_huurverhoging:p.rent_increase_month||'', oorspronkelijke_einddatum_contract:timeline.originalEnd, einddatum_contract:contractEnd, contract_onbepaalde:indefiniteContract, contract_status:timeline.storedStatus, contract_opgezegd:timeline.terminated, startdatum_contract:contract.start_date||'', oorspronkelijke_opzegdatum:timeline.initialNotice, opzegdatum:noticeDate, opzegtermijn_maanden:timeline.noticeMonths, verlenging_jaren:timeline.renewalYears, aantal_verlengingen:timeline.renewalCount, opzegdatum_afwijking:timeline.noticeMismatch, scope_inspectie_geldig_tot:scopeDate, onderhoud_titel:plannedMaintenance.title||'Scope-inspectie', onderhoud_status:plannedMaintenance.status||'-', onderhoud_kosten:plannedMaintenance.cost||0, onderhoud_prioriteit:plannedMaintenance.priority||'-', onderhoud_omschrijving:plannedMaintenance.description||'', status_contract:timeline.contractStatus, status_opzeg:timeline.noticeStatus, status_scope:getDateStatus(scopeDate,365,90), status_energy:getDateStatus(p.energy_label_valid_until,180,60), status_rent_increase:rentIncreaseStatus(p.rent_increase_month)};
  });
}
function showLogin(){ el('loginView').classList.remove('hidden'); el('appView').classList.add('hidden'); }
function showApp(){ el('loginView').classList.add('hidden'); el('appView').classList.remove('hidden'); }
async function checkSession(){
  const {data}=await sb.auth.getSession();
  if(data.session){
    showApp();
    await loadBranding();
    await loadData();
  }else{
    await applyBranding(DEFAULT_BRANDING);
    showLogin();
  }
}
async function loadData(){
  try{
    const [pr,cr,tr,mr,dr,hr,rr,sr,ns,nl]=await Promise.all([
      sb.from('properties').select('*').order('created_at',{ascending:false}),
      sb.from('contracts').select('*'),
      sb.from('tenants').select('*'),
      sb.from('maintenance').select('*'),
      sb.from('property_documents').select('*'),
      sb.from('property_maintenance_history').select('*'),
      sb.from('rent_increase_proposals').select('*').order('effective_date',{ascending:true}),
      sb.from('service_cost_settlements').select('*').order('settlement_year',{ascending:false}),
      sb.from('notification_settings').select('*').eq('id',1).maybeSingle(),
      sb.from('email_notification_log').select('*').order('created_at',{ascending:false}).limit(20)
    ]);
    [pr,cr,tr,mr,dr,hr].forEach(r=>{if(r.error) throw r.error});
    rawProperties=pr.data||[]; rawContracts=cr.data||[]; rawTenants=tr.data||[]; rawMaintenance=mr.data||[]; rawDocuments=dr.data||[]; rawMaintenanceHistory=hr.data||[];
    if(rr.error){
      console.warn('Huurverhogingstabellen nog niet beschikbaar:',rr.error.message);
      rawRentIncreaseProposals=[];
      rentIncreaseSetupReady=false;
    }else{
      rawRentIncreaseProposals=rr.data||[];
      rentIncreaseSetupReady=true;
    }
    if(sr.error){
      console.warn('Servicekostentabellen nog niet beschikbaar:',sr.error.message);
      rawServiceCostSettlements=[];
      serviceCostSetupReady=false;
    }else{
      rawServiceCostSettlements=sr.data||[];
      serviceCostSetupReady=true;
    }
    if(ns.error){
      console.warn('E-mailinstellingen nog niet beschikbaar:',ns.error.message);
      notificationSettings=cloneNotificationDefaults();
      notificationSettingsReady=false;
    }else{
      notificationSettings=normalizeNotificationSettings(ns.data);
      notificationSettingsReady=true;
    }
    if(nl.error){
      console.warn('E-maillogboek nog niet beschikbaar:',nl.error.message);
      rawEmailNotificationLogs=[];
    }else{
      rawEmailNotificationLogs=nl.data||[];
    }
    vastgoedData=normalize(rawProperties, rawContracts, rawTenants, rawMaintenance, rawDocuments, rawMaintenanceHistory);
    el('statusText').textContent=`Live data uit Supabase. Laatst geladen: ${new Date().toLocaleTimeString('nl-NL')}`;
    render();
    renderNotificationSettings();
    loadNotificationFunctionStatus();
    if(selectedPropertyId) renderDetail(selectedPropertyId);
    loadCbsIndexData(false);
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
    const timeline=r.contract_timeline||contractTimeline(r.contract||{});
    const noticeDays=timeline.noticeDays;
    const contractDays=timeline.endDays;
    const maintenanceDays=daysUntil(r.scope_inspectie_geldig_tot);
    const energyDays=daysUntil(r.energielabel_geldig_tot);
    const rentIncreaseDays=daysUntilRentIncrease(r.maand_huurverhoging);
    const isVacant=String(r.status||'').toLowerCase().includes('leeg') || String(r.huurder||'').trim()==='-';

    if(isVacant) items.push(actionItem('danger','Leegstand',`Geen huurder: ${r.object}`,'Controleer of dit object leegstaat of koppel een huurder.',r.id));
    if(!r.contract || !r.contract.id){
      items.push(actionItem('warning','Contract',`Geen contract gekoppeld: ${r.object}`,'Voeg een contract toe zodat einddatum, opzegtermijn en verlenging bewaakt worden.',r.id));
    } else if(timeline.terminated){
      const endText=timeline.originalEnd
        ? `Het contract is opgezegd en eindigt op ${dateFmt(timeline.originalEnd)}.`
        : 'Het contract is opgezegd. Vul eventueel een einddatum in om de afloop te bewaken.';
      items.push(actionItem('warning','Opzegging',`Contract opgezegd: ${r.object}`,endText,r.id));
    } else if(timeline.indefinite){
      // Geen vaste eind- of uiterste opzegdatum, maar de contractuele opzegtermijn blijft relevant.
      if(timeline.noticeMonths===null){
        items.push(actionItem('warning','Contractcontrole',`Opzegtermijn ontbreekt: ${r.object}`,'Vul de opzegtermijn in voor dit contract voor onbepaalde tijd.',r.id));
      }
    } else {
      if(timeline.noticeMismatch){
        items.push(actionItem('warning','Contractcontrole',`Opzegdatum wijkt af: ${r.object}`,`De ingevoerde opzegdatum ${dateFmt(timeline.explicitNotice)} wijkt af van ${timeline.noticeMonths} maanden vóór de einddatum (${dateFmt(timeline.calculatedInitialNotice)}).`,r.id));
      }

      if(timeline.renewalCount>0){
        items.push(actionItem('warning','Contractverlenging',`Contract automatisch verlengd: ${r.object}`,`Het oorspronkelijke opzegmoment is gemist. Het contract is ${timeline.renewalCount}× met ${timeline.renewalYears} jaar verlengd tot ${dateFmt(timeline.effectiveEnd)}. Nieuwe uiterste opzegdatum: ${dateFmt(timeline.effectiveNotice)}.`,r.id));
      } else if(noticeDays!==null){
        if(noticeDays<0){
          items.push(actionItem('danger','Opzegdatum',`Opzegmoment verlopen: ${r.object}`,`De uiterste opzegdatum was ${dateFmt(timeline.effectiveNotice)}. Er is geen verlengtermijn ingevuld.`,r.id));
        } else if(noticeDays<=90){
          items.push(actionItem('danger','Opzegdatum',`Opzegdatum binnen ${noticeDays} dagen`,`${r.object}: uiterlijk opzeggen op ${dateFmt(timeline.effectiveNotice)} voor einde op ${dateFmt(timeline.effectiveEnd)}.`,r.id));
        } else if(noticeDays<=365){
          items.push(actionItem('warning','Opzegdatum',`Opzegdatum binnen 12 maanden`,`${r.object}: uiterlijk opzeggen op ${dateFmt(timeline.effectiveNotice)} voor einde op ${dateFmt(timeline.effectiveEnd)}.`,r.id));
        }
      } else if(timeline.originalEnd){
        items.push(actionItem('warning','Contractcontrole',`Opzegtermijn ontbreekt: ${r.object}`,`Vul de opzegtermijn of uiterste opzegdatum in voor het contract dat eindigt op ${dateFmt(timeline.originalEnd)}.`,r.id));
      }

      if(contractDays!==null && contractDays<=365 && (noticeDays===null || noticeDays>365)){
        const severity=contractDays<=90?'danger':'warning';
        items.push(actionItem(severity,'Contract',`Contracteinde nadert: ${r.object}`,`De huidige einddatum is ${dateFmt(timeline.effectiveEnd)}. Controleer de contractafspraken.`,r.id));
      }
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
function contractBucket(r){ if(r.contract_opgezegd) return 'Opgezegd'; if(r.contract_onbepaalde) return 'Onbepaalde tijd'; if(r.aantal_verlengingen>0) return 'Verlengd'; const d=daysUntil(r.opzegdatum); if(d===null) return 'Geen opzegdatum'; if(d<0) return 'Opzegmoment verlopen'; if(d<=90) return '0-3 mnd'; if(d<=180) return '3-6 mnd'; if(d<=365) return '6-12 mnd'; return '>12 mnd'; }
function chartBar(label,value,total){ const width=total>0 ? Math.round((value/total)*100) : 0; return `<div class="chartRow"><div class="chartLabel"><span>${label}</span><strong>${value}</strong></div><div class="bar"><span style="width:${width}%"></span></div></div>`; }
function renderCharts(data){
  const rented=data.filter(r=>!isVacant(r)).length, vacant=data.length-rented;
  if(el('occupancyChart')) el('occupancyChart').innerHTML = chartBar('Verhuurd',rented,data.length)+chartBar('Leegstaand/geen huurder',vacant,data.length);
  const buckets=['Opgezegd','Opzegmoment verlopen','0-3 mnd','3-6 mnd','6-12 mnd','>12 mnd','Verlengd','Onbepaalde tijd','Geen opzegdatum'];
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

const MAINTENANCE_STATUSES=['Te plannen','Gepland','Afgerond'];
function maintenanceStatusLabel(status){
  const st=norm(status);
  if(st.includes('afgerond') || st.includes('gereed')) return 'Afgerond';
  if(st.includes('gepland') || st.includes('planning')) return 'Gepland';
  return 'Te plannen';
}
function maintStatusClass(status, plannedDate){
  const label=maintenanceStatusLabel(status);
  const days=daysUntil(plannedDate);
  if(label==='Afgerond') return 'ok';
  if(days!==null && days<0) return 'danger';
  return 'warning';
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
        status:maintenanceStatusLabel(m.status),
        description:m.description||'',
        is_service_cost:Boolean(m.is_service_cost),
        service_cost_category:m.service_cost_category||'',
        settlement_year:m.settlement_year||null,
        allocation_percentage:m.allocation_percentage??100,
        service_cost_approved:Boolean(m.service_cost_approved),
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
      status:maintenanceStatusLabel(m.status),
      description:m.description||'',
      is_service_cost:Boolean(m.is_service_cost),
      service_cost_category:m.service_cost_category||'',
      settlement_year:m.settlement_year||null,
      allocation_percentage:m.allocation_percentage??100,
      service_cost_approved:Boolean(m.service_cost_approved),
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
function compareMaintenanceType(a,b){
  const aType=typeof a==='string' ? a : (a?.type || a?.maintenance_type || a?.title || '');
  const bType=typeof b==='string' ? b : (b?.type || b?.maintenance_type || b?.title || '');
  return String(aType).localeCompare(String(bType),'nl',{sensitivity:'base',numeric:true});
}
function maintenanceRowTable(rows){
  const sortedRows=[...rows].sort((a,b)=>{
    const typeCompare=compareMaintenanceType(a,b);
    if(typeCompare!==0) return typeCompare;
    return String(a.planned_date||a.done_date||'9999').localeCompare(String(b.planned_date||b.done_date||'9999'));
  });
  return `<table class="maintenanceObjectTable"><tr><th>Type</th><th>Bouwjaar</th><th>Gedaan</th><th>Planning</th><th>Partij</th><th>Kosten</th><th>Status</th><th>Acties</th></tr>`+
    sortedRows.map(r=>`<tr><td>${r.type}</td><td>${r.build_year||'-'}</td><td>${maintenanceDateFmt(r.done_date)}</td><td>${maintenanceDateFmt(r.planned_date)}</td><td>${r.supplier||'-'}</td><td>${euro(r.cost||0)}</td><td>${statusBadge([maintenanceStatusLabel(r.status), maintStatusClass(r.status,r.planned_date)])}</td><td><button class="miniLink editMaintBtn" data-key="${escAttr(r.key)}">Bewerk</button>${r.objectId?` <button class="miniLink detailBtn" data-id="${r.objectId}">Open object</button>`:''}</td></tr>`).join('') + `</table>`;
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
    if(maintenanceStatusFilter && maintenanceStatusLabel(r.status)!==maintenanceStatusFilter) return false;
    return true;
  }).sort((a,b)=>{
    const addressCompare=compareObjectAddress(
      {straatnaam:a.raw?.property_address||a.address||a.object, huisnummer:a.raw?.house_number||''},
      {straatnaam:b.raw?.property_address||b.address||b.object, huisnummer:b.raw?.house_number||''}
    );
    if(addressCompare!==0) return addressCompare;

    const typeCompare=compareMaintenanceType(a,b);
    if(typeCompare!==0) return typeCompare;

    return String(a.planned_date||a.done_date||'9999').localeCompare(
      String(b.planned_date||b.done_date||'9999')
    );
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
  const types=[...new Set(allRows.map(r=>r.type).filter(Boolean))].sort(compareMaintenanceType);
  const statuses=MAINTENANCE_STATUSES;
  const filterHtml=`<div class="maintenanceFilters maintenanceFiltersWide"><label>Object<select id="maintenanceObjectFilter"><option value="">Alle objecten</option>${objects.map(([key,name])=>`<option value="${escAttr(key)}" ${maintenanceObjectFilter===key?'selected':''}>${name}</option>`).join('')}</select></label><label>Type<select id="maintenanceTypeFilter"><option value="">Alle types</option>${types.map(t=>`<option ${maintenanceTypeFilter===t?'selected':''}>${t}</option>`).join('')}</select></label><label>Status<select id="maintenanceStatusFilter"><option value="">Alle statussen</option>${statuses.map(st=>`<option ${maintenanceStatusFilter===st?'selected':''}>${st}</option>`).join('')}</select></label></div>`;
  const summaryHtml=`<div class="cards maintenanceCards"><div class="card"><span>Totaal regels</span><strong>${rowsAll.length}</strong></div><div class="card"><span>Komende 90 dagen</span><strong>${upcoming90}</strong></div><div class="card"><span>Verlopen</span><strong>${overdue}</strong></div><div class="card"><span>Niet afgerond</span><strong>${open}</strong></div><div class="card"><span>Totale kosten</span><strong>${euro(totalCost)}</strong></div></div>`;
  const grouped={};
  rowsAll.forEach(r=>{ const key=r.objectId || r.object; (grouped[key] ||= {objectId:r.objectId, object:r.object, address:r.address, rows:[]}).rows.push(r); });
  const groupHtml=Object.values(grouped).map(g=>{
    const next=g.rows.map(r=>r.planned_date).filter(Boolean).sort()[0];
    const costs=g.rows.reduce((a,b)=>a+Number(b.cost||0),0);
    return `<article class="maintenanceObjectCard"><div class="maintenanceObjectHeader"><div><h3>${g.object}</h3><p class="meta">${g.address||'Geen adres bekend'} • ${g.rows.length} onderhoudsregels • eerstvolgende: ${maintenanceDateFmt(next)}</p></div><div class="detailActions">${g.objectId?`<button class="secondaryBtn detailBtn" data-id="${g.objectId}">Open object</button>`:''}<button class="smallBtn newMaintBtn" data-id="${g.objectId||''}" data-name="${escAttr(g.object)}">+ Regel</button></div></div><div class="row"><span>Totale onderhoudskosten</span><strong>${euro(costs)}</strong></div>${maintenanceRowTable(g.rows)}</article>`;
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
  el('mEditStatus').value = maintenanceStatusLabel(row?.status);
  el('mEditCost').value = row?.cost || '';
  el('mEditIsServiceCost').value = row?.is_service_cost ? 'Ja' : 'Nee';
  el('mEditServiceCostCategory').value = row?.service_cost_category || '';
  el('mEditSettlementYear').value = row?.settlement_year || '';
  el('mEditAllocationPercentage').value = row?.allocation_percentage ?? 100;
  el('mEditServiceCostApproved').value = row?.service_cost_approved ? 'Ja' : 'Nee';
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
    status:el('mEditStatus').value||'Te plannen',
    cost:numOrNull(el('mEditCost').value),
    is_service_cost:el('mEditIsServiceCost').value==='Ja',
    service_cost_category:el('mEditServiceCostCategory').value||null,
    settlement_year:numOrNull(el('mEditSettlementYear').value),
    allocation_percentage:numOrNull(el('mEditAllocationPercentage').value)??100,
    service_cost_approved:el('mEditServiceCostApproved').value==='Ja',
    description:el('mEditDescription').value||null
  };
  let res;
  if(source==='maintenance'){
    const pId=el('mEditPropertyId').value || null;
    const payload={property_id:pId,title:base.maintenance_type,build_year:base.build_year,completed_date:base.done_date,planned_date:base.planned_date,contractor:base.supplier,cost:base.cost,status:base.status,description:base.description,priority:'Normaal',is_service_cost:base.is_service_cost,service_cost_category:base.service_cost_category,settlement_year:base.settlement_year,allocation_percentage:base.allocation_percentage,service_cost_approved:base.service_cost_approved};
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


function parseDelimitedCsv(text, delimiter){
  const rows=[];
  let row=[], cell='', inQuotes=false;
  const input=String(text||'').replace(/^\uFEFF/, '');
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(ch==='"'){
      if(inQuotes && input[i+1]==='"'){ cell+='"'; i++; }
      else inQuotes=!inQuotes;
    } else if(ch===delimiter && !inQuotes){
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

function countDelimiterOutsideQuotes(line, delimiter){
  let count=0, inQuotes=false;
  for(let i=0;i<line.length;i++){
    if(line[i]==='"'){
      if(inQuotes && line[i+1]==='"') i++;
      else inQuotes=!inQuotes;
    } else if(line[i]===delimiter && !inQuotes) count++;
  }
  return count;
}

function parseCsvAuto(text){
  const firstLine=String(text||'').replace(/^\uFEFF/, '').split(/\r?\n/).find(line=>line.trim()) || '';
  const semicolons=countDelimiterOutsideQuotes(firstLine,';');
  const commas=countDelimiterOutsideQuotes(firstLine,',');
  return parseDelimitedCsv(text, semicolons>commas ? ';' : ',');
}

function csvHeaderKey(value){
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/&/g,' en ')
    .replace(/[_/\\.-]+/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const OBJECT_CSV_ALIASES={
  name:['object','objectnaam','naam object','pand','pandnaam','name'],
  address:['straatnaam','straat','adres','address'],
  house_number:['huisnummer','huis nr','nummer','nr','house number','house_number'],
  city:['stad','plaats','woonplaats','city'],
  property_type:['type pand','pandtype','objecttype','property type','property_type'],
  status:['objectstatus','status pand','property status','status'],
  monthly_rent:['huurprijs excl p m','huurprijs p m','huur per maand','huur pm','maandhuur','monthly rent','monthly_rent'],
  yearly_rent:['huurprijs excl p j','huurprijs p j','huur per jaar','huur pj','jaarhuur','yearly rent','yearly_rent'],
  service_costs:['servicekosten excl','servicekosten','service costs','service_costs'],
  deposit:['waarborgsom','borg','deposit'],
  energy_label:['energielabel','energy label','energy_label'],
  energy_label_valid_until:['energielabel geldig tot','energy label valid until','energy_label_valid_until'],
  rent_increase_month:['maand huurverhogingen','maand huurverhoging','huurverhogingsmaand','rent increase month','rent_increase_month'],
  scope_valid_until:['scope inspectie geldig tot','scope-inspectie geldig tot','scope geldig tot','scope_valid_until'],
  purchase_value:['aankoopwaarde','purchase value','purchase_value'],
  woz_value:['woz waarde','woz-waarde','woz','woz_value'],
  mortgage_value:['hypotheekschuld','hypotheek','mortgage value','mortgage_value'],
  mortgage_interest:['hypotheekrente','hypotheekrente percentage','mortgage interest','mortgage_interest'],
  purchase_date:['aankoopdatum','purchase date','purchase_date'],
  tenant_name:['huurder','naam huurder','huurder naam','tenant','tenant name'],
  tenant_email:['e mail','email','e-mail','email huurder','tenant email'],
  tenant_phone:['telefoonnummer','telefoon','mobiel','phone','tenant phone'],
  contract_start_date:['startdatum contract','contract startdatum','startdatum','contract start date','start_date'],
  contract_end_date:['einddatum contract','contract einddatum','einddatum','contract end date','end_date'],
  contract_notice_date:['opzegdatum','uiterste opzegdatum','notice date','notice_date'],
  notice_period_months:['opzegtermijn','opzegtermijn maanden','notice period','notice period months','notice_period_months'],
  renewal_period_years:['verlenging jaren','verlengtermijn','verlengtermijn jaren','na einde contract','renewal period','renewal period years','renewal_period_years'],
  contract_term:['contractduur','looptijd contract','term'],
  contract_status:['contractstatus','status contract','contract status']
};

const OBJECT_CSV_ALIAS_LOOKUP=(()=>{
  const result={};
  Object.entries(OBJECT_CSV_ALIASES).forEach(([field,aliases])=>aliases.forEach(alias=>{result[csvHeaderKey(alias)]=field;}));
  return result;
})();

function mapObjectCsvHeaders(headers){
  const map={};
  headers.forEach((header,index)=>{
    const field=OBJECT_CSV_ALIAS_LOOKUP[csvHeaderKey(header)];
    if(field && map[field]===undefined) map[field]=index;
  });
  return map;
}

function csvCell(row,map,field){
  const index=map[field];
  return index===undefined ? '' : clean(row[index]);
}

function normalizedImportMarker(value){
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[._/\\-]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function isMissingImportValue(value){
  const marker=normalizedImportMarker(value);
  if(!marker) return true;
  return [
    'nvt','n v t','niet van toepassing','geen','geen waarde','niet aanwezig',
    'onbekend','null','nihil','leeg','geen gegevens','geen data'
  ].includes(marker);
}

function normalizeDepositInput(value){
  return clean(value)
    .normalize('NFKC')
    .replace(/[\u00A0\u202F]/g,' ')
    .replace(/[‐‑‒–—―−]/g,'-')
    .trim();
}

function isNoDepositValue(value){
  const raw=normalizeDepositInput(value).toLowerCase();
  const marker=normalizedImportMarker(raw);

  if(!raw || isMissingImportValue(raw)) return true;

  // Alleen een streepje, eventueel met valuta of leestekens, betekent geen waarborgsom.
  const withoutCurrency=raw.replace(/[€eur\s'"`]/gi,'');
  if(/^[-.,;:()\/\\]+$/.test(withoutCurrency)) return true;

  // Accepteer nulnotaties uit Excel: 0, 0,00, 0.00, € 0, 0,-, € -, enzovoort.
  const compact=withoutCurrency.replace(/[^0-9,.-]/g,'');
  if(/^0+(?:[.,]0*)?(?:,-)?$/.test(compact)) return true;
  if(/^0+,-$/.test(compact)) return true;

  return [
    'geen waarborgsom','geen borg','geen deposito','zonder waarborgsom',
    'zonder borg','zonder deposito','niet van toepassing waarborgsom',
    'niet verschuldigd','nihil','nul','zero'
  ].includes(marker);
}

function parseDepositImportValue(value){
  if(isNoDepositValue(value)) return 0;
  const parsed=parseImportNumber(normalizeDepositInput(value),'waarborgsom');
  return parsed===null ? 0 : parsed;
}

function isIndefiniteContractValue(value){
  const marker=normalizedImportMarker(value);
  if(!marker) return false;
  return marker.includes('onbepaalde')
    || marker.includes('onbepaald')
    || marker.includes('zonder einddatum')
    || marker.includes('geen einddatum')
    || marker.includes('doorlopend')
    || marker.includes('indefinite');
}

function parseImportNumber(value, label='getal'){
  const raw=clean(value);
  if(isMissingImportValue(raw)) return null;
  let normalized=raw.replace(/[€%\s]/g,'');
  if(normalized.includes(',') && normalized.includes('.')){
    normalized=normalized.lastIndexOf(',')>normalized.lastIndexOf('.')
      ? normalized.replace(/\./g,'').replace(',','.')
      : normalized.replace(/,/g,'');
  } else if(normalized.includes(',')){
    normalized=normalized.replace(/\./g,'').replace(',','.');
  } else if((normalized.match(/\./g)||[]).length>1){
    normalized=normalized.replace(/\./g,'');
  }
  const number=Number(normalized);
  if(!Number.isFinite(number)) throw new Error(`Ongeldig ${label}: ${value}`);
  return number;
}

function parseContractPeriodNumber(value,label){
  const raw=clean(value);
  if(!raw) return null;
  const match=raw.match(/\d+(?:[.,]\d+)?/);
  if(!match) throw new Error(`Ongeldige ${label}: ${value}`);
  const number=Number(match[0].replace(',','.'));
  if(!Number.isFinite(number) || number<0) throw new Error(`Ongeldige ${label}: ${value}`);
  return Math.round(number);
}

function parseObjectImportDate(value){
  const raw=clean(value);
  if(isMissingImportValue(raw) || isIndefiniteContractValue(raw)) return null;
  if(/^\d+(?:[.,]\d+)?$/.test(raw)){
    const serial=Number(raw.replace(',','.'));
    if(serial>=20000 && serial<=80000){
      const date=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);
      return date.toISOString().slice(0,10);
    }
  }
  return parseMaintenanceDate(raw);
}

function objectCsvRecords(rows){
  if(rows.length<2) throw new Error('Het CSV-bestand bevat geen gegevensregels.');
  const map=mapObjectCsvHeaders(rows[0]);
  if(map.name===undefined && map.address===undefined){
    throw new Error('Geen kolom “Objectnaam”, “Straatnaam” of “Adres” gevonden. Gebruik het objecten-importsjabloon.');
  }
  const records=[];
  rows.slice(1).forEach((row,index)=>{
    if(!row.some(value=>clean(value))) return;
    const present=new Set(Object.keys(map));
    const address=csvCell(row,map,'address');
    const houseNumber=csvCell(row,map,'house_number');
    const name=csvCell(row,map,'name') || [address,houseNumber].filter(Boolean).join(' ');
    records.push({
      rowNumber:index+2,
      present,
      name,
      address,
      house_number:houseNumber,
      city:csvCell(row,map,'city'),
      property_type:csvCell(row,map,'property_type'),
      status:csvCell(row,map,'status'),
      monthly_rent:csvCell(row,map,'monthly_rent'),
      yearly_rent:csvCell(row,map,'yearly_rent'),
      service_costs:csvCell(row,map,'service_costs'),
      deposit:csvCell(row,map,'deposit'),
      energy_label:csvCell(row,map,'energy_label'),
      energy_label_valid_until:csvCell(row,map,'energy_label_valid_until'),
      rent_increase_month:csvCell(row,map,'rent_increase_month'),
      scope_valid_until:csvCell(row,map,'scope_valid_until'),
      purchase_value:csvCell(row,map,'purchase_value'),
      woz_value:csvCell(row,map,'woz_value'),
      mortgage_value:csvCell(row,map,'mortgage_value'),
      mortgage_interest:csvCell(row,map,'mortgage_interest'),
      purchase_date:csvCell(row,map,'purchase_date'),
      tenant_name:csvCell(row,map,'tenant_name'),
      tenant_email:csvCell(row,map,'tenant_email'),
      tenant_phone:csvCell(row,map,'tenant_phone'),
      contract_start_date:csvCell(row,map,'contract_start_date'),
      contract_end_date:csvCell(row,map,'contract_end_date'),
      contract_notice_date:csvCell(row,map,'contract_notice_date'),
      notice_period_months:csvCell(row,map,'notice_period_months'),
      renewal_period_years:csvCell(row,map,'renewal_period_years'),
      contract_term:csvCell(row,map,'contract_term'),
      contract_status:csvCell(row,map,'contract_status')
    });
  });
  if(!records.length) throw new Error('Er zijn geen gevulde objectregels gevonden.');
  return records;
}

function findPropertyForObjectImport(record){
  const addressKey=norm(record.address);
  const houseKey=norm(record.house_number);
  const fullKey=norm([record.address,record.house_number].filter(Boolean).join(' '));
  const nameKey=norm(record.name);
  return rawProperties.find(property=>{
    const propertyAddress=norm(property.address);
    const propertyHouse=norm(property.house_number);
    const propertyName=norm(property.name);
    return (addressKey && propertyAddress===addressKey && propertyHouse===houseKey)
      || (fullKey && propertyAddress===fullKey)
      || (nameKey && propertyName===nameKey);
  }) || null;
}

function propertyPayloadFromCsv(record, isNew){
  const payload={};
  const textFields=['name','address','house_number','city','property_type','status','energy_label','rent_increase_month'];
  textFields.forEach(field=>{
    if(record.present.has(field)) payload[field]=record[field]||null;
  });
  const numberFields=['monthly_rent','yearly_rent','service_costs','deposit','purchase_value','woz_value','mortgage_value','mortgage_interest'];
  numberFields.forEach(field=>{
    if(!record.present.has(field)) return;
    if(field==='deposit'){
      // Leeg, n.v.t., 0, een liggend streepje of “geen waarborgsom” wordt als € 0 opgeslagen.
      payload[field]=parseDepositImportValue(record[field]);
      return;
    }
    payload[field]=parseImportNumber(record[field],field);
  });
  const dateFields=['energy_label_valid_until','scope_valid_until','purchase_date'];
  dateFields.forEach(field=>{
    if(record.present.has(field)) payload[field]=parseObjectImportDate(record[field]);
  });
  if(isNew){
    payload.name=payload.name || record.name || [record.address,record.house_number].filter(Boolean).join(' ') || 'Nieuw object';
    payload.address=payload.address ?? (record.address || null);
    payload.house_number=payload.house_number ?? (record.house_number || null);
    payload.property_type=payload.property_type || 'Vastgoedobject';
    payload.status=payload.status || 'Actief';
    if(payload.deposit===undefined) payload.deposit=0;
  }
  return payload;
}

async function importObjectCsv(){
  const input=el('objectCsvFile');
  const button=el('chooseObjectCsvBtn');
  const message=el('objectImportMessage');
  const results=el('objectImportResults');
  const file=input?.files?.[0];
  if(!file){ if(message) message.textContent='Kies eerst een objecten-CSV.'; return; }

  button?.classList.add('importing');
  button?.setAttribute('aria-disabled','true');
  if(message) message.textContent='Objecten-CSV wordt gelezen en verwerkt...';
  if(results) results.innerHTML='';

  try{
    const records=objectCsvRecords(parseCsvAuto(await file.text()));
    let propertiesAdded=0, propertiesUpdated=0, tenantsAdded=0, tenantsUpdated=0, contractsAdded=0, contractsUpdated=0;
    const errors=[], warnings=[];

    for(const record of records){
      try{
        if(!record.name && !record.address) throw new Error('Objectnaam of adres ontbreekt.');
        let property=findPropertyForObjectImport(record);
        const propertyWasExisting=Boolean(property);
        const propertyPayload=propertyPayloadFromCsv(record,!property);
        const propertyResult=property
          ? await sb.from('properties').update(propertyPayload).eq('id',property.id).select().single()
          : await sb.from('properties').insert(propertyPayload).select().single();
        if(propertyResult.error) throw propertyResult.error;
        property=propertyResult.data;
        if(propertyWasExisting) propertiesUpdated++;
        else { propertiesAdded++; rawProperties.push(property); }

        const existingContract=rawContracts.find(contract=>contract.property_id===property.id) || null;
        let tenant=existingContract ? rawTenants.find(item=>item.id===existingContract.tenant_id) || null : null;
        if(!tenant && record.tenant_email) tenant=rawTenants.find(item=>norm(item.email)===norm(record.tenant_email)) || null;
        if(!tenant && record.tenant_name) tenant=rawTenants.find(item=>norm(item.name)===norm(record.tenant_name)) || null;

        const hasTenantData=['tenant_name','tenant_email','tenant_phone'].some(field=>record.present.has(field) && record[field]);
        if(hasTenantData){
          if(!tenant && !record.tenant_name){
            warnings.push(`Rij ${record.rowNumber}: huurder overgeslagen omdat de naam ontbreekt.`);
          } else {
            const tenantPayload={};
            if(record.present.has('tenant_name')) tenantPayload.name=record.tenant_name||tenant?.name||null;
            if(record.present.has('tenant_email')) tenantPayload.email=record.tenant_email||null;
            if(record.present.has('tenant_phone')) tenantPayload.phone=record.tenant_phone||null;
            const tenantResult=tenant
              ? await sb.from('tenants').update(tenantPayload).eq('id',tenant.id).select().single()
              : await sb.from('tenants').insert({...tenantPayload,name:tenantPayload.name||record.tenant_name}).select().single();
            if(tenantResult.error) throw tenantResult.error;
            const tenantWasExisting=Boolean(tenant);
            tenant=tenantResult.data;
            if(tenantWasExisting || rawTenants.some(item=>item.id===tenant.id)) tenantsUpdated++;
            else { tenantsAdded++; rawTenants.push(tenant); }
          }
        }

        const indefinite=isIndefiniteContractValue(record.contract_term)
          || isIndefiniteContractValue(record.contract_end_date)
          || isIndefiniteContractValue(record.renewal_period_years)
          || isIndefiniteContractValue(record.contract_status);
        const hasContractData=tenant || ['contract_start_date','contract_end_date','contract_notice_date','notice_period_months','renewal_period_years','contract_term','contract_status'].some(field=>record.present.has(field) && record[field]);
        if(hasContractData){
          const contractPayload={property_id:property.id};
          if(tenant) contractPayload.tenant_id=tenant.id;
          if(record.present.has('contract_start_date')) contractPayload.start_date=parseObjectImportDate(record.contract_start_date);
          if(record.present.has('contract_end_date') || indefinite) contractPayload.end_date=indefinite ? null : parseObjectImportDate(record.contract_end_date);
          if(record.present.has('notice_period_months')) contractPayload.notice_period_months=isMissingImportValue(record.notice_period_months) ? null : parseContractPeriodNumber(record.notice_period_months,'opzegtermijn');
          if(record.present.has('renewal_period_years')) contractPayload.renewal_period_years=(indefinite || isMissingImportValue(record.renewal_period_years)) ? null : parseContractPeriodNumber(record.renewal_period_years,'verlengtermijn');
          if(record.present.has('contract_notice_date')) contractPayload.notice_date=parseObjectImportDate(record.contract_notice_date);
          else if(contractPayload.end_date && contractPayload.notice_period_months) contractPayload.notice_date=shiftIsoMonths(contractPayload.end_date,-contractPayload.notice_period_months);
          if(record.present.has('monthly_rent')) contractPayload.monthly_rent=parseImportNumber(record.monthly_rent,'maandhuur');
          if(record.present.has('contract_status')) contractPayload.status=canonicalContractStatus(record.contract_status);
          else if(!existingContract) contractPayload.status='Actief';
          const contractResult=existingContract
            ? await sb.from('contracts').update(contractPayload).eq('id',existingContract.id).select().single()
            : await sb.from('contracts').insert(contractPayload).select().single();
          if(contractResult.error) throw contractResult.error;
          if(existingContract) contractsUpdated++;
          else { contractsAdded++; rawContracts.push(contractResult.data); }
        }
      } catch(error){
        errors.push(`Rij ${record.rowNumber} · ${escHtml(record.name || [record.address,record.house_number].filter(Boolean).join(' ') || 'Onbekend object')}: ${escHtml(error.message)}`);
      }
    }

    await loadData();
    if(message) message.textContent=`Import klaar: ${propertiesAdded} objecten toegevoegd, ${propertiesUpdated} bijgewerkt, ${errors.length} fouten.`;
    const summary=`<div class="importSummary"><span>CSV-regels: <strong>${records.length}</strong></span><span>Objecten toegevoegd: <strong>${propertiesAdded}</strong></span><span>Objecten bijgewerkt: <strong>${propertiesUpdated}</strong></span><span>Huurders toegevoegd/bijgewerkt: <strong>${tenantsAdded + tenantsUpdated}</strong></span><span>Contracten toegevoegd/bijgewerkt: <strong>${contractsAdded + contractsUpdated}</strong></span></div>`;
    const warningHtml=warnings.length ? `<div class="importNotice warning"><strong>Waarschuwingen (${warnings.length})</strong>${warnings.map(item=>`<span>${escHtml(item)}</span>`).join('')}</div>` : '';
    const errorHtml=errors.length ? `<div class="importNotice danger"><strong>Fouten (${errors.length})</strong>${errors.map(item=>`<span>${item}</span>`).join('')}</div>` : '';
    if(results) results.innerHTML=summary+warningHtml+errorHtml;
  } catch(error){
    console.error(error);
    if(message) message.textContent='Importeren mislukt: '+error.message;
  } finally {
    button?.classList.remove('importing');
    button?.removeAttribute('aria-disabled');
  }
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
        const calculatedStatus=completedDate ? 'Afgerond' : (plannedDate ? 'Gepland' : 'Te plannen');

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

function contractEndDisplay(r){ return r.contract_onbepaalde ? 'Onbepaalde tijd' : dateFmt(r.einddatum_contract); }
function contractPeriodText(r){
  if(r.opzegtermijn_maanden===null || r.opzegtermijn_maanden===undefined || r.opzegtermijn_maanden==='') return 'Niet ingesteld';
  return `${r.opzegtermijn_maanden} ${r.opzegtermijn_maanden===1?'maand':'maanden'}`;
}
function renewalText(r){
  if(r.contract_onbepaalde) return '-';
  if(!r.verlenging_jaren) return 'Geen automatische verlenging';
  return `${r.verlenging_jaren} ${r.verlenging_jaren===1?'jaar':'jaar'}`;
}
function renderContractOverview(data){
  const contracts=data.filter(r=>r.contract?.id);
  const activeContracts=contracts.filter(r=>!r.contract_opgezegd);
  const terminatedContracts=contracts.filter(r=>r.contract_opgezegd);
  const noticeWithin365=activeContracts.filter(r=>!r.contract_onbepaalde && r.contract_timeline?.noticeDays!==null && r.contract_timeline.noticeDays>=0 && r.contract_timeline.noticeDays<=365).length;
  const noticeWithin90=activeContracts.filter(r=>!r.contract_onbepaalde && r.contract_timeline?.noticeDays!==null && r.contract_timeline.noticeDays>=0 && r.contract_timeline.noticeDays<=90).length;
  const renewed=activeContracts.filter(r=>r.aantal_verlengingen>0).length;
  const indefinite=activeContracts.filter(r=>r.contract_onbepaalde).length;
  const missingContract=data.filter(r=>!r.contract?.id).length;
  const needsCheck=data.filter(r=>{
    if(!r.contract?.id) return true;
    if(r.contract_opgezegd) return false;
    if(r.contract_onbepaalde) return r.opzegtermijn_maanden===null || r.opzegtermijn_maanden===undefined;
    return !r.opzegdatum || r.opzegdatum_afwijking || (r.contract_timeline?.noticeDays<0 && !r.verlenging_jaren);
  }).length;
  const target=el('contractOverview');
  if(!target) return;
  target.innerHTML=`<div class="cards contractSummaryCards">
    <div class="card"><span>Totaal contracten</span><strong>${contracts.length}</strong></div>
    <div class="card"><span>Actieve contracten</span><strong>${activeContracts.length}</strong></div>
    <div class="card"><span>Opgezegde contracten</span><strong>${terminatedContracts.length}</strong></div>
    <div class="card"><span>Geen contract gekoppeld</span><strong>${missingContract}</strong></div>
    <div class="card"><span>Opzegmoment &lt; 12 mnd</span><strong>${noticeWithin365}</strong></div>
    <div class="card"><span>Opzegmoment &lt; 90 dagen</span><strong>${noticeWithin90}</strong></div>
    <div class="card"><span>Automatisch verlengd</span><strong>${renewed}</strong></div>
    <div class="card"><span>Onbepaalde tijd</span><strong>${indefinite}</strong></div>
    <div class="card"><span>Controle nodig</span><strong>${needsCheck}</strong></div>
  </div>`;
}

function agendaIsoFromDate(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function agendaDateFromIso(value){
  const parts=isoParts(value);
  if(!parts) return null;
  const date=new Date(parts.year,parts.month-1,parts.day);
  return Number.isNaN(date.getTime())?null:date;
}
function agendaDayDifference(value){
  const date=agendaDateFromIso(value);
  if(!date) return null;
  const today=agendaDateFromIso(isoToday());
  return Math.round((date-today)/86400000);
}
function agendaWhenText(value){
  const days=agendaDayDifference(value);
  if(days===null) return '';
  if(days===0) return 'Vandaag';
  if(days===1) return 'Morgen';
  if(days===-1) return 'Gisteren';
  if(days>0) return `Over ${days} dagen`;
  return `${Math.abs(days)} dagen geleden`;
}
function agendaCategoryLabel(type){
  return ({contract:'Contract',maintenance:'Onderhoud',finance:'Financieel',inspection:'Inspectie',energy:'Energielabel'})[type]||'Overig';
}
function addAgendaEvent(target,event,seen){
  if(!event?.date||!isoParts(event.date)) return;
  const key=[event.date,event.type,event.title,event.objectId||'',event.subtitle||''].join('|');
  if(seen.has(key)) return;
  seen.add(key);
  target.push(event);
}
function buildAgendaEvents(data){
  const events=[];
  const seen=new Set();
  const currentYear=new Date().getFullYear();
  const years=new Set([
    currentYear-1,currentYear,currentYear+1,currentYear+2,
    agendaCursor.getFullYear()-1,agendaCursor.getFullYear(),agendaCursor.getFullYear()+1
  ]);

  data.forEach(r=>{
    const address=[r.straatnaam,r.huisnummer].filter(Boolean).join(' ');
    const objectLine=[r.object,address].filter(Boolean).join(' · ');
    if(r.startdatum_contract){
      addAgendaEvent(events,{date:r.startdatum_contract,type:'contract',title:'Contract gestart',subtitle:objectLine,objectId:r.id},seen);
    }
    if(!r.contract_onbepaalde&&r.opzegdatum){
      addAgendaEvent(events,{date:r.opzegdatum,type:'contract',title:'Uiterste opzegdatum',subtitle:objectLine,objectId:r.id},seen);
    }
    if(!r.contract_onbepaalde&&r.einddatum_contract){
      addAgendaEvent(events,{date:r.einddatum_contract,type:'contract',title:r.contract_opgezegd?'Opgezegd contract eindigt':'Contract eindigt',subtitle:objectLine,objectId:r.id},seen);
    }
    if(r.energielabel_geldig_tot){
      addAgendaEvent(events,{date:r.energielabel_geldig_tot,type:'energy',title:'Energielabel verloopt',subtitle:objectLine,objectId:r.id},seen);
    }
    if(r.scope_inspectie_geldig_tot){
      addAgendaEvent(events,{date:r.scope_inspectie_geldig_tot,type:'inspection',title:'Scope/inspectie',subtitle:objectLine,objectId:r.id},seen);
    }
    const monthIndex=monthMap[norm(r.maand_huurverhoging)];
    if(monthIndex!==undefined){
      years.forEach(year=>{
        addAgendaEvent(events,{
          date:agendaIsoFromDate(new Date(year,monthIndex,1)),
          type:'finance',
          title:'Huurverhoging',
          subtitle:objectLine,
          objectId:r.id
        },seen);
      });
    }
  });

  maintenanceSourceRows(data).forEach(row=>{
    const objectLine=[row.object,row.address].filter(Boolean).join(' · ');
    if(row.done_date){
      addAgendaEvent(events,{
        date:row.done_date,
        type:'maintenance',
        title:`${row.type||'Onderhoud'} uitgevoerd`,
        subtitle:objectLine,
        objectId:row.objectId
      },seen);
    }
    if(row.planned_date&&row.planned_date!==row.done_date&&maintenanceStatusLabel(row.status)!=='Afgerond'){
      addAgendaEvent(events,{
        date:row.planned_date,
        type:'maintenance',
        title:`${row.type||'Onderhoud'} gepland`,
        subtitle:objectLine,
        objectId:row.objectId
      },seen);
    }
  });

  return events.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title,'nl',{sensitivity:'base'}));
}
function agendaFilteredEvents(data){
  const all=buildAgendaEvents(data);
  return agendaTypeFilter==='all'?all:all.filter(event=>event.type===agendaTypeFilter);
}
function agendaListHtml(events,emptyText){
  if(!events.length) return `<p class="agendaEmpty">${emptyText}</p>`;
  return events.slice(0,30).map(event=>{
    const date=agendaDateFromIso(event.date);
    const dateText=date?new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'short',year:'numeric'}).format(date):dateFmt(event.date);
    return `<button class="agendaListItem ${event.type} ${event.objectId?'detailBtn':''}" type="button" ${event.objectId?`data-id="${escAttr(event.objectId)}"`:''}>
      <span class="agendaListDate">${escHtml(dateText)}</span>
      <span class="agendaListMain"><strong>${escHtml(event.title)}</strong><span>${escHtml(event.subtitle||agendaCategoryLabel(event.type))}</span></span>
      <span class="agendaListWhen">${escHtml(agendaWhenText(event.date))}</span>
    </button>`;
  }).join('');
}
function renderAgenda(data){
  const calendar=el('agendaCalendar');
  if(!calendar) return;
  const events=agendaFilteredEvents(data);
  const year=agendaCursor.getFullYear();
  const month=agendaCursor.getMonth();
  const todayIso=isoToday();
  const firstDay=new Date(year,month,1);
  const lastDay=new Date(year,month+1,0);
  const gridStart=new Date(year,month,1-((firstDay.getDay()+6)%7));
  const monthLabel=new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric'}).format(firstDay);
  if(el('agendaMonthLabel')) el('agendaMonthLabel').textContent=monthLabel;
  if(el('agendaTypeFilter')) el('agendaTypeFilter').value=agendaTypeFilter;

  const monthStart=agendaIsoFromDate(firstDay);
  const monthEnd=agendaIsoFromDate(lastDay);
  const monthEvents=events.filter(event=>event.date>=monthStart&&event.date<=monthEnd);
  const upcoming30=events.filter(event=>{const d=agendaDayDifference(event.date);return d!==null&&d>=0&&d<=30;});
  const upcoming90=events.filter(event=>{const d=agendaDayDifference(event.date);return d!==null&&d>=0&&d<=90;});
  const recent90=events.filter(event=>{const d=agendaDayDifference(event.date);return d!==null&&d<0&&d>=-90;}).sort((a,b)=>b.date.localeCompare(a.date));

  if(el('agendaSummary')){
    el('agendaSummary').innerHTML=`
      <div class="card"><span>Deze maand</span><strong>${monthEvents.length}</strong></div>
      <div class="card"><span>Komende 30 dagen</span><strong>${upcoming30.length}</strong></div>
      <div class="card"><span>Komende 90 dagen</span><strong>${upcoming90.length}</strong></div>
      <div class="card"><span>Afgelopen 90 dagen</span><strong>${recent90.length}</strong></div>`;
  }

  const byDate={};
  events.forEach(event=>(byDate[event.date]||=[]).push(event));
  const weekdays=['Ma','Di','Wo','Do','Vr','Za','Zo'];
  let inner=weekdays.map(day=>`<div class="agendaWeekday">${day}</div>`).join('');
  for(let index=0;index<42;index++){
    const date=new Date(gridStart);
    date.setDate(gridStart.getDate()+index);
    const iso=agendaIsoFromDate(date);
    const dayEvents=byDate[iso]||[];
    const classes=['agendaDay'];
    if(date.getMonth()!==month) classes.push('outsideMonth');
    if(iso===todayIso) classes.push('today');
    const visible=dayEvents.slice(0,3).map(event=>`<button class="agendaEvent ${event.type} ${event.objectId?'detailBtn':''}" type="button" title="${escAttr(`${event.title} · ${event.subtitle||''}`)}" ${event.objectId?`data-id="${escAttr(event.objectId)}"`:''}>${escHtml(event.title)}</button>`).join('');
    const more=dayEvents.length>3?`<span class="agendaMore">+${dayEvents.length-3} meer</span>`:'';
    inner+=`<div class="${classes.join(' ')}"><div class="agendaDayHeader"><span class="agendaDayNumber">${date.getDate()}</span></div><div class="agendaDayEvents">${visible}${more}</div></div>`;
  }
  calendar.innerHTML=`<div class="agendaCalendarInner">${inner}</div>`;
  if(el('agendaUpcomingList')) el('agendaUpcomingList').innerHTML=agendaListHtml(upcoming90,'Geen gebeurtenissen in de komende 90 dagen.');
  if(el('agendaRecentList')) el('agendaRecentList').innerHTML=agendaListHtml(recent90,'Geen gebeurtenissen in de afgelopen 90 dagen.');
}
function shiftAgendaMonth(months){
  agendaCursor=new Date(agendaCursor.getFullYear(),agendaCursor.getMonth()+months,1);
  renderAgenda(filtered());
}
function agendaToday(){
  const now=new Date();
  agendaCursor=new Date(now.getFullYear(),now.getMonth(),1);
  renderAgenda(filtered());
}

function render(){
  const data=filtered(), notes=notificationItems(data);
  renderCharts(data);
  el('totalObjects').textContent=data.length;
  el('totalMonthlyRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pm||0),0));
  el('totalRent').textContent=euro(data.reduce((a,b)=>a+Number(b.huur_pj||0),0));
  el('urgentCount').textContent=notes.filter(n=>n.sev==='danger').length;
  el('contractSoon').textContent=data.filter(r=>{const d=r.contract_timeline?.noticeDays; return !r.contract_opgezegd && !r.contract_onbepaalde && d!==null && d>=0 && d<=365;}).length;
  if(el('maintenanceSoon')) el('maintenanceSoon').textContent=data.filter(r=>{const d=daysUntil(r.scope_inspectie_geldig_tot); return d!==null && d<=90;}).length;
  if(el('energySoon')) el('energySoon').textContent=data.filter(r=>{const d=daysUntil(r.energielabel_geldig_tot); return d!==null && d<=180;}).length;
  if(el('vacancyCount')) el('vacancyCount').textContent=data.filter(r=>String(r.status||'').toLowerCase().includes('leeg') || r.huurder==='-').length;
  el('attentionList').innerHTML=notes.slice(0,10).map(actionHtml).join('') || '<p>Geen aandachtspunten gevonden.</p>';
  el('notificationList').innerHTML=notes.map(actionHtml).join('') || '<p>Geen meldingen gevonden.</p>';
  el('objectGrid').innerHTML=data.map(r=>`<article class="objectCard">${photoBox(r.foto_url,'objectPhoto',`Foto van ${r.object}`)}<h3>${r.object}</h3><div class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad}</div><div class="row"><span>Huurder</span><strong>${r.huurder}</strong></div><div class="row"><span>Huur p/m</span><strong>${euro(r.huur_pm)}</strong></div><div class="row"><span>Jaarhuur</span><strong>${euro(r.huur_pj)}</strong></div><div class="row"><span>Bruto rendement</span><strong>${r.bruto_rendement===null?'-':pct(r.bruto_rendement)}</strong></div><div class="row"><span>Contract</span>${statusBadge(r.status_contract)}</div><div class="row"><span>Onderhoud</span>${statusBadge(r.status_scope)}</div><button class="smallBtn detailBtn" data-id="${r.id}">Details</button><button class="smallBtn editBtn" data-id="${r.id}">Bewerken</button></article>`).join('') || '<p>Geen objecten gevonden.</p>';
  refreshPhotos();
  renderContractOverview(data);
  renderFinancialPage(data);
  renderAgenda(data);
  el('contractTable').innerHTML=`<tr><th>Object</th><th>Huurder</th><th>Contractstatus</th><th>Startdatum</th><th>Oorspr. einddatum</th><th>Huidige einddatum</th><th>Opzegtermijn</th><th>Uiterste opzegdatum</th><th>Verlenging</th><th>Status opzegmoment</th><th></th></tr>`+data.map(r=>{
    const originalEnd=r.contract_onbepaalde?'Onbepaalde tijd':dateFmt(r.oorspronkelijke_einddatum_contract);
    const renewalCount=r.aantal_verlengingen?`<span class="subtle">${r.aantal_verlengingen}× toegepast</span>`:'';
    const mismatch=r.opzegdatum_afwijking?`<span class="contractWarning">Wijkt af van berekende datum</span>`:'';
    const hasContract=Boolean(r.contract?.id);
    return `<tr><td><strong>${r.object}</strong><span class="subtle">${r.straatnaam} ${r.huisnummer}</span></td><td>${r.huurder}</td><td>${statusBadge(hasContract?[r.contract_status,r.contract_opgezegd?'warning':'ok']:['Geen contract','danger'])}</td><td>${hasContract?dateFmt(r.startdatum_contract):'-'}</td><td>${hasContract?originalEnd:'-'}</td><td>${hasContract?contractEndDisplay(r):'-'}${hasContract?renewalCount:''}</td><td>${hasContract?contractPeriodText(r):'-'}</td><td>${hasContract?(r.contract_onbepaalde?'Niet van toepassing':dateFmt(r.opzegdatum))+mismatch:'-'}</td><td>${hasContract?renewalText(r):'-'}</td><td>${statusBadge(hasContract?r.status_opzeg:['Geen contract','danger'])}</td><td><button class="miniLink detailBtn" data-id="${r.id}">Open object</button></td></tr>`;
  }).join('');
  if(el('maintenanceOverview')) renderMaintenanceOverview(data);
}
function maintenanceHistoryHtml(r){
  const rows=(r.maintenance_history||[]).map(m=>`<tr><td>${m.maintenance_type||m.title||'-'}</td><td>${m.build_year||'-'}</td><td>${maintenanceDateFmt(m.done_date||m.planned_date)}</td><td>${maintenanceDateFmt(m.planned_date)}</td><td>${m.supplier||'-'}</td><td>${maintenanceStatusLabel(m.status)}</td><td>${euro(m.cost||0)}</td><td><button class="miniLink editMaintBtn" data-key="${rawMaintenanceHistory.some(h=>h.id===m.id)?'history':'maintenance'}:${m.id}">Bewerk</button> <button class="miniLink deleteHistBtn" data-id="${m.id}">Verwijder</button></td></tr>`).join('');
  const table = rows ? `<table><tr><th>Type</th><th>Bouwjaar</th><th>Gedaan</th><th>Planning</th><th>Partij</th><th>Status</th><th>Kosten</th><th></th></tr>${rows}</table>` : '<p class="empty">Nog geen onderhoudshistorie.</p>';
  const form = `<div class="historyForm"><h4>Onderhoudsregel toevoegen</h4><div class="formGrid"><label>Type<select id="histType"><option>Airco</option><option>CV-Installatie</option><option>Brandbeveiliging</option><option>Alarm installatie</option><option>Overheaddeur</option><option>Schilderwerk</option><option>Gevelreiniging</option><option>Onkruid</option><option>Scope-inspectie</option><option>Overig</option></select></label><label>Bouwjaar<input id="histBuildYear" type="number"></label><label>Gedaan<input id="histDoneDate" type="date"></label><label>Planning<input id="histPlannedDate" type="date"></label><label>Partij<input id="histSupplier"></label><label>Status<select id="histStatus"><option>Te plannen</option><option>Gepland</option><option>Afgerond</option></select></label><label>Kosten<input id="histCost" type="number" step="0.01"></label></div><label>Beschrijving<textarea id="histDescription" rows="2"></textarea></label><button class="smallBtn addHistBtn" data-id="${r.id}">Onderhoudsregel toevoegen</button><p id="historyMessage" class="formMessage"></p></div>`;
  return form + table;
}
async function addMaintenanceHistory(propertyId){
  const msg=el('historyMessage'); if(msg) msg.textContent='Bezig met opslaan...';
  const r=vastgoedData.find(x=>x.id===propertyId);
  const payload={property_id:propertyId, property_name:r?.object||null, property_address:r?.straatnaam||null, house_number:r?.huisnummer||null, tenant_name:r?.huurder||null, maintenance_type:el('histType').value, build_year:numOrNull(el('histBuildYear').value), done_date:el('histDoneDate').value||null, planned_date:el('histPlannedDate').value||null, supplier:el('histSupplier').value||null, status:el('histStatus').value||'Te plannen', cost:numOrNull(el('histCost').value), description:el('histDescription').value||null};
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
  el('detailContent').innerHTML=`${photoBox(r.foto_url,'detailPhoto',`Foto van ${r.object}`)}<div class="detailHero"><div class="detailHeroTop"><div><h2>${r.object}</h2><p class="meta">${r.straatnaam} ${r.huisnummer} ${r.stad} • ${r.type} • ${r.status}</p></div><div class="detailActions"><button class="secondaryBtn editBtn" data-id="${r.id}">Bewerken</button></div></div></div><div class="detailGrid"><section class="detailSection"><h3>Algemeen</h3>${kv('Adres',`${r.straatnaam} ${r.huisnummer}`)}${kv('Stad',r.stad)}${kv('Type',r.type)}${kv('Status',r.status)}${kv('Energielabel',r.energielabel)}${kv('Energielabel geldig tot',dateFmt(r.energielabel_geldig_tot))}${kv('Status energielabel',statusBadge(r.status_energy))}</section><section class="detailSection"><h3>Financieel</h3>${kv('Maandhuur',euro(r.huur_pm))}${kv('Jaarhuur',euro(r.huur_pj))}${kv('Servicekosten',euro(r.servicekosten))}${kv('Waarborgsom',euro(r.waarborgsom))}${kv('Aankoopwaarde',euro(r.aankoopwaarde))}${kv('WOZ-waarde',euro(r.woz_waarde))}${kv('Hypotheekschuld',euro(r.hypotheek))}${kv('Overwaarde',euro(r.overwaarde))}${kv('Hypotheekrente',r.hypotheekrente?`${String(r.hypotheekrente).replace('.', ',')}%`:'-')}${kv('Aankoopdatum',dateFmt(r.aankoopdatum))}${kv('Bruto rendement',r.bruto_rendement===null?'-':pct(r.bruto_rendement))}${kv('Huurverhoging',r.maand_huurverhoging||'-')}</section><section class="detailSection"><h3>Huurder</h3>${r.huurder==='-'?'<p class="empty">Geen huurder gekoppeld.</p>':`${kv('Naam',r.huurder)}${kv('E-mail',r.email||'-')}${kv('Telefoon',r.telefoon||'-')}`}</section><section class="detailSection"><h3>Contract</h3>${kv('Contractstatus',statusBadge([r.contract_status,r.contract_opgezegd?'warning':'ok']))}${kv('Startdatum',dateFmt(r.startdatum_contract))}${kv('Oorspronkelijke einddatum',r.contract_onbepaalde?'Onbepaalde tijd':dateFmt(r.oorspronkelijke_einddatum_contract))}${r.aantal_verlengingen?kv('Huidige einddatum',dateFmt(r.einddatum_contract)):''}${kv('Opzegtermijn',contractPeriodText(r))}${kv('Uiterste opzegdatum',r.contract_onbepaalde?'Niet van toepassing':dateFmt(r.opzegdatum))}${kv('Verlenging bij niet-opzeggen',renewalText(r))}${r.aantal_verlengingen?kv('Verlengingen toegepast',`${r.aantal_verlengingen}×`):''}${kv('Status contract',statusBadge(r.status_contract))}${kv('Status opzegmoment',statusBadge(r.status_opzeg))}${r.opzegdatum_afwijking?`<div class="contractDetailNotice"><strong>Controle nodig</strong>De ingevoerde opzegdatum wijkt af van ${r.opzegtermijn_maanden} maanden vóór de oorspronkelijke einddatum. Berekende datum: ${dateFmt(r.contract_timeline.calculatedInitialNotice)}.</div>`:''}${r.aantal_verlengingen?`<div class="contractDetailNotice warning"><strong>Automatische verlenging</strong>Het oorspronkelijke opzegmoment is verstreken. Het contract is ${r.aantal_verlengingen}× met ${r.verlenging_jaren} jaar verlengd. De huidige einddatum is ${dateFmt(r.einddatum_contract)} en de volgende uiterste opzegdatum is ${dateFmt(r.opzegdatum)}.</div>`:''}</section><section class="detailSection"><h3>Onderhoud</h3>${kv('Type',r.onderhoud_titel)}${kv('Datum',maintenanceDateFmt(r.scope_inspectie_geldig_tot))}${kv('Status',statusBadge(r.status_scope))}${kv('Prioriteit',r.onderhoud_prioriteit)}${kv('Kosten',euro(r.onderhoud_kosten))}${kv('Beschrijving',r.onderhoud_omschrijving||'-')}</section><section class="detailSection fullSpan"><h3>Documenten</h3>${documentListHtml(r)}</section><section class="detailSection fullSpan"><h3>Onderhoudshistorie</h3>${maintenanceHistoryHtml(r)}</section></div>`;
  setPage('detail', r.object);
  refreshPhotos();
}
function kv(label,value){return `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`}
function openNewProperty(){ selectedPropertyId=null; el('modalTitle').textContent='Nieuw object'; el('propertyForm').reset(); ['propertyId','tenantId','contractId','maintenanceId'].forEach(id=>el(id).value=''); el('propertyStatus').value='Actief'; el('contractStatus').value='Actief'; if(el('contractNoticePeriodMonths')) el('contractNoticePeriodMonths').value='12'; if(el('contractNoticeDate')) el('contractNoticeDate').dataset.autoCalculated='true'; if(el('contractRenewalPeriodYears')) el('contractRenewalPeriodYears').value=''; el('maintenanceStatus').value='Te plannen'; el('maintenancePriority').value='Normaal'; if(el('propertyPhotoFile')) el('propertyPhotoFile').value=''; el('deletePropertyBtn').classList.add('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
function openEditProperty(id){ const r=vastgoedData.find(x=>x.id===id); if(!r)return; const p=r.property,c=r.contract||{},t=r.tenant||{},m=r.maintenance||{}; el('modalTitle').textContent='Object bewerken'; el('propertyId').value=p.id||''; el('tenantId').value=t.id||''; el('contractId').value=c.id||''; el('maintenanceId').value=m.id||''; el('propertyName').value=p.name||''; el('propertyAddress').value=p.address||''; el('propertyHouseNumber').value=p.house_number||''; el('propertyCity').value=p.city||''; el('propertyType').value=p.property_type||''; el('propertyStatus').value=p.status||'Actief'; el('propertyMonthlyRent').value=p.monthly_rent||''; el('propertyYearlyRent').value=p.yearly_rent||''; el('propertyServiceCosts').value=p.service_costs||''; el('propertyDeposit').value=p.deposit||''; el('propertyEnergyLabel').value=p.energy_label||''; el('propertyEnergyValidUntil').value=p.energy_label_valid_until||''; el('propertyRentIncreaseMonth').value=p.rent_increase_month||''; el('propertyScopeValidUntil').value=p.scope_valid_until||''; if(el('propertyPurchaseValue')) el('propertyPurchaseValue').value=p.purchase_value||''; if(el('propertyWozValue')) el('propertyWozValue').value=p.woz_value||''; if(el('propertyMortgageValue')) el('propertyMortgageValue').value=p.mortgage_value||''; if(el('propertyMortgageInterest')) el('propertyMortgageInterest').value=p.mortgage_interest||''; if(el('propertyPurchaseDate')) el('propertyPurchaseDate').value=p.purchase_date||''; if(el('propertyPhotoUrl')) el('propertyPhotoUrl').value=p.photo_url||''; if(el('propertyPhotoFile')) el('propertyPhotoFile').value=''; el('tenantName').value=t.name||''; el('tenantEmail').value=t.email||''; el('tenantPhone').value=t.phone||''; el('contractStartDate').value=c.start_date||''; el('contractEndDate').value=c.end_date||''; if(el('contractNoticePeriodMonths')) el('contractNoticePeriodMonths').value=c.notice_period_months??''; el('contractNoticeDate').value=c.notice_date||r.contract_timeline?.calculatedInitialNotice||''; el('contractNoticeDate').dataset.autoCalculated=c.notice_date?'false':'true'; if(el('contractRenewalPeriodYears')) el('contractRenewalPeriodYears').value=c.renewal_period_years??''; el('contractStatus').value=canonicalContractStatus(c.status); el('maintenanceTitle').value=m.title||''; el('maintenancePlannedDate').value=m.planned_date||''; el('maintenanceCost').value=m.cost||''; el('maintenancePriority').value=m.priority||'Normaal'; el('maintenanceStatus').value=maintenanceStatusLabel(m.status); el('maintenanceDescription').value=m.description||''; el('deletePropertyBtn').classList.remove('hidden'); el('formMessage').textContent=''; el('propertyModal').classList.remove('hidden'); }
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
  if(el('contractStartDate').value || el('contractEndDate').value || el('contractNoticeDate').value || savedTenant){
    const endDate=el('contractEndDate').value||null;
    const noticeMonths=numOrNull(el('contractNoticePeriodMonths')?.value||'');
    const noticeDate=el('contractNoticeDate').value || (endDate && noticeMonths ? shiftIsoMonths(endDate,-noticeMonths) : null);
    const contractPayload={property_id:savedProperty.id,tenant_id:savedTenant?.id || null,start_date:el('contractStartDate').value||null,end_date:endDate,notice_period_months:noticeMonths,notice_date:noticeDate,renewal_period_years:numOrNull(el('contractRenewalPeriodYears')?.value||''),monthly_rent:numOrNull(el('propertyMonthlyRent').value),status:canonicalContractStatus(el('contractStatus').value)};
    const conRes=await upsertEntity('contracts',contractId,contractPayload);
    if(conRes.error){el('formMessage').textContent=conRes.error.message;return;}
  }
  if(el('maintenanceTitle').value.trim() || el('maintenancePlannedDate').value){ const maintenancePayload={property_id:savedProperty.id,title:el('maintenanceTitle').value.trim()||'Onderhoud',description:el('maintenanceDescription').value||null,planned_date:el('maintenancePlannedDate').value||el('propertyScopeValidUntil').value||null,cost:numOrNull(el('maintenanceCost').value),priority:el('maintenancePriority').value||'Normaal',status:el('maintenanceStatus').value||'Te plannen'}; const mainRes=await upsertEntity('maintenance',maintenanceId,maintenancePayload); if(mainRes.error){el('formMessage').textContent=mainRes.error.message;return;} }
  closeModal(); selectedPropertyId=savedProperty.id; await loadData(); renderDetail(savedProperty.id);
}
async function deleteProperty(){ const id=el('propertyId').value; if(!id || !confirm('Weet je zeker dat je dit object wilt verwijderen?')) return; const {error}=await sb.from('properties').delete().eq('id',id); if(error){el('formMessage').textContent=error.message;return;} closeModal(); selectedPropertyId=null; await loadData(); setPage('objecten','Objecten'); }
function updateCalculatedNoticeDate(){
  const endInput=el('contractEndDate');
  const periodInput=el('contractNoticePeriodMonths');
  const noticeInput=el('contractNoticeDate');
  if(!endInput || !periodInput || !noticeInput) return;
  const months=numOrNull(periodInput.value);
  const calculated=endInput.value && months ? shiftIsoMonths(endInput.value,-months) : '';
  const mayOverwrite=!noticeInput.value || noticeInput.dataset.autoCalculated==='true';
  if(mayOverwrite){
    noticeInput.value=calculated||'';
    noticeInput.dataset.autoCalculated='true';
  }
}

function init(){
  if(!window.supabase){ el('loginError').textContent='Supabase library niet geladen. Ververs de pagina.'; return; }
  sb=window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  initSidebar();
  document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{
    selectedPropertyId=null;
    setPage(btn.dataset.page,btn.dataset.title||btn.textContent.trim());
    if(window.matchMedia('(max-width: 900px)').matches){
      setSidebarCollapsed(true,{persist:false});
    }
  }));
  document.body.addEventListener('click', e=>{
    const detail=e.target.closest('.detailBtn');
    const edit=e.target.closest('.editBtn');
    const upload=e.target.closest('.uploadDocBtn');
    const openDoc=e.target.closest('.openDocBtn');
    const deleteDoc=e.target.closest('.deleteDocBtn');
    const addHist=e.target.closest('.addHistBtn');
    const deleteHist=e.target.closest('.deleteHistBtn');
    const editMaint=e.target.closest('.editMaintBtn');
    const newMaint=e.target.closest('.newMaintBtn');
    const rentEdit=e.target.closest('.rentEditBtn');
    const quickLetter=e.target.closest('.rentQuickLetterBtn');
    const serviceEdit=e.target.closest('.serviceCostEditBtn');
    const serviceQuickLetter=e.target.closest('.serviceCostQuickLetterBtn');
    if(detail) renderDetail(detail.dataset.id);
    if(edit) openEditProperty(edit.dataset.id);
    if(upload) uploadDocument(upload.dataset.id);
    if(openDoc) openDocument(openDoc.dataset.path);
    if(deleteDoc) deleteDocument(deleteDoc.dataset.id, deleteDoc.dataset.path);
    if(addHist) addMaintenanceHistory(addHist.dataset.id);
    if(deleteHist) deleteMaintenanceHistory(deleteHist.dataset.id);
    if(editMaint){ const row=findMaintenanceRowByKey(editMaint.dataset.key); if(row) openMaintenanceModal('edit', row); }
    if(newMaint) openMaintenanceModal('new', null, newMaint.dataset.id || '');
    if(rentEdit) openRentIncreaseModal(rentEdit.dataset.id,rentEdit.dataset.date);
    if(quickLetter){ openRentIncreaseModal(quickLetter.dataset.id,quickLetter.dataset.date); setTimeout(openRentConceptLetter,0); }
    if(serviceEdit) openServiceCostModal(serviceEdit.dataset.id,serviceEdit.dataset.year);
    if(serviceQuickLetter){ openServiceCostModal(serviceQuickLetter.dataset.id,serviceQuickLetter.dataset.year); setTimeout(openServiceCostLetter,0); }
  });
  el('loginBtn').addEventListener('click', async()=>{ el('loginError').textContent='Bezig met inloggen...'; const email=el('email').value.trim(); const password=el('password').value; const {error}=await sb.auth.signInWithPassword({email,password}); if(error){ el('loginError').textContent='Inloggen mislukt: '+error.message; return;} el('loginError').textContent=''; showApp(); await loadBranding(); await loadData(); });
  el('password').addEventListener('keydown', e=>{ if(e.key==='Enter') el('loginBtn').click(); });
  el('logoutBtn').addEventListener('click', async()=>{ await sb.auth.signOut(); vastgoedData=[]; await applyBranding(DEFAULT_BRANDING); showLogin(); });
  el('search').addEventListener('input', e=>{ query=e.target.value; render(); });
  document.body.addEventListener('change', e=>{
    if(e.target.id==='maintenanceObjectFilter'){ maintenanceObjectFilter=e.target.value; render(); }
    if(e.target.id==='maintenanceTypeFilter'){ maintenanceTypeFilter=e.target.value; render(); }
    if(e.target.id==='maintenanceStatusFilter'){ maintenanceStatusFilter=e.target.value; render(); }
    if(e.target.id==='serviceCostYear'){ serviceCostYear=Number(e.target.value); renderServiceCostOverview(filtered()); }
  });
  el('newPropertyBtn').addEventListener('click', openNewProperty);
  const objectCsvInput=el('objectCsvFile');
  if(objectCsvInput){
    objectCsvInput.addEventListener('change', async e=>{
      const file=e.target.files?.[0];
      if(file) await importObjectCsv();
      e.target.value='';
    });
  }
  const maintenanceCsvInput=el('maintenanceCsvFile');
  if(maintenanceCsvInput){
    maintenanceCsvInput.addEventListener('change', async e=>{
      const file=e.target.files?.[0];
      if(file) await importMaintenanceCsv();
      e.target.value='';
    });
  }
  el('contractEndDate')?.addEventListener('change',updateCalculatedNoticeDate);
  el('contractNoticePeriodMonths')?.addEventListener('input',updateCalculatedNoticeDate);
  el('contractNoticeDate')?.addEventListener('input',()=>{ el('contractNoticeDate').dataset.autoCalculated='false'; });
  el('refreshCbsBtn')?.addEventListener('click',()=>loadCbsIndexData(true));
  el('closeRentIncreaseModalBtn')?.addEventListener('click',closeRentIncreaseModal);
  el('rentIncreaseForm')?.addEventListener('submit',saveRentProposal);
  el('rentOldIndex')?.addEventListener('input',updateRentModalCalculation);
  el('rentNewIndex')?.addEventListener('input',updateRentModalCalculation);
  el('rentFinalRent')?.addEventListener('input',()=>{el('rentFinalRent').dataset.autoCalculated='false';});
  el('rentProposalStatus')?.addEventListener('change',updateRentApplyButton);
  el('rentLetterBtn')?.addEventListener('click',openRentConceptLetter);
  el('applyRentIncreaseBtn')?.addEventListener('click',applyRentIncrease);
  document.querySelectorAll('.financialTab').forEach(button=>button.addEventListener('click',()=>setFinancialTab(button.dataset.financialTab)));
  el('agendaPrevBtn')?.addEventListener('click',()=>shiftAgendaMonth(-1));
  el('agendaTodayBtn')?.addEventListener('click',agendaToday);
  el('agendaNextBtn')?.addEventListener('click',()=>shiftAgendaMonth(1));
  el('agendaTypeFilter')?.addEventListener('change',event=>{agendaTypeFilter=event.target.value||'all';renderAgenda(filtered());});
  el('closeServiceCostModalBtn')?.addEventListener('click',closeServiceCostModal);
  el('serviceCostForm')?.addEventListener('submit',saveServiceCostSettlement);
  el('serviceMonthsCharged')?.addEventListener('input',updateServiceCostModalCalculation);
  el('serviceFinalAdvance')?.addEventListener('input',updateServiceCostModalCalculation);
  el('serviceFinalActual')?.addEventListener('input',updateServiceCostModalCalculation);
  el('serviceCostLetterBtn')?.addEventListener('click',openServiceCostLetter);
  el('backToObjectsBtn').addEventListener('click',()=>{ selectedPropertyId=null; setPage('objecten','Objecten'); });
  el('brandingForm').addEventListener('submit',saveBranding);
  el('resetBrandingBtn').addEventListener('click',resetBranding);
  ['brandingCompanyName','brandingDashboardName','brandingPrimaryColor','brandingAccentColor'].forEach(id=>el(id).addEventListener('input',previewBrandingForm));
  el('notificationSettingsForm')?.addEventListener('submit',saveNotificationSettings);
  el('previewNotificationBtn')?.addEventListener('click',()=>renderNotificationPreview());
  el('testNotificationBtn')?.addEventListener('click',sendNotificationTestMail);
  el('closeModalBtn').addEventListener('click', closeModal); el('propertyForm').addEventListener('submit', saveProperty); el('deletePropertyBtn').addEventListener('click', deleteProperty); el('closeMaintenanceModalBtn').addEventListener('click', closeMaintenanceModal); el('maintenanceEditForm').addEventListener('submit', saveMaintenanceEdit); el('deleteMaintenanceRowBtn').addEventListener('click', deleteMaintenanceEdit);
  checkSession();
}
document.addEventListener('DOMContentLoaded', init);
