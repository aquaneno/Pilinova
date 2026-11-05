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

export function mountValueExercise(container, lists, {exactEight = false} = {}) {
  const minimum = exactEight ? 8 : 2;
  const valueLists = lists.filter(list => list.kind === 'values' && uniqueValues(list.items).length >= minimum);
  const heading = element('h3', 'Was ist dir wichtiger?');
  container.append(heading);
  if (!valueLists.length) {
    container.append(element('p', `Für diese Übung ist noch keine Werteliste mit mindestens ${exactEight ? 'acht' : 'zwei'} unterschiedlichen Werten veröffentlicht. Bitte versuche es später erneut.`, 'hint'));
    return;
  }
  const explanation = element('p', exactEight
    ? 'Entscheide dich bei jedem zufälligen Wertepaar für einen Wert. Zwischen den Runden kannst du bis zu zwei Werte zurückholen. Nach dem letzten Vergleich ergänzt du genau die fehlenden Werte bis acht. Anschließend ordnest du sie in deiner Pyramide des Selbstbewusstseins an: ein Leitwert, drei Werte der Selbstwirksamkeit und vier Werte als Fundament der Selbstsicherheit.'
    : 'Entscheide dich bei jedem zufälligen Wertepaar für einen Wert. Nach jeder Runde siehst du deine Auswahl und kannst bis zu zwei abgewählte Werte zurückholen. Wir wiederholen die Auswahl, bis höchstens acht Werte übrig sind.');
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
    const exercise = new ValueSelection(list.items, Math.random, {exactEight});
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
    const limit = exercise.restoreLimit;
    const final = exercise.isFinalRound;
    section.append(element('h4', final ? 'Deine acht Werte vervollständigen' : 'Möchtest du Werte zurückholen?'), element('p', final
      ? (limit ? `Hole genau ${limit} der in dieser Runde abgewählten Werte zurück, damit du mit exakt acht Werten weitergehst. Tippe einen zurückgeholten Wert erneut an, um deine Auswahl zu ändern.` : 'Deine acht Werte stehen fest. Im nächsten Schritt ordnest du sie in deiner Pyramide an.')
      : 'Du kannst bis zu zwei der in dieser Runde abgewählten Werte ergänzen. Tippe einen gewählten Wert erneut an, um ihn zurückzulegen.'));
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
      counter.textContent = `${exercise.restored.size} von ${limit} ergänzt · ${exercise.selected.length} Werte insgesamt`;
      selected.replaceChildren(...valueList([...exercise.restored]).children);
      buttons.forEach((node, i) => {
        const active = exercise.restored.has(exercise.rejected[i]);
        node.setAttribute('aria-pressed', String(active));
        node.disabled = !active && exercise.restored.size >= limit;
      });
      next.disabled = !exercise.canContinue;
      next.textContent = final ? 'Meine acht Werte sortieren' : exercise.selected.length <= 8 ? 'Meine Werte ansehen' : `Weiter mit ${exercise.selected.length} Werten`;
    }
    update();
    section.append(counter);
    if (limit) section.append(options, selected);
    section.append(next);
  } else if (exercise.phase === 'sort') {
    heading.textContent = 'Deine Pyramide des Selbstbewusstseins';
    section.append(element('p', 'Wähle zuerst deinen Leitwert für die Spitze und danach drei Werte als Kraft deiner Selbstwirksamkeit. Die übrigen vier Werte bilden dein Fundament der Selbstsicherheit.'));
    const finish = button('Meine Pyramide ansehen', () => { if (exercise.finish()) render(exercise, name, container); });
    section.append(pyramidView(exercise.pyramid, () => { finish.disabled = !exercise.pyramid.ready; }), finish);
    finish.disabled = !exercise.pyramid.ready;
  } else {
    heading.textContent = exercise.pyramid ? 'Deine Pyramide des Selbstbewusstseins' : 'Deine wichtigsten Werte';
    if (exercise.pyramid) {
      section.append(element('p', 'Deine acht Werte: ein Leitwert gibt dir Richtung, drei Werte stärken deine Selbstwirksamkeit und vier Werte geben dir Sicherheit.'), pyramidView(exercise.pyramid));
      section.append(button('Zuordnung bearbeiten', () => { exercise.phase = 'sort'; render(exercise, name, container); }, 'text-button'));
    } else section.append(element('p', `${exercise.selected.length} Werte, die dir besonders wichtig sind. Nimm dir einen Moment und schau, was sie für dich bedeuten.`), valueList(exercise.selected));
    section.append(button('Neue Werte-Auswahl', () => {
      render(new ValueSelection(exercise.values, Math.random, {exactEight: exercise.exactEight}), name, container);
    }, 'text-button'));
  }
  container.replaceChildren(section);
  // Bring the new step into view, including after a long round summary on mobile.
  heading.focus();
}

function pyramidView(pyramid, onChange) {
  const wrapper = element('div');
  const preview = element('div', '', 'value-pyramid');
  const tiers = [
    ['Selbstvertrauen', 'Ein Leitwert an deiner Spitze'],
    ['Selbstwirksamkeit', 'Die Kraft deiner drei Werte'],
    ['Selbstsicherheit', 'Das Fundament deiner vier Werte']
  ].map(([title, description], i) => {
    const tier = element('section', '', `pyramid-tier pyramid-tier-${i}`);
    tier.append(element('h4', title), element('p', description, 'pyramid-description'));
    const content = element('div');
    tier.append(content);
    preview.append(tier);
    return content;
  });
  wrapper.append(preview);

  let select, counter;
  const choices = [];
  if (onChange) {
    const label = element('label', 'Dein Leitwert', 'sr-only');
    select = element('select', '', 'value-list-select');
    select.setAttribute('aria-label', 'Dein Leitwert');
    const empty = element('option', 'Leitwert wählen …');
    empty.value = '';
    select.append(empty);
    pyramid.values.forEach(value => {
      const option = element('option', value);
      option.value = value;
      select.append(option);
    });
    select.value = pyramid.lead ?? '';
    select.addEventListener('change', () => {
      if (select.value) pyramid.chooseLead(select.value);
      else { pyramid.lead = null; pyramid.efficacy.clear(); }
      update();
    });
    label.append(select);
    label.className = 'pyramid-lead-label';
    tiers[0].append(label);
    counter = element('p', '', 'inline-message');
    counter.setAttribute('role', 'status');
    const pool = element('div', '', 'value-restore-options');
    pool.setAttribute('role', 'group');
    pool.setAttribute('aria-label', 'Drei Werte für deine Selbstwirksamkeit wählen');
    pyramid.values.forEach(value => {
      const node = button(value, () => { if (pyramid.toggleEfficacy(value)) update(); }, 'value-restore');
      choices.push(node);
      pool.append(node);
    });
    wrapper.append(element('h4', 'Deine Kraft der Selbstwirksamkeit wählen'), counter, pool, element('p', 'Drei Werte auswählen. Erneutes Antippen hebt die Auswahl auf. Über „Leitwert wählen“ kannst du auch die Spitze ändern.', 'hint'));
  }

  function update() {
    if (!onChange) tiers[0].replaceChildren(valueList([pyramid.lead]));
    tiers[1].replaceChildren(valueList([...pyramid.efficacy]));
    if (!pyramid.efficacy.size) tiers[1].append(element('p', 'Wähle drei Werte.', 'hint'));
    tiers[2].replaceChildren(pyramid.ready ? valueList(pyramid.foundation) : element('p', 'Deine vier Fundamentwerte erscheinen hier, sobald die Spitze und die Mitte stehen.', 'hint'));
    if (onChange) {
      counter.textContent = pyramid.lead === null ? 'Wähle zuerst deinen Leitwert an der Spitze.' : `${pyramid.efficacy.size} von 3 Werten gewählt · ${pyramid.ready ? 'Deine Pyramide ist vollständig.' : 'Wähle deine Werte für die Mitte.'}`;
      choices.forEach((node, i) => {
        const value = pyramid.values[i];
        const active = pyramid.efficacy.has(value);
        node.hidden = value === pyramid.lead;
        node.setAttribute('aria-pressed', String(active));
        node.disabled = pyramid.lead === null || (!active && pyramid.efficacy.size >= 3);
      });
      onChange();
    }
  }
  update();
  return wrapper;
}
