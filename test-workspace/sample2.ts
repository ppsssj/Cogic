// sample-param-flow.ts
interface User {
  id: number;
  name: string;
}

type SaveResult = { ok: boolean; message: string };

function normalizeName(rawName: string): string {
  return rawName.trim().toLowerCase();
}

function buildUser(userId: number, userName: string): User {
  const normalized = normalizeName(userName);
  return { id: userId, name: normalized };
}

function validateUser(user: User): boolean {
  return user.name.length > 0;
}

function saveUser(user: User, retries: number): SaveResult {
  if (!validateUser(user)) {
    return { ok: false, message: "invalid user" };
  }
  return { ok: true, message: `saved (${retries})` };
}

function logResult(prefix: string, result: SaveResult): void {
  console.log(prefix, result.message);
}

function runFlow(inputName: string, retryCount: number): void {
  const user = buildUser(101, inputName);
  const result = saveUser(user, retryCount);
  logResult("DONE:", result);
}

// 실행
runFlow("  Alice  ", 3);
