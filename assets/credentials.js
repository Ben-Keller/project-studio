'use strict';
const $ = id => document.getElementById(id);
let data, csrf, page = 0;
let sortKey = 'name', sortDirection = 1;
const sortText = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});
const size = 30;
const mobileLayout = window.matchMedia('(max-width: 760px)');
const updateFilterLayout = () => { document.querySelector('.filter-disclosure').open = !mobileLayout.matches; };
mobileLayout.addEventListener('change', updateFilterLayout);
updateFilterLayout();
const esc = v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function notice(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = false; }
async function api(action, body) {
  const response = await fetch('/api/credentials/' + action, {method:'POST', headers:{'Content-Type':'application/json','X-Studio-CSRF':csrf}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed. Check your vault before retrying.');
  return result;
}
async function busy(button, work) { button.disabled = true; try { await work(); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } }
function tab(name) {
  if (!['register','add','connect','guide'].includes(name)) name = 'register';
  if (name !== 'add') $('key-value').value = '';
  document.querySelector('.add-key-action').hidden = name === 'add';
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === name));
    button.tabIndex = button.dataset.tab === name ? 0 : -1;
  }
  for (const section of document.querySelectorAll('[role=tabpanel]')) section.hidden = section.id !== name;
}
function navigateTab(name) {
  history.replaceState(null, '', '#' + name);
  tab(name);
  window.scrollTo({top:0, behavior:'instant'});
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => navigateTab(b.dataset.tab)));
document.querySelectorAll('a[href="#add"], a[href="#guide"]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); navigateTab(a.hash.slice(1));
}));
window.addEventListener('hashchange', () => tab(location.hash.slice(1)));
document.querySelector('.tabs').addEventListener('keydown', e => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); navigateTab(tabs[next].dataset.tab); tabs[next].focus();
});
window.addEventListener('pagehide', () => { $('key-value').value = ''; });
function projectRecords(slug) {
  if (!slug) return data.credentials;
  const card = data.studio_cards.find(c => c.slug === slug);
  const ids = new Set([...(card?.credential_records || []), ...(card?.reference_records || [])]);
  return data.credentials.filter(r => r.studio_project === slug || ids.has(r.id) || card?.paths.includes(r.root));
}
const active = r => r.tracking_required && !['retired','accepted exception'].includes(r.rotation_status);
const nextDeadline = r => r.rotation_status === 'complete' && r.last_rotated_at && r.rotation_due_at <= r.last_rotated_at ? null : r.rotation_due_at;
const due = r => active(r) && ((r.expires_at && r.expires_at <= today()) || (nextDeadline(r) && nextDeadline(r) <= today()));
const unscheduled = g => g.members.some(active) && !g.members.some(r => active(r) && (r.expires_at || nextDeadline(r)));
const unknownExpiry = r => r.tracking_required && r.classification !== 'application' && !r.expires_at && r.expiry_status !== 'no expiry';
const distinct = values => [...new Set(values.filter(Boolean))];
const statusLabel = value => ({complete:'Verified', 'review scheduled':'Review scheduled', 'not started':'Needs review', 'stored; consumers need verification':'Verify consumers', 'in progress':'In progress', 'accepted exception':'Accepted exception', blocked:'Blocked', retired:'Retired'}[value] || 'Needs review');
const dateLabel = value => {
  const date = new Date(String(value).slice(0,10) + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date);
};
function grouped() {
  const byId = new Map(data.credentials.map(r => [r.id,r]));
  return (data.credential_groups || data.credentials.map(r => ({id:r.id,record_ids:[r.id]}))).map(g => ({...g, members:g.record_ids.map(id => byId.get(id)).filter(Boolean)}));
}
function searchableText(g) {
  return g.members.flatMap(r => [r.name, r.project, r.provider, r.store, r.environment,
    r.consumer, r.owner, r.classification_label, r.rotation_status, r.note,
    r.update_instructions, r.tracking_reason, r.root, r.path,
    r.vault_reference?.folder, r.vault_reference?.project_id,
    ...(Array.isArray(r.consumers) ? r.consumers : [r.consumers])])
    .filter(v => typeof v === 'string').join(' ').toLocaleLowerCase();
}
function groupSortValue(g) {
  if (sortKey === 'date') return g.members.flatMap(r => [r.expires_at, nextDeadline(r)]).filter(Boolean).sort()[0] || '';
  if (sortKey === 'status') return distinct(g.members.map(r => statusLabel(r.rotation_status)))[0] || '';
  const field = {name:'name', project:'project', store:'store'}[sortKey];
  return distinct(g.members.map(r => r[field]))[0] || '';
}
function compareGroups(a, b) {
  const av = groupSortValue(a), bv = groupSortValue(b);
  // Missing dates/details stay last in either direction.
  if (!av || !bv) return av ? -1 : bv ? 1 : sortText.compare(a.id, b.id);
  return sortDirection * sortText.compare(av, bv) || sortText.compare(a.id, b.id);
}
function scopeMatch(r, scope, filter) {
  if (scope === 'manage') return active(r) || (filter === 'exception' && r.rotation_status === 'accepted exception');
  if (scope === 'exception') return r.rotation_status === 'accepted exception';
  if (scope === 'retired') return r.rotation_status === 'retired';
  return scope === 'all' || r.classification === scope;
}
function render() {
  const access = data.access_protection || {};
  $('access-summary').textContent = `${access.development_projects || 0} projects are configured for read-only development access in separate vaults. Staging and production use their existing deployment settings; shared access is recorded for review.`;
  const up = data.upcoming || [];
  const missing = grouped().filter(unscheduled).length;
  $('upcoming-section').hidden = !up.length && !missing;
  $('upcoming-count').textContent = `${up.length} dates${missing ? ` · ${missing} unscheduled` : ''}`;
  $('unscheduled-summary').textContent = missing ? `${missing} credential groups have no expiry or next review date. Choose “No date scheduled” below to review them.` : '';
  $('upcoming').innerHTML = up.map(i => { const d = i.days_left, left = d < 0 ? `${-d} days overdue` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
    return `<li><span class="${d < 0 ? 'badge' : 'muted'}">${esc(left)}</span> <strong>${esc(i.name)}</strong> · ${esc(i.project)} <small>${esc(i.kind)} ${esc(i.date)}${i.hint ? ` · run <code>${esc(i.hint)}</code>` : ''}</small></li>`; }).join('');
  const groups = grouped(), managed = groups.filter(g => g.members.some(active));
  const metrics = [[managed.length,'Active keys'],[managed.filter(g => g.members.some(due)).length,'Due or expired'],[managed.filter(g => g.members.some(r => r.rotation_status === 'blocked')).length,'Blocked'],[managed.filter(g => g.members.every(r => r.rotation_status === 'complete')).length,'Verified rotations']];
  $('metrics').innerHTML = metrics.map(([n,label]) => `<div class="metric"><strong>${n}</strong><span>${esc(label)}</span></div>`).join('');
  const counts = data.classification_counts || {};
  $('scope-summary').textContent = `${counts.local || 0} local-only entries · ${counts.reference || 0} references · ${counts.configuration || 0} identifiers/configuration. These remain available in View and are excluded from rotation reminders. Groups reflect recorded matching-value evidence, not a fresh validity check.`;
  const coverage = data.deployment_coverage || {};
  $('coverage-summary').textContent = coverage.summary || 'Deployment coverage is being recorded. The original inventory remains available above.';
  $('coverage-records').innerHTML = (coverage.scopes || []).map(r => `<tr><td>${esc(r.provider)}</td><td>${esc(r.scope)}</td><td>${esc(r.result)}</td></tr>`).join('');
  const terms = $('search').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean), filter = $('filter-status').value, scope = $('filter-scope').value;
  const projectIds = new Set(projectRecords($('filter-project').value).map(r => r.id));
  $('filter-summary').textContent = [$('filter-project').selectedOptions[0]?.textContent, $('filter-scope').selectedOptions[0]?.textContent, filter ? $('filter-status').selectedOptions[0]?.textContent : ''].filter(Boolean).join(' · ');
  const records = groups.filter(g => terms.every(term => searchableText(g).includes(term)) && g.members.some(r => projectIds.has(r.id) && scopeMatch(r,scope,filter) && (!filter || ({verified:r.rotation_status === 'complete',scheduled:r.rotation_status === 'review scheduled',blocked:r.rotation_status === 'blocked',urgent:r.tracking_required && /urgent|critical|immediate/i.test(r.priority),due:due(r),unscheduled:unscheduled(g),exception:r.rotation_status === 'accepted exception',unknown:unknownExpiry(r),managed:r.store === 'Infisical',github:/github/i.test(r.store)})[filter]))).sort(compareGroups);
  for (const button of document.querySelectorAll('[data-sort]')) {
    const selected = button.dataset.sort === sortKey, direction = sortDirection === 1 ? 'ascending' : 'descending';
    button.closest('th').setAttribute('aria-sort', selected ? direction : 'none');
    button.querySelector('.sort-direction').textContent = selected ? (sortDirection === 1 ? ' ↑' : ' ↓') : '';
    button.setAttribute('aria-label', button.dataset.label + (selected ? ', sorted ' + direction + '; reverse order' : '; sort ascending'));
  }
  page = Math.max(0, Math.min(page, Math.ceil(records.length/size)-1));
  $('result-count').textContent = `${records.length} keys · ${records.reduce((n,g)=>n+g.members.length,0)} recorded locations`;
  $('records').innerHTML = records.slice(page*size,(page+1)*size).map(g => {
    const members=g.members, r=members.find(active) || members[0], names=distinct(members.map(x=>x.name)), tracked=members.some(x=>x.tracking_required);
    const dates=distinct(members.map(x=>x.expires_at)), deadlines=distinct(members.map(nextDeadline));
    const next = [...dates, ...deadlines].filter(Boolean).sort()[0];
    const expiry = !tracked ? 'Not tracked' : next ? `${dates.includes(next) ? 'Expires' : 'Review'} ${dateLabel(next)}` : 'No date scheduled';
    const expiryDetail = tracked && members.some(unknownExpiry) ? 'Issuer expiry unknown' : tracked && dates.length && !dates.includes(next) ? `Expires ${dates.map(dateLabel).join(' · ')}` : '';
    const progress=members.every(x=>x.rotation_status==='retired')?'Retired':!tracked?'Outside rotation list':distinct(members.map(x=>statusLabel(x.rotation_status))).join(' · ');
    const blocked=members.some(x=>x.rotation_status==='blocked');
    return `<tr><td><strong>${esc(names[0])}</strong>${names.length>1?`<small>Also: ${esc(names.slice(1).join(', '))}</small>`:''}<small>${esc(distinct(members.map(x=>x.provider || x.classification_label)).join(' · '))}</small></td><td>${esc(distinct(members.map(x=>x.project)).join(' · '))}<small>${esc(distinct(members.map(x=>[x.environment,x.consumer].filter(Boolean).join(' / '))).join(' · '))}</small></td><td>${esc(distinct(members.map(x=>x.store)).join(' · '))}${members.length>1?`<details class="credential-locations"><summary>${members.length} locations</summary><ul>${members.map(m=>`<li>${esc(m.project)} · ${esc([m.environment,m.consumer,m.store].filter(Boolean).join(' / '))}</li>`).join('')}</ul></details>`:''}</td><td>${esc(expiry)}${expiryDetail?`<small>${esc(expiryDetail)}</small>`:''}${members.some(due)?'<span class="badge">Due / expired</span>':''}</td><td><span class="status-text${blocked?' status-blocked':''}">${esc(progress)}</span></td><td><button data-record="${esc(r.id)}" aria-label="Edit ${esc(r.name)} details">Details</button></td></tr>`;
  }).join('') || '<tr><td colspan="6">No entries in this view. Use View to include local-only values or source references.</td></tr>';
  $('page-label').textContent = `Page ${page+1} of ${Math.max(1,Math.ceil(records.length/size))}`;
  $('previous').disabled = page === 0; $('next').disabled = (page+1)*size >= records.length;
}
function updateTarget() {
  const form = $('add-form'), b = data.bindings[form.elements.project.value];
  const previous = form.elements.consumer.value;
  form.elements.consumer.innerHTML = '<option value="default">Default app (' + esc(b?.folder || '/') + ')</option>' + Object.entries(b?.consumers || {}).map(([id,c]) => `<option value="${esc(id)}">${esc(c.label || id)} (${esc(c.folder)})</option>`).join('');
  if ([...form.elements.consumer.options].some(o => o.value === previous)) form.elements.consumer.value = previous;
  const folder = b?.consumers?.[form.elements.consumer.value]?.folder || b?.folder;
  const label = form.elements.environment.selectedOptions[0].textContent;
  $('target-note').textContent = b ? `Destination: ${b.name} → ${label} → ${folder}. ${form.elements.environment.value === 'dev' ? 'Used by the development helper after restart.' : 'Vault write only. Deployments and GitHub secrets still need an explicit update.'}` : 'Connect this project to Infisical before saving a key.';
  $('vault-link').href = b?.domain || 'https://app.infisical.com';
}
function updateConnection() {
  const form = $('connect-form'), slug = form.elements.project.value, b = data.bindings[slug];
  form.elements.domain.value = b?.domain || 'https://app.infisical.com';
  form.elements.project_id.value = b?.project_id || '';
  form.elements.folder.value = b?.folder || '/';
  form.elements.required.value = (b?.required || []).join('\n');
  form.elements.consumer_folders.value = Object.entries(b?.consumers || {}).map(([name,c]) => name + '=' + c.folder).join('\n');
  const card = data.studio_cards.find(c => c.slug === slug);
  $('link-root').innerHTML = (card?.paths || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  $('link-folder').disabled = !card?.paths.length;
}
async function load() {
  const response = await fetch('/api/credentials/state');
  if (!response.ok) throw new Error('Open Keys from the local Studio address to continue.');
  const payload = await response.json(); data = payload.inventory; csrf = payload.csrf;
  const selected = Object.fromEntries(['filter-project','add-project','connect-project'].map(id => [id,$(id).value]));
  for (const id of Object.keys(selected)) {
    $(id).innerHTML = (id === 'filter-project' ? '<option value="">All projects</option>' : '') + data.studio_cards.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}${data.bindings[c.slug] ? ' · connected' : ''}</option>`).join('');
    if (selected[id]) $(id).value = selected[id];
  }
  $('cli-status').textContent = payload.cli_installed ? 'Infisical CLI installed. Login is checked when you access a vault.' : 'Infisical CLI is not installed. Install it with brew install infisical/get-cli/infisical.';
  render(); updateConnection(); updateTarget();
}
$('search').addEventListener('input', () => { page = 0; render(); });
for (const button of document.querySelectorAll('[data-sort]')) button.addEventListener('click', () => {
  sortDirection = sortKey === button.dataset.sort ? -sortDirection : 1;
  sortKey = button.dataset.sort; page = 0; render();
});
for (const id of ['filter-project','filter-status','filter-scope']) $(id).addEventListener('change', () => { page = 0; render(); });
$('previous').onclick = () => { page--; render(); }; $('next').onclick = () => { page++; render(); };
$('connect-project').onchange = updateConnection;
$('add-project').onchange = () => { $('key-value').value = ''; $('add-consumer').value = 'default'; updateTarget(); };
$('add-consumer').onchange = () => { $('key-value').value = ''; updateTarget(); };
$('add-form').elements.environment.onchange = () => { $('key-value').value = ''; updateTarget(); };
$('connect-form').onsubmit = e => { e.preventDefault(); const form = e.currentTarget; busy(form.querySelector('button'), async () => { const body = Object.fromEntries(new FormData(form)); body.required = body.required.split(/[\s,]+/).filter(Boolean); body.consumers = {}; for (const line of body.consumer_folders.split('\n').filter(s => s.trim())) { const parts = line.split('='); if (parts.length !== 2) throw new Error('Use service=/folder, one per line.'); const name=parts[0].trim(), folder=parts[1].trim(); body.consumers[name]={folder,required:data.bindings[body.project]?.consumers?.[name]?.required || []}; } delete body.consumer_folders; await api('connect',body); await load(); notice('Connection saved. Install the shared workflow below, then add your development keys.'); }); };
$('link-folder').onclick = e => busy(e.currentTarget, async () => { const result = await api('link',{project:$('connect-project').value,root:$('link-root').value}); notice(result.message); });
$('add-form').onsubmit = e => { e.preventDefault(); const form = e.currentTarget; busy(form.querySelector('button[type=submit]'), async () => {
  const body = Object.fromEntries(new FormData(form)); body.replace = form.elements.replace.checked;
  // Clear the visible control before the network call. No retries retain the value.
  $('key-value').value = '';
  try { const result = await api('save',body); await load(); notice(result.message); }
  finally { body.value = ''; }
}); };
$('check-vault').onclick = e => busy(e.currentTarget, async () => { const form = $('add-form'); $('vault-status').textContent = 'Checking…'; try { const result = await api('status',{project:form.elements.project.value,environment:form.elements.environment.value,consumer:form.elements.consumer.value}); $('vault-status').textContent = `Saved names:\n${result.names.join('\n') || '(none)'}\n\nMissing required names:\n${result.missing.join('\n') || '(none)'}`; } catch(error) { $('vault-status').textContent = ''; throw error; } });
function openRecord(id) {
  const r = data.credentials.find(x => x.id === id), form = $('metadata-form');
  if (!r) return;
  form.reset(); for (const field of form.elements) if (field.name) field.value = typeof r[field.name] === 'string' ? r[field.name] : field.name === 'consumers' && Array.isArray(r.consumers) ? r.consumers.join('\n') : '';
  if (!form.elements.rotation_status.value) form.elements.rotation_status.value = 'not started';
  if (!form.elements.expiry_status.value) form.elements.expiry_status.value = 'unknown';
  if (!form.elements.tracking_class.value) form.elements.tracking_class.value = 'auto';
  $('detail-title').textContent = r.name;
  $('detail-context').textContent = [r.project,r.environment,r.store].filter(Boolean).join(' · ');
  $('detail-evidence').textContent = `${r.project} · ${r.store} · ${r.environment}. ${r.action || ''} ${(r.evidence || []).map(x => x.path || x.location || '').join('; ')}`;
  $('classification-evidence').textContent = `${r.classification_label}: ${r.classification_reason} Evidence: ${r.classification_evidence}`;
  const group = grouped().find(g => g.members.some(m => m.id === id));
  $('group-locations').hidden = !group || group.members.length < 2;
  $('group-members').innerHTML = (group?.members || []).map(m => `<li><strong>${esc(m.name)}</strong> · ${esc(m.project)} · ${esc(m.environment)}${m.consumer?' / '+esc(m.consumer):''} · ${esc(m.store)} <button type="button" data-record="${esc(m.id)}" ${m.id===id?'disabled':''}>${m.id===id?'Selected':'Edit this location'}</button></li>`).join('');
  $('group-proof').textContent = (group?.evidence || []).map(e => `${e.reason} Observed ${String(e.observed_at).slice(0,10)}.`).join(' ');
  if (!$('detail').open) $('detail').showModal();
}
for (const id of ['records','group-members']) $(id).onclick = e => { const button=e.target.closest('[data-record]'); if(button)openRecord(button.dataset.record); };
$('close-detail').onclick = () => $('detail').close();
$('metadata-form').onsubmit = e => { e.preventDefault(); const form = e.currentTarget; busy(form.querySelector('.primary'), async () => { await api('metadata',Object.fromEntries(new FormData(form))); $('detail').close(); await load(); notice('Credential details saved.'); }); };
$('download').onclick = () => { const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='studio-credential-metadata.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
load().then(() => { const q = new URLSearchParams(location.search), project=q.get('project'); if (data.studio_cards.some(c => c.slug === project)) { $('filter-project').value=project; $('add-project').value=project; $('connect-project').value=project; updateConnection(); updateTarget(); render(); } if (q.get('consumer') && data.bindings[project]?.consumers?.[q.get('consumer')]) { $('add-consumer').value=q.get('consumer'); updateTarget(); } $('key-name').value=q.get('name') || ''; tab(location.hash.slice(1)); }).catch(error => notice(error.message,true));

// Preserve the destination when returning to the shared Studio shell.
document.querySelectorAll("[data-return-mode]").forEach(link => link.addEventListener("click", () => {
  localStorage.setItem("projectStudioMode", link.dataset.returnMode);
}));
