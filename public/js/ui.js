// Drawing: the white bloom that shows what G1 is doing, and the single result card.

const PETALS = 54;

/** The bloom. state: idle | listening | thinking | speaking */
export function createBloom(canvas) {
  const ctx = canvas.getContext('2d');
  const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let state = 'idle';
  let energy = 0; // rises when words arrive
  let raf = 0;
  const seeds = Array.from({ length: PETALS }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);

  function draw(ms) {
    const t = ms / 1000;
    const W = canvas.width;
    const c = W / 2;
    ctx.clearRect(0, 0, W, W);
    energy *= 0.94;
    const base = W * 0.2;
    for (let i = 0; i < PETALS; i++) {
      const a = (i / PETALS) * Math.PI * 2;
      const n = Math.abs(seeds[i]);
      let len;
      let alpha = 0.9;
      let spin = 0;
      if (state === 'listening') {
        len = 0.1 + 0.07 * Math.sin(t * 7 + n * 9) + energy * (0.1 + 0.16 * n) + 0.05 * Math.sin(t * 2 + i * 0.4);
      } else if (state === 'thinking') {
        spin = t * 1.6;
        len = 0.06 + 0.12 * Math.pow(0.5 + 0.5 * Math.sin(a * 2 - t * 5), 3);
        alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(a * 2 - t * 5));
      } else if (state === 'speaking') {
        const syll = 0.5 + 0.5 * Math.sin(t * 9.5) * Math.sin(t * 3.1 + 1);
        len = 0.09 + syll * (0.08 + 0.12 * n) + 0.03 * Math.sin(t * 5 + i);
      } else {
        len = 0.085 + 0.022 * Math.sin(t * 1.1 + i * 0.35);
        alpha = 0.75;
      }
      const r0 = base;
      const r1 = base + Math.max(0.03, len) * W;
      const ang = a + spin;
      const grad = ctx.createLinearGradient(c + Math.cos(ang) * r0, c + Math.sin(ang) * r0, c + Math.cos(ang) * r1, c + Math.sin(ang) * r1);
      const warm = '#FFFFFF';
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, warm);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = grad;
      ctx.lineWidth = W * 0.013;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(ang) * r0, c + Math.sin(ang) * r0);
      ctx.lineTo(c + Math.cos(ang) * r1, c + Math.sin(ang) * r1);
      ctx.stroke();
    }
    // centre
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(c, c, W * (0.045 + (state === 'speaking' ? 0.012 * Math.abs(Math.sin(t * 9.5)) : 0)), 0, Math.PI * 2);
    ctx.fill();
    if (!still) raf = requestAnimationFrame(draw);
  }

  if (still) draw(0);
  else raf = requestAnimationFrame(draw);

  return {
    set(next) {
      state = next;
      if (still) draw(1400);
    },
    pulse() {
      energy = Math.min(1, energy + 0.5);
    },
    stop: () => cancelAnimationFrame(raf),
  };
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Shows one card. handlers: { onYes, onNo, labels: { yes, no } } */
export function createCardView(root, handlers) {
  let ticker = 0;
  function clear() {
    clearInterval(ticker);
    root.replaceChildren();
    root.hidden = true;
    root.className = 'card';
  }
  function link(card) {
    const a = el('a', 'primary', card.label || 'Open');
    a.href = card.url;
    if (/^https?:/.test(card.url)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    const row = el('div', 'row');
    row.append(a);
    return row;
  }
  return {
    clear,
    show(card) {
      clear();
      if (!card) return;
      root.hidden = false;
      root.classList.add('card-' + card.type);
      if (card.type === 'weather') {
        const words = el('div');
        words.append(el('h3', '', card.place), el('p', 'quote', card.summary), el('p', '', `${card.lo}° to ${card.hi}°${card.rain != null ? `, rain ${card.rain}%` : ''}`));
        root.append(el('span', 'big', String(card.temp)), words);
      } else if (card.type === 'timer') {
        const big = el('span', 'big', mmss(card.endsAt - Date.now()));
        root.append(el('h3', '', card.label), big);
        ticker = setInterval(() => {
          big.textContent = mmss(card.endsAt - Date.now());
          if (Date.now() >= card.endsAt) clearInterval(ticker);
        }, 250);
      } else if (card.type === 'list') {
        const ul = el('ul');
        (card.items || []).forEach((i) => ul.append(el('li', '', i)));
        root.append(el('h3', '', card.title), ul);
        if (card.more) root.append(el('p', 'more', `and ${card.more} more`));
      } else if (card.type === 'confirm') {
        const row = el('div', 'row');
        const yes = el('button', 'primary', handlers.labels().yes);
        const no = el('button', 'secondary', handlers.labels().no);
        yes.type = no.type = 'button';
        yes.onclick = () => handlers.onYes();
        no.onclick = () => handlers.onNo();
        row.append(yes, no);
        root.append(el('h3', '', card.title));
        if (card.text) root.append(el('p', 'quote', card.text));
        root.append(row);
      } else if (card.type === 'action') {
        root.append(el('h3', '', card.title));
        if (card.text) root.append(el('p', 'quote', card.text));
        root.append(link(card));
      } else if (card.type === 'info') {
        root.append(el('h3', '', card.title));
        if (card.text) root.append(el('p', '', card.text));
        if (card.url) root.append(link(card));
      } else if (card.type === 'photo') {
        const img = el('img');
        img.src = card.src;
        img.alt = 'Photo G1 just took';
        root.append(img);
      } else if (card.type === 'video') {
        const v = el('video');
        v.src = card.src;
        v.controls = true;
        v.playsInline = true;
        root.append(v);
      }
    },
  };
}
