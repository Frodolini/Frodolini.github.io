/**
 * Aksjespelet – Google Apps Script (bakenda for aksjespel.html)
 *
 * Google-arket er «databasen»: éi fane per tabell (Oppsett, Selskap, Spelarar, Handlar).
 * Nettsida spør dette skriptet, og skriptet les og skriv i arket.
 *
 * Oppsett:
 *  1. Lag eit nytt Google-ark.
 *  2. Utvidingar → Apps Script. Slett det som står der, og lim inn heile denne fila.
 *  3. Lagre. Køyr funksjonen «oppsett» éin gong (vel han i menyen øvst og trykk Køyr),
 *     og godkjenn tilgangen. No finst fanene i arket.
 *  4. Opne fana «Oppsett» og set spelnamn, startdato, sluttdato, startsum og påmeldingskode.
 *     Sjå over fana «Selskap»: står det eit tal i kolonnen «Kurs» på alle radene?
 *     Rader utan tal blir ikkje viste i spelet. Du kan leggje til og fjerne rader fritt.
 *     Kursane i New York kjem frå formelen GOOGLEFINANCE i arket. Google Finance har ikkje
 *     Oslo Børs, så rader som startar med OSL: blir henta frå Yahoo Finance kvart tiande minutt.
 *  5. Distribuer → Ny distribusjon → type «Nettapp».
 *     Køyr som: Meg.  Kven har tilgang: Alle.
 *  6. Kopier adressa som sluttar på /exec, og lim ho inn som API_URL i aksjespel.html.
 *
 * Endrar du koden seinare: Distribuer → Administrer distribusjonar → blyant → Ny versjon.
 * Då held adressa seg den same.
 *
 * Gløymd PIN: slett PIN-hashen til spelaren i fana «Spelarar». Då vel eleven ny PIN
 * neste gong han loggar inn.
 */

const TZ = "Europe/Oslo";
const A_OPPSETT = "Oppsett";
const A_SELSKAP = "Selskap";
const A_SPELARAR = "Spelarar";
const A_HANDLAR = "Handlar";
const MAKS_SPELARAR = 200;
const MAKS_TAL = 1000000;

const K_SELSKAP = ["Ticker", "Namn", "Børs", "Valuta", "Kurs", "Manuell kurs", "Startkurs", "Sluttkurs"];
const K_SPELARAR = ["Brukarnamn", "PIN-hash", "Registrert"];
const K_HANDLAR = ["Tid", "Brukarnamn", "Type", "Ticker", "Tal", "Kurs", "Valuta", "USDNOK", "Beløp NOK", "Kurtasje NOK"];

const STANDARD_OPPSETT = [
  ["Spelnamn", "Aksjespelet", "Vist øvst på nettsida"],
  ["Startdato", "2026-11-16", "Første handledag, skriven som åååå-mm-dd"],
  ["Sluttdato", "2026-12-18", "Siste handledag, skriven som åååå-mm-dd"],
  ["Startsum", 100000, "Kroner kvar spelar startar med"],
  ["Kurtasje", 29, "Kroner per handel (0 = gratis)"],
  ["Påmeldingskode", "STORD", "Nye spelarar må skrive denne. Tom = alle kan melde seg på"],
  ["USDNOK", '=GOOGLEFINANCE("CURRENCY:USDNOK")', "Dollarkursen i kroner, hentast automatisk"],
  ["USDNOK manuell", "", "Fyll inn berre viss rada over viser feil"],
  ["Startkursar tekne", "", "Skriptet fyller inn når spelet startar"],
  ["Sluttkursar frosne", "", "Skriptet fyller inn når spelet er slutt"],
  ["USDNOK ved slutt", "", "Skriptet fyller inn når spelet er slutt"]
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
    .addItem("Nullstill spelet (slett spelarar og handlar)", "nullstill")
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
      else if (/dato/.test(r[0])) celle.setNumberFormat("@").setValue(r[1]);   // datoar som tekst
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
  } else {
    // Walmart flytta frå NYSE til Nasdaq
    ark.getDataRange().getValues().forEach((r, i) => {
      if (String(r[0]).trim() === "NYSE:WMT") ark.getRange(i + 1, 1).setValue("NASDAQ:WMT");
    });
  }

  if (!bok.getSheetByName(A_SPELARAR)) hovud(bok.insertSheet(A_SPELARAR), K_SPELARAR);
  if (!bok.getSheetByName(A_HANDLAR)) hovud(bok.insertSheet(A_HANDLAR), K_HANDLAR);

  // Éin gong i timen: ta startkursar når spelet startar, og frys kursane når det er slutt.
  // Kvart tiande minutt: hent kursane frå Oslo Børs.
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["kvarTime", "hentKursar"].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("kvarTime").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("hentKursar").timeBased().everyMinutes(10).create();
  hentKursar();
}

function hovud(ark, kolonnar) {
  ark.getRange(1, 1, 1, kolonnar.length).setValues([kolonnar]).setFontWeight("bold");
  ark.setFrozenRows(1);
}

// Slettar alle spelarar og handlar, og dei lagra start- og sluttkursane
function nullstill() {
  const ui = SpreadsheetApp.getUi();
  const svar = ui.alert("Nullstill spelet", "Alle spelarar og handlar blir sletta. Er du sikker?", ui.ButtonSet.YES_NO);
  if (svar !== ui.Button.YES) return;
  [A_SPELARAR, A_HANDLAR].forEach(namn => {
    const ark = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(namn);
    if (ark.getLastRow() > 1) ark.getRange(2, 1, ark.getLastRow() - 1, ark.getLastColumn()).clearContent();
  });
  const selskap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(A_SELSKAP);
  if (selskap.getLastRow() > 1) selskap.getRange(2, 7, selskap.getLastRow() - 1, 2).clearContent();
  const o = lesOppsett();
  ["Startkursar tekne", "Sluttkursar frosne", "USDNOK ved slutt"].forEach(k => settOppsett(o, k, ""));
  CacheService.getScriptCache().remove("status");
}

function kvarTime() {
  hentKursar();
  const las = LockService.getScriptLock();
  las.waitLock(20000);
  try { sjekkFase(lesOppsett()); } finally { las.releaseLock(); }
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

/* ---------- Nettappen ---------- */

// GET → stoda i spelet: innstillingar, kursar og toppliste. Krev ikkje innlogging.
function doGet(e) {
  try {
    const cache = CacheService.getScriptCache();
    const lagra = cache.get("status");
    if (lagra) return ContentService.createTextOutput(lagra).setMimeType(ContentService.MimeType.JSON);
    const tekst = JSON.stringify(status());
    cache.put("status", tekst, 20);
    return ContentService.createTextOutput(tekst).setMimeType(ContentService.MimeType.JSON);
  } catch (feil) {
    return svar({ ok: false, feil: String(feil.message || feil) });
  }
}

// POST (JSON i body) → { f: "registrer" | "logginn" | "handel", brukar, pin, ... }
function doPost(e) {
  const las = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    las.waitLock(15000);
    let ut;
    if (d.f === "registrer") ut = registrer(d);
    else if (d.f === "logginn") ut = { meg: meg(loggInn(d)) };
    else if (d.f === "handel") ut = handel(d);
    else throw new Error("ukjend førespurnad");
    ut.ok = true;
    return svar(ut);
  } catch (feil) {
    return svar({ ok: false, feil: String(feil.message || feil) });
  } finally {
    try { las.releaseLock(); } catch (x) {}
  }
}

function status() {
  let o = lesOppsett();
  if (sjekkFase(o)) o = lesOppsett();
  const selskap = lesSelskap(o);
  const kurs = {};
  selskap.forEach(s => kurs[s.id] = s);
  const rekneskap = rekn(lesHandlar(), o.startsum);

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
    return { brukar: s.namn, verdi: Math.round(verdi), pst: o.startsum ? (verdi / o.startsum - 1) * 100 : 0, selskap: tal, storst: storst };
  });
  liste.sort((a, b) => b.verdi - a.verdi || a.brukar.localeCompare(b.brukar));

  return {
    ok: true,
    spel: { namn: o.namn, start: o.start, slutt: o.slutt, startsum: o.startsum, kurtasje: o.kurtasje, fase: o.fase, kode: !!o.kode },
    usdnok: o.usdnok,
    selskap: selskap.filter(s => s.kurs > 0)
      .map(s => ({ id: s.id, namn: s.namn, bors: s.bors, valuta: s.valuta, kurs: s.kurs, start: s.start })),
    toppliste: liste,
    oppdatert: new Date().toISOString()
  };
}

/* ---------- Spelarar ---------- */

function registrer(d) {
  const o = lesOppsett();
  const namn = String(d.brukar || "").trim();
  const pin = String(d.pin || "");
  if (o.fase === "ferdig") throw new Error("Spelet er slutt, så du kan ikkje melde deg på no.");
  if (!/^[A-Za-z0-9ÆØÅæøå_-]{3,16}$/.test(namn)) throw new Error("Brukarnamnet må ha 3–16 bokstavar, tal, _ eller -.");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN-koden må ha 4–8 siffer.");
  if (o.kode && String(d.kode || "").trim().toLowerCase() !== o.kode.toLowerCase()) throw new Error("Feil påmeldingskode.");
  const alle = lesSpelarar();
  if (alle.some(s => s.namn.toLowerCase() === namn.toLowerCase())) throw new Error("Brukarnamnet er oppteke. Vel eit anna.");
  if (alle.length >= MAKS_SPELARAR) throw new Error("Spelet er fullt.");
  // ' framfor teksten gjer at arket aldri tolkar han som ein formel
  ark(A_SPELARAR).appendRow(["'" + namn, hash(namn, pin), new Date()]);
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

// Kontantar, aksjepostar og dei siste handlane til éin spelar
function meg(namn) {
  const o = lesOppsett();
  const handlar = lesHandlar().filter(h => h.brukar.toLowerCase() === namn.toLowerCase());
  const r = rekn(handlar, o.startsum)[namn.toLowerCase()] || { kontantar: o.startsum, postar: {} };
  return {
    brukar: namn,
    kontantar: r.kontantar,
    postar: Object.keys(r.postar).filter(id => r.postar[id].tal > 0)
      .map(id => ({ id: id, tal: r.postar[id].tal, kost: r.postar[id].kost })),
    handlar: handlar.slice(-50).reverse().map(h => ({
      tid: h.tid, type: h.type, id: h.id, tal: h.tal, kurs: h.kurs, valuta: h.valuta, belop: h.belop, kurtasje: h.kurtasje
    }))
  };
}

/* ---------- Handel ---------- */

function handel(d) {
  const namn = loggInn(d);
  const o = lesOppsett();
  sjekkFase(o);
  if (o.fase === "for") throw new Error("Spelet har ikkje starta enno.");
  if (o.fase === "ferdig") throw new Error("Spelet er slutt.");

  const type = d.type === "SAL" ? "SAL" : "KJØP";
  const tal = Math.floor(Number(d.tal));
  if (!(tal >= 1 && tal <= MAKS_TAL)) throw new Error("Talet på aksjar må vere eit heiltal frå 1 og opp.");
  const s = lesSelskap(o).filter(x => x.id === String(d.id))[0];
  if (!s || !(s.kurs > 0)) throw new Error("Finn ikkje kursen på dette selskapet akkurat no.");
  const veksling = s.valuta === "USD" ? o.usdnok : 1;
  if (!(veksling > 0)) throw new Error("Manglar dollarkurs akkurat no.");

  const belop = kr(tal * s.kurs * veksling);
  const r = rekn(lesHandlar().filter(h => h.brukar.toLowerCase() === namn.toLowerCase()), o.startsum)[namn.toLowerCase()]
    || { kontantar: o.startsum, postar: {} };
  if (type === "KJØP") {
    if (belop + o.kurtasje > r.kontantar + 0.001) throw new Error("Du har ikkje nok kontantar. Handelen kostar " + Math.ceil(belop + o.kurtasje) + " kr.");
  } else {
    const eig = r.postar[s.id] ? r.postar[s.id].tal : 0;
    if (tal > eig) throw new Error("Du eig berre " + eig + " aksjar i " + s.namn + ".");
  }

  ark(A_HANDLAR).appendRow([new Date(), "'" + namn, type, s.id, tal, s.kurs, s.valuta, veksling, belop, o.kurtasje]);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove("status");
  return { meg: meg(namn), handel: { type: type, id: s.id, tal: tal, kurs: s.kurs, valuta: s.valuta, belop: belop } };
}

// Går gjennom handlane i rekkjefølgje og reknar ut kontantar og aksjepostar per spelar.
// Ingenting anna enn handlane blir lagra – saldoen blir rekna ut på nytt kvar gong.
function rekn(handlar, startsum) {
  const ut = {};
  handlar.forEach(h => {
    const k = h.brukar.toLowerCase();
    const r = ut[k] || (ut[k] = { kontantar: startsum, postar: {} });
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
  });
  return ut;
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
    kode: String(v["Påmeldingskode"] || "").trim(),
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
    return {
      rad: i + 2,
      id: String(r[0]).trim(),
      namn: String(r[1]).trim() || String(r[0]).trim(),
      bors: String(r[2]).trim() || "Oslo",
      valuta: String(r[3]).trim().toUpperCase() === "USD" ? "USD" : "NOK",
      kurs: (brukSlutt && tal(r[7])) || direkte,
      start: tal(r[6])
    };
  }).filter(s => s.id);
}

function lesSpelarar() {
  return ark(A_SPELARAR).getDataRange().getValues().slice(1).map((r, i) => ({
    rad: i + 2, namn: String(r[0]).trim(), hash: String(r[1]).trim()
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

function kr(n) {
  return Math.round(n * 100) / 100;
}

function svar(objekt) {
  return ContentService.createTextOutput(JSON.stringify(objekt)).setMimeType(ContentService.MimeType.JSON);
}
