export async function loadValue() {
  const mod = await import("./helper");
  return mod.helper(1);
}
