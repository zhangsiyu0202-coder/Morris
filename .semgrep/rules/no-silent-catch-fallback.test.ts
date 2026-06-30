// Semgrep test fixture for `no-silent-catch-fallback`.

async function bad1() {
  // ruleid: no-silent-catch-fallback
  try {
    return await fetch("/api");
  } catch {
    return null;
  }
}

async function bad2() {
  // ruleid: no-silent-catch-fallback
  try {
    return JSON.parse("x");
  } catch (e) {
    return null;
  }
}

async function bad3() {
  // ruleid: no-silent-catch-fallback
  try {
    return await loadAll();
  } catch {
    return [];
  }
}

async function bad4() {
  // ruleid: no-silent-catch-fallback
  try {
    return await loadDef();
  } catch (e) {
    return undefined;
  }
}

// Best-effort cleanup is documented via the standard semgrep disable.
async function good1() {
  // ok: no-silent-catch-fallback
  // nosemgrep: no-silent-catch-fallback (best-effort rollback)
  try {
    await fetch("/api");
  } catch {
    return null;
  }
}

// Catching to translate to a typed result is fine — `{ok:false}` is not a "null fallback".
async function good2() {
  // ok: no-silent-catch-fallback
  try {
    await api();
    return { ok: true };
  } catch {
    return { ok: false, code: "transient" };
  }
}

// Re-throwing translated errors is fine.
async function good3() {
  // ok: no-silent-catch-fallback
  try {
    await loadConfig();
  } catch (e) {
    throw new Error("config_load_failed", { cause: e });
  }
}
