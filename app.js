// FridgeChef — Recipes from your ingredients, with Firebase AI Logic.
// Hybrid inference: simple requests run ON-DEVICE (Gemini Nano); complex
// requests fall back to the CLOUD (Gemini). Recipes come back as structured
// JSON so the app can render clean, usable recipe cards.
// ---------------------------------------------------------------------------
import { initializeApp } from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { firebaseConfig, isConfigured } from "./firebase-config.js";

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ingInput = $("ingInput");
const ingChips = $("ingChips");
const resultsEl = $("results");
const sourceBadge = $("sourceBadge");
const cookBtn = $("cookBtn");
const statusLine = $("statusLine");
const demoBanner = $("demoBanner");
const engineBadge = $("engineBadge");

let firebaseApp = null;
let ai = null;
let ingredients = [];

// ---------------------------------------------------------------------------
// Demo recipes (used when no Firebase config is present)
// ---------------------------------------------------------------------------
const DEMO_RECIPES = [
  {
    title: "One-Pan Garlic Chicken & Rice",
    time: "30 min", difficulty: "Easy", serves: 2,
    ingredients: ["2 chicken thighs", "1 cup rice", "3 garlic cloves", "1 onion", "2 cups chicken stock", "salt, pepper, paprika"],
    steps: [
      "Season the chicken with salt, pepper, and paprika.",
      "Brown the chicken in a hot oiled pan, 4 minutes per side, then set aside.",
      "Soften the onion and garlic in the same pan for 2 minutes.",
      "Add the rice and stock, return the chicken, cover, and simmer 20 minutes until the rice is tender.",
    ],
    tip: "Let it rest 5 minutes off the heat before serving — the rice finishes steaming.",
  },
  {
    title: "Tomato Egg Stir-Fry",
    time: "15 min", difficulty: "Easy", serves: 2,
    ingredients: ["3 eggs", "2 tomatoes", "1 spring onion", "1 tsp sugar", "salt", "oil"],
    steps: [
      "Beat the eggs with a pinch of salt and scramble in hot oil until just set. Set aside.",
      "Cook the tomatoes in the same pan until they soften and release juice, about 3 minutes.",
      "Return the eggs, add sugar and salt, and stir gently for 1 minute.",
      "Top with chopped spring onion and serve with rice.",
    ],
    tip: "Keep the eggs slightly undercooked — they finish in the pan's residual heat.",
  },
  {
    title: "Crispy Cheesy Potato Wedges",
    time: "35 min", difficulty: "Easy", serves: 2,
    ingredients: ["3 potatoes", "2 tbsp oil", "1/2 cup grated cheese", "paprika", "salt", "pepper"],
    steps: [
      "Heat the oven to 220°C (425°F). Cut the potatoes into wedges.",
      "Toss with oil, paprika, salt, and pepper.",
      "Spread on a baking tray and roast 25 minutes, turning once.",
      "Sprinkle with cheese and roast 5 more minutes until melted and golden.",
    ],
    tip: "Soak the wedges in cold water for 10 minutes first for extra crispiness.",
  },
];

// ---------------------------------------------------------------------------
// Firebase setup
// ---------------------------------------------------------------------------
function initFirebase() {
  if (!isConfigured) return false;
  try {
    firebaseApp = initializeApp(firebaseConfig);
    try {
      initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider("6Ld4JjMuAAAAAIYZ9eIoz1eMsfraeFWjtYVQPmbk"),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("App Check setup skipped:", e);
    }
    ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    return true;
  } catch (e) {
    console.error("Firebase init failed:", e);
    return false;
  }
}

function inferenceModeFromSelect() {
  const v = document.getElementById("modeSelect").value;
  if (v === "device-only") return InferenceMode.ONLY_ON_DEVICE;
  if (v === "cloud-only") return InferenceMode.ONLY_IN_CLOUD;
  return InferenceMode.PREFER_ON_DEVICE;
}

// The Firebase AI Logic SDK returns inferenceSource as lowercase
// snake_case ("in_cloud" / "on_device"), not the uppercase enum names
// ("IN_CLOUD" / "ON_DEVICE"). Normalize it to the app's canonical form so
// the source badge below matches a live response.
function normalizeSource(value) {
  const v = String(value || "in_cloud").toUpperCase().replace(/-/g, "_");
  if (v === "ON_DEVICE") return "ON_DEVICE";
  if (v === "IN_CLOUD") return "IN_CLOUD";
  return v;
}

// ---------------------------------------------------------------------------
// Structured output: ask for JSON, parse defensively.
// ---------------------------------------------------------------------------
function buildPrompt() {
  const servings = document.getElementById("servings").value;
  const diet = document.getElementById("diet").value;
  const maxTime = document.getElementById("maxTime").value;
  return (
    `You are a helpful cooking assistant. Given the ingredients below, suggest exactly 3 different recipes the user can cook tonight.\n\n` +
    `Ingredients available: ${ingredients.join(", ")}.\n` +
    `Servings: ${servings}. Diet: ${diet === "any" ? "no restrictions" : diet}. ` +
    `Maximum cooking time: ${maxTime === "120" ? "no limit" : maxTime + " minutes"}.\n\n` +
    `Use mainly the listed ingredients; you may assume basic pantry items (oil, salt, pepper, water). ` +
    `Reply with ONLY a JSON array (no markdown fences, no extra text). Each recipe is an object with these exact keys:\n` +
    `{"title": string, "time": string like "25 min", "difficulty": "Easy" | "Medium" | "Hard", "serves": number, ` +
    `"ingredients": [string, ...], "steps": [string, ...], "tip": string}\n` +
    `Give 3-6 ingredients and 4-6 steps per recipe.`
  );
}

function parseRecipes(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr
      .filter((r) => r && r.title && Array.isArray(r.steps))
      .map((r) => ({
        title: String(r.title),
        time: String(r.time || ""),
        difficulty: String(r.difficulty || ""),
        serves: Number(r.serves) || 2,
        ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(String) : [],
        steps: r.steps.map(String),
        tip: String(r.tip || ""),
      }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function setSourceBadge(source) {
  sourceBadge.hidden = false;
  sourceBadge.className = "source-badge";
  if (source === "ON_DEVICE") {
    sourceBadge.textContent = "● On-device · Gemini Nano";
    sourceBadge.classList.add("source-device");
  } else if (source === "IN_CLOUD") {
    sourceBadge.textContent = "● Cloud · Gemini";
    sourceBadge.classList.add("source-cloud");
  } else {
    sourceBadge.textContent = "● Demo Mode";
    sourceBadge.classList.add("source-demo");
  }
}
function renderRecipes(recipes) {
  resultsEl.innerHTML = "";
  recipes.forEach((r) => {
    const card = document.createElement("article");
    card.className = "recipe";
    const ing = r.ingredients.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    const steps = r.steps.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    card.innerHTML = `
      <h3></h3>
      <div class="recipe-meta">
        <span class="meta-pill">⏱ ${escapeHtml(r.time)}</span>
        <span class="meta-pill">${escapeHtml(r.difficulty)}</span>
        <span class="meta-pill">Serves ${escapeHtml(r.serves)}</span>
      </div>
      <h4>Ingredients</h4>
      <ul>${ing}</ul>
      <h4>Steps</h4>
      <ol>${steps}</ol>
      ${r.tip ? `<div class="tip">💡 ${escapeHtml(r.tip)}</div>` : ""}
      <div class="recipe-actions">
        <button class="btn btn-ghost" type="button">Copy recipe</button>
      </div>`;
    card.querySelector("h3").textContent = r.title;
    card.querySelector(".recipe-actions button").addEventListener("click", async () => {
      const text = `${r.title}\nTime: ${r.time} · ${r.difficulty} · Serves ${r.serves}\n\nIngredients:\n- ${r.ingredients.join("\n- ")}\n\nSteps:\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}${r.tip ? `\n\nTip: ${r.tip}` : ""}`;
      try {
        await navigator.clipboard.writeText(text);
        statusLine.textContent = `Copied "${r.title}".`;
      } catch {
        statusLine.textContent = "Copy failed — select the text and copy it manually.";
      }
    });
    resultsEl.appendChild(card);
  });
}
function renderChips() {
  ingChips.innerHTML = "";
  ingredients.forEach((ing) => {
    const chip = document.createElement("span");
    chip.className = "ing-chip";
    chip.innerHTML = `<span></span><button type="button" aria-label="Remove">×</button>`;
    chip.querySelector("span").textContent = ing;
    chip.querySelector("button").addEventListener("click", () => {
      ingredients = ingredients.filter((x) => x !== ing);
      renderChips();
    });
    ingChips.appendChild(chip);
  });
}
function setBusy(busy) {
  cookBtn.disabled = busy;
  cookBtn.textContent = busy ? "Cooking up ideas…" : "🍳 Find recipes";
}

// ---------------------------------------------------------------------------
// Find recipes
// ---------------------------------------------------------------------------
async function findRecipes() {
  if (ingredients.length < 2) {
    statusLine.textContent = "Add at least 2 ingredients first.";
    ingInput.focus();
    return;
  }
  setBusy(true);
  sourceBadge.hidden = true;
  resultsEl.innerHTML = '<p class="placeholder">Finding recipes…</p>';

  if (!isConfigured || !ai) {
    // Demo mode.
    await new Promise((r) => setTimeout(r, 600));
    renderRecipes(DEMO_RECIPES);
    setSourceBadge("DEMO");
    statusLine.textContent = "Demo Mode — add your Firebase config in firebase-config.js for live AI recipes.";
    setBusy(false);
    return;
  }

  // Live mode: Firebase AI Logic, hybrid inference.
  // NOTE: getGenerativeModel is called here, on the button click, because
  // the inference mode requires a user interaction.
  try {
    const model = getGenerativeModel(ai, {
      mode: inferenceModeFromSelect(),
      inCloudParams: {
        model: "gemini-3.5-flash-lite",
        generationConfig: { maxOutputTokens: 2000, temperature: 0.7 },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: "You are a helpful cooking assistant. Always reply with valid JSON only." }],
            },
          ],
        },
      },
    });
    const result = await model.generateContent(buildPrompt());
    const response = await result.response;
    const raw = response.text();
    const source = normalizeSource(response.inferenceSource);
    const recipes = parseRecipes(raw);
    if (!recipes || !recipes.length) {
      // Fallback: show the raw text so nothing is lost.
      resultsEl.innerHTML = `<article class="recipe"><h3>Recipes</h3><p style="white-space:pre-wrap"></p></article>`;
      resultsEl.querySelector("p").textContent = raw;
      setSourceBadge(source);
      statusLine.textContent = "The AI reply was not valid JSON, so it is shown as text.";
    } else {
      renderRecipes(recipes);
      setSourceBadge(source);
      statusLine.textContent =
        source === "ON_DEVICE"
          ? `Found ${recipes.length} recipes on-device with Gemini Nano — private, fast, and free.`
          : `Found ${recipes.length} recipes in the cloud with Gemini.`;
    }
  } catch (e) {
    console.error(e);
    const msg = (e && e.message) || String(e);
    resultsEl.innerHTML = `<p class="placeholder">Could not find recipes: ${escapeHtml(msg)}</p>`;
    if (/on-device|ONLY_ON_DEVICE|not available/i.test(msg)) {
      statusLine.textContent = "On-device inference is not available in this browser. Try the Auto or Cloud mode.";
    } else {
      statusLine.textContent = "Something went wrong. Check your Firebase config and connection, then try again.";
    }
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Wire up UI
// ---------------------------------------------------------------------------
function addIngredient(raw) {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return;
  // Split on commas so "chicken, rice" adds two ingredients.
  value.split(",").map((s) => s.trim()).filter(Boolean).forEach((v) => {
    if (!ingredients.includes(v)) ingredients.push(v);
  });
  ingInput.value = "";
  renderChips();
  statusLine.textContent = ingredients.length >= 2
    ? `${ingredients.length} ingredients — press Find recipes.`
    : "Add at least 2 ingredients.";
}
$("addIngBtn").addEventListener("click", () => addIngredient(ingInput.value));
ingInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addIngredient(ingInput.value);
});
document.querySelectorAll("[data-ing]").forEach((b) => {
  b.addEventListener("click", () => addIngredient(b.dataset.ing));
});
cookBtn.addEventListener("click", findRecipes);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
renderChips();
if (!isConfigured) {
  demoBanner.hidden = false;
  engineBadge.textContent = "Demo Mode";
} else {
  const ok = initFirebase();
  engineBadge.textContent = ok ? "Firebase AI Logic · Live" : "Demo Mode";
  if (!ok) demoBanner.hidden = false;
}
