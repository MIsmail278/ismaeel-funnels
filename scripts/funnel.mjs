#!/usr/bin/env node
// Funnel system CLI. Run from anywhere: node scripts/funnel.mjs <command>
//   build                     render every funnel from _content/, plus funnels.json and the hub
//   tag <slug>                create the Kit tag lead-<slug> (safe to re-run)
//   wire <slug>               connect the Kit form named lead-<slug> to the opt-in page
//   publish -m "<message>"    scan for secrets and raw media, commit, push
//   check <slug>              wait for the live site, then load the page like a phone
//   card <slug> --out <file>  write funnel-card.md
// The Kit key is read from KIT_API_KEY and never written anywhere or printed.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = path.resolve(ROOT, "..", "tools");
const CHROME = path.join(TOOLS, "remotion-project/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const PUPPETEER = path.join(TOOLS, "hyperframes/node_modules/");
const REGISTRY = path.join(ROOT, "funnels.json");
const TMP = path.join(ROOT, ".tmp");
const config = readJson(path.join(ROOT, "site.config.json"));

function readJson(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }
function write(f, s) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); }
function die(msg) { throw new Error(String(msg)); }
function git(args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

let cachedKey;
function kitKey() {
  if (cachedKey !== undefined) return cachedKey;
  let k = process.env.KIT_API_KEY || "";
  if (!k && process.platform === "win32") {
    k = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('KIT_API_KEY','User')"], { encoding: "utf8" }).trim();
  }
  cachedKey = k;
  return k;
}
function scrub(s) { const k = cachedKey; return k ? s.split(k).join("<KIT_API_KEY>") : s; }

async function kit(method, p, body) {
  const key = kitKey();
  if (!key) die("KIT_API_KEY is not set.");
  const v4 = key.startsWith("kit_");
  const url = v4 ? `https://api.kit.com/v4/${p}` : `https://api.convertkit.com/v3/${p}?api_key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(v4 ? { "X-Kit-Api-Key": key } : {}) },
      body: body ? JSON.stringify(v4 ? body.v4 : body.v3) : undefined,
    });
  } catch { die(`Kit ${method} ${p}: network error`); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) die(`Kit ${method} ${p}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Small inline format for content files: `code`, **bold**, [text](https://url)
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

function fill(tpl, values) {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in values)) die(`Template token {{${k}}} has no value`);
    return values[k];
  });
}
const template = (name) => fs.readFileSync(path.join(ROOT, "_template", name), "utf8");

function contents() {
  const dir = path.join(ROOT, "_content");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => {
    const c = readJson(path.join(dir, f));
    if (c.slug !== f.replace(/\.json$/, "")) die(`${f}: slug must match the file name`);
    if (!/^[A-Z0-9]+$/.test(c.keyword)) die(`${f}: keyword must be one all-caps word`);
    return c;
  });
}
function loadRegistry() { return fs.existsSync(REGISTRY) ? readJson(REGISTRY) : []; }
function saveRegistry(r) { write(REGISTRY, JSON.stringify(r, null, 2) + "\n"); }

function syncRegistry() {
  const old = Object.fromEntries(loadRegistry().map((e) => [e.slug, e]));
  const reg = contents().map((c) => ({
    slug: c.slug,
    keyword: c.keyword,
    tool: c.tool,
    tag: `lead-${c.slug}`,
    tag_id: old[c.slug]?.tag_id ?? null,
    kit_form_id: old[c.slug]?.kit_form_id ?? null,
    kit_form_uid: old[c.slug]?.kit_form_uid ?? null,
    kit_action: old[c.slug]?.kit_action ?? null,
    page_url: `${config.base}${c.slug}/`,
    setup_url: `${config.base}${c.slug}/setup.html`,
    date: c.date,
    video_file: c.video ?? null,
  })).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  saveRegistry(reg);
  return reg;
}

function steps(list) {
  return list.map((s) => {
    const code = (s.code || []).map((b) => `<div class="code">${b.label ? `<small>${esc(b.label)}</small>` : ""}<pre><code>${esc(b.text)}</code></pre></div>`).join("");
    return `      <li><h3>${inline(s.title)}</h3><p>${inline(s.body)}</p>${code}</li>`;
  }).join("\n");
}

function renderFunnel(c, e) {
  const live = Boolean(e.kit_action);
  const shared = { BRAND: esc(config.brand), HANDLE: esc(config.handle), INSTAGRAM: esc(config.instagram) };
  write(path.join(ROOT, c.slug, "index.html"), fill(template("index.html"), {
    ...shared,
    TITLE: esc(c.optin.title), DESCRIPTION: esc(c.optin.description), PAGE_URL: esc(e.page_url),
    OG_IMAGE: esc(`${config.base}assets/og/${c.slug}.jpg`),
    KEYWORD: esc(c.keyword), KEYWORD_LEN: String(c.keyword.length), HEADLINE: esc(c.optin.headline),
    BULLETS: c.optin.bullets.map((b) => `    <li>${inline(b)}</li>`).join("\n"),
    KIT_ACTION: live ? esc(e.kit_action) : "#", KIT_STATE: live ? "live" : "pending",
    KIT_TAG_ID: esc(e.tag_id ?? ""), KIT_DISABLED: live ? "" : " disabled",
    BUTTON: live ? esc(c.optin.button) : "Sign-up opens soon", PRIVACY: esc(c.optin.privacy),
  }));
  write(path.join(ROOT, c.slug, "setup.html"), fill(template("setup.html"), {
    ...shared,
    SETUP_TITLE: esc(c.setup.title), SETUP_INTRO: inline(c.setup.intro),
    SETUP_NEEDS: c.setup.needs.map((n) => `    <p>${inline(n)}</p>`).join("\n"),
    SETUP_SECTIONS: c.setup.sections.map((s) => `  <section>\n    <h2>${esc(s.heading)}</h2>${s.note ? `\n    <p>${inline(s.note)}</p>` : ""}\n    <ol class="steps">\n${steps(s.steps)}\n    </ol>\n  </section>`).join("\n"),
    SETUP_EYEBROW: esc(c.setup.eyebrow || "Your setup"),
    SETUP_TIPS: c.setup.tips.length ? `  <section>\n    <h2>${esc(c.setup.tipsHeading || "Five habits")}</h2>\n    <ul class="tips">\n${c.setup.tips.map((t) => `      <li><strong>${inline(t.title)}</strong>${inline(t.body)}</li>`).join("\n")}\n    </ul>\n  </section>` : "",
    OFFER_HEADING: esc(config.offer.heading), OFFER_BODY: esc(config.offer.body), OFFER_URL: esc(config.offer.url), OFFER_LABEL: esc(config.offer.label),
    SETUP_SOURCES: !c.setup.sources.length ? "" : "Source: " + c.setup.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.label)}</a>`).join(", "),
  }));
}

function renderHub(contentsBySlug, reg) {
  write(path.join(ROOT, "index.html"), fill(template("hub.html"), {
    BRAND: esc(config.brand), HANDLE: esc(config.handle), INSTAGRAM: esc(config.instagram), BASE: esc(config.base),
    HUB_OG_IMAGE: esc(`${config.base}assets/og/hub.jpg`),
    HUB_ROWS: reg.map((e) => `    <li><a href="${esc(e.slug)}/"><b>${esc(e.keyword)}</b><span>${esc(e.tool)}. ${esc(contentsBySlug[e.slug].hub)}</span></a></li>`).join("\n"),
  }));
}

async function browser() {
  const puppeteer = createRequire(PUPPETEER)("puppeteer-core");
  return puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--allow-file-access-from-files", "--no-sandbox"] });
}

async function renderOg(items) {
  const todo = items.filter((i) => !fs.existsSync(i.out));
  if (!todo.length) return;
  const b = await browser();
  try {
    fs.mkdirSync(TMP, { recursive: true });
    for (const i of todo) {
      const f = path.join(TMP, `og-${path.basename(i.out, ".jpg")}.html`);
      const size = Math.min(300, Math.floor(1056 / (i.word.length * 0.54)));
      write(f, fill(template("og.html"), { ROOT: pathToFileURL(ROOT).href + "/", OG_SIZE: String(size), OG_WORD: esc(i.word), OG_LINE: esc(i.line), HANDLE: esc(config.handle) }));
      const p = await b.newPage();
      await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      await p.goto(pathToFileURL(f).href, { waitUntil: "load" });
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({ path: i.out, type: "jpeg", quality: 86 });
      await p.close();
    }
  } finally { await b.close(); }
}

async function build() {
  const list = contents();
  const reg = syncRegistry();
  const bySlug = Object.fromEntries(list.map((c) => [c.slug, c]));
  for (const e of reg) renderFunnel(bySlug[e.slug], e);
  renderHub(bySlug, reg);
  await renderOg([
    ...list.map((c) => ({ out: path.join(ROOT, "assets/og", `${c.slug}.jpg`), word: c.keyword, line: c.optin.headline })),
    { out: path.join(ROOT, "assets/og/hub.jpg"), word: "Comment.", line: "Every tool from my reels. Full setup, free." },
  ]);
  console.log(`Built ${reg.length} funnel(s) and the hub.`);
}

function entry(slug) {
  const e = loadRegistry().find((x) => x.slug === slug);
  if (!e) die(`No funnel "${slug}" in funnels.json. Add _content/${slug}.json and run build.`);
  return e;
}
function updateEntry(slug, patch) { saveRegistry(loadRegistry().map((x) => (x.slug === slug ? { ...x, ...patch } : x))); }

async function tag(slug) {
  const e = entry(slug);
  const { tags = [] } = await kit("GET", "tags");
  let t = tags.find((x) => x.name.toLowerCase() === e.tag.toLowerCase());
  let made = false;
  if (!t) {
    const j = await kit("POST", "tags", { v3: { tag: { name: e.tag } }, v4: { name: e.tag } });
    t = j.tag || j;
    made = true;
  }
  updateEntry(slug, { tag_id: t.id });
  console.log(`Kit tag ${e.tag}: ${made ? "created" : "already exists"} (id ${t.id})`);
}

async function wire(slug) {
  const e = entry(slug);
  const { forms = [] } = await kit("GET", "forms");
  const f = forms.find((x) => x.name === e.tag && !x.archived);
  if (!f) die(`No Kit form named "${e.tag}" yet. Create it first (see funnel-card.md), then re-run.`);
  let action = `https://app.kit.com/forms/${f.id}/subscriptions`;
  if (f.embed_url) {
    const html = await fetch(f.embed_url).then((r) => r.text()).catch(() => "");
    const m = html.match(/<form[^>]+action="(https:[^"]+)"/i);
    if (m) action = m[1];
  }
  updateEntry(slug, { kit_form_id: f.id, kit_form_uid: f.uid ?? null, kit_action: action });
  console.log(`Wired ${e.tag}: form ${f.id}`);
  await build();
}

function publish(message) {
  if (!message) die('publish needs -m "<message>"');
  git(["add", "-A"]);
  const files = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  if (!files.length) { console.log("Nothing to publish."); return; }
  const key = kitKey();
  const problems = [];
  for (const f of files) {
    if (/\.(mp4|mov|m4v|mkv|avi|webm|wav|mp3)$/i.test(f) || /(^|\/)\.env/.test(f)) problems.push(`${f}: raw media or env file`);
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).size > 5e6) problems.push(`${f}: larger than 5 MB`);
    const text = fs.readFileSync(full);
    if (key && text.includes(key)) problems.push(`${f}: contains the Kit API key`);
  }
  if (problems.length) {
    git(["reset"]);
    die("Refused to publish:\n" + problems.join("\n"));
  }
  git(["commit", "-m", message]);
  git(["push", "origin", "main"]);
  console.log(`Published ${files.length} file(s).`);
}

const norm = (s) => s.replace(/\r\n/g, "\n").trim();
async function waitLive(url, localFile, seconds = 300) {
  const want = norm(fs.readFileSync(localFile, "utf8"));
  const end = Date.now() + seconds * 1000;
  let status = 0;
  while (Date.now() < end) {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    status = r?.status ?? 0;
    if (r?.ok && norm(await r.text()) === want) return true;
    await new Promise((d) => setTimeout(d, 8000));
  }
  die(`${url} did not match the local build within ${seconds}s (last HTTP ${status})`);
}

async function check(slug) {
  const e = entry(slug);
  await waitLive(e.page_url, path.join(ROOT, slug, "index.html"));
  await waitLive(e.setup_url, path.join(ROOT, slug, "setup.html"));
  await waitLive(config.base, path.join(ROOT, "index.html"));
  const setup = await fetch(e.setup_url).then((r) => r.text());
  const noindex = /<meta name="robots" content="noindex">/.test(setup);
  const b = await browser();
  let report;
  const shot = path.join(TMP, `check-${slug}.png`);
  try {
    fs.mkdirSync(TMP, { recursive: true });
    const p = await b.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const failed = [];
    p.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    await p.goto(e.page_url, { waitUntil: "networkidle0", timeout: 45000 });
    await p.evaluate(() => document.fonts.ready);
    report = await p.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null; };
      const kw = document.querySelector(".keyword");
      return {
        form: box("#signup"), name: box('input[name="fields[first_name]"]'), email: box('input[name="email_address"]'), button: box("#signup button"),
        kitState: document.querySelector("#signup")?.dataset.state,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        keywordFits: kw ? kw.scrollWidth <= kw.clientWidth : null,
      };
    });
    report.failedRequests = failed.filter((u) => !u.includes("favicon"));
    await p.screenshot({ path: shot });
  } finally { await b.close(); }
  const ok = report.form?.h > 0 && report.name?.w > 0 && report.email?.w > 0 && report.button?.w > 0 && !report.horizontalOverflow && report.keywordFits && !report.failedRequests.length && noindex;
  console.log(JSON.stringify({ page: e.page_url, setupNoindex: noindex, ...report, screenshot: shot }, null, 2));
  console.log(ok ? `LIVE and rendering. Kit form: ${report.kitState === "live" ? "CONNECTED" : "PENDING"}` : "CHECK FAILED");
  if (!ok) process.exitCode = 1;
}

function card(slug, out) {
  if (!out) die("card needs --out <file>");
  const e = entry(slug);
  const c = readJson(path.join(ROOT, "_content", `${slug}.json`));
  const url = (s) => s.split("{{URL}}").join(e.page_url);
  const dm = url(c.card.dm);
  if (dm.length >= 300) die(`DM is ${dm.length} characters. It must stay under 300.`);
  const kitSteps = e.kit_action ? "" : `## Finish in Kit first (about 3 minutes)

The page shows "Sign-up opens soon" until this is done. Kit's API cannot create forms. The tag \`${e.tag}\` is already created.

1. Go to app.kit.com. In the left menu: **Audience growth** > **Landing Pages & Forms**. Click **+ New**.
2. Choose **Form**, then **Inline**, then any template. The design doesn't matter, your page has its own.
3. Name the form exactly \`${e.tag}\`, then **Save & Publish**.
4. Click **Settings** > **Confirmation Email**. Tick **Send confirmation email**. Leave **Auto-confirm new subscribers** unticked.
5. Under **After confirming redirect to**, choose the URL option and paste: ${e.setup_url}
6. Click **Edit Email Contents**. Set the subject and body below, name the button, then **Save**.
7. Tell Claude "wire the ${slug} form". That runs \`node scripts/funnel.mjs wire ${slug}\`, then publishes and re-checks the page.

Subject:

\`\`\`
${c.email.subject}
\`\`\`

Body:

\`\`\`
${c.email.body}
\`\`\`

Button text: **${c.email.button}**

`;
  let text = fill(template("funnel-card.md"), {
    TOOL: c.tool, KEYWORD: c.keyword, PAGE_URL: e.page_url, SETUP_URL: e.setup_url,
    KIT_STATUS: e.kit_action ? `Connected (form ${e.kit_form_id}, tag \`${e.tag}\`)` : `**Not connected yet.** See "Finish in Kit first" below. Don't post until it's done.`,
    VIDEO: c.video || "None. Test funnel.",
    CAPTION: url(c.card.caption), DM: dm, DM_LEN: String(dm.length), FOLLOWUP: url(c.card.followup), KIT_SECTION: kitSteps,
  });
  // A live automation replaces the manual checklist.
  if (c.card.automation) {
    text = text.slice(0, text.indexOf("## 2-minute DM tool checklist")) + `## DM tool\n\n${c.card.automation}\n\nTest it: comment \`${c.keyword}\` from a different account, because your own comments never trigger a DM. Tap the link in the DM and confirm the page opens.\n`;
  }
  write(path.resolve(out), text);
  console.log(`Wrote ${path.resolve(out)} (DM ${dm.length} characters)`);
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
try {
  if (cmd === "build") await build();
  else if (cmd === "tag") await tag(args[0]);
  else if (cmd === "wire") await wire(args[0]);
  else if (cmd === "publish") publish(flag("-m"));
  else if (cmd === "check") await check(args[0]);
  else if (cmd === "card") card(args[0], flag("--out"));
  else die("Commands: build | tag <slug> | wire <slug> | publish -m <msg> | check <slug> | card <slug> --out <file>");
} catch (err) {
  // exitCode, not process.exit(): exiting with fetch handles open crashes Node on Windows.
  console.error("ERROR: " + scrub(err.message));
  process.exitCode = 1;
}
