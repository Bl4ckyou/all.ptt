const SVG_NS = 'http://www.w3.org/2000/svg';

const PETAL_COLORS = ['#ffd6e6', '#ffc0d9', '#ffb0cf', '#ff9ec4'];

export function flowerSvg(className = 'flower-art'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');

  const petals = 12;
  let markup = '';

  for (let index = 0; index < petals; index++) {
    const angle = (360 / petals) * index;
    const fill = PETAL_COLORS[index % PETAL_COLORS.length];
    markup += `<ellipse cx="100" cy="54" rx="16" ry="40" transform="rotate(${angle} 100 100)" fill="${fill}"/>`;
  }

  markup +=
    '<circle cx="100" cy="100" r="26" fill="#ffd166"/><circle cx="100" cy="100" r="13" fill="#f4a261"/>';

  svg.innerHTML = markup;
  return svg;
}

export function flowerMap(labels: string[]): HTMLElement {
  const map = document.createElement('div');
  map.className = 'flower-map';
  map.append(flowerSvg('flower-map-art'));

  const positions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  labels.slice(0, positions.length).forEach((label, index) => {
    const chip = document.createElement('span');
    chip.className = `flower-label ${positions[index]}`;
    chip.textContent = label;
    map.append(chip);
  });

  return map;
}
