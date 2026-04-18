export function must<T extends HTMLElement>(query: string): T {
  const node = document.querySelector<T>(query);
  if (!node) {
    throw new Error(`Missing required element: ${query}`);
  }
  return node;
}

export function must2dContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = target.getContext("2d");
  if (!context) {
    throw new Error("2d context not available");
  }
  return context;
}
