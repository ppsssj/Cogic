export function pad(text: string, width: number): string {
  return text.length >= width ? text : pad(` ${text}`, width);
}
