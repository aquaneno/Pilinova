// Round logic is independent of the DOM so the selection rules can be verified.
export function uniqueValues(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.normalize('NFKC').trim().toLocaleLowerCase('de');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => item.trim());
}

export class ValueSelection {
  constructor(items, random = Math.random, {exactEight = false} = {}) {
    this.values = uniqueValues(items);
    this.exactEight = exactEight;
    if (exactEight && this.values.length < 8) throw new Error('Für diese Übung werden mindestens acht unterschiedliche Werte benötigt.');
    if (this.values.length < 2) throw new Error('Für die Übung werden mindestens zwei unterschiedliche Werte benötigt.');
    this.random = random;
    this.round = 0;
    this.startRound(this.values);
  }

  startRound(values) {
    const shuffled = [...values];
    // Fisher–Yates: every value occurs in exactly one pair, apart from one odd bye.
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.round++;
    this.bye = shuffled.length % 2 ? shuffled.pop() : null;
    this.pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) this.pairs.push(shuffled.slice(i, i + 2));
    this.index = 0;
    this.winners = [];
    this.rejected = [];
    this.restored = new Set();
    this.phase = 'choose';
  }

  get pair() { return this.pairs[this.index] ?? null; }
  get selected() { return [...this.winners, ...(this.bye === null ? [] : [this.bye]), ...this.restored]; }
  get isFinalRound() { return this.exactEight && this.pairs.length + (this.bye === null ? 0 : 1) <= 8; }
  get restoreLimit() { return this.isFinalRound ? 8 - this.pairs.length - (this.bye === null ? 0 : 1) : 2; }
  get canContinue() { return this.phase === 'review' && (!this.isFinalRound || this.selected.length === 8); }

  choose(value) {
    if (this.phase !== 'choose' || !this.pair?.includes(value)) return false;
    const loser = this.pair.find(item => item !== value);
    this.winners.push(value);
    this.rejected.push(loser);
    this.index++;
    if (!this.pair) this.phase = 'review';
    return true;
  }

  toggleRestored(value) {
    if (this.phase !== 'review' || !this.rejected.includes(value)) return false;
    if (this.restored.has(value)) this.restored.delete(value);
    else {
      if (this.restored.size >= this.restoreLimit) return false;
      this.restored.add(value);
    }
    return true;
  }

  continue() {
    if (!this.canContinue) return false;
    const selected = this.selected;
    if (this.exactEight && selected.length === 8) {
      this.pyramid = new ValuePyramid(selected);
      this.phase = 'sort';
    } else if (selected.length <= 8) this.phase = 'complete';
    else this.startRound(selected);
    return true;
  }

  finish() {
    if (this.phase !== 'sort' || !this.pyramid.ready) return false;
    this.phase = 'complete';
    return true;
  }
}

export class ValuePyramid {
  constructor(items) {
    this.values = uniqueValues(items);
    if (this.values.length !== 8) throw new Error('Die Pyramide benötigt genau acht unterschiedliche Werte.');
    this.lead = null;
    this.efficacy = new Set();
  }

  chooseLead(value) {
    if (!this.values.includes(value)) return false;
    this.lead = value;
    this.efficacy.delete(value);
    return true;
  }

  toggleEfficacy(value) {
    if (this.lead === null || value === this.lead || !this.values.includes(value)) return false;
    if (this.efficacy.has(value)) this.efficacy.delete(value);
    else {
      if (this.efficacy.size === 3) return false;
      this.efficacy.add(value);
    }
    return true;
  }

  get foundation() { return this.values.filter(value => value !== this.lead && !this.efficacy.has(value)); }
  get ready() { return this.lead !== null && this.efficacy.size === 3 && this.foundation.length === 4; }
}
