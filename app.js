'use strict';

// ===== Stałe =====
const STORE_KEY = 'kalorie.v1';
const MEALS = [
  { id: 'sniadanie', name: 'Śniadanie' },
  { id: 'drugie', name: 'II śniadanie' },
  { id: 'obiad', name: 'Obiad' },
  { id: 'podwieczorek', name: 'Podwieczorek' },
  { id: 'kolacja', name: 'Kolacja' },
  { id: 'przekaski', name: 'Przekąski' },
];
// Mnożniki aktywności (PAL). 1,4 = typowa praca siedząca z codziennym chodzeniem (wg WHO/FAO siedzący tryb to 1,4–1,69).
const ACTIVITY = [
  [1.2, 'Bardzo mało ruchu (leżący, chory)'],
  [1.4, 'Siedzący (praca biurowa, mało ruchu)'],
  [1.55, 'Lekka aktywność (1–3 treningi/tydz. lub dużo chodzenia)'],
  [1.7, 'Umiarkowana (3–5 treningów/tydz.)'],
  [1.85, 'Wysoka (6–7 treningów/tydz. lub praca fizyczna)'],
  [2.0, 'Bardzo wysoka (sportowiec, ciężka praca + treningi)'],
];
// Stara skala (do wersji 10) → nowa
const OLD_ACTIVITY = { 1.2: 1.4, 1.375: 1.55, 1.55: 1.7, 1.725: 1.85, 1.9: 2.0 };
// Cel i tempo: zmiana kalorii jako procent całkowitego zapotrzebowania
const GOALS = {
  lose10: { name: 'Schudnąć – łagodnie (−10%)', pct: -0.10, lose: true },
  lose20: { name: 'Schudnąć – umiarkowanie (−20%, polecane)', pct: -0.20, lose: true },
  lose25: { name: 'Schudnąć – szybciej (−25%)', pct: -0.25, lose: true },
  keep: { name: 'Utrzymać wagę', pct: 0 },
  gain5: { name: 'Przytyć – powoli (+5%)', pct: 0.05 },
  gain10: { name: 'Przytyć – szybciej (+10%)', pct: 0.10 },
};
const GOAL_ALIASES = { lose: 'lose20', gain: 'gain10' }; // zgodność ze starszą wersją
const goalKey = (g) => (GOALS[g] ? g : GOAL_ALIASES[g] || 'keep');
const BUILTIN = PRODUCTS_DB.map((r) => ({ id: 'b:' + r[0], name: r[0], kcal: r[1], p: r[2], f: r[3], c: r[4], builtin: true }));

// ===== Stan i zapis =====
function defaultState() {
  return {
    version: 1,
    profile: null,
    goals: { kcal: 2000, p: 100, f: 65, c: 250 },
    goalsManual: false,
    products: [],   // własne produkty
    recipes: [],    // przepisy: { id, name, items: [...], cookedWeight, portions }
    diary: {},      // { 'RRRR-MM-DD': [wpisy] }
    weights: {},    // { 'RRRR-MM-DD': kg }
    recent: [],     // id ostatnio używanych produktów
    lastGrams: {},  // ostatnio wpisana waga dla produktu
    water: {},      // { 'RRRR-MM-DD': ml }
    waterGoal: 2000,
    createdAt: Date.now(),
    lastBackup: null,   // kiedy ostatnio zrobiono kopię zapasową
    backupSnooze: null, // kiedy kliknięto "Później" przy przypomnieniu
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* uszkodzone dane – zaczynamy od nowa */ }
  return defaultState();
}
const DAY_MS = 864e5;
function backupDue() {
  if (Object.keys(state.diary).length < 3) return false;
  const now = Date.now();
  if (state.backupSnooze && now - state.backupSnooze < 3 * DAY_MS) return false;
  return now - (state.lastBackup || state.createdAt || now) >= 14 * DAY_MS;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Nie udało się zapisać danych'); }
}
let state = load();

// ===== Pomocnicze =====
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt1 = (n) => r1(n).toLocaleString('pl-PL');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (s) => String(s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
const mealName = (id) => (MEALS.find((m) => m.id === id) || MEALS[0]).name;

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function keyToDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(key, n) { const d = keyToDate(key); d.setDate(d.getDate() + n); return dateKey(d); }
function todayKey() { return dateKey(new Date()); }
function dayLabel(key) {
  const t = todayKey();
  if (key === t) return 'Dziś';
  if (key === addDays(t, -1)) return 'Wczoraj';
  if (key === addDays(t, 1)) return 'Jutro';
  return keyToDate(key).toLocaleDateString('pl-PL', { weekday: 'long' });
}
const shortDate = (key) => keyToDate(key).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });

function calc(per100, grams) {
  const k = grams / 100;
  return { kcal: per100.kcal * k, p: per100.p * k, f: per100.f * k, c: per100.c * k };
}
function dayEntries(key) { return state.diary[key] || []; }
function sumEntries(entries) {
  return entries.reduce((s, e) => {
    const v = calc(e, e.grams);
    s.kcal += v.kcal; s.p += v.p; s.f += v.f; s.c += v.c;
    return s;
  }, { kcal: 0, p: 0, f: 0, c: 0 });
}

// ===== Produkty i przepisy =====
function recipeStats(r) {
  const tot = sumEntries(r.items);
  const rawWeight = r.items.reduce((s, it) => s + it.grams, 0);
  const weight = r.cookedWeight > 0 ? r.cookedWeight : rawWeight;
  const portions = r.portions >= 1 ? r.portions : 1;
  const k = weight > 0 ? 100 / weight : 0;
  return {
    tot, rawWeight, weight, portions,
    per100: { kcal: tot.kcal * k, p: tot.p * k, f: tot.f * k, c: tot.c * k },
    portionGrams: weight / portions,
  };
}
function recipeToProduct(r) {
  const s = recipeStats(r);
  return {
    id: 'r:' + r.id, recipeId: r.id, name: r.name, recipe: true,
    kcal: r1(s.per100.kcal), p: r1(s.per100.p), f: r1(s.per100.f), c: r1(s.per100.c),
    portionGrams: s.portionGrams, portions: s.portions,
    health: recipeHealth(r) || undefined,
  };
}
// Produkt bez przepisów (składnikiem przepisu nie może być inny przepis – brak zapętlenia)
function findBaseProduct(id) {
  return state.products.find((p) => p.id === id) || BUILTIN.find((p) => p.id === id);
}
// Ocena przepisu ze składników: NOVA = najwyższe przetworzenie składnika; cukry/sól/… tylko gdy znane dla wszystkich
function recipeHealth(r) {
  if (!r.items.length) return null;
  const s = recipeStats(r);
  if (!(s.weight > 0)) return null;
  const hs = r.items.map((it) => productHealth(findBaseProduct(it.productId)));
  const novas = hs.map((h) => (h && [1, 2, 3, 4].includes(h.nova) ? h.nova : null));
  const h = { recipe: true };
  // Stopień przetworzenia dania: liczą się składniki dające ≥10% kalorii (szczypta ketchupu czy łyżka oleju
  // nie decyduje). Olej, masło, cukier (NOVA 2) użyte do gotowania = domowe danie z nieprzetworzonych składników.
  const kc = r.items.map((it) => (it.kcal * it.grams) / 100);
  const totalKcal = kc.reduce((a, b) => a + b, 0) || 1;
  const up = kc.reduce((sum, k, i) => sum + (novas[i] === 4 ? k : 0), 0) / totalKcal;
  const major = novas.filter((n, i) => kc[i] / totalKcal >= 0.1);
  if (up >= 0.2) h.nova = 4;
  else if (major.length && major.every((n) => n != null)) h.nova = Math.max(...major.map((n) => (n === 2 ? 1 : n)));
  h.fatTotal = r1(s.per100.f);
  for (const key of ['satfat', 'sugars', 'salt', 'fiber']) {
    if (hs.every((x) => x && x[key] != null)) {
      const total = r.items.reduce((sum, it, i) => sum + (hs[i][key] * it.grams) / 100, 0);
      h[key] = Math.round((total / s.weight) * 100 * 100) / 100;
    }
  }
  return h.nova || h.satfat != null || h.sugars != null || h.salt != null ? h : null;
}
function allProducts(withRecipes = true) {
  return state.products.concat(withRecipes ? state.recipes.map(recipeToProduct) : [], BUILTIN);
}
function findProduct(id) {
  const p = allProducts().find((x) => x.id === id);
  if (p || !String(id).startsWith('i:')) return p;
  const idea = findIdea(String(id).slice(2)); // przepis z Inspiracji
  return idea ? idea.product : undefined;
}
// Porcje produktu: [{ label: 'kromka', g: 30 }, ...]
function productPortions(p) {
  if (!p) return [];
  if (p.recipe) return p.portionGrams > 0 ? [{ label: 'porcja', g: r0(p.portionGrams) }] : [];
  if (Array.isArray(p.portions) && p.portions.length) return p.portions;
  if (p.builtin && typeof BUILTIN_PORTIONS !== 'undefined' && BUILTIN_PORTIONS[p.name]) {
    return BUILTIN_PORTIONS[p.name].map(([label, g]) => ({ label, g }));
  }
  return [];
}
function sortByName(list) { return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'pl')); }
function searchProducts(q, list) {
  const nq = norm(q.trim());
  if (!nq) return sortByName(list);
  const words = nq.split(/\s+/);
  return list
    .filter((p) => { const n = norm(p.name); return words.every((w) => n.includes(w)); })
    .sort((a, b) => (norm(a.name).startsWith(nq) ? 0 : 1) - (norm(b.name).startsWith(nq) ? 0 : 1) || a.name.localeCompare(b.name, 'pl'));
}

// Krótki komunikat na dole ekranu; opcjonalnie z przyciskiem, np. { label: 'Cofnij', fn }
let toastTimer;
let toastAction = null;
function toast(msg, action) {
  const t = $('#toast');
  toastAction = action || null;
  t.innerHTML = esc(msg) + (action ? ` <button class="toast-btn" data-action="toast-action">${esc(action.label)}</button>` : '');
  t.classList.toggle('has-action', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); toastAction = null; }, action ? 6000 : 2200);
}

// ===== Przeniesienie danych ze starszych wersji =====
let migrationNote = null;
(function migrate() {
  const p = state.profile;
  if (p && !p.actScale) {
    p.activity = OLD_ACTIVITY[p.activity] || 1.4;
    p.actScale = 2;
    if (!state.goalsManual && !state.goalsFromData) {
      const before = state.goals.kcal;
      state.goals = computeGoals(p).goals;
      if (state.goals.kcal !== before) migrationNote = `Nowa skala aktywności – cel zaktualizowany: ${before} → ${state.goals.kcal} kcal`;
    }
    save();
  }
})();

// ===== Inspiracje (wbudowane przepisy z recipes-db.js) =====
// Produkty mięsne i rybne – przepis bez nich oznaczamy jako wegetariański
const MEAT_FISH = new Set([
  'Pierś z kurczaka (surowa)', 'Pierś z kurczaka (pieczona)', 'Udko z kurczaka bez skóry (surowe)', 'Udko z kurczaka ze skórą (surowe)',
  'Filet z indyka (surowy)', 'Wątróbka drobiowa', 'Wołowina mielona (surowa)', 'Wołowina – rostbef (surowy)', 'Schab wieprzowy (surowy)',
  'Karkówka (surowa)', 'Wieprzowina mielona (surowa)', 'Boczek wędzony', 'Kotlet schabowy panierowany (smażony)', 'Szynka gotowana',
  'Polędwica sopocka', 'Kiełbasa śląska', 'Parówki', 'Salami', 'Kabanosy', 'Łosoś (surowy)', 'Łosoś wędzony', 'Dorsz (surowy)',
  'Mintaj (surowy)', 'Pstrąg (surowy)', 'Makrela wędzona', 'Tuńczyk w sosie własnym', 'Tuńczyk w oleju (odsączony)', 'Sardynki w oleju',
  'Krewetki (surowe)', 'Rosół z makaronem',
]);
const IDEA_MEALS = [
  { id: 'sniadanie', name: 'Śniadanie', diary: 'sniadanie' },
  { id: 'obiad', name: 'Obiad', diary: 'obiad' },
  { id: 'kolacja', name: 'Kolacja', diary: 'kolacja' },
  { id: 'przekaska', name: 'Przekąska', diary: 'przekaski' },
];
function buildInspirations() {
  if (typeof RECIPES_DB === 'undefined') return [];
  return RECIPES_DB.map((r) => {
    const items = r.items.map(([name, grams]) => {
      const p = BUILTIN.find((b) => b.name === name);
      if (!p) { console.warn('Przepis', r.id, '– brak produktu:', name); return null; }
      return { id: r.id + ':' + name, productId: p.id, name, grams, kcal: p.kcal, p: p.p, f: p.f, c: p.c };
    }).filter(Boolean);
    const rec = { id: r.id, name: r.name, items, cookedWeight: null, portions: r.servings };
    const s = recipeStats(rec);
    const per = { kcal: s.tot.kcal / r.servings, p: s.tot.p / r.servings, f: s.tot.f / r.servings, c: s.tot.c / r.servings };
    const health = recipeHealth(rec) || undefined;
    return {
      ...r, meals: Array.isArray(r.meal) ? r.meal : [r.meal], rec, per, health,
      wege: !items.some((it) => MEAT_FISH.has(it.name)),
      highProtein: per.p >= 25, light: per.kcal <= 400, quick: r.time <= 15,
      product: {
        id: 'i:' + r.id, name: r.name, recipe: true, inspiration: true,
        kcal: r1(s.per100.kcal), p: r1(s.per100.p), f: r1(s.per100.f), c: r1(s.per100.c),
        portionGrams: s.portionGrams, portions: r.servings, health,
      },
    };
  });
}
const INSPIRATIONS = buildInspirations();
const findIdea = (id) => INSPIRATIONS.find((x) => x.id === id);

// ===== Widoki =====
let view = 'today';
let currentDay = todayKey();
let lastToday = currentDay;
let productsFilter = 'all';
let productsQuery = '';
let historyRange = 7;

function setView(v) {
  view = v;
  window.scrollTo(0, 0);
  render();
}
function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'today') renderToday();
  else if (view === 'history') renderHistory();
  else if (view === 'ideas') renderIdeas();
  else if (view === 'products') renderProducts();
  else renderProfile();
}

function macroBar(label, val, goal, cls) {
  const pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
  const over = goal > 0 && val > goal * 1.05;
  return `<div class="macro ${cls}${over ? ' over' : ''}">
    <div class="macro-head"><span>${label}</span><span>${r0(val)} / ${r0(goal)} g</span></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
  </div>`;
}

// ----- Dziś -----
function renderToday() {
  const entries = dayEntries(currentDay);
  const tot = sumEntries(entries);
  const g = state.goals;
  const left = g.kcal - tot.kcal;
  const over = left < 0;
  const pct = g.kcal > 0 ? Math.min(tot.kcal / g.kcal, 1) : 0;
  const R = 52, C = 2 * Math.PI * R;
  const fullDate = keyToDate(currentDay).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

  let html = `
  <div class="daynav">
    <button class="icon-btn" data-action="day-prev" aria-label="Poprzedni dzień">‹</button>
    <button class="daytitle" data-action="open-cal" aria-label="Otwórz kalendarz"><span>${dayLabel(currentDay)}</span><small>${fullDate} ▾</small></button>
    <button class="icon-btn" data-action="day-next" aria-label="Następny dzień">›</button>
  </div>
  <section class="card summary">
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120" class="ring${over ? ' over' : ''}">
        <circle cx="60" cy="60" r="${R}" class="ring-bg"/>
        <circle cx="60" cy="60" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
      </svg>
      <div class="ring-text${over ? ' over' : ''}"><strong>${r0(Math.abs(left))}</strong><span>${over ? 'kcal ponad cel' : 'kcal zostało'}</span></div>
    </div>
    <div class="summary-side">
      <div class="stat"><span>Zjedzone</span><strong>${r0(tot.kcal)} kcal</strong></div>
      <div class="stat"><span>Cel</span><strong>${r0(g.kcal)} kcal</strong></div>
    </div>
    <div class="macros">
      ${macroBar('Białko', tot.p, g.p, 'p')}
      ${macroBar('Tłuszcze', tot.f, g.f, 'f')}
      ${macroBar('Węglowodany', tot.c, g.c, 'c')}
    </div>
    ${streakLine()}
  </section>
  ${waterCard()}
  ${qualityCard(entries)}`;

  if (backupDue()) {
    const days = state.lastBackup ? Math.floor((Date.now() - state.lastBackup) / DAY_MS) : null;
    html += `<section class="card backup-cta">
      <p><b>Zrób kopię zapasową.</b> ${days != null ? `Ostatnia była ${days} dni temu.` : 'Nie masz jeszcze żadnej kopii.'}
      Dane są tylko na tym telefonie – usunięcie aplikacji je skasuje.</p>
      <div class="btn-row">
        <button class="btn primary small" data-action="export">Zrób kopię</button>
        <button class="btn secondary small" data-action="backup-snooze">Później</button>
      </div>
    </section>`;
  }

  if (!state.profile && !state.goalsManual) {
    html += `<section class="card cta">
      <p>Ustaw swój cel – policzę dzienne zapotrzebowanie.</p>
      <button class="btn primary small" data-action="tab" data-view="profile">Ustaw cel</button>
    </section>`;
  }

  const prevDay = addDays(currentDay, -1);
  const prevLabel = currentDay === todayKey() ? 'wczoraj' : 'dzień wcześniej';
  for (const meal of MEALS) {
    const list = entries.filter((e) => e.meal === meal.id);
    const s = sumEntries(list);
    html += `<section class="card meal">
      <header><h3>${meal.name}</h3><span class="meal-right">${list.length
        ? `<span class="muted">${r0(s.kcal)} kcal</span><button class="link small-link" data-action="copy-meal" data-meal="${meal.id}">Kopiuj</button>`
        : ''}</span></header>`;
    if (list.length) {
      html += '<ul class="entries">' + list.map((e) => {
        const v = calc(e, e.grams);
        return `<li data-action="edit-entry" data-id="${esc(e.id)}">
          <div><div class="name">${esc(e.name)}</div>
          <div class="meta">${e.quick ? 'szybkie dodanie' : fmt1(e.grams) + ' g'} · B ${fmt1(v.p)} · T ${fmt1(v.f)} · W ${fmt1(v.c)}</div></div>
          <div class="kcal">${r0(v.kcal)} kcal</div>
        </li>`;
      }).join('') + '</ul>';
    } else {
      // Pusty posiłek, a wczoraj coś było – zaproponuj powtórzenie
      const prev = dayEntries(prevDay).filter((e) => e.meal === meal.id);
      if (prev.length) {
        html += `<button class="repeat-btn" data-action="repeat-meal" data-meal="${meal.id}">↻ Jak ${prevLabel}: ${prev.length === 1 ? esc(prev[0].name) : prev.length + ' pozycje'} · ${r0(sumEntries(prev).kcal)} kcal</button>`;
      }
    }
    html += `<button class="add-btn" data-action="add" data-meal="${meal.id}">+ Dodaj</button></section>`;
  }
  if (entries.length) html += '<button class="btn secondary block" data-action="copy-day">Kopiuj cały dzień na inny dzień…</button>';
  $('#main').innerHTML = html;
  const qd = $('.quality');
  if (qd) qd.addEventListener('toggle', () => { qualityOpen = qd.open; });
}

// ----- Woda -----
const GLASS_ML = 250;
const fmtL = (ml) => (ml / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
function waterCard() {
  const ml = state.water[currentDay] || 0;
  const goal = state.waterGoal || 2000;
  const n = Math.min(16, Math.ceil(goal / GLASS_ML));
  const full = Math.floor(ml / GLASS_ML);
  const glasses = Array.from({ length: Math.max(n, Math.min(16, full)) }, (_, i) => `<span class="glass${i < full ? ' full' : ''}"></span>`).join('');
  return `<section class="card water">
    <header><h3>Woda</h3><span class="muted">${fmtL(ml)} / ${fmtL(goal)} l${ml >= goal ? ' ✓' : ''}</span></header>
    <div class="glasses" aria-label="${full} szklanek">${glasses}</div>
    <div class="water-btns">
      <button class="btn secondary small" data-action="water-minus" ${ml ? '' : 'disabled'} aria-label="Odejmij szklankę">−</button>
      <button class="btn primary small" data-action="water-plus">+ szklanka (250 ml)</button>
    </div>
  </section>`;
}
function waterChange(delta) {
  const ml = Math.max(0, Math.min(10000, (state.water[currentDay] || 0) + delta));
  if (ml) state.water[currentDay] = ml; else delete state.water[currentDay];
  save();
  render();
}

// ----- Jakość dnia: przetworzenie (NOVA) oraz cukry, sól, błonnik, tłuszcze nasycone -----
let qualityOpen = false;
const QUALITY_NUTR = [
  { key: 'sugars', name: 'Cukry', ref: () => 50, max: true, hint: 'zalecane maks. ok. 50 g' },
  { key: 'salt', name: 'Sól', ref: () => 5, max: true, hint: 'zalecane maks. 5 g' },
  { key: 'satfat', name: 'Tłuszcze nasycone', ref: () => r0((state.goals.kcal * 0.1) / 9), max: true, hint: 'maks. 10% kalorii' },
  { key: 'fiber', name: 'Błonnik', ref: () => 25, max: false, hint: 'zalecane min. 25 g' },
];
function entryHealth(e) {
  if (e.quick) return null;
  return productHealth(findProduct(e.productId));
}
function dayQuality(entries) {
  const q = { kcal: 0, nova: { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 }, nutr: {} };
  for (const n of QUALITY_NUTR) q.nutr[n.key] = { g: 0, cov: 0 };
  for (const e of entries) {
    const kcal = calc(e, e.grams).kcal;
    q.kcal += kcal;
    const h = entryHealth(e);
    q.nova[h && [1, 2, 3, 4].includes(h.nova) ? h.nova : 0] += kcal;
    for (const n of QUALITY_NUTR) {
      if (h && h[n.key] != null) { q.nutr[n.key].g += (h[n.key] * e.grams) / 100; q.nutr[n.key].cov += kcal; }
    }
  }
  return q;
}
function qualityCard(entries) {
  if (!entries.length) return '';
  const q = dayQuality(entries);
  const pct = (v) => (q.kcal > 0 ? (v / q.kcal) * 100 : 0);
  const up = pct(q.nova[4]);
  const known = q.kcal - q.nova[0];
  const segs = [1, 2, 3, 4, 0].map((k) => q.nova[k] > 0
    ? `<span class="nseg n${k}" style="width:${pct(q.nova[k])}%" title="${k ? 'NOVA ' + k : 'brak danych'}: ${r0(pct(q.nova[k]))}%"></span>` : '').join('');
  const summary = known > 0
    ? `ultraprzetworzone: ${r0(up)}% kcal${known < q.kcal * 0.95 ? ` (dane dla ${r0(pct(known))}%)` : ''}`
    : 'brak danych o przetworzeniu';
  const rows = QUALITY_NUTR.map((n) => {
    const d = q.nutr[n.key];
    if (d.cov <= 0) return `<div class="qrow"><span>${n.name}</span><span class="muted">brak danych</span></div>`;
    const ref = n.ref();
    const bad = n.max ? d.g > ref : d.g < ref;
    const partial = d.cov < q.kcal * 0.95;
    return `<div class="qrow"><span>${n.name}<small>${n.hint}</small></span>
      <span class="${bad && !partial ? (n.max ? 'q-bad' : 'q-low') : ''}">${partial && d.g >= 0.05 ? 'co najmniej ' : ''}<b>${fmt1(d.g)} g</b>
      ${partial ? `<small>dane dla ${r0(pct(d.cov))}% kcal</small>` : ''}</span></div>`;
  }).join('');
  return `<details class="card quality" ${qualityOpen ? 'open' : ''}>
    <summary><b>Jakość dnia</b><span class="muted">${summary}</span></summary>
    <div class="nova-bar">${segs}</div>
    <div class="legend">
      <span><i class="sw n1"></i>nieprzetworzone</span><span><i class="sw n2"></i>składniki kulinarne</span>
      <span><i class="sw n3"></i>przetworzone</span><span><i class="sw n4"></i>ultraprzetworzone</span><span><i class="sw n0"></i>brak danych</span>
    </div>
    <div class="qrows">${rows}</div>
    <p class="tiny">Cukry, sól, błonnik i tłuszcze nasycone liczę tylko z produktów, które mają te dane (zeskanowane lub z Open Food Facts). Produkty wbudowane mają tylko stopień przetworzenia. Ocena orientacyjna.</p>
  </details>`;
}

// ----- Serie dni -----
function dayInNorm(k) {
  const e = dayEntries(k);
  if (!e.length) return false;
  const g = state.goals.kcal;
  return Math.abs(sumEntries(e).kcal - g) <= g * 0.1;
}
function streaks() {
  const t = todayKey();
  const logged = (k) => dayEntries(k).length > 0;
  let log = 0;
  for (let k = logged(t) ? t : addDays(t, -1); logged(k); k = addDays(k, -1)) log++;
  let norm = 0;
  for (let k = addDays(t, -1); dayInNorm(k); k = addDays(k, -1)) norm++;
  let best = 0, cur = 0, lastNorm = null;
  for (const k of Object.keys(state.diary).sort()) {
    if (k >= t) continue;
    if (dayInNorm(k)) { cur = lastNorm === addDays(k, -1) ? cur + 1 : 1; lastNorm = k; best = Math.max(best, cur); }
  }
  return { log, norm, best };
}
function streakLine() {
  if (currentDay !== todayKey()) return '';
  const s = streaks();
  if (s.log < 2 && s.norm < 2) return '';
  const parts = [];
  if (s.log >= 2) parts.push(`<b>${s.log}</b> dni z rzędu z wpisami`);
  if (s.norm >= 2) parts.push(`<b>${s.norm}</b> dni w normie`);
  return `<p class="streak">🔥 ${parts.join(' · ')}</p>`;
}

// ----- Kopiowanie wpisów -----
function copyEntries(entries, targetDay) {
  if (!state.diary[targetDay]) state.diary[targetDay] = [];
  const added = entries.map((e) => ({ ...e, id: uid() }));
  state.diary[targetDay].push(...added);
  save();
  return added;
}
function removeEntries(day, added) {
  const ids = new Set(added.map((a) => a.id));
  const list = dayEntries(day).filter((e) => !ids.has(e.id));
  if (list.length) state.diary[day] = list; else delete state.diary[day];
  save();
  render();
  toast('Cofnięto');
}
function repeatMeal(meal) {
  const src = dayEntries(addDays(currentDay, -1)).filter((e) => e.meal === meal);
  if (!src.length) return;
  const day = currentDay;
  const added = copyEntries(src, day);
  render();
  toast(`Dodano ${added.length} poz. – ${mealName(meal)}`, { label: 'Cofnij', fn: () => removeEntries(day, added) });
}
function copyToDay(key) {
  const p = calPurpose;
  if (key === p.from) return toast('To ten sam dzień – wybierz inny');
  const src = dayEntries(p.from).filter((e) => !p.meal || e.meal === p.meal);
  const added = copyEntries(src, key);
  closeSheet();
  render();
  toast(`Skopiowano ${added.length} poz. na ${shortDate(key)}`, { label: 'Pokaż', fn: () => { currentDay = key; setView('today'); } });
}

// ----- Historia -----
function niceStep(top) { return top > 4000 ? 1000 : top > 1600 ? 500 : top > 600 ? 200 : 100; }

function kcalChart(days) {
  const W = 340, H = 180, padL = 40, padR = 8, padT = 12, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB, base = padT + plotH;
  const goal = state.goals.kcal;
  const max = Math.max(goal * 1.15, ...days.map((d) => d.kcal), 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + plotH * (1 - v / top);
  const n = days.length, slot = plotW / n;
  const bw = Math.min(28, Math.max(3, slot - 3));
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Kalorie w kolejnych dniach">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${padL - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`;
  }
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    if (d.kcal > 0) {
      const h = Math.max(2, base - y(d.kcal));
      const r = Math.min(4, bw / 2, h);
      const cls = d.kcal > goal * 1.1 ? 'bar-over' : 'bar-ok';
      svg += `<path class="mark ${cls}" data-i="${i}" d="M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + bw - r}Q${x + bw},${base - h} ${x + bw},${base - h + r}V${base}Z"/>`;
    }
    const showLabel = n <= 7 || (n - 1 - i) % 5 === 0;
    if (showLabel) {
      const dt = keyToDate(d.key);
      const label = n <= 7 ? dt.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '') : dt.getDate();
      svg += `<text x="${padL + i * slot + slot / 2}" y="${H - 6}" class="axis" text-anchor="middle">${label}</text>`;
    }
    svg += `<rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" class="hit" data-action="chart-bar" data-i="${i}"/>`;
  });
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}" class="goal-line"/>`;
  svg += `<text x="${W - padR}" y="${y(goal) - 5}" class="axis goal-label" text-anchor="end">cel ${goal}</text>`;
  return svg + '</svg>';
}

function weightChart(points) {
  const W = 340, H = 170, padL = 40, padR = 12, padT = 14, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = points.map((p) => p.kg).concat(points.map((p) => p.avg));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 2);
  lo = Math.floor((lo - span * 0.2) * 2) / 2; hi = Math.ceil((hi + span * 0.2) * 2) / 2;
  const t0 = keyToDate(points[0].key).getTime(), t1 = keyToDate(points[points.length - 1].key).getTime();
  const x = (key) => padL + (t1 > t0 ? (keyToDate(key).getTime() - t0) / (t1 - t0) : 0.5) * plotW;
  const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo));
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Waga ciała">`;
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    svg += `<text x="${padL - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmt1(v)}</text>`;
  }
  svg += `<path class="wline" d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(p.key)},${y(p.kg)}`).join('')}"/>`;
  // Średnia 7-dniowa – wygładza codzienne wahania (woda, sól, pora ważenia)
  if (points.length >= 3) {
    svg += `<path class="wavg" d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(p.key)},${y(p.avg)}`).join('')}"/>`;
  }
  points.forEach((p, i) => {
    svg += `<circle class="wdot mark" data-i="${i}" cx="${x(p.key)}" cy="${y(p.kg)}" r="4"/>`;
    svg += `<circle class="hit" data-action="chart-weight" data-i="${i}" cx="${x(p.key)}" cy="${y(p.kg)}" r="14"/>`;
  });
  const first = keyToDate(points[0].key), last = keyToDate(points[points.length - 1].key);
  const lbl = (d) => d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  svg += `<text x="${padL}" y="${H - 6}" class="axis">${lbl(first)}</text>`;
  if (points.length > 1) svg += `<text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${lbl(last)}</text>`;
  return svg + '</svg>';
}

// ----- Kalendarz -----
let calMonth = todayKey().slice(0, 7); // 'RRRR-MM'
let calInSheet = false;
function monthShift(m, n) { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return dateKey(d).slice(0, 7); }
function dayStatus(key) {
  const entries = dayEntries(key);
  if (!entries.length) return { cls: '', kcal: 0 };
  const kcal = sumEntries(entries).kcal;
  return { cls: kcal > state.goals.kcal * 1.1 ? 'over' : 'ok', kcal };
}
function calendarHtml() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // poniedziałek jako pierwszy
  const t = todayKey();
  const title = first.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  let cells = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map((d) => `<div class="cal-wd">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) cells += '<div></div>';
  for (let d = 1; d <= daysIn; d++) {
    const key = `${calMonth}-${String(d).padStart(2, '0')}`;
    const st = dayStatus(key);
    const cls = ['cal-day', st.cls, key === t ? 'today' : '', key === currentDay && calInSheet ? 'sel' : '', key > t ? 'future' : '', state.weights[key] != null ? 'has-w' : '']
      .filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-action="cal-day" data-key="${key}"><span>${d}</span><small>${st.kcal ? r0(st.kcal) : ''}</small></button>`;
  }
  return `<div class="cal">
    <div class="cal-head">
      <button class="icon-btn" data-action="cal-prev" aria-label="Poprzedni miesiąc">‹</button>
      <b>${title.charAt(0).toUpperCase() + title.slice(1)}</b>
      <button class="icon-btn" data-action="cal-next" aria-label="Następny miesiąc">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="legend"><span><i class="sw ok"></i>w normie</span><span><i class="sw over"></i>ponad 10% powyżej celu</span><span><i class="dot-w"></i>pomiar wagi</span></div>
  </div>`;
}
// calPurpose: null = przejście do dnia; { type: 'copy', meal (lub null = cały dzień), from }
let calPurpose = null;
function openCalendarSheet(keepMonth, purpose) {
  calInSheet = true;
  if (purpose !== undefined) calPurpose = purpose;
  if (!keepMonth) calMonth = currentDay.slice(0, 7);
  const title = !calPurpose ? 'Wybierz dzień'
    : calPurpose.meal ? `Kopiuj: ${mealName(calPurpose.meal)}` : 'Kopiuj cały dzień';
  const purposeVal = calPurpose; // showSheet nie czyści, ale zachowajmy wprost
  showSheet(title,
    (purposeVal ? `<p class="hint">Wybierz dzień, do którego skopiować wpisy z ${shortDate(purposeVal.from)}. Trafią do tych samych posiłków.</p>` : '') +
    calendarHtml() +
    (!purposeVal && currentDay !== todayKey() ? '<button class="btn secondary block" data-action="cal-today">Przejdź do dziś</button>' : ''));
}
function rerenderCalendar() {
  if (calInSheet) openCalendarSheet(true);
  else renderHistory();
}

let historyDays = [];
let weightPoints = [];
function renderHistory() {
  const t = todayKey();
  historyDays = [];
  let keys = [];
  if (historyRange === 'month') {
    const [y, m] = calMonth.split('-').map(Number);
    const daysIn = new Date(y, m, 0).getDate();
    for (let d = 1; d <= daysIn; d++) { const k = `${calMonth}-${String(d).padStart(2, '0')}`; if (k <= t) keys.push(k); }
  } else {
    for (let i = historyRange - 1; i >= 0; i--) keys.push(addDays(t, -i));
  }
  for (const key of keys) {
    const s = sumEntries(dayEntries(key));
    historyDays.push({ key, ...s, logged: dayEntries(key).length > 0 });
  }
  const periodDone = historyDays.filter((d) => d.key !== t).length;
  const logged = historyDays.filter((d) => d.logged);
  // Do średnich nie liczymy dzisiejszego dnia – jest jeszcze niezakończony
  const done = logged.filter((d) => d.key !== t);
  const avg = (k) => (done.length ? done.reduce((s, d) => s + d[k], 0) / done.length : 0);
  const g = state.goals;
  const inRange = done.filter((d) => Math.abs(d.kcal - g.kcal) <= g.kcal * 0.1).length;

  const wFrom = addDays(t, -89);
  weightPoints = Object.keys(state.weights).filter((k) => k >= wFrom && k <= t).sort().map((key) => ({ key, kg: state.weights[key] }));
  // Średnia z pomiarów z ostatnich 7 dni (włącznie z danym dniem)
  for (const p of weightPoints) {
    const from = addDays(p.key, -6);
    const win = Object.keys(state.weights).filter((k) => k >= from && k <= p.key).map((k) => state.weights[k]);
    p.avg = win.reduce((a, b) => a + b, 0) / win.length;
  }
  const allW = Object.keys(state.weights).sort().reverse();
  let wChange = '';
  if (weightPoints.length > 1) {
    const useAvg = weightPoints.length >= 3;
    const first = weightPoints[0], last = weightPoints[weightPoints.length - 1];
    const diff = useAvg ? last.avg - first.avg : last.kg - first.kg;
    const since = keyToDate(first.key).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
    wChange = useAvg
      ? `Średnia 7 dni: <b>${fmt1(last.avg)} kg</b> · trend <b>${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt1(Math.abs(diff))} kg</b> od ${since}`
      : `Zmiana: <b>${diff > 0 ? '+' : diff < 0 ? '−' : ''}${fmt1(Math.abs(diff))} kg</b> od ${since}`;
  }

  const stat = (label, val, goal, unit) => `<div class="hstat"><span>${label}</span><b>${r0(val)}</b><small>cel ${r0(goal)} ${unit}</small></div>`;

  $('#main').innerHTML = `
    <h1 class="page-title">Historia</h1>
    <div class="segmented">
      <button data-action="range" data-range="7" class="${historyRange === 7 ? 'active' : ''}">7 dni</button>
      <button data-action="range" data-range="30" class="${historyRange === 30 ? 'active' : ''}">30 dni</button>
      <button data-action="range" data-range="month" class="${historyRange === 'month' ? 'active' : ''}">Kalendarz</button>
    </div>

    ${historyRange === 'month' ? `<section class="card">
      ${calendarHtml()}
      <p class="hint">Dotknij dnia, żeby go otworzyć.</p>
    </section>` : `<section class="card">
      <h3>Kalorie</h3>
      <p class="chart-cap" id="kc-cap">${logged.length ? 'Dotknij słupka, żeby zobaczyć szczegóły dnia.' : 'Brak wpisów w tym okresie.'}</p>
      ${kcalChart(historyDays)}
      <div class="legend"><span><i class="sw ok"></i>w normie</span><span><i class="sw over"></i>ponad 10% powyżej celu</span><span><i class="sw goal"></i>cel</span></div>
    </section>`}

    <section class="card">
      <h3>Średnio dziennie</h3>
      <p class="hint">Z zakończonych dni z wpisami: ${done.length} z ${periodDone} (bez dzisiaj). W normie (±10% celu): ${inRange}.</p>
      <div class="hstats">
        ${stat('kcal', avg('kcal'), g.kcal, 'kcal')}
        ${stat('Białko', avg('p'), g.p, 'g')}
        ${stat('Tłuszcze', avg('f'), g.f, 'g')}
        ${stat('Węglow.', avg('c'), g.c, 'g')}
      </div>
    </section>

    ${habitsCard(historyDays)}

    <section class="card">
      <h3>Waga ciała</h3>
      <div class="weight-row">
        <input id="w-in" inputmode="decimal" placeholder="Dzisiejsza waga (kg)" value="${state.weights[t] != null ? fmt1(state.weights[t]) : ''}">
        <button class="btn primary small" data-action="weight-save">Zapisz</button>
      </div>
      ${weightPoints.length ? `<p class="chart-cap" id="w-cap">${wChange || 'Dodawaj pomiary, żeby zobaczyć trend.'}</p>${weightChart(weightPoints)}
      ${weightPoints.length >= 3 ? '<div class="legend"><span><i class="dot-w"></i>pomiary</span><span><i class="sw avg"></i>średnia 7 dni (trend)</span></div>' : ''}` : '<p class="hint">Brak pomiarów z ostatnich 90 dni. Najlepiej waż się rano, na czczo.</p>'}
      ${allW.length ? `<details class="wlist"><summary>Wszystkie pomiary (${allW.length})</summary><ul class="list">${allW.map((k) => `
        <li class="row"><span>${shortDate(k)}</span><span><b>${fmt1(state.weights[k])} kg</b>
        <button class="link danger-link" data-action="weight-del" data-key="${esc(k)}" aria-label="Usuń pomiar">Usuń</button></span></li>`).join('')}</ul></details>` : ''}
    </section>

    <section class="card">
      <h3>Dni</h3>
      ${logged.length ? `<ul class="list flat">${logged.slice().reverse().map((d) => `
        <li class="row" data-action="goto-day" data-key="${d.key}">
          <div><div class="name">${dayLabel(d.key) === 'Dziś' || dayLabel(d.key) === 'Wczoraj' ? dayLabel(d.key) : shortDate(d.key)}</div>
          <div class="meta">B ${r0(d.p)} · T ${r0(d.f)} · W ${r0(d.c)} g</div></div>
          <div class="kcal">${r0(d.kcal)} kcal ›</div>
        </li>`).join('')}</ul>` : '<p class="hint">Brak wpisów w tym okresie.</p>'}
    </section>`;
}

// Serie dni, woda i przetworzenie w wybranym okresie
function habitsCard(days) {
  const s = streaks();
  const t = todayKey();
  const done = days.filter((d) => d.key !== t);
  const waterDays = done.filter((d) => state.water[d.key]);
  const waterAvg = waterDays.length ? waterDays.reduce((sum, d) => sum + state.water[d.key], 0) / waterDays.length : 0;
  const waterOk = waterDays.filter((d) => state.water[d.key] >= state.waterGoal).length;
  const allEntries = days.flatMap((d) => dayEntries(d.key));
  const q = allEntries.length ? dayQuality(allEntries) : null;
  const known = q ? q.kcal - q.nova[0] : 0;
  return `<section class="card">
    <h3>Nawyki</h3>
    <div class="hstats three">
      <div class="hstat"><span>Seria wpisów</span><b>${s.log}</b><small>dni z rzędu</small></div>
      <div class="hstat"><span>Seria w normie</span><b>${s.norm}</b><small>dni z rzędu</small></div>
      <div class="hstat"><span>Najlepsza seria</span><b>${s.best}</b><small>dni w normie</small></div>
    </div>
    <div class="kv"><span>Woda (średnio, dni z wpisem)</span><b>${waterDays.length ? fmtL(waterAvg) + ' l' : '–'}</b></div>
    <div class="kv"><span>Dni z celem wody</span><b>${waterOk} z ${done.length}</b></div>
    <div class="kv"><span>Ultraprzetworzone w tym okresie</span><b>${known > 0 ? r0((q.nova[4] / q.kcal) * 100) + '% kcal' : '–'}</b></div>
    ${known > 0 && known < q.kcal * 0.95 ? `<p class="tiny">Stopień przetworzenia znany dla ${r0((known / q.kcal) * 100)}% kalorii (szybkie wpisy i część produktów go nie mają).</p>` : ''}
    <p class="tiny">„W normie” = kalorie w granicach ±10% celu. Seria w normie liczy zakończone dni (bez dzisiaj).</p>
  </section>`;
}

function selectMark(svgEl, i) {
  svgEl.querySelectorAll('.mark').forEach((m) => m.classList.toggle('dim', m.dataset.i !== String(i)));
}

function weightSave() {
  const kg = num($('#w-in').value);
  if (!(kg >= 20 && kg <= 400)) return toast('Wpisz wagę w kg (np. 78,5)');
  state.weights[todayKey()] = r1(kg);
  let msg = `Zapisano: ${fmt1(kg)} kg`;
  // Gdy waga zmieniła się o co najmniej 1 kg względem profilu – zaktualizuj profil i cel
  const pr = state.profile;
  if (pr && Math.abs(kg - pr.weight) >= 1) {
    pr.weight = r1(kg);
    if (state.goalsFromData) {
      msg += ' · cel z Twoich danych – odśwież go w Profilu, gdy zbierze się więcej pomiarów';
    } else if (!state.goalsManual) {
      const before = state.goals.kcal;
      state.goals = computeGoals(pr).goals;
      if (state.goals.kcal !== before) msg += ` · nowy cel: ${state.goals.kcal} kcal`;
    } else {
      msg += ' · cele ustawione ręcznie – sprawdź je w Profilu';
    }
  }
  save();
  render();
  toast(msg);
}

// ----- Produkty -----
function productItems(list, action) {
  return '<ul class="list">' + list.map((p) => {
    const badge = p.inspiration ? '<span class="badge idea">Inspiracja</span>'
      : p.recipe ? '<span class="badge recipe">Przepis</span>' : p.builtin ? '' : '<span class="badge">Mój</span>';
    return `<li data-action="${action}" data-id="${esc(p.id)}">
      <div class="name">${healthMini(productHealth(p))}${esc(p.name)}${badge}</div>
      <div class="meta">${r0(p.kcal)} kcal · B ${fmt1(p.p)} · T ${fmt1(p.f)} · W ${fmt1(p.c)} <span>(100 g)</span></div>
    </li>`;
  }).join('') + '</ul>';
}

function renderProducts() {
  const isRecipes = productsFilter === 'recipes';
  $('#main').innerHTML = `
    <h1 class="page-title">Produkty</h1>
    <input type="search" class="search" id="pr-q" placeholder="Szukaj produktu albo wpisz kod…" autocomplete="off" enterkeyhint="search" value="${esc(productsQuery)}">
    <div class="segmented">
      <button data-action="filter" data-filter="all" class="${productsFilter === 'all' ? 'active' : ''}">Wszystkie</button>
      <button data-action="filter" data-filter="own" class="${productsFilter === 'own' ? 'active' : ''}">Moje (${state.products.length})</button>
      <button data-action="filter" data-filter="recipes" class="${isRecipes ? 'active' : ''}">Przepisy (${state.recipes.length})</button>
    </div>
    <button class="btn secondary block" data-action="${isRecipes ? 'recipe-new' : 'product-new'}">${isRecipes ? '+ Nowy przepis' : '+ Nowy produkt'}</button>
    <div id="pr-list"></div>`;
  $('#pr-q').addEventListener('input', (e) => { productsQuery = e.target.value; renderProductsList(); });
  $('#pr-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && productsQuery.trim() && productsFilter !== 'recipes') { e.target.blur(); offSearch('products'); }
  });
  renderProductsList();
}
function renderProductsList() {
  const base = productsFilter === 'own' ? state.products
    : productsFilter === 'recipes' ? state.recipes.map(recipeToProduct)
    : allProducts();
  const res = searchProducts(productsQuery, base);
  const emptyMsg = productsQuery ? 'Brak wyników.'
    : productsFilter === 'own' ? 'Nie masz jeszcze własnych produktów.'
    : productsFilter === 'recipes' ? 'Nie masz jeszcze przepisów. Przepis to danie z kilku produktów – np. owsianka albo spaghetti.'
    : 'Brak wyników.';
  let html = res.length ? productItems(res, 'product-open') : `<p class="empty">${emptyMsg}</p>`;
  // Szukanie w Open Food Facts także tutaj (bez przepisów)
  const q = productsQuery.trim();
  if (q && productsFilter !== 'recipes') {
    const cached = offCache[offKey(q)];
    const isCode = /^\d{8,14}$/.test(q);
    html += `<h4 class="list-title">Open Food Facts</h4>
      <div id="off-res-main">${cached ? offResultsHtml(cached, 'products') : `
        <button class="btn secondary block" data-action="off-search" data-where="products">${isCode ? `Szukaj kodu ${esc(q)}` : `Szukaj „${esc(q)}” w Open Food Facts`}</button>
        <p class="hint">Znaleziony produkt możesz zapisać u siebie – będzie dostępny także bez internetu.</p>`}
      </div>`;
  }
  $('#pr-list').innerHTML = html;
}

// ----- Inspiracje -----
let ideasMeal = 'all';
let ideasQuery = '';
const ideasFilters = new Set(); // 'wege' | 'protein' | 'light' | 'quick'
let suggestMeal = null;         // posiłek wybrany w "Co zjeść?" (null = wg godziny)
const IDEA_FILTERS = [
  { id: 'wege', name: 'Wege', test: (x) => x.wege },
  { id: 'protein', name: 'Dużo białka', test: (x) => x.highProtein },
  { id: 'light', name: 'Do 400 kcal', test: (x) => x.light },
  { id: 'quick', name: 'Do 15 min', test: (x) => x.quick },
];
function mealByTime() {
  const h = new Date().getHours();
  return h < 11 ? 'sniadanie' : h < 16 ? 'obiad' : h < 21 ? 'kolacja' : 'przekaska';
}
function ideaItems(list) {
  return '<ul class="list ideas">' + list.map((x) => `
    <li data-action="idea-open" data-id="${esc(x.id)}">
      <span class="idea-emoji" aria-hidden="true">${x.emoji || '🍽️'}</span>
      <div class="idea-body">
        <div class="name">${healthMini(x.health)}${esc(x.name)}</div>
        <div class="meta">${r0(x.per.kcal)} kcal · B ${r0(x.per.p)} g · ${x.time} min${x.wege ? ' · wege' : ''}</div>
      </div>
    </li>`).join('') + '</ul>';
}
// Podpowiedzi dopasowane do kalorii i białka, które zostały na dziś
function suggestions() {
  const t = todayKey();
  const eaten = sumEntries(dayEntries(t));
  const g = state.goals;
  const left = g.kcal - eaten.kcal;
  const protLeft = Math.max(0, g.p - eaten.p);
  const meal = suggestMeal || mealByTime();
  const share = { sniadanie: 0.25, obiad: 0.35, kolacja: 0.25, przekaska: 0.12 }[meal];
  let list, note;
  if (left < 150) {
    // Cel prawie osiągnięty – najlżejsze przekąski
    list = INSPIRATIONS.filter((x) => x.meals.includes('przekaska')).sort((a, b) => a.per.kcal - b.per.kcal).slice(0, 3);
    note = left < 0 ? `Dzisiejszy cel jest już przekroczony o ${r0(-left)} kcal. Jeśli jesteś głodny – coś lekkiego:` : 'Dzisiejszy cel prawie osiągnięty. Jeśli jesteś głodny – coś lekkiego:';
  } else {
    const target = Math.min(left, g.kcal * share);
    const score = (x) => {
      let s = Math.abs(x.per.kcal - target) / target;          // jak blisko docelowych kalorii
      if (x.per.kcal > left) s += 2;                             // nie mieści się w limicie
      if (protLeft > 30) s -= Math.min(x.per.p, 50) / 100;        // brakuje białka – premiuj białkowe
      return s;
    };
    list = INSPIRATIONS.filter((x) => x.meals.includes(meal)).sort((a, b) => score(a) - score(b)).slice(0, 3);
    note = `Zostało Ci dziś <b>${r0(left)} kcal</b> i <b>${r0(protLeft)} g białka</b>. Propozycje ok. ${r0(target)} kcal:`;
  }
  return { list, note, meal };
}
function suggestCard() {
  const s = suggestions();
  return `<section class="card suggest">
    <h3>Co zjeść?</h3>
    <div class="chips small">${IDEA_MEALS.map((m) => `<button class="chip${m.id === s.meal ? ' on' : ''}" data-action="suggest-meal" data-meal="${m.id}">${m.name}</button>`).join('')}</div>
    <p class="hint">${s.note}</p>
    ${ideaItems(s.list)}
  </section>`;
}
function renderIdeas() {
  $('#main').innerHTML = `
    <h1 class="page-title">Inspiracje</h1>
    ${suggestCard()}
    <input type="search" class="search" id="ideas-q" placeholder="Szukaj przepisu…" autocomplete="off" value="${esc(ideasQuery)}">
    <div class="chips small">
      <button class="chip${ideasMeal === 'all' ? ' on' : ''}" data-action="ideas-meal" data-meal="all">Wszystkie</button>
      ${IDEA_MEALS.map((m) => `<button class="chip${ideasMeal === m.id ? ' on' : ''}" data-action="ideas-meal" data-meal="${m.id}">${m.name}</button>`).join('')}
    </div>
    <div class="chips small">
      ${IDEA_FILTERS.map((f) => `<button class="chip toggle${ideasFilters.has(f.id) ? ' on' : ''}" data-action="ideas-filter" data-f="${f.id}">${f.name}</button>`).join('')}
    </div>
    <div id="ideas-list"></div>`;
  $('#ideas-q').addEventListener('input', (e) => { ideasQuery = e.target.value; renderIdeasList(); });
  renderIdeasList();
}
function renderIdeasList() {
  let list = INSPIRATIONS.filter((x) => ideasMeal === 'all' || x.meals.includes(ideasMeal));
  for (const f of IDEA_FILTERS) if (ideasFilters.has(f.id)) list = list.filter(f.test);
  if (ideasQuery.trim()) {
    const words = norm(ideasQuery.trim()).split(/\s+/);
    list = list.filter((x) => { const hay = norm(x.name + ' ' + x.items.map((i) => i[0]).join(' ')); return words.every((w) => hay.includes(w)); });
  }
  $('#ideas-list').innerHTML = list.length
    ? `<p class="hint">${list.length} ${list.length === 1 ? 'przepis' : list.length < 5 ? 'przepisy' : 'przepisów'}</p>` + ideaItems(list)
    : '<p class="empty">Brak przepisów dla wybranych filtrów.</p>';
}

// Szczegóły przepisu z Inspiracji
let ideaCtx = null;
function openIdea(id) {
  const x = findIdea(id);
  if (!x) return;
  const defMeal = (IDEA_MEALS.find((m) => m.id === (x.meals.includes(suggestMeal || mealByTime()) ? (suggestMeal || mealByTime()) : x.meals[0])) || IDEA_MEALS[0]).diary;
  ideaCtx = { x, portions: 1 };
  const saved = state.recipes.some((r) => r.fromIdea === x.id);
  showSheet(x.name, `
    <div class="idea-head">
      <span class="idea-emoji big" aria-hidden="true">${x.emoji || '🍽️'}</span>
      <div class="meta">${x.time} min · ${x.servings} ${x.servings === 1 ? 'porcja' : x.servings < 5 ? 'porcje' : 'porcji'}${x.wege ? ' · wege' : ''}</div>
      ${healthBadges(x.health)}
    </div>
    <p class="list-title">Na 1 porcję (ok. ${r0(x.product.portionGrams)} g)</p>
    <div class="result">
      <div><b>${r0(x.per.kcal)}</b><span>kcal</span></div>
      <div class="p"><b>${fmt1(x.per.p)}</b><span>białko</span></div>
      <div class="f"><b>${fmt1(x.per.f)}</b><span>tłuszcze</span></div>
      <div class="c"><b>${fmt1(x.per.c)}</b><span>węglow.</span></div>
    </div>
    <h4 class="list-title">Składniki${x.servings > 1 ? ` (na ${x.servings} porcje)` : ''}</h4>
    <ul class="list ingredients">${x.rec.items.map((it) => `<li class="row"><span>${esc(it.name)}</span><span class="muted">${fmt1(it.grams)} g</span></li>`).join('')}</ul>
    <p class="tiny">Sól, pieprz, zioła i przyprawy – do smaku.</p>
    <h4 class="list-title">Przygotowanie</h4>
    <ol class="steps">${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

    <div class="card idea-add">
      <h4>Dodaj do dzisiejszego dziennika</h4>
      <div class="chips">${[0.5, 1, 1.5, 2].map((n) => `<button class="chip${n === 1 ? ' on' : ''}" data-action="idea-portions" data-n="${n}">${String(n).replace('.', ',')} porc.</button>`).join('')}</div>
      <label class="field"><span>Posiłek</span>
        <select id="idea-meal">${MEALS.map((m) => `<option value="${m.id}"${m.id === defMeal ? ' selected' : ''}>${m.name}</option>`).join('')}</select></label>
      <button class="btn primary block" data-action="idea-add" id="idea-add-btn"></button>
    </div>
    <button class="btn secondary block" data-action="idea-save">${saved ? 'Masz już ten przepis u siebie' : 'Zapisz w moich przepisach (do edycji)'}</button>`);
  updateIdeaButton();
}
function updateIdeaButton() {
  const { x, portions } = ideaCtx;
  $('#idea-add-btn').textContent = `Dodaj ${String(portions).replace('.', ',')} porc. · ${r0(x.per.kcal * portions)} kcal`;
  document.querySelectorAll('[data-action="idea-portions"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === portions));
}
function ideaAdd() {
  const { x, portions } = ideaCtx;
  const day = todayKey();
  const p = x.product;
  const grams = r1(p.portionGrams * portions);
  if (!state.diary[day]) state.diary[day] = [];
  const entry = snapshot(p, grams, { meal: $('#idea-meal').value });
  state.diary[day].push(entry);
  state.recent = [p.id, ...state.recent.filter((id) => id !== p.id)].slice(0, 15);
  save();
  closeSheet();
  render();
  toast(`Dodano: ${x.name}`, { label: 'Pokaż', fn: () => { currentDay = day; setView('today'); } });
}
function ideaSave() {
  const { x } = ideaCtx;
  const existing = state.recipes.find((r) => r.fromIdea === x.id);
  if (existing) { closeSheet(); return openRecipeEditor(existing); }
  const recipe = {
    id: uid(), name: x.name, fromIdea: x.id, cookedWeight: null, portions: x.servings,
    items: x.rec.items.map((it) => ({ ...it, id: uid() })),
  };
  state.recipes.push(recipe);
  save();
  closeSheet();
  render();
  toast('Zapisano w Produkty → Przepisy', { label: 'Edytuj', fn: () => openRecipeEditor(state.recipes.find((r) => r.id === recipe.id)) });
}

// ----- Profil -----
// tdeeOverride: zapotrzebowanie policzone z danych użytkownika zamiast ze wzoru
function computeGoals(pr, tdeeOverride) {
  const goal = GOALS[goalKey(pr.goal)];
  const bmr = 10 * pr.weight + 6.25 * pr.height - 5 * pr.age + (pr.sex === 'm' ? 5 : -161);
  const tdee = tdeeOverride || bmr * pr.activity;
  const minKcal = pr.sex === 'm' ? 1500 : 1200;
  const wanted = tdee * (1 + goal.pct);
  const kcal = Math.max(wanted, minKcal);
  const p = pr.weight * (goal.lose ? 2 : 1.8);
  const f = (kcal * 0.25) / 9;
  const c = Math.max(0, (kcal - p * 4 - f * 9) / 4);
  const diff = kcal - tdee;              // dzienna różnica kcal
  const kgPerWeek = (diff * 7) / 7700;    // ok. 7700 kcal ≈ 1 kg tkanki tłuszczowej
  return {
    bmr, tdee, diff, kgPerWeek, clamped: wanted < minKcal, minKcal,
    goals: { kcal: r0(kcal), p: r0(p), f: r0(f), c: r0(c) },
  };
}

// ----- BMI -----
function bmiInfo(weight, height) {
  const bmi = weight / (height / 100) ** 2;
  const cats = [
    [18.5, 'niedowaga', 'under'], [25, 'waga prawidłowa', 'ok'], [30, 'nadwaga', 'over'],
    [35, 'otyłość I stopnia', 'obese'], [40, 'otyłość II stopnia', 'obese'], [Infinity, 'otyłość III stopnia', 'obese'],
  ];
  const [, label, cls] = cats.find(([max]) => bmi < max);
  const okFrom = 18.5 * (height / 100) ** 2, okTo = 24.9 * (height / 100) ** 2;
  return { bmi, label, cls, okFrom, okTo };
}

// ----- Zapotrzebowanie z danych: średnie jedzenie + trend wagi z ostatnich 4 tygodni -----
const ADAPT_DAYS = 28;
function adaptiveTdee() {
  const t = todayKey();
  const from = addDays(t, -ADAPT_DAYS);
  const formula = state.profile ? computeGoals(state.profile).tdee : null;
  // Dni z wpisami (bez dzisiaj). Dni z bardzo małą liczbą kalorii to zwykle niepełne wpisy – pomijamy.
  const minDay = Math.max(800, formula ? formula * 0.4 : 800);
  const all = [];
  for (let i = 1; i <= ADAPT_DAYS; i++) {
    const k = addDays(t, -i);
    if (dayEntries(k).length) all.push(sumEntries(dayEntries(k)).kcal);
  }
  const days = all.filter((k) => k >= minDay);
  const skipped = all.length - days.length;
  // Trend wagi: prosta dopasowana metodą najmniejszych kwadratów (odporna na wahania dzień do dnia)
  const pts = Object.keys(state.weights).filter((k) => k >= from && k <= t).sort()
    .map((k) => ({ x: (keyToDate(k) - keyToDate(from)) / DAY_MS, y: state.weights[k] }));
  const span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;
  const res = { ok: false, days: days.length, skipped, weights: pts.length, span, formula };
  if (days.length < 14 || pts.length < 4 || span < 10) return res;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0); // kg/dzień
  const intake = days.reduce((a, b) => a + b, 0) / days.length;
  const tdee = intake - slope * 7700; // 1 kg tkanki ≈ 7700 kcal
  const plausible = tdee >= 1200 && tdee <= 6000 && (!formula || Math.abs(tdee - formula) / formula <= 0.35);
  return { ...res, ok: true, intake, slope, weekly: slope * 7, tdee, plausible };
}
function adaptiveCard() {
  const a = adaptiveTdee();
  if (!a.ok) {
    const need = [];
    if (a.days < 14) need.push(`dni z wpisami jedzenia: <b>${a.days} / 14</b>`);
    if (a.weights < 4) need.push(`pomiary wagi: <b>${a.weights} / 4</b>`);
    else if (a.span < 10) need.push(`pomiary wagi z dłuższego okresu: <b>${r0(a.span)} / 10 dni</b>`);
    return `<section class="card">
      <h3>Zapotrzebowanie z Twoich danych</h3>
      <p class="hint">Wzory to tylko szacunek (±10–15%). Gdy przez 2–4 tygodnie będziesz wpisywać jedzenie i ważyć się co kilka dni, policzę, ile naprawdę spalasz – na podstawie tego, ile jesz i jak zmienia się Twoja waga.</p>
      <p class="small">Brakuje jeszcze: ${need.join(', ')} (z ostatnich 4 tygodni).</p>
    </section>`;
  }
  const sign = a.weekly > 0 ? '+' : a.weekly < 0 ? '−' : '';
  const diff = a.formula ? a.tdee - a.formula : null;
  const canApply = a.plausible && state.profile;
  return `<section class="card adaptive">
    <h3>Zapotrzebowanie z Twoich danych</h3>
    <div class="adaptive-main"><b>${r0(a.tdee)} kcal</b><span>dziennie (szacunek z ostatnich 4 tygodni)</span></div>
    <div class="kv"><span>Średnio jesz</span><b>${r0(a.intake)} kcal / dzień</b></div>
    <div class="kv"><span>Trend wagi</span><b>${sign}${fmt1(Math.abs(a.weekly))} kg / tydzień</b></div>
    ${a.formula ? `<div class="kv"><span>Ze wzoru</span><b>${r0(a.formula)} kcal (${diff >= 0 ? '+' : '−'}${r0(Math.abs(diff))})</b></div>` : ''}
    <p class="tiny">Na podstawie ${a.days} dni z wpisami i ${a.weights} pomiarów wagi${a.skipped ? `; pominięto ${a.skipped} dni z bardzo małą liczbą kalorii (prawdopodobnie niepełne wpisy)` : ''}. Wynik jest tak dokładny, jak Twoje wpisy – liczy się wszystko, także napoje i przekąski.</p>
    ${!a.plausible ? '<p class="note">Wynik mocno odbiega od wzoru. Sprawdź, czy wpisujesz wszystko, co jesz, i czy ważysz się w podobnych warunkach (rano, na czczo).</p>' : ''}
    ${canApply ? `<button class="btn primary block" data-action="adaptive-apply">Ustaw cele według tego wyniku</button>
      <p class="tiny">Cel zostanie policzony z ${r0(a.tdee)} kcal i Twojego tempa („${esc(GOALS[goalKey(state.profile.goal)].name)}”).</p>` : ''}
    ${!state.profile && a.plausible ? '<p class="hint">Uzupełnij dane wyżej, żeby ustawić cel według tego wyniku.</p>' : ''}
  </section>`;
}
function adaptiveApply() {
  const a = adaptiveTdee();
  if (!a.ok || !a.plausible || !state.profile) return;
  const before = state.goals.kcal;
  state.goals = computeGoals(state.profile, a.tdee).goals;
  state.goalsManual = false;
  state.goalsFromData = true;
  save();
  render();
  toast(`Cel: ${before} → ${state.goals.kcal} kcal (z Twoich danych)`);
}

function renderProfile() {
  const pr = state.profile || {};
  const g = state.goals;
  const calc_ = state.profile ? computeGoals(state.profile) : null;
  const opt = (v, label, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${label}</option>`;

  $('#main').innerHTML = `
    <h1 class="page-title">Profil i cel</h1>
    <section class="card">
      <h3>Twoje dane</h3>
      <label class="field"><span>Płeć</span>
        <select id="pf-sex">${opt('m', 'Mężczyzna', pr.sex)}${opt('k', 'Kobieta', pr.sex)}</select></label>
      <div class="grid3">
        <label class="field"><span>Wiek</span><input id="pf-age" inputmode="numeric" placeholder="lat" value="${pr.age ?? ''}"></label>
        <label class="field"><span>Waga (kg)</span><input id="pf-weight" inputmode="decimal" placeholder="kg" value="${pr.weight ?? ''}"></label>
        <label class="field"><span>Wzrost (cm)</span><input id="pf-height" inputmode="numeric" placeholder="cm" value="${pr.height ?? ''}"></label>
      </div>
      <label class="field"><span>Aktywność</span>
        <select id="pf-act">${ACTIVITY.map(([v, l]) => opt(v, l, pr.activity ?? 1.4)).join('')}</select></label>
      <p class="hint">Nie wiesz, co wybrać? Przy pracy przy biurku i bez regularnych treningów – „Siedzący”. Po 2–3 tygodniach wpisów aplikacja policzy Twoje zapotrzebowanie dokładniej z danych.</p>
      <label class="field"><span>Cel i tempo</span>
        <select id="pf-goal">${Object.entries(GOALS).map(([k, v]) => opt(k, v.name, goalKey(pr.goal ?? 'keep'))).join('')}</select></label>
      <p class="hint">Procent liczony od Twojego całkowitego zapotrzebowania. Bezpieczne tempo chudnięcia to ok. 0,5–1% masy ciała tygodniowo.</p>
      <button class="btn primary block" data-action="profile-save">Oblicz i zapisz cel</button>
    </section>

    ${calc_ ? `<section class="card">
      <h3>Wyliczenia</h3>
      ${(() => {
        const b = bmiInfo(state.profile.weight, state.profile.height);
        const pos = Math.max(0, Math.min(100, ((b.bmi - 15) / (40 - 15)) * 100));
        return `<div class="kv"><span>BMI</span><b class="bmi-${b.cls}">${fmt1(b.bmi)} · ${b.label}</b></div>
        <div class="bmi-bar"><span style="left:${pos}%"></span></div>
        <p class="tiny">Prawidłowa waga dla Twojego wzrostu: ${fmt1(b.okFrom)}–${fmt1(b.okTo)} kg. BMI nie uwzględnia mięśni – u osób wysportowanych bywa zawyżone.</p>`;
      })()}
      <div class="kv"><span>Podstawowa przemiana materii</span><b>${r0(calc_.bmr)} kcal</b></div>
      <div class="kv"><span>Całkowite zapotrzebowanie (wzór)</span><b>${r0(calc_.tdee)} kcal</b></div>
      <div class="kv"><span>Cel dzienny (ze wzoru)</span><b>${calc_.goals.kcal} kcal</b></div>
      ${Math.abs(calc_.diff) >= 1 ? `<div class="kv"><span>${calc_.diff < 0 ? 'Deficyt' : 'Nadwyżka'}</span><b>${calc_.diff < 0 ? '−' : '+'}${r0(Math.abs(calc_.diff))} kcal dziennie</b></div>
      <div class="kv"><span>Przewidywane tempo</span><b>ok. ${calc_.diff < 0 ? '−' : '+'}${fmt1(Math.abs(calc_.kgPerWeek))} kg / tydzień</b></div>` : ''}
      ${calc_.clamped ? `<p class="note" style="margin-top:8px">Cel podniesiony do minimum ${calc_.minKcal} kcal – niżej trudno pokryć potrzeby organizmu. Rozważ łagodniejsze tempo albo więcej ruchu.</p>` : ''}
      ${GOALS[goalKey(state.profile.goal)].lose && Math.abs(calc_.kgPerWeek) > state.profile.weight * 0.01 ? '<p class="note" style="margin-top:8px">To tempo przekracza 1% masy ciała tygodniowo. Może być trudne do utrzymania – rozważ wolniejsze.</p>' : ''}
      <p class="tiny">Wyliczenia orientacyjne (wzór Mifflina-St Jeora). Realny spadek wagi bywa wolniejszy, a waga waha się z dnia na dzień.</p>
    </section>` : ''}

    ${adaptiveCard()}

    <section class="card">
      <h3>Dzienne cele</h3>
      <p class="hint">${state.goalsManual ? 'Ustawione ręcznie.'
        : state.goalsFromData ? 'Policzone z Twoich danych (jedzenie + waga z ostatnich tygodni).'
        : state.profile ? 'Wyliczone ze wzoru na podstawie Twoich danych – możesz je zmienić.'
        : 'Domyślne – uzupełnij dane wyżej albo wpisz własne.'}</p>
      <div class="grid2">
        <label class="field"><span>Kalorie (kcal)</span><input id="g-kcal" inputmode="numeric" value="${g.kcal}"></label>
        <label class="field"><span>Białko (g)</span><input id="g-p" inputmode="numeric" value="${g.p}"></label>
        <label class="field"><span>Tłuszcze (g)</span><input id="g-f" inputmode="numeric" value="${g.f}"></label>
        <label class="field"><span>Węglowodany (g)</span><input id="g-c" inputmode="numeric" value="${g.c}"></label>
      </div>
      <button class="btn secondary block" data-action="goals-save">Zapisz cele ręcznie</button>
    </section>

    <section class="card">
      <h3>Woda</h3>
      <p class="hint">Typowo 1,5–2,5 l dziennie (ok. 30–35 ml na kg masy ciała${pr.weight ? ` – dla Ciebie ok. ${fmtL(r0((pr.weight * 33) / 50) * 50)} l` : ''}). Więcej przy upale i treningu.</p>
      <div class="weight-row">
        <input id="water-goal" inputmode="numeric" value="${state.waterGoal}" aria-label="Cel wody w ml">
        <span class="unit">ml</span>
        <button class="btn primary small" data-action="water-goal-save">Zapisz</button>
      </div>
    </section>

    <section class="card">
      <h3>Dane i kopia zapasowa</h3>
      <p class="hint">Wszystko jest zapisane tylko na tym urządzeniu – nie ma konta ani serwera. Usunięcie aplikacji z ekranu skasuje dane, więc rób czasem kopię (najlepiej zapisz ją w iCloud Drive).</p>
      <div class="kv"><span>Ostatnia kopia</span><b>${state.lastBackup ? new Date(state.lastBackup).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) : 'jeszcze nie było'}</b></div>
      <button class="btn secondary block" data-action="export">Eksportuj kopię</button>
      <button class="btn secondary block" data-action="import">Wczytaj kopię</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <button class="btn danger block" data-action="reset">Usuń wszystkie dane</button>
    </section>
    <p class="footer">Kalorie · wersja 11</p>`;

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

function profileSave() {
  const pr = {
    sex: $('#pf-sex').value,
    age: num($('#pf-age').value),
    weight: num($('#pf-weight').value),
    height: num($('#pf-height').value),
    activity: Number($('#pf-act').value),
    goal: $('#pf-goal').value,
    actScale: 2,
  };
  if (!(pr.age >= 10 && pr.age <= 100)) return toast('Wpisz wiek (10–100 lat)');
  if (!(pr.weight >= 30 && pr.weight <= 300)) return toast('Wpisz wagę (30–300 kg)');
  if (!(pr.height >= 100 && pr.height <= 250)) return toast('Wpisz wzrost (100–250 cm)');
  state.profile = pr;
  state.goals = computeGoals(pr).goals;
  state.goalsManual = false;
  state.goalsFromData = false;
  save();
  render();
  toast(`Cel: ${state.goals.kcal} kcal dziennie`);
  window.scrollTo(0, 0);
}

function goalsSave() {
  const g = { kcal: num($('#g-kcal').value), p: num($('#g-p').value), f: num($('#g-f').value), c: num($('#g-c').value) };
  if (!(g.kcal >= 500 && g.kcal <= 10000)) return toast('Wpisz kalorie (500–10000)');
  for (const k of ['p', 'f', 'c']) if (!(g[k] >= 0 && g[k] <= 1000)) return toast('Sprawdź wartości makroskładników');
  state.goals = { kcal: r0(g.kcal), p: r0(g.p), f: r0(g.f), c: r0(g.c) };
  state.goalsManual = true;
  state.goalsFromData = false;
  save();
  render();
  toast('Zapisano cele');
}

// ===== Arkusz (okno od dołu) =====
let sheetBack = null;
let sheetGen = 0; // rośnie przy każdej zmianie zawartości – pozwala przerwać spóźnione operacje (aparat, wyszukiwanie)
function showSheet(title, body, back) {
  sheetGen++;
  stopScanner();
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = body;
  $('#sheet-body').scrollTop = 0;
  sheetBack = back || null;
  $('#sheet-back').style.visibility = back ? 'visible' : 'hidden';
  const w = $('#sheet');
  if (w.hidden) {
    w.hidden = false;
    void w.offsetWidth; // wymusza przeliczenie układu, żeby animacja wysuwania zadziałała
  }
  // Zawsze (także gdy okno właśnie się zamykało – inaczej znikałoby po animacji zamykania)
  document.body.classList.add('noscroll');
  w.classList.add('open');
}
function closeSheet() {
  sheetGen++;
  stopScanner();
  const w = $('#sheet');
  w.classList.remove('open');
  document.body.classList.remove('noscroll');
  sheetBack = null;
  recipeDraft = null;
  calInSheet = false;
  calPurpose = null;
  setTimeout(() => { if (!w.classList.contains('open')) { w.hidden = true; $('#sheet-body').innerHTML = ''; } }, 300);
}

// --- Wybór produktu ---
// pickerCtx: { mode: 'diary', meal } – dodawanie do dziennika
//            { mode: 'ingredient' }  – dodawanie składnika do przepisu
let pickerCtx = null;
let pickerQuery = '';
function openPicker(ctx, keepQuery) {
  pickerCtx = ctx;
  if (!keepQuery) pickerQuery = '';
  const ing = ctx.mode === 'ingredient';
  showSheet(ing ? 'Dodaj składnik' : 'Dodaj – ' + mealName(ctx.meal), `
    <input type="search" class="search" id="pk-q" placeholder="Szukaj produktu albo wpisz kod…" autocomplete="off" value="${esc(pickerQuery)}" enterkeyhint="search">
    <div class="btn-row">
      <button class="btn primary" data-action="scan">Skanuj kod</button>
      <button class="btn secondary" data-action="picker-new">+ Nowy produkt</button>
    </div>
    ${ing ? '' : '<button class="btn secondary block" data-action="quick-add">Szybko: wpisz same kalorie</button>'}
    <div id="pk-list"></div>`,
  ing ? renderRecipeEditor : null);
  $('#pk-q').addEventListener('input', (e) => { pickerQuery = e.target.value; renderPickerList(); });
  // Enter na klawiaturze = szukaj w Open Food Facts
  $('#pk-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && pickerQuery.trim()) { e.target.blur(); offSearch('picker'); } });
  renderPickerList();
}
function renderPickerList() {
  const withRecipes = pickerCtx.mode !== 'ingredient';
  const pool = allProducts(withRecipes);
  const q = pickerQuery.trim();
  let html = '';
  if (!q) {
    const recent = state.recent.map(findProduct).filter((p) => p && (withRecipes || !p.recipe));
    if (recent.length) html += '<h4 class="list-title">Ostatnio używane</h4>' + productItems(recent, 'pick');
    if (withRecipes && state.recipes.length) html += '<h4 class="list-title">Twoje przepisy</h4>' + productItems(sortByName(state.recipes.map(recipeToProduct)), 'pick');
    html += '<h4 class="list-title">Wszystkie produkty</h4>' + productItems(sortByName(pool.filter((p) => !p.recipe)), 'pick');
  } else {
    // Przy wyszukiwaniu pokazujemy też przepisy z Inspiracji (np. "owsianka")
    const res = searchProducts(q, withRecipes ? pool.concat(INSPIRATIONS.map((x) => x.product)) : pool);
    const isCode = /^\d{8,14}$/.test(q);
    html = res.length ? '<h4 class="list-title">Na telefonie</h4>' + productItems(res, 'pick') : '';
    html += `<h4 class="list-title">Open Food Facts</h4>
      <div id="off-res">${offCache[offKey(q)] ? offResultsHtml(offCache[offKey(q)], 'picker') : `
        <button class="btn secondary block" data-action="off-search" data-where="picker">${isCode ? `Szukaj kodu ${esc(q)}` : `Szukaj „${esc(q)}” w Open Food Facts`}</button>
        <p class="hint">${res.length ? 'Nie ma tego, czego szukasz?' : 'Nie ma tego produktu na telefonie.'} Przeszukam bazę produktów ze sklepów (wymaga internetu).</p>`}
      </div>`;
  }
  $('#pk-list').innerHTML = html;
}

// --- Wyszukiwanie po nazwie w Open Food Facts ---
const offCache = {};     // wyniki wyszukiwań w tej sesji: { zapytanie: [produkty] }
let offSearchTimes = []; // pilnujemy limitu ok. 10 wyszukiwań na minutę
const offKey = (q) => norm(q.trim()).replace(/\s+/g, ' ');

async function offSearchRequest(q, polandOnly) {
  const fields = 'code,product_name,product_name_pl,brands,quantity,nutriments,nutriscore_grade,nova_group';
  let url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=${fields}`;
  if (polandOnly) url += '&tagtype_0=countries&tag_contains_0=contains&tag_0=poland';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.products || []).filter((p) => p.code && (p.product_name_pl || p.product_name));
  } finally {
    clearTimeout(timer);
  }
}

// where: 'picker' (okno dodawania) albo 'products' (zakładka Produkty)
const offWhere = (where) => (where === 'products'
  ? { query: () => productsQuery, box: '#off-res-main' }
  : { query: () => pickerQuery, box: '#off-res' });

async function offSearch(where = 'picker') {
  const W = offWhere(where);
  const q = W.query().trim();
  if (!q) return;
  if (/^\d{8,14}$/.test(q)) return where === 'products' ? offOpenByCode(q, 'products') : lookupBarcode(q); // wpisano kod
  const now = Date.now();
  offSearchTimes = offSearchTimes.filter((t) => now - t < 60000);
  if (offSearchTimes.length >= 6) return toast('Za dużo wyszukiwań – poczekaj minutę');
  offSearchTimes.push(now);

  const box = $(W.box);
  if (!box) return;
  box.innerHTML = '<p class="empty"><span class="spinner"></span> Szukam w Open Food Facts… (to może potrwać kilka sekund)</p>';
  // Wynik pokazujemy tylko, jeśli użytkownik dalej patrzy na to samo wyszukiwanie
  const stillHere = () => $(W.box) && W.query().trim() === q;
  try {
    let list = await offSearchRequest(q, true);       // najpierw produkty sprzedawane w Polsce
    let world = false;
    if (!list.length) { list = await offSearchRequest(q, false); world = true; }
    // Produkty z kaloriami na górze
    list.sort((a, b) => (offKcal(b) != null) - (offKcal(a) != null));
    list.world = world;
    offCache[offKey(q)] = list;
    if (stillHere()) $(W.box).innerHTML = offResultsHtml(list, where);
  } catch (e) {
    if (!stillHere()) return;
    $(W.box).innerHTML = `<p class="hint">Baza chwilowo nie odpowiada – brak internetu albo zbyt wiele wyszukiwań w krótkim czasie (Open Food Facts wtedy na chwilę blokuje). Spróbuj za minutę albo zeskanuj kod.</p>
      <button class="btn secondary block" data-action="off-search" data-where="${where}">Spróbuj ponownie</button>`;
  }
}
function offKcal(p) {
  const n = p.nutriments || {};
  const v = Number(n['energy-kcal_100g']);
  if (n['energy-kcal_100g'] !== undefined && isFinite(v)) return v;
  const kj = Number(n['energy-kj_100g'] ?? n.energy_100g);
  return isFinite(kj) && kj > 0 ? kj / 4.184 : null;
}
function offResultsHtml(list, where) {
  if (!list.length) return '<p class="empty">Nic nie znaleziono. Spróbuj krótszej nazwy (np. sama marka i rodzaj produktu) albo zeskanuj kod.</p>';
  return (list.world ? '<p class="hint">Brak wyników z Polski – pokazuję produkty z innych krajów.</p>' : '') +
    '<ul class="list">' + list.map((p, i) => {
      const info = parseOff(p);
      const kcal = offKcal(p);
      const ns = /^[a-e]$/.test(p.nutriscore_grade || '') ? p.nutriscore_grade : null;
      return `<li data-action="off-pick" data-where="${where}" data-i="${i}">
        <div class="name">${ns ? `<span class="ns-mini ns-${ns}">${ns.toUpperCase()}</span>` : ''}${esc(info.name || 'Bez nazwy')}</div>
        <div class="meta">${kcal != null ? r0(kcal) + ' kcal (100 g)' : 'brak kalorii w bazie'}${p.quantity ? ' · ' + esc(p.quantity) : ''}</div>
      </li>`;
    }).join('') + '</ul>' +
    '<p class="tiny">Wyniki z Open Food Facts – bazy tworzonej przez użytkowników. Porównaj dane z etykietą.</p>';
}
async function offPick(i, where) {
  const list = offCache[offKey(offWhere(where).query())];
  const hit = list && list[i];
  if (hit) offOpenByCode(hit.code, where, hit);
}
const savedFromProducts = () => { closeSheet(); render(); toast('Zapisano produkt'); };
// Otwiera formularz produktu z danymi z Open Food Facts (z okna dodawania albo z zakładki Produkty)
async function offOpenByCode(code, where, hit) {
  const inPicker = where !== 'products';
  const back = inPicker ? backToPicker : null;
  const onSaved = inPicker ? amountFromPicker : savedFromProducts;
  const own = state.products.find((p) => p.barcode === code);
  if (own) {
    toast(`Masz już ten produkt: ${own.name}`);
    return inPicker ? amountFromPicker(own) : openProductForm({ product: own, onSaved });
  }
  showSheet('Pobieram dane…', '<p class="empty"><span class="spinner"></span> Pobieram szczegóły produktu…</p>', back);
  const gen = sheetGen;
  let full = null;
  let offline = false;
  try { full = await fetchOff(code); } catch (e) { offline = true; /* użyjemy danych z wyszukiwania */ }
  if (gen !== sheetGen) return;
  const product = full || hit;
  if (!product) {
    return openProductForm({
      product: null, prefill: { barcode: code }, back, onSaved,
      note: offline ? 'Nie udało się połączyć z bazą. Możesz przepisać wartości z etykiety.'
        : 'Tego produktu nie ma w bazie. Przepisz nazwę i wartości z etykiety – zapamiętam go pod tym kodem.',
    });
  }
  const info = parseOff(product);
  openProductForm({
    product: null,
    prefill: { ...info, barcode: code, health: healthFromOff(product) },
    note: info.complete
      ? 'Dane z Open Food Facts. Porównaj z etykietą i zapisz – produkt zostanie na telefonie na stałe.'
      : 'Produkt znaleziony, ale brakuje części wartości. Uzupełnij je z etykiety.',
    back,
    onSaved,
  });
}
const backToPicker = () => openPicker(pickerCtx, true);
const amountFromPicker = (prod) => openAmount({ product: prod, mode: pickerCtx.mode, meal: pickerCtx.meal, back: backToPicker });

// --- Skaner kodów kreskowych ---
// Dekoder: wbudowany w system BarcodeDetector (Android/Chrome), a gdy go nie ma (iPhone) –
// biblioteka barcode-detector oparta na ZXing C++ (WebAssembly), dużo dokładniejsza dla kodów EAN.
const DETECTOR_LIB = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.1.3/dist/iife/ponyfill.js';
// Suma kontrolna pliku – przeglądarka odrzuci go, jeśli ktoś podmieni zawartość na serwerze
const DETECTOR_SRI = 'sha384-aa4qYe4x2s0TIEu0/f2H2AQbfIS44LLRvCd1oZcvRVmpjd9nDrXHIhRtJPbGYs0A';
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
let scanStream = null;
let scanTimer = null;
let scanDone = false;
let torchOn = false;
let detectorPromise = null;

function loadScript(src, integrity, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Nie udało się pobrać czytnika kodów')); };
    document.head.appendChild(s);
  });
}
async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
          if (formats.includes('ean_13')) return new window.BarcodeDetector({ formats });
        } catch (e) { /* użyjemy biblioteki */ }
      }
      await loadScript(DETECTOR_LIB, DETECTOR_SRI, 'BarcodeDetectionAPI');
      const detector = new window.BarcodeDetectionAPI.BarcodeDetector({ formats: SCAN_FORMATS });
      // Pierwsze wywołanie pobiera moduł WebAssembly (ok. 330 KB) – robimy to od razu
      await detector.detect(new ImageData(2, 2)).catch(() => {});
      return detector;
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}
function stopScanner() {
  clearTimeout(scanTimer);
  scanTimer = null;
  torchOn = false;
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
}
// Suma kontrolna kodów EAN/UPC (cyfra kontrolna) – odrzuca błędne odczyty
function gtinValid(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
async function getCamera() {
  const attempts = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr;
  for (const c of attempts) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch (e) {
      lastErr = e;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; // brak zgody – kolejne próby nic nie dadzą
    }
  }
  throw lastErr;
}
function cameraErrorMessage(e) {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return isIOS
        ? 'Brak zgody na aparat. Otwórz Ustawienia → Safari → Aparat i wybierz „Pytaj” lub „Zezwalaj”, potem spróbuj ponownie.'
        : 'Brak zgody na aparat. W Chrome: stuknij ikonę obok adresu (lub ⋮ → Ustawienia → Ustawienia witryn → Aparat) i zezwól tej stronie. Sprawdź też Ustawienia Androida → Aplikacje → Chrome → Uprawnienia → Aparat.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nie znaleziono aparatu w tym urządzeniu.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Aparat jest zajęty przez inną aplikację. Zamknij ją i spróbuj ponownie.';
    default:
      return `Nie mogę uruchomić aparatu (${(e && e.name) || 'nieznany błąd'}).`;
  }
}
async function openScanner() {
  showSheet('Skanuj kod', `
    <div id="reader" class="reader">
      <video id="scan-video" playsinline muted autoplay></video>
      <div class="scan-frame"><span class="scan-line"></span></div>
      <button class="torch-btn" id="torch" data-action="torch" hidden>Latarka</button>
    </div>
    <div id="cam-panel" hidden></div>
    <p class="hint center" id="scan-status">Uruchamiam aparat…</p>
    <div class="weight-row">
      <input id="bc-in" inputmode="numeric" placeholder="…albo wpisz kod ręcznie" autocomplete="off">
      <button class="btn primary small" data-action="bc-search">Szukaj</button>
    </div>
    <p class="hint">Trzymaj telefon ok. 15–20 cm od kodu, kod poziomo w ramce, w dobrym świetle. Dane produktów pochodzą z darmowej bazy Open Food Facts.</p>`,
  backToPicker);
  $('#bc-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBarcode($('#bc-in').value); });
  scanDone = false;
  const gen = sheetGen;
  const alive = () => gen === sheetGen;

  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#reader').hidden = true;
    $('#scan-status').textContent = 'Ta przeglądarka nie daje dostępu do aparatu (np. przeglądarka wbudowana w Messengera lub Facebooka). Otwórz aplikację w Safari (iPhone) lub Chrome (Android) albo wpisz kod ręcznie.';
    return;
  }

  // Czytnik kodów pobieramy od razu w tle
  getDetector().catch(() => {});

  // Sprawdź, czy przeglądarka już ma zgodę na aparat
  const perm = await cameraPermission();
  if (!alive()) return;
  if (perm) {
    // Gdy użytkownik zmieni zgodę w ustawieniach i wróci – spróbuj automatycznie
    perm.onchange = () => { if (alive() && !scanStream && perm.state !== 'denied') openScanner(); };
  }
  const state = perm ? perm.state : null;
  if (state === 'denied') return showCameraPanel('denied');
  // Na Androidzie (i innych) najpierw nasze wyjaśnienie, potem systemowe okienko przeglądarki.
  // Na iPhonie Safari pyta przy każdym uruchomieniu aplikacji, więc nie dokładamy dodatkowego kroku.
  if (state === 'prompt' && !isIOS()) return showCameraPanel('ask');
  startCamera(gen);
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function cameraPermission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return null;
    return await navigator.permissions.query({ name: 'camera' });
  } catch (e) { return null; } // np. starsze przeglądarki nie znają nazwy "camera"
}
// Panel zamiast podglądu aparatu: 'ask' = prośba o zgodę, 'denied' = instrukcja odblokowania
function showCameraPanel(kind) {
  const panel = $('#cam-panel');
  if (!panel) return;
  $('#reader').hidden = true;
  $('#scan-status').textContent = '';
  panel.hidden = false;
  if (kind === 'ask') {
    panel.innerHTML = `<div class="cam-ask">
      <div class="cam-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg></div>
      <h4>Potrzebny dostęp do aparatu</h4>
      <p>Aparat służy tylko do odczytania kodu kreskowego. Obraz jest analizowany w telefonie – nigdzie go nie wysyłamy ani nie zapisujemy.</p>
      <p class="hint">Po stuknięciu przycisku przeglądarka zapyta o zgodę. Wybierz <b>„Zezwól”</b> (lub „Podczas korzystania z aplikacji”).</p>
      <button class="btn primary block" data-action="cam-allow">Zezwól na aparat</button>
    </div>`;
  } else {
    const host = location.host;
    const steps = isIOS()
      ? `<li>Otwórz <b>Ustawienia</b> iPhone'a → <b>Safari</b> → <b>Aparat</b>.</li>
         <li>Wybierz <b>„Pytaj”</b> albo <b>„Zezwalaj”</b>.</li>
         <li>Wróć tutaj i stuknij „Sprawdź ponownie”.</li>`
      : `<li>W Chrome stuknij ikonę <b>obok adresu strony</b> (ⓘ lub suwaki) → <b>Uprawnienia</b> → <b>Aparat</b> → <b>Zezwalaj</b>.</li>
         <li>Jeśli otwierasz aplikację z ikony na ekranie (bez paska adresu): otwórz <b>Chrome</b> → <b>⋮</b> → <b>Ustawienia</b> → <b>Ustawienia witryn</b> → <b>Aparat</b> → znajdź <b>${esc(host)}</b> → <b>Zezwalaj</b>.</li>
         <li>Sprawdź też, czy sam Chrome ma dostęp: <b>Ustawienia telefonu</b> → <b>Aplikacje</b> → <b>Chrome</b> → <b>Uprawnienia</b> → <b>Aparat</b> → „Zezwalaj tylko podczas używania aplikacji”.</li>
         <li>Wróć tutaj i stuknij „Sprawdź ponownie”.</li>`;
    panel.innerHTML = `<div class="cam-ask denied">
      <div class="cam-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/><path d="M3 3l18 18"/></svg></div>
      <h4>Aparat jest zablokowany</h4>
      <p>Wcześniej odmówiono dostępu, więc przeglądarka nie zapyta ponownie sama. Odblokuj go w ustawieniach:</p>
      <ol>${steps}</ol>
      <button class="btn primary block" data-action="scan">Sprawdź ponownie</button>
    </div>`;
  }
}

async function startCamera(gen) {
  const alive = () => gen === sheetGen;
  const status = (msg, retry) => {
    if (!alive() || !$('#scan-status')) return;
    $('#scan-status').innerHTML = esc(msg) + (retry ? '<br><button class="btn secondary small" data-action="scan" style="margin-top:8px">Spróbuj ponownie</button>' : '');
  };
  if ($('#cam-panel')) $('#cam-panel').hidden = true;
  if ($('#reader')) $('#reader').hidden = false;
  status('Uruchamiam aparat…');

  const detectorReady = getDetector();
  detectorReady.catch(() => {});

  let stream;
  try {
    stream = await getCamera();
  } catch (e) {
    if (!alive()) return;
    // Odmowa w okienku przeglądarki – pokaż, jak odblokować
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return showCameraPanel('denied');
    if ($('#reader')) $('#reader').hidden = true;
    return status(cameraErrorMessage(e), true);
  }
  if (!alive()) { stream.getTracks().forEach((t) => t.stop()); return; }
  scanStream = stream;

  const video = $('#scan-video');
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* iOS czasem wymaga ponownego dotknięcia – autoplay + muted zwykle wystarcza */ }
  if ($('#reader')) $('#reader').classList.add('ready');

  const track = stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch && $('#torch')) $('#torch').hidden = false;
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch (e) { /* nie każdy aparat to obsługuje */ }

  status('Ładuję czytnik kodów…');
  let detector;
  try { detector = await detectorReady; } catch (e) {
    return status('Nie udało się pobrać czytnika kodów (brak internetu?). Wpisz kod ręcznie.', true);
  }
  if (!alive()) return;
  status('Skieruj aparat na kod kreskowy – poziomo, w ramce.');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let frame = 0;
  let lastInvalid = null;
  const tick = async () => {
    if (!alive() || scanDone) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const vw = video.videoWidth, vh = video.videoHeight;
      // Na zmianę: środkowy pas (szybciej, mniej zakłóceń) i cała klatka
      const crop = frame++ % 2 === 0;
      const cw = crop ? Math.round(vw * 0.9) : vw, ch = crop ? Math.round(vh * 0.5) : vh;
      canvas.width = cw; canvas.height = ch;
      ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
      try {
        const found = (await detector.detect(canvas)).map((b) => String(b.rawValue || '').trim()).filter((v) => /^\d{8,14}$/.test(v));
        // Kod z poprawną cyfrą kontrolną przyjmujemy od razu, inny – po dwóch identycznych odczytach z rzędu
        const code = found.find(gtinValid) || found.find((v) => v === lastInvalid);
        lastInvalid = found.find((v) => !gtinValid(v)) || null;
        if (code && alive() && !scanDone) {
          scanDone = true;
          if (navigator.vibrate) navigator.vibrate(60);
          stopScanner();
          lookupBarcode(code);
          return;
        }
      } catch (e) { /* pojedyncza klatka się nie udała – próbujemy dalej */ }
    }
    scanTimer = setTimeout(tick, 120);
  };
  tick();
}
async function toggleTorch() {
  const track = scanStream && scanStream.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
    torchOn = !torchOn;
    $('#torch').classList.toggle('on', torchOn);
  } catch (e) { toast('Latarka niedostępna'); }
}

const OFF_FIELDS = 'product_name,product_name_pl,brands,serving_quantity,product_quantity,nutriments,nutriscore_grade,nova_group,nutrient_levels,additives_tags,allergens_tags,ingredients_text_pl,ingredients_text';
// Zwraca produkt z Open Food Facts albo null, gdy go nie ma. Rzuca wyjątek przy braku internetu.
async function fetchOff(code) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    return data && data.status === 1 && data.product ? data.product : null;
  } finally {
    clearTimeout(timer);
  }
}

function parseOff(p) {
  const n = p.nutriments || {};
  const get = (k) => { const v = Number(n[k]); return n[k] !== undefined && n[k] !== '' && isFinite(v) && v >= 0 ? v : null; };
  let kcal = get('energy-kcal_100g');
  if (kcal == null) { const kj = get('energy-kj_100g') ?? get('energy_100g'); if (kj != null) kcal = kj / 4.184; }
  const vals = { kcal, p: get('proteins_100g'), f: get('fat_100g'), c: get('carbohydrates_100g') };
  let name = (p.product_name_pl || p.product_name || '').trim();
  const brand = (p.brands || '').split(',')[0].trim();
  const brandWord = norm(brand.split(/\s+/)[0] || '');
  if (brand && !(brandWord && norm(name).includes(brandWord))) name = name ? `${name} – ${brand}` : brand;
  const out = { name };
  for (const k in vals) out[k] = vals[k] == null ? '' : String(r1(vals[k])).replace('.', ',');
  out.complete = Object.values(vals).every((v) => v != null);
  // Porcje z etykiety: porcja producenta i całe opakowanie
  out.portions = [];
  const sq = Number(p.serving_quantity), pq = Number(p.product_quantity);
  if (isFinite(sq) && sq > 0 && sq <= 2000) out.portions.push({ label: 'porcja', g: r1(sq) });
  if (isFinite(pq) && pq > 0 && pq <= 3000 && !(Math.abs(pq - sq) < 1)) out.portions.push({ label: 'opakowanie', g: r1(pq) });
  return out;
}

async function lookupBarcode(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) { scanDone = false; return toast('Kod kreskowy ma zwykle 8 lub 13 cyfr'); }

  // 1) Produkt już zapisany pod tym kodem – od razu do wpisania wagi
  const own = state.products.find((p) => p.barcode === code);
  if (own) { toast(`Rozpoznano: ${own.name}`); return amountFromPicker(own); }

  // 2) Szukamy w Open Food Facts
  showSheet('Szukam produktu…', `<p class="empty">Szukam kodu <b>${code}</b> w bazie Open Food Facts…</p>`, backToPicker);
  const gen = sheetGen;
  let prefill = { barcode: code };
  let note;
  try {
    const product = await fetchOff(code);
    if (gen !== sheetGen) return;
    if (product) {
      const info = parseOff(product);
      prefill = { ...info, barcode: code, health: healthFromOff(product) };
      note = info.complete
        ? 'Znaleziono w Open Food Facts. Porównaj wartości z etykietą i zapisz – następnym razem rozpoznam ten kod od razu.'
        : 'Znaleziono produkt, ale brakuje części wartości. Uzupełnij je z etykiety.';
    } else {
      note = 'Tego produktu nie ma w bazie. Przepisz nazwę i wartości z etykiety – zapamiętam go pod tym kodem.';
    }
  } catch (e) {
    if (gen !== sheetGen) return;
    note = 'Nie udało się połączyć z bazą (brak internetu?). Możesz przepisać wartości z etykiety.';
  }
  openProductForm({ product: null, prefill, note, back: backToPicker, onSaved: amountFromPicker });
}

// --- Waga porcji ---
// amountCtx: { product | entry, mode: 'diary' | 'ingredient', meal?, back? }
let amountCtx = null;
function openAmount(ctx) {
  amountCtx = ctx;
  const ing = ctx.mode === 'ingredient';
  const src = ctx.entry || ctx.product;
  const live = ctx.product || (ctx.entry && findProduct(ctx.entry.productId));
  const portions = productPortions(live);
  const portion = portions.length ? portions[0].g : 0;
  const health = !ing || ctx.product ? productHealth(live) : null;
  const grams = ctx.entry ? ctx.entry.grams : (state.lastGrams[ctx.product.id] || portion || 100);
  const meal = ctx.entry ? ctx.entry.meal : ctx.meal;
  const chips = [25, 50, 100, 150, 200, 250, 300].map((v) => `<button class="chip" data-action="chip" data-g="${v}">${v} g</button>`).join('');
  // Przyciski porcji: główna porcja ×1, ×2, ×3 (przepis: ½, 1, 2) + pozostałe porcje
  let portionChips = '';
  if (portions.length) {
    const [main, ...rest] = portions;
    const mults = live.recipe ? [0.5, 1, 2] : [1, 2, 3];
    portionChips = '<div class="chips">' +
      mults.map((m) => `<button class="chip accent" data-action="chip" data-g="${r1(main.g * m)}">${m === 0.5 ? '½' : m === 1 ? '1' : m + '×'} ${esc(main.label)} · ${fmt1(main.g * m)} g</button>`).join('') +
      rest.map((x) => `<button class="chip accent" data-action="chip" data-g="${x.g}">1 ${esc(x.label)} · ${fmt1(x.g)} g</button>`).join('') +
      '</div>';
  }
  const title = ing ? (ctx.entry ? 'Edytuj składnik' : 'Ile w przepisie?') : (ctx.entry ? 'Edytuj wpis' : 'Ile zjadłeś?');
  showSheet(title, `
    <div class="amount-head">
      <div class="name">${esc(src.name)}</div>
      <div class="meta">Na 100 g: ${r0(src.kcal)} kcal · B ${fmt1(src.p)} · T ${fmt1(src.f)} · W ${fmt1(src.c)}</div>
      ${healthBadges(health)}
      ${health && (health.ns || health.ingredients || (health.additives && health.additives.length)) ? `<details class="hdetails"><summary>Szczegóły oceny</summary>${healthCard(health, false)}</details>` : ''}
    </div>
    <label class="field"><span>Waga (g)</span><input id="am-g" class="big-input" inputmode="decimal" value="${grams}"></label>
    ${portionChips}
    <div class="chips">${chips}</div>
    <div class="result" id="am-res"></div>
    ${ing ? '' : `<label class="field"><span>Posiłek</span>
      <select id="am-meal">${MEALS.map((m) => `<option value="${m.id}"${m.id === meal ? ' selected' : ''}>${m.name}</option>`).join('')}</select></label>`}
    <button class="btn primary block" data-action="amount-save">${ctx.entry ? 'Zapisz' : ing ? 'Dodaj składnik' : 'Dodaj'}</button>
    ${ctx.entry ? `<button class="btn danger block" data-action="amount-delete">${ing ? 'Usuń składnik' : 'Usuń z dziennika'}</button>` : ''}`,
  ctx.back);
  const input = $('#am-g');
  input.addEventListener('input', updateAmount);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') amountSave(); });
  input.addEventListener('focus', () => input.select());
  updateAmount();
}
function updateAmount() {
  const src = amountCtx.entry || amountCtx.product;
  const g = num($('#am-g').value);
  const v = g > 0 ? calc(src, g) : null;
  const cell = (cls, val, label, dec) => `<div class="${cls}"><b>${v ? (dec ? fmt1(val) : r0(val)) : '–'}</b><span>${label}</span></div>`;
  $('#am-res').innerHTML = cell('k', v && v.kcal, 'kcal') + cell('p', v && v.p, 'białko', 1) + cell('f', v && v.f, 'tłuszcze', 1) + cell('c', v && v.c, 'węglow.', 1);
}
function snapshot(p, grams, extra) {
  return { id: uid(), productId: p.id, name: p.name, grams, kcal: p.kcal, p: p.p, f: p.f, c: p.c, ...extra };
}
function amountSave() {
  const g = num($('#am-g').value);
  if (!(g > 0 && g <= 5000)) return toast('Wpisz wagę w gramach');
  const grams = r1(g);

  if (amountCtx.mode === 'ingredient') {
    if (amountCtx.entry) amountCtx.entry.grams = grams;
    else recipeDraft.items.push(snapshot(amountCtx.product, grams));
    renderRecipeEditor();
    return;
  }

  const meal = $('#am-meal').value;
  if (amountCtx.entry) {
    amountCtx.entry.grams = grams;
    amountCtx.entry.meal = meal;
    toast('Zapisano');
  } else {
    const p = amountCtx.product;
    if (!state.diary[currentDay]) state.diary[currentDay] = [];
    state.diary[currentDay].push(snapshot(p, grams, { meal }));
    state.recent = [p.id, ...state.recent.filter((x) => x !== p.id)].slice(0, 15);
    state.lastGrams[p.id] = grams;
    toast(`Dodano: ${p.name}`);
  }
  save();
  closeSheet();
  render();
}
function amountDelete() {
  if (amountCtx.mode === 'ingredient') {
    recipeDraft.items = recipeDraft.items.filter((it) => it !== amountCtx.entry);
    renderRecipeEditor();
    return;
  }
  deleteEntryWithUndo(amountCtx.entry);
}
function deleteEntryWithUndo(entry) {
  const day = currentDay;
  const index = dayEntries(day).indexOf(entry);
  const list = dayEntries(day).filter((e) => e !== entry);
  if (list.length) state.diary[day] = list; else delete state.diary[day];
  save();
  closeSheet();
  render();
  toast('Usunięto wpis', {
    label: 'Cofnij',
    fn: () => {
      if (!state.diary[day]) state.diary[day] = [];
      state.diary[day].splice(Math.min(index, state.diary[day].length), 0, entry);
      save();
      render();
      toast('Przywrócono wpis');
    },
  });
}
function editEntry(id) {
  const entry = dayEntries(currentDay).find((e) => e.id === id);
  if (!entry) return;
  if (entry.quick) openQuick({ entry });
  else openAmount({ entry, mode: 'diary' });
}

// --- Szybkie dodanie (same kalorie, bez produktu) ---
let quickCtx = null;
function openQuick(ctx) {
  quickCtx = ctx;
  const e = ctx.entry;
  const meal = e ? e.meal : ctx.meal;
  const v = (k) => (e ? String(r1(e[k])).replace('.', ',') : '');
  showSheet(e ? 'Edytuj szybki wpis' : 'Szybkie dodanie', `
    <p class="hint">Gdy nie znasz składu ani wagi – np. obiad w restauracji. Wystarczą same kalorie.</p>
    <label class="field"><span>Nazwa (opcjonalnie)</span><input id="qa-name" type="text" autocomplete="off" placeholder="np. Obiad w restauracji" value="${e ? esc(e.name) : ''}"></label>
    <label class="field"><span>Kalorie (kcal)</span><input id="qa-kcal" class="big-input" inputmode="decimal" value="${v('kcal')}"></label>
    <p class="hint">Makroskładniki (g) – opcjonalnie:</p>
    <div class="grid3">
      <label class="field"><span>Białko</span><input id="qa-p" inputmode="decimal" value="${v('p')}"></label>
      <label class="field"><span>Tłuszcze</span><input id="qa-f" inputmode="decimal" value="${v('f')}"></label>
      <label class="field"><span>Węglow.</span><input id="qa-c" inputmode="decimal" value="${v('c')}"></label>
    </div>
    <label class="field"><span>Posiłek</span>
      <select id="qa-meal">${MEALS.map((m) => `<option value="${m.id}"${m.id === meal ? ' selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <button class="btn primary block" data-action="quick-save">${e ? 'Zapisz' : 'Dodaj'}</button>
    ${e ? '<button class="btn danger block" data-action="quick-delete">Usuń z dziennika</button>' : ''}`,
  ctx.back);
}
function quickSave() {
  const kcal = num($('#qa-kcal').value);
  if (!(kcal > 0 && kcal <= 10000)) return toast('Wpisz kalorie (1–10000)');
  const opt = (id) => { const raw = $(id).value.trim(); return raw === '' ? 0 : num(raw); };
  const p = opt('#qa-p'), f = opt('#qa-f'), c = opt('#qa-c');
  if (![p, f, c].every((x) => x >= 0 && x <= 1000)) return toast('Makroskładniki: liczby od 0 do 1000 g');
  const data = {
    name: $('#qa-name').value.trim().slice(0, 200) || 'Szybkie dodanie',
    meal: $('#qa-meal').value, kcal: r1(kcal), p: r1(p), f: r1(f), c: r1(c),
  };
  if (quickCtx.entry) {
    Object.assign(quickCtx.entry, data);
  } else {
    if (!state.diary[currentDay]) state.diary[currentDay] = [];
    // grams = 100, więc wartości "na 100 g" są po prostu wartościami całego wpisu
    state.diary[currentDay].push({ id: uid(), quick: true, productId: 'quick', grams: 100, ...data });
  }
  save();
  closeSheet();
  render();
  toast(quickCtx.entry ? 'Zapisano' : `Dodano: ${data.name}`);
}

// --- Przepisy ---
let recipeDraft = null;
let recipeOriginal = ''; // stan przepisu przy otwarciu – do wykrycia niezapisanych zmian
function openRecipeEditor(recipe) {
  recipeDraft = recipe
    ? JSON.parse(JSON.stringify(recipe))
    : { id: null, name: '', items: [], cookedWeight: null, portions: 1 };
  recipeOriginal = JSON.stringify(recipeDraft);
  renderRecipeEditor();
}
function recipeDirty() {
  return !!recipeDraft && JSON.stringify(recipeDraft) !== recipeOriginal;
}
// Zamknięcie okna przez użytkownika ("Zamknij" albo tapnięcie w tło)
function requestCloseSheet() {
  if (recipeDirty() && !confirm('Masz niezapisane zmiany w przepisie. Zamknąć bez zapisywania?')) return;
  closeSheet();
}
function renderRecipeEditor() {
  const d = recipeDraft;
  const s = recipeStats(d);
  showSheet(d.id ? 'Edytuj przepis' : 'Nowy przepis', `
    <label class="field"><span>Nazwa dania</span><input id="rc-name" type="text" autocomplete="off" placeholder="np. Owsianka z bananem" value="${esc(d.name)}"></label>
    <h4 class="list-title">Składniki (${d.items.length})</h4>
    ${d.items.length ? '<ul class="list">' + d.items.map((it, i) => {
      const v = calc(it, it.grams);
      return `<li class="row" data-action="ing-edit" data-i="${i}">
        <div><div class="name">${esc(it.name)}</div><div class="meta">${fmt1(it.grams)} g</div></div>
        <div class="kcal">${r0(v.kcal)} kcal</div></li>`;
    }).join('') + '</ul>' : '<p class="hint">Dodaj produkty, z których robisz to danie, z ich wagą przed gotowaniem.</p>'}
    <button class="btn secondary block" data-action="ing-add">+ Dodaj składnik</button>
    <div class="grid2" style="margin-top:14px">
      <label class="field"><span>Waga gotowego dania (g)</span><input id="rc-weight" inputmode="decimal" placeholder="${r0(s.rawWeight) || 'opcjonalnie'}" value="${d.cookedWeight ?? ''}"></label>
      <label class="field"><span>Liczba porcji</span><input id="rc-portions" inputmode="numeric" value="${d.portions ?? 1}"></label>
    </div>
    <p class="hint">Gotowanie zmienia wagę (makaron nabiera wody, mięso traci). Jeśli zważysz gotowe danie, wpisz jego wagę – wtedy wartości na 100 g będą dokładne. Puste pole = suma wag składników.</p>
    <div class="recipe-sum" id="rc-sum"></div>
    <button class="btn primary block" data-action="recipe-save">Zapisz przepis</button>
    ${d.id ? '<button class="btn danger block" data-action="recipe-delete">Usuń przepis</button>' : ''}`);
  $('#rc-name').addEventListener('input', (e) => { d.name = e.target.value; });
  $('#rc-weight').addEventListener('input', (e) => { const v = num(e.target.value); d.cookedWeight = v > 0 ? v : null; updateRecipeSum(); });
  $('#rc-portions').addEventListener('input', (e) => { const v = num(e.target.value); d.portions = v >= 1 ? Math.round(v) : 1; updateRecipeSum(); });
  updateRecipeSum();
}
function updateRecipeSum() {
  const s = recipeStats(recipeDraft);
  if (!recipeDraft.items.length) { $('#rc-sum').innerHTML = ''; return; }
  const row = (label, v, k) => `<div class="kv"><span>${label}</span><b>${r0(v.kcal * k)} kcal</b><small>B ${fmt1(v.p * k)} · T ${fmt1(v.f * k)} · W ${fmt1(v.c * k)}</small></div>`;
  const h = recipeHealth(recipeDraft);
  $('#rc-sum').innerHTML =
    row(`Całe danie (${r0(s.weight)} g)`, s.tot, 1) +
    row('Na 100 g', s.per100, 1) +
    (s.portions > 1 ? row(`1 porcja (${r0(s.portionGrams)} g)`, s.tot, 1 / s.portions) : '') +
    (h ? `<div class="recipe-health"><span class="muted">Ocena ze składników:</span>${healthBadges(h)}</div>` : '');
}
function recipeSave() {
  const d = recipeDraft;
  d.name = d.name.trim();
  if (!d.name) return toast('Podaj nazwę dania');
  if (!d.items.length) return toast('Dodaj przynajmniej jeden składnik');
  if (d.id) {
    const i = state.recipes.findIndex((r) => r.id === d.id);
    if (i >= 0) state.recipes[i] = d; else state.recipes.push(d);
  } else {
    d.id = uid();
    state.recipes.push(d);
  }
  save();
  closeSheet();
  render();
  toast('Zapisano przepis');
}
function recipeDelete() {
  const d = recipeDraft;
  if (!confirm(`Usunąć przepis „${d.name}”? Wpisy w dzienniku zostaną.`)) return;
  state.recipes = state.recipes.filter((r) => r.id !== d.id);
  state.recent = state.recent.filter((id) => id !== 'r:' + d.id);
  delete state.lastGrams['r:' + d.id];
  save();
  closeSheet();
  render();
  toast('Usunięto przepis');
}

// --- Formularz produktu ---
let pfCtx = null;
function openProductForm(ctx) {
  pfCtx = ctx;
  const p = ctx.product;
  const own = p && !p.builtin;
  const pre = ctx.prefill || {};
  const ov = ctx.override || {}; // wartości wpisane w formularzu przed odświeżeniem oceny
  const val = (k) => (k in ov ? ov[k] : p ? p[k] : pre[k]);
  const title = !p ? 'Nowy produkt' : own ? 'Edytuj produkt' : 'Produkt';
  if (!('health' in ctx)) ctx.health = p ? productHealth(p) : (pre.health || null);
  const barcodeNow = val('barcode');
  const portionsNow = 'portions' in ov ? ov.portions : p ? productPortions(p) : (pre.portions || []);
  const field = (id, label, value, mode = 'decimal') =>
    `<label class="field"><span>${label}</span><input id="${id}" inputmode="${mode}" value="${esc(value ?? '')}"></label>`;
  showSheet(title, `
    ${p && p.builtin ? '<p class="note">To produkt wbudowany. Zapisanie utworzy Twoją własną kopię, którą możesz zmieniać.</p>' : ''}
    ${ctx.note ? `<p class="note">${esc(ctx.note)}</p>` : ''}
    ${healthCard(ctx.health)}
    <label class="field"><span>Nazwa</span><input id="pf-name" type="text" autocomplete="off" value="${esc('name' in ov ? ov.name : p ? p.name : (pre.name || ctx.prefillName || ''))}"></label>
    <p class="hint">Wartości na 100 g (przepisz z etykiety)</p>
    <div class="grid2">
      ${field('pf-kcal', 'Kalorie (kcal)', val('kcal'))}
      ${field('pf-p', 'Białko (g)', val('p'))}
      ${field('pf-f', 'Tłuszcze (g)', val('f'))}
      ${field('pf-c', 'Węglowodany (g)', val('c'))}
    </div>
    <p class="hint">Kalorie możesz zostawić puste – policzę je z makroskładników.</p>
    <h4 class="list-title">Porcje (opcjonalnie)</h4>
    <p class="hint">Np. „kromka” = 30 g albo „opakowanie” = 150 g – potem wystarczy jedno tapnięcie zamiast ważenia.</p>
    ${[0, 1].map((i) => {
      const pr = portionsNow[i] || {};
      return `<div class="portion-row">
        <input id="pf-pl${i}" type="text" autocomplete="off" placeholder="${i ? 'np. opakowanie' : 'np. sztuka'}" value="${esc(pr.label || '')}">
        <input id="pf-pg${i}" inputmode="decimal" placeholder="gramy" value="${pr.g != null ? esc(String(pr.g).replace('.', ',')) : ''}">
        <span>g</span>
      </div>`;
    }).join('')}
    ${field('pf-bc', 'Kod kreskowy (opcjonalnie)', barcodeNow, 'numeric')}
    ${barcodeNow && !(ctx.health && ctx.health.src === 'off') ? '<button class="btn secondary block" data-action="pf-refresh">Pobierz ocenę zdrowotną z bazy</button>' : ''}
    <button class="btn primary block" data-action="pf-save">${own || !p ? 'Zapisz' : 'Zapisz jako mój'}</button>
    ${own ? '<button class="btn danger block" data-action="pf-delete">Usuń produkt</button>' : ''}`,
  ctx.back);
}
function productFormSave() {
  const name = $('#pf-name').value.trim();
  if (!name) return toast('Podaj nazwę produktu');
  const read = (id) => { const raw = $(id).value; return raw.trim() === '' ? 0 : num(raw); };
  const p = read('#pf-p'), f = read('#pf-f'), c = read('#pf-c');
  if (![p, f, c].every((x) => x >= 0 && x <= 100)) return toast('Makroskładniki: liczby od 0 do 100');
  if (p + f + c > 101) return toast('Suma makroskładników przekracza 100 g');
  const kcalRaw = $('#pf-kcal').value.trim();
  const kcal = kcalRaw === '' ? p * 4 + f * 9 + c * 4 : num(kcalRaw);
  if (!(kcal >= 0 && kcal <= 950)) return toast('Kalorie: liczba od 0 do 950');
  if (kcalRaw === '' && kcal === 0) return toast('Wpisz kalorie albo makroskładniki');
  const barcode = $('#pf-bc').value.replace(/\D/g, '');
  const portions = readPortionRows();
  if (portions === null) return toast('Porcja: wpisz nazwę i wagę od 1 do 5000 g');
  const data = { name, kcal: r1(kcal), p: r1(p), f: r1(f), c: r1(c), barcode: barcode || undefined, portions: portions.length ? portions : undefined };
  // Ocenę z bazy zapisujemy przy produkcie (wbudowane mają tylko NOVA wyliczane w locie)
  if (pfCtx.health) data.health = pfCtx.health;

  let prod;
  if (pfCtx.product && !pfCtx.product.builtin) {
    prod = Object.assign(pfCtx.product, data);
  } else {
    prod = { id: 'c:' + uid(), ...data };
    state.products.push(prod);
  }
  save();
  pfCtx.onSaved(prod);
}
// Odczyt porcji z formularza; null = błędnie wypełniony wiersz
function readPortionRows() {
  const out = [];
  for (const i of [0, 1]) {
    const label = $('#pf-pl' + i).value.trim().slice(0, 40);
    const rawG = $('#pf-pg' + i).value.trim();
    if (!label && !rawG) continue;
    const g = num(rawG);
    if (!label || !(g >= 1 && g <= 5000)) return null;
    out.push({ label, g: r1(g) });
  }
  return out;
}
async function productFormRefresh() {
  const code = $('#pf-bc').value.replace(/\D/g, '');
  if (code.length < 8) return toast('Wpisz poprawny kod kreskowy');
  // Zapamiętaj to, co już wpisano w formularzu
  pfCtx.override = {
    name: $('#pf-name').value, kcal: $('#pf-kcal').value, p: $('#pf-p').value,
    f: $('#pf-f').value, c: $('#pf-c').value, barcode: code,
    portions: readPortionRows() || [],
  };
  const ctx = pfCtx;
  const gen = sheetGen;
  toast('Szukam w bazie…');
  try {
    const product = await fetchOff(code);
    if (gen !== sheetGen) return;
    const h = product ? healthFromOff(product) : null;
    if (!h) return toast('Brak oceny dla tego kodu w bazie');
    ctx.health = h;
    openProductForm(ctx);
    toast('Pobrano ocenę – zapisz produkt, żeby ją zachować');
  } catch (e) {
    if (gen === sheetGen) toast('Brak połączenia z internetem');
  }
}
function productFormDelete() {
  const p = pfCtx.product;
  if (!confirm(`Usunąć produkt „${p.name}”? Wpisy w dzienniku i przepisach zostaną.`)) return;
  state.products = state.products.filter((x) => x !== p);
  state.recent = state.recent.filter((id) => id !== p.id);
  delete state.lastGrams[p.id];
  save();
  closeSheet();
  render();
  toast('Usunięto produkt');
}

// ===== Kopia zapasowa =====
async function exportData() {
  const json = JSON.stringify(state, null, 2);
  const name = `kalorie-kopia-${todayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const done = () => {
    state.lastBackup = Date.now();
    state.backupSnooze = null;
    save();
    render();
    toast('Kopia zapasowa gotowa');
  };
  if (navigator.maxTouchPoints > 0 && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Kopia – Kalorie' }); return done(); }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  done();
}
// Odbudowuje dane z pliku kopii, przepuszczając tylko znane pola o poprawnych wartościach.
// Chroni przed uszkodzonym lub spreparowanym plikiem.
function sanitizeImported(d) {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const n = (v, min, max, def) => { const x = Number(v); return v !== null && v !== '' && isFinite(x) && x >= min && x <= max ? x : def; };
  const s = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const isDate = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);
  const cleanId = (v) => { const x = s(v, 300); return x || null; };

  const cleanHealth = (h) => {
    if (!isObj(h)) return undefined;
    const o = {};
    if (h.src === 'off') o.src = 'off';
    if (/^[a-e]$/.test(h.ns)) o.ns = h.ns;
    if ([1, 2, 3, 4].includes(h.nova)) o.nova = h.nova;
    for (const k of ['fatTotal', 'satfat', 'sugars', 'salt', 'fiber']) { const v = n(h[k], 0, 100, null); if (v != null) o[k] = v; }
    if (isObj(h.offLevels)) {
      o.offLevels = {};
      for (const k of ['fat', 'saturated-fat', 'sugars', 'salt']) if (['low', 'moderate', 'high'].includes(h.offLevels[k])) o.offLevels[k] = h.offLevels[k];
    }
    o.additives = Array.isArray(h.additives) ? h.additives.filter((a) => typeof a === 'string' && /^E\d{3,4}[a-z]*$/i.test(a)).slice(0, 80) : [];
    o.allergens = Array.isArray(h.allergens) ? h.allergens.filter((a) => typeof a === 'string').map((a) => a.slice(0, 40)).slice(0, 30) : [];
    if (typeof h.ingredients === 'string' && h.ingredients.trim()) o.ingredients = h.ingredients.slice(0, 2000);
    return hasHealth(o) ? o : undefined;
  };
  const cleanItem = (e, withMeal) => {
    if (!isObj(e)) return null;
    const quick = withMeal && e.quick === true; // szybki wpis: wartości całego wpisu, grams = 100
    const grams = quick ? 100 : n(e.grams, 0.1, 5000, null);
    if (grams == null) return null;
    const kMax = quick ? 10000 : 950, mMax = quick ? 1000 : 100;
    const it = {
      id: cleanId(e.id) || uid(), productId: s(e.productId, 300), name: s(e.name) || 'Bez nazwy', grams,
      kcal: n(e.kcal, 0, kMax, 0), p: n(e.p, 0, mMax, 0), f: n(e.f, 0, mMax, 0), c: n(e.c, 0, mMax, 0),
    };
    if (quick) it.quick = true;
    if (withMeal) it.meal = MEALS.some((m) => m.id === e.meal) ? e.meal : 'przekaski';
    return it;
  };

  const out = defaultState();
  if (isObj(d.profile)) {
    const p = d.profile;
    // Kopie ze starszych wersji mają starą skalę aktywności – przeliczamy
    const act = p.actScale === 2 ? Number(p.activity) : OLD_ACTIVITY[Number(p.activity)];
    const prof = {
      sex: p.sex === 'k' ? 'k' : 'm', age: n(p.age, 10, 100, null), weight: n(p.weight, 30, 300, null),
      height: n(p.height, 100, 250, null), activity: ACTIVITY.some(([v]) => v === act) ? act : 1.4,
      goal: goalKey(p.goal), actScale: 2,
    };
    if (prof.age && prof.weight && prof.height) out.profile = prof;
  }
  if (isObj(d.goals)) {
    const g = { kcal: n(d.goals.kcal, 500, 10000, null), p: n(d.goals.p, 0, 1000, null), f: n(d.goals.f, 0, 1000, null), c: n(d.goals.c, 0, 1000, null) };
    if (Object.values(g).every((v) => v != null)) out.goals = g;
  }
  out.goalsManual = d.goalsManual === true;
  out.goalsFromData = d.goalsFromData === true;
  out.products = (Array.isArray(d.products) ? d.products : []).filter(isObj).map((p) => {
    const id = cleanId(p.id);
    if (!id || !s(p.name)) return null;
    const prod = { id, name: s(p.name), kcal: n(p.kcal, 0, 950, 0), p: n(p.p, 0, 100, 0), f: n(p.f, 0, 100, 0), c: n(p.c, 0, 100, 0) };
    const bc = s(p.barcode, 20).replace(/\D/g, '');
    if (bc) prod.barcode = bc;
    const h = cleanHealth(p.health);
    if (h) prod.health = h;
    if (Array.isArray(p.portions)) {
      const pr = p.portions.filter(isObj).map((x) => ({ label: s(x.label, 40), g: n(x.g, 1, 5000, null) }))
        .filter((x) => x.label && x.g != null).slice(0, 4);
      if (pr.length) prod.portions = pr;
    }
    return prod;
  }).filter(Boolean);
  out.recipes = (Array.isArray(d.recipes) ? d.recipes : []).filter(isObj).map((r) => {
    const items = (Array.isArray(r.items) ? r.items : []).map((e) => cleanItem(e, false)).filter(Boolean);
    if (!s(r.name) || !items.length) return null;
    const rec = { id: cleanId(r.id) || uid(), name: s(r.name), items, cookedWeight: n(r.cookedWeight, 1, 50000, null), portions: Math.round(n(r.portions, 1, 100, 1)) };
    if (typeof r.fromIdea === 'string' && r.fromIdea) rec.fromIdea = r.fromIdea.slice(0, 60);
    return rec;
  }).filter(Boolean);
  if (isObj(d.diary)) {
    for (const [k, list] of Object.entries(d.diary)) {
      if (!isDate(k) || !Array.isArray(list)) continue;
      const items = list.map((e) => cleanItem(e, true)).filter(Boolean);
      if (items.length) out.diary[k] = items;
    }
  }
  if (isObj(d.weights)) {
    for (const [k, v] of Object.entries(d.weights)) { const kg = n(v, 20, 400, null); if (isDate(k) && kg != null) out.weights[k] = kg; }
  }
  if (isObj(d.water)) {
    for (const [k, v] of Object.entries(d.water)) { const ml = n(v, 1, 10000, null); if (isDate(k) && ml != null) out.water[k] = Math.round(ml); }
  }
  out.waterGoal = Math.round(n(d.waterGoal, 500, 6000, 2000));
  out.recent = (Array.isArray(d.recent) ? d.recent : []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 15);
  if (isObj(d.lastGrams)) {
    for (const [k, v] of Object.entries(d.lastGrams)) { const g = n(v, 0.1, 5000, null); if (g != null) out.lastGrams[k.slice(0, 300)] = g; }
  }
  out.createdAt = n(d.createdAt, 0, Date.now() + DAY_MS, Date.now());
  out.lastBackup = n(d.lastBackup, 0, Date.now() + DAY_MS, null);
  return out;
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try {
      d = JSON.parse(reader.result);
      if (!d || typeof d !== 'object' || typeof d.diary !== 'object' || !Array.isArray(d.products)) throw new Error();
    } catch (e) { return toast('To nie jest poprawny plik kopii'); }
    const clean = sanitizeImported(d);
    const days = Object.keys(clean.diary).length;
    if (!confirm(`Zastąpić obecne dane danymi z kopii?\n\nW kopii: ${days} dni dziennika, ${clean.products.length} własnych produktów, ${clean.recipes.length} przepisów.`)) return;
    state = clean;
    save();
    render();
    toast('Wczytano kopię');
  };
  reader.readAsText(file);
}
function resetAll() {
  if (!confirm('Usunąć wszystkie dane (dziennik, produkty, przepisy, wagę, profil)? Tego nie da się cofnąć.')) return;
  state = defaultState();
  save();
  currentDay = todayKey();
  render();
  toast('Dane usunięte');
}

// ===== Obsługa kliknięć =====
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'tab': setView(d.view); break;
    case 'day-prev': currentDay = addDays(currentDay, -1); render(); break;
    case 'day-next': currentDay = addDays(currentDay, 1); render(); break;
    case 'day-today': currentDay = todayKey(); render(); break;
    case 'add': openPicker({ mode: 'diary', meal: d.meal }); break;
    case 'edit-entry': editEntry(d.id); break;
    case 'sheet-close': requestCloseSheet(); break;
    case 'toast-action': {
      const a = toastAction;
      toastAction = null;
      $('#toast').classList.remove('show');
      if (a) a.fn();
      break;
    }
    case 'sheet-back': if (sheetBack) sheetBack(); break;

    case 'pick': {
      const product = findProduct(d.id);
      if (product) openAmount({ product, mode: pickerCtx.mode, meal: pickerCtx.meal, back: backToPicker });
      break;
    }
    case 'picker-new':
      openProductForm({
        product: null,
        prefillName: pickerQuery.trim(),
        back: backToPicker,
        onSaved: amountFromPicker,
      });
      break;
    case 'scan': openScanner(); break;
    case 'torch': toggleTorch(); break;
    case 'cam-allow': startCamera(sheetGen); break;
    case 'off-search': offSearch(d.where || 'picker'); break;
    case 'off-pick': offPick(Number(d.i), d.where || 'picker'); break;
    case 'bc-search': lookupBarcode($('#bc-in').value); break;
    case 'chip': $('#am-g').value = d.g; updateAmount(); break;
    case 'amount-save': amountSave(); break;
    case 'amount-delete': amountDelete(); break;

    case 'product-new':
    case 'product-open': {
      const product = d.action === 'product-open' ? findProduct(d.id) : null;
      if (product && product.recipe) {
        openRecipeEditor(state.recipes.find((r) => r.id === product.recipeId));
        break;
      }
      openProductForm({
        product,
        prefillName: d.action === 'product-new' ? productsQuery.trim() : '',
        onSaved: () => { closeSheet(); render(); toast('Zapisano produkt'); },
      });
      break;
    }
    case 'pf-save': productFormSave(); break;
    case 'pf-refresh': productFormRefresh(); break;
    case 'open-cal': openCalendarSheet(false, null); break;
    case 'copy-meal': openCalendarSheet(false, { type: 'copy', meal: d.meal, from: currentDay }); break;
    case 'copy-day': openCalendarSheet(false, { type: 'copy', meal: null, from: currentDay }); break;
    case 'repeat-meal': repeatMeal(d.meal); break;
    case 'idea-open': openIdea(d.id); break;
    case 'idea-portions': ideaCtx.portions = Number(d.n); updateIdeaButton(); break;
    case 'idea-add': ideaAdd(); break;
    case 'idea-save': ideaSave(); break;
    case 'suggest-meal': suggestMeal = d.meal; renderIdeas(); break;
    case 'ideas-meal': ideasMeal = d.meal; renderIdeas(); break;
    case 'ideas-filter':
      if (ideasFilters.has(d.f)) ideasFilters.delete(d.f); else ideasFilters.add(d.f);
      renderIdeas();
      break;
    case 'water-plus': waterChange(GLASS_ML); break;
    case 'water-minus': waterChange(-GLASS_ML); break;
    case 'water-goal-save': {
      const v = num($('#water-goal').value);
      if (!(v >= 500 && v <= 6000)) { toast('Cel wody: od 500 do 6000 ml'); break; }
      state.waterGoal = r0(v);
      save();
      render();
      toast(`Cel wody: ${fmtL(state.waterGoal)} l`);
      break;
    }
    case 'quick-add': openQuick({ meal: pickerCtx.meal, back: backToPicker }); break;
    case 'quick-save': quickSave(); break;
    case 'quick-delete': deleteEntryWithUndo(quickCtx.entry); break;
    case 'cal-prev': calMonth = monthShift(calMonth, -1); rerenderCalendar(); break;
    case 'cal-next': calMonth = monthShift(calMonth, 1); rerenderCalendar(); break;
    case 'cal-day':
    case 'cal-today':
      if (calPurpose && d.action === 'cal-day') { copyToDay(d.key); break; }
      currentDay = d.action === 'cal-today' ? todayKey() : d.key;
      closeSheet();
      setView('today');
      break;
    case 'backup-snooze': state.backupSnooze = Date.now(); save(); render(); break;
    case 'pf-delete': productFormDelete(); break;
    case 'filter': productsFilter = d.filter; renderProducts(); break;

    case 'recipe-new': openRecipeEditor(null); break;
    case 'ing-add': openPicker({ mode: 'ingredient' }); break;
    case 'ing-edit': openAmount({ entry: recipeDraft.items[Number(d.i)], mode: 'ingredient', back: renderRecipeEditor }); break;
    case 'recipe-save': recipeSave(); break;
    case 'recipe-delete': recipeDelete(); break;

    case 'range':
      historyRange = d.range === 'month' ? 'month' : Number(d.range);
      if (historyRange === 'month') calMonth = todayKey().slice(0, 7);
      renderHistory();
      break;
    case 'chart-bar': {
      const day = historyDays[Number(d.i)];
      selectMark(el.closest('svg'), d.i);
      $('#kc-cap').innerHTML = day.logged
        ? `<b>${shortDate(day.key)}:</b> ${r0(day.kcal)} kcal · B ${r0(day.p)} · T ${r0(day.f)} · W ${r0(day.c)} g`
        : `<b>${shortDate(day.key)}:</b> brak wpisów`;
      break;
    }
    case 'chart-weight': {
      const p = weightPoints[Number(d.i)];
      selectMark(el.closest('svg'), d.i);
      $('#w-cap').innerHTML = `<b>${shortDate(p.key)}:</b> ${fmt1(p.kg)} kg · średnia 7 dni ${fmt1(p.avg)} kg`;
      break;
    }
    case 'goto-day': currentDay = d.key; setView('today'); break;
    case 'weight-save': weightSave(); break;
    case 'weight-del':
      if (confirm(`Usunąć pomiar z ${shortDate(d.key)}?`)) { delete state.weights[d.key]; save(); render(); }
      break;

    case 'profile-save': profileSave(); break;
    case 'goals-save': goalsSave(); break;
    case 'adaptive-apply': adaptiveApply(); break;
    case 'export': exportData(); break;
    case 'import': $('#import-file').click(); break;
    case 'reset': resetAll(); break;
  }
});

// Po powrocie do aplikacji następnego dnia – przejdź na nowy "Dziś"
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayKey();
  if (t !== lastToday) {
    if (currentDay === lastToday) currentDay = t;
    lastToday = t;
    render();
  }
});

// ===== Start =====
render();
if (migrationNote) setTimeout(() => toast(migrationNote), 600);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Sprawdzaj aktualizacje także przy powrocie do aplikacji (na iPhonie bywa otwarta długo)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  // Nowa wersja została zainstalowana – zaproponuj odświeżenie
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Jest nowa wersja aplikacji', { label: 'Odśwież', fn: () => location.reload() });
  });
}

// Poproś przeglądarkę o trwałe przechowywanie danych (mniejsze ryzyko automatycznego usunięcia)
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then((ok) => ok || navigator.storage.persist()).catch(() => {});
}
