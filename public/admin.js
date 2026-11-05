const $ = selector => document.querySelector(selector);
const labels = {self: 'Verbindung zu mir', together: 'Verbindung zu dir', email: 'E-Mail für uns'};
const intervals = {daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich'};
const views = {
  sessions: {title: 'Sessions', eyebrow: 'VERBINDUNGEN BEGLEITEN', description: 'Session-IDs finden, ihre Gültigkeit anpassen und den Zugang verwalten.', create: '+ Neue Session', search: 'Session-ID suchen …'},
  emails: {title: 'E-Mail-Adressen', eyebrow: 'IN VERBINDUNG BLEIBEN', description: 'Gespeicherte E-Mail-Paare und ihren gemeinsamen Rhythmus verwalten.', create: '+ E-Mail-Paar', search: 'E-Mail-Adresse suchen …'},
  lists: {title: 'Fragen & Werte', eyebrow: 'IMPULSE GESTALTEN', description: 'Eigene Listen erstellen und in den passenden Methoden verwenden.', create: '+ Neue Liste', search: 'Listenname suchen …'}
};
let csrf = '', view = 'sessions', offset = 0, total = 0, entries = [], editing = null, deleting = null, loadSequence = 0;
function message(selector, text, error = false) {
  $(selector).textContent = text;
  $(selector).classList.toggle('error', error);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function signedOut(text = '') {
  csrf = ''; entries = []; loadSequence++;
  $('#workspace').hidden = true; $('#login-panel').hidden = false;
  $('#entries').replaceChildren(); $('#search').value = ''; offset = 0;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('#edit-form').reset(); $('#edit-fields').replaceChildren(); editing = deleting = null;
  message('#login-message', text, Boolean(text));
}
async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch('/api/admin/' + path, {method, credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: body === undefined ? undefined : JSON.stringify(body)});
  } catch { throw new Error('Die Verbindung ist gerade nicht erreichbar. Bitte versuche es erneut.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('Der Server ist gerade nicht erreichbar.'); }
  if (response.status === 401 && path !== 'login' && path !== 'me') signedOut('Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.');
  if (!response.ok) { const error = new Error(result.error || 'Die Aktion konnte nicht abgeschlossen werden.'); error.status = response.status; throw error; }
  return result;
}
async function signedIn(result) {
  csrf = result.csrfToken;
  $('#account-name').textContent = result.username;
  $('#password').value = '';
  $('#login-panel').hidden = true; $('#workspace').hidden = false;
  await loadView();
}
function date(value) { return new Date(value * 1000).toLocaleString('de-DE', {dateStyle: 'medium', timeStyle: 'short'}); }
function row(item) {
  const article = element('article', undefined, 'entry');
  const body = element('div');
  let badge, title, details;
  if (view === 'sessions') {
    badge = {active: 'Aktiv', disabled: 'Gesperrt', expired: 'Abgelaufen'}[item.status];
    title = item.id;
    details = ['Erstellt: ' + date(item.created_at), 'Gültig bis: ' + date(item.expires_at)];
  } else if (view === 'emails') {
    badge = intervals[item.interval]; title = item.email_one + ' ↔ ' + item.email_two;
    details = ['Zuletzt geändert: ' + date(item.updated_at)];
  } else {
    badge = item.enabled ? 'Veröffentlicht' : 'Entwurf'; title = item.name;
    details = [(item.kind === 'questions' ? 'Fragen' : 'Werte') + ' · ' + item.items.length + ' Einträge', item.methods.length ? item.methods.map(id => labels[id]).join(' · ') : 'Noch keiner Methode zugeordnet'];
  }
  body.append(element('span', badge, 'badge' + ((view === 'lists' && !item.enabled) || item.status === 'expired' ? ' quiet' : item.status === 'disabled' ? ' warm' : '')));
  body.append(element('h2', title, view === 'sessions' ? 'session-code' : ''));
  const meta = element('div', undefined, 'entry-meta');
  details.forEach(text => meta.append(element('span', text))); body.append(meta);
  const actions = element('div', undefined, 'entry-actions');
  for (const [action, text] of [['edit', 'Bearbeiten'], ['delete', 'Löschen']]) {
    const button = element('button', text, action === 'delete' ? 'delete-action' : '');
    button.type = 'button'; button.dataset.action = action; button.dataset.id = item.id;
    button.setAttribute('aria-label', text + ': ' + title); actions.append(button);
  }
  article.append(body, actions); return article;
}
async function loadView() {
  const sequence = ++loadSequence;
  const config = views[view];
  $('#view-title').textContent = config.title; $('#view-eyebrow').textContent = config.eyebrow;
  $('#view-description').textContent = config.description; $('#create-entry').textContent = config.create;
  $('#search').placeholder = config.search;
  $('#email-notice').hidden = view !== 'emails'; $('#list-notice').hidden = view !== 'lists';
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  message('#workspace-message', ''); $('#entries').setAttribute('aria-busy', 'true');
  $('#entries').replaceChildren(element('p', 'Einträge werden geladen …', 'muted'));
  $('#previous').disabled = $('#next').disabled = true;
  try {
    const result = await api(view + '?q=' + encodeURIComponent($('#search').value.trim()) + '&offset=' + offset);
    if (sequence !== loadSequence) return;
    entries = result.items; total = result.total;
    if (!entries.length && offset > 0 && total) { offset = Math.floor((total - 1) / 50) * 50; return await loadView(); }
    $('#entries').replaceChildren(...entries.map(row));
    if (!entries.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('h2', $('#search').value.trim() ? 'Keine passenden Einträge.' : 'Hier ist noch Raum.'), element('p', $('#search').value.trim() ? 'Versuche einen anderen Suchbegriff.' : 'Erstelle den ersten Eintrag über die Schaltfläche oben.'));
      $('#entries').append(empty);
    }
    $('#result-count').textContent = total + (total === 1 ? ' Eintrag' : ' Einträge');
    $('#page-number').textContent = total ? `${offset + 1}–${Math.min(offset + 50, total)} von ${total}` : '0 Einträge';
    $('#previous').disabled = offset === 0; $('#next').disabled = offset + 50 >= total;
  } catch (error) {
    if (sequence !== loadSequence) return;
    $('#entries').replaceChildren(); $('#result-count').textContent = ''; $('#page-number').textContent = '';
    message('#workspace-message', error.message, true);
  } finally { if (sequence === loadSequence) $('#entries').setAttribute('aria-busy', 'false'); }
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  message('#login-message', '');
  try { await signedIn(await api('login', 'POST', {username: $('#username').value, password: $('#password').value})); }
  catch (error) { message('#login-message', error.message, true); }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await api('logout', 'POST', {}); signedOut(); $('#username').focus(); }
  catch (error) { message('#workspace-message', error.message, true); }
  finally { $('#logout').disabled = false; }
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view; offset = 0; $('#search').value = ''; loadView(); $('#view-title').focus();
}));
$('#search-form').addEventListener('submit', event => { event.preventDefault(); offset = 0; loadView(); });
$('#search').addEventListener('search', () => { if (!$('#search').value) { offset = 0; loadView(); } });
$('#refresh').addEventListener('click', () => loadView());
$('#previous').addEventListener('click', () => { offset = Math.max(0, offset - 50); loadView(); });
$('#next').addEventListener('click', () => { offset += 50; loadView(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

function field(label, id, type = 'text', value = '') {
  const wrapper = element('div'), labelNode = element('label', label, 'field-label'); labelNode.htmlFor = id;
  const input = element('input'); input.id = id; input.name = id; input.type = type; input.value = value; input.required = true;
  wrapper.append(labelNode, input); return wrapper;
}
function check(label, id, checked = false) {
  const wrapper = element('label', undefined, 'check-row');
  const input = element('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
  wrapper.append(input, document.createTextNode(label)); return wrapper;
}
function edit(item = null) {
  editing = item;
  message('#edit-message', '');
  const container = $('#edit-fields'); container.replaceChildren();
  $('#edit-title').textContent = view === 'lists' ? (item ? 'Liste bearbeiten' : 'Neue Liste') : view === 'emails' ? (item ? 'E-Mail-Paar bearbeiten' : 'Neues E-Mail-Paar') : 'Session bearbeiten';
  if (view === 'sessions') {
    container.append(field('Session-ID', 'edit-session-id', 'text', item.id)); $('#edit-session-id').readOnly = true;
    const local = new Date(item.expires_at * 1000); local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    container.append(field('Gültig bis (deine lokale Zeit)', 'expires-at', 'datetime-local', local.toISOString().slice(0, 16)), check('Session sperren', 'disabled', item.disabled), element('p', 'Gesperrte und abgelaufene Sessions können nicht betreten werden. Zum Reaktivieren die Sperre aufheben und ein zukünftiges Ablaufdatum wählen.', 'hint'));
  } else if (view === 'emails') {
    container.append(field('Erste E-Mail-Adresse', 'email-one', 'email', item?.email_one || ''), field('Zweite E-Mail-Adresse', 'email-two', 'email', item?.email_two || ''));
    $('#email-one').maxLength = $('#email-two').maxLength = 254;
    const wrapper = element('div'), label = element('label', 'Gemeinsamer Rhythmus', 'field-label'); label.htmlFor = 'interval';
    const select = element('select'); select.id = 'interval';
    Object.entries(intervals).forEach(([value, text]) => { const option = element('option', text); option.value = value; select.append(option); });
    select.value = item?.interval || 'weekly'; wrapper.append(label, select); container.append(wrapper);
  } else {
    container.append(field('Listenname', 'list-name', 'text', item?.name || '')); $('#list-name').maxLength = 100;
    const label = element('label', 'Art der Einträge', 'field-label'); label.htmlFor = 'kind';
    const select = element('select'); select.id = 'kind';
    [['questions', 'Fragen'], ['values', 'Werte']].forEach(([value, text]) => { const option = element('option', text); option.value = value; select.append(option); });
    select.value = item?.kind || 'questions';
    const itemsLabel = element('label', 'Einträge · eine Frage oder ein Wert pro Zeile', 'field-label'); itemsLabel.htmlFor = 'list-items';
    const textarea = element('textarea'); textarea.id = 'list-items'; textarea.rows = 8; textarea.value = item?.items.join('\n') || ''; textarea.maxLength = 100199;
    textarea.setAttribute('aria-describedby', 'items-help');
    const help = element('p', 'Bis zu 200 Einträge, jeweils maximal 500 Zeichen. Die Reihenfolge der Zeilen wird übernommen.', 'checkbox-help'); help.id = 'items-help';
    container.append(label, select, itemsLabel, textarea, help);
    const methods = element('fieldset', undefined, 'methods'); methods.append(element('legend', 'In diesen Methoden verwenden'));
    Object.entries(labels).forEach(([key, label]) => methods.append(check(label, 'method-' + key, item?.methods.includes(key))));
    container.append(methods, check('Veröffentlichen und in den ausgewählten Methoden anzeigen', 'enabled', item?.enabled));
  }
  $('#edit-dialog').showModal();
}
$('#create-entry').addEventListener('click', async event => {
  if (view !== 'sessions') { edit(); return; }
  const button = event.currentTarget; button.disabled = true;
  try {
    const result = await api('sessions', 'POST', {});
    offset = 0; $('#search').value = ''; await loadView();
    message('#workspace-message', 'Session erstellt: ' + result.id);
  } catch (error) { message('#workspace-message', error.message, true); }
  finally { button.disabled = false; }
});
$('#entries').addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const item = entries.find(item => String(item.id) === button.dataset.id); if (!item) return;
  if (button.dataset.action === 'edit') { edit(item); return; }
  deleting = item;
  const text = view === 'sessions' ? `Die Session ${item.id} wird entfernt. Ein Beitritt ist danach nicht mehr möglich.` : view === 'emails' ? `Das E-Mail-Paar ${item.email_one} und ${item.email_two} wird entfernt.` : `Die Liste „${item.name}“ wird aus allen zugeordneten Methoden entfernt.`;
  $('#delete-description').textContent = text + ' Diese Aktion kann nicht rückgängig gemacht werden.';
  message('#delete-message', ''); $('#delete-dialog').showModal();
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
  message('#edit-message', '');
  let body;
  if (view === 'sessions') body = {expiresAt: Math.floor(new Date($('#expires-at').value).getTime() / 1000), disabled: $('#disabled').checked};
  else if (view === 'emails') body = {emailOne: $('#email-one').value.trim(), emailTwo: $('#email-two').value.trim(), interval: $('#interval').value};
  else body = {name: $('#list-name').value.trim(), kind: $('#kind').value, items: $('#list-items').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean), enabled: $('#enabled').checked, methods: Object.keys(labels).filter(key => $('#method-' + key).checked)};
  try {
    await api(view + (editing ? '/' + encodeURIComponent(editing.id) : ''), editing ? 'PUT' : 'POST', body);
    $('#edit-dialog').close(); await loadView(); message('#workspace-message', 'Änderungen gespeichert.');
  } catch (error) { message('#edit-message', error.message, true); }
  finally { button.disabled = false; }
});
$('#confirm-delete').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try {
    await api(view + '/' + encodeURIComponent(deleting.id), 'DELETE');
    $('#delete-dialog').close(); deleting = null; await loadView(); message('#workspace-message', 'Eintrag gelöscht.');
  } catch (error) { message('#delete-message', error.message, true); }
  finally { button.disabled = false; }
});
(async () => {
  try { await signedIn(await api('me')); }
  catch (error) {
    if (!$('#login-panel').hidden) message('#login-message', error.status === 401 ? '' : error.message, error.status !== 401);
  }
})();
