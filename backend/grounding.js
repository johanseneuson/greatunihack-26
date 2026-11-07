// Deterministic hallucination check. Every £ figure in a reply must come from the retrieved context or the user's own
// message, or be a simple sum / difference / x12 of such figures (allowing for rounding). Otherwise the reply is rejected.
const money = text => [...String(text).matchAll(/£\s?(\d[\d,]*(?:\.\d+)?)/g)].map(m => parseFloat(m[1].replace(/,/g, '')));
const numbers = text => [...String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m => parseFloat(m[0].replace(/,/g, ''))).filter(n => isFinite(n));

function unsupportedFigures(reply, contextText, userText) {
  const used = money(reply);
  if (!used.length) return [];
  const base = [...new Set([...money(contextText), ...money(userText), ...numbers(userText)].map(n => Math.round(n * 100) / 100))].slice(0, 140);
  const allowed = new Set(base);
  const add = n => { if (n >= 0) allowed.add(Math.round(n * 100) / 100); };
  base.forEach(a => { add(a * 12); add(a * 2); add(a * 4); add(a / 2); add(a / 4); add(a / 52 * 12); });
  for (let i = 0; i < base.length; i++) for (let j = i; j < base.length; j++) {
    add(base[i] + base[j]); add(Math.abs(base[i] - base[j]));
    if (base.length <= 70) for (let k = j; k < base.length; k++) add(base[i] + base[j] + base[k]);
  }
  const arr = [...allowed];
  return used.filter(u => !arr.some(a => Math.abs(a - u) <= 0.51));
}
module.exports = { unsupportedFigures };
