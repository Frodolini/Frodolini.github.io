/**
 * Aksjespelet V2 – Google Apps Script (bakenda for aksjespel_v2.html)
 *
 * Nytt i V2:
 *  - Opningstider: du handlar direkte berre når børsen er open. Elles blir handelen ein ordre
 *    som ventar, og som blir gjennomført til første kurs etter opning (eller kansellert
 *    viss det ikkje er dekning).
 *  - Fleire klassar: kvar klasse har sin eigen påmeldingskode og si eiga toppliste.
 *    Klassane konkurrerer i ein klassekamp, utan å sjå spelarane i dei andre klassane.
 *
 * Google-arket er «databasen»: éi fane per tabell
 * (Oppsett, Selskap, Klassar, Spelarar, Handlar, Ordrar).
 *
 * Oppsett:
 *  1. Lag eit NYTT Google-ark (ikkje bruk arket til det første aksjespelet).
 *  2. Utvidingar → Apps Script. Slett det som står der, og lim inn heile denne fila.
 *  3. Lagre. Køyr funksjonen «oppsett» éin gong (vel han i menyen øvst og trykk Køyr),
 *     og godkjenn tilgangen. No finst fanene i arket.
 *  4. Opne fana «Oppsett» og set spelnamn, startdato, sluttdato og startsum.
 *     Opne fana «Klassar» og skriv éi rad per klasse: påmeldingskode og klassenamn.
 *     Sjå over fana «Selskap»: står det eit tal i kolonnen «Kurs» på alle radene?
 *     Rader utan tal blir ikkje viste i spelet. Du kan leggje til og fjerne rader fritt.
 *     Kursane i New York kjem frå formelen GOOGLEFINANCE i arket. Google Finance har ikkje
 *     Oslo Børs, så rader som startar med OSL: blir henta frå Yahoo Finance kvart tiande minutt.
 *  5. Distribuer → Ny distribusjon → type «Nettapp».
 *     Køyr som: Meg.  Kven har tilgang: Alle.
 *  6. Kopier adressa som sluttar på /exec, og lim ho inn som API_URL i aksjespel_v2.html.
 *
 * Endrar du koden seinare: Distribuer → Administrer distribusjonar → blyant → Ny versjon.
 * Då held adressa seg den same.
 *
 * Gløymd PIN: slett PIN-hashen til spelaren i fana «Spelarar». Då vel eleven ny PIN
 * neste gong han loggar inn.
 *
 * Fridagar: skriv datoane børsen er stengd i «Stengt Oslo» og «Stengt New York» i fana
 * «Oppsett», som åååå-mm-dd med komma mellom. Helgane tek skriptet seg av sjølv.
 */

const TZ = "Europe/Oslo";
const A_OPPSETT = "Oppsett";
const A_SELSKAP = "Selskap";
const A_KLASSAR = "Klassar";
const A_SPELARAR = "Spelarar";
const A_HANDLAR = "Handlar";
const A_ORDRAR = "Ordrar";
const MAKS_SPELARAR = 400;
const MAKS_TAL = 1000000;
const MAKS_ORDRAR = 10;        // ventande ordrar per spelar
const MINST_I_KLASSEKAMP = 3;  // færre spelarar enn dette: klassen får ikkje tal i klassekampen

// Opningstidene står i børsen si eiga tidssone, så sommartid ordnar seg sjølv
const BORSAR = {
  "Oslo": { namn: "Oslo Børs", tz: "Europe/Oslo", opnar: "09:00", stenger: "16:20" },
  "New York": { namn: "New York", tz: "America/New_York", opnar: "09:30", stenger: "16:00" }
};

const K_SELSKAP = ["Ticker", "Namn", "Børs", "Valuta", "Kurs", "Manuell kurs", "Startkurs", "Sluttkurs"];
const K_KLASSAR = ["Kode", "Klasse"];
const K_SPELARAR = ["Brukarnamn", "PIN-hash", "Registrert", "Klasse"];
const K_HANDLAR = ["Tid", "Brukarnamn", "Type", "Ticker", "Tal", "Kurs", "Valuta", "USDNOK", "Beløp NOK", "Kurtasje NOK", "Ordre"];
const K_ORDRAR = ["Ordre", "Lagt inn", "Brukarnamn", "Type", "Ticker", "Tal", "Status", "Avgjort", "Merknad"];

const STANDARD_OPPSETT = [
  ["Spelnamn", "Aksjespelet V2", "Vist øvst på nettsida"],
  ["Startdato", "2026-11-16", "Første handledag, skriven som åååå-mm-dd"],
  ["Sluttdato", "2026-12-18", "Siste handledag, skriven som åååå-mm-dd"],
  ["Startsum", 100000, "Kroner kvar spelar startar med"],
  ["Kurtasje", 29, "Kroner per handel (0 = gratis)"],
  ["Forseinking", 30, "Minutt etter børsopning før handelen opnar i spelet. Kursane er forseinka, så utan dette ville ein fått gårsdagens kurs"],
  ["Stengt Oslo", "2026-12-24, 2026-12-25, 2026-12-31, 2027-01-01", "Dagar Oslo Børs er stengd: åååå-mm-dd med komma mellom"],
  ["Stengt New York", "2026-11-26, 2026-12-25, 2027-01-01", "Dagar børsane i New York er stengde: åååå-mm-dd med komma mellom"],
  ["USDNOK", '=GOOGLEFINANCE("CURRENCY:USDNOK")', "Dollarkursen i kroner, hentast automatisk"],
  ["USDNOK manuell", "", "Fyll inn berre viss rada over viser feil"],
  ["Startkursar tekne", "", "Skriptet fyller inn når spelet startar"],
  ["Sluttkursar frosne", "", "Skriptet fyller inn når spelet er slutt"],
  ["USDNOK ved slutt", "", "Skriptet fyller inn når spelet er slutt"]
];

const STANDARD_KLASSAR = [
  ["STORD1", "Klasse 1"],
  ["STORD2", "Klasse 2"]
];

// Ticker slik Google Finance skriv han, namn, børs, valuta
const STANDARD_SELSKAP = [
  ["OSL:EQNR", "Equinor", "Oslo", "NOK"],
  ["OSL:DNB", "DNB Bank", "Oslo", "NOK"],
  ["OSL:TEL", "Telenor", "Oslo", "NOK"],
  ["OSL:NHY", "Norsk Hydro", "Oslo", "NOK"],
  ["OSL:MOWI", "Mowi", "Oslo", "NOK"],
  ["OSL:ORK", "Orkla", "Oslo", "NOK"],
  ["OSL:YAR", "Yara", "Oslo", "NOK"],
  ["OSL:KOG", "Kongsberg Gruppen", "Oslo", "NOK"],
  ["OSL:AKSO", "Aker Solutions", "Oslo", "NOK"],
  ["OSL:AKRBP", "Aker BP", "Oslo", "NOK"],
  ["OSL:NAS", "Norwegian", "Oslo", "NOK"],
  ["OSL:FRO", "Frontline", "Oslo", "NOK"],
  ["OSL:SALM", "SalMar", "Oslo", "NOK"],
  ["OSL:STB", "Storebrand", "Oslo", "NOK"],
  ["OSL:TOM", "Tomra", "Oslo", "NOK"],
  ["OSL:NOD", "Nordic Semiconductor", "Oslo", "NOK"],
  ["NASDAQ:AAPL", "Apple", "New York", "USD"],
  ["NASDAQ:MSFT", "Microsoft", "New York", "USD"],
  ["NASDAQ:NVDA", "Nvidia", "New York", "USD"],
  ["NASDAQ:GOOGL", "Alphabet (Google)", "New York", "USD"],
  ["NASDAQ:AMZN", "Amazon", "New York", "USD"],
  ["NASDAQ:META", "Meta", "New York", "USD"],
  ["NASDAQ:TSLA", "Tesla", "New York", "USD"],
  ["NASDAQ:NFLX", "Netflix", "New York", "USD"],
  ["NASDAQ:AMD", "AMD", "New York", "USD"],
  ["NASDAQ:CSCO", "Cisco", "New York", "USD"],
  ["NYSE:KO", "Coca-Cola", "New York", "USD"],
  ["NYSE:MCD", "McDonald's", "New York", "USD"],
  ["NYSE:NKE", "Nike", "New York", "USD"],
  ["NYSE:DIS", "Disney", "New York", "USD"],
  ["NYSE:SPOT", "Spotify", "New York", "USD"],
  ["NYSE:RBLX", "Roblox", "New York", "USD"],
  ["NYSE:UBER", "Uber", "New York", "USD"],
  ["NASDAQ:WMT", "Walmart", "New York", "USD"],
  ["NYSE:XOM", "ExxonMobil", "New York", "USD"],
  ["NYSE:BA", "Boeing", "New York", "USD"]
];

/* ---------- Oppsett og meny ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Aksjespel")
    .addItem("Oppsett (lag fanene)", "oppsett")
    .addItem("Nullstill spelet (slett spelarar, handlar og ordrar)", "nullstill")
    .addToUi();
}

// Lagar fanene som manglar. Rører ikkje det som alt står der.
function oppsett() {
  const bok = SpreadsheetApp.getActiveSpreadsheet();

  let ark = bok.getSheetByName(A_OPPSETT);
  if (!ark) {
    ark = bok.insertSheet(A_OPPSETT);
    ark.getRange(1, 1, 1, 3).setValues([["Innstilling", "Verdi", "Forklaring"]]).setFontWeight("bold");
    STANDARD_OPPSETT.forEach((r, i) => {
      const rad = i + 2;
      ark.getRange(rad, 1).setValue(r[0]);
      ark.getRange(rad, 3).setValue(r[2]);
      const celle = ark.getRange(rad, 2);
      if (String(r[1]).charAt(0) === "=") celle.setFormula(r[1]);
      else if (/dato|Stengt/.test(r[0])) celle.setNumberFormat("@").setValue(r[1]);   // datoar som tekst
      else celle.setValue(r[1]);
    });
    ark.setFrozenRows(1);
    ark.autoResizeColumns(1, 3);
  }

  ark = bok.getSheetByName(A_SELSKAP);
  if (!ark) {
    ark = bok.insertSheet(A_SELSKAP);
    hovud(ark, K_SELSKAP);
    ark.getRange(2, 1, STANDARD_SELSKAP.length, 4).setValues(STANDARD_SELSKAP);
    // New York: kursen blir henta av Google Finance, og er som regel nokre minutt forseinka.
    // Oslo Børs: Google Finance har han ikkje, så hentKursar() fyller inn frå Yahoo Finance.
    STANDARD_SELSKAP.forEach((r, i) => {
      if (!yahooSymbol(r[0])) ark.getRange(i + 2, 5).setFormula("=GOOGLEFINANCE(A" + (i + 2) + ")");
    });
    ark.autoResizeColumns(1, 4);
  }

  if (!bok.getSheetByName(A_KLASSAR)) {
    ark = bok.insertSheet(A_KLASSAR);
    hovud(ark, K_KLASSAR);
    ark.getRange(2, 1, STANDARD_KLASSAR.length, 2).setNumberFormat("@").setValues(STANDARD_KLASSAR);
  }
  if (!bok.getSheetByName(A_SPELARAR)) hovud(bok.insertSheet(A_SPELARAR), K_SPELARAR);
  if (!bok.getSheetByName(A_HANDLAR)) hovud(bok.insertSheet(A_HANDLAR), K_HANDLAR);
  if (!bok.getSheetByName(A_ORDRAR)) hovud(bok.insertSheet(A_ORDRAR), K_ORDRAR);

  // Kvart tiande minutt: hent kursane frå Oslo Børs, køyr ordrane som ventar,
  // ta startkursar når spelet startar, og frys kursane når det er slutt.
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["kvarTime", "hentKursar", "kvarTiande"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("kvarTiande").timeBased().everyMinutes(10).create();
  hentKursar();
}

function hovud(ark, kolonnar) {
  ark.getRange(1, 1, 1, kolonnar.length).setValues([kolonnar]).setFontWeight("bold");
  ark.setFrozenRows(1);
}

// Slettar alle spelarar, handlar og ordrar, og dei lagra start- og sluttkursane. Klassane står att.
function nullstill() {
  const ui = SpreadsheetApp.getUi();
  const svar = ui.alert("Nullstill spelet", "Alle spelarar, handlar og ordrar blir sletta. Er du sikker?", ui.ButtonSet.YES_NO);
  if (svar !== ui.Button.YES) return;
  [A_SPELARAR, A_HANDLAR, A_ORDRAR].forEach(namn => {
    const ark = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(namn);
    if (ark.getLastRow() > 1) ark.getRange(2, 1, ark.getLastRow() - 1, ark.getLastColumn()).clearContent();
  });
  const selskap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(A_SELSKAP);
  if (selskap.getLastRow() > 1) selskap.getRange(2, 7, selskap.getLastRow() - 1, 2).clearContent();
  const o = lesOppsett();
  ["Startkursar tekne", "Sluttkursar frosne", "USDNOK ved slutt"].forEach(k => settOppsett(o, k, ""));
  CacheService.getScriptCache().remove("status");
}

function kvarTiande() {
  hentKursar();
  const las = LockService.getScriptLock();
  las.waitLock(20000);
  try {
    sjekkFase(lesOppsett());
    koyrOrdrar(lesOppsett());
  } finally { las.releaseLock(); }
}

/* ---------- Kursar frå Oslo Børs ---------- */

// "OSL:EQNR" → "EQNR.OL" slik Yahoo Finance skriv det. Andre børsar brukar GOOGLEFINANCE i arket.
function yahooSymbol(id) {
  const m = String(id).trim().match(/^OSL:(.+)$/i);
  return m ? m[1].toUpperCase() + ".OL" : "";
}

// Hentar siste kurs for alle OSL:-radene og skriv han i kolonnen «Kurs».
// Feilar hentinga, blir den førre kursen ståande.
function hentKursar() {
  const a = ark(A_SELSKAP);
  const rader = [];
  a.getDataRange().getValues().forEach((r, i) => {
    const symbol = yahooSymbol(r[0]);
    if (i > 0 && symbol) rader.push({ rad: i + 1, symbol: symbol });
  });
  if (lesOppsett().frosne) return;
  for (let i = 0; i < rader.length; i += 15) {
    const bolk = rader.slice(i, i + 15);
    try {
      const adresse = "https://query1.finance.yahoo.com/v8/finance/spark?range=1d&interval=1d&symbols="
        + bolk.map(x => encodeURIComponent(x.symbol)).join(",");
      const svar = UrlFetchApp.fetch(adresse, { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } });
      if (svar.getResponseCode() !== 200) continue;
      const data = JSON.parse(svar.getContentText());
      bolk.forEach(x => {
        const d = data[x.symbol];
        const sluttar = d && d.close ? d.close.filter(v => typeof v === "number" && v > 0) : [];
        if (sluttar.length) a.getRange(x.rad, 5).setValue(sluttar[sluttar.length - 1]);
      });
    } catch (feil) {}
  }
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove("status");
}

/* ---------- Opningstider ---------- */

// Dato, klokkeslett og vekedag (1 = måndag … 7 = sundag) i ei tidssone
function lokal(d, tz) {
  const t = Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm u").split(" ");
  return { dato: t[0], tid: t[1], vekedag: Number(t[2]) };
}

// Tidspunktet «dato klokka tid» i ei tidssone
function tidspunkt(dato, tid, tz) {
  return Utilities.parseDate(dato + " " + tid, tz, "yyyy-MM-dd HH:mm");
}

// "09:00" + 30 minutt → "09:30"
function leggTil(tid, minutt) {
  const d = tid.split(":");
  const m = Number(d[0]) * 60 + Number(d[1]) + minutt;
  return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2);
}

// Er børsen open for handel i spelet no? Viss ikkje: når opnar ho neste gong?
// «opnar» er børsen si opningstid pluss forseinkinga, sidan kursane er forseinka.
function borsStatus(o, nokkel, no) {
  const b = BORSAR[nokkel];
  const fra = leggTil(b.opnar, o.forseinking);
  for (let d = 0; d < 14; d++) {
    const l = lokal(new Date(no.getTime() + d * 86400000), b.tz);
    if (l.vekedag > 5 || o.stengt[nokkel].indexOf(l.dato) >= 0) continue;
    const open = d === 0 && l.tid >= fra && l.tid < b.stenger;
    if (d === 0 && !open && l.tid >= b.stenger) continue;
    return {
      namn: b.namn,
      open: open,
      opnar: tidspunkt(l.dato, fra, b.tz).toISOString(),
      stenger: tidspunkt(l.dato, b.stenger, b.tz).toISOString()
    };
  }
  return { namn: b.namn, open: false, opnar: "", stenger: "" };
}

function alleBorsar(o, no) {
  const ut = {};
  Object.keys(BORSAR).forEach(k => ut[k] = borsStatus(o, k, no));
  return ut;
}

/* ---------- Nettappen ---------- */

// GET → stoda i spelet: innstillingar, kursar, opningstider og klassekamp. Krev ikkje innlogging.
// Med ?kode=KLASSEKODE følgjer topplista til den klassen med. Andre klassar si liste blir aldri sendt.
function doGet(e) {
  try {
    const cache = CacheService.getScriptCache();
    let tekst = cache.get("status");
    if (!tekst) {
      tekst = JSON.stringify(status());
      try { cache.put("status", tekst, 20); } catch (x) {}
    }
    const d = JSON.parse(tekst);
    const kode = String((e && e.parameter && e.parameter.kode) || "").trim().toLowerCase();
    const klasse = kode ? d.kodar[kode] : "";
    delete d.kodar;
    d.klasse = klasse || null;
    d.toppliste = klasse
      ? d.toppliste.filter(r => r.klasse === klasse).map(r => ({ brukar: r.brukar, verdi: r.verdi, pst: r.pst, selskap: r.selskap, storst: r.storst }))
      : null;
    return svar(d);
  } catch (feil) {
    return svar({ ok: false, feil: String(feil.message || feil) });
  }
}

// POST (JSON i body) → { f: "registrer" | "logginn" | "handel" | "angre", brukar, pin, ... }
function doPost(e) {
  const las = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    las.waitLock(15000);
    let ut;
    if (d.f === "registrer") ut = registrer(d);
    else if (d.f === "logginn") ut = { meg: meg(loggInn(d)) };
    else if (d.f === "handel") ut = handel(d);
    else if (d.f === "angre") ut = angre(d);
    else throw new Error("ukjend førespurnad");
    ut.ok = true;
    return svar(ut);
  } catch (feil) {
    return svar({ ok: false, feil: String(feil.message || feil) });
  } finally {
    try { las.releaseLock(); } catch (x) {}
  }
}

// Heile stoda, med alle klassane. doGet plukkar ut det kvar klasse får sjå.
function status() {
  let o = lesOppsett();
  if (sjekkFase(o)) o = lesOppsett();
  const selskap = lesSelskap(o);
  const kurs = {};
  selskap.forEach(s => kurs[s.id] = s);
  const rekneskap = rekn(lesHandlar(), o.startsum);
  const klassar = lesKlassar();

  const liste = lesSpelarar().map(s => {
    const r = rekneskap[s.namn.toLowerCase()] || { kontantar: o.startsum, postar: {} };
    let verdi = r.kontantar, tal = 0, storst = "", storstVerdi = 0;
    Object.keys(r.postar).forEach(id => {
      const p = r.postar[id];
      if (p.tal <= 0) return;
      const v = postVerdi(p, kurs[id], o.usdnok);
      verdi += v;
      tal++;
      if (v > storstVerdi) { storstVerdi = v; storst = id; }
    });
    return {
      brukar: s.namn, klasse: klasseTil(s, klassar), verdi: Math.round(verdi),
      pst: o.startsum ? (verdi / o.startsum - 1) * 100 : 0, selskap: tal, storst: storst
    };
  });
  liste.sort((a, b) => b.verdi - a.verdi || a.brukar.localeCompare(b.brukar));

  // Klassekampen: medianen, altså den midtarste spelaren i klassen. Éin spelar som satsar alt
  // på éi aksje avgjer då ikkje kampen, og store klassar vinn ikkje berre fordi dei er store.
  const kamp = klassar.map(k => {
    const verdiar = liste.filter(r => r.klasse === k.namn).map(r => r.verdi);
    const nok = verdiar.length >= MINST_I_KLASSEKAMP;
    const m = nok ? median(verdiar) : null;
    return {
      namn: k.namn, spelarar: verdiar.length,
      verdi: nok ? Math.round(m) : null,
      pst: nok && o.startsum ? (m / o.startsum - 1) * 100 : null,
      sum: nok ? verdiar.reduce((a, b) => a + b, 0) : null
    };
  });
  kamp.sort((a, b) => (b.verdi === null ? -1 : b.verdi) - (a.verdi === null ? -1 : a.verdi) || a.namn.localeCompare(b.namn));

  const kodar = {};
  klassar.forEach(k => kodar[k.kode.toLowerCase()] = k.namn);

  return {
    ok: true,
    spel: {
      namn: o.namn, start: o.start, slutt: o.slutt, startsum: o.startsum, kurtasje: o.kurtasje,
      fase: o.fase, forseinking: o.forseinking, minst: MINST_I_KLASSEKAMP
    },
    usdnok: o.usdnok,
    borsar: alleBorsar(o, new Date()),
    selskap: selskap.filter(s => s.kurs > 0)
      .map(s => ({ id: s.id, namn: s.namn, bors: s.bors, marknad: s.marknad, valuta: s.valuta, kurs: s.kurs, start: s.start })),
    toppliste: liste,
    klassekamp: kamp,
    kodar: kodar,
    oppdatert: new Date().toISOString()
  };
}

function median(verdiar) {
  const v = verdiar.slice().sort((a, b) => a - b);
  const midt = Math.floor(v.length / 2);
  return v.length % 2 ? v[midt] : (v[midt - 1] + v[midt]) / 2;
}

/* ---------- Spelarar ---------- */

function registrer(d) {
  const o = lesOppsett();
  const namn = String(d.brukar || "").trim();
  const pin = String(d.pin || "");
  const kode = String(d.kode || "").trim().toLowerCase();
  if (o.fase === "ferdig") throw new Error("Spelet er slutt, så du kan ikkje melde deg på no.");
  if (!/^[A-Za-z0-9ÆØÅæøå_-]{3,16}$/.test(namn)) throw new Error("Brukarnamnet må ha 3–16 bokstavar, tal, _ eller -.");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN-koden må ha 4–8 siffer.");
  const klassar = lesKlassar();
  if (!klassar.length) throw new Error("Læraren har ikkje lagt inn nokon klassar enno.");
  const klasse = klassar.filter(k => k.kode.toLowerCase() === kode)[0];
  if (!klasse) throw new Error("Feil påmeldingskode.");
  const alle = lesSpelarar();
  if (alle.some(s => s.namn.toLowerCase() === namn.toLowerCase())) throw new Error("Brukarnamnet er oppteke. Vel eit anna.");
  if (alle.length >= MAKS_SPELARAR) throw new Error("Spelet er fullt.");
  // ' framfor teksten gjer at arket aldri tolkar han som ein formel
  ark(A_SPELARAR).appendRow(["'" + namn, hash(namn, pin), new Date(), "'" + klasse.namn]);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove("status");
  return { meg: meg(namn) };
}

// Sjekkar brukarnamn og PIN. Returnerer brukarnamnet slik det står i arket.
function loggInn(d) {
  const namn = String(d.brukar || "").trim();
  const pin = String(d.pin || "");
  const cache = CacheService.getScriptCache();
  const teljar = "feil:" + namn.toLowerCase();
  if (Number(cache.get(teljar)) >= 5) throw new Error("For mange feil PIN-kodar. Vent ti minutt.");

  const alle = lesSpelarar();
  const s = alle.filter(x => x.namn.toLowerCase() === namn.toLowerCase())[0];
  if (!s) throw new Error("Fann ikkje brukarnamnet. Er du ny, vel «Ny spelar».");
  if (!s.hash) {
    // Læraren har sletta hashen: den nye PIN-koden gjeld frå no
    if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN-koden må ha 4–8 siffer.");
    ark(A_SPELARAR).getRange(s.rad, 2).setValue(hash(s.namn, pin));
    return s.namn;
  }
  if (s.hash !== hash(s.namn, pin)) {
    cache.put(teljar, String(Number(cache.get(teljar) || 0) + 1), 600);
    throw new Error("Feil PIN-kode.");
  }
  return s.namn;
}

// PIN-koden blir aldri lagra, berre ein SHA-256-hash med salt
function hash(namn, pin) {
  const salt = SpreadsheetApp.getActiveSpreadsheet().getId();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + namn.toLowerCase() + "|" + pin, Utilities.Charset.UTF_8);
  return bytes.map(b => ("0" + (b & 255).toString(16)).slice(-2)).join("");
}

// Kontantar, aksjepostar, ordrar og dei siste handlane til éin spelar
function meg(namn) {
  const o = lesOppsett();
  const k = namn.toLowerCase();
  const handlar = lesHandlar().filter(h => h.brukar.toLowerCase() === k);
  const r = rekn(handlar, o.startsum)[k] || { kontantar: o.startsum, postar: {} };
  const klassar = lesKlassar();
  const spelar = lesSpelarar().filter(s => s.namn.toLowerCase() === k)[0];
  const klasse = spelar ? klasseTil(spelar, klassar) : "";
  const kl = klassar.filter(x => x.namn === klasse)[0];
  const veke = Date.now() - 7 * 86400000;
  // Ordrar som ventar, og dei som vart kansellerte den siste veka
  const ordrar = lesOrdrar().filter(x => x.brukar.toLowerCase() === k
    && (x.status === "VENTAR" || (x.status === "KANSELLERT" && new Date(x.avgjort).getTime() > veke)));
  return {
    brukar: namn,
    klasse: klasse,
    kode: kl ? kl.kode : "",
    kontantar: r.kontantar,
    postar: Object.keys(r.postar).filter(id => r.postar[id].tal > 0)
      .map(id => ({ id: id, tal: r.postar[id].tal, kost: r.postar[id].kost })),
    ordrar: ordrar.reverse().map(x => ({
      ordre: x.ordre, lagt: x.lagt, type: x.type, id: x.id, tal: x.tal, status: x.status, merknad: x.merknad
    })),
    handlar: handlar.slice(-50).reverse().map(h => ({
      tid: h.tid, type: h.type, id: h.id, tal: h.tal, kurs: h.kurs, valuta: h.valuta, belop: h.belop, kurtasje: h.kurtasje
    }))
  };
}

/* ---------- Handel og ordrar ---------- */

// Er børsen open, blir handelen gjennomført med ein gong. Elles blir han ein ordre som ventar.
function handel(d) {
  const namn = loggInn(d);
  let o = lesOppsett();
  if (sjekkFase(o)) o = lesOppsett();
  if (o.fase === "for") throw new Error("Spelet har ikkje starta enno.");
  if (o.fase === "ferdig") throw new Error("Spelet er slutt.");
  koyrOrdrar(o);   // eldre ordrar skal gå føre denne

  const type = d.type === "SAL" ? "SAL" : "KJØP";
  const tal = Math.floor(Number(d.tal));
  if (!(tal >= 1 && tal <= MAKS_TAL)) throw new Error("Talet på aksjar må vere eit heiltal frå 1 og opp.");
  const s = lesSelskap(o).filter(x => x.id === String(d.id))[0];
  if (!s) throw new Error("Finn ikkje dette selskapet.");
  const k = namn.toLowerCase();
  const r = rekn(lesHandlar().filter(h => h.brukar.toLowerCase() === k), o.startsum)[k] || { kontantar: o.startsum, postar: {} };
  const bors = borsStatus(o, s.marknad, new Date());

  if (bors.open) {
    if (!(s.kurs > 0)) throw new Error("Finn ikkje kursen på dette selskapet akkurat no.");
    const veksling = s.valuta === "USD" ? o.usdnok : 1;
    if (!(veksling > 0)) throw new Error("Manglar dollarkurs akkurat no.");
    const belop = kr(tal * s.kurs * veksling);
    const feil = dekning(r, type, s, tal, belop, o.kurtasje);
    if (feil) throw new Error(feil);
    ark(A_HANDLAR).appendRow([new Date(), "'" + namn, type, s.id, tal, s.kurs, s.valuta, veksling, belop, o.kurtasje, ""]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove("status");
    return { meg: meg(namn), handel: { type: type, id: s.id, tal: tal, kurs: s.kurs, valuta: s.valuta, belop: belop } };
  }

  // Børsen er stengd: legg inn ein ordre
  if (!bors.opnar || lokal(new Date(bors.opnar), TZ).dato > o.slutt) {
    throw new Error(bors.namn + " opnar ikkje fleire gonger før spelet er slutt.");
  }
  const mine = lesOrdrar().filter(x => x.brukar.toLowerCase() === k && x.status === "VENTAR");
  if (mine.length >= MAKS_ORDRAR) throw new Error("Du har alt " + MAKS_ORDRAR + " ordrar som ventar. Angre ein av dei først.");
  if (type === "SAL") {
    const eig = r.postar[s.id] ? r.postar[s.id].tal : 0;
    const alt = mine.filter(x => x.type === "SAL" && x.id === s.id).reduce((a, x) => a + x.tal, 0);
    if (tal > eig - alt) {
      throw new Error("Du eig berre " + eig + " aksjar i " + s.namn + (alt ? ", og " + alt + " av dei ligg alt i ein salsordre." : "."));
    }
  }
  const ordre = Utilities.getUuid().slice(0, 8);
  ark(A_ORDRAR).appendRow(["'" + ordre, new Date(), "'" + namn, type, s.id, tal, "VENTAR", "", ""]);
  SpreadsheetApp.flush();
  return { meg: meg(namn), ordre: { ordre: ordre, type: type, id: s.id, tal: tal, opnar: bors.opnar } };
}

// Spelaren trekkjer ein ordre som ventar
function angre(d) {
  const namn = loggInn(d);
  const x = lesOrdrar().filter(x => x.ordre === String(d.ordre) && x.brukar.toLowerCase() === namn.toLowerCase())[0];
  if (!x || x.status !== "VENTAR") throw new Error("Ordren ventar ikkje lenger, så han kan ikkje angrast.");
  ark(A_ORDRAR).getRange(x.rad, 7, 1, 3).setValues([["ANGRA", new Date(), ""]]);
  SpreadsheetApp.flush();
  return { meg: meg(namn) };
}

// Har spelaren råd til kjøpet, eller nok aksjar til salet? Returnerer feilmeldinga, eller "" når alt er i orden.
function dekning(r, type, s, tal, belop, kurtasje) {
  if (type === "KJØP") {
    if (belop + kurtasje > r.kontantar + 0.001) {
      return "Du har ikkje nok kontantar. Handelen kostar " + Math.ceil(belop + kurtasje) + " kr, og du har " + Math.floor(r.kontantar) + " kr.";
    }
    return "";
  }
  const eig = r.postar[s.id] ? r.postar[s.id].tal : 0;
  return tal > eig ? "Du eig berre " + eig + " aksjar i " + s.namn + "." : "";
}

// Går gjennom ordrane som ventar, eldste først. Er børsen open, blir ordren gjennomført til
// kursen no, eller kansellert viss det ikkje er dekning. Returnerer talet på avgjorde ordrar.
function koyrOrdrar(o) {
  if (o.fase === "for") return 0;
  const ventar = lesOrdrar().filter(x => x.status === "VENTAR");
  if (!ventar.length) return 0;

  const no = new Date();
  const selskap = {};
  lesSelskap(o).forEach(s => selskap[s.id] = s);
  const borsar = alleBorsar(o, no);
  const rekneskap = rekn(lesHandlar(), o.startsum);
  const arkOrdrar = ark(A_ORDRAR), arkHandlar = ark(A_HANDLAR);
  let avgjorde = 0;

  ventar.forEach(x => {
    const s = selskap[x.id];
    let utfall;
    if (o.fase === "ferdig") utfall = ["KANSELLERT", "Spelet var slutt før børsen opna."];
    else if (!s) utfall = ["KANSELLERT", "Selskapet er ikkje lenger med i spelet."];
    else {
      const veksling = s.valuta === "USD" ? o.usdnok : 1;
      // Stengd børs eller manglande kurs: ordren ventar vidare
      if (!borsar[s.marknad].open || !(s.kurs > 0) || !(veksling > 0)) return;
      const k = x.brukar.toLowerCase();
      const r = rekneskap[k] || (rekneskap[k] = { kontantar: o.startsum, postar: {} });
      const belop = kr(x.tal * s.kurs * veksling);
      const feil = dekning(r, x.type, s, x.tal, belop, o.kurtasje);
      if (feil) utfall = ["KANSELLERT", feil];
      else {
        arkHandlar.appendRow([no, "'" + x.brukar, x.type, s.id, x.tal, s.kurs, s.valuta, veksling, belop, o.kurtasje, "'" + x.ordre]);
        bruk(r, { type: x.type, id: s.id, tal: x.tal, belop: belop, kurtasje: o.kurtasje });
        utfall = ["GJENNOMFØRT", ""];
      }
    }
    arkOrdrar.getRange(x.rad, 7, 1, 3).setValues([[utfall[0], no, utfall[1]]]);
    avgjorde++;
  });

  if (avgjorde) {
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove("status");
  }
  return avgjorde;
}

// Går gjennom handlane i rekkjefølgje og reknar ut kontantar og aksjepostar per spelar.
// Ingenting anna enn handlane blir lagra – saldoen blir rekna ut på nytt kvar gong.
function rekn(handlar, startsum) {
  const ut = {};
  handlar.forEach(h => {
    const k = h.brukar.toLowerCase();
    bruk(ut[k] || (ut[k] = { kontantar: startsum, postar: {} }), h);
  });
  return ut;
}

// Fører éin handel inn i rekneskapen til ein spelar
function bruk(r, h) {
  const p = r.postar[h.id] || (r.postar[h.id] = { tal: 0, kost: 0 });
  if (h.type === "SAL") {
    const del = p.tal > 0 ? Math.min(1, h.tal / p.tal) : 1;
    p.kost = kr(p.kost * (1 - del));
    p.tal -= h.tal;
    r.kontantar = kr(r.kontantar + h.belop - h.kurtasje);
  } else {
    p.tal += h.tal;
    p.kost = kr(p.kost + h.belop);
    r.kontantar = kr(r.kontantar - h.belop - h.kurtasje);
  }
}

// Verdien av ein aksjepost i kroner. Manglar kursen, brukar me det posten kosta.
function postVerdi(post, selskap, usdnok) {
  if (!selskap || !(selskap.kurs > 0)) return post.kost;
  return post.tal * selskap.kurs * (selskap.valuta === "USD" ? usdnok : 1);
}

/* ---------- Start og slutt ---------- */

// Tek startkursar første gong spelet er i gang, og frys kursane første gong det er slutt.
// Returnerer true viss noko vart endra.
function sjekkFase(o) {
  if (o.fase === "igang" && !o.startTekne) {
    lagreKursar(o, 7);
    settOppsett(o, "Startkursar tekne", new Date());
    return true;
  }
  if (o.fase === "ferdig" && !o.frosne) {
    lagreKursar(o, 8);
    settOppsett(o, "USDNOK ved slutt", o.usdnok);
    settOppsett(o, "Sluttkursar frosne", new Date());
    CacheService.getScriptCache().remove("status");
    return true;
  }
  return false;
}

function lagreKursar(o, kolonne) {
  const selskap = lesSelskap(o);
  if (!selskap.length) return;
  const sisteRad = Math.max.apply(null, selskap.map(s => s.rad));
  const verdiar = [];
  for (let rad = 2; rad <= sisteRad; rad++) {
    const s = selskap.filter(x => x.rad === rad)[0];
    verdiar.push([s && s.kurs > 0 ? s.kurs : ""]);
  }
  ark(A_SELSKAP).getRange(2, kolonne, verdiar.length, 1).setValues(verdiar);
  SpreadsheetApp.flush();
}

/* ---------- Lesing frå arket ---------- */

function ark(namn) {
  const a = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(namn);
  if (!a) throw new Error("Manglar fana «" + namn + "». Køyr funksjonen oppsett.");
  return a;
}

function lesOppsett() {
  const rader = ark(A_OPPSETT).getDataRange().getValues();
  const v = {}, rad = {};
  rader.forEach((r, i) => {
    const k = String(r[0]).trim();
    if (k) { v[k] = r[1]; rad[k] = i + 1; }
  });
  const start = dato(v["Startdato"]), slutt = dato(v["Sluttdato"]);
  const idag = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  const fase = (!start || !slutt || idag < start) ? "for" : idag > slutt ? "ferdig" : "igang";
  const frosne = !!v["Sluttkursar frosne"];
  const direkte = tal(v["USDNOK manuell"]) || tal(v["USDNOK"]);
  return {
    rad: rad,
    namn: String(v["Spelnamn"] || "Aksjespelet"),
    start: start,
    slutt: slutt,
    startsum: tal(v["Startsum"]) || 100000,
    kurtasje: Math.max(0, tal(v["Kurtasje"])),
    forseinking: v["Forseinking"] === undefined || v["Forseinking"] === "" ? 30 : Math.min(120, Math.max(0, Math.round(tal(v["Forseinking"])))),
    stengt: { "Oslo": datoliste(v["Stengt Oslo"]), "New York": datoliste(v["Stengt New York"]) },
    fase: fase,
    startTekne: !!v["Startkursar tekne"],
    frosne: frosne,
    usdnok: (fase === "ferdig" && frosne && tal(v["USDNOK ved slutt"])) || direkte
  };
}

function settOppsett(o, nokkel, verdi) {
  const a = ark(A_OPPSETT);
  if (o.rad[nokkel]) a.getRange(o.rad[nokkel], 2).setValue(verdi);
  else a.appendRow([nokkel, verdi]);
}

function lesSelskap(o) {
  const brukSlutt = o.fase === "ferdig" && o.frosne;
  return ark(A_SELSKAP).getDataRange().getValues().slice(1).map((r, i) => {
    const direkte = tal(r[5]) || tal(r[4]);
    const bors = String(r[2]).trim() || "Oslo";
    const valuta = String(r[3]).trim().toUpperCase() === "USD" ? "USD" : "NOK";
    return {
      rad: i + 2,
      id: String(r[0]).trim(),
      namn: String(r[1]).trim() || String(r[0]).trim(),
      bors: bors,
      // Kva opningstider som gjeld. Ukjende børsnamn følgjer valutaen.
      marknad: BORSAR[bors] ? bors : valuta === "USD" ? "New York" : "Oslo",
      valuta: valuta,
      kurs: (brukSlutt && tal(r[7])) || direkte,
      start: tal(r[6])
    };
  }).filter(s => s.id);
}

function lesKlassar() {
  return ark(A_KLASSAR).getDataRange().getValues().slice(1)
    .map(r => ({ kode: String(r[0]).trim(), namn: String(r[1]).trim() }))
    .filter(k => k.kode && k.namn);
}

// Klassen til ein spelar. Står det ingen (eller ein ukjend) klasse i arket, hamnar spelaren i den første.
function klasseTil(spelar, klassar) {
  const k = klassar.filter(x => x.namn.toLowerCase() === spelar.klasse.toLowerCase())[0];
  return k ? k.namn : klassar.length ? klassar[0].namn : "";
}

function lesSpelarar() {
  return ark(A_SPELARAR).getDataRange().getValues().slice(1).map((r, i) => ({
    rad: i + 2, namn: String(r[0]).trim(), hash: String(r[1]).trim(), klasse: String(r[3] == null ? "" : r[3]).trim()
  })).filter(s => s.namn);
}

function lesHandlar() {
  return ark(A_HANDLAR).getDataRange().getValues().slice(1).filter(r => r[1] !== "").map(r => ({
    tid: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
    brukar: String(r[1]).trim(),
    type: String(r[2]).trim() === "SAL" ? "SAL" : "KJØP",
    id: String(r[3]).trim(),
    tal: tal(r[4]),
    kurs: tal(r[5]),
    valuta: String(r[6]).trim(),
    belop: tal(r[8]),
    kurtasje: tal(r[9])
  }));
}

function lesOrdrar() {
  return ark(A_ORDRAR).getDataRange().getValues().slice(1).map((r, i) => ({
    rad: i + 2,
    ordre: String(r[0]).trim(),
    lagt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
    brukar: String(r[2]).trim(),
    type: String(r[3]).trim() === "SAL" ? "SAL" : "KJØP",
    id: String(r[4]).trim(),
    tal: tal(r[5]),
    status: String(r[6]).trim(),
    avgjort: r[7] instanceof Date ? r[7].toISOString() : String(r[7]),
    merknad: String(r[8] == null ? "" : r[8]).trim()
  })).filter(x => x.ordre && x.brukar);
}

/* ---------- Småting ---------- */

// Tal frå ei celle. Feil som #N/A og tomme celler blir 0.
function tal(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? "" : v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

// Dato som åååå-mm-dd, anten cella er tekst, dd.mm.åååå eller ein ekte dato
function dato(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  const t = String(v || "").trim();
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}

// Fleire datoar i éi celle, med komma, semikolon eller mellomrom mellom
function datoliste(v) {
  if (v instanceof Date) return [dato(v)];
  return String(v == null ? "" : v).split(/[,;\s]+/).map(dato).filter(d => d);
}

function kr(n) {
  return Math.round(n * 100) / 100;
}

function svar(objekt) {
  return ContentService.createTextOutput(JSON.stringify(objekt)).setMimeType(ContentService.MimeType.JSON);
}
