// Common hackathon tracks with hand-picked starting points.
// When the real tracks drop, add them in the UI (or bulk-paste); these stay as a fallback library.

export const GENERAL_KIT = [
  { title: 'Supabase', url: 'https://supabase.com/docs', desc: 'Postgres + auth + storage in minutes' },
  { title: 'Firebase', url: 'https://firebase.google.com/docs', desc: 'Auth, Firestore, hosting' },
  { title: 'Vercel', url: 'https://vercel.com/docs', desc: 'Deploy frontends / Next.js instantly' },
  { title: 'Render', url: 'https://render.com/docs', desc: 'Free-tier backend hosting' },
  { title: 'Claude API docs', url: 'https://docs.claude.com', desc: 'LLM API for agents, summarisation, extraction' },
  { title: 'Ollama', url: 'https://ollama.com', desc: 'Run open LLMs locally (no API quota)' },
  { title: 'shadcn/ui', url: 'https://ui.shadcn.com', desc: 'Copy-paste React components' },
  { title: 'Tailwind CSS', url: 'https://tailwindcss.com/docs', desc: 'Utility-first styling' },
  { title: 'Leaflet', url: 'https://leafletjs.com', desc: 'Free interactive maps (with OpenStreetMap)' },
  { title: 'Nominatim', url: 'https://nominatim.org/release-docs/latest/api/Overview/', desc: 'Free geocoding on OSM data' },
  { title: 'Streamlit', url: 'https://docs.streamlit.io', desc: 'Python data apps / demos fast' },
  { title: 'Excalidraw', url: 'https://excalidraw.com', desc: 'Architecture diagrams for the pitch' },
  { title: 'Devpost', url: 'https://devpost.com', desc: 'Submission page + past winning projects for inspiration' },
];

export const PRESETS = [
  {
    id: 'ai-ml', name: 'AI / Machine Learning', query: 'llm agent rag',
    description: 'Generative AI, LLM agents, computer vision, NLP.',
    links: [
      { title: 'Hugging Face', url: 'https://huggingface.co', desc: 'Models, datasets, Spaces' },
      { title: 'HF Papers', url: 'https://huggingface.co/papers', desc: 'Trending ML papers with code' },
      { title: 'Claude API docs', url: 'https://docs.claude.com', desc: 'Tool use, agents, vision' },
      { title: 'Kaggle Datasets', url: 'https://www.kaggle.com/datasets', desc: 'Huge dataset catalogue' },
      { title: 'scikit-learn', url: 'https://scikit-learn.org/stable/', desc: 'Classic ML in Python' },
      { title: 'Gradio', url: 'https://www.gradio.app/docs', desc: 'Instant ML demo UIs' },
    ],
  },
  {
    id: 'fintech', name: 'FinTech', query: 'finance fraud detection',
    description: 'Payments, personal finance, trading, fraud, open banking.',
    links: [
      { title: 'Stripe docs', url: 'https://docs.stripe.com', desc: 'Payments (test mode is free)' },
      { title: 'Open Banking UK', url: 'https://www.openbanking.org.uk', desc: 'UK open banking standards' },
      { title: 'Alpha Vantage', url: 'https://www.alphavantage.co/documentation/', desc: 'Free stock / FX / crypto data (free key)' },
      { title: 'yfinance', url: 'https://github.com/ranaroussi/yfinance', desc: 'Yahoo Finance market data in Python' },
      { title: 'CoinGecko API', url: 'https://docs.coingecko.com', desc: 'Crypto prices' },
      { title: 'Frankfurter', url: 'https://frankfurter.dev', desc: 'Free FX rates, no key' },
    ],
  },
  {
    id: 'health', name: 'HealthTech', query: 'healthcare medical',
    description: 'Health, wellbeing, medical data, accessibility.',
    links: [
      { title: 'openFDA', url: 'https://open.fda.gov/apis/', desc: 'Drugs, devices, adverse events' },
      { title: 'NHS developer APIs', url: 'https://digital.nhs.uk/developer', desc: 'NHS APIs & sandbox' },
      { title: 'WHO GHO data', url: 'https://www.who.int/data/gho', desc: 'Global health observatory' },
      { title: 'PhysioNet', url: 'https://physionet.org', desc: 'Physiological datasets' },
      { title: 'MedlinePlus Connect', url: 'https://medlineplus.gov/medlineplus-connect/', desc: 'Consumer health info API' },
    ],
  },
  {
    id: 'climate', name: 'Sustainability / Climate', query: 'climate carbon emissions',
    description: 'Climate, energy, environment, sustainability.',
    links: [
      { title: 'Carbon Intensity API (UK)', url: 'https://carbonintensity.org.uk', desc: 'UK grid carbon forecast, no key' },
      { title: 'Open-Meteo', url: 'https://open-meteo.com', desc: 'Free weather & climate API, no key' },
      { title: 'OpenAQ', url: 'https://openaq.org', desc: 'Air quality data' },
      { title: 'NASA Earthdata', url: 'https://www.earthdata.nasa.gov', desc: 'Satellite / earth science data' },
      { title: 'Climatiq', url: 'https://www.climatiq.io/docs', desc: 'Emission factors API' },
      { title: 'Our World in Data', url: 'https://ourworldindata.org', desc: 'Downloadable charts & CSVs' },
    ],
  },
  {
    id: 'security', name: 'Cybersecurity', query: 'security vulnerability',
    description: 'Security tooling, privacy, threat detection, CTF.',
    links: [
      { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/', desc: 'Common web vulns' },
      { title: 'NVD CVE API', url: 'https://nvd.nist.gov/developers', desc: 'Vulnerability database API' },
      { title: 'MITRE ATT&CK', url: 'https://attack.mitre.org', desc: 'Adversary tactics & techniques' },
      { title: 'CyberChef', url: 'https://gchq.github.io/CyberChef/', desc: 'Encoding / crypto swiss-army knife' },
      { title: 'Have I Been Pwned API', url: 'https://haveibeenpwned.com/API/v3', desc: 'Breach & password checks' },
    ],
  },
  {
    id: 'edtech', name: 'EdTech', query: 'education learning',
    description: 'Learning, students, teaching tools.',
    links: [
      { title: 'Open Library API', url: 'https://openlibrary.org/developers/api', desc: 'Books metadata, no key' },
      { title: 'Open Trivia DB', url: 'https://opentdb.com', desc: 'Quiz questions API' },
      { title: 'MediaWiki API', url: 'https://www.mediawiki.org/wiki/API:Main_page', desc: 'Wikipedia content' },
      { title: 'OpenStax', url: 'https://openstax.org', desc: 'Free textbooks' },
    ],
  },
  {
    id: 'gaming', name: 'Games', query: 'game engine',
    description: 'Games, interactive experiences, creative coding.',
    links: [
      { title: 'Godot', url: 'https://docs.godotengine.org', desc: 'Free open-source engine' },
      { title: 'Phaser', url: 'https://phaser.io', desc: 'HTML5 2D game framework' },
      { title: 'Three.js', url: 'https://threejs.org', desc: '3D in the browser' },
      { title: 'Kenney assets', url: 'https://kenney.nl/assets', desc: 'Free CC0 game assets' },
      { title: 'OpenGameArt', url: 'https://opengameart.org', desc: 'Free sprites, audio' },
      { title: 'itch.io free assets', url: 'https://itch.io/game-assets/free', desc: 'Asset packs' },
    ],
  },
  {
    id: 'civic', name: 'Social Good / Civic', query: 'open data government',
    description: 'Communities, transport, cities, public services, accessibility.',
    links: [
      { title: 'data.gov.uk', url: 'https://www.data.gov.uk', desc: 'UK government datasets' },
      { title: 'TfL Unified API', url: 'https://api.tfl.gov.uk', desc: 'London transport data' },
      { title: 'Transport for Greater Manchester open data', url: 'https://tfgm.com/open-data', desc: 'Local (Manchester) transport data' },
      { title: 'data.police.uk API', url: 'https://data.police.uk/docs/', desc: 'Street-level crime, no key' },
      { title: 'ONS API', url: 'https://developer.ons.gov.uk', desc: 'UK statistics' },
      { title: 'World Bank API', url: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392', desc: 'Global development indicators' },
    ],
  },
  {
    id: 'hardware', name: 'Hardware / IoT', query: 'arduino iot sensor',
    description: 'Embedded, sensors, robotics, IoT.',
    links: [
      { title: 'Arduino docs', url: 'https://docs.arduino.cc', desc: 'Boards, libraries, tutorials' },
      { title: 'Raspberry Pi docs', url: 'https://www.raspberrypi.com/documentation/', desc: 'Pi setup & GPIO' },
      { title: 'MicroPython', url: 'https://docs.micropython.org', desc: 'Python on microcontrollers' },
      { title: 'Eclipse Mosquitto', url: 'https://mosquitto.org', desc: 'MQTT broker' },
      { title: 'Node-RED', url: 'https://nodered.org', desc: 'Flow-based IoT wiring' },
      { title: 'Wokwi', url: 'https://wokwi.com', desc: 'Online Arduino / ESP32 simulator' },
    ],
  },
];
