# FridgeChef — What's in Your Fridge? Get a Recipe

Tell FridgeChef what ingredients you have, and get real recipes you can cook
tonight — with clear steps matched to your ingredients, diet, and time.
Built with **Firebase AI Logic hybrid inference** and **structured output**.

## What it does

- Add the ingredients you have (type them, or tap the common ones).
- Set servings, diet (anything / vegetarian / vegan / gluten-free), and max
  time.
- Press **Find recipes**. You get three recipes as clean cards: title, time,
  difficulty, servings, ingredients, numbered steps, and a tip.
- Recipes come back as **structured JSON**, so the app renders them as
  usable recipe cards instead of a wall of text. Copy any recipe with one
  click.
- Each result shows where it was generated — **on-device** with Gemini Nano
  or **in the cloud** with Gemini.

## How it uses Firebase AI Logic

- `app.js` initializes Firebase and the AI service with the **Gemini
  Developer API** backend:
  `getAI(firebaseApp, { backend: new GoogleAIBackend() })`.
- The model is created **on the Find recipes click** (a user interaction, as
  required) with `getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })`.
  Modes: `PREFER_ON_DEVICE` (auto), `ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`.
- The prompt asks for **structured output**: exactly 3 recipes as a JSON
  array with the keys `title`, `time`, `difficulty`, `serves`,
  `ingredients`, `steps`, `tip`. `app.js` parses the JSON defensively and
  renders recipe cards (with a plain-text fallback if parsing fails).
- The response's `inferenceSource` (`ON_DEVICE` or `IN_CLOUD`) is shown as
  a badge on the results.
- App Check is set up in `initFirebase()` (debug token accepted for local
  development — register the token printed in the console under
  Firebase console > App Check > your web app > Manage debug tokens).

## Run it

No build step. Serve the folder over HTTP (required for ES modules) and open
it in Chrome (desktop, v139+ for on-device inference):

```bash
# from this folder
python3 -m http.server 8082
# then open http://localhost:8082
```

Enable the on-device model in Chrome once:
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled,
then restart Chrome.

## Connect your Firebase project (2 minutes)

1. Go to https://console.firebase.google.com and create a project (free).
2. Open **Firebase AI Logic**, click **Get started**, choose the
   **Gemini Developer API** provider.
3. In Project settings, add a **Web app** and copy its `firebaseConfig`.
4. Paste the values into `firebase-config.js`, replacing the `YOUR_...`
   placeholders.
5. Reload the page — the banner switches from Demo Mode to Live.

Without a config the app runs in **Demo Mode** with built-in sample recipes
so the interface can be explored; live AI requires a real Firebase project.
Text inference with Firebase AI Logic is free within usage limits.

## Tech

- Firebase AI Logic JS SDK v13 (`firebase/app`, `firebase/ai`,
  `firebase/app-check`) via CDN import map — no bundler.
- Vanilla HTML/CSS/JS. No data leaves the device except the prompt sent to
  the model you choose.

## License

Apache License 2.0 — see `LICENSE`.
