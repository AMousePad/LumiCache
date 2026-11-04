export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function externalLink(label: string, url: string): HTMLAnchorElement {
  const node = el("a", "lc-link", label); node.href = url; node.target = "_blank"; node.rel = "noopener noreferrer";
  return node;
}
export function button(label: string, action: () => void, className = ""): HTMLButtonElement {
  const node = el("button", `lc-button ${className}`, label); node.type = "button";
  node.addEventListener("click", action); return node;
}
