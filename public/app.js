import {mountValueExercise} from './value-exercise.mjs';

const $ = (selector) => document.querySelector(selector);
const sessionExercises = new Map();
const message = (element, text, error = false) => {
  element.textContent = text;
  element.classList.toggle('error', error);
};
document.querySelectorAll('[data-open]').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = $(`#${button.dataset.open}`);
    dialog.showModal();
    dialog.querySelectorAll('[data-method]').forEach(loadMethodContent);
  });
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.close, [data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
});
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  } catch {
    throw new Error('Die Verbindung ist gerade nicht erreichbar. Bitte versuche es erneut.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('Der Server ist gerade nicht erreichbar. Bitte versuche es erneut.'); }
  if (!response.ok) throw new Error(result.error || 'Das hat leider nicht geklappt. Bitte versuche es erneut.');
  return result;
}
function showSession(id, joined = false) {
  $('#created-session').value = id;
  $('#session-title').textContent = joined ? 'Ihr seid verbunden.' : 'Ein Raum für euch zwei.';
  $('#session-description').textContent = joined ? 'Ihr könnt jetzt jeweils eure wichtigsten Werte entdecken. Wähle bei jedem Wertepaar, was dir wichtiger ist.' : 'Teile diese Session-ID mit dem Menschen, mit dem du deine Werte entdecken möchtest. Sie ist 30 Tage gültig. Du kannst deine Werte-Auswahl direkt starten.';
  message($('#copy-message'), '');
  $('#session-dialog').showModal();
  const container = $('#session-dialog [data-method="together"]');
  if (!sessionExercises.has(id)) {
    const exercise = document.createElement('div');
    exercise.dataset.method = 'together';
    sessionExercises.set(id, exercise);
    loadMethodContent(exercise);
  }
  container.replaceChildren(sessionExercises.get(id));
}

async function loadMethodContent(container) {
  // Preserve a running or finished personal exercise when its dialog is reopened.
  if (container.dataset.method === 'self' && container.querySelector('.value-exercise')) return;
  container.replaceChildren();
  const status = document.createElement('p'); status.className = 'hint'; status.textContent = 'Impulse werden geladen …'; container.append(status);
  try {
    const response = await fetch('/api/methods/' + container.dataset.method + '/content');
    if (!response.ok) throw new Error();
    const result = await response.json();
    container.replaceChildren();
    if (container.dataset.method === 'self' || container.dataset.method === 'together') {
      mountValueExercise(container, result.lists, {exactEight: container.dataset.method === 'self'});
      return;
    }
    if (!result.lists.length) { status.textContent = 'Hier werden bald Fragen und Werte für diese Methode bereitstehen.'; container.append(status); return; }
    for (const list of result.lists) {
      const details = document.createElement('details'); details.className = 'method-list';
      const summary = document.createElement('summary'); summary.textContent = list.name + ' · ' + (list.kind === 'questions' ? 'Fragen' : 'Werte'); details.append(summary);
      const items = document.createElement('ol');
      for (const item of list.items) { const li = document.createElement('li'); li.textContent = item; items.append(li); }
      details.append(items); container.append(details);
    }
  } catch {
    status.textContent = 'Die Impulse konnten nicht geladen werden.';
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Erneut laden'; retry.addEventListener('click', () => loadMethodContent(container)); container.replaceChildren(status, retry);
  }
}
$('#create-session').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  message($('#join-message'), '');
  try { showSession((await api('/api/sessions', {})).sessionId); }
  catch (error) { message($('#join-message'), error.message, true); }
  finally { button.disabled = false; }
});
$('#join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#session-id');
  if (!input.value.trim()) {
    input.setAttribute('aria-invalid', 'true');
    message($('#join-message'), 'Bitte gib eine Session-ID ein.', true);
    input.focus(); return;
  }
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  input.removeAttribute('aria-invalid');
  message($('#join-message'), '');
  try { showSession((await api('/api/sessions/join', {sessionId: input.value.trim()})).sessionId, true); }
  catch (error) { message($('#join-message'), error.message, true); }
  finally { button.disabled = false; }
});
$('#copy-session').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#created-session').value);
    message($('#copy-message'), 'Session-ID kopiert. Du kannst sie jetzt teilen.');
  } catch {
    $('#created-session').focus(); $('#created-session').select();
    message($('#copy-message'), 'Bitte kopiere die markierte Session-ID.');
  }
});
$('#email-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const inputs = [$('#email-one'), $('#email-two')];
  inputs.forEach(input => input.removeAttribute('aria-invalid'));
  const invalid = inputs.find(input => !input.checkValidity());
  if (invalid) {
    invalid.setAttribute('aria-invalid', 'true');
    message($('#email-message'), 'Bitte gib zwei gültige E-Mail-Adressen ein.', true);
    invalid.focus(); return;
  }
  if (inputs[0].value.trim().toLowerCase() === inputs[1].value.trim().toLowerCase()) {
    message($('#email-message'), 'Bitte verwende zwei unterschiedliche E-Mail-Adressen.', true); inputs[1].focus(); return;
  }
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  message($('#email-message'), '');
  try {
    await api('/api/email-preferences', {emailOne: inputs[0].value.trim(), emailTwo: inputs[1].value.trim(), interval: form.elements.interval.value});
    message($('#email-message'), 'Euer Rhythmus ist gespeichert. Der E-Mail-Versand folgt, aktuell werden keine E-Mails verschickt.');
    form.reset();
  } catch (error) { message($('#email-message'), error.message, true); }
  finally { button.disabled = false; }
});
