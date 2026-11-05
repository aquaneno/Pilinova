import {ValueSelection, uniqueValues} from './value-selection.mjs';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, onClick, className = 'button button-green') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function valueList(values) {
  const list = element('ul', '', 'value-chips');
  for (const value of values) list.append(element('li', value));
  return list;
}

export function mountValueExercise(container, lists) {
  const valueLists = lists.filter(list => list.kind === 'values' && uniqueValues(list.items).length >= 2);
  const heading = element('h3', 'Was ist dir wichtiger?');
  container.append(heading);
  if (!valueLists.length) {
    container.append(element('p', 'Für diese Übung ist noch keine Werteliste mit mindestens zwei unterschiedlichen Werten veröffentlicht. Bitte versuche es später erneut.', 'hint'));
    return;
  }
  const explanation = element('p', 'Entscheide dich bei jedem zufälligen Wertepaar für einen Wert. Nach jeder Runde siehst du deine Auswahl und kannst bis zu zwei abgewählte Werte zurückholen. Wir wiederholen die Auswahl, bis höchstens acht Werte übrig sind.');
  container.append(explanation);
  let list = valueLists[0];
  if (valueLists.length > 1) {
    const label = element('label', 'Werteliste wählen', 'field-label');
    const select = element('select', '', 'value-list-select');
    for (const entry of valueLists) {
      const option = element('option', `${entry.name} · ${uniqueValues(entry.items).length} Werte`);
      option.value = String(entry.id);
      select.append(option);
    }
    select.addEventListener('change', () => { list = valueLists.find(entry => String(entry.id) === select.value); });
    label.append(select);
    container.append(label);
  } else container.append(element('p', `${list.name} · ${uniqueValues(list.items).length} Werte`, 'hint'));
  container.append(button('Werte-Auswahl starten', () => {
    const exercise = new ValueSelection(list.items);
    render(exercise, list.name, container);
  }));
}

function render(exercise, name, container) {
  const section = element('section', '', 'value-exercise');
  section.append(element('p', name, 'value-list-name'));
  const heading = element('h3');
  heading.tabIndex = -1;
  section.append(heading);
  if (exercise.phase === 'choose') {
    heading.textContent = `Runde ${exercise.round} · Was ist dir wichtiger?`;
    const count = element('p', `Paar ${exercise.index + 1} von ${exercise.pairs.length}`, 'value-progress-label');
    const progress = element('progress');
    progress.max = exercise.pairs.length;
    progress.value = exercise.index;
    progress.setAttribute('aria-label', 'Entscheidungen dieser Runde');
    section.append(count, progress, element('p', 'Wähle einen der beiden Werte, um weiterzugehen.'));
    const pair = element('div', '', 'value-pair');
    exercise.pair.forEach(value => pair.append(button(value, () => {
      // Old controls must not accept another decision after the step changes.
      pair.querySelectorAll('button').forEach(node => { node.disabled = true; });
      if (exercise.choose(value)) render(exercise, name, container);
    }, 'value-choice')));
    section.append(pair);
    if (exercise.bye !== null) section.append(element('p', `Ungerade Anzahl: „${exercise.bye}“ erhält diese Runde ein Freilos und wird automatisch übernommen. Jeder andere Wert erscheint genau einmal.`, 'hint'));
  } else if (exercise.phase === 'review') {
    heading.textContent = `Runde ${exercise.round} · Deine Auswahl`;
    section.append(element('p', 'Diese Werte nimmst du mit:'), valueList([...exercise.winners, ...(exercise.bye === null ? [] : [exercise.bye])]));
    if (exercise.bye !== null) section.append(element('p', `„${exercise.bye}“ ist durch das Freilos dabei.`, 'hint'));
    section.append(element('h4', 'Möchtest du Werte zurückholen?'), element('p', 'Du kannst bis zu zwei der in dieser Runde abgewählten Werte ergänzen. Tippe einen gewählten Wert erneut an, um ihn zurückzulegen.'));
    const counter = element('p', '', 'inline-message');
    counter.setAttribute('role', 'status');
    const selected = valueList([]);
    selected.setAttribute('aria-label', 'Zusätzlich gewählte Werte');
    const options = element('div', '', 'value-restore-options');
    const buttons = exercise.rejected.map(value => {
      const node = button(value, () => {
        if (exercise.toggleRestored(value)) update();
      }, 'value-restore');
      options.append(node);
      return node;
    });
    const next = button('', () => { if (exercise.continue()) render(exercise, name, container); });
    function update() {
      counter.textContent = `${exercise.restored.size} von 2 ergänzt · ${exercise.selected.length} Werte insgesamt`;
      selected.replaceChildren(...valueList([...exercise.restored]).children);
      buttons.forEach((node, i) => {
        const active = exercise.restored.has(exercise.rejected[i]);
        node.setAttribute('aria-pressed', String(active));
        node.disabled = !active && exercise.restored.size >= 2;
      });
      next.textContent = exercise.selected.length <= 8 ? 'Meine Werte ansehen' : `Weiter mit ${exercise.selected.length} Werten`;
    }
    update();
    section.append(counter, options, selected, next);
  } else {
    heading.textContent = 'Deine wichtigsten Werte';
    section.append(element('p', `${exercise.selected.length} Werte, die dir besonders wichtig sind. Nimm dir einen Moment und schau, was sie für dich bedeuten.`), valueList(exercise.selected));
    section.append(button('Neue Werte-Auswahl', () => {
      render(new ValueSelection(exercise.values), name, container);
    }, 'text-button'));
  }
  container.replaceChildren(section);
  // Bring the new step into view, including after a long round summary on mobile.
  heading.focus();
}
