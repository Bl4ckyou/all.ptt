const SVG_NS = 'http://www.w3.org/2000/svg';

let flowerInstance = 0;

const FLOWER_MARKUP = `
  <defs>
    <linearGradient id="outerPetalGrad" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#e63973" />
      <stop offset="55%" stop-color="#ff85a9" />
      <stop offset="100%" stop-color="#ffd6e2" />
    </linearGradient>

    <linearGradient id="midPetalGrad" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#d91e5b" />
      <stop offset="60%" stop-color="#ff5c8d" />
      <stop offset="100%" stop-color="#ffb3c6" />
    </linearGradient>

    <linearGradient id="innerPetalGrad" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#a4133c" />
      <stop offset="65%" stop-color="#ff477e" />
      <stop offset="100%" stop-color="#ff9ebb" />
    </linearGradient>

    <linearGradient id="fallenPetalGrad" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#ff5c8d" />
      <stop offset="100%" stop-color="#ffc2d4" />
    </linearGradient>

    <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff3b0" />
      <stop offset="65%" stop-color="#ffd166" />
      <stop offset="100%" stop-color="#f77f00" />
    </radialGradient>

    <path id="outerPetal" d="M 0,0 C -20,-24 -22,-66 0,-82 C 22,-66 20,-24 0,0 Z" fill="url(#outerPetalGrad)" stroke="#ff4d88" stroke-width="0.5" />

    <path id="midPetal" d="M 0,0 C -17,-20 -19,-52 0,-65 C 19,-52 17,-20 0,0 Z" fill="url(#midPetalGrad)" stroke="#e63973" stroke-width="0.5" />

    <path id="innerPetal" d="M 0,0 C -14,-16 -15,-36 0,-46 C 15,-36 14,-16 0,0 Z" fill="url(#innerPetalGrad)" stroke="#c9184a" stroke-width="0.5" />

    <g id="fallenPetal">
      <path d="M 2,3 C -10,-11 -14,-29 0,-39 C 14,-31 16,-11 2,3 Z" fill="#000000" opacity="0.08" />
      <path d="M 0,0 C -12,-14 -16,-32 -2,-42 C 12,-34 14,-14 0,0 Z" fill="url(#fallenPetalGrad)" stroke="#ff4d88" stroke-width="0.5" />
    </g>
  </defs>

  <g transform="translate(105, 105)">
    <g>
      <use href="#outerPetal" transform="rotate(0)" />
      <use href="#outerPetal" transform="rotate(30)" />
      <use href="#outerPetal" transform="rotate(60)" />
      <use href="#outerPetal" transform="rotate(90)" />
      <use href="#outerPetal" transform="rotate(120)" />
      <use href="#outerPetal" transform="rotate(150)" />
      <use href="#outerPetal" transform="rotate(180)" />
      <use href="#outerPetal" transform="rotate(210)" />
      <use href="#outerPetal" transform="rotate(240)" />
      <use href="#outerPetal" transform="rotate(270)" />
      <use href="#outerPetal" transform="rotate(300)" />
      <use href="#outerPetal" transform="rotate(330)" />
    </g>

    <g>
      <use href="#midPetal" transform="rotate(15)" />
      <use href="#midPetal" transform="rotate(45)" />
      <use href="#midPetal" transform="rotate(75)" />
      <use href="#midPetal" transform="rotate(105)" />
      <use href="#midPetal" transform="rotate(135)" />
      <use href="#midPetal" transform="rotate(165)" />
      <use href="#midPetal" transform="rotate(195)" />
      <use href="#midPetal" transform="rotate(225)" />
      <use href="#midPetal" transform="rotate(255)" />
      <use href="#midPetal" transform="rotate(285)" />
      <use href="#midPetal" transform="rotate(315)" />
      <use href="#midPetal" transform="rotate(345)" />
    </g>

    <g>
      <use href="#innerPetal" transform="rotate(8)" />
      <use href="#innerPetal" transform="rotate(44)" />
      <use href="#innerPetal" transform="rotate(80)" />
      <use href="#innerPetal" transform="rotate(116)" />
      <use href="#innerPetal" transform="rotate(152)" />
      <use href="#innerPetal" transform="rotate(188)" />
      <use href="#innerPetal" transform="rotate(224)" />
      <use href="#innerPetal" transform="rotate(260)" />
      <use href="#innerPetal" transform="rotate(296)" />
      <use href="#innerPetal" transform="rotate(332)" />
    </g>

    <g fill="#ffe66d" stroke="#f77f00" stroke-width="0.7">
      <circle cx="0" cy="-17" r="2" transform="rotate(0)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(30)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(60)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(90)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(120)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(150)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(180)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(210)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(240)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(270)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(300)" />
      <circle cx="0" cy="-17" r="2" transform="rotate(330)" />
    </g>

    <circle cx="0" cy="0" r="14" fill="url(#centerGrad)" />
    <circle cx="-3" cy="-4" r="1.3" fill="#f77f00" opacity="0.5" />
    <circle cx="5" cy="-2" r="1.1" fill="#f77f00" opacity="0.5" />
    <circle cx="-4" cy="5" r="1.2" fill="#f77f00" opacity="0.5" />
    <circle cx="3" cy="4" r="1.4" fill="#f77f00" opacity="0.5" />
  </g>

  <use href="#fallenPetal" transform="translate(205, 125) rotate(110) scale(0.95)" />
  <use href="#fallenPetal" transform="translate(218, 168) rotate(70) scale(0.85)" />
  <use href="#fallenPetal" transform="translate(178, 180) rotate(140) scale(0.9)" />
`;

function scopeIds(markup: string, prefix: string): string {
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  let scoped = markup;

  for (const id of ids) {
    scoped = scoped
      .replaceAll(`id="${id}"`, `id="${prefix}-${id}"`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}-${id})`);
  }
  return scoped;
}

export function flowerSvg(
  className = 'flower-art',
  viewBox = '0 0 260 220',
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  flowerInstance += 1;
  svg.innerHTML = scopeIds(FLOWER_MARKUP, `flower-${flowerInstance}`);
  return svg;
}

export function leafSvg(className = 'decor-leaf'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-24 -96 48 104');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  flowerInstance += 1;
  svg.innerHTML = scopeIds(
    `
    <defs>
      <linearGradient id="leafGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#2d6a4f" />
        <stop offset="100%" stop-color="#52b788" />
      </linearGradient>
    </defs>
    <path d="M 0,0 C -18,-28 -16,-68 0,-90 C 16,-68 18,-28 0,0 Z" fill="url(#leafGrad)" />
    <path d="M 0,-12 L 0,-80" stroke="#74c69d" stroke-width="1.2" stroke-linecap="round" opacity="0.6" />
    `,
    `leaf-${flowerInstance}`,
  );
  return svg;
}

const LEAF_SPECS = [
  { left: '-2%', top: '6%', rotate: -25, scale: 1, opacity: 0.32 },
  { left: '5%', top: '68%', rotate: 40, scale: 1.15, opacity: 0.28 },
  { left: '91%', top: '14%', rotate: 115, scale: 1.2, opacity: 0.3 },
  { left: '84%', top: '76%', rotate: -65, scale: 0.9, opacity: 0.28 },
  { left: '44%', top: '-4%', rotate: 65, scale: 0.7, opacity: 0.2 },
  { left: '-3%', top: '44%', rotate: -105, scale: 0.75, opacity: 0.2 },
  { left: '70%', top: '96%', rotate: 15, scale: 0.65, opacity: 0.18 },
];

export function createLeafLayer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'leaf-layer';

  LEAF_SPECS.forEach((spec, index) => {
    const holder = document.createElement('div');
    holder.className = 'leaf-holder';
    holder.style.left = spec.left;
    holder.style.top = spec.top;
    holder.style.opacity = String(spec.opacity);
    holder.style.transform = `rotate(${spec.rotate}deg) scale(${spec.scale})`;
    holder.style.animationDelay = `${index * 1.3}s`;
    holder.append(leafSvg());
    layer.append(holder);
  });

  return layer;
}
