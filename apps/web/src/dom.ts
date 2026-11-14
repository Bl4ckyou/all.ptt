export interface ElementProps {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Record<string, EventListener>;
  value?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.value !== undefined) (node as HTMLInputElement).value = props.value;

  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  for (const [name, listener] of Object.entries(props.on ?? {})) node.addEventListener(name, listener);
  for (const child of children) node.append(child);

  return node;
}

export function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  return el('option', { value, text: label, attrs: selected ? { selected: '' } : {} });
}
