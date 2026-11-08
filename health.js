'use strict';
// Ocena zdrowotna produktów: Nutri-Score, stopień przetworzenia NOVA, poziomy składników, dodatki, alergeny.
// To ocena orientacyjna, nie porada dietetyczna.

// Stopień przetworzenia NOVA dla produktów wbudowanych (1 – nieprzetworzone … 4 – ultraprzetworzone).
// Dania złożone (pierogi, pizza…) nie mają oceny – zależy, czy domowe, czy gotowe ze sklepu.
const BUILTIN_NOVA = {
  1: ['Płatki owsiane', 'Ryż biały (suchy)', 'Ryż biały (gotowany)', 'Ryż brązowy (suchy)', 'Makaron pszenny (suchy)',
    'Makaron pszenny (gotowany)', 'Makaron pełnoziarnisty (suchy)', 'Kasza gryczana (sucha)', 'Kasza gryczana (gotowana)',
    'Kasza jaglana (sucha)', 'Kasza jęczmienna (sucha)', 'Kuskus (suchy)', 'Komosa ryżowa / quinoa (sucha)', 'Mąka pszenna',
    'Mleko 0,5%', 'Mleko 2%', 'Mleko 3,2%', 'Jogurt naturalny 2%', 'Skyr naturalny', 'Kefir 2%', 'Maślanka', 'Twaróg chudy',
    'Twaróg półtłusty', 'Śmietana 12%', 'Śmietana 18%', 'Jajko kurze', 'Białko jaja', 'Żółtko jaja',
    'Pierś z kurczaka (surowa)', 'Pierś z kurczaka (pieczona)', 'Udko z kurczaka bez skóry (surowe)',
    'Udko z kurczaka ze skórą (surowe)', 'Filet z indyka (surowy)', 'Wątróbka drobiowa', 'Wołowina mielona (surowa)',
    'Wołowina – rostbef (surowy)', 'Schab wieprzowy (surowy)', 'Karkówka (surowa)', 'Wieprzowina mielona (surowa)',
    'Łosoś (surowy)', 'Dorsz (surowy)', 'Mintaj (surowy)', 'Pstrąg (surowy)', 'Krewetki (surowe)',
    'Soczewica czerwona (sucha)', 'Groszek zielony (mrożony)', 'Ziemniaki (surowe)', 'Ziemniaki (gotowane)', 'Bataty',
    'Marchew', 'Pomidor', 'Ogórek', 'Papryka czerwona', 'Brokuł', 'Kalafior', 'Cebula', 'Czosnek', 'Sałata', 'Szpinak',
    'Kapusta biała', 'Cukinia', 'Bakłażan', 'Pieczarki', 'Burak', 'Rzodkiewka', 'Fasolka szparagowa', 'Seler naciowy', 'Por',
    'Awokado', 'Jabłko', 'Banan', 'Gruszka', 'Pomarańcza', 'Mandarynka', 'Grejpfrut', 'Cytryna', 'Truskawki',
    'Borówki amerykańskie', 'Maliny', 'Winogrona', 'Kiwi', 'Ananas', 'Arbuz', 'Brzoskwinia', 'Śliwki', 'Wiśnie', 'Mango',
    'Daktyle suszone', 'Rodzynki', 'Morele suszone', 'Orzechy włoskie', 'Migdały', 'Orzechy laskowe', 'Orzechy nerkowca',
    'Pestki dyni', 'Słonecznik łuskany', 'Siemię lniane', 'Nasiona chia', 'Wiórki kokosowe', 'Kakao w proszku',
    'Sok pomarańczowy', 'Kawa czarna', 'Herbata (bez cukru)'],
  2: ['Masło', 'Oliwa z oliwek', 'Olej rzepakowy', 'Cukier', 'Miód'],
  3: ['Chleb pszenny', 'Chleb żytni razowy', 'Chleb graham', 'Bułka pszenna', 'Bułka grahamka', 'Bagietka', 'Wafle ryżowe',
    'Musli z owocami', 'Jogurt grecki 10%', 'Serek wiejski', 'Ser żółty (gouda)', 'Ser mozzarella', 'Ser feta',
    'Ser camembert', 'Parmezan', 'Boczek wędzony', 'Łosoś wędzony', 'Makrela wędzona', 'Tuńczyk w sosie własnym',
    'Tuńczyk w oleju (odsączony)', 'Sardynki w oleju', 'Tofu naturalne', 'Ciecierzyca (z puszki)',
    'Fasola czerwona (z puszki)', 'Hummus', 'Frytki (smażone)', 'Pomidory krojone (z puszki)', 'Koncentrat pomidorowy 30%',
    'Ogórek kiszony', 'Kapusta kiszona', 'Kukurydza (z puszki)', 'Oliwki zielone', 'Żurawina suszona',
    'Orzeszki ziemne prażone', 'Masło orzechowe', 'Dżem niskosłodzony', 'Sos sojowy', 'Piwo jasne', 'Wino czerwone wytrawne'],
  4: ['Tortilla pszenna', 'Płatki kukurydziane', 'Napój owsiany', 'Szynka gotowana', 'Polędwica sopocka', 'Kiełbasa śląska',
    'Parówki', 'Salami', 'Kabanosy', 'Margaryna', 'Majonez', 'Ketchup', 'Musztarda', 'Odżywka białkowa (WPC)',
    'Czekolada gorzka 70%', 'Czekolada mleczna', 'Krem czekoladowo-orzechowy', 'Herbatniki', 'Lody śmietankowe',
    'Chipsy ziemniaczane', 'Paluszki słone', 'Napój gazowany typu cola'],
};
const NOVA_BY_NAME = {};
for (const [g, names] of Object.entries(BUILTIN_NOVA)) for (const n of names) NOVA_BY_NAME[n] = Number(g);

const NOVA_LABELS = { 1: 'Nieprzetworzone', 2: 'Składnik kulinarny', 3: 'Przetworzone', 4: 'Ultraprzetworzone' };
const NOVA_INFO = {
  1: 'Żywność naturalna lub minimalnie przetworzona (np. warzywa, owoce, mięso, kasza).',
  2: 'Składniki do gotowania (np. olej, masło, cukier).',
  3: 'Proste produkty przetworzone (np. chleb, ser, konserwy).',
  4: 'Produkty ultraprzetworzone – zwykle z dodatkami, których nie używa się w domowej kuchni. Warto je ograniczać.',
};

const NUTRIENTS = [
  { key: 'fat', name: 'Tłuszcz', field: 'fatTotal', low: 3, high: 17.5 },
  { key: 'saturated-fat', name: 'Tłuszcze nasycone', field: 'satfat', low: 1.5, high: 5 },
  { key: 'sugars', name: 'Cukry', field: 'sugars', low: 5, high: 22.5 },
  { key: 'salt', name: 'Sól', field: 'salt', low: 0.3, high: 1.5 },
];
const LEVEL_LABELS = { low: 'mało', moderate: 'średnio', high: 'dużo' };

const ALLERGENS = {
  gluten: 'gluten', milk: 'mleko', eggs: 'jaja', nuts: 'orzechy', peanuts: 'orzeszki ziemne', soybeans: 'soja',
  celery: 'seler', mustard: 'gorczyca', 'sesame-seeds': 'sezam', 'sulphur-dioxide-and-sulphites': 'siarczyny',
  fish: 'ryby', crustaceans: 'skorupiaki', molluscs: 'mięczaki', lupin: 'łubin',
};

const ADDITIVES = {
  E100: 'kurkumina', E101: 'ryboflawiny', E102: 'tartrazyna', E104: 'żółcień chinolinowa', E110: 'żółcień pomarańczowa',
  E120: 'koszenila', E122: 'azorubina', E124: 'czerwień koszenilowa A', E129: 'czerwień Allura', E131: 'błękit patentowy',
  E132: 'indygotyna', E133: 'błękit brylantowy', E140: 'chlorofile', E141: 'miedziowe kompleksy chlorofili',
  E150a: 'karmel', E150b: 'karmel siarczynowy', E150c: 'karmel amoniakalny', E150d: 'karmel amoniakalno-siarczynowy',
  E153: 'węgiel roślinny', E160a: 'karoteny', E160b: 'annato', E160c: 'ekstrakt z papryki', E162: 'czerwień buraczana',
  E163: 'antocyjany', E170: 'węglan wapnia', E171: 'dwutlenek tytanu', E200: 'kwas sorbowy', E202: 'sorbinian potasu',
  E210: 'kwas benzoesowy', E211: 'benzoesan sodu', E220: 'dwutlenek siarki', E223: 'pirosiarczyn sodu',
  E224: 'pirosiarczyn potasu', E250: 'azotyn sodu', E251: 'azotan sodu', E252: 'azotan potasu', E260: 'kwas octowy',
  E262: 'octany sodu', E270: 'kwas mlekowy', E281: 'propionian sodu', E282: 'propionian wapnia', E290: 'dwutlenek węgla',
  E296: 'kwas jabłkowy', E300: 'kwas askorbinowy (wit. C)', E301: 'askorbinian sodu', E306: 'tokoferole (wit. E)',
  E307: 'alfa-tokoferol', E310: 'galusan propylu', E316: 'izoaskorbinian sodu', E319: 'TBHQ', E320: 'BHA', E321: 'BHT',
  E322: 'lecytyny', E325: 'mleczan sodu', E326: 'mleczan potasu', E327: 'mleczan wapnia', E330: 'kwas cytrynowy',
  E331: 'cytryniany sodu', E332: 'cytryniany potasu', E333: 'cytryniany wapnia', E334: 'kwas winowy',
  E338: 'kwas fosforowy', E339: 'fosforany sodu', E340: 'fosforany potasu', E341: 'fosforany wapnia',
  E392: 'ekstrakt z rozmarynu', E400: 'kwas alginowy', E401: 'alginian sodu', E406: 'agar', E407: 'karagen',
  E410: 'mączka chleba świętojańskiego', E412: 'guma guar', E414: 'guma arabska', E415: 'guma ksantanowa',
  E420: 'sorbitol', E422: 'glicerol', E440: 'pektyny', E450: 'difosforany', E451: 'trifosforany', E452: 'polifosforany',
  E460: 'celuloza', E461: 'metyloceluloza', E466: 'karboksymetyloceluloza', E471: 'mono- i diglicerydy kwasów tłuszczowych',
  E472e: 'estry kwasu diacetylowinowego', E476: 'polirycynooleinian poliglicerolu', E481: 'stearoilomleczan sodu',
  E500: 'węglany sodu (soda)', E501: 'węglany potasu', E503: 'węglany amonu', E508: 'chlorek potasu',
  E509: 'chlorek wapnia', E511: 'chlorek magnezu', E524: 'wodorotlenek sodu', E551: 'dwutlenek krzemu',
  E575: 'glukono-delta-lakton', E621: 'glutaminian sodu', E627: 'guanylan disodowy', E631: 'inozynian disodowy',
  E635: 'rybonukleotydy disodowe', E901: 'wosk pszczeli', E903: 'wosk carnauba', E904: 'szelak', E920: 'L-cysteina',
  E941: 'azot', E942: 'podtlenek azotu', E950: 'acesulfam K', E951: 'aspartam', E952: 'cyklaminiany', E954: 'sacharyna',
  E955: 'sukraloza', E960: 'glikozydy stewiolowe', E965: 'maltitol', E967: 'ksylitol', E1404: 'skrobia utleniona',
  E1412: 'fosforan diskrobiowy', E1414: 'acetylowany fosforan diskrobiowy', E1420: 'skrobia acetylowana',
  E1422: 'acetylowany adypinian diskrobiowy', E1442: 'fosforan hydroksypropylodiskrobiowy',
  E1450: 'oktenylobursztynian skrobiowo-sodowy',
};

function additiveLabel(code) {
  const c = code.replace(/^E/i, 'E');
  const base = (c.match(/^E\d+[a-g]?/) || [c])[0];
  const name = ADDITIVES[c] || ADDITIVES[base] || ADDITIVES[base.replace(/[a-g]$/, '')];
  return name ? `${c} – ${name}` : c;
}

// Zamienia dane z Open Food Facts na nasz format oceny
function healthFromOff(p) {
  const n = p.nutriments || {};
  const get = (k) => { const v = Number(n[k]); return n[k] !== undefined && n[k] !== '' && isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; };
  const ns = String(p.nutriscore_grade || '').toLowerCase();
  const h = {
    src: 'off',
    ns: /^[a-e]$/.test(ns) ? ns : null,
    nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
    fatTotal: get('fat_100g'), satfat: get('saturated-fat_100g'), sugars: get('sugars_100g'),
    salt: get('salt_100g'), fiber: get('fiber_100g'),
    offLevels: p.nutrient_levels || null,
    additives: (p.additives_tags || []).map((t) => t.replace(/^en:/, '').toUpperCase().replace(/^E(\d+)([A-Z]*)$/, (m, d, s) => 'E' + d + s.toLowerCase())),
    allergens: (p.allergens_tags || []).map((t) => t.replace(/^[a-z]{2}:/, '')).map((t) => ALLERGENS[t] || t.replace(/-/g, ' ')),
    ingredients: String(p.ingredients_text_pl || p.ingredients_text || '').trim().slice(0, 2000) || null,
  };
  return hasHealth(h) ? h : null;
}
function hasHealth(h) {
  return !!h && (h.ns || h.nova || h.ingredients || (h.additives && h.additives.length) ||
    NUTRIENTS.some((x) => h[x.field] != null));
}
function productHealth(p) {
  if (!p) return null;
  if (p.health) return p.health;
  // Wbudowane: stopień przetworzenia + tłuszcz z tabeli (cukrów i soli nie znamy)
  if (p.builtin && NOVA_BY_NAME[p.name]) return { nova: NOVA_BY_NAME[p.name], fatTotal: p.f };
  return null;
}

// Poziomy (mało/średnio/dużo) na 100 g – progi jak na etykietach w Wielkiej Brytanii (FSA)
function nutrientLevels(h) {
  const out = [];
  for (const x of NUTRIENTS) {
    const v = h[x.field];
    let level = null;
    if (v != null) level = v <= x.low ? 'low' : v > x.high ? 'high' : 'moderate';
    else if (h.offLevels && h.offLevels[x.key]) level = h.offLevels[x.key];
    if (level) out.push({ ...x, value: v, level });
  }
  return out;
}

function healthVerdict(h) {
  if (!h) return null;
  const highs = nutrientLevels(h).filter((l) => l.level === 'high').length;
  const hasNs = !!h.ns;
  if (!hasNs && !h.nova && highs === 0) return null;
  // "Jedz rzadko": słaby Nutri-Score, albo kilka składników na wysokim poziomie,
  // albo ultraprzetworzone z dodatkowym ostrzeżeniem (samo NOVA 4 = "Z umiarem")
  if ((hasNs && 'de'.includes(h.ns)) || highs >= 2 || (h.nova === 4 && highs >= 1)) {
    return { cls: 'bad', text: 'Jedz rzadko' };
  }
  if ((hasNs && 'ab'.includes(h.ns) && h.nova !== 4 && highs === 0) || (!hasNs && h.nova === 1 && highs === 0)) {
    return { cls: 'good', text: 'Dobry wybór' };
  }
  if (!hasNs && h.nova === 2 && highs === 0) return null; // olej, masło, cukier – zależy od ilości
  return { cls: 'mid', text: 'Z umiarem' };
}

// Krótka linijka z plakietkami (do okna wagi i listy)
// Tylko poprawne wartości trafiają do nazw klas w HTML
const safeNs = (h) => (h && /^[a-e]$/.test(h.ns) ? h.ns : null);
const safeNova = (h) => (h && [1, 2, 3, 4].includes(h.nova) ? h.nova : null);

function healthBadges(h) {
  if (!h) return '';
  h = { ...h, ns: safeNs(h), nova: safeNova(h) };
  const v = healthVerdict(h);
  let html = '';
  if (v) html += `<span class="hb verdict ${v.cls}">${v.text}</span>`;
  if (h.ns) html += `<span class="hb ns ns-${h.ns}" title="Nutri-Score">Nutri-Score ${h.ns.toUpperCase()}</span>`;
  if (h.nova) html += `<span class="hb nova nova-${h.nova}" title="${NOVA_INFO[h.nova]}">NOVA ${h.nova} · ${NOVA_LABELS[h.nova]}</span>`;
  for (const l of nutrientLevels(h).filter((x) => x.level === 'high')) html += `<span class="hb warn">Dużo: ${l.name.toLowerCase()}</span>`;
  return html ? `<div class="health-badges">${html}</div>` : '';
}

// Mała literka Nutri-Score do list produktów
function healthMini(h) {
  if (!h) return '';
  h = { ...h, ns: safeNs(h), nova: safeNova(h) };
  if (h.ns) return `<span class="ns-mini ns-${h.ns}" title="Nutri-Score ${h.ns.toUpperCase()}">${h.ns.toUpperCase()}</span>`;
  if (h.nova === 4) return '<span class="nova-mini" title="Ultraprzetworzone (NOVA 4)">UP</span>';
  return '';
}

// Pełna karta oceny (formularz produktu, szczegóły)
function healthCard(h, withBadges = true) {
  if (!h) return '';
  h = { ...h, ns: safeNs(h), nova: safeNova(h) };
  const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  const levels = nutrientLevels(h);
  let html = '<div class="health-card">';
  if (withBadges) html += '<h4>Ocena zdrowotna</h4>' + healthBadges(h);
  if (h.ns) {
    html += `<div class="ns-strip" aria-label="Nutri-Score ${h.ns.toUpperCase()}">${'abcde'.split('').map((l) =>
      `<span class="ns-${l}${l === h.ns ? ' on' : ''}">${l.toUpperCase()}</span>`).join('')}</div>`;
  }
  if (h.nova) html += `<p class="hint">${NOVA_INFO[h.nova]}</p>`;
  if (levels.length) {
    html += '<div class="levels">' + levels.map((l) =>
      `<div class="lvl ${l.level}"><span>${l.name}</span><b>${LEVEL_LABELS[l.level]}${l.value != null ? ` · ${fmt(l.value)} g` : ''}</b></div>`).join('') + '</div>';
  }
  if (h.fiber != null) html += `<div class="lvl info"><span>Błonnik</span><b>${fmt(h.fiber)} g</b></div>`;
  if (h.allergens && h.allergens.length) html += `<p class="small"><b>Alergeny:</b> ${h.allergens.map(escH).join(', ')}</p>`;
  if (h.additives && h.additives.length) {
    html += `<details class="hdetails"><summary>Dodatki (${h.additives.length})</summary><ul>${h.additives.map((a) => `<li>${escH(additiveLabel(a))}</li>`).join('')}</ul></details>`;
  } else if (h.ingredients) {
    html += '<p class="small">Brak dodatków z E-numerem.</p>';
  }
  if (h.ingredients) html += `<details class="hdetails"><summary>Skład</summary><p class="small">${escH(h.ingredients)}</p></details>`;
  html += h.src === 'off'
    ? '<p class="tiny">Ocena orientacyjna, na podstawie danych z Open Food Facts. Wartości na 100 g.</p></div>'
    : '<p class="tiny">Ocena orientacyjna.</p></div>';
  return html;
}
function escH(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
